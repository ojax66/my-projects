#!/usr/bin/env python3
"""Gera os itens, receitas, modelos e attachables do equipamento de estrela.

Como no make_blocks.py, a fonte é a tabela aqui embaixo e os arquivos dos dois
packs saem dela — item JSON, receita, attachable, ícone, entrada no
item_texture.json e nome no .lang. São seis lugares por peça; escrever à mão é
convite a esquecer um e o item virar cubo roxo sem nome.

O modelo da armadura veio pronto (tools/assets/star_armor_src.geo.json), com
capacete, peitoral e botas no MESMO geo. Aqui ele é dividido em três — um por
peça — e os ossos são renomeados pros nomes que o esqueleto do jogador usa
(`head`, `body`, `leftArm`…), que é o que faz a armadura acompanhar a pose.
A calça usa o modelo padrão do jogo, como pedido.
"""
import json
import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "Space Dimension BP")
RP = os.path.join(ROOT, "packs", "Space Dimension RP")
NS = "space_dim"
FORMAT_VERSION = "1.21.80"

SRC_GEO = os.path.join(ROOT, "tools", "assets", "star_armor_src.geo.json")

# Nome do osso no modelo enviado -> nome do osso no esqueleto do jogador.
# Sem isso a armadura fica parada enquanto o jogador anda.
BONE_MAP = {
    "Head": "head",
    "Body": "body",
    "Right Arm": "rightArm",
    "Left Arm": "leftArm",
    "Right Leg": "rightLeg",
    "Left Leg": "leftLeg",
}

# Que ossos entram em cada peça.
PIECE_BONES = {
    "helmet": ["head"],
    "chestplate": ["body", "rightArm", "leftArm"],
    "boots": ["rightLeg", "leftLeg"],
}

# Altura da bota, em unidades do modelo. O modelo enviado traz a perna INTEIRA
# nos ossos de perna; bota é só o pé, então os cubos são cortados na base.
BOOT_HEIGHT = 4
# Ossos que levam esse corte.
BOOT_TRIM_BONES = {"rightLeg", "leftLeg"}

# --- Peças da armadura -------------------------------------------------------
# Netherite é 3/8/6/3 de proteção e 407/592/555/481 de durabilidade. A de
# estrela vem depois dela na progressão, então fica um degrau acima.
ARMOR = {
    "star_helmet": dict(
        slot="slot.armor.head", protection=4, durability=610,
        ench_slot="armor_head", group="minecraft:itemGroup.name.helmet",
        pt="Capacete de Estrela", en="Star Helmet",
        geometry=f"geometry.{NS}.star_armor.helmet",
        texture=f"textures/{NS}/armor/star_armor",
        hide="variable.helmet_layer_visible = 0.0;",
        base="minecraft:netherite_helmet",
    ),
    "star_chestplate": dict(
        slot="slot.armor.chest", protection=9, durability=888,
        ench_slot="armor_torso", group="minecraft:itemGroup.name.chestplate",
        pt="Peitoral de Estrela", en="Star Chestplate",
        geometry=f"geometry.{NS}.star_armor.chestplate",
        texture=f"textures/{NS}/armor/star_armor",
        hide="variable.chest_layer_visible = 0.0;",
        base="minecraft:netherite_chestplate",
    ),
    # A calça usa o modelo padrão do jogo, com a camada 64x32 que veio junto.
    "star_leggings": dict(
        slot="slot.armor.legs", protection=7, durability=832,
        ench_slot="armor_legs", group="minecraft:itemGroup.name.leggings",
        pt="Calças de Estrela", en="Star Leggings",
        geometry="geometry.humanoid.armor.leggings",
        texture=f"textures/{NS}/armor/star_armor_legs",
        hide="variable.leg_layer_visible = 0.0;",
        base="minecraft:netherite_leggings",
    ),
    "star_boots": dict(
        slot="slot.armor.feet", protection=4, durability=721,
        ench_slot="armor_feet", group="minecraft:itemGroup.name.boots",
        pt="Botas de Estrela", en="Star Boots",
        geometry=f"geometry.{NS}.star_armor.boots",
        texture=f"textures/{NS}/armor/star_armor",
        hide="variable.boot_layer_visible = 0.0;",
        base="minecraft:netherite_boots",
    ),
}

