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
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from langfile import replace_section  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "Distant Horizons BP")
RP = os.path.join(ROOT, "packs", "Distant Horizons RP")

FORMAT_VERSION = "1.21.80"

# Um registro por bloco. `solid=False` tira a colisão: o jogador atravessa.
#
# O Sol é atravessável — coroa e plasma são casca sem colisão, e por dentro
# delas há vácuo até a camada seguinte. Só o núcleo é sólido, pra quem
# conseguir chegar lá ter onde pousar. Os três emitem luz 15: no vácuo preto,
# sem isso o Sol seria uma silhueta.
#
# `light_dampening=0` nos blocos do Sol deixa a luz atravessar as cascas, senão
# o miolo dele ficaria escuro apesar de tudo em volta brilhar.
#
# Os blocos dos PLANETAS emitem luz baixa (BODY_LIGHT). Não é pra eles serem
# lâmpadas: é que a dimensão do espaço não tem luz de céu nenhuma, então sem
# isso a superfície de um planeta é preta e não se enxerga nada em cima dele.
# Com emissão baixa o corpo aparece iluminado — que é o que se espera de um
# corpo recebendo luz do Sol. O preço, assumido: o lado de trás também aparece
# iluminado, porque luz de bloco não tem direção.
BODY_LIGHT = 6

def block(texture, map_color, pt, en, light=BODY_LIGHT, hardness=1.2, solid=True, dampening=None):
    return {
        "texture": texture,
        "map_color": map_color,
        "light": light,
        "hardness": hardness,
        "solid": solid,
        "dampening": dampening,
        "pt": pt,
        "en": en,
    }


BLOCKS = {
    # --- Sol: atravessável, luminoso ----------------------------------------
    "sun_corona": block("sun_corona", "#F05914", "Coroa Solar", "Solar Corona",
                        light=15, hardness=2.0, solid=False, dampening=0),
    "sun_plasma": block("sun_plasma", "#FFDF64", "Plasma Solar", "Solar Plasma",
                        light=15, hardness=2.0, solid=False, dampening=0),
    "sun_core":   block("sun_core", "#FFFDF1", "Núcleo Solar", "Solar Core",
                        light=15, hardness=4.0, solid=True, dampening=0),
    # O branco da SUPERFÍCIE, separado do branco do NÚCLEO.
    #
    # Os dois têm a mesma cor e papéis opostos: `sun_core` é o chão maciço lá no
    # meio do Sol, e este aqui é o miolo claro da casca externa, que tem que ser
    # atravessável. Pintar a superfície com `sun_core` fechou a primeira camada
    # do Sol — dava pra encostar, não pra entrar.
    "sun_blaze":  block("sun_blaze", "#FFFDF1", "Clarão Solar", "Solar Blaze",
                        light=15, hardness=2.0, solid=False, dampening=0),
    # Os tons intermediários existem por um motivo só: dar ao disco do Sol o
    # degradê da referência. Com três blocos ele saía em faixas duras; com seis,
    # a passagem do branco ao vermelho se lê como um degradê.
    "sun_flare":  block("sun_flare", "#FEEC9A", "Fulgor Solar", "Solar Flare",
                        light=15, hardness=2.0, solid=False, dampening=0),
    "sun_ember":  block("sun_ember", "#FFA123", "Brasa Solar", "Solar Ember",
                        light=15, hardness=2.0, solid=False, dampening=0),
    "sun_edge":   block("sun_edge", "#AA300B", "Borda Solar", "Solar Edge",
                        light=15, hardness=2.0, solid=False, dampening=0),

    # --- Terra ---------------------------------------------------------------
    "earth_ocean":   block("earth_ocean", "#063E93", "Oceano Profundo", "Deep Ocean"),
    "earth_shallow": block("earth_shallow", "#056C91", "Água Rasa", "Shallow Water"),
    "earth_land":    block("earth_land", "#038500", "Continente", "Continent", hardness=1.0),
    "earth_forest":  block("earth_forest", "#026002", "Floresta", "Forest", hardness=1.0),
    "earth_ice":     block("earth_ice", "#E8EFFA", "Calota Polar", "Polar Ice Cap", hardness=1.0),

    # --- Lua: os tons são BLOCOS separados, não buraco desenhado na textura ---
    "moon_regolith_light": block("moon_regolith_light", "#CAD4EB",
                                 "Regolito Claro", "Light Regolith", hardness=1.4),
    "moon_regolith":       block("moon_regolith", "#99A1B3",
                                 "Regolito Lunar", "Lunar Regolith", hardness=1.4),
    "moon_regolith_dark":  block("moon_regolith_dark", "#555B6E",
                                 "Regolito Escuro", "Dark Regolith", hardness=1.8),

    # --- Marte ---------------------------------------------------------------
    "mars_dust":      block("mars_dust", "#BA4E2A", "Poeira Marciana", "Martian Dust"),
    "mars_rock":      block("mars_rock", "#923D22", "Rocha Marciana", "Martian Rock", hardness=1.8),
    "mars_rock_dark": block("mars_rock_dark", "#501E10", "Basalto Marciano", "Martian Basalt", hardness=1.8),
    "mars_ice":       block("mars_ice", "#E2D7CF", "Gelo Marciano", "Martian Ice", hardness=1.0),
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
    for short, spec in BLOCKS.items():
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
            "minecraft:destructible_by_mining": {"seconds_to_destroy": spec["hardness"]},
            "minecraft:destructible_by_explosion": {"explosion_resistance": 15},
            "minecraft:map_color": spec["map_color"],
            "minecraft:friction": 0.6,
        }
        if spec["light"]:
            components["minecraft:light_emission"] = spec["light"]
        if spec["dampening"] is not None:
            components["minecraft:light_dampening"] = spec["dampening"]
        if not spec["solid"]:
            # Sem caixa de colisão o jogador atravessa. A caixa de SELEÇÃO fica,
            # senão o bloco não dá pra mirar nem quebrar.
            components["minecraft:collision_box"] = False

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
                    "textures": f"textures/{NS}/blocks/{BLOCKS[short]['texture']}"
                }
                for short in BLOCKS
            },
        },
    )

    # --- 4. Nomes nos .lang ---------------------------------------------------
    # Reescreve só o bloco marcado, pra não perder as linhas escritas à mão.
    MARK = "## blocos dos corpos celestes (gerado por tools/make_blocks.py)"
    for lang, key in (("pt_BR", "pt"), ("en_US", "en"), ("en_GB", "en")):
        replace_section(
            os.path.join(RP, "texts", f"{lang}.lang"), MARK,
            [f"tile.{NS}:{short}.name={spec[key]}" for short, spec in BLOCKS.items()],
        )

    print(f"{len(BLOCKS)} blocos gerados:")
    print(f"  BP/blocks/*.json")
    print(f"  RP/blocks.json")
    print(f"  RP/textures/terrain_texture.json")
    print(f"  RP/texts/{{pt_BR,en_US,en_GB}}.lang")


if __name__ == "__main__":
    main()
