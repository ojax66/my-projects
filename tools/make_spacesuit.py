#!/usr/bin/env python3
"""Gera os DOIS trajes do addon: o Apollo (básico) e o AxEMU (reforçado).

O modelo e a textura dos dois vieram prontos do autor do addon
(tools/assets/suits) — não são mais emprestados do Spacecraft. Isso muda o
traje reforçado: ele continua com os mesmos ids de item (mundo antigo não
perde o que estava vestindo), mas agora tem cara própria.

A escada que os dois desenham:

  TRAJE APOLLO — básico, fabricável na Terra com material do jogo. RESOLVE O
    AR: é selado, o jogador respira nas dimensões deste addon sem depender de
    mochila nenhuma. NÃO isola do frio e NÃO segura a pressão do Sol — com ele
    o espaço já é atravessável, mas ainda congela.

  TRAJE AxEMU — reforçado, feito por cima do Apollo com pedra da Lua e de
    Marte. Isola do frio, segura o calor da APROXIMAÇÃO do Sol e ANULA a
    pressão lá dentro (config REINFORCED_SUIT_PRESSURE_FACTOR = 0). O que
    ainda falta nele é o calor de DENTRO do Sol — pra isso só a armadura de
    estrela.

Cada peça se espalha por seis lugares (item, attachable, receita, ícone,
item_texture.json, .lang). A fonte é a tabela aqui embaixo, como no
make_blocks.py — escrever à mão é convite a esquecer um e o item virar cubo
roxo sem nome.
"""
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from langfile import replace_section  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "Distant Horizons BP")
RP = os.path.join(ROOT, "packs", "Distant Horizons RP")
SRC = os.path.join(ROOT, "tools", "assets", "suits")
NS = "space_dim"
SC = "nv_sc"
FORMAT_VERSION = "1.21.80"
# Receita usa outro schema — ver a nota em make_star_gear.py. "1.21.80" numa
# receita faz o arquivo não carregar sem avisar nada.
RECIPE_FORMAT = "1.12"

# As quatro peças, na ordem em que o jogador as veste.
SLOTS = {
    "helmet": dict(
        slot="slot.armor.head", ench_slot="armor_head",
        group="minecraft:itemGroup.name.helmet",
        hide="variable.helmet_layer_visible = 0.0;",
        vanilla="minecraft:iron_helmet",
    ),
    "chestplate": dict(
        slot="slot.armor.chest", ench_slot="armor_torso",
        group="minecraft:itemGroup.name.chestplate",
        hide="variable.chest_layer_visible = 0.0;",
        vanilla="minecraft:iron_chestplate",
    ),
    "leggings": dict(
        slot="slot.armor.legs", ench_slot="armor_legs",
        group="minecraft:itemGroup.name.leggings",
        hide="variable.leg_layer_visible = 0.0;",
        vanilla="minecraft:iron_leggings",
    ),
    "boots": dict(
        slot="slot.armor.feet", ench_slot="armor_feet",
        group="minecraft:itemGroup.name.boots",
        hide="variable.boot_layer_visible = 0.0;",
        vanilla="minecraft:iron_boots",
    ),
}

# --- Receita do Apollo -------------------------------------------------------
# Só material do jogo base, de propósito: o traje básico precisa existir ANTES
# da primeira subida, e exigir coisa de outro addon (ou da Lua) faria dele um
# item que só se consegue depois de já ter ido aonde ele serve.
APOLLO_KEY = {
    "F": {"item": "minecraft:white_wool"},      # o tecido branco do traje
    "I": {"item": "minecraft:iron_ingot"},      # a estrutura
    "G": {"item": "minecraft:glass"},           # o visor
    "L": {"item": "minecraft:leather"},         # a sola e as juntas
}
APOLLO_PATTERN = {
    "helmet":     ["FIF", "IGI"],
    "chestplate": ["F F", "IFI", "FIF"],
    "leggings":   ["FIF", "I I", "L L"],
    "boots":      ["F F", "L L"],
}