# --- Itens soltos ------------------------------------------------------------
ITEMS = {
    "star_core_shard": dict(
        pt="Fragmento de Núcleo de Estrela", en="Star Core Shard",
        stack=64, group="minecraft:itemGroup.name.miscFood", glint=False,
    ),
    "star_core_ingot": dict(
        pt="Barra de Núcleo de Estrela", en="Star Core Ingot",
        stack=64, group="minecraft:itemGroup.name.miscFood", glint=False,
    ),
    "star_upgrade_template": dict(
        pt="Molde de Ferraria de Estrela", en="Star Upgrade Smithing Template",
        stack=64, group="minecraft:itemGroup.name.miscFood", glint=True,
    ),
}

# O bloco de onde saem os fragmentos: é o núcleo do Sol, lá no meio dele.
STAR_CORE_BLOCK = f"{NS}:sun_core"
# Bloco usado pra duplicar o molde, como o netherrack faz no molde de netherite.
TEMPLATE_FILLER = "minecraft:end_stone"


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


# --- Ícones do inventário ----------------------------------------------------
# As texturas que vieram cobrem o modelo 3D e a camada da calça, mas não os
# ícones das quatro peças no inventário. Estes são desenhados aqui, na mesma
# paleta da armadura, com as silhuetas de sempre.
STAR_PALETTE = {
    "line": (0xB8, 0x8A, 0x10),
    "dark": (0xE8, 0xB8, 0x2A),
    "mid": (0xF7, 0xD9, 0x5C),
    "light": (0xFF, 0xF0, 0xAE),
    "hi": (0xFF, 0xFC, 0xE0),
}

# 16x16, uma letra por pixel: . vazio, o contorno, d escuro, m médio, c claro,
# h brilho. Silhuetas iguais às da armadura do jogo, pra ler de imediato.
ICON_ART = {
    "star_helmet": [
        "................",
        "................",
        "....oooooooo....",
        "..oommmmmmmmoo..",
        ".ommcccccccccmo.",
        ".omcchhhhhhccmo.",
        ".omcc..hh..ccmo.",
        ".omc........cmo.",
        ".omc........cmo.",
        ".omcc......ccmo.",
        ".ommccccccccmmo.",
        "..oommmmmmmmoo..",
        "..oo........oo..",
        "................",
        "................",
        "................",
    ],
    "star_chestplate": [
        "................",
        "..oo........oo..",
        ".ommmoooooommmo.",
        ".omcmmmmmmmmcmo.",
        ".omccccccccccmo.",
        ".omcchhhhhhccmo.",
        ".omcchhhhhhccmo.",
        ".omccccccccccmo.",
        ".omcmmmmmmmmcmo.",
        ".ommmmmmmmmmmmo.",
        ".ommmmmmmmmmmmo.",
        "..oooooooooooo..",
        "................",
        "................",
        "................",
        "................",
    ],
    "star_leggings": [
        "................",
        "................",
        "..oooooooooooo..",
        ".ommmmmmmmmmmmo.",
        ".omccccccccccmo.",
        ".omchhhhhhhhcmo.",
        ".omccccccccccmo.",
        ".ommmmoooommmmo.",
        ".ommmo....ommmo.",
        ".omcmo....omcmo.",
        ".omcmo....omcmo.",
        ".omcmo....omcmo.",
        ".ommmo....ommmo.",
        "..ooo......ooo..",
        "................",
        "................",
    ],
    "star_boots": [
        "................",
        "................",
        "................",
        "................",
        "..ooo......ooo..",
        ".ommmo....ommmo.",
        ".omcmo....omcmo.",
        ".omcmo....omcmo.",
        ".omcmo....omcmo.",
        ".ommmoo..oommmo.",
        ".omccccooccccmo.",
        ".omchhhoohhhcmo.",
        ".ommmmmoommmmmo.",
        "..oooooooooooo..",
        "................",
        "................",
    ],
}

