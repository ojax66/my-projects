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
from langfile import replace_section  # noqa: E402

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
# A SILHUETA vem das bases que ele mandou (tools/assets/armor_icon_base): são
# as formas de armadura do próprio jogo, que é o que faz o ícone parecer parte
# do inventário em vez de desenho de fora. Dali sai só o RECORTE — quais pixels
# são peça e quais são fundo.
#
# O DESENHO DE DENTRO é feito aqui, do zero, na cor do traje: contorno escuro
# na borda, luz vindo de cima e da esquerda como em todo ícone do jogo, e o
# detalhe de cada peça (o visor, a costura do peito, o cano da bota). Nada é
# copiado do sombreado da base.
#
# O capacete é FECHADO: a base vem com o rosto aberto e dois pontos soltos
# embaixo, e no lugar disso entra o visor.
ICON_BASE_DIR = os.path.join(ROOT, "tools", "assets", "armor_icon_base")

# O visor, no recorte do capacete: a faixa onde ficaria o rosto.
VISOR = (5, 6, 10, 9)               # x0, y0, x1, y1
FACE_UV = (8, 8)                    # canto da face frontal da cabeça na folha


def luma(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def saturacao(c):
    maior, menor = max(c[:3]), min(c[:3])
    return 0 if maior == 0 else (maior - menor) / maior


def paleta_do_traje(sheet, degraus=5):
    """Os tons do CORPO do traje, do escuro pro claro.

    A face do capacete fica de fora: o visor é dourado no básico, e deixá-lo
    entrar puxaria a armadura inteira pro amarelo. Cor muito saturada também
    sai — num traje ela é detalhe (a faixa laranja), não o corpo.

    O limiar é ALTO de propósito. Com 0,35 o azul-marinho do traje reforçado
    (saturação 0,39) caía junto com a faixa laranja, e o ícone saía cinza-claro
    em vez de marinho — o traje escuro virava o traje claro. 0,6 deixa passar o
    corpo e continua barrando o dourado (0,79) e o laranja (0,88).
    """
    from collections import Counter

    SATURADO = 0.6
    conta = Counter()
    for y in range(sheet.height):
        for x in range(sheet.width):
            if FACE_UV[0] <= x < FACE_UV[0] + 8 and FACE_UV[1] <= y < FACE_UV[1] + 8:
                continue
            c = sheet.getpixel((x, y))
            if c[3] == 0 or saturacao(c) > SATURADO:
                continue
            conta[c[:3]] += 1
    if not conta:
        raise SystemExit("a folha do traje não tem tom de corpo nenhum")

    tons = sorted((c for c, _ in conta.most_common(12)), key=luma)
    return [tons[round(i * (len(tons) - 1) / (degraus - 1))] for i in range(degraus)]


def tons_do_visor(sheet):
    """Escuro, meio e claro do visor daquele traje.

    O meio é o tom MAIS USADO do rosto — no básico o dourado, no reforçado o
    azul. Ordenar o rosto e pegar o do meio não servia: entram os pixels da
    moldura do capacete, e no básico o "meio" saía cinza, o que apagava o
    dourado justamente no lugar em que ele é a marca do traje.
    """
    from collections import Counter

    reg = [sheet.getpixel((FACE_UV[0] + x, FACE_UV[1] + y))[:3]
           for y in range(1, 7) for x in range(1, 7)]
    meio = Counter(reg).most_common(1)[0][0]
    escuro = tuple(round(c * 0.55) for c in meio)
    claro = tuple(min(255, round(c + (255 - c) * 0.45)) for c in meio)
    return [escuro, meio, claro]


def recorte(piece):
    """Quais pixels são peça, lidos da base dele.

    O capacete sai FECHADO: a base traz o rosto vazado e dois pontos soltos
    embaixo. Cada linha do domo vira um trecho cheio, de ponta a ponta, e os
    pontos soltos somem — é onde o visor entra.
    """
    from PIL import Image

    base = Image.open(os.path.join(ICON_BASE_DIR, f"{piece}.png")).convert("RGBA")
    mask = [[base.getpixel((x, y))[3] > 0 for x in range(16)] for y in range(16)]
    if piece != "helmet":
        return mask

    # Só o bloco de linhas GRUDADAS de cima: os dois pontos soltos lá embaixo
    # ficam de fora — com o queixo fechado eles flutuariam.
    linhas = [y for y in range(16) if any(mask[y])]
    corpo = [linhas[0]]
    for y in linhas[1:]:
        if y != corpo[-1] + 1:
            break
        corpo.append(y)

    fechado = [[False] * 16 for _ in range(16)]
    for y in corpo:
        cheios = [x for x in range(16) if mask[y][x]]
        # A linha do queixo vem partida no meio; fechar é preencher de ponta a
        # ponta. O resto do domo já é inteiro e não muda.
        for x in range(min(cheios), max(cheios) + 1):
            fechado[y][x] = True
    return fechado


def na_borda(mask, x, y):
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if not (0 <= nx < 16 and 0 <= ny < 16) or not mask[ny][nx]:
            return True
    return False


def tom_do_corpo(piece, x, y, caixa):
    """O tom (0 escuro … 4 claro) de um pixel de dentro da peça.

    A base de tudo é a luz de cima e da esquerda, que é como o jogo desenha
    metal: o alto-esquerdo é o mais claro, o baixo-direito o mais escuro. Por
    cima disso vem o detalhe de cada peça.
    """
    x0, y0, x1, y1 = caixa
    nx = (x - x0) / max(1, x1 - x0)
    ny = (y - y0) / max(1, y1 - y0)
    tom = 4.0 - 1.9 * (0.45 * nx + 0.55 * ny)

    if piece == "chestplate":
        if y <= 4:
            tom += 0.7                       # ombreiras, a parte que pega luz
        if x in (7, 8) and y >= 5:
            tom -= 1.1                       # a costura do meio do peito
        if y >= 8 and (y - 8) % 2 == 1:
            tom -= 0.6                       # as costelas do peitoral
        if y >= 13:
            tom -= 0.6                       # a barra de baixo, na sombra
    elif piece == "leggings":
        if y <= 3:
            tom -= 0.9                       # o cinto
        if y == 10:
            tom -= 0.7                       # o reforço do joelho
        if x in (3, 4, 11, 12):
            tom -= 0.5                       # o lado de fora de cada perna
        if x in (7, 8):
            tom -= 0.3                       # a virilha, entre as pernas
    elif piece == "boots":
        if y >= 11:
            tom -= 1.4                       # a sola
        elif y >= 9:
            tom += 0.5                       # o peito do pé, virado pra cima
        if y <= 5:
            tom -= 0.3                       # o cano, mais estreito e sombreado
    elif piece == "helmet":
        # Sem bônus no alto: o capacete é pequeno e o degradê inteiro cabia nas
        # três primeiras linhas, o que deixava o domo quase branco enquanto o
        # peitoral do mesmo traje ficava escuro — os dois pareciam de trajes
        # diferentes no inventário.
        if y >= 10:
            tom -= 1.0                       # o queixo, na sombra

    return max(1, min(4, round(tom)))


def no_visor(x, y):
    """O pixel cai no visor? Os quatro cantos ficam de fora: é o que arredonda
    o vidro em vez de deixar um retângulo colado no meio do capacete."""
    x0, y0, x1, y1 = VISOR
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    return not ((x in (x0, x1)) and (y in (y0, y1)))


def tom_do_visor(x, y):
    """O vidro é a parte CLARA do capacete, não uma faixa escura.

    Luz na maior parte dele, a curva do lado direito um tom abaixo e a sombra
    na borda de baixo. É o que faz o visor ler como vidro nos dois trajes — no
    reforçado, que é marinho, um visor no tom do corpo sumia dentro do
    capacete.
    """
    x0, y0, x1, y1 = VISOR
    if y == y1:
        return 0                             # a sombra da borda de baixo
    if x >= x1 - 1:
        return 1                             # a curva do lado direito
    return 2                                 # o vidro


def make_icon(piece, sheets):
    from PIL import Image

    corpo = paleta_do_traje(sheets[1])
    visor = tons_do_visor(sheets[1])
    mask = recorte(piece)

    xs = [x for y in range(16) for x in range(16) if mask[y][x]]
    ys = [y for y in range(16) for x in range(16) if mask[y][x]]
    caixa = (min(xs), min(ys), max(xs), max(ys))

    out = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = out.load()
    for y in range(16):
        for x in range(16):
            if not mask[y][x]:
                continue
            if na_borda(mask, x, y):
                px[x, y] = corpo[0] + (255,)          # o contorno
                continue
            if piece == "helmet" and no_visor(x, y):
                px[x, y] = visor[tom_do_visor(x, y)] + (255,)
                continue
            px[x, y] = corpo[tom_do_corpo(piece, x, y, caixa)] + (255,)
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
    print(f"  básico: {', '.join(sorted({v['item'].split(':')[1] for v in BASICO_KEY.values()}))}")
    print(f"  reforçado: peça do básico + {', '.join(sorted(v['item'].split(':')[1] for v in REFORCADO_KEY.values()))}")


if __name__ == "__main__":
    main()
