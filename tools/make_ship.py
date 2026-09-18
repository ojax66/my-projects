#!/usr/bin/env python3
"""A receita da Nave Level 1 e o ícone do ovo de geração dela.

A NAVE NÃO SE CONSTRÓI NO MUNDO: o que a receita entrega é o OVO DE GERAÇÃO
dela, que é como o addon da nave já a coloca no chão. Fabricar o ovo é a forma
de dar um caminho de fabricação sem reescrever o addon dele.

A receita é toda de material do OVERWORLD, de propósito: a nave é o que leva o
jogador pro espaço a primeira vez, então não pode depender de nada que só
exista lá em cima. As duas lixeiras entram como os tanques de descarte — e são
o único item do addon na receita, o que amarra os dois.

O ÍCONE É A ARTE DELE (tools/assets/ship_render.png), reduzida pros 16x16 que
um ovo de geração ocupa. A redução recorta o que tem tinta, cabe a nave inteira
dentro do quadro e depois puxa o contraste um tico: em 16 pixels um render
grande vira um borrão cinza se for só reduzido.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "Galactic Horizons BP")
RP = os.path.join(ROOT, "packs", "Galactic Horizons RP")
ASSETS = os.path.join(ROOT, "tools", "assets")
NS = "gh"
RECIPE_FORMAT = "1.12"

SHIP_ENTITY = "gh:level_1_spaceship"
SPAWN_EGG = f"{SHIP_ENTITY}_spawn_egg"
ICON_KEY = f"{NS}_ship_spawn_egg"
ICON_NAME = "ship_spawn_egg"
RENDER = "ship_render.png"

# G vidro (a cúpula), L lixeira, D bloco de diamante (o núcleo),
# R bloco de redstone (os motores), I bloco de ferro (o casco).
RECIPE_PATTERN = ["GGG", "LDL", "RIR"]
RECIPE_KEY = {
    "G": {"item": "minecraft:glass"},
    "L": {"item": f"{NS}:trash_can"},
    "D": {"item": "minecraft:diamond_block"},
    "R": {"item": "minecraft:redstone_block"},
    "I": {"item": "minecraft:iron_block"},
}


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


# O ícone do ovo: a arte dele, quadrada.
#
# Ele trocou este arquivo à mão pelo render inteiro, 626x470. A intenção está
# certa — o ovo tem que mostrar a nave, e a minha redução pra 16x16 saía um
# borrão. O problema é a FORMA: o slot do inventário é quadrado, e uma textura
# 626x470 é esticada 1,33x na vertical pra caber nele. A nave apareceria
# espichada.
#
# Então é o render dele, sem esticar: recortado no que tem tinta, centrado num
# quadrado e reduzido pra LADO. 128 e não 16 porque ícone de item pode ter mais
# resolução que isso, e a nave tem detalhe demais pra caber em 16 pixels.
LADO = 128


def make_icon():
    from PIL import Image

    src = Image.open(os.path.join(ASSETS, RENDER)).convert("RGBA")
    caixa = src.getbbox()          # o que tem tinta, sem a moldura vazia
    if caixa:
        src = src.crop(caixa)

    lado = max(src.size)
    quadro = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    quadro.paste(src, ((lado - src.width) // 2, (lado - src.height) // 2))
    icone = quadro.resize((LADO, LADO), Image.LANCZOS)

    # Pixel quase transparente vira sujeira na beirada; ou é opaco ou não é.
    px = icone.load()
    for y in range(LADO):
        for x in range(LADO):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255 if a >= 128 else 0)

    destino = os.path.join(RP, "textures", NS, "items", f"{ICON_NAME}.png")
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    icone.save(destino)
    return sum(1 for y in range(LADO) for x in range(LADO) if px[x, y][3])


def main():
    opacos = make_icon()

    # --- o ovo de geração passa a usar a arte dele ---------------------------
    # Antes eram duas cores chapadas (base + overlay), que é o ovo padrão do
    # jogo. Com `texture` o ovo mostra a nave.
    path = os.path.join(RP, "entity", "level_1_spaceship.json")
    doc = json.load(open(path, encoding="utf-8"))
    desc = doc["minecraft:client_entity"]["description"]
    desc["spawn_egg"] = {"texture": ICON_KEY, "texture_index": 0}
    write_json(path, doc)

    # --- item_texture.json ---------------------------------------------------
    path = os.path.join(RP, "textures", "item_texture.json")
    doc = json.load(open(path, encoding="utf-8")) if os.path.isfile(path) else {
        "resource_pack_name": NS, "texture_name": "atlas.items", "texture_data": {},
    }
    doc["texture_data"][ICON_KEY] = {"textures": f"textures/{NS}/items/{ICON_NAME}"}
    write_json(path, doc)

    # --- receita -------------------------------------------------------------
    write_json(
        os.path.join(BP, "recipes", "level_1_spaceship.json"),
        {
            "format_version": RECIPE_FORMAT,
            "minecraft:recipe_shaped": {
                "description": {"identifier": f"{NS}:level_1_spaceship"},
                "tags": ["crafting_table"],
                "pattern": RECIPE_PATTERN,
                "key": RECIPE_KEY,
                "result": {"item": SPAWN_EGG, "count": 1},
            },
        },
    )

    lixeiras = sum(row.count("L") for row in RECIPE_PATTERN)
    print(f"gh: receita de {lixeiras} lixeira(s) + material do Overworld -> {SPAWN_EGG}")
    print(f"  ícone do ovo: {LADO}x{LADO}, {opacos} pixels com tinta, de {RENDER}")


if __name__ == "__main__":
    main()