ICON_KEY = {
    "o": "line", "d": "dark", "m": "mid", "c": "light", "h": "hi",
}


def write_png(path, rows):
    h, w = len(rows), len(rows[0])
    raw = b"".join(b"\x00" + bytes(v for px in row for v in px) for row in rows)

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(png)


def render_icon(art):
    # Erro de contagem no desenho é fácil de cometer e some se a linha for
    # completada em silêncio — então aqui ele estoura.
    if len(art) != 16:
        raise SystemExit(f"ícone com {len(art)} linhas, esperado 16")
    for i, line in enumerate(art):
        if len(line) != 16:
            raise SystemExit(f"linha {i} do ícone tem {len(line)} colunas, esperado 16")

    rows = []
    for line in art:
        row = []
        for ch in line:
            key = ICON_KEY.get(ch)
            row.append(STAR_PALETTE[key] + (255,) if key else (0, 0, 0, 0))
        rows.append(row)
    return rows


# --- Corte da bota -----------------------------------------------------------
def box_uv_faces(u, v, w, h, d):
    """Onde cada face cai na textura, no layout de caixa do Bedrock.

    Um `uv: [u, v]` com `size: [w, h, d]` se desdobra sempre assim; saber o
    layout é o que permite recortar só a parte de baixo do desenho da perna.
    """
    return {
        "up":    ([u + d, v], [w, d]),
        "down":  ([u + d + w, v], [w, d]),
        "west":  ([u, v + d], [d, h]),
        "north": ([u + d, v + d], [w, h]),
        "east":  ([u + d + w, v + d], [d, h]),
        "south": ([u + d + w + d, v + d], [w, h]),
    }


def trim_leg_to_boot(cube, boot_h):
    """Uma perna inteira vira só o pé, com a textura certa.

    Encolher o cubo e deixar o `uv` de caixa mostraria o ALTO da perna — a coxa
    esticada no pé. Então as faces laterais passam a ser declaradas uma a uma,
    puxando as últimas `boot_h` linhas do desenho da perna; a de cima e a de
    baixo ficam onde estavam.
    """
    ox, oy, oz = cube["origin"]
    w, h, d = cube["size"]
    if h <= boot_h:
        return dict(cube)

    u, v = cube["uv"]
    faces = box_uv_faces(u, v, w, h, d)
    drop = h - boot_h                     # quanto da perna fica de fora

    out = {}
    for name, (uv, size) in faces.items():
        if name in ("up", "down"):
            out[name] = {"uv": list(uv), "uv_size": list(size)}
        else:
            out[name] = {"uv": [uv[0], uv[1] + drop], "uv_size": [size[0], boot_h]}

    # Com UV por face o `mirror` do cubo deixa de valer: a inversão vira a troca
    # das faces laterais.
    if cube.get("mirror"):
        out["west"], out["east"] = out["east"], out["west"]

    trimmed = {
        "origin": [ox, oy, oz],
        "size": [w, boot_h, d],
        "uv": out,
    }
    if "inflate" in cube:
        trimmed["inflate"] = cube["inflate"]
    return trimmed


