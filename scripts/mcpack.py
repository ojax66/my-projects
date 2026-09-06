#!/usr/bin/env python3
"""Importador de mundos (.mcworld) e addons (.mcaddon/.mcpack) para um
servidor Minecraft Bedrock Dedicated Server.

Trabalha diretamente sobre o diretorio /data do servidor:

    data/
      worlds/<mundo>/                     level.dat, db/, levelname.txt
      worlds/<mundo>/world_behavior_packs.json
      worlds/<mundo>/world_resource_packs.json
      behavior_packs/<pacote>/            manifest.json ...
      resource_packs/<pacote>/            manifest.json ...

Uso:
    mcpack.py world  arquivo.mcworld [--name meu-mundo] [--activate]
    mcpack.py addon  arquivo.mcaddon [--world meu-mundo]
    mcpack.py auto   [diretorio]        # importa tudo de incoming/
    mcpack.py list   [--world meu-mundo]
    mcpack.py remove <uuid> [--world meu-mundo]

Sem dependencias externas (stdlib apenas): roda em qualquer Python 3.8+.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import unicodedata
import zipfile
from pathlib import Path

WORLD_EXT = {".mcworld", ".mctemplate"}
PACK_EXT = {".mcaddon", ".mcpack", ".zip"}

BEHAVIOR_MODULES = {"data", "script", "javascript", "client_data"}
RESOURCE_MODULES = {"resources"}
SKIP_MODULES = {"world_template", "skin_pack"}


# --------------------------------------------------------------------------- #
# utilidades
# --------------------------------------------------------------------------- #
def log(msg: str) -> None:
    print(f"  {msg}")


def die(msg: str) -> "None":
    print(f"erro: {msg}", file=sys.stderr)
    raise SystemExit(1)


def slugify(name: str) -> str:
    """Nome de diretorio seguro, preservando legibilidade."""
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-.")
    return name.lower() or "pack"


def load_jsonc(path: Path) -> dict:
    """manifest.json da Mojang costuma ter comentarios e virgulas sobrando."""
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    # remove comentarios // e /* */ fora de strings
    out, i, n = [], 0, len(text)
    in_str = False
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if c == '"':
                in_str = False
            i += 1
            continue
        if c == '"':
            in_str = True
            out.append(c)
            i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] != "\n":
                i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
            continue
        out.append(c)
        i += 1
    cleaned = re.sub(r",(\s*[}\]])", r"\1", "".join(out))
    return json.loads(cleaned)


def read_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (json.JSONDecodeError, OSError):
        return default


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def normalize_version(raw) -> list:
    """header.version pode ser [1,0,0], "1.0.0" ou faltar."""
    if isinstance(raw, list) and raw:
        parts = []
        for item in raw[:3]:
            try:
                parts.append(int(item))
            except (TypeError, ValueError):
                parts.append(0)
        while len(parts) < 3:
            parts.append(0)
        return parts
    if isinstance(raw, str):
        nums = re.findall(r"\d+", raw)[:3]
        parts = [int(x) for x in nums]
        while len(parts) < 3:
            parts.append(0)
        return parts
    return [1, 0, 0]


def safe_extract(archive: Path, dest: Path) -> None:
    """Extrai um zip barrando path traversal (zip slip)."""
    dest.mkdir(parents=True, exist_ok=True)
    root = dest.resolve()
    try:
        zf = zipfile.ZipFile(archive)
    except zipfile.BadZipFile:
        die(f"{archive.name} nao e um arquivo zip valido (.mcworld/.mcaddon sao zips)")
    with zf:
        for member in zf.infolist():
            target = (root / member.filename).resolve()
            if not str(target).startswith(str(root) + os.sep) and target != root:
                die(f"entrada suspeita no arquivo: {member.filename}")
        zf.extractall(root)


def flatten_single_dir(path: Path, marker: str) -> Path:
    """Zips costumam vir com uma pasta extra na raiz; devolve a pasta real."""
    if (path / marker).exists():
        return path
    entries = [p for p in path.iterdir() if not p.name.startswith("__MACOSX")]
    dirs = [p for p in entries if p.is_dir()]
    if len(dirs) == 1 and (dirs[0] / marker).exists():
        return dirs[0]
    return path


def copy_tree(src: Path, dst: Path) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)


# --------------------------------------------------------------------------- #
# servidor
# --------------------------------------------------------------------------- #
class Server:
    def __init__(self, data_dir: Path, env_file: Path | None = None):
        self.data = data_dir
        self.env_file = env_file
        self.worlds = data_dir / "worlds"
        self.behavior = data_dir / "behavior_packs"
        self.resource = data_dir / "resource_packs"
        for d in (self.worlds, self.behavior, self.resource):
            d.mkdir(parents=True, exist_ok=True)

    # -- mundos ------------------------------------------------------------ #
    def list_worlds(self) -> list:
        return sorted(p.name for p in self.worlds.iterdir() if p.is_dir())

    def current_world(self) -> str:
        """Mundo ativo: LEVEL_NAME do .env, senao server.properties, senao o unico."""
        for src, key in ((self.env_file, "LEVEL_NAME"), (self.data / "server.properties", "level-name")):
            if src and src.exists():
                for line in src.read_text(encoding="utf-8", errors="replace").splitlines():
                    line = line.strip()
                    if line.startswith(f"{key}=") and not line.startswith("#"):
                        value = line.split("=", 1)[1].strip().strip('"')
                        if value:
                            return value
        existing = self.list_worlds()
        if len(existing) == 1:
            return existing[0]
        return "world"

    def resolve_world(self, name: str | None) -> Path:
        world = self.worlds / (name or self.current_world())
        if not world.exists():
            found = self.list_worlds()
            hint = ", ".join(found) if found else "(nenhum mundo importado ainda)"
            die(f"mundo '{world.name}' nao existe em {self.worlds}. Disponiveis: {hint}")
        return world

    def set_active_world(self, name: str) -> None:
        """Grava LEVEL_NAME no .env para o proximo start do container."""
        if not self.env_file:
            return
        if not self.env_file.exists():
            log(f"aviso: {self.env_file} nao existe; defina LEVEL_NAME={name} manualmente")
            return
        lines = self.env_file.read_text(encoding="utf-8").splitlines()
        replaced = False
        for i, line in enumerate(lines):
            if re.match(r"\s*#?\s*LEVEL_NAME\s*=", line):
                lines[i] = f"LEVEL_NAME={name}"
                replaced = True
                break
        if not replaced:
            lines.append(f"LEVEL_NAME={name}")
        self.env_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
        log(f"LEVEL_NAME={name} gravado em {self.env_file}")

    # -- registro de pacotes no mundo -------------------------------------- #
    def register(self, world: Path, kind: str, uuid: str, version: list) -> str:
        registry = world / f"world_{kind}_packs.json"
        entries = read_json(registry, [])
        if not isinstance(entries, list):
            entries = []
        for entry in entries:
            if isinstance(entry, dict) and entry.get("pack_id") == uuid:
                if entry.get("version") == version:
                    return "ja ativo"
                entry["version"] = version
                write_json(registry, entries)
                return "versao atualizada"
        entries.append({"pack_id": uuid, "version": version})
        write_json(registry, entries)
        return "ativado"

    def unregister(self, world: Path, uuid: str) -> int:
        removed = 0
        for kind in ("behavior", "resource"):
            registry = world / f"world_{kind}_packs.json"
            entries = read_json(registry, [])
            if not isinstance(entries, list):
                continue
            kept = [e for e in entries if not (isinstance(e, dict) and e.get("pack_id") == uuid)]
            if len(kept) != len(entries):
                write_json(registry, kept)
                removed += len(entries) - len(kept)
        return removed


# --------------------------------------------------------------------------- #
# importacao de pacotes
# --------------------------------------------------------------------------- #
def find_packs(root: Path) -> list:
    """Todos os diretorios com manifest.json, sem descer dentro de um pacote."""
    packs = []
    for manifest in sorted(root.rglob("manifest.json")):
        pack_dir = manifest.parent
        if any(pack_dir != p and str(pack_dir).startswith(str(p) + os.sep) for p in packs):
            continue
        packs.append(pack_dir)
    return packs


def expand_nested_archives(root: Path) -> None:
    """.mcaddon pode conter .mcpack/.zip dentro; extrai ate nao sobrar nenhum."""
    for _ in range(4):
        nested = [p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in PACK_EXT]
        if not nested:
            return
        for archive in nested:
            target = archive.with_suffix("")
            if target.exists():
                target = Path(f"{target}-{archive.suffix.lstrip('.')}")
            safe_extract(archive, target)
            archive.unlink()


def classify(manifest: dict) -> str:
    types = {
        str(m.get("type", "")).lower()
        for m in manifest.get("modules", [])
        if isinstance(m, dict)
    }
    if types & RESOURCE_MODULES:
        return "resource"
    if types & BEHAVIOR_MODULES:
        return "behavior"
    if types & SKIP_MODULES:
        return "skip"
    # sem modules validos: chuta pela presenca de pastas conhecidas
    return "behavior"


def import_addon(server: Server, source: Path, world_name: str | None) -> int:
    world = server.resolve_world(world_name)
    print(f"addon: {source.name} -> mundo '{world.name}'")

    with tempfile.TemporaryDirectory(prefix="mcpack-") as tmp:
        staging = Path(tmp)
        if source.is_dir():
            shutil.copytree(source, staging / "src")
            staging = staging / "src"
        else:
            safe_extract(source, staging)
            expand_nested_archives(staging)

        packs = find_packs(staging)
        if not packs:
            die(f"nenhum manifest.json encontrado em {source.name}: nao parece um addon")

        installed = 0
        for pack_dir in packs:
            try:
                manifest = load_jsonc(pack_dir / "manifest.json")
            except (json.JSONDecodeError, OSError) as exc:
                log(f"ignorado {pack_dir.name}: manifest.json invalido ({exc})")
                continue

            header = manifest.get("header", {}) if isinstance(manifest, dict) else {}
            uuid = header.get("uuid")
            if not uuid:
                log(f"ignorado {pack_dir.name}: manifest sem header.uuid")
                continue

            kind = classify(manifest)
            if kind == "skip":
                log(f"ignorado {pack_dir.name}: e world template/skin pack, nao um addon")
                continue

            name = str(header.get("name", pack_dir.name))
            if name.startswith("pack.name") or "§" in name:
                name = pack_dir.name  # nome vem de arquivo de traducao
            version = normalize_version(header.get("version"))

            dest_root = server.behavior if kind == "behavior" else server.resource
            dest = dest_root / f"{slugify(name)}-{uuid[:8]}"
            copy_tree(pack_dir, dest)
            status = server.register(world, kind, uuid, version)
            log(f"[{kind:8}] {name} v{'.'.join(map(str, version))} -> {dest.name} ({status})")
            installed += 1

    if installed:
        print(f"  {installed} pacote(s) instalado(s). Reinicie o servidor para aplicar.")
    return installed


# --------------------------------------------------------------------------- #
# importacao de mundos
# --------------------------------------------------------------------------- #
def import_world(server: Server, source: Path, name: str | None, activate: bool) -> str:
    with tempfile.TemporaryDirectory(prefix="mcworld-") as tmp:
        staging = Path(tmp) / "w"
        if source.is_dir():
            shutil.copytree(source, staging)
        else:
            safe_extract(source, staging)
        staging = flatten_single_dir(staging, "level.dat")

        if not (staging / "level.dat").exists():
            die(f"{source.name} nao contem level.dat: nao e um mundo Bedrock valido")

        level_name_file = staging / "levelname.txt"
        original = (
            level_name_file.read_text(encoding="utf-8", errors="replace").strip()
            if level_name_file.exists()
            else source.stem
        )
        world_name = slugify(name or original or source.stem)
        dest = server.worlds / world_name
        if dest.exists():
            backup = dest.with_name(f"{world_name}.bak")
            if backup.exists():
                shutil.rmtree(backup)
            dest.rename(backup)
            log(f"mundo existente movido para {backup.name}")

        shutil.copytree(staging, dest)
        (dest / "levelname.txt").write_text(f"{original or world_name}\n", encoding="utf-8")

    print(f"mundo: {source.name} -> worlds/{world_name}  (nome no jogo: {original})")
    packs = read_json(dest / "world_behavior_packs.json", []) or []
    packs += read_json(dest / "world_resource_packs.json", []) or []
    if packs:
        log(f"o mundo referencia {len(packs)} pacote(s); importe os addons correspondentes")
    if activate:
        server.set_active_world(world_name)
    else:
        log(f"para ativar: LEVEL_NAME={world_name} no server/.env (ou use --activate)")
    return world_name


# --------------------------------------------------------------------------- #
# comandos
# --------------------------------------------------------------------------- #
def cmd_auto(server: Server, incoming: Path, world: str | None, activate: bool) -> None:
    if not incoming.is_dir():
        die(f"diretorio nao encontrado: {incoming}")
    files = sorted(p for p in incoming.iterdir() if p.is_file() and not p.name.startswith("."))
    if not files:
        print(f"nada para importar em {incoming}")
        return
    # mundos primeiro: os addons precisam de um mundo de destino
    files.sort(key=lambda p: 0 if p.suffix.lower() in WORLD_EXT else 1)
    done_dir = incoming / "processados"
    handled = 0
    for path in files:
        ext = path.suffix.lower()
        if ext in WORLD_EXT:
            new_world = import_world(server, path, None, activate)
            if activate:
                world = new_world
        elif ext in PACK_EXT:
            import_addon(server, path, world)
        else:
            log(f"ignorado {path.name}: extensao {ext or '(nenhuma)'} nao suportada")
            continue
        handled += 1
        done_dir.mkdir(exist_ok=True)
        shutil.move(str(path), str(done_dir / path.name))
    print(f"\n{handled} arquivo(s) processado(s); originais em {done_dir}")


def cmd_list(server: Server, world_name: str | None) -> None:
    active = server.current_world()
    print(f"data: {server.data}")
    print(f"mundo ativo (LEVEL_NAME): {active}\n")

    print("mundos:")
    for name in server.list_worlds() or []:
        print(f"  {'*' if name == active else '-'} {name}")
    if not server.list_worlds():
        print("  (nenhum)")

    installed = {}
    for kind, root in (("behavior", server.behavior), ("resource", server.resource)):
        for pack in sorted(root.iterdir()):
            manifest = pack / "manifest.json"
            if not manifest.exists():
                continue
            try:
                header = load_jsonc(manifest).get("header", {})
            except Exception:
                continue
            if header.get("uuid"):
                installed[header["uuid"]] = (kind, header.get("name", pack.name), pack.name)

    print(f"\npacotes instalados ({len(installed)}):")
    for uuid, (kind, name, folder) in sorted(installed.items(), key=lambda i: i[1][2]):
        print(f"  [{kind:8}] {folder}  ({uuid})")
    if not installed:
        print("  (nenhum)")

    world = server.worlds / (world_name or active)
    if world.is_dir():
        print(f"\nativos no mundo '{world.name}':")
        found = False
        for kind in ("behavior", "resource"):
            for entry in read_json(world / f"world_{kind}_packs.json", []) or []:
                uuid = entry.get("pack_id", "?") if isinstance(entry, dict) else "?"
                known = installed.get(uuid)
                label = known[2] if known else "PACOTE AUSENTE em data/*_packs"
                version = ".".join(map(str, entry.get("version", []))) if isinstance(entry, dict) else "?"
                print(f"  [{kind:8}] {label}  v{version}  ({uuid})")
                found = True
        if not found:
            print("  (nenhum)")


def cmd_remove(server: Server, uuid: str, world_name: str | None) -> None:
    world = server.resolve_world(world_name)
    removed = server.unregister(world, uuid)
    print(f"{removed} registro(s) removido(s) do mundo '{world.name}'")
    for root in (server.behavior, server.resource):
        for pack in sorted(root.iterdir()):
            manifest = pack / "manifest.json"
            if not manifest.exists():
                continue
            try:
                if load_jsonc(manifest).get("header", {}).get("uuid") == uuid:
                    shutil.rmtree(pack)
                    print(f"diretorio removido: {pack}")
            except Exception:
                continue


def main() -> int:
    default_data = Path(os.environ.get("MCBE_DATA", Path(__file__).resolve().parent.parent / "server" / "data"))
    default_env = Path(os.environ.get("MCBE_ENV", Path(__file__).resolve().parent.parent / "server" / ".env"))

    parser = argparse.ArgumentParser(description="Importa mundos e addons no servidor Bedrock")
    parser.add_argument("--data", type=Path, default=default_data, help="diretorio /data do servidor")
    parser.add_argument("--env-file", type=Path, default=default_env, help=".env do docker-compose")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("world", help="importa um .mcworld")
    p.add_argument("arquivo", type=Path)
    p.add_argument("--name", help="nome do diretorio do mundo")
    p.add_argument("--activate", action="store_true", help="define como LEVEL_NAME no .env")

    p = sub.add_parser("addon", help="importa um .mcaddon/.mcpack")
    p.add_argument("arquivo", type=Path)
    p.add_argument("--world", help="mundo de destino (padrao: mundo ativo)")

    p = sub.add_parser("auto", help="importa tudo de um diretorio (padrao: server/incoming)")
    p.add_argument("diretorio", type=Path, nargs="?")
    p.add_argument("--world", help="mundo de destino para os addons")
    p.add_argument("--activate", action="store_true", help="ativa o mundo importado")

    p = sub.add_parser("list", help="mostra mundos e pacotes")
    p.add_argument("--world")

    p = sub.add_parser("remove", help="desativa e apaga um pacote pelo uuid")
    p.add_argument("uuid")
    p.add_argument("--world")

    args = parser.parse_args()
    server = Server(args.data.resolve(), args.env_file)

    if args.cmd == "world":
        import_world(server, args.arquivo, args.name, args.activate)
    elif args.cmd == "addon":
        import_addon(server, args.arquivo, args.world)
    elif args.cmd == "auto":
        incoming = args.diretorio or (server.data.parent / "incoming")
        cmd_auto(server, Path(incoming), args.world, args.activate)
    elif args.cmd == "list":
        cmd_list(server, args.world)
    elif args.cmd == "remove":
        cmd_remove(server, args.uuid, args.world)
    return 0


if __name__ == "__main__":
    sys.exit(main())
