#!/usr/bin/env python3
"""Gera a lixeira: bloco com modelo próprio que engole o item clicado nele.

O modelo e a textura são DELE (tools/assets/trash_can_src.geo.json e
trash_can.png). O que este script faz com o modelo é UMA coisa: encolher pra
caber num bloco.

POR QUE ENCOLHER. O modelo veio com 20x20x27 unidades e o canto em x = -9,3.
Modelo de bloco no Bedrock vive num espaço em que x e z vão de -8 a 8 e y de 0
a 16 — ou seja, ele estourava a caixa em x e era quase o dobro de um bloco em
z. Bloco maior que o próprio bloco atravessa o vizinho e a caixa de colisão não
acompanha. A escala é UNIFORME, então a proporção dele fica intacta; só o
tamanho muda.

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

# O maior lado do modelo passa a ter esta altura, em unidades de bloco (16 = um
# bloco inteiro). 15 deixa um fio de folga pra a lixeira não encostar na parede
# do vizinho.
ALVO = 15.0

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


def scale_geometry(doc):
    """O modelo dele, encolhido e assentado no chão do bloco.

    Só posição e tamanho mudam. As UVs são coordenadas de textura e não têm
    nada a ver com o tamanho do cubo, então passam intactas — é o que mantém o
    desenho dele exatamente como ele fez.
    """
    geo = doc["minecraft:geometry"][0]

    cubos = [c for b in geo["bones"] for c in b.get("cubes", [])]
    if not cubos:
        raise SystemExit("o modelo da lixeira não tem cubo nenhum")

    lo = [min(c["origin"][i] for c in cubos) for i in range(3)]
    hi = [max(c["origin"][i] + c["size"][i] for c in cubos) for i in range(3)]
    maior = max(hi[i] - lo[i] for i in range(3))
    s = ALVO / maior

    # Depois de escalar: centrado em x e z, apoiado no chão em y.
    largura = [(hi[i] - lo[i]) * s for i in range(3)]
    base = [-largura[0] / 2, 0.0, -largura[2] / 2]

    for bone in geo["bones"]:
        bone["pivot"] = [0, 0, 0]
        for c in bone.get("cubes", []):
            c["origin"] = [round(base[i] + (c["origin"][i] - lo[i]) * s, 4)
                           for i in range(3)]
            c["size"] = [round(c["size"][i] * s, 4) for i in range(3)]
            if "inflate" in c:
                c["inflate"] = round(c["inflate"] * s, 4)

    return doc, [round(v, 4) for v in base], [round(v, 4) for v in largura], s


def main():
    doc = json.load(open(os.path.join(ASSETS, GEO_SRC), encoding="utf-8"))
    doc, base, tamanho, escala = scale_geometry(doc)
    # O modelo dele vem como `geometry.Trash_can`. Aqui ele entra na família do
    # addon, como todo o resto: `geometry.gh.<coisa>`.
    geo_id = f"geometry.{NS}.{SHORT}"
    doc["minecraft:geometry"][0]["description"]["identifier"] = geo_id

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

    print(f"lixeira: {geo_id} a {escala:.3f} da escala dele")
    print(f"  caixa {tamanho} em {base}")


if __name__ == "__main__":
    main()