# --- Divisão do modelo -------------------------------------------------------
def split_geometry():
    """Um geo por peça, com os ossos renomeados pro esqueleto do jogador."""
    src = json.load(open(SRC_GEO, encoding="utf-8"))["minecraft:geometry"][0]
    desc = src["description"]

    by_name = {}
    for bone in src["bones"]:
        mapped = BONE_MAP.get(bone["name"])
        if not mapped:
            raise SystemExit(f"osso desconhecido no modelo: {bone['name']!r}")
        clone = dict(bone)
        clone["name"] = mapped
        by_name[mapped] = clone

    geometries = []
    for piece, bones in PIECE_BONES.items():
        missing = [b for b in bones if b not in by_name]
        if missing:
            raise SystemExit(f"{piece}: faltam ossos {missing}")

        piece_bones = []
        for b in bones:
            bone = dict(by_name[b])
            if piece == "boots" and b in BOOT_TRIM_BONES:
                bone["cubes"] = [trim_leg_to_boot(c, BOOT_HEIGHT) for c in bone.get("cubes", [])]
            piece_bones.append(bone)

        geometries.append({
            "description": {
                "identifier": f"geometry.{NS}.star_armor.{piece}",
                "texture_width": desc["texture_width"],
                "texture_height": desc["texture_height"],
                "visible_bounds_width": desc.get("visible_bounds_width", 4),
                "visible_bounds_height": desc.get("visible_bounds_height", 3.5),
                "visible_bounds_offset": desc.get("visible_bounds_offset", [0, 1.25, 0]),
            },
            "bones": piece_bones,
        })

    write_json(
        os.path.join(RP, "models", "entity", "star_armor.geo.json"),
        {"format_version": "1.12.0", "minecraft:geometry": geometries},
    )
    return [g["description"]["identifier"] for g in geometries]


