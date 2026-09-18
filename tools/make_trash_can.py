#!/usr/bin/env python3
"""Gera a lixeira: bloco com modelo próprio que engole o item clicado nele.

A ARTE É DELE (tools/assets/trash_can.png). O modelo e a textura são remontados
aqui, e por um motivo concreto:

  O .geo.json que veio tem as UVs num espaço de 512x512 apontando pra região
  x 488..512, y 129..167. Na textura de 128x128 que veio junto, essa região é
  TRANSPARENTE — o desenho todo está no canto (0,0)-(67,60). Resultado no jogo:
  as seis faces amostram pixel vazio e o bloco fica invisível. Não é bug de
  código, é modelo e textura de folhas diferentes.

  Então a textura é REMONTADA no desdobramento de caixa do Bedrock, painel por
  painel, a partir dos pedaços que ele desenhou; e o modelo vira um cubo com
  `uv` de caixa, que é o mapeamento que o próprio jogo calcula a partir do
  tamanho do cubo — impossível apontar pro vazio.

O comportamento (clicar com item pra jogar fora) é script: ver trashCan.js.
"""
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from langfile import replace_section  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "Galactic Horizons BP")
RP = os.path.join(ROOT, "packs", "Galactic Horizons RP")
ASSETS = os.path.join(ROOT, "tools", "assets")
NS = "gh"
FORMAT_VERSION = "1.21.80"
RECIPE_FORMAT = "1.12"

BLOCK = f"{NS}:trash_can"
SHORT = "trash_can"
GEO_SRC = "trash_can_src.geo.json"
TEXTURE = "trash_can.png"

# O cubo da lixeira, em unidades de bloco (16 = um bloco). Guarda a proporção
# do modelo dele (20x20x27 ≈ 0,74 : 0,74 : 1) e cabe folgado no bloco.
LARGURA, ALTURA, FUNDO = 12, 12, 14

# Os painéis que ele desenhou na folha, e em que face cada um vai. O topo é o
# vão escuro com lixo dentro — é o que faz o bloco se explicar sozinho.
PAINEIS = {
    "north": (2, 40, 21, 60),      # o emblema redondo, virado pra quem olha
    "south": (27, 28, 47, 55),     # a porta de trás
    "west": (0, 0, 24, 40),        # a lateral comprida, com as nervuras
    "east": (0, 0, 24, 40),
    "up": (48, 1, 67, 19),         # o vão aberto, com o lixo lá dentro
    "down": (0, 0, 24, 40),        # o fundo: a mesma lateral, mais escura
}
ESCURECE = {"down": 0.55}

# A folha que sai daqui: quadrada e potência de dois, como toda textura de
# bloco. O desdobramento ocupa 2*(l+f) por (f+a) — 52x26 — e o resto fica vazio.
FOLHA = 64

PT = "Lixeira"
EN = "Trash Can"

# Receita: só material do Overworld, porque a lixeira é pré-requisito da nave e
# a nave tem que sair daqui de baixo.
RECIPE = {
    "pattern": ["I I", "I I", "III"],
    "key": {"I": {"item": "minecraft:iron_ingot"}},
}


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def caixa_uv(l, a, f):
    """Onde cada face cai na folha, no desdobramento de caixa do Bedrock.

    É a conta que o próprio jogo faz a partir de `uv: [0,0]` e do tamanho do
    cubo. Escrever a mesma conta aqui é o que permite PINTAR cada face no lugar
    certo — e é por isso que o modelo não precisa de UV por face, que foi
    justamente o que apontou pro vazio no arquivo original.
    """
    return {
        "up": (f, 0, l, f),
        "down": (f + l, 0, l, f),
        "west": (0, f, f, a),
        "north": (f, f, l, a),
        "east": (f + l, f, f, a),
        "south": (f + l + f, f, l, a),
    }


def monta_textura(src):
    """A folha de caixa, com um painel dele em cada face."""
    from PIL import Image

    folha = Image.new("RGBA", (FOLHA, FOLHA), (0, 0, 0, 0))
    for face, (u, v, w, h) in caixa_uv(LARGURA, ALTURA, FUNDO).items():
        painel = src.crop(PAINEIS[face]).resize((w, h), Image.NEAREST)
        fator = ESCURECE.get(face)
        if fator:
            px = painel.load()
            for y in range(painel.height):
                for x in range(painel.width):
                    c = px[x, y]
                    px[x, y] = tuple(round(v2 * fator) for v2 in c[:3]) + (c[3],)
        folha.paste(painel, (u, v))
    return folha