# --- Receita do AxEMU --------------------------------------------------------
# Feito POR CIMA do Apollo, com pedra da Lua e de Marte: só quem já foi aos
# dois planetas monta o reforçado. `S` é a peça Apollo correspondente.
AXEMU_KEY = {
    "R": {"item": f"{NS}:moon_regolith_dark"},  # ardósia de regolito (Lua)
    "M": {"item": f"{NS}:mars_rock_dark"},      # ardósia de ferrita (Marte)
    "D": {"item": "minecraft:diamond"},
    "I": {"item": "minecraft:iron_block"},
}
AXEMU_PATTERN = ["DRD", "MSM", "DID"]

# --- Receita antiga do AxEMU, pra quem joga com o Spacecraft ------------------
# O reforçado nasceu como o traje DELES melhorado; quem tem o addo deles ainda
# pode montá-lo por esse caminho. É um id de receita separado — as duas
# convivem na bancada.
SC_MATERIALS = {
    "T": f"{SC}:titanium_plate",      # titânio (Lua deles)
    "M": f"{SC}:magnetite_ingot",     # magnetita (Marte deles)
    "A": f"{SC}:andrenite_alloy",     # liga de andrenita (Andrella)
    "H": f"{SC}:thermite_alloy",      # a parte que aguenta calor
    "F": f"{SC}:insulated_fabric",    # tecido isolante
}
SC_PATTERN = ["HMH", "ASA", "TFT"]
SC_BASE = {
    "helmet": f"{SC}:spacesuit_helmet",
    "chestplate": f"{SC}:spacesuit_chestplate",
    "leggings": f"{SC}:spacesuit_leggings",
    "boots": f"{SC}:spacesuit_boots",
}

# --- Os dois trajes ----------------------------------------------------------
# Ferro é 2/6/5/2 de proteção e 165/240/225/195 de durabilidade; netherite é
# 3/8/6/3. O Apollo fica em cima do ferro em durabilidade e um pouco abaixo em
# proteção (é traje, não armadura de combate); o AxEMU fica entre o Apollo e a
# armadura de estrela (4/9/7/4).
SUITS = {
    "apollo": dict(
        geo="apollo_suit.geo.json",
        geometry="geometry.apollo_suit.armor.{piece}",
        texture=f"textures/{NS}/armor/apollo_suit",
        legs_texture=f"textures/{NS}/armor/apollo_suit_legs",
        item="{NS}:apollo_{piece}",
        repair="minecraft:iron_ingot",
        color="white",
        fire_resistant=False,
        enchant=9,
        protection=dict(helmet=2, chestplate=5, leggings=4, boots=2),
        durability=dict(helmet=300, chestplate=420, leggings=390, boots=330),
        pt=dict(helmet="Capacete Apollo", chestplate="Peitoral Apollo",
                leggings="Calças Apollo", boots="Botas Apollo"),
        en=dict(helmet="Apollo Helmet", chestplate="Apollo Chestplate",
                leggings="Apollo Leggings", boots="Apollo Boots"),
    ),
    "axemu": dict(
        geo="axemu_suit.geo.json",
        geometry="geometry.axemu_suit.armor.{piece}",
        texture=f"textures/{NS}/armor/axemu_suit",
        legs_texture=f"textures/{NS}/armor/axemu_suit_legs",
        # O id do reforçado NÃO muda: quem já tinha um vestido continua com ele.
        item="{NS}:reinforced_spacesuit_{piece}",
        repair="minecraft:netherite_ingot",
        color="aqua",
        fire_resistant=True,
        enchant=12,
        protection=dict(helmet=3, chestplate=7, leggings=5, boots=3),
        durability=dict(helmet=480, chestplate=620, leggings=580, boots=500),
        pt=dict(helmet="Capacete AxEMU Reforçado", chestplate="Peitoral AxEMU Reforçado",
                leggings="Calças AxEMU Reforçadas", boots="Botas AxEMU Reforçadas"),
        en=dict(helmet="Reinforced AxEMU Helmet", chestplate="Reinforced AxEMU Chestplate",
                leggings="Reinforced AxEMU Leggings", boots="Reinforced AxEMU Boots"),
    ),
}


