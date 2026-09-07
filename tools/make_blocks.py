#!/usr/bin/env python3
"""Gera as definições dos blocos dos corpos celestes.

Um bloco custom no Bedrock precisa de quatro coisas espalhadas em dois packs:
o JSON de comportamento (BP/blocks), a entrada em blocks.json (RP), a entrada
em terrain_texture.json (RP) e o nome em texts/*.lang. Escrever isso à mão pra
14 blocos é convite a um deles ficar pra trás e o bloco virar cubo roxo.

Aqui a fonte é a tabela BLOCKS abaixo e os quatro arquivos saem dela.
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "Space Dimension BP")
RP = os.path.join(ROOT, "packs", "Space Dimension RP")

FORMAT_VERSION = "1.21.80"

# id curto -> (textura, cor no mapa, luz emitida, dureza, nome pt, nome en)
#
# A luz do Sol: os blocos dele iluminam de verdade, senão uma esfera de 200
# blocos no vácuo escuro vira uma silhueta preta. A mancha solar emite menos,
# que é o ponto dela.
BLOCKS = {
    "sun_plasma":    ("sun_plasma",    "#FCA130", 14, 2.0, "Plasma Solar",        "Solar Plasma"),
    "sun_flare":     ("sun_flare",     "#FEF0B7", 15, 2.0, "Labareda Solar",      "Solar Flare"),
    "sun_spot":      ("sun_spot",      "#53260C",  6, 2.5, "Mancha Solar",        "Sunspot"),

    "earth_ocean":   ("earth_ocean",   "#0E3375",  0, 1.2, "Oceano Profundo",     "Deep Ocean"),
    "earth_shallow": ("earth_shallow", "#2582B0",  0, 1.2, "Água Rasa",           "Shallow Water"),
    "earth_land":    ("earth_land",    "#3D7130",  0, 1.0, "Continente",          "Continent"),
    "earth_desert":  ("earth_desert",  "#B9925A",  0, 1.0, "Deserto",             "Desert"),
    "earth_ice":     ("earth_ice",     "#E7F1F9",  0, 1.0, "Calota Polar",        "Polar Ice Cap"),

    "moon_regolith": ("moon_regolith", "#9F9D99",  0, 1.4, "Regolito Lunar",      "Lunar Regolith"),
    "moon_highland": ("moon_highland", "#C4C1BB",  0, 1.4, "Terras Altas Lunares", "Lunar Highlands"),
    "moon_mare":     ("moon_mare",     "#4F4F54",  0, 1.8, "Mar Lunar",           "Lunar Mare"),

    "mars_dust":     ("mars_dust",     "#B86536",  0, 1.2, "Poeira Marciana",     "Martian Dust"),
    "mars_rock":     ("mars_rock",     "#733824",  0, 1.8, "Rocha Marciana",      "Martian Rock"),
    "mars_ice":      ("mars_ice",      "#EBE2DC",  0, 1.0, "Gelo Marciano",       "Martian Ice"),
}

NS = "space_dim"


def texture_key(short):
    return f"{NS}_{short}"


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def main():
    # --- 1. BP: um JSON por bloco --------------------------------------------
    block_dir = os.path.join(BP, "blocks")
    for short, (tex, map_color, light, hardness, _pt, _en) in BLOCKS.items():
        components = {
            "minecraft:geometry": "minecraft:geometry.full_block",
            "minecraft:material_instances": {
                "*": {
                    "texture": texture_key(short),
                    "render_method": "opaque",
                    "ambient_occlusion": True,
                    "face_dimming": True,
                }
            },
            "minecraft:destructible_by_mining": {"seconds_to_destroy": hardness},
            "minecraft:destructible_by_explosion": {"explosion_resistance": 15},
            "minecraft:map_color": map_color,
            "minecraft:friction": 0.6,
        }
        if light:
            components["minecraft:light_emission"] = light

        write_json(
            os.path.join(block_dir, f"{short}.json"),
            {
                "format_version": FORMAT_VERSION,
                "minecraft:block": {
                    "description": {
                        "identifier": f"{NS}:{short}",
                        "menu_category": {"category": "nature"},
                    },
                    "components": components,
                },
            },
        )

    # --- 2. RP: blocks.json ---------------------------------------------------
    blocks_json = {"format_version": [1, 1, 0]}
    for short in BLOCKS:
        blocks_json[f"{NS}:{short}"] = {
            "textures": texture_key(short),
            "sound": "stone",
        }
    write_json(os.path.join(RP, "blocks.json"), blocks_json)

    # --- 3. RP: terrain_texture.json -----------------------------------------
    write_json(
        os.path.join(RP, "textures", "terrain_texture.json"),
        {
            "resource_pack_name": NS,
            "texture_name": "atlas.terrain",
            "padding": 8,
            "num_mip_levels": 4,
            "texture_data": {
                texture_key(short): {
                    "textures": f"textures/{NS}/blocks/{BLOCKS[short][0]}"
                }
                for short in BLOCKS
            },
        },
    )

    # --- 4. Nomes nos .lang ---------------------------------------------------
    # Reescreve só o bloco marcado, pra não perder as linhas escritas à mão.
    MARK = "## blocos dos corpos celestes (gerado por tools/make_blocks.py)"
    for lang, idx in (("pt_BR", 4), ("en_US", 5), ("en_GB", 5)):
        path = os.path.join(BP, "texts", f"{lang}.lang")
        existing = ""
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as f:
                existing = f.read().split(MARK)[0].rstrip("\n")
        lines = [existing, "", MARK]
        for short, spec in BLOCKS.items():
            lines.append(f"tile.{NS}:{short}.name={spec[idx]}")
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    print(f"{len(BLOCKS)} blocos gerados:")
    print(f"  BP/blocks/*.json")
    print(f"  RP/blocks.json")
    print(f"  RP/textures/terrain_texture.json")
    print(f"  BP/texts/{{pt_BR,en_US,en_GB}}.lang")


if __name__ == "__main__":
    main()