# --- Geração -----------------------------------------------------------------
def main():
    geo_ids = split_geometry()

    # --- itens soltos --------------------------------------------------------
    for name, spec in ITEMS.items():
        components = {
            "minecraft:icon": f"{NS}_{name}",
            "minecraft:max_stack_size": spec["stack"],
            "minecraft:hover_text_color": "yellow",
        }
        if spec["glint"]:
            components["minecraft:glint"] = True
        write_json(
            os.path.join(BP, "items", f"{name}.json"),
            {
                "format_version": FORMAT_VERSION,
                "minecraft:item": {
                    "description": {
                        "identifier": f"{NS}:{name}",
                        "menu_category": {"category": "items", "group": spec["group"]},
                    },
                    "components": components,
                },
            },
        )

    # --- peças da armadura ---------------------------------------------------
    for name, spec in ARMOR.items():
        write_json(
            os.path.join(BP, "items", f"{name}.json"),
            {
                "format_version": FORMAT_VERSION,
                "minecraft:item": {
                    "description": {
                        "identifier": f"{NS}:{name}",
                        "menu_category": {"category": "equipment", "group": spec["group"]},
                    },
                    "components": {
                        "minecraft:icon": f"{NS}_{name}",
                        "minecraft:max_stack_size": 1,
                        "minecraft:durability": {"max_durability": spec["durability"]},
                        "minecraft:wearable": {
                            "slot": spec["slot"],
                            "protection": spec["protection"],
                        },
                        "minecraft:repairable": {
                            "repair_items": [{
                                "items": [f"{NS}:star_core_ingot"],
                                "repair_amount": spec["durability"] // 4,
                            }],
                        },
                        "minecraft:enchantable": {"value": 15, "slot": spec["ench_slot"]},
                        # Feita do núcleo de uma estrela: não é o fogo que vai
                        # queimar a peça largada no chão.
                        "minecraft:fire_resistant": True,
                        "minecraft:hover_text_color": "yellow",
                    },
                },
            },
        )

        # attachable — é o que faz a peça aparecer vestida
        write_json(
            os.path.join(RP, "attachables", f"{name}.json"),
            {
                "format_version": "1.10.0",
                "minecraft:attachable": {
                    "description": {
                        "identifier": f"{NS}:{name}",
                        "materials": {
                            "default": "armor",
                            "enchanted": "armor_enchanted",
                        },
                        "textures": {
                            "default": spec["texture"],
                            "enchanted": "textures/misc/enchanted_actor_glint",
                        },
                        "geometry": {"default": spec["geometry"]},
                        # Esconde a camada de armadura padrão embaixo, senão a
                        # peça de netherite aparece por dentro da de estrela.
                        "scripts": {"parent_setup": spec["hide"]},
                        "render_controllers": ["controller.render.armor"],
                    },
                },
            },
        )

    # --- ícones --------------------------------------------------------------
    icon_dir = os.path.join(RP, "textures", NS, "items")
    for name, art in ICON_ART.items():
        write_png(os.path.join(icon_dir, f"{name}.png"), render_icon(art))

    # --- item_texture.json ---------------------------------------------------
    texture_data = {}
    for name in list(ITEMS) + list(ARMOR):
        texture_data[f"{NS}_{name}"] = {
            "textures": f"textures/{NS}/items/{name}"
        }
    write_json(
        os.path.join(RP, "textures", "item_texture.json"),
        {
            "resource_pack_name": NS,
            "texture_name": "atlas.items",
            "texture_data": texture_data,
        },
    )

    # --- receitas ------------------------------------------------------------
    recipe_dir = os.path.join(BP, "recipes")

    # bloco de núcleo -> 9 fragmentos
    write_json(
        os.path.join(recipe_dir, "star_core_shard_from_block.json"),
        {
            "format_version": FORMAT_VERSION,
            "minecraft:recipe_shapeless": {
                "description": {"identifier": f"{NS}:star_core_shard_from_block"},
                "tags": ["crafting_table"],
                "ingredients": [{"item": STAR_CORE_BLOCK}],
                "result": {"item": f"{NS}:star_core_shard", "count": 9},
            },
        },
    )

    # 4 fragmentos + 4 diamantes -> 1 barra (o craft da netherite, com diamante
    # no lugar do ouro e o fragmento no lugar da sucata)
    write_json(
        os.path.join(recipe_dir, "star_core_ingot.json"),
        {
            "format_version": FORMAT_VERSION,
            "minecraft:recipe_shapeless": {
                "description": {"identifier": f"{NS}:star_core_ingot"},
                "tags": ["crafting_table"],
                "ingredients": (
                    [{"item": f"{NS}:star_core_shard"}] * 4
                    + [{"item": "minecraft:diamond"}] * 4
                ),
                "result": {"item": f"{NS}:star_core_ingot", "count": 1},
            },
        },
    )

    # duplicação do molde: gasta o original e devolve 2, como os do jogo
    write_json(
        os.path.join(recipe_dir, "star_upgrade_template_duplication.json"),
        {
            "format_version": FORMAT_VERSION,
            "minecraft:recipe_shaped": {
                "description": {"identifier": f"{NS}:star_upgrade_template_duplication"},
                "tags": ["crafting_table"],
                "pattern": ["DTD", "DED", "DDD"],
                "key": {
                    "D": {"item": "minecraft:diamond"},
                    "T": {"item": f"{NS}:star_upgrade_template"},
                    "E": {"item": TEMPLATE_FILLER},
                },
                "result": {"item": f"{NS}:star_upgrade_template", "count": 2},
            },
        },
    )

    # netherite + barra de estrela + molde, na bancada de ferraria
    for name, spec in ARMOR.items():
        write_json(
            os.path.join(recipe_dir, f"{name}_smithing.json"),
            {
                "format_version": FORMAT_VERSION,
                "minecraft:recipe_smithing_transform": {
                    "description": {"identifier": f"{NS}:{name}_smithing"},
                    "tags": ["smithing_table"],
                    "template": f"{NS}:star_upgrade_template",
                    "base": spec["base"],
                    "addition": f"{NS}:star_core_ingot",
                    "result": f"{NS}:{name}",
                },
            },
        )

    # --- nomes ---------------------------------------------------------------
    MARK = "## equipamento de estrela (gerado por tools/make_star_gear.py)"
    for lang, key in (("pt_BR", "pt"), ("en_US", "en"), ("en_GB", "en")):
        path = os.path.join(BP, "texts", f"{lang}.lang")
        existing = ""
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as f:
                existing = f.read().split(MARK)[0].rstrip("\n")
        lines = [existing, "", MARK]
        for name, spec in list(ITEMS.items()) + list(ARMOR.items()):
            lines.append(f"item.{NS}:{name}={spec[key]}")
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    print(f"{len(ITEMS)} itens + {len(ARMOR)} peças de armadura")
    print(f"  geometrias: {', '.join(geo_ids)}")
    print(f"  {len(ARMOR)} attachables, {len(ICON_ART)} ícones desenhados")
    print(f"  {3 + len(ARMOR)} receitas")


if __name__ == "__main__":
    main()
