"""Gera os arquivos do add-on que desenham o corpo e o clone com a skin de cada jogador.

Usado pelo plugin do servidor (skins capturadas automaticamente) e por
tools/sync_skins.py (skins colocadas à mão na pasta skins/). Só usa a
biblioteca padrão do Python.
"""

from __future__ import annotations

import json
import shutil
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path

# Índices 0 e 1 são sempre as skins vanilla (quem não tem skin registrada usa o Steve).
VANILLA = [("textures/entity/steve", False), ("textures/entity/alex", True)]
MAX_SKINS = 256
SKIN_DIR = Path("textures/entity/fenix/skins")


@dataclass
class SkinEntry:
    name: str  # gamertag
    index: int
    slim: bool
    png: bytes


def encode_png(width: int, height: int, rgba: bytes) -> bytes:
    """Codifica pixels RGBA (8 bits por canal) como PNG."""
    stride = width * 4
    raw = b"".join(b"\x00" + rgba[y * stride : (y + 1) * stride] for y in range(height))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def decode_png(data: bytes) -> tuple[int, int, bytes] | None:
    """Lê um PNG RGB/RGBA de 8 bits sem entrelaçamento. Retorna (largura, altura, RGBA)."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    pos, idat, w = 8, b"", 0
    h = color = depth = interlace = 0
    while pos < len(data):
        length = int.from_bytes(data[pos : pos + 4], "big")
        tag, body = data[pos + 4 : pos + 8], data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if tag == b"IHDR":
            w, h, depth, color, _, _, interlace = struct.unpack(">IIBBBBB", body)
        elif tag == b"IDAT":
            idat += body
        elif tag == b"IEND":
            break
    if depth != 8 or interlace or color not in (2, 6):
        return None
    bpp = 4 if color == 6 else 3
    raw, stride = zlib.decompress(idat), w * bpp
    out, prev, i = bytearray(), bytearray(stride), 0
    for _ in range(h):
        ftype, line = raw[i], bytearray(raw[i + 1 : i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if ftype == 1:
                line[x] = (line[x] + a) & 0xFF
            elif ftype == 2:
                line[x] = (line[x] + b) & 0xFF
            elif ftype == 3:
                line[x] = (line[x] + (a + b) // 2) & 0xFF
            elif ftype == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 0xFF
        prev = line
        if bpp == 4:
            out += line
        else:
            for x in range(w):
                out += line[x * 3 : x * 3 + 3] + b"\xff"
    return w, h, bytes(out)


def legacy_to_modern(w: int, h: int, px: bytes) -> tuple[int, int, bytes]:
    """Skins antigas (64x32) não têm braço/perna esquerdos: copia os direitos."""
    if h * 2 != w:
        return w, h, px
    s = w // 64
    out = bytearray(w * w * 4)
    out[: len(px)] = px

    def copy(sx, sy, dx, dy, cw, ch):
        for y in range(ch * s):
            src = ((sy * s + y) * w + sx * s) * 4
            dst = ((dy * s + y) * w + dx * s) * 4
            out[dst : dst + cw * s * 4] = px[src : src + cw * s * 4]

    copy(0, 16, 16, 48, 16, 16)  # perna direita -> esquerda
    copy(40, 16, 32, 48, 16, 16)  # braço direito -> esquerdo
    return w, w, bytes(out)


def normalize_png(data: bytes) -> bytes:
    """Converte skins antigas (64x32) para o formato 64x64 que o modelo do corpo usa."""
    decoded = decode_png(data)
    if decoded is None or decoded[1] * 2 != decoded[0]:
        return data
    return encode_png(*legacy_to_modern(*decoded))


def _json(data) -> bytes:
    return (json.dumps(data, indent=2, ensure_ascii=False) + "\n").encode()


# Cópias dos controllers vanilla do jogador (bedrock-samples 1.26.50.4) usadas quando ele
# está no clone de outro jogador: mesma lógica, mas com a skin e o modelo do dono do clone.
_ARMOR_VISIBILITY = [
    {"*": True},
    {"helmet": "variable.helmet_layer_visible"},
    {"leftLegging": "variable.leg_layer_visible"},
    {"rightLegging": "variable.leg_layer_visible"},
    {"leftBoot": "variable.boot_layer_visible"},
    {"rightBoot": "variable.boot_layer_visible"},
    {"leftSock": "variable.boot_layer_visible && variable.leg_layer_visible"},
    {"rightSock": "variable.boot_layer_visible && variable.leg_layer_visible"},
    {"bodyArmor": "variable.chest_layer_visible"},
    {"leftArmArmor": "variable.chest_layer_visible"},
    {"rightArmArmor": "variable.chest_layer_visible"},
    {"belt": "variable.chest_layer_visible && variable.leg_layer_visible"},
]
_EMPTY_HAND = "query.get_equipped_item_name(0, 1) == '' || query.get_equipped_item_name(0, 1) == 'filled_map'"
_LEFT_ARM = (
    "(query.get_equipped_item_name(0, 1) == 'filled_map' && query.get_equipped_item_name('off_hand') != 'shield') || "
    "(query.get_equipped_item_name('off_hand') == 'filled_map' && !query.item_is_charged) || "
    "(!query.item_is_charged && (variable.item_use_normalized > 0 && variable.item_use_normalized < 1.0))"
)
_FIRST_PERSON_VISIBILITY = [
    {"*": False},
    {"rightArm": _EMPTY_HAND},
    {"rightSleeve": _EMPTY_HAND},
    {"leftArm": _LEFT_ARM},
    {"leftSleeve": _LEFT_ARM},
]
_MAP_VISIBILITY = [{"*": False}, {"head": True}, {"hat": True}, {"helmet": True}]


def _disguise_controllers(skin_array: list[str], top: int) -> dict:
    arrays = {
        "geometries": {"Array.fenix_bodies": ["Geometry.fenix_wide", "Geometry.fenix_slim"]},
        "textures": {"Array.skins": skin_array},
    }
    base = {
        "arrays": arrays,
        "geometry": "Array.fenix_bodies[q.property('fenix:disguise_slim') ? 1 : 0]",
        "materials": [{"*": "Material.default"}],
        "textures": [f"Array.skins[math.clamp(q.property('fenix:disguise') - 1, 0, {top})]"],
    }
    return {
        "controller.render.fenix.disguise.first_person": {**base, "part_visibility": _FIRST_PERSON_VISIBILITY},
        "controller.render.fenix.disguise.third_person": {**base, "part_visibility": _ARMOR_VISIBILITY},
        "controller.render.fenix.disguise.map": {**base, "part_visibility": _MAP_VISIBILITY},
    }


def _player_entity(rp: Path, textures: dict[str, str]) -> bytes | None:
    """player.entity.json do pack com a lista de skins atualizada (as skins do disfarce)."""
    path = rp / "entity" / "player.entity.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    desc = data["minecraft:client_entity"]["description"]
    keep = {k: v for k, v in desc["textures"].items() if not k.startswith("skin_")}
    desc["textures"] = {**keep, **textures}
    return _json(data)


def _render_files(entries: list[SkinEntry], rp: Path | None = None) -> dict[Path, bytes]:
    """Arquivos gerados, relativos à raiz do resource pack (RP/) ou do behavior pack (BP/)."""
    top = max([len(VANILLA) - 1] + [e.index for e in entries])
    textures: dict[str, str] = {}
    for i in range(top + 1):
        textures[f"skin_{i}"] = VANILLA[i][0] if i < len(VANILLA) else VANILLA[0][0]
    for e in entries:
        textures[f"skin_{e.index}"] = (SKIN_DIR / f"skin_{e.index}").as_posix()

    skin_array = [f"Texture.skin_{i}" for i in range(top + 1)]
    bodies = {"Array.bodies": ["Geometry.body", "Geometry.body_slim"]}
    body_geometry = "Array.bodies[q.property('fenix:slim') ? 1 : 0]"
    skin_texture = f"Array.skins[math.clamp(q.property('fenix:skin'), 0, {top})]"
    body_geometries = {"body": "geometry.fenix_body", "body_slim": "geometry.fenix_body_slim"}

    render_controllers = {
        "format_version": "1.10.0",
        "render_controllers": {
            "controller.render.fenix.capsule": {
                "geometry": "Geometry.capsule",
                "textures": ["Texture.capsule"],
                "materials": [{"*": "Material.default"}, {"capsule": "Material.glass"}],
            },
            "controller.render.fenix.panel": {
                "geometry": "Geometry.default",
                "textures": ["Texture.default"],
                "materials": [{"*": "Material.default"}],
            },
            "controller.render.fenix.occupant": {
                "arrays": {"geometries": bodies, "textures": {"Array.skins": skin_array}},
                "geometry": body_geometry,
                "textures": [skin_texture],
                "materials": [{"*": "Material.default"}],
                "part_visibility": [{"*": "q.property('fenix:clone') > 0"}],
            },
            "controller.render.fenix.corpse": {
                "arrays": {"geometries": bodies, "textures": {"Array.skins": skin_array}},
                "geometry": body_geometry,
                "textures": [skin_texture],
                "materials": [{"*": "Material.default"}],
            },
            **_disguise_controllers(skin_array, top),
        },
    }

    capsule = {
        "format_version": "1.10.0",
        "minecraft:client_entity": {
            "description": {
                "identifier": "fenix:capsule",
                "materials": {"default": "entity_alphatest", "glass": "entity_alphablend"},
                "textures": {"capsule": "textures/entity/fenix/capsule", **textures},
                "geometry": {"capsule": "geometry.fenix_capsule", **body_geometries},
                "animations": {"occupant": "animation.fenix.capsule.occupant"},
                "scripts": {"animate": ["occupant"]},
                # O clone é desenhado antes do vidro para aparecer através dele.
                "render_controllers": ["controller.render.fenix.occupant", "controller.render.fenix.capsule"],
            }
        },
    }
    corpse = {
        "format_version": "1.10.0",
        "minecraft:client_entity": {
            "description": {
                "identifier": "fenix:corpse",
                "materials": {"default": "entity_alphatest"},
                "textures": textures,
                "geometry": body_geometries,
                "animations": {"lie": "animation.fenix.corpse.lie"},
                "scripts": {"animate": ["lie"]},
                "render_controllers": ["controller.render.fenix.corpse"],
            }
        },
    }
    panel = {
        "format_version": "1.10.0",
        "minecraft:client_entity": {
            "description": {
                "identifier": "fenix:panel",
                "materials": {"default": "entity_alphatest"},
                "textures": {"default": "textures/entity/fenix/panel"},
                "geometry": {"default": "geometry.fenix_panel"},
                "animations": {"idle": "animation.fenix.panel.idle"},
                "scripts": {"animate": ["idle"]},
                "render_controllers": ["controller.render.fenix.panel"],
            }
        },
    }

    players = {e.name.lower(): {"skin": e.index, "slim": e.slim} for e in sorted(entries, key=lambda e: e.index)}
    skins_js = (
        "// Arquivo gerado (plugin do servidor ou tools/sync_skins.py) — não edite à mão.\n"
        "// Gamertag (minúsculo) -> índice da skin no resource pack.\n"
        f"export const SKINS = {json.dumps(players, indent=2, ensure_ascii=False)};\n"
    ).encode()

    files = {
        Path("RP/render_controllers/fenix.render_controllers.json"): _json(render_controllers),
        Path("RP/entity/fenix_capsule.entity.json"): _json(capsule),
        Path("RP/entity/fenix_corpse.entity.json"): _json(corpse),
        Path("RP/entity/fenix_panel.entity.json"): _json(panel),
        Path("BP/scripts/skins.js"): skins_js,
    }
    player = _player_entity(rp, textures) if rp is not None else None
    if player is not None:
        files[Path("RP/entity/player.entity.json")] = player
    for e in entries:
        files[Path("RP") / SKIN_DIR / f"skin_{e.index}.png"] = e.png
    return files


def write_packs(bp: Path, rp: Path, entries: list[SkinEntry]) -> bool:
    """Escreve as skins e os arquivos gerados nos packs. Retorna True se algo mudou."""
    if len(VANILLA) + len(entries) > MAX_SKINS:
        raise ValueError(f"Máximo de {MAX_SKINS - len(VANILLA)} skins de jogadores.")
    roots = {"BP": bp, "RP": rp}
    wanted = {roots[rel.parts[0]] / Path(*rel.parts[1:]): data for rel, data in _render_files(entries, rp).items()}

    changed = False
    skin_dir = rp / SKIN_DIR
    if skin_dir.exists():
        for old in skin_dir.iterdir():
            if old not in wanted:
                if old.is_dir():
                    shutil.rmtree(old)
                else:
                    old.unlink()
                changed = True
    for path, data in wanted.items():
        if path.exists() and path.read_bytes() == data:
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        changed = True
    return changed


def bump_version(rp: Path, bp: Path | None, world_dirs: list[Path], min_patch: int = 0) -> list[int]:
    """Aumenta a versão do resource pack para os jogadores baixarem as skins novas.

    `min_patch` garante que a versão nunca volte para trás (ex.: add-on reinstalado).
    """
    manifest_path = rp / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    uuid = manifest["header"]["uuid"]
    version = list(manifest["header"]["version"])
    version[2] = max(version[2], min_patch) + 1
    manifest["header"]["version"] = version
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    if bp is not None:
        bp_manifest_path = bp / "manifest.json"
        bp_manifest = json.loads(bp_manifest_path.read_text(encoding="utf-8"))
        for dep in bp_manifest.get("dependencies", []):
            if dep.get("uuid") == uuid:
                dep["version"] = version
        bp_manifest_path.write_text(json.dumps(bp_manifest, indent=2) + "\n", encoding="utf-8")

    for world in world_dirs:
        stack_path = world / "world_resource_packs.json"
        if not stack_path.exists():
            continue
        stack = json.loads(stack_path.read_text(encoding="utf-8"))
        for entry in stack:
            if entry.get("pack_id") == uuid:
                entry["version"] = version
        stack_path.write_text(json.dumps(stack, indent=2) + "\n", encoding="utf-8")
    return version