def item_id(suit, piece):
    return SUITS[suit]["item"].format(NS=NS, piece=piece)


def icon_name(suit, piece):
    return item_id(suit, piece).replace(":", "_")


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


# --- Ícones ------------------------------------------------------------------
#
# Os ícones do inventário saem da PRÓPRIA folha de textura do traje: um molde
# 16x16 com a silhueta da peça, preenchido com os pixels da face frontal
# correspondente. Nenhuma cor é inventada aqui — a paleta é inteiramente a que
# veio na textura, e um traje repintado gera ícone repintado sozinho.
MASKS = {
    "helmet": [
        "................",
        "................",
        "....########....",
        "...##########...",
        "..############..",
        "..############..",
        "..####....####..",
        "..###......###..",
        "..###......###..",
        "..###......###..",
        "..####....####..",
        "..############..",
        "...##########...",
        "................",
        "................",
        "................",
    ],
    "chestplate": [
        "................",
        "................",
        ".###........###.",
        ".####......####.",
        ".##############.",
        ".##############.",
        ".##############.",
        ".##############.",
        ".##############.",
        ".##############.",
        ".##############.",
        "..############..",
        "..############..",
        "..###......###..",
        "................",
        "................",
    ],
    "leggings": [
        "................",
        "................",
        "..############..",
        "..############..",
        "..############..",
        "..############..",
        "..############..",
        "..####....####..",
        "..###......###..",
        "..###......###..",
        "..###......###..",
        "..###......###..",
        "..###......###..",
        "..###......###..",
        "................",
        "................",
    ],
    "boots": [
        "................",
        "................",
        "................",
        "................",
        "..####....####..",
        "..####....####..",
        "..####....####..",
        "..####....####..",
        ".#####....#####.",
        ".######..######.",
        ".##############.",
        ".##############.",
        ".##############.",
        "................",
        "................",
        "................",
    ],
}

# De onde cada ícone tira a cor, na folha 64x32 do traje. É sempre a face
# FRONTAL da parte do corpo, que é o desenho que o jogador reconhece.
# (camada, x, y, largura, altura) — camada 2 é a folha da calça.
ICON_SOURCE = {
    "helmet":     (1, 8, 8, 8, 8),      # cabeça
    "chestplate": (1, 20, 20, 8, 12),   # torso
    "leggings":   (2, 4, 20, 4, 12),    # perna, na folha da calça
    "boots":      (1, 4, 27, 4, 5),     # o pé: as últimas linhas da perna
}


def mask_bbox(mask):
    xs = [x for row in mask for x, c in enumerate(row) if c == "#"]
    ys = [y for y, row in enumerate(mask) for c in row if c == "#"]
    return min(xs), min(ys), max(xs), max(ys)


def make_icon(piece, sheets):
    from PIL import Image

    mask = MASKS[piece]
    layer, sx0, sy0, sw, sh = ICON_SOURCE[piece]
    src = sheets[layer]
    x0, y0, x1, y1 = mask_bbox(mask)
    bw, bh = x1 - x0 + 1, y1 - y0 + 1

    out = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = out.load()
    for y, row in enumerate(mask):
        for x, c in enumerate(row):
            if c != "#":
                continue
            # A metade direita repete a esquerda: o ícone sai simétrico mesmo
            # quando a textura tem detalhe só de um lado.
            mx = x if x - x0 < bw / 2 else x1 - (x - x0)
            u = sx0 + min(sw - 1, int((mx - x0) * sw / bw))
            v = sy0 + min(sh - 1, int((y - y0) * sh / bh))
            px[x, y] = src.getpixel((u, v))
    return out


