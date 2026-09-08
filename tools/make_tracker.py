#!/usr/bin/env python3
"""Rastreador estelar: ícones no atlas, nomes e a receita.

Fica separado dos outros geradores porque o rastreador é o começo de um sistema
que vai crescer: cada sistema estelar novo traz um mapa estelar, e um mapa novo
é uma linha em CHARTS aqui — item, ícone, nome e loot saem sozinhos.

Não depende de rodar depois de ninguém: mescla no item_texture.json e troca só
o seu bloco do .lang (tools/langfile.py).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from langfile import replace_section  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "Distant Horizons BP")
RP = os.path.join(ROOT, "packs", "Distant Horizons RP")
NS = "space_dim"

# O aparelho, e um mapa por sistema estelar. O id do item TEM que ser
# `star_chart_<id do sistema>`: é assim que starCharts.js sabe o que abrir, sem
# uma segunda tabela pra manter em dia.
DEVICE = dict(name="tracker", icon="tracker",
              pt="Rastreador Estelar", en="Star Tracker")

CHARTS = {
    # sistema  →  nome do mapa
    "sol": dict(pt="Mapa Estelar: Sistema Solar", en="Star Chart: Solar System"),
}


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def main():
    names = {DEVICE["name"]: (DEVICE["pt"], DEVICE["en"])}
    icons = {DEVICE["name"]: DEVICE["icon"]}
    for system_id, spec in CHARTS.items():
        item = f"star_chart_{system_id}"
        names[item] = (spec["pt"], spec["en"])
        # Todos os mapas dividem um ícone só: são o mesmo papel, o que muda é
        # o que está escrito nele.
        icons[item] = "star_chart"

    # --- atlas de itens ------------------------------------------------------
    path = os.path.join(RP, "textures", "item_texture.json")
    doc = json.load(open(path, encoding="utf-8")) if os.path.isfile(path) else {
        "resource_pack_name": NS, "texture_name": "atlas.items", "texture_data": {},
    }
    for item, icon in icons.items():
        doc["texture_data"][f"{NS}_{icon}"] = {"textures": f"textures/{NS}/items/{icon}"}
    write_json(path, doc)

    # --- receita do aparelho -------------------------------------------------
    # Uma bússola que aprendeu a olhar pra cima. Barata de propósito: é
    # navegação, não recompensa — quem chega ao espaço sem ela fica perdido.
    write_json(
        os.path.join(BP, "recipes", "tracker.json"),
        {
            "format_version": "1.12",
            "minecraft:recipe_shaped": {
                "description": {"identifier": f"{NS}:tracker"},
                "tags": ["crafting_table"],
                "pattern": ["IGI", "GCG", "IRI"],
                "key": {
                    "I": {"item": "minecraft:iron_ingot"},
                    "G": {"item": "minecraft:glass"},
                    "C": {"item": "minecraft:compass"},
                    "R": {"item": "minecraft:redstone"},
                },
                "result": {"item": f"{NS}:tracker", "count": 1},
            },
        },
    )

    # --- nomes ---------------------------------------------------------------
    MARK = "## rastreador estelar (gerado por tools/make_tracker.py)"
    for lang, idx in (("pt_BR", 0), ("en_US", 1), ("en_GB", 1)):
        replace_section(
            os.path.join(RP, "texts", f"{lang}.lang"), MARK,
            [f"item.{NS}:{item}={pair[idx]}" for item, pair in names.items()],
        )

    print(f"rastreador + {len(CHARTS)} mapa(s) estelar(es): {', '.join(CHARTS)}")


if __name__ == "__main__":
    main()
