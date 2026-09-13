"""Auditoria de peso em execucao (o que causa lag, nao so tamanho de arquivo).

Tamanho de download e uma coisa; FPS e outra. Este modulo procura os padroes
que realmente derrubam o desempenho de um addon de Bedrock: texturas em
resolucao muito acima do necessario, loops de script por tick, entidades com
pilhas grandes de comportamento, particulas de taxa alta e arquivos
duplicados.
"""

from __future__ import annotations

import hashlib
import io
import json
import posixpath
import re

from PIL import Image

# resolucao a partir da qual a textura custa memoria de GPU sem ganho visual
TEXTURE_BUDGET = (
    ("textures/blocks/", 64),
    ("textures/block/", 64),
    ("textures/items/", 64),
    ("textures/item/", 64),
    ("textures/particle/", 128),
    ("textures/entity/", 512),
    ("textures/gui/", 512),
)

_TICK_PATTERNS = (
    (re.compile(r"system\.runInterval\s*\(\s*[^,]+,\s*(\d+)?\s*\)"), "system.runInterval"),
    (re.compile(r"system\.run\s*\("), "system.run (loop recursivo)"),
    (re.compile(r"world\.afterEvents\.tick\.subscribe"), "afterEvents.tick"),
    (re.compile(r"system\.runTimeout\s*\(\s*[^,]+,\s*1\s*\)"), "runTimeout(1)"),
)


def _load_json(blob: bytes):
    try:
        from .jsonmin import minify

        return json.loads(minify(blob.decode("utf-8-sig")))
    except Exception:
        return None


def _budget_for(path: str) -> int | None:
    lowered = path.lower()
    for prefix, limit in TEXTURE_BUDGET:
        if prefix in lowered:
            return limit
    return None


def analyze(files: dict[str, bytes]) -> dict:
    """`files` mapeia caminho completo (com prefixo de pacote) -> bytes."""
    report = {
        "oversized_textures": [],
        "duplicates": [],
        "tick_scripts": [],
        "heavy_entities": [],
        "hot_particles": [],
        "counts": {"entities": 0, "blocks": 0, "items": 0, "particles": 0,
                   "textures": 0, "sounds": 0, "scripts": 0, "json": 0},
        "bytes_by_kind": {},
    }
    digests: dict[str, list[str]] = {}

    for path, blob in files.items():
        lowered = path.lower()
        ext = posixpath.splitext(lowered)[1]
        report["bytes_by_kind"][ext] = report["bytes_by_kind"].get(ext, 0) + len(blob)
        digests.setdefault(hashlib.sha1(blob).hexdigest(), []).append(path)

        if ext == ".png":
            report["counts"]["textures"] += 1
            budget = _budget_for(lowered)
            try:
                with Image.open(io.BytesIO(blob)) as im:
                    width, height = im.size
            except Exception:
                continue
            if budget and width > budget:
                # flipbooks sao tiras verticais: o lado curto e o que conta
                side = min(width, height) if height > width else width
                if side > budget:
                    report["oversized_textures"].append(
                        {"path": path, "size": f"{width}x{height}",
                         "budget": budget, "bytes": len(blob)}
                    )
        elif ext in (".ogg", ".wav", ".mp3", ".fsb"):
            report["counts"]["sounds"] += 1
        elif ext in (".js", ".ts", ".mjs"):
            report["counts"]["scripts"] += 1
            try:
                text = blob.decode("utf-8", "replace")
            except Exception:
                continue
            hits = []
            for pattern, label in _TICK_PATTERNS:
                found = pattern.findall(text)
                if found:
                    hits.append(f"{label} x{len(found)}")
            if hits:
                report["tick_scripts"].append({"path": path, "hits": hits})
        elif ext == ".json":
            report["counts"]["json"] += 1
            data = _load_json(blob)
            if not isinstance(data, dict):
                continue

            if "minecraft:entity" in data:
                report["counts"]["entities"] += 1
                entity = data["minecraft:entity"]
                components = entity.get("components", {}) or {}
                groups = entity.get("component_groups", {}) or {}
                behaviors = [k for k in components if k.startswith("minecraft:behavior.")]
                identifier = (entity.get("description", {}) or {}).get("identifier", path)
                sensors = [k for k in components if "sensor" in k or "detect" in k]
                if len(behaviors) >= 12 or len(groups) >= 25 or len(sensors) >= 4:
                    report["heavy_entities"].append(
                        {"path": path, "id": identifier, "behaviors": len(behaviors),
                         "groups": len(groups), "sensors": len(sensors)}
                    )
            elif "minecraft:block" in data:
                report["counts"]["blocks"] += 1
            elif "minecraft:item" in data:
                report["counts"]["items"] += 1
            elif "particle_effect" in data:
                report["counts"]["particles"] += 1
                effect = data["particle_effect"]
                components = effect.get("components", {}) or {}
                rate = components.get("minecraft:emitter_rate_steady", {}) or {}
                per_second = rate.get("spawn_rate")
                maximum = rate.get("max_particles")
                try:
                    if (isinstance(per_second, (int, float)) and per_second > 50) or (
                        isinstance(maximum, (int, float)) and maximum > 500
                    ):
                        report["hot_particles"].append(
                            {"path": path, "spawn_rate": per_second, "max": maximum}
                        )
                except Exception:
                    pass

    for digest, paths in digests.items():
        if len(paths) > 1:
            wasted = len(files[paths[0]]) * (len(paths) - 1)
            if wasted >= 4096:
                report["duplicates"].append({"paths": sorted(paths), "wasted": wasted})

    report["oversized_textures"].sort(key=lambda d: -d["bytes"])
    report["duplicates"].sort(key=lambda d: -d["wasted"])
    return report
