#!/usr/bin/env python3
"""Gera o Traje Espacial Reforçado — a versão melhorada do traje do Spacecraft.

É um degrau ENTRE o traje do Spacecraft e a armadura de estrela: ajuda contra a
pressão e o calor, sem anular como a de estrela. Feito a partir do traje deles
mais materiais dos planetas deles.

Modelo e textura são os DO SPACECRAFT, reaproveitados por referência em vez de
copiados: os packs de recurso se fundem no mundo, então apontar pro caminho
`textures/nv/moon/entity/spacesuit` e pra `geometry.nv_sc.nv_moon.*` funciona e
evita duplicar a arte de outra pessoa dentro deste addon. Se o Spacecraft não
estiver no mundo o traje fica sem textura — mas ele também não teria como ser
fabricado, já que a receita inteira é de itens de lá.
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "Space Dimension BP")
RP = os.path.join(ROOT, "packs", "Space Dimension RP")
NS = "space_dim"
SC = "nv_sc"
FORMAT_VERSION = "1.21.80"
# Receita usa outro schema — ver a nota em make_star_gear.py. "1.21.80" numa
# receita faz o arquivo não carregar sem avisar nada.
RECIPE_FORMAT = "1.12"

# Materiais dos planetas do Spacecraft que entram no reforço.
#   T titânio (Lua) — estrutura que aguenta pressão
#   M magnetita (Marte)
#   A liga de andrenita (Andrella) — o material tardio deles
#   H liga de termita — a parte que aguenta calor
#   F tecido isolante
MATERIALS = {
    "T": f"{SC}:titanium_plate",
    "M": f"{SC}:magnetite_ingot",
    "A": f"{SC}:andrenite_alloy",
    "H": f"{SC}:thermite_alloy",
    "F": f"{SC}:insulated_fabric",
}

# A peça do traje deles vai no meio; o resto é o reforço em volta.
RECIPE_PATTERN = ["HMH", "ASA", "TFT"]

# O traje base é 3 de proteção e 320 de durabilidade em todas as peças. A
# armadura de estrela é 4/9/7/4. O reforçado fica no meio dos dois.
PIECES = {
    "reinforced_spacesuit_helmet": dict(
        base=f"{SC}:spacesuit_helmet",
        slot="slot.armor.head", protection=3, durability=480,
        ench_slot="armor_head", group="minecraft:itemGroup.name.helmet",
        geometry=f"geometry.{SC}.nv_moon.spacesuit_helmet",
        icon=f"textures/nv/moon/items/armor/spacesuit_helmet",
        hide="variable.helmet_layer_visible = 0.0;",
        pt="Capacete Espacial Reforçado", en="Reinforced Spacesuit Helmet",
    ),
    "reinforced_spacesuit_chestplate": dict(
        base=f"{SC}:spacesuit_chestplate",
        slot="slot.armor.chest", protection=7, durability=620,
        ench_slot="armor_torso", group="minecraft:itemGroup.name.chestplate",
        geometry=f"geometry.{SC}.nv_moon.spacesuit_chestplate",
        icon=f"textures/nv/moon/items/armor/spacesuit_chestplate",
        hide="variable.chest_layer_visible = 0.0;",
        pt="Peitoral Espacial Reforçado", en="Reinforced Spacesuit Chestplate",
    ),
    "reinforced_spacesuit_leggings": dict(
        base=f"{SC}:spacesuit_leggings",
        slot="slot.armor.legs", protection=5, durability=580,
        ench_slot="armor_legs", group="minecraft:itemGroup.name.leggings",
        geometry=f"geometry.{SC}.nv_moon.spacesuit_leggings",
        icon=f"textures/nv/moon/items/armor/spacesuit_leggings",
        hide="variable.leg_layer_visible = 0.0;",
        pt="Calças Espaciais Reforçadas", en="Reinforced Spacesuit Leggings",
    ),
    "reinforced_spacesuit_boots": dict(
        base=f"{SC}:spacesuit_boots",
        slot="slot.armor.feet", protection=3, durability=500,
        ench_slot="armor_feet", group="minecraft:itemGroup.name.boots",
        geometry=f"geometry.{SC}.nv_moon.spacesuit_boots",
        icon=f"textures/nv/moon/items/armor/spacesuit_boots",
        hide="variable.boot_layer_visible = 0.0;",
        pt="Botas Espaciais Reforçadas", en="Reinforced Spacesuit Boots",
    ),
}

SUIT_TEXTURE = "textures/nv/moon/entity/spacesuit"


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def main():
    for name, spec in PIECES.items():
        # --- item ------------------------------------------------------------
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
                                "items": [MATERIALS["T"]],
                                "repair_amount": spec["durability"] // 5,
                            }],
                        },
                        "minecraft:enchantable": {"value": 12, "slot": spec["ench_slot"]},
                        "minecraft:fire_resistant": True,
                        "minecraft:hover_text_color": "aqua",
                    },
                },
            },
        )

        # --- attachable: modelo e textura do Spacecraft ----------------------
        write_json(
            os.path.join(RP, "attachables", f"{name}.json"),
            {
                "format_version": "1.10.0",
                "minecraft:attachable": {
                    "description": {
                        "identifier": f"{NS}:{name}",
                        "materials": {"default": "armor", "enchanted": "armor_enchanted"},
                        "textures": {
                            "default": SUIT_TEXTURE,
                            "enchanted": "textures/misc/enchanted_actor_glint",
                        },
                        "geometry": {"default": spec["geometry"]},
                        "scripts": {"parent_setup": spec["hide"]},
                        "render_controllers": ["controller.render.armor"],
                    },
                },
            },
        )

        # --- receita ---------------------------------------------------------
        key = {k: {"item": v} for k, v in MATERIALS.items()}
        key["S"] = {"item": spec["base"]}
        write_json(
            os.path.join(BP, "recipes", f"{name}.json"),
            {
                "format_version": RECIPE_FORMAT,
                "minecraft:recipe_shaped": {
                    "description": {"identifier": f"{NS}:{name}"},
                    "tags": ["crafting_table"],
                    "pattern": RECIPE_PATTERN,
                    "key": key,
                    "result": {"item": f"{NS}:{name}", "count": 1},
                },
            },
        )

    # --- ícones: os do próprio Spacecraft --------------------------------------
    # Reaproveitados por caminho, como a textura do modelo. Sem cópia de arte.
    path = os.path.join(RP, "textures", "item_texture.json")
    doc = json.load(open(path, encoding="utf-8")) if os.path.isfile(path) else {
        "resource_pack_name": NS, "texture_name": "atlas.items", "texture_data": {},
    }
    for name, spec in PIECES.items():
        doc["texture_data"][f"{NS}_{name}"] = {"textures": spec["icon"]}
    write_json(path, doc)

    # --- nomes -----------------------------------------------------------------
    MARK = "## traje espacial reforçado (gerado por tools/make_spacesuit.py)"
    for lang, key in (("pt_BR", "pt"), ("en_US", "en"), ("en_GB", "en")):
        lang_path = os.path.join(BP, "texts", f"{lang}.lang")
        existing = ""
        if os.path.isfile(lang_path):
            with open(lang_path, encoding="utf-8") as f:
                existing = f.read().split(MARK)[0].rstrip("\n")
        lines = [existing, "", MARK]
        for name, spec in PIECES.items():
            lines.append(f"item.{NS}:{name}={spec[key]}")
        with open(lang_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    print(f"{len(PIECES)} peças do traje reforçado")
    print(f"  modelo e textura: reaproveitados do Spacecraft (sem cópia)")
    print(f"  receita: peça do traje + {', '.join(sorted(set(MATERIALS.values())))}")


if __name__ == "__main__":
    main()