def copy_art():
    """Leva modelo e textura dos dois trajes pro pack de recurso."""
    from PIL import Image

    geo_ids = []
    icon_dir = os.path.join(RP, "textures", NS, "items")
    armor_dir = os.path.join(RP, "textures", NS, "armor")
    model_dir = os.path.join(RP, "models", "entity")
    for d in (icon_dir, armor_dir, model_dir):
        os.makedirs(d, exist_ok=True)

    for suit, spec in SUITS.items():
        # modelo
        src_geo = os.path.join(SRC, spec["geo"])
        doc = json.load(open(src_geo, encoding="utf-8"))
        for geo in doc["minecraft:geometry"]:
            geo_ids.append(geo["description"]["identifier"])
        shutil.copyfile(src_geo, os.path.join(model_dir, spec["geo"]))

        # texturas: a folha do corpo e a da calça
        sheets = {}
        for layer, path in ((1, spec["texture"]), (2, spec["legs_texture"])):
            name = os.path.basename(path) + ".png"
            src_png = os.path.join(SRC, name)
            img = Image.open(src_png).convert("RGBA")
            if img.size != (64, 32):
                raise SystemExit(f"{name}: textura de armadura tem que ser 64x32, veio {img.size}")
            shutil.copyfile(src_png, os.path.join(armor_dir, name))
            sheets[layer] = img

        # ícones, tirados da própria folha
        for piece in SLOTS:
            make_icon(piece, sheets).save(
                os.path.join(icon_dir, f"{icon_name(suit, piece)}.png"))

    # As quatro geometrias de cada traje têm que estar todas lá: uma faltando
    # deixaria a peça invisível no corpo, e o jogo não avisa.
    for suit, spec in SUITS.items():
        for piece in SLOTS:
            want = spec["geometry"].format(piece=piece)
            if want not in geo_ids:
                raise SystemExit(f"{suit}: o modelo não traz {want}")
    return geo_ids


