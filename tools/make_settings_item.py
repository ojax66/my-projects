#!/usr/bin/env python3
"""A engrenagem: o item que abre a escolha de idioma.

Todo jogador ganha uma ao entrar pela primeira vez (settings.js). A receita
existe pra ela não ser um item que dá pra perder pra sempre — um ferro e um
redstone, que é o que o jogador tem na primeira hora de mundo.

O ícone é desenhado aqui: um anel com oito dentes e um furo no meio, com a luz
vindo de cima e da esquerda como todo ícone do jogo. É desenho simples de
propósito — em 16 pixels uma engrenagem com mais detalhe vira mancha.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from langfile import escreve_idiomas, replace_section  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "Galactic Horizons BP")
RP = os.path.join(ROOT, "packs", "Galactic Horizons RP")
NS = "gh"
FORMAT_VERSION = "1.21.80"
RECIPE_FORMAT = "1.12"

ITEM = f"{NS}:settings_gear"
SHORT = "settings_gear"

NOMES = {
    "pt_BR": "Engrenagem de Configuração",
    "en_US": "Settings Gear",
    "en_GB": "Settings Gear",
    "es_ES": "Engranaje de Configuración",
    "es_MX": "Engranaje de Configuración",
}

# A cor da engrenagem: o cinza-azulado do addon, com o miolo mais escuro.
TONS = ["#2A2F3A", "#4A5262", "#79839A", "#A9B3C6", "#D8DEE9"]

LADO = 16
RAIO_EXT = 7.0          # até a ponta do dente
RAIO_CORPO = 5.2        # o anel
RAIO_FURO = 2.1         # o furo do meio
DENTES = 8


def hex_rgb(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def desenha():
    from PIL import Image

    tons = [hex_rgb(c) for c in TONS]
    im = Image.new("RGBA", (LADO, LADO), (0, 0, 0, 0))
    px = im.load()
    c = (LADO - 1) / 2

    dentro = set()
    for y in range(LADO):
        for x in range(LADO):
            dx, dy = x - c, y - c
            d = math.hypot(dx, dy)
            ang = math.atan2(dy, dx)
            # O dente: o raio máximo varia com o ângulo, em DENTES voltas.
            onda = math.cos(ang * DENTES)
            raio = RAIO_CORPO + (RAIO_EXT - RAIO_CORPO) * (1 if onda > 0.2 else 0)
            if d <= raio and d >= RAIO_FURO:
                dentro.add((x, y))

    for (x, y) in dentro:
        dx, dy = x - c, y - c
        # Luz de cima e da esquerda, como no resto dos ícones.
        k = 0.5 - 0.5 * (dx + dy) / (RAIO_EXT * 2)
        tom = 1 + round(k * 3)
        px[x, y] = tons[max(1, min(4, tom))] + (255,)

    # Contorno: tudo que faz fronteira com o vazio, incluindo o furo.
    for (x, y) in list(dentro):
        for ddx, ddy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + ddx, y + ddy
            if (nx, ny) not in dentro and 0 <= nx < LADO and 0 <= ny < LADO:
                px[nx, ny] = tons[0] + (255,)
    return im


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def main():
    icon_dir = os.path.join(RP, "textures", NS, "items")
    os.makedirs(icon_dir, exist_ok=True)
    desenha().save(os.path.join(icon_dir, f"{SHORT}.png"))

    write_json(
        os.path.join(BP, "items", f"{SHORT}.json"),
        {
            "format_version": FORMAT_VERSION,
            "minecraft:item": {
                "description": {
                    "identifier": ITEM,
                    "menu_category": {"category": "items"},
                },
                "components": {
                    "minecraft:icon": f"{NS}_{SHORT}",
                    "minecraft:max_stack_size": 1,
                    "minecraft:hover_text_color": "aqua",
                    "minecraft:glint": True,
                },
            },
        },
    )

    write_json(
        os.path.join(BP, "recipes", f"{SHORT}.json"),
        {
            "format_version": RECIPE_FORMAT,
            "minecraft:recipe_shapeless": {
                "description": {"identifier": ITEM},
                "tags": ["crafting_table"],
                "ingredients": [
                    {"item": "minecraft:iron_ingot"},
                    {"item": "minecraft:redstone"},
                ],
                "result": {"item": ITEM, "count": 1},
            },
        },
    )

    path = os.path.join(RP, "textures", "item_texture.json")
    doc = json.load(open(path, encoding="utf-8")) if os.path.isfile(path) else {
        "resource_pack_name": NS, "texture_name": "atlas.items", "texture_data": {},
    }
    doc["texture_data"][f"{NS}_{SHORT}"] = {"textures": f"textures/{NS}/items/{SHORT}"}
    write_json(path, doc)

    MARK = "## engrenagem de configuração (gerado por tools/make_settings_item.py)"
    escreve_idiomas(RP, MARK, [f"item.{ITEM}={NOMES['pt_BR']}"],
                    [f"item.{ITEM}={NOMES['en_US']}"])

    print(f"engrenagem: {ITEM}, ícone {LADO}x{LADO} com {DENTES} dentes")


if __name__ == "__main__":
    main()
