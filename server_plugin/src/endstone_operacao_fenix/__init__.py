"""Plugin Endstone da Operação Fênix.

O Bedrock não deixa add-ons lerem a skin dos jogadores, mas o servidor recebe
essa skin quando o jogador entra. Este plugin guarda a skin de cada jogador e
a escreve no resource pack da Operação Fênix, para que o corpo no chão e o
clone dentro da cápsula usem a skin real.

Os jogadores baixam o resource pack ao entrar e o servidor lê os packs ao
iniciar. Por isso uma skin nova ou trocada aparece depois do próximo reinício
do servidor.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from endstone import Player
from endstone.event import PlayerJoinEvent, PlayerSkinChangeEvent, event_handler
from endstone.plugin import Plugin

from .packs import MAX_SKINS, VANILLA, SkinEntry, bump_version, encode_png, legacy_to_modern, write_packs

__all__ = ["OperacaoFenixPlugin"]

SUPPORTED_SIZES = {(64, 32), (64, 64), (128, 64), (128, 128)}


def _to_rgba(image) -> tuple[int, int, bytes] | None:
    """Converte a imagem do Endstone (numpy HxWx4) em (largura, altura, bytes RGBA)."""
    data = bytes(image.tobytes()) if hasattr(image, "tobytes") else bytes(image)
    shape = getattr(image, "shape", None)
    if shape is not None and len(shape) == 3 and shape[2] == 4:
        return int(shape[1]), int(shape[0]), data
    for w, h in sorted(SUPPORTED_SIZES):
        if len(data) == w * h * 4:
            return w, h, data
    return None


def _is_slim(w: int, px: bytes) -> bool:
    """Modelo slim (Alex) deixa transparente a última coluna das costas do braço."""
    s = w // 64
    x, y = 55 * s, 20 * s
    return px[(y * w + x) * 4 + 3] == 0


class OperacaoFenixPlugin(Plugin):
    api_version = "0.11"
    description = "Corpo e clone da Operação Fênix com a skin real de cada jogador."

    def on_load(self) -> None:
        self.data_folder.mkdir(parents=True, exist_ok=True)
        (self.data_folder / "skins").mkdir(exist_ok=True)
        self.registry_path = self.data_folder / "registry.json"
        self.registry: dict[str, dict] = self._load_registry()
        self.pending_restart: set[str] = set()
        # Reaplica as skins guardadas (por exemplo depois de atualizar o add-on).
        self.apply()

    def on_enable(self) -> None:
        self.register_events(self)
        if self.find_packs()[1] is None:
            self.logger.warning("Resource pack da Operação Fênix não encontrado. As skins só serão guardadas.")

    # ---- registro ------------------------------------------------------------

    def _load_registry(self) -> dict[str, dict]:
        if not self.registry_path.exists():
            return {}
        try:
            return json.loads(self.registry_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            self.logger.error(f"registry.json inválido, começando do zero: {e}")
            return {}

    def _save_registry(self) -> None:
        self.registry_path.write_text(json.dumps(self.registry, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    def capture(self, player: Player, skin) -> None:
        converted = _to_rgba(skin.image)
        if converted is None or (converted[0], converted[1]) not in SUPPORTED_SIZES:
            size = f"{converted[0]}x{converted[1]}" if converted else "desconhecido"
            self.logger.info(f"Skin de {player.name} ({size}) não é do modelo clássico; o corpo usará o Steve.")
            return
        w, h, px = converted
        if h * 2 == w:
            w, h, px = legacy_to_modern(w, h, px)
        digest = hashlib.sha1(px).hexdigest()

        key = player.name.lower()
        entry = self.registry.get(key)
        if entry and entry["hash"] == digest:
            return
        if entry is None:
            used = {e["index"] for e in self.registry.values()}
            index = next((i for i in range(len(VANILLA), MAX_SKINS) if i not in used), None)
            if index is None:
                self.logger.error("Limite de skins atingido; remova jogadores antigos de registry.json.")
                return
            entry = {"index": index}
        entry.update(name=player.name, slim=_is_slim(w, px), hash=digest)
        self.registry[key] = entry
        (self.data_folder / "skins" / f"{entry['index']}.png").write_bytes(encode_png(w, h, px))
        self._save_registry()

        if self.apply():
            self.pending_restart.add(key)
            self.logger.info(f"Skin de {player.name} registrada (slim={entry['slim']}). Vale após reiniciar o servidor.")
            player.send_message(
                "§7[§bOperação Fênix§7] Sua skin foi registrada. Ela aparece no seu corpo e no seu clone "
                "depois que o servidor reiniciar."
            )

    # ---- packs -----------------------------------------------------------------

    def server_root(self) -> Path:
        # plugins/<nome>/ fica dentro da pasta do servidor.
        return self.data_folder.resolve().parent.parent

    def world_dirs(self) -> list[Path]:
        worlds = self.server_root() / "worlds"
        return [d for d in worlds.iterdir() if d.is_dir()] if worlds.exists() else []

    def find_packs(self) -> tuple[Path | None, Path | None]:
        """Procura as pastas instaladas dos packs pelo conteúdo delas."""
        root = self.server_root()
        bases = [root / "behavior_packs", root / "development_behavior_packs"]
        bases += [root / "resource_packs", root / "development_resource_packs"]
        for world in self.world_dirs():
            bases += [world / "behavior_packs", world / "resource_packs"]
        bp = rp = None
        for base in bases:
            if not base.exists():
                continue
            for d in base.iterdir():
                if bp is None and (d / "entities" / "fenix_capsule.json").exists():
                    bp = d
                if rp is None and (d / "entity" / "fenix_capsule.entity.json").exists():
                    rp = d
        return bp, rp

    def apply(self) -> bool:
        """Escreve as skins guardadas no add-on. Retorna True se o resource pack mudou."""
        bp, rp = self.find_packs()
        if rp is None or bp is None:
            return False
        entries = []
        for key, e in self.registry.items():
            png = self.data_folder / "skins" / f"{e['index']}.png"
            if png.exists():
                entries.append(SkinEntry(name=key, index=e["index"], slim=e["slim"], png=png.read_bytes()))
        if not write_packs(bp, rp, entries):
            return False
        state_path = self.data_folder / "pack_version.json"
        last = json.loads(state_path.read_text()) if state_path.exists() else 0
        version = bump_version(rp, bp, self.world_dirs(), min_patch=last)
        state_path.write_text(json.dumps(version[2]))
        self.logger.info(f"Resource pack da Operação Fênix atualizado para {'.'.join(map(str, version))}.")
        return True

    # ---- eventos ---------------------------------------------------------------

    @event_handler
    def on_player_join(self, event: PlayerJoinEvent) -> None:
        self.capture(event.player, event.player.skin)

    @event_handler
    def on_skin_change(self, event: PlayerSkinChangeEvent) -> None:
        self.capture(event.player, event.new_skin)
