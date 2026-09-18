#!/usr/bin/env python3
"""Gera a lixeira: bloco com modelo próprio que engole o item clicado nele.

O MODELO E A TEXTURA SÃO DELE, agora usados como vieram — as UVs do arquivo
novo caem em cima do desenho, e não mais numa parte vazia da folha. (A primeira
versão do .geo.json tinha as UVs num espaço de 512 apontando pra x 488..512, e
lá a textura é toda transparente: as seis faces amostravam pixel vazio e o
bloco ficava invisível no jogo. Foi ele quem remapeou.)

O que este script faz com o modelo é UMA coisa: encolher pra caber no bloco.
O cubo vem girado 90° em X, então quem manda é a caixa DEPOIS da rotação —
16,53 x 22,32 x 16,53, ou seja um caixote alto, mais de um bloco e meio de
altura. A escala é uniforme e a rotação é preservada, então a proporção e o
desenho dele ficam intactos; só o tamanho muda.

O comportamento (clicar com item pra jogar fora) é script: ver trashCan.js.
"""
import json
import math
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from langfile import escreve_idiomas, replace_section  # noqa: E402

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

# Depois de girado, o modelo tem que caber nisto, em unidades de bloco (16 = um
# bloco). A altura é o que aperta: o caixote dele tem 22,3 de alto.
ALTURA_MAX = 15.0
LARGURA_MAX = 14.0

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


def rotaciona(p, pivo, rot):
    """Um ponto girado em torno do pivô, nos três eixos, em graus."""
    x, y, z = (p[i] - pivo[i] for i in range(3))
    rx, ry, rz = (math.radians(a) for a in rot)
    y, z = y * math.cos(rx) - z * math.sin(rx), y * math.sin(rx) + z * math.cos(rx)
    x, z = x * math.cos(ry) + z * math.sin(ry), -x * math.sin(ry) + z * math.cos(ry)
    x, y = x * math.cos(rz) - y * math.sin(rz), x * math.sin(rz) + y * math.cos(rz)
    return [x + pivo[0], y + pivo[1], z + pivo[2]]


def caixa_girada(cubos):
    """A caixa que envolve os cubos DEPOIS de girados.

    É ela que decide se o modelo cabe no bloco e é ela que vira a caixa de
    colisão. Medir a caixa crua daria outro número: o cubo daqui vem girado 90°
    em X, que troca a altura pela profundidade.
    """
    pontos = []
    for c in cubos:
        o, t = c["origin"], c["size"]
        rot = c.get("rotation", [0, 0, 0])
        pivo = c.get("pivot", [0, 0, 0])
        for a in (0, 1):
            for b in (0, 1):
                for d in (0, 1):
                    canto = [o[0] + t[0] * a, o[1] + t[1] * b, o[2] + t[2] * d]
                    pontos.append(rotaciona(canto, pivo, rot) if any(rot) else canto)
    lo = [min(p[i] for p in pontos) for i in range(3)]
    hi = [max(p[i] for p in pontos) for i in range(3)]
    return lo, hi


def encaixa_no_bloco(doc):
    """O modelo dele, encolhido e assentado no chão do bloco.

    Escala UNIFORME em torno da origem — a rotação comuta com ela, então a
    caixa girada encolhe junto. Depois uma translação que centraliza em x e z e
    apoia no chão. As UVs não são tocadas: são coordenadas de textura e não têm
    nada a ver com o tamanho do cubo, e é isso que mantém o desenho dele exato.
    """
    geo = doc["minecraft:geometry"][0]
    cubos = [c for b in geo["bones"] for c in b.get("cubes", [])]
    if not cubos:
        raise SystemExit("o modelo da lixeira não tem cubo nenhum")

    lo, hi = caixa_girada(cubos)
    alto = hi[1] - lo[1]
    largo = max(hi[0] - lo[0], hi[2] - lo[2])
    s = min(ALTURA_MAX / alto, LARGURA_MAX / largo, 1.0)

    for bone in geo["bones"]:
        bone["pivot"] = [round(v * s, 4) for v in bone.get("pivot", [0, 0, 0])]
        for c in bone.get("cubes", []):
            c["origin"] = [round(v * s, 4) for v in c["origin"]]
            c["size"] = [round(v * s, 4) for v in c["size"]]
            if "pivot" in c:
                c["pivot"] = [round(v * s, 4) for v in c["pivot"]]
            if "inflate" in c:
                c["inflate"] = round(c["inflate"] * s, 4)

    lo, hi = caixa_girada([c for b in geo["bones"] for c in b.get("cubes", [])])
    desloca = [-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2]
    for bone in geo["bones"]:
        bone["pivot"] = [round(bone["pivot"][i] + desloca[i], 4) for i in range(3)]
        for c in bone.get("cubes", []):
            c["origin"] = [round(c["origin"][i] + desloca[i], 4) for i in range(3)]
            if "pivot" in c:
                c["pivot"] = [round(c["pivot"][i] + desloca[i], 4) for i in range(3)]

    lo, hi = caixa_girada([c for b in geo["bones"] for c in b.get("cubes", [])])
    base = [round(v, 4) for v in lo]
    tamanho = [round(hi[i] - lo[i], 4) for i in range(3)]
    return doc, base, tamanho, s


def main():
    import shutil

    doc = json.load(open(os.path.join(ASSETS, GEO_SRC), encoding="utf-8"))
    # O modelo vem com o nome do projeto do Blockbench dele
    # ("geometry.Level 1 spaceship"); aqui ele entra na família do addon.
    geo_id = f"geometry.{NS}.{SHORT}"
    doc["minecraft:geometry"][0]["description"]["identifier"] = geo_id
    doc, base, tamanho, escala = encaixa_no_bloco(doc)

    write_json(os.path.join(RP, "models", "blocks", f"{SHORT}.geo.json"), doc)

    tex_dir = os.path.join(RP, "textures", NS, "blocks")
    os.makedirs(tex_dir, exist_ok=True)
    shutil.copyfile(os.path.join(ASSETS, TEXTURE), os.path.join(tex_dir, f"{SHORT}.png"))

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
    escreve_idiomas(RP, MARK, [f"tile.{BLOCK}.name={PT}"], [f"tile.{BLOCK}.name={EN}"])

    print(f"lixeira: {geo_id} a {escala:.3f} da escala dele")
    print(f"  caixa girada {tamanho} em {base}")
    print(f"  modelo e textura copiados de tools/assets, sem remontar nada")


if __name__ == "__main__":
    main()
