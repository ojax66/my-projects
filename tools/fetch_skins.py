#!/usr/bin/env python3
"""Busca automática de skins pelo gamertag e gera o add-on com elas.

Uso:
  python3 tools/fetch_skins.py                 # lê os nomes de skins/players.txt
  python3 tools/fetch_skins.py Gamertag1 "Outro Nome" java:NomeJava

Em skins/players.txt coloque um jogador por linha (linhas com # são ignoradas).

De onde vem a skin:
  Gamertag       -> API global da GeyserMC (api.geysermc.org). Ela só conhece a
                    skin de quem já entrou em algum servidor com Geyser/Floodgate.
  java:Nome      -> conta do Minecraft Java com esse nome (API da Mojang). Use só
                    se o jogador tem a mesma skin no Java.

Skins colocadas à mão em skins/<Gamertag>.png têm prioridade sobre as baixadas.
Quem não for encontrado aparece como Steve.
"""

import json
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from base64 import b64decode
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKINS = ROOT / "skins"
AUTO = SKINS / "auto"
HEADERS = {"User-Agent": "OperacaoFenix-SkinFetcher/1.0"}


def get(url: str) -> bytes | None:
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (400, 404, 204):
                return None
            if e.code == 429 and attempt < 2:  # limite de requisições
                time.sleep(3 * (attempt + 1))
                continue
            raise
    return None


def get_json(url: str):
    data = get(url)
    if not data:
        return None
    try:
        return json.loads(data)
    except ValueError:
        return None


def png_size(data: bytes) -> tuple[int, int] | None:
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


def texture(texture_id: str) -> bytes | None:
    return get(f"https://textures.minecraft.net/texture/{texture_id}")


def fetch_bedrock(gamertag: str) -> tuple[bytes, bool] | None:
    """Skin (png, slim) de um jogador Bedrock pela API da GeyserMC."""
    xuid = get_json(f"https://api.geysermc.org/v2/xbox/xuid/{urllib.parse.quote(gamertag)}")
    if not xuid or "xuid" not in xuid:
        return None
    skin = get_json(f"https://api.geysermc.org/v2/skin/{xuid['xuid']}")
    if not skin or not skin.get("texture_id"):
        return None
    png = texture(skin["texture_id"])
    return (png, not skin.get("is_steve", True)) if png else None


def fetch_java(name: str) -> tuple[bytes, bool] | None:
    """Skin (png, slim) de uma conta Java pela API da Mojang."""
    profile = get_json(f"https://api.mojang.com/users/profiles/minecraft/{urllib.parse.quote(name)}")
    if not profile or "id" not in profile:
        return None
    session = get_json(f"https://sessionserver.mojang.com/session/minecraft/profile/{profile['id']}")
    for prop in (session or {}).get("properties", []):
        if prop.get("name") != "textures":
            continue
        skin = json.loads(b64decode(prop["value"])).get("textures", {}).get("SKIN")
        if not skin:
            return None
        png = get(skin["url"].replace("http://", "https://"))
        slim = skin.get("metadata", {}).get("model") == "slim"
        return (png, slim) if png else None
    return None


def read_players(args: list[str]) -> list[str]:
    if args:
        return args
    listing = SKINS / "players.txt"
    if not listing.exists():
        sys.exit("Passe os gamertags como argumentos ou crie skins/players.txt (um por linha).")
    return [line.strip() for line in listing.read_text(encoding="utf-8").splitlines() if line.strip() and not line.startswith("#")]


def main() -> None:
    AUTO.mkdir(parents=True, exist_ok=True)
    found = missing = 0
    for entry in read_players(sys.argv[1:]):
        java = entry.lower().startswith("java:")
        name = entry[5:].strip() if java else entry
        manual = [p for p in (SKINS / f"{name}.png", SKINS / f"{name}.slim.png") if p.exists()]
        if manual:
            print(f"  = {name}: usando a skin colocada à mão ({manual[0].name})")
            found += 1
            continue
        try:
            result = fetch_java(name) if java else fetch_bedrock(name)
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"  ! {name}: erro de rede ({e}); mantendo a skin baixada antes, se houver")
            continue
        size = png_size(result[0]) if result else None
        if not result or size not in {(64, 64), (64, 32), (128, 128), (128, 64)}:
            print(f"  x {name}: skin não encontrada" + (" na GeyserMC (o jogador nunca entrou num servidor com Geyser)" if not java else " no Java"))
            missing += 1
            continue
        png, slim = result
        for old in AUTO.glob("*.png"):
            if old.name.lower() in (f"{name.lower()}.png", f"{name.lower()}.slim.png"):
                old.unlink()
        (AUTO / f"{name}{'.slim' if slim else ''}.png").write_bytes(png)
        print(f"  ✓ {name}: {size[0]}x{size[1]}{' (slim)' if slim else ''}")
        found += 1

    print(f"\n{found} skin(s) prontas, {missing} não encontrada(s) (essas aparecem como Steve).\n")
    subprocess.run([sys.executable, str(ROOT / "tools" / "sync_skins.py")], check=True)
    subprocess.run([sys.executable, str(ROOT / "tools" / "build.py")], check=True)


if __name__ == "__main__":
    main()