def geometria():
    """Um cubo com UV de caixa, assentado no chão e centrado no bloco."""
    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [{
            "description": {
                "identifier": f"geometry.{NS}.{SHORT}",
                "texture_width": FOLHA,
                "texture_height": FOLHA,
                "visible_bounds_width": 2,
                "visible_bounds_height": 2,
                "visible_bounds_offset": [0, 0.5, 0],
            },
            "bones": [{
                "name": SHORT,
                "pivot": [0, 0, 0],
                "cubes": [{
                    "origin": [-LARGURA / 2, 0, -FUNDO / 2],
                    "size": [LARGURA, ALTURA, FUNDO],
                    "uv": [0, 0],
                }],
            }],
        }],
    }


def main():
    from PIL import Image

    doc = geometria()
    geo_id = doc["minecraft:geometry"][0]["description"]["identifier"]
    base = [-LARGURA / 2, 0, -FUNDO / 2]
    tamanho = [LARGURA, ALTURA, FUNDO]

    write_json(os.path.join(RP, "models", "blocks", f"{SHORT}.geo.json"), doc)

    src = Image.open(os.path.join(ASSETS, TEXTURE)).convert("RGBA")
    tex_dir = os.path.join(RP, "textures", NS, "blocks")
    os.makedirs(tex_dir, exist_ok=True)
    monta_textura(src).save(os.path.join(tex_dir, f"{SHORT}.png"))

    # --- bloco ---------------------------------------------------------------
    # `alpha_test` e não `opaque`: a textura dele tem transparência (é grade
    # vazada). Com `opaque` o buraco vira preto.
    write_json(
        os.path.join(BP, "blocks", f"{SHORT}.json"),
        {
            "format_version": FORMAT_VERSION,
            "minecraft:block": {
                "description": {
                    "identifier": BLOCK,
                    "menu_category": {"category": "items"},
                },
                "components": {
                    "minecraft:geometry": geo_id,
                    "minecraft:material_instances": {
                        "*": {
                            "texture": f"{NS}_{SHORT}",
                            "render_method": "alpha_test",
                            "ambient_occlusion": False,
                            "face_dimming": True,
                        },
                    },
                    "minecraft:collision_box": {"origin": base, "size": tamanho},
                    "minecraft:selection_box": {"origin": base, "size": tamanho},
                    "minecraft:destructible_by_mining": {"seconds_to_destroy": 2.5},
                    "minecraft:destructible_by_explosion": {"explosion_resistance": 6},
                    "minecraft:map_color": "#8E9499",
                    "minecraft:light_dampening": 0,
                },
            },
        },
    )

    # --- terrain_texture -----------------------------------------------------
    path = os.path.join(RP, "textures", "terrain_texture.json")
    doc_tex = json.load(open(path, encoding="utf-8")) if os.path.isfile(path) else {
        "resource_pack_name": NS, "texture_name": "atlas.terrain",
        "padding": 8, "num_mip_levels": 4, "texture_data": {},
    }
    doc_tex["texture_data"][f"{NS}_{SHORT}"] = {
        "textures": f"textures/{NS}/blocks/{SHORT}"
    }
    write_json(path, doc_tex)

    # --- blocks.json ---------------------------------------------------------
    # Bloco custom acha a textura pelo material_instances; o que esta entrada
    # traz é o SOM — sem ela a lixeira quebra e pisa com som de pedra.
    path = os.path.join(RP, "blocks.json")
    doc_blk = json.load(open(path, encoding="utf-8")) if os.path.isfile(path) else {
        "format_version": [1, 1, 0]
    }
    doc_blk[BLOCK] = {"textures": f"{NS}_{SHORT}", "sound": "metal"}
    write_json(path, doc_blk)

    # --- receita -------------------------------------------------------------
    write_json(
        os.path.join(BP, "recipes", f"{SHORT}.json"),
        {
            "format_version": RECIPE_FORMAT,
            "minecraft:recipe_shaped": {
                "description": {"identifier": BLOCK},
                "tags": ["crafting_table"],
                "pattern": RECIPE["pattern"],
                "key": RECIPE["key"],
                "result": {"item": BLOCK, "count": 1},
            },
        },
    )

    # --- nome ----------------------------------------------------------------
    MARK = "## lixeira (gerado por tools/make_trash_can.py)"
    for lang, nome in (("pt_BR", PT), ("en_US", EN), ("en_GB", EN)):
        replace_section(os.path.join(RP, "texts", f"{lang}.lang"), MARK,
                        [f"tile.{BLOCK}.name={nome}"])

    print(f"lixeira: {geo_id}, cubo {tamanho} em {base}")
    print(f"  textura {FOLHA}x{FOLHA} montada de {len(set(PAINEIS.values()))} painéis dele")


if __name__ == "__main__":
    main()
