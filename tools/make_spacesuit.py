#!/usr/bin/env python3
"""Gera os DOIS trajes do addon: o básico e o reforçado.

O modelo, a textura e a base dos ícones vieram prontos do autor do addon
(tools/assets/suits e tools/assets/armor_icon_base) — nada aqui é emprestado de
outro pack.

A escada que os dois desenham:

  TRAJE BÁSICO — fabricável na Terra com material do jogo. RESOLVE O AR: é selado, o jogador respira nas dimensões deste addon sem depender de
    mochila nenhuma. NÃO isola do frio e NÃO segura a pressão do Sol — com ele
    o espaço já é atravessável, mas ainda congela.

  TRAJE REFORÇADO — feito por cima do básico com os minérios dos planetas. Isola do frio, segura o calor da APROXIMAÇÃO do Sol e ANULA a
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
from langfile import escreve_idiomas, replace_section  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "Galactic Horizons BP")
RP = os.path.join(ROOT, "packs", "Galactic Horizons RP")
SRC = os.path.join(ROOT, "tools", "assets", "suits")
NS = "gh"
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

# --- Receita do traje básico -------------------------------------------------------
# Só material do jogo base, de propósito: o traje básico precisa existir ANTES
# da primeira subida, e exigir coisa da Lua faria dele um item que só se
# consegue depois de já ter ido aonde ele serve.
#
# Não é só lã e ferro: cobre nas juntas e conectores, couro nas dobras, vidro
# no visor e redstone no peito (é onde fica o suporte de vida). Cada peça usa
# uma mistura diferente, pra fabricar o conjunto não ser quatro vezes a mesma
# receita.
BASICO_KEY = {
    "F": {"item": "minecraft:white_wool"},      # o tecido branco do traje
    "I": {"item": "minecraft:iron_ingot"},      # a estrutura
    "C": {"item": "minecraft:copper_ingot"},    # juntas e conectores
    "G": {"item": "minecraft:glass"},           # o visor
    "L": {"item": "minecraft:leather"},         # as dobras e a sola
    "R": {"item": "minecraft:redstone"},        # o suporte de vida, no peito
}
BASICO_PATTERN = {
    "helmet":     ["FCF", "IGI"],
    "chestplate": ["F F", "IRI", "FCF"],
    "leggings":   ["FIF", "C C", "L L"],
    "boots":      ["C C", "L L"],
}

# --- Receita do traje reforçado --------------------------------------------------------
# Feito POR CIMA do básico, com os minérios dos planetas: titânio na estrutura,
# silício na eletrônica e no visor, hélio-3 no aquecimento — é o que dá ao
# reforçado o isolamento que o básico não tem.
#
# O hélio-3 só existe na LUA, e é ele que amarra a ordem das coisas: pra
# montar o reforçado é preciso ter ido lá, e pra ir lá basta o básico mais a
# nave (a cabine é pressurizada e quente). Nenhum passo pede o passo seguinte.
REFORCADO_KEY = {
    "T": {"item": f"{NS}:titanium"},
    "Z": {"item": f"{NS}:silicon"},
    "H": {"item": f"{NS}:helium3"},
}
REFORCADO_PATTERN = ["TZT", "ZSZ", "THT"]

# --- Receita antiga do reforçado, pra quem joga com o Spacecraft ------------------
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
# 3/8/6/3. O básico fica em cima do ferro em durabilidade e um pouco abaixo em
# proteção (é traje, não armadura de combate); o reforçado fica entre o básico e a
# armadura de estrela (4/9/7/4).
SUITS = {
    "basic": dict(
        geo="basic_suit.geo.json",
        geometry="geometry.gh.basic_suit.armor.{piece}",
        texture=f"textures/{NS}/armor/basic_suit",
        legs_texture=f"textures/{NS}/armor/basic_suit_legs",
        item="{NS}:basic_spacesuit_{piece}",
        repair="minecraft:iron_ingot",
        color="white",
        fire_resistant=False,
        enchant=9,
        protection=dict(helmet=2, chestplate=5, leggings=4, boots=2),
        durability=dict(helmet=300, chestplate=420, leggings=390, boots=330),
        pt=dict(helmet="Capacete Espacial Básico", chestplate="Peitoral Espacial Básico",
                leggings="Calças Espaciais Básicas", boots="Botas Espaciais Básicas"),
        en=dict(helmet="Basic Spacesuit Helmet", chestplate="Basic Spacesuit Chestplate",
                leggings="Basic Spacesuit Leggings", boots="Basic Spacesuit Boots"),
    ),
    "reinforced": dict(
        geo="reinforced_suit.geo.json",
        geometry="geometry.gh.reinforced_suit.armor.{piece}",
        texture=f"textures/{NS}/armor/reinforced_suit",
        legs_texture=f"textures/{NS}/armor/reinforced_suit_legs",
        item="{NS}:reinforced_spacesuit_{piece}",
        repair="minecraft:netherite_ingot",
        color="aqua",
        fire_resistant=True,
        enchant=12,
        protection=dict(helmet=3, chestplate=7, leggings=5, boots=3),
        durability=dict(helmet=480, chestplate=620, leggings=580, boots=500),
        pt=dict(helmet="Capacete Espacial Reforçado", chestplate="Peitoral Espacial Reforçado",
                leggings="Calças Espaciais Reforçadas", boots="Botas Espaciais Reforçadas"),
        en=dict(helmet="Reinforced Spacesuit Helmet", chestplate="Reinforced Spacesuit Chestplate",
                leggings="Reinforced Spacesuit Leggings", boots="Reinforced Spacesuit Boots"),
    ),
}


def item_id(suit, piece):
    return SUITS[suit]["item"].format(NS=NS, piece=piece)


def icon_name(suit, piece):
    """A CHAVE do ícone no atlas — precisa ser única entre todos os packs."""
    return item_id(suit, piece).replace(":", "_")


def icon_file(suit, piece):
    """O ARQUIVO da textura: o nome exato do item, sem o namespace.

    É a regra do addon inteiro: o arquivo de textura se chama igual à coisa que
    ele desenha. `basic_spacesuit_helmet.png` é a textura de
    `gh:basic_spacesuit_helmet`,
    e procurar por um acha o outro.
    """
    return item_id(suit, piece).split(":")[1]


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


# --- Ícones ------------------------------------------------------------------
#
# O ícone é a PEÇA VISTA DE FRENTE, montada da própria folha de textura do
# traje. Cada pedaço do recorte puxa a face frontal da parte do corpo que ele
# representa: o tronco vem do peito, os braços vêm do braço, as pernas da
# perna, o capacete da cabeça — com o visor que já está desenhado lá. O padrão
# e a paleta são os dele, pixel por pixel; o que é meu é o recorte, a montagem
# e o contorno.
#
# Foi assim que o peitoral ganhou BRAÇOS: a silhueta base do jogo só tem duas
# ombreiras, e uma peça de peito cobre o braço inteiro. As mangas descem pelos
# lados e acabam num punho.
#
# O capacete é FECHADO: a base vem com o rosto vazado e dois pontos soltos
# embaixo. Fechado, o rosto passa a mostrar o visor da textura.
ICON_BASE_DIR = os.path.join(ROOT, "tools", "assets", "armor_icon_base")

# Onde cada parte do corpo mora na folha 64x32, face FRONTAL:
#   cabeça  uv (8,8)    8x8      braço  uv (44,20)  4x12
#   tronco  uv (20,20)  8x12     perna  uv (4,20)   4x12
CABECA = (8, 8, 8, 8)
TRONCO = (20, 20, 8, 12)
BRACO = (44, 20, 4, 12)
PERNA = (4, 20, 4, 12)
PE = (4, 26, 4, 6)                  # o pedaço de baixo da perna, que a bota cobre

# O peitoral com braço. A base do jogo para nas ombreiras; daqui pra baixo as
# mangas são minhas, com o vão de um pixel que separa braço de tronco.
PEITORAL_COM_BRACOS = [
    "................",
    "................",
    ".###........###.",
    ".##############.",
    ".##############.",
    ".##############.",
    ".##############.",
    ".###.######.###.",
    ".###.######.###.",
    ".###.######.###.",
    ".###.######.###.",
    "..##.######.##..",
    ".....######.....",
    ".....######.....",
    "......####......",
    "................",
]

# De onde cada pedaço do recorte tira o desenho. `camada` 1 é a folha do corpo,
# 2 a da calça; `espelha` vira a fonte, pro lado direito não ser o esquerdo
# repetido.
REGIOES = {
    # O capacete puxa a face frontal da cabeça INTEIRA, moldura e visor. Por
    # isso ele mapeia só o miolo (`interior`): se a face fosse esticada até a
    # borda, o contorno comeria a moldura branca e sobrava só o visor — o
    # capacete do traje básico virava um retângulo dourado.
    "helmet": [
        dict(camada=1, src=CABECA, onde=lambda x, y: True, interior=True),
    ],
    "chestplate": [
        dict(camada=1, src=BRACO, onde=lambda x, y: x <= 3),
        dict(camada=1, src=BRACO, onde=lambda x, y: x >= 12, espelha=True),
        dict(camada=1, src=TRONCO, onde=lambda x, y: 4 <= x <= 11),
    ],
    "leggings": [
        dict(camada=2, src=TRONCO, onde=lambda x, y: y <= 6),
        dict(camada=2, src=PERNA, onde=lambda x, y: y >= 7 and x <= 7),
        dict(camada=2, src=PERNA, onde=lambda x, y: y >= 7 and x >= 8, espelha=True),
    ],
    "boots": [
        dict(camada=1, src=PE, onde=lambda x, y: x <= 7),
        dict(camada=1, src=PE, onde=lambda x, y: x >= 8, espelha=True),
    ],
}


def luma(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def saturacao(c):
    maior, menor = max(c[:3]), min(c[:3])
    return 0 if maior == 0 else (maior - menor) / maior


def cor_do_contorno(sheet):
    """O contorno: o tom mais escuro do CORPO do traje, um pouco mais escuro.

    Tirado da folha e não fixo em preto pra o contorno pertencer ao traje — no
    básico ele é um cinza-azulado, no reforçado é quase preto, e nos dois a
    peça fica com a borda da própria família de cor.
    """
    tons = [sheet.getpixel((x, y))[:3]
            for y in range(sheet.height) for x in range(sheet.width)
            if sheet.getpixel((x, y))[3] and saturacao(sheet.getpixel((x, y))) <= 0.6]
    if not tons:
        return (0, 0, 0)
    escuro = min(tons, key=luma)
    return tuple(round(c * 0.75) for c in escuro)


def recorte(piece):
    """Quais pixels são peça.

    O peitoral usa o recorte com braços daqui. Os outros três vêm das bases
    dele; o capacete sai FECHADO — cada linha do domo vira um trecho cheio, de
    ponta a ponta, e os dois pontos soltos embaixo saem.
    """
    from PIL import Image

    if piece == "chestplate":
        return [[c == "#" for c in linha] for linha in PEITORAL_COM_BRACOS]

    base = Image.open(os.path.join(ICON_BASE_DIR, f"{piece}.png")).convert("RGBA")
    mask = [[base.getpixel((x, y))[3] > 0 for x in range(16)] for y in range(16)]
    if piece != "helmet":
        return mask

    # Só o bloco de linhas GRUDADAS de cima: os pontos soltos lá embaixo ficam
    # de fora — com o queixo fechado eles flutuariam.
    linhas = [y for y in range(16) if any(mask[y])]
    corpo = [linhas[0]]
    for y in linhas[1:]:
        if y != corpo[-1] + 1:
            break
        corpo.append(y)

    fechado = [[False] * 16 for _ in range(16)]
    for y in corpo:
        cheios = [x for x in range(16) if mask[y][x]]
        for x in range(min(cheios), max(cheios) + 1):
            fechado[y][x] = True
    return fechado


def na_borda(mask, x, y):
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if not (0 <= nx < 16 and 0 <= ny < 16) or not mask[ny][nx]:
            return True
    return False


def make_icon(piece, sheets):
    from PIL import Image

    mask = recorte(piece)
    contorno = cor_do_contorno(sheets[1]) + (255,)

    out = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = out.load()

    for regiao in REGIOES[piece]:
        onde = regiao["onde"]
        dentro = [(x, y) for y in range(16) for x in range(16)
                  if mask[y][x] and onde(x, y)
                  and not (regiao.get("interior") and na_borda(mask, x, y))]
        if not dentro:
            continue
        x0 = min(x for x, _ in dentro); x1 = max(x for x, _ in dentro)
        y0 = min(y for _, y in dentro); y1 = max(y for _, y in dentro)
        su, sv, sw, sh = regiao["src"]
        sheet = sheets[regiao["camada"]]

        for x, y in dentro:
            # A parte do corpo é esticada pro tamanho do pedaço do ícone. O
            # desenho dela — as faixas, a caixa do peito, o visor — vem junto.
            fx = (x - x0) / max(1, x1 - x0 + 1 - 1) if x1 > x0 else 0
            fy = (y - y0) / max(1, y1 - y0 + 1 - 1) if y1 > y0 else 0
            if regiao.get("espelha"):
                fx = 1 - fx
            u = su + min(sw - 1, int(fx * (sw - 1) + 0.5))
            v = sv + min(sh - 1, int(fy * (sh - 1) + 0.5))
            c = sheet.getpixel((u, v))
            px[x, y] = c[:3] + (255,) if c[3] else contorno

    # O contorno por cima de tudo: sem ele a peça se dissolve no fundo do
    # inventário, que é justamente o que a borda escura dos ícones do jogo
    # resolve.
    for y in range(16):
        for x in range(16):
            if mask[y][x] and na_borda(mask, x, y):
                px[x, y] = contorno
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
                os.path.join(icon_dir, f"{icon_file(suit, piece)}.png"))

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
            if suit == "basic":
                pattern = BASICO_PATTERN[piece]
                key = {k: v for k, v in BASICO_KEY.items()
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
                # por cima do básico, com os minérios dos planetas
                key = dict(REFORCADO_KEY)
                key["S"] = {"item": item_id("basic", piece)}
                write_json(
                    os.path.join(BP, "recipes", f"{name}.json"),
                    {
                        "format_version": RECIPE_FORMAT,
                        "minecraft:recipe_shaped": {
                            "description": {"identifier": iid},
                            "tags": ["crafting_table"],
                            "pattern": REFORCADO_PATTERN,
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
            doc["texture_data"][icon_name(suit, piece)] = {
                "textures": f"textures/{NS}/items/{icon_file(suit, piece)}"
            }
    write_json(path, doc)

    # --- nomes -----------------------------------------------------------------
    MARK = "## trajes espaciais (gerado por tools/make_spacesuit.py)"
    # O bloco antigo tinha outro título e só o reforçado. Lista vazia apaga.
    OLD_MARK = "## traje espacial reforçado (gerado por tools/make_spacesuit.py)"
    for lang in ("pt_BR", "en_US", "en_GB", "es_ES", "es_MX"):
        replace_section(os.path.join(RP, "texts", f"{lang}.lang"), OLD_MARK, [])
    escreve_idiomas(
        RP, MARK,
        [f"item.{item_id(suit, piece)}={SUITS[suit]['pt'][piece]}"
         for suit in SUITS for piece in SLOTS],
        [f"item.{item_id(suit, piece)}={SUITS[suit]['en'][piece]}"
         for suit in SUITS for piece in SLOTS],
    )

    print(f"{len(SUITS)} trajes x {len(SLOTS)} peças = {len(SUITS) * len(SLOTS)} itens")
    print(f"  modelos: {', '.join(geo_ids)}")
    print(f"  {len(SUITS) * len(SLOTS)} attachables, {len(SUITS) * len(SLOTS)} ícones tirados das próprias texturas")
    print(f"  {recipes} receitas")
    print(f"  básico: {', '.join(sorted({v['item'].split(':')[1] for v in BASICO_KEY.values()}))}")
    print(f"  reforçado: peça do básico + {', '.join(sorted(v['item'].split(':')[1] for v in REFORCADO_KEY.values()))}")


if __name__ == "__main__":
    main()