# --- Geração -----------------------------------------------------------------
def main():
    geo_ids = copy_art()
    recipes = 0

    for suit, spec in SUITS.items():
        for piece, base in SLOTS.items():
            iid = item_id(suit, piece)
            name = iid.split(":")[1]
            durability = spec["durability"][piece]

            # --- item --------------------------------------------------------
            components = {
                "minecraft:icon": icon_name(suit, piece),
                "minecraft:max_stack_size": 1,
                "minecraft:durability": {"max_durability": durability},
                "minecraft:wearable": {
                    "slot": base["slot"],
                    "protection": spec["protection"][piece],
                },
                "minecraft:repairable": {
                    "repair_items": [{
                        "items": [spec["repair"]],
                        "repair_amount": durability // 5,
                    }],
                },
                "minecraft:enchantable": {"value": spec["enchant"], "slot": base["ench_slot"]},
                "minecraft:hover_text_color": spec["color"],
            }
            if spec["fire_resistant"]:
                components["minecraft:fire_resistant"] = True

            write_json(
                os.path.join(BP, "items", f"{name}.json"),
                {
                    "format_version": FORMAT_VERSION,
                    "minecraft:item": {
                        "description": {
                            "identifier": iid,
                            "menu_category": {"category": "equipment", "group": base["group"]},
                        },
                        "components": components,
                    },
                },
            )

            # --- attachable: é o que faz a peça aparecer vestida --------------
            write_json(
                os.path.join(RP, "attachables", f"{name}.json"),
                {
                    "format_version": "1.10.0",
                    "minecraft:attachable": {
                        "description": {
                            "identifier": iid,
                            "materials": {"default": "armor", "enchanted": "armor_enchanted"},
                            "textures": {
                                # A calça usa a segunda folha, como toda
                                # armadura do Bedrock.
                                "default": spec["legs_texture"] if piece == "leggings"
                                           else spec["texture"],
                                "enchanted": "textures/misc/enchanted_actor_glint",
                            },
                            "geometry": {"default": spec["geometry"].format(piece=piece)},
                            # Esconde a camada de armadura padrão embaixo, senão
                            # ela aparece por dentro do traje.
                            "scripts": {"parent_setup": base["hide"]},
                            "render_controllers": ["controller.render.armor"],
                        },
                    },
                },
            )

            # --- receitas ----------------------------------------------------
            if suit == "apollo":
                pattern = APOLLO_PATTERN[piece]
                key = {k: v for k, v in APOLLO_KEY.items()
                       if any(k in row for row in pattern)}
                write_json(
                    os.path.join(BP, "recipes", f"{name}.json"),
                    {
                        "format_version": RECIPE_FORMAT,
                        "minecraft:recipe_shaped": {
                            "description": {"identifier": iid},
                            "tags": ["crafting_table"],
                            "pattern": pattern,
                            "key": key,
                            "result": {"item": iid, "count": 1},
                        },
                    },
                )
                recipes += 1
            else:
                # por cima do Apollo, com pedra da Lua e de Marte
                key = dict(AXEMU_KEY)
                key["S"] = {"item": item_id("apollo", piece)}
                write_json(
                    os.path.join(BP, "recipes", f"{name}.json"),
                    {
                        "format_version": RECIPE_FORMAT,
                        "minecraft:recipe_shaped": {
                            "description": {"identifier": iid},
                            "tags": ["crafting_table"],
                            "pattern": AXEMU_PATTERN,
                            "key": key,
                            "result": {"item": iid, "count": 1},
                        },
                    },
                )
                recipes += 1

                # o caminho antigo, pra quem joga com o Spacecraft
                sc_key = {k: {"item": v} for k, v in SC_MATERIALS.items()}
                sc_key["S"] = {"item": SC_BASE[piece]}
                write_json(
                    os.path.join(BP, "recipes", f"{name}_from_spacecraft.json"),
                    {
                        "format_version": RECIPE_FORMAT,
                        "minecraft:recipe_shaped": {
                            "description": {"identifier": f"{iid}_from_spacecraft"},
                            "tags": ["crafting_table"],
                            "pattern": SC_PATTERN,
                            "key": sc_key,
                            "result": {"item": iid, "count": 1},
                        },
                    },
                )
                recipes += 1

    # --- item_texture.json -----------------------------------------------------
    # Mescla: o atlas é compartilhado com a armadura de estrela e o rastreador.
    # Sobrescrever o arquivo inteiro apagava os ícones deles, e o único aviso
    # era o item saindo sem textura no jogo.
    path = os.path.join(RP, "textures", "item_texture.json")
    doc = json.load(open(path, encoding="utf-8")) if os.path.isfile(path) else {
        "resource_pack_name": NS, "texture_name": "atlas.items", "texture_data": {},
    }
    for suit in SUITS:
        for piece in SLOTS:
            n = icon_name(suit, piece)
            doc["texture_data"][n] = {"textures": f"textures/{NS}/items/{n}"}
    write_json(path, doc)

    # --- nomes -----------------------------------------------------------------
    MARK = "## trajes espaciais (gerado por tools/make_spacesuit.py)"
    # O bloco antigo tinha outro título e só o reforçado. Lista vazia apaga.
    OLD_MARK = "## traje espacial reforçado (gerado por tools/make_spacesuit.py)"
    for lang, key in (("pt_BR", "pt"), ("en_US", "en"), ("en_GB", "en")):
        replace_section(os.path.join(RP, "texts", f"{lang}.lang"), OLD_MARK, [])
        replace_section(
            os.path.join(RP, "texts", f"{lang}.lang"), MARK,
            [f"item.{item_id(suit, piece)}={SUITS[suit][key][piece]}"
             for suit in SUITS for piece in SLOTS],
        )

    print(f"{len(SUITS)} trajes x {len(SLOTS)} peças = {len(SUITS) * len(SLOTS)} itens")
    print(f"  modelos: {', '.join(geo_ids)}")
    print(f"  {len(SUITS) * len(SLOTS)} attachables, {len(SUITS) * len(SLOTS)} ícones tirados das próprias texturas")
    print(f"  {recipes} receitas")


if __name__ == "__main__":
    main()
