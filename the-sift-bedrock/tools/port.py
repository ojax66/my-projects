#!/usr/bin/env python3
"""
Gera o add-on Bedrock de "Mielon's The Sift" a partir do .jar do mod Fabric.

Uso:
    python3 tools/port.py <pasta-do-jar-extraido>

Tudo o que é conteúdo (JSON de blocos/itens/entidades, texturas, sons,
estruturas, lang) sai daqui, lido direto do jar. Os scripts (.js) do BP são
escritos à mão e ficam em packs/TheSift_BP/scripts — este gerador não mexe
neles.
"""
import json
import os
import re
import shutil
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

NS = "the_sift"
VERSION = [1, 0, 2]
BP_UUID = "0caf9b80-37b0-4cc3-ad66-11ba4d1ad1e1"
BP_DATA_UUID = "1e2c2fdb-9459-490a-88f3-18ed08a4cab7"
BP_SCRIPT_UUID = "902ee37b-fbf3-4eab-ba19-c8a9c72dbedc"
RP_UUID = "a16ce5a0-b0f0-4ed6-809b-3dc41d0d0d95"
RP_RES_UUID = "2777fd9a-2c58-40ec-b579-3d844a5fe739"
MIN_ENGINE = [1, 26, 40]
BLOCK_FMT = "1.26.40"
ITEM_FMT = "1.26.40"

BP = os.path.join(ROOT, "packs", "TheSift_BP")
RP = os.path.join(ROOT, "packs", "TheSift_RP")

JAR = None  # definido em main()


def src(*p):
    return os.path.join(JAR, *p)


def asset(*p):
    return src("assets", NS, *p)


def data(*p):
    return src("data", NS, *p)


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
        f.write("\n")


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def sid(name):
    return NS + ":" + name


# ---------------------------------------------------------------------------
# Texturas
# ---------------------------------------------------------------------------
TERRAIN = {}   # chave -> caminho sem extensão
ITEMS_TEX = {}
FLIPBOOKS = []


def copy_png(src_path, dst_rel):
    dst = os.path.join(RP, dst_rel + ".png")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(src_path, dst)
    return dst_rel


def block_tex(name, file=None):
    """Registra uma textura de bloco no atlas e devolve a chave."""
    file = file or name
    key = NS + "_" + name
    if key not in TERRAIN:
        rel = copy_png(asset("textures", "block", file + ".png"), "textures/the_sift/blocks/" + file)
        TERRAIN[key] = rel
    return key


def item_tex(name, file=None, folder="item"):
    file = file or name
    key = NS + "_" + name
    if key not in ITEMS_TEX:
        sub = "items" if folder == "item" else "blocks"
        rel = copy_png(asset("textures", folder, file + ".png"), "textures/the_sift/" + sub + "/" + file)
        ITEMS_TEX[key] = rel
    return key


def downscale_flipbook(name, frame_px=16):
    """As animações do ichor são 256x8192 (32 quadros de 256). Reduz pra 16px."""
    im = Image.open(asset("textures", "block", name + ".png")).convert("RGBA")
    w, h = im.size
    frames = h // w
    out = Image.new("RGBA", (frame_px, frame_px * frames))
    for i in range(frames):
        fr = im.crop((0, i * w, w, (i + 1) * w)).resize((frame_px, frame_px), Image.LANCZOS)
        out.paste(fr, (0, i * frame_px))
    rel = "textures/the_sift/blocks/" + name
    dst = os.path.join(RP, rel + ".png")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    out.save(dst)
    key = NS + "_" + name
    TERRAIN[key] = rel
    FLIPBOOKS.append({"flipbook_texture": rel, "atlas_tile": key, "ticks_per_frame": 5, "blend_frames": True})
    return key


def make_portal_texture():
    """O portal do Java é um shader. Aqui vira uma névoa rolando (flipbook)."""
    im = Image.open(asset("textures", "misc", "sift_portal_shaderpack.png")).convert("RGBA")
    base = im.resize((64, 64), Image.LANCZOS)
    frames = 32
    size = 32
    out = Image.new("RGBA", (size, size * frames))
    for i in range(frames):
        off = int(i * 64 / frames)
        tile = Image.new("RGBA", (64, 64))
        tile.paste(base, (-off, 0))
        tile.paste(base, (64 - off, 0))
        fr = tile.crop((0, 0, 64, 64)).resize((size, size), Image.LANCZOS)
        px = fr.load()
        for y in range(size):
            for x in range(size):
                r, g, b, a = px[x, y]
                px[x, y] = (r, g, b, 190)
        out.paste(fr, (0, i * size))
    rel = "textures/the_sift/blocks/sift_portal"
    dst = os.path.join(RP, rel + ".png")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    out.save(dst)
    key = NS + "_sift_portal"
    TERRAIN[key] = rel
    FLIPBOOKS.append({"flipbook_texture": rel, "atlas_tile": key, "ticks_per_frame": 3, "blend_frames": True})
    return key


# ---------------------------------------------------------------------------
# Tags de ferramenta (lidas do jar: mineable/*.json e needs_*_tool.json)
# ---------------------------------------------------------------------------
def read_tag(path):
    if not os.path.exists(path):
        return set()
    return set(v if isinstance(v, str) else v["id"] for v in load_json(path)["values"])


MINEABLE = {}
NEEDS = {}


def load_tool_tags():
    for tool in ("pickaxe", "axe", "shovel", "hoe"):
        for b in read_tag(src("data", "minecraft", "tags", "block", "mineable", tool + ".json")):
            MINEABLE[b] = tool
    for tier in ("stone", "iron", "diamond"):
        for b in read_tag(src("data", "minecraft", "tags", "block", "needs_" + tier + "_tool.json")):
            NEEDS[b] = tier


TOOL_ITEM_TAG = {
    "pickaxe": "minecraft:is_pickaxe",
    "axe": "minecraft:is_axe",
    "shovel": "minecraft:is_shovel",
    "hoe": "minecraft:is_hoe",
}
TOOL_BLOCK_TAG = {
    "pickaxe": "minecraft:is_pickaxe_item_destructible",
    "axe": "minecraft:is_axe_item_destructible",
    "shovel": "minecraft:is_shovel_item_destructible",
    "hoe": "minecraft:is_hoe_item_destructible",
}
TIER_TAGS = {
    "stone": ["minecraft:stone_tier", "minecraft:copper_tier", "minecraft:iron_tier", "minecraft:diamond_tier", "minecraft:netherite_tier"],
    "iron": ["minecraft:iron_tier", "minecraft:diamond_tier", "minecraft:netherite_tier"],
    "diamond": ["minecraft:diamond_tier", "minecraft:netherite_tier"],
}

# ---------------------------------------------------------------------------
# Loot tables
# ---------------------------------------------------------------------------
LOOT = {}


def loot_path(kind, name):
    return "loot_tables/the_sift/" + kind + "/" + name + ".json"


def add_loot(kind, name, pools):
    p = loot_path(kind, name)
    LOOT[p] = {"pools": pools}
    return p


SILK = {"condition": "match_tool", "enchantments": [{"enchantment": "silk_touch", "levels": {"range_min": 1}}]}
SHEARS = {"condition": "match_tool", "item": "minecraft:shears"}


def tool_condition(block_id):
    """Condição 'ferramenta certa' do Java (mineable + needs_x_tool)."""
    full = sid(block_id)
    tool = MINEABLE.get(full)
    tier = NEEDS.get(full)
    if tool != "pickaxe" or not tier:
        if tool == "pickaxe":
            return [{"condition": "match_tool", "minecraft:match_tool_filter_any": ["minecraft:is_pickaxe"]}]
        return []
    return [{
        "condition": "match_tool",
        "minecraft:match_tool_filter_any": TIER_TAGS[tier],
        "minecraft:match_tool_filter_all": ["minecraft:is_pickaxe"],
    }]


def entry(item, count=None, weight=None):
    e = {"type": "item", "name": item}
    fns = []
    if count is not None:
        if isinstance(count, (list, tuple)):
            fns.append({"function": "set_count", "count": {"min": count[0], "max": count[1]}})
        elif count != 1:
            fns.append({"function": "set_count", "count": count})
    if fns:
        e["functions"] = fns
    if weight:
        e["weight"] = weight
    return e


def loot_self(name, cond=None):
    pool = {"rolls": 1, "entries": [entry(sid(name))]}
    if cond:
        pool["conditions"] = cond
    return add_loot("blocks", name, [pool])


def loot_silk_or(name, drop, count=1, extra_cond=None):
    """Drop normal do bloco. O toque de seda em bloco custom devolve o próprio
    bloco pelo motor do jogo, então aqui só vai o caminho sem seda."""
    pool = {"rolls": 1, "entries": [entry(drop, count)]}
    if extra_cond:
        pool["conditions"] = extra_cond
    return add_loot("blocks", name, [pool])


def loot_shears_or_silk(name):
    return add_loot("blocks", name, [{"rolls": 1, "entries": [entry(sid(name))], "conditions": [SHEARS]}])


# ---------------------------------------------------------------------------
# Blocos
# ---------------------------------------------------------------------------
BLOCKS = {}       # id -> json
BLOCK_SOUNDS = {}  # id -> sound
BLOCK_ITEMS = {}  # id -> json do item substituto (plantas, portas...)
GEOS = {}         # nome do arquivo -> json de geometria de bloco
LANG_BLOCK = {}   # id -> chave de tradução usada no display_name

SUPPORTS_VEGETATION = [
    "minecraft:grass_block", "minecraft:dirt", "minecraft:coarse_dirt", "minecraft:podzol",
    "minecraft:rooted_dirt", "minecraft:moss_block", "minecraft:farmland", "minecraft:mud",
    "minecraft:muddy_mangrove_roots", "minecraft:pale_moss_block", "minecraft:mycelium",
]
SIFT_GROUND = [sid(x) for x in (
    "siftslate", "siftslate_growth", "healthy_sculk", "dry_healthy_sculk",
    "dry_healthy_sculk_growth", "overgrown_willow_foliage")]


def base_block(name, category="nature", states=None, traits=None, group=None):
    desc = {"identifier": sid(name), "menu_category": {"category": category}}
    if group:
        desc["menu_category"]["group"] = group
    if states:
        desc["states"] = states
    if traits:
        desc["traits"] = traits
    key = "block.the_sift." + name
    LANG_BLOCK[name] = key
    comps = {"minecraft:display_name": {"value": key}}
    b = {"format_version": BLOCK_FMT, "minecraft:block": {"description": desc, "components": comps}}
    BLOCKS[name] = b
    return b


def comps(b):
    return b["minecraft:block"]["components"]


def perms(b):
    return b["minecraft:block"].setdefault("permutations", [])


def mat(texture, render="opaque", ao=True, shade=True):
    m = {"texture": texture, "render_method": render}
    if not ao:
        m["ambient_occlusion"] = False
    if not shade:
        m["face_dimming"] = False
    return m


def set_mining(b, name, hardness, resistance=None, tool=None):
    c = comps(b)
    if hardness < 0:
        c["minecraft:destructible_by_mining"] = False
        c["minecraft:destructible_by_explosion"] = False
        return
    c["minecraft:destructible_by_mining"] = {"seconds_to_destroy": hardness}
    c["minecraft:destructible_by_explosion"] = {"explosion_resistance": resistance if resistance is not None else hardness}
    tool = tool or MINEABLE.get(sid(name))
    tags = []
    if tool:
        tags.append(TOOL_BLOCK_TAG[tool])
    return tags


def add_tags(b, tags):
    c = comps(b)
    for x in tags or []:
        c["tag:" + x] = {}


def cube_block(name, textures, hardness, resistance=None, sound="stone", map_color="#5b5b62",
               loot="self", light=0, category="nature", group=None, extra_tags=(), render="opaque"):
    """textures: str (todas as faces) ou dict com up/down/side (ou north/south...)."""
    b = base_block(name, category, group=group)
    c = comps(b)
    c["minecraft:geometry"] = "minecraft:geometry.full_block"
    if isinstance(textures, str):
        c["minecraft:material_instances"] = {"*": mat(block_tex(textures), render)}
    else:
        mi = {"*": mat(block_tex(textures["side"]), render)}
        for face in ("up", "down", "north", "south", "east", "west"):
            if face in textures:
                mi[face] = mat(block_tex(textures[face]), render)
        c["minecraft:material_instances"] = mi
    tags = set_mining(b, name, hardness, resistance)
    add_tags(b, (tags or []) + list(extra_tags))
    c["minecraft:map_color"] = map_color
    if light:
        c["minecraft:light_emission"] = light
    if loot == "self":
        c["minecraft:loot"] = loot_self(name, tool_condition(name) or None)
    elif loot:
        c["minecraft:loot"] = loot
    BLOCK_SOUNDS[name] = sound
    return b


# --- geometria ---------------------------------------------------------------
def geo_file(ident, bones, tw=16, th=16):
    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [{
            "description": {"identifier": ident, "texture_width": tw, "texture_height": th,
                            "visible_bounds_width": 2, "visible_bounds_height": 2.5, "visible_bounds_offset": [0, 0.75, 0]},
            "bones": bones,
        }],
    }


def box(origin, size, uv_faces=None, mat_inst=None):
    """Cubo com uv por face calculado automaticamente (projeção da caixa)."""
    x, y, z = origin
    w, h, d = size
    # coordenadas de bloco do Bedrock: x/z em [-8,8], y em [0,16]
    u0, v0 = x + 8, 16 - (y + h)
    faces = {
        "north": {"uv": [16 - (x + 8) - w, v0], "uv_size": [w, h]},
        "south": {"uv": [x + 8, v0], "uv_size": [w, h]},
        "east": {"uv": [16 - (z + 8) - d, v0], "uv_size": [d, h]},
        "west": {"uv": [z + 8, v0], "uv_size": [d, h]},
        "up": {"uv": [x + 8, z + 8], "uv_size": [w, d]},
        "down": {"uv": [x + 8, 16 - (z + 8) - d], "uv_size": [w, d]},
    }
    for f in faces.values():
        f["uv"] = [max(0, min(16, f["uv"][0])), max(0, min(16, f["uv"][1]))]
    if mat_inst:
        for f, m in mat_inst.items():
            if f in faces:
                faces[f]["material_instance"] = m
    cube = {"origin": [x, y, z], "size": [w, h, d], "uv": faces}
    return cube


def add_geo(ident, bones):
    fname = ident.replace("geometry.the_sift.", "")
    GEOS[fname] = geo_file(ident, bones)
    return ident


def java_model_to_geo(model_name, ident, texmap):
    """Converte um modelo de bloco Java com 'elements' para geometria Bedrock.
    texmap: '#0' -> nome do material_instance."""
    m = load_json(asset("models", "block", model_name + ".json"))
    cubes = []
    for el in m["elements"]:
        fr, to = el["from"], el["to"]
        origin = [-(to[0] - 8), fr[1], fr[2] - 8]
        size = [to[0] - fr[0], to[1] - fr[1], to[2] - fr[2]]
        cube = {"origin": origin, "size": size, "uv": {}}
        rot = el.get("rotation")
        if rot:
            o = rot.get("origin", [8, 8, 8])
            if "axis" in rot:
                r = [0, 0, 0]
                r["xyz".index(rot["axis"])] = rot["angle"]
            else:
                r = [rot.get("x", 0), rot.get("y", 0), rot.get("z", 0)]
            cube["pivot"] = [-(o[0] - 8), o[1], o[2] - 8]
            cube["rotation"] = [-r[0], -r[1], r[2]]
        for face, fd in el.get("faces", {}).items():
            uv = fd.get("uv", [0, 0, 16, 16])
            du, dv = uv[2] - uv[0], uv[3] - uv[1]
            if du == 0 and dv == 0:
                continue
            f = {"uv": [uv[0], uv[1]], "uv_size": [du, dv]}
            t = fd.get("texture", "#0")
            f["material_instance"] = texmap.get(t, "*")
            cube["uv"][face] = f
        cubes.append(cube)
    return add_geo(ident, [{"name": "root", "pivot": [0, 0, 0], "cubes": cubes}])


# --- famílias de blocos -------------------------------------------------------
def plant_icon(name, tex_file):
    if os.path.exists(asset("textures", "item", name + ".png")):
        return item_tex(name)
    return item_tex(name, tex_file, "block")


def plant_block(name, tex_file=None, ground=None, faces=("up",), hanging=False, loot="self",
                geometry="minecraft:geometry.cross", mat_extra=None, selection=None, map_color="#3f6b5a",
                sound="grass", item=True, compost=None, light=0, category="nature", offset=True):
    tex_file = tex_file or name
    b = base_block(name, category)
    c = comps(b)
    c["minecraft:geometry"] = geometry
    mi = {"*": mat(block_tex(tex_file), "alpha_test_single_sided", ao=False)}
    if mat_extra:
        for k, v in mat_extra.items():
            mi[k] = mat(block_tex(v), "alpha_test_single_sided", ao=False)
    c["minecraft:material_instances"] = mi
    c["minecraft:collision_box"] = False
    c["minecraft:selection_box"] = selection or {"origin": [-6, 0, -6], "size": [12, 13, 12]}
    if hanging:
        c["minecraft:selection_box"] = selection or {"origin": [-6, 3, -6], "size": [12, 13, 12]}
    c["minecraft:destructible_by_mining"] = {"seconds_to_destroy": 0}
    c["minecraft:destructible_by_explosion"] = {"explosion_resistance": 0}
    c["minecraft:replaceable"] = {}
    c["minecraft:movable"] = {"movement_type": "popped"}
    c["minecraft:light_dampening"] = 0
    c["minecraft:map_color"] = map_color
    c["minecraft:liquid_detection"] = {"detection_rules": [{"liquid_type": "water", "can_contain_liquid": False, "on_liquid_touches": "popped"}]}
    c["minecraft:flammable"] = {"catch_chance_modifier": 60, "destroy_chance_modifier": 100}
    if light:
        c["minecraft:light_emission"] = light
    ground = ground if ground is not None else SIFT_GROUND + SUPPORTS_VEGETATION
    cond = {"allowed_faces": list(faces)}
    if ground:
        cond["block_filter"] = ground
    c["minecraft:placement_filter"] = {"conditions": [cond]}
    if loot == "self":
        c["minecraft:loot"] = add_loot("blocks", name, [{"rolls": 1, "entries": [entry(sid(name))]}])
    elif loot == "shears":
        c["minecraft:loot"] = loot_shears_or_silk(name)
    elif loot:
        c["minecraft:loot"] = loot
    BLOCK_SOUNDS[name] = sound
    if item:
        it = {"format_version": ITEM_FMT, "minecraft:item": {
            "description": {"identifier": sid(name), "menu_category": {"category": category}},
            "components": {
                "minecraft:icon": {"textures": {"default": plant_icon(name, tex_file)}},
                "minecraft:display_name": {"value": "block.the_sift." + name},
                "minecraft:block_placer": {"block": sid(name), "replace_block_item": True},
            }}}
        if compost:
            it["minecraft:item"]["components"]["minecraft:compostable"] = {"composting_chance": compost}
        BLOCK_ITEMS[name] = it
    return b


def build_blocks():
    # ---------------- pedra ----------------
    cube_block("siftslate", "siftslate", 3.0, 6.0, "deepslate", "#4d5157", extra_tags=["stone"])
    cube_block("siftslate_growth", {"up": "siftslate_growth_top", "down": "siftslate", "side": "siftslate_growth_side"},
               1.5, 6.0, "deepslate", "#5c7d74",
               loot=loot_silk_or("siftslate_growth", sid("siftslate"), extra_cond=tool_condition("siftslate_growth")),
               extra_tags=["stone"])
    cube_block("reinforced_siftslate", {"up": "reinforced_siftslate_top", "down": "reinforced_siftslate_bottom",
                                        "side": "reinforced_siftslate_side"}, -1, sound="deepslate", map_color="#3a3d45", loot=None)

    ores = [
        # nome, drop, qtd, xp (min,max), cor
        ("siftslate_coal_ore", "minecraft:coal", 1, "#3d3f44"),
        ("siftslate_diamond_ore", "minecraft:diamond", 1, "#4f8b8d"),
        ("siftslate_emerald_ore", "minecraft:emerald", 1, "#3f8f5c"),
        ("siftslate_charoite_ore", sid("charoite"), (4, 9), "#6e4a8e"),
        ("siftslate_siftite_ore", sid("siftite_nugget"), 1, "#6fb8c2"),
    ]
    for name, drop, count, color in ores:
        cube_block(name, name, 4.5, 3.0, "deepslate", color,
                   loot=loot_silk_or(name, drop, count, extra_cond=tool_condition(name)),
                   extra_tags=["stone", "the_sift:ore"])

    # ---------------- sculk saudável ----------------
    cube_block("healthy_sculk", "healthy_sculk", 0.2, 0.2, "sculk", "#2d6f73")
    cube_block("dry_healthy_sculk", "dry_healthy_sculk", 0.2, 0.2, "sculk", "#5c7c77")
    cube_block("dry_healthy_sculk_growth", {"up": "siftslate_growth_top", "down": "dry_healthy_sculk",
                                            "side": "dry_healthy_sculk_growth_side"}, 0.2, 0.2, "sculk", "#5c7d74",
               loot=loot_silk_or("dry_healthy_sculk_growth", sid("dry_healthy_sculk")))

    # ---------------- neve de ichor ----------------
    cube_block("ichor_snow_block", "ichor_snow", 0.2, 0.2, "snow", "#bfeef2",
               loot=loot_silk_or("ichor_snow_block", sid("ichor_snowball"), 4, extra_cond=[
                   {"condition": "match_tool", "minecraft:match_tool_filter_any": ["minecraft:is_shovel"]}]))
    snow_layers()

    # ---------------- alma ----------------
    cube_block("soul_block", "soul_block", 0.35, 0.35, "soul_soil", "#6ad7df", light=14)

    # ---------------- sonorous ----------------
    for mode in ("horn", "note"):
        name = "sonorous_deepslate" if mode == "horn" else "sonorous_deepslate_note"
        b = cube_block(name, {"up": "sonorous_deepslate_top", "down": "sonorous_deepslate_bottom",
                              "side": "sonorous_deepslate_side_" + mode}, -1, sound="deepslate",
                       map_color="#3a3d45", loot=None, category="items")

    portal_block()
    ichor_block()
    wood_blocks()
    plants()


def snow_layers():
    name = "ichor_snow"
    b = base_block(name, "nature", states={"the_sift:layers": [1, 2, 3, 4, 5, 6, 7, 8]})
    c = comps(b)
    bones = []
    for n in range(1, 9):
        bones.append({"name": "l%d" % n, "pivot": [0, 0, 0], "cubes": [box([-8, 0, -8], [16, 2 * n, 16])]})
    add_geo("geometry.the_sift.snow_layers", bones)
    vis = {"l%d" % n: "q.block_state('the_sift:layers') == %d" % n for n in range(1, 9)}
    c["minecraft:geometry"] = {"identifier": "geometry.the_sift.snow_layers", "bone_visibility": vis}
    c["minecraft:material_instances"] = {"*": mat(block_tex("ichor_snow"))}
    c["minecraft:destructible_by_mining"] = {"seconds_to_destroy": 0.1}
    c["minecraft:destructible_by_explosion"] = {"explosion_resistance": 0.1}
    add_tags(b, [TOOL_BLOCK_TAG["shovel"]])
    c["minecraft:map_color"] = "#bfeef2"
    c["minecraft:light_dampening"] = 0
    c["minecraft:placement_filter"] = {"conditions": [{"allowed_faces": ["up"]}]}
    for n in range(1, 9):
        h = 2 * n
        p = {"condition": "q.block_state('the_sift:layers') == %d" % n, "components": {
            "minecraft:selection_box": {"origin": [-8, 0, -8], "size": [16, h, 16]},
            "minecraft:collision_box": {"origin": [-8, 0, -8], "size": [16, max(0, h - 2) or 1, 16]} if n > 1 else False,
            "minecraft:loot": add_loot("blocks", "ichor_snow_%d" % n, [{
                "rolls": 1, "entries": [entry(sid("ichor_snowball"), n)],
                "conditions": [{"condition": "match_tool", "minecraft:match_tool_filter_any": ["minecraft:is_shovel"]}]}]),
        }}
        perms(b).append(p)
    c["minecraft:loot"] = loot_path("blocks", "ichor_snow_1")
    BLOCK_SOUNDS[name] = "snow"
    BLOCK_ITEMS[name] = {"format_version": ITEM_FMT, "minecraft:item": {
        "description": {"identifier": sid(name), "menu_category": {"category": "nature"}},
        "components": {
            "minecraft:icon": {"textures": {"default": item_tex("ichor_snow_item", "ichor_snow", "block")}},
            "minecraft:display_name": {"value": "block.the_sift.ichor_snow"},
            "minecraft:block_placer": {"block": sid(name), "replace_block_item": True},
        }}}


def portal_block():
    name = "sift_portal"
    b = base_block(name, "items", states={"the_sift:axis": ["x", "z"]})
    c = comps(b)
    add_geo("geometry.the_sift.portal_plane", [{"name": "plane", "pivot": [0, 0, 0], "cubes": [
        {"origin": [-8, 0, -1], "size": [16, 16, 2], "uv": {
            "north": {"uv": [0, 0], "uv_size": [16, 16]},
            "south": {"uv": [0, 0], "uv_size": [16, 16]}}}]}])
    c["minecraft:geometry"] = "geometry.the_sift.portal_plane"
    c["minecraft:material_instances"] = {"*": mat(make_portal_texture(), "blend", ao=False, shade=False)}
    c["minecraft:collision_box"] = False
    c["minecraft:selection_box"] = False
    c["minecraft:destructible_by_mining"] = False
    c["minecraft:destructible_by_explosion"] = False
    c["minecraft:light_emission"] = 12
    c["minecraft:light_dampening"] = 0
    c["minecraft:map_color"] = "#7fd3e0"
    c["minecraft:movable"] = {"movement_type": "immovable"}
    perms(b).append({"condition": "q.block_state('the_sift:axis') == 'z'",
                     "components": {"minecraft:transformation": {"rotation": [0, 90, 0]}}})
    BLOCK_SOUNDS[name] = "glass"


def ichor_block():
    """Ichor é fluido no Java. Bedrock não aceita fluidos novos, então vira um
    bloco translúcido, atravessável, com a animação original e o mesmo efeito
    (regeneração + arrasto) aplicado por script."""
    name = "ichor"
    b = base_block(name, "items")
    c = comps(b)
    add_geo("geometry.the_sift.liquid", [{"name": "liquid", "pivot": [0, 0, 0], "cubes": [box([-8, 0, -8], [16, 14, 16])]}])
    c["minecraft:geometry"] = "geometry.the_sift.liquid"
    still = downscale_flipbook("ichor_still")
    downscale_flipbook("ichor_flow")
    c["minecraft:material_instances"] = {"*": mat(still, "blend", ao=False)}
    c["minecraft:collision_box"] = False
    c["minecraft:selection_box"] = {"origin": [-8, 0, -8], "size": [16, 14, 16]}
    c["minecraft:destructible_by_mining"] = False
    c["minecraft:destructible_by_explosion"] = False
    c["minecraft:replaceable"] = {}
    c["minecraft:light_emission"] = 6
    c["minecraft:light_dampening"] = 1
    c["minecraft:map_color"] = "#4adce8"
    c["minecraft:loot"] = add_loot("blocks", "empty", [])
    BLOCK_SOUNDS[name] = "slime"


# --- madeira ---------------------------------------------------------------------
W = "overgrown_willow"


def pillar(b):
    b["minecraft:block"]["description"]["traits"] = {"minecraft:placement_position": {"enabled_states": ["minecraft:block_face"]}}
    perms(b).extend([
        {"condition": "q.block_state('minecraft:block_face') == 'north' || q.block_state('minecraft:block_face') == 'south'",
         "components": {"minecraft:transformation": {"rotation": [90, 0, 0]}}},
        {"condition": "q.block_state('minecraft:block_face') == 'east' || q.block_state('minecraft:block_face') == 'west'",
         "components": {"minecraft:transformation": {"rotation": [0, 0, 90]}}},
    ])


def wood_blocks():
    wood_tags = ["wood", "log", "minecraft:is_axe_item_destructible"]
    for name, side, top in [
        (W + "_log", "overgrown_willow_log", "overgrown_willow_log_top"),
        (W + "_wood", "overgrown_willow_log", "overgrown_willow_log"),
        ("stripped_" + W + "_log", "stripped_overgrown_willow_log", "stripped_overgrown_willow_log_top"),
        ("stripped_" + W + "_wood", "stripped_overgrown_willow_log", "stripped_overgrown_willow_log"),
    ]:
        b = cube_block(name, {"up": top, "down": top, "side": side}, 2.0, 2.0, "wood", "#6b5a45",
                       extra_tags=wood_tags, loot="self")
        comps(b)["minecraft:flammable"] = {"catch_chance_modifier": 5, "destroy_chance_modifier": 5}
        pillar(b)

    planks = cube_block(W + "_planks", "overgrown_willow_planks", 2.0, 3.0, "wood", "#8a7458",
                        extra_tags=["wood", "minecraft:is_axe_item_destructible"])
    comps(planks)["minecraft:flammable"] = {"catch_chance_modifier": 5, "destroy_chance_modifier": 20}
    planks_tex = block_tex("overgrown_willow_planks")

    # folhagem
    b = cube_block(W + "_foliage", "overgrown_willow_foliage", 0.2, 0.2, "grass", "#3f7f6a",
                   render="alpha_test", extra_tags=["minecraft:is_hoe_item_destructible", "leaves"], loot="self")
    c = comps(b)
    c["minecraft:light_dampening"] = 1
    c["minecraft:flammable"] = {"catch_chance_modifier": 30, "destroy_chance_modifier": 60}
    c["minecraft:material_instances"]["*"]["ambient_occlusion"] = True
    b["minecraft:block"]["description"]["states"] = {"the_sift:persistent": [False, True]}
    c["the_sift:leaves"] = {}

    slab_block(W + "_slab", planks_tex)
    stairs_block(W + "_stairs", planks_tex)
    fence_block(W + "_fence", planks_tex)
    fence_gate_block(W + "_fence_gate", planks_tex)
    door_block(W + "_door")
    trapdoor_block(W + "_trapdoor")
    button_block(W + "_button", planks_tex)
    pressure_plate_block(W + "_pressure_plate", planks_tex)


def wooden(b, hardness=2.0, resistance=3.0):
    c = comps(b)
    c["minecraft:destructible_by_mining"] = {"seconds_to_destroy": hardness}
    c["minecraft:destructible_by_explosion"] = {"explosion_resistance": resistance}
    c["minecraft:flammable"] = {"catch_chance_modifier": 5, "destroy_chance_modifier": 20}
    c["minecraft:map_color"] = "#8a7458"
    add_tags(b, ["wood", "minecraft:is_axe_item_destructible"])


def slab_block(name, tex):
    b = base_block(name, "construction", group="minecraft:itemGroup.name.slab",
                   states={"the_sift:double": [False, True]},
                   traits={"minecraft:placement_position": {"enabled_states": ["minecraft:vertical_half"]}})
    c = comps(b)
    add_geo("geometry.the_sift.slab", [
        {"name": "bottom", "pivot": [0, 0, 0], "cubes": [box([-8, 0, -8], [16, 8, 16])]},
        {"name": "top", "pivot": [0, 0, 0], "cubes": [box([-8, 8, -8], [16, 8, 16])]},
    ])
    c["minecraft:geometry"] = {"identifier": "geometry.the_sift.slab", "bone_visibility": {
        "bottom": "q.block_state('minecraft:vertical_half') == 'bottom' || q.block_state('the_sift:double')",
        "top": "q.block_state('minecraft:vertical_half') == 'top' || q.block_state('the_sift:double')",
    }}
    c["minecraft:material_instances"] = {"*": mat(tex)}
    wooden(b)
    c["minecraft:collision_box"] = {"origin": [-8, 0, -8], "size": [16, 8, 16]}
    c["minecraft:selection_box"] = {"origin": [-8, 0, -8], "size": [16, 8, 16]}
    c["minecraft:light_dampening"] = 0
    single = add_loot("blocks", name, [{"rolls": 1, "entries": [entry(sid(name))]}])
    double = add_loot("blocks", name + "_double", [{"rolls": 1, "entries": [entry(sid(name), 2)]}])
    c["minecraft:loot"] = single
    perms(b).extend([
        {"condition": "q.block_state('minecraft:vertical_half') == 'top' && !q.block_state('the_sift:double')",
         "components": {"minecraft:collision_box": {"origin": [-8, 8, -8], "size": [16, 8, 16]},
                        "minecraft:selection_box": {"origin": [-8, 8, -8], "size": [16, 8, 16]}}},
        {"condition": "q.block_state('the_sift:double')",
         "components": {"minecraft:collision_box": True, "minecraft:selection_box": True,
                        "minecraft:loot": double, "minecraft:light_dampening": 15}},
    ])
    BLOCK_SOUNDS[name] = "wood"


def stairs_block(name, tex):
    b = base_block(name, "construction", group="minecraft:itemGroup.name.stairs",
                   traits={"minecraft:placement_position": {"enabled_states": ["minecraft:vertical_half"]},
                           "minecraft:placement_direction": {"enabled_states": ["minecraft:cardinal_direction"]}})
    c = comps(b)
    add_geo("geometry.the_sift.stairs", [
        {"name": "base_low", "pivot": [0, 0, 0], "cubes": [box([-8, 0, -8], [16, 8, 16])]},
        {"name": "step_high", "pivot": [0, 0, 0], "cubes": [box([-8, 8, -8], [16, 8, 8])]},
        {"name": "base_high", "pivot": [0, 0, 0], "cubes": [box([-8, 8, -8], [16, 8, 16])]},
        {"name": "step_low", "pivot": [0, 0, 0], "cubes": [box([-8, 0, -8], [16, 8, 8])]},
    ])
    bottom = "q.block_state('minecraft:vertical_half') == 'bottom'"
    top = "q.block_state('minecraft:vertical_half') == 'top'"
    c["minecraft:geometry"] = {"identifier": "geometry.the_sift.stairs", "bone_visibility": {
        "base_low": bottom, "step_high": bottom, "base_high": top, "step_low": top}}
    c["minecraft:material_instances"] = {"*": mat(tex)}
    wooden(b)
    c["minecraft:support"] = {"shape": "stair"}
    c["minecraft:light_dampening"] = 0
    c["minecraft:loot"] = add_loot("blocks", name, [{"rolls": 1, "entries": [entry(sid(name))]}])
    # modelo: degrau alto no norte (-z); só a rotação em Y muda com a direção
    c["minecraft:collision_box"] = [
        {"origin": [-8, 0, -8], "size": [16, 8, 16]},
        {"origin": [-8, 8, -8], "size": [16, 8, 8]},
    ]
    perms(b).append({"condition": top, "components": {"minecraft:collision_box": [
        {"origin": [-8, 8, -8], "size": [16, 8, 16]},
        {"origin": [-8, 0, -8], "size": [16, 8, 8]},
    ]}})
    rot = {"north": 0, "west": 90, "south": 180, "east": 270}
    for d, r in rot.items():
        perms(b).append({"condition": "q.block_state('minecraft:cardinal_direction') == '%s'" % d,
                         "components": {"minecraft:transformation": {"rotation": [0, r, 0]}}})
    BLOCK_SOUNDS[name] = "wood"


def fence_block(name, tex):
    states = {"the_sift:n": [False, True], "the_sift:e": [False, True], "the_sift:s": [False, True], "the_sift:w": [False, True]}
    b = base_block(name, "construction", states=states)
    c = comps(b)
    add_geo("geometry.the_sift.fence", [
        {"name": "post", "pivot": [0, 0, 0], "cubes": [box([-2, 0, -2], [4, 16, 4])]},
        {"name": "n", "pivot": [0, 0, 0], "cubes": [box([-1, 12, -8], [2, 3, 6]), box([-1, 6, -8], [2, 3, 6])]},
        {"name": "s", "pivot": [0, 0, 0], "cubes": [box([-1, 12, 2], [2, 3, 6]), box([-1, 6, 2], [2, 3, 6])]},
        {"name": "w", "pivot": [0, 0, 0], "cubes": [box([-8, 12, -1], [6, 3, 2]), box([-8, 6, -1], [6, 3, 2])]},
        {"name": "e", "pivot": [0, 0, 0], "cubes": [box([2, 12, -1], [6, 3, 2]), box([2, 6, -1], [6, 3, 2])]},
    ])
    c["minecraft:geometry"] = {"identifier": "geometry.the_sift.fence", "bone_visibility": {
        "post": True, "n": "q.block_state('the_sift:n')", "s": "q.block_state('the_sift:s')",
        "e": "q.block_state('the_sift:e')", "w": "q.block_state('the_sift:w')"}}
    c["minecraft:material_instances"] = {"*": mat(tex)}
    wooden(b)
    c["minecraft:support"] = {"shape": "fence"}
    c["minecraft:light_dampening"] = 0
    c["minecraft:selection_box"] = {"origin": [-2, 0, -2], "size": [4, 16, 4]}
    # colisão de 24 de altura (como cerca), um poste mais os braços ativos
    boxes = {
        "n": {"origin": [-2, 0, -8], "size": [4, 24, 6]},
        "s": {"origin": [-2, 0, 2], "size": [4, 24, 6]},
        "w": {"origin": [-8, 0, -2], "size": [6, 24, 4]},
        "e": {"origin": [2, 0, -2], "size": [6, 24, 4]},
    }
    post = {"origin": [-2, 0, -2], "size": [4, 24, 4]}
    c["minecraft:collision_box"] = [post]
    c["the_sift:fence"] = {}
    c["minecraft:loot"] = add_loot("blocks", name, [{"rolls": 1, "entries": [entry(sid(name))]}])
    import itertools
    for combo in itertools.product([False, True], repeat=4):
        if not any(combo):
            continue
        dirs = [d for d, on in zip("nesw", combo) if on]
        cond = " && ".join(("" if on else "!") + "q.block_state('the_sift:%s')" % d for d, on in zip("nesw", combo))
        perms(b).append({"condition": cond, "components": {"minecraft:collision_box": [post] + [boxes[d] for d in dirs]}})
    BLOCK_SOUNDS[name] = "wood"


def fence_gate_block(name, tex):
    b = base_block(name, "construction", states={"the_sift:open": [False, True]},
                   traits={"minecraft:placement_direction": {"enabled_states": ["minecraft:cardinal_direction"]}})
    c = comps(b)
    add_geo("geometry.the_sift.fence_gate", [
        {"name": "posts", "pivot": [0, 0, 0], "cubes": [box([-8, 5, -1], [2, 11, 2]), box([6, 5, -1], [2, 11, 2])]},
        {"name": "closed", "pivot": [0, 0, 0], "cubes": [
            box([-6, 6, -1], [4, 3, 2]), box([-6, 12, -1], [4, 3, 2]), box([-2, 6, -1], [2, 9, 2]),
            box([2, 6, -1], [4, 3, 2]), box([2, 12, -1], [4, 3, 2]), box([0, 6, -1], [2, 9, 2])]},
        {"name": "opened", "pivot": [0, 0, 0], "cubes": [
            box([-8, 6, 1], [2, 3, 4]), box([-8, 12, 1], [2, 3, 4]), box([-8, 6, 5], [2, 9, 2]),
            box([6, 6, 1], [2, 3, 4]), box([6, 12, 1], [2, 3, 4]), box([6, 6, 5], [2, 9, 2])]},
    ])
    c["minecraft:geometry"] = {"identifier": "geometry.the_sift.fence_gate", "bone_visibility": {
        "posts": True, "closed": "!q.block_state('the_sift:open')", "opened": "q.block_state('the_sift:open')"}}
    c["minecraft:material_instances"] = {"*": mat(tex)}
    wooden(b)
    c["minecraft:light_dampening"] = 0
    c["minecraft:collision_box"] = {"origin": [-8, 0, -2], "size": [16, 24, 4]}
    c["minecraft:selection_box"] = {"origin": [-8, 0, -2], "size": [16, 16, 4]}
    c["the_sift:toggle"] = {"state": "the_sift:open", "sound_open": "open.fence_gate", "sound_close": "close.fence_gate"}
    c["minecraft:loot"] = add_loot("blocks", name, [{"rolls": 1, "entries": [entry(sid(name))]}])
    rot = {"north": 0, "west": 90, "south": 180, "east": 270}
    for d, r in rot.items():
        perms(b).append({"condition": "q.block_state('minecraft:cardinal_direction') == '%s'" % d,
                         "components": {"minecraft:transformation": {"rotation": [0, r, 0]}}})
    perms(b).append({"condition": "q.block_state('the_sift:open')", "components": {"minecraft:collision_box": False}})
    BLOCK_SOUNDS[name] = "wood"


def door_block(name):
    b = base_block(name, "construction", states={"the_sift:open": [False, True]},
                   traits={"minecraft:multi_block": {"enabled_states": ["minecraft:multi_block_part"], "parts": 2, "direction": "up"},
                           "minecraft:placement_direction": {"enabled_states": ["minecraft:cardinal_direction"]}})
    c = comps(b)
    bottom = block_tex("overgrown_willow_door_bottom")
    top = block_tex("overgrown_willow_door_top")
    # painel na borda norte com 3px de espessura
    add_geo("geometry.the_sift.door", [{"name": "panel", "pivot": [0, 0, 0], "cubes": [
        {"origin": [-8, 0, -8], "size": [16, 16, 3], "uv": {
            "north": {"uv": [16, 0], "uv_size": [-16, 16]}, "south": {"uv": [0, 0], "uv_size": [16, 16]},
            "east": {"uv": [0, 0], "uv_size": [3, 16]}, "west": {"uv": [13, 0], "uv_size": [3, 16]},
            "up": {"uv": [0, 0], "uv_size": [16, 3]}, "down": {"uv": [0, 13], "uv_size": [16, 3]}}}]}])
    c["minecraft:geometry"] = "geometry.the_sift.door"
    c["minecraft:material_instances"] = {"*": mat(bottom, "alpha_test")}
    wooden(b, 3.0, 3.0)
    c["minecraft:movable"] = {"movement_type": "popped"}
    c["minecraft:light_dampening"] = 0
    c["minecraft:collision_box"] = {"origin": [-8, 0, -8], "size": [16, 16, 3]}
    c["minecraft:selection_box"] = {"origin": [-8, 0, -8], "size": [16, 16, 3]}
    c["the_sift:door"] = {}
    loot = add_loot("blocks", name, [{"rolls": 1, "entries": [entry(sid(name))]}])
    c["minecraft:loot"] = loot
    perms(b).append({"condition": "q.block_state('minecraft:multi_block_part') == 1",
                     "components": {"minecraft:material_instances": {"*": mat(top, "alpha_test")},
                                    "minecraft:loot": add_loot("blocks", "empty", [])}})
    # Java: porta virada pro sul fica na borda norte. Aberta = mais 90 graus.
    rot = {"south": 0, "east": 90, "north": 180, "west": 270}
    for d, r in rot.items():
        perms(b).append({"condition": "q.block_state('minecraft:cardinal_direction') == '%s' && !q.block_state('the_sift:open')" % d,
                         "components": {"minecraft:transformation": {"rotation": [0, r, 0]}}})
        perms(b).append({"condition": "q.block_state('minecraft:cardinal_direction') == '%s' && q.block_state('the_sift:open')" % d,
                         "components": {"minecraft:transformation": {"rotation": [0, (r + 270) % 360, 0]}}})
    BLOCK_SOUNDS[name] = "wood"
    BLOCK_ITEMS[name] = {"format_version": ITEM_FMT, "minecraft:item": {
        "description": {"identifier": sid(name), "menu_category": {"category": "construction"}},
        "components": {
            "minecraft:icon": {"textures": {"default": item_tex(name)}},
            "minecraft:display_name": {"value": "block.the_sift." + name},
            "minecraft:block_placer": {"block": sid(name), "replace_block_item": True},
        }}}


def trapdoor_block(name):
    b = base_block(name, "construction", states={"the_sift:open": [False, True]},
                   traits={"minecraft:placement_position": {"enabled_states": ["minecraft:vertical_half"]},
                           "minecraft:placement_direction": {"enabled_states": ["minecraft:cardinal_direction"]}})
    c = comps(b)
    tex = block_tex("overgrown_willow_trapdoor")
    add_geo("geometry.the_sift.trapdoor", [
        {"name": "low", "pivot": [0, 0, 0], "cubes": [box([-8, 0, -8], [16, 3, 16])]},
        {"name": "high", "pivot": [0, 0, 0], "cubes": [box([-8, 13, -8], [16, 3, 16])]},
        {"name": "open", "pivot": [0, 0, 0], "cubes": [box([-8, 0, -8], [16, 16, 3])]},
    ])
    c["minecraft:geometry"] = {"identifier": "geometry.the_sift.trapdoor", "bone_visibility": {
        "low": "!q.block_state('the_sift:open') && q.block_state('minecraft:vertical_half') == 'bottom'",
        "high": "!q.block_state('the_sift:open') && q.block_state('minecraft:vertical_half') == 'top'",
        "open": "q.block_state('the_sift:open')"}}
    c["minecraft:material_instances"] = {"*": mat(tex, "alpha_test")}
    wooden(b, 3.0, 3.0)
    c["minecraft:light_dampening"] = 0
    c["minecraft:collision_box"] = {"origin": [-8, 0, -8], "size": [16, 3, 16]}
    c["minecraft:selection_box"] = {"origin": [-8, 0, -8], "size": [16, 3, 16]}
    c["the_sift:toggle"] = {"state": "the_sift:open", "sound_open": "open.wooden_trapdoor", "sound_close": "close.wooden_trapdoor"}
    c["minecraft:loot"] = add_loot("blocks", name, [{"rolls": 1, "entries": [entry(sid(name))]}])
    perms(b).append({"condition": "!q.block_state('the_sift:open') && q.block_state('minecraft:vertical_half') == 'top'",
                     "components": {"minecraft:collision_box": {"origin": [-8, 13, -8], "size": [16, 3, 16]},
                                    "minecraft:selection_box": {"origin": [-8, 13, -8], "size": [16, 3, 16]}}})
    rot = {"south": 0, "east": 90, "north": 180, "west": 270}
    for d, r in rot.items():
        perms(b).append({"condition": "q.block_state('the_sift:open') && q.block_state('minecraft:cardinal_direction') == '%s'" % d,
                         "components": {"minecraft:transformation": {"rotation": [0, r, 0]},
                                        "minecraft:collision_box": {"origin": [-8, 0, -8], "size": [16, 16, 3]},
                                        "minecraft:selection_box": {"origin": [-8, 0, -8], "size": [16, 16, 3]}}})
    BLOCK_SOUNDS[name] = "wood"


def button_block(name, tex):
    b = base_block(name, "construction", states={"the_sift:pressed": [False, True]},
                   traits={"minecraft:placement_position": {"enabled_states": ["minecraft:block_face"]}})
    c = comps(b)
    add_geo("geometry.the_sift.button", [
        {"name": "up", "pivot": [0, 0, 0], "cubes": [box([-3, 0, -2], [6, 2, 4])]},
        {"name": "down", "pivot": [0, 0, 0], "cubes": [box([-3, 0, -2], [6, 1, 4])]},
    ])
    c["minecraft:geometry"] = {"identifier": "geometry.the_sift.button", "bone_visibility": {
        "up": "!q.block_state('the_sift:pressed')", "down": "q.block_state('the_sift:pressed')"}}
    c["minecraft:material_instances"] = {"*": mat(tex)}
    wooden(b, 0.5, 0.5)
    c["minecraft:collision_box"] = False
    c["minecraft:selection_box"] = {"origin": [-3, 0, -2], "size": [6, 2, 4]}
    c["minecraft:light_dampening"] = 0
    c["minecraft:movable"] = {"movement_type": "popped"}
    c["minecraft:placement_filter"] = {"conditions": [{"allowed_faces": ["up", "down", "side"]}]}
    c["the_sift:button"] = {"ticks": 30}
    c["minecraft:loot"] = add_loot("blocks", name, [{"rolls": 1, "entries": [entry(sid(name))]}])
    rots = {"up": [0, 0, 0], "down": [180, 0, 0], "north": [270, 0, 0], "south": [90, 0, 0], "west": [0, 0, 90], "east": [0, 0, 270]}
    for face, r in rots.items():
        perms(b).append({"condition": "q.block_state('minecraft:block_face') == '%s'" % face,
                         "components": {"minecraft:transformation": {"rotation": r}}})
    perms(b).append({"condition": "q.block_state('the_sift:pressed')",
                     "components": {"minecraft:redstone_producer": {"power": 15, "strongly_powered_face": "down",
                                                                    "transform_relative": True}}})
    BLOCK_SOUNDS[name] = "wood"


def pressure_plate_block(name, tex):
    b = base_block(name, "construction", states={"the_sift:pressed": [False, True]})
    c = comps(b)
    add_geo("geometry.the_sift.pressure_plate", [
        {"name": "up", "pivot": [0, 0, 0], "cubes": [box([-7, 0, -7], [14, 1, 14])]},
        {"name": "down", "pivot": [0, 0, 0], "cubes": [box([-7, 0, -7], [14, 0.5, 14])]},
    ])
    c["minecraft:geometry"] = {"identifier": "geometry.the_sift.pressure_plate", "bone_visibility": {
        "up": "!q.block_state('the_sift:pressed')", "down": "q.block_state('the_sift:pressed')"}}
    c["minecraft:material_instances"] = {"*": mat(tex)}
    wooden(b, 0.5, 0.5)
    c["minecraft:collision_box"] = False
    c["minecraft:selection_box"] = {"origin": [-7, 0, -7], "size": [14, 1, 14]}
    c["minecraft:light_dampening"] = 0
    c["minecraft:movable"] = {"movement_type": "popped"}
    c["minecraft:placement_filter"] = {"conditions": [{"allowed_faces": ["up"]}]}
    c["minecraft:tick"] = {"interval_range": [10, 10], "looping": True}
    c["the_sift:pressure_plate"] = {}
    c["minecraft:loot"] = add_loot("blocks", name, [{"rolls": 1, "entries": [entry(sid(name))]}])
    perms(b).append({"condition": "q.block_state('the_sift:pressed')",
                     "components": {"minecraft:redstone_producer": {"power": 15, "strongly_powered_face": "down"}}})
    BLOCK_SOUNDS[name] = "wood"


# --- plantas ----------------------------------------------------------------------
def plants():
    for name in ("overgrown_chard", "overgrown_stalks", "overgrown_fronds", "siftslate_stalks",
                 "healthy_sculk_sprouts", "dry_healthy_sculk_sprouts"):
        plant_block(name, loot="shears", compost=30)
    plant_block("whisperbloom", compost=65, map_color="#b8b8c8")
    plant_block("sculkflower", ground=SIFT_GROUND + SUPPORTS_VEGETATION + ["minecraft:sculk"], compost=65, map_color="#3fb6c4")

    java_model_to_geo("sunburst_plant", "geometry.the_sift.sunburst_plant", {"#0": "t0", "#1": "t1", "#2": "t2"})
    b = plant_block("sunburst_plant", "sunburst_plant_1", geometry="geometry.the_sift.sunburst_plant",
                    mat_extra={"t0": "sunburst_plant_1", "t1": "sunburst_plant_2", "t2": "sunburst_plant_3"},
                    map_color="#e0b43c", compost=65)
    java_model_to_geo("overgrown_lotus", "geometry.the_sift.overgrown_lotus", {"#1": "t1", "#3": "t3"})
    plant_block("overgrown_lotus", "overgrown_lotus_2", geometry="geometry.the_sift.overgrown_lotus",
                mat_extra={"t1": "overgrown_lotus_2", "t3": "overgrown_lotus_1"}, map_color="#76c7d6", compost=65,
                selection={"origin": [-7, 0, -7], "size": [14, 6, 14]})

    ceiling = [sid("siftslate"), sid("siftslate_growth"), sid("healthy_sculk"), sid("dry_healthy_sculk"),
               sid("dry_healthy_sculk_growth"), sid(W + "_foliage"), "minecraft:deepslate", "minecraft:stone",
               "minecraft:dirt", "minecraft:sculk", "minecraft:tuff"]
    for name in ("siftslate_hanging_roots", "overgrown_hanging_roots"):
        plant_block(name, hanging=True, faces=("down",), ground=ceiling, loot="shears", compost=30, offset=False)

    # muda
    b = plant_block(W + "_sapling", map_color="#4c8a64", compost=30)
    comps(b)["the_sift:sapling"] = {}

    # videiras: presas na lateral de um bloco (como as videiras do jogo) ou
    # penduradas embaixo. A última da corrente usa a textura "bottom".
    add_geo("geometry.the_sift.vine_plane", [{"name": "plane", "pivot": [0, 0, 0], "cubes": [
        {"origin": [-8, 0, -7.2], "size": [16, 16, 0], "uv": {
            "north": {"uv": [16, 0], "uv_size": [-16, 16]}, "south": {"uv": [0, 0], "uv_size": [16, 16]}}}]}])
    b = plant_block(W + "_vines", hanging=True, faces=("side", "down"), ground=[],
                    geometry="geometry.the_sift.vine_plane",
                    loot="shears", compost=50, offset=False, map_color="#4c8a64", sound="vine")
    b["minecraft:block"]["description"]["states"] = {"the_sift:tip": [False, True],
                                                     "the_sift:facing": ["north", "east", "south", "west"]}
    b["minecraft:block"]["description"]["traits"] = {"minecraft:placement_position": {"enabled_states": ["minecraft:block_face"]}}
    c = comps(b)
    c["the_sift:vines"] = {}
    c["minecraft:selection_box"] = {"origin": [-8, 0, -8], "size": [16, 16, 2]}
    c["minecraft:material_instances"] = {"*": mat(block_tex("overgrown_willow_vines"), "alpha_test", ao=False)}
    perms(b).append({"condition": "q.block_state('the_sift:tip')", "components": {
        "minecraft:material_instances": {"*": mat(block_tex("overgrown_willow_vines_bottom"), "alpha_test", ao=False)}}})
    # the_sift:facing = de que lado fica o plano da videira (o lado do apoio).
    # O script preenche ao colocar; ao crescer, a de baixo herda o lado.
    for face, r in (("north", 0), ("west", 90), ("south", 180), ("east", 270)):
        perms(b).append({"condition": "q.block_state('the_sift:facing') == '%s'" % face,
                         "components": {"minecraft:transformation": {"rotation": [0, r, 0]}}})

    # plantação de sculkflower
    name = "sculkflower_crop"
    b = plant_block(name, "sculkflower_crop_stage0", ground=["minecraft:farmland", "minecraft:sculk", sid("healthy_sculk")],
                    loot=None, item=False, offset=False, map_color="#2e7c85")
    b["minecraft:block"]["description"]["states"] = {"the_sift:age": [0, 1, 2]}
    b["minecraft:block"]["description"]["menu_category"] = {"category": "none"}
    c = comps(b)
    c["the_sift:crop"] = {"max_age": 2, "chance": 0.2}
    seeds = entry(sid("sculkflower_seeds"))
    c["minecraft:loot"] = add_loot("blocks", "sculkflower_crop_young", [{"rolls": 1, "entries": [seeds]}])
    perms(b).extend([
        {"condition": "q.block_state('the_sift:age') == 1", "components": {
            "minecraft:material_instances": {"*": mat(block_tex("sculkflower_crop_stage1"), "alpha_test_single_sided", ao=False)}}},
        {"condition": "q.block_state('the_sift:age') == 2", "components": {
            "minecraft:material_instances": {"*": mat(block_tex("sculkflower"), "alpha_test_single_sided", ao=False)},
            "minecraft:loot": add_loot("blocks", "sculkflower_crop_mature", [
                {"rolls": 1, "entries": [entry(sid("sculkflower_seeds"))]},
                {"rolls": 1, "entries": [entry(sid("sculkflower"))]}])}},
    ])


# ---------------------------------------------------------------------------
# Itens
# ---------------------------------------------------------------------------
ITEMS = {}


def item(name, components, category="items", group=None, icon=None, lang_key=None):
    desc = {"identifier": sid(name), "menu_category": {"category": category}}
    if group:
        desc["menu_category"]["group"] = group
    comp = {"minecraft:icon": {"textures": {"default": icon or item_tex(name)}},
            "minecraft:display_name": {"value": lang_key or "item.the_sift." + name}}
    comp.update(components)
    ITEMS[name] = {"format_version": ITEM_FMT, "minecraft:item": {"description": desc, "components": comp}}
    return ITEMS[name]


REPAIR_SIFTITE = {"repair_items": [
    {"items": [sid("siftite_ingot")], "repair_amount": "query.max_durability * 0.25"}]}

TOOL_DURABILITY = 2031 + 470


def tool(name, kind, damage, speeds, slot):
    tags = {
        "sword": ["minecraft:is_sword", "minecraft:is_tool"],
        "pickaxe": ["minecraft:is_pickaxe", "minecraft:is_tool", "minecraft:digger"],
        "axe": ["minecraft:is_axe", "minecraft:is_tool", "minecraft:digger"],
        "shovel": ["minecraft:is_shovel", "minecraft:is_tool", "minecraft:digger"],
        "hoe": ["minecraft:is_hoe", "minecraft:is_tool", "minecraft:digger"],
    }[kind] + ["minecraft:netherite_tier", "the_sift:siftite_item"]
    c = {
        "minecraft:max_stack_size": 1,
        "minecraft:hand_equipped": {"value": True},
        "minecraft:damage": {"value": damage},
        "minecraft:durability": {"max_durability": TOOL_DURABILITY},
        "minecraft:enchantable": {"slot": slot, "value": 15},
        "minecraft:repairable": REPAIR_SIFTITE,
        "minecraft:fire_resistant": {"value": True},
        "minecraft:tags": {"tags": tags},
    }
    if speeds:
        c["minecraft:digger"] = {"use_efficiency": True, "destroy_speeds": speeds}
    return item(name, c, "equipment")


def build_items():
    item("charoite", {})
    item("siftite_nugget", {})
    item("siftite_ingot", {"minecraft:tags": {"tags": ["minecraft:transform_materials"]}})
    item("siftite_upgrade_smithing_template", {
        "minecraft:tags": {"tags": ["minecraft:transform_templates"]},
        "minecraft:rarity": "uncommon"})
    for name, n, s in (("raw_sifter_meat", 3, 0.3), ("cooked_sifter_meat", 8, 0.8)):
        item(name, {
            "minecraft:food": {"nutrition": n, "saturation_modifier": s},
            "minecraft:use_modifiers": {"use_duration": 1.6, "movement_modifier": 0.35},
            "minecraft:use_animation": "eat"})
    item("ichor_bottle", {
        "minecraft:max_stack_size": 1,
        "minecraft:food": {"nutrition": 0, "saturation_modifier": 0, "can_always_eat": True,
                           "using_converts_to": "minecraft:glass_bottle"},
        "minecraft:use_modifiers": {"use_duration": 1.6, "movement_modifier": 0.35},
        "minecraft:use_animation": "drink"})
    item("ichor_snowball", {
        "minecraft:max_stack_size": 16,
        "minecraft:throwable": {"do_swing_animation": True, "launch_power_scale": 1.0, "max_launch_power": 1.0},
        "minecraft:projectile": {"projectile_entity": sid("ichor_snowball"), "minimum_critical_power": 1.25}})
    item("ichor_bucket", {"minecraft:max_stack_size": 1})
    item("sift_rift", {"minecraft:max_stack_size": 1, "minecraft:rarity": "epic"})
    item("music_disc_rift", {"minecraft:max_stack_size": 1, "minecraft:rarity": "rare"})
    item("sculkflower_seeds", {
        "minecraft:block_placer": {"block": sid("sculkflower_crop"),
                                   "use_on": ["minecraft:farmland", "minecraft:sculk", sid("healthy_sculk")]},
        "minecraft:compostable": {"composting_chance": 30}}, "nature")

    pick = [{"block": {"tags": "q.any_tag('stone', 'metal', 'minecraft:is_pickaxe_item_destructible')"}, "speed": 11}]
    axe = [{"block": {"tags": "q.any_tag('wood', 'log', 'pumpkin', 'minecraft:is_axe_item_destructible')"}, "speed": 11}]
    shovel = [{"block": {"tags": "q.any_tag('dirt', 'sand', 'gravel', 'grass', 'snow', 'minecraft:is_shovel_item_destructible')"}, "speed": 11}]
    hoe = [{"block": {"tags": "q.any_tag('leaves', 'minecraft:is_hoe_item_destructible')"}, "speed": 11}]
    sword = [{"block": "minecraft:web", "speed": 15}, {"block": "minecraft:bamboo", "speed": 11}]
    tool("siftite_sword", "sword", 9, sword, "sword")
    tool("siftite_pickaxe", "pickaxe", 7, pick, "pickaxe")
    tool("siftite_axe", "axe", 9, axe, "axe")
    tool("siftite_shovel", "shovel", 7, shovel, "shovel")
    tool("siftite_hoe", "hoe", 6, hoe, "hoe")

    # lança: mesmo desenho da lança de netherite do Bedrock, um pouco mais forte
    item("siftite_spear", {
        "minecraft:tags": {"tags": ["minecraft:netherite_tier", "minecraft:is_spear", "the_sift:siftite_item"]},
        "minecraft:max_stack_size": 1,
        "minecraft:durability": {"max_durability": TOOL_DURABILITY, "damage_chance": {"min": 0, "max": 100}},
        "minecraft:repairable": REPAIR_SIFTITE,
        "minecraft:enchantable": {"slot": "melee_spear", "value": 15},
        "minecraft:hand_equipped": {"value": True},
        "minecraft:use_modifiers": {"use_duration": 72000, "emit_vibrations": False,
                                    "start_sound": "item.netherite_spear.use", "movement_modifier": 1.0},
        "minecraft:cooldown": {"category": "spear", "duration": 1.1, "type": "attack"},
        "minecraft:swing_duration": {"value": 1.1},
        "minecraft:swing_sounds": {"attack_miss": "item.netherite_spear.attack_miss",
                                   "attack_hit": "item.netherite_spear.attack_hit"},
        "minecraft:damage": {"value": 6},
        "minecraft:piercing_weapon": {"reach": {"min": 2.0, "max": 4.6}, "creative_reach": {"min": 2.0, "max": 7.5},
                                      "hitbox_margin": 0.25},
        "minecraft:kinetic_weapon": {
            "delay": 8, "reach": {"min": 2.0, "max": 4.6}, "creative_reach": {"min": 2.0, "max": 7.5},
            "hitbox_margin": 0.25, "damage_multiplier": 1.25,
            "damage_conditions": {"max_duration": 175, "min_relative_speed": 4.6},
            "knockback_conditions": {"max_duration": 110, "min_speed": 5.1},
            "dismount_conditions": {"max_duration": 50, "min_speed": 9.0}},
        "minecraft:fire_resistant": {"value": True},
    }, "equipment")

    armor = [
        ("siftite_helmet", "slot.armor.head", 3, 451, "armor_head", "minecraft:itemGroup.name.helmet"),
        ("siftite_chestplate", "slot.armor.chest", 8, 656, "armor_torso", "minecraft:itemGroup.name.chestplate"),
        ("siftite_leggings", "slot.armor.legs", 6, 615, "armor_legs", "minecraft:itemGroup.name.leggings"),
        ("siftite_boots", "slot.armor.feet", 3, 533, "armor_feet", "minecraft:itemGroup.name.boots"),
    ]
    for name, slot, prot, dur, eslot, group in armor:
        item(name, {
            "minecraft:max_stack_size": 1,
            "minecraft:wearable": {"slot": slot, "protection": prot},
            "minecraft:durability": {"max_durability": dur},
            "minecraft:enchantable": {"slot": eslot, "value": 15},
            "minecraft:repairable": REPAIR_SIFTITE,
            "minecraft:fire_resistant": {"value": True},
            "minecraft:tags": {"tags": ["minecraft:trimmable_armors", "the_sift:siftite_item"]},
        }, "equipment", group)


def build_attachables():
    """Armadura: a textura do Java (64x32) já tem o mesmo UV da do Bedrock."""
    layer1 = copy_png(asset("textures", "entity", "equipment", "humanoid", "siftite.png"),
                      "textures/the_sift/models/armor/siftite_1")
    layer2 = copy_png(asset("textures", "entity", "equipment", "humanoid_leggings", "siftite.png"),
                      "textures/the_sift/models/armor/siftite_2")
    out = {}
    for piece, geo, tex, script in (
        ("helmet", "geometry.humanoid.armor.helmet", layer1, "variable.helmet_layer_visible = 0.0;"),
        ("chestplate", "geometry.humanoid.armor.chestplate", layer1, "variable.chest_layer_visible = 0.0;"),
        ("leggings", "geometry.humanoid.armor.leggings", layer2, "variable.leg_layer_visible = 0.0;"),
        ("boots", "geometry.humanoid.armor.boots", layer1, "variable.boot_layer_visible = 0.0;"),
    ):
        out["siftite_" + piece] = {"format_version": "1.8.0", "minecraft:attachable": {"description": {
            "identifier": sid("siftite_" + piece),
            "materials": {"default": "armor", "enchanted": "armor_enchanted"},
            "textures": {"default": tex, "enchanted": "textures/misc/enchanted_actor_glint"},
            "geometry": {"default": geo},
            "scripts": {"parent_setup": script},
            "render_controllers": ["controller.render.armor"]}}}
    return out


# ---------------------------------------------------------------------------
# Receitas
# ---------------------------------------------------------------------------
RECIPES = {}
SKIP_RESULTS = {"overgrown_willow_boat", "overgrown_willow_chest_boat", "overgrown_willow_sign",
                "overgrown_willow_hanging_sign", "overgrown_willow_shelf"}
LOG_VARIANTS = [W + "_log", W + "_wood", "stripped_" + W + "_log", "stripped_" + W + "_wood"]


def ing(x):
    return {"item": x}


def recipe_id(name):
    return sid(name)


def convert_recipes():
    rdir = data("recipe")
    for fn in sorted(os.listdir(rdir)):
        r = load_json(os.path.join(rdir, fn))
        name = fn[:-5]
        t = r["type"].replace("minecraft:", "")
        res = r.get("result", {})
        rid = res.get("id", "") if isinstance(res, dict) else res
        if rid.replace("the_sift:", "") in SKIP_RESULTS:
            continue
        count = res.get("count", 1) if isinstance(res, dict) else 1
        if t == "crafting_shaped":
            RECIPES[name] = {"format_version": "1.20.10", "minecraft:recipe_shaped": {
                "description": {"identifier": recipe_id(name)}, "tags": ["crafting_table"],
                "pattern": r["pattern"], "key": {k: ing(v) for k, v in r["key"].items()},
                "result": {"item": rid, "count": count}}}
        elif t == "crafting_shapeless":
            ings = r["ingredients"]
            if ings == ["#the_sift:overgrown_willow_logs"]:
                for v in LOG_VARIANTS:
                    RECIPES[name + "_from_" + v] = {"format_version": "1.20.10", "minecraft:recipe_shapeless": {
                        "description": {"identifier": recipe_id(name + "_from_" + v)}, "tags": ["crafting_table"],
                        "ingredients": [ing(sid(v))], "result": {"item": rid, "count": count}}}
                continue
            RECIPES[name] = {"format_version": "1.20.10", "minecraft:recipe_shapeless": {
                "description": {"identifier": recipe_id(name)}, "tags": ["crafting_table"],
                "ingredients": [ing(i) for i in ings], "result": {"item": rid, "count": count}}}
        elif t == "smithing_transform":
            RECIPES[name] = {"format_version": "1.20.10", "minecraft:recipe_smithing_transform": {
                "description": {"identifier": recipe_id(name)}, "tags": ["smithing_table"],
                "template": r["template"], "base": r["base"], "addition": r["addition"], "result": rid}}
        elif t == "smelting":
            RECIPES["sifter_meat_cooking"] = {"format_version": "1.12", "minecraft:recipe_furnace": {
                "description": {"identifier": recipe_id("sifter_meat_cooking")},
                "tags": ["furnace", "smoker", "campfire", "soul_campfire"],
                "input": r["ingredient"], "output": rid}}
        # smoking / campfire já entram no furnace acima
    # Extras: as tábuas de salgueiro não têm a tag de tábuas do Bedrock
    for name, pattern, key, out, cnt in (
        ("sticks_from_overgrown_willow_planks", ["#", "#"], {"#": sid(W + "_planks")}, "minecraft:stick", 4),
        ("crafting_table_from_overgrown_willow_planks", ["##", "##"], {"#": sid(W + "_planks")}, "minecraft:crafting_table", 1),
        ("chest_from_overgrown_willow_planks", ["###", "# #", "###"], {"#": sid(W + "_planks")}, "minecraft:chest", 1),
    ):
        RECIPES[name] = {"format_version": "1.20.10", "minecraft:recipe_shaped": {
            "description": {"identifier": recipe_id(name)}, "tags": ["crafting_table"],
            "pattern": pattern, "key": {k: ing(v) for k, v in key.items()}, "result": {"item": out, "count": cnt}}}


# ---------------------------------------------------------------------------
# Entidades
# ---------------------------------------------------------------------------
BP_ENTITIES = {}
RP_ENTITIES = {}
RP_MODELS = {}
RP_ANIMS = {}
RP_ACS = {}
RP_RCS = {}


def convert_gecko_geo(name):
    d = load_json(asset("geckolib", "models", "entity", name + ".geo.json"))
    g = d["minecraft:geometry"][0]
    g["description"]["identifier"] = "geometry.the_sift." + name
    RP_MODELS[name] = {"format_version": "1.12.0", "minecraft:geometry": [g]}
    return "geometry.the_sift." + name


def _kf(v):
    if isinstance(v, dict):
        if "vector" in v:
            return v["vector"]
        return {k: _kf(x) for k, x in v.items()}
    return v


def convert_gecko_anims(name):
    d = load_json(asset("geckolib", "animations", "entity", name + ".animation.json"))
    out = {}
    ids = {}
    for an, a in d["animations"].items():
        na = {}
        if "loop" in a:
            na["loop"] = a["loop"]
        if "animation_length" in a:
            na["animation_length"] = a["animation_length"]
        bones = {}
        for bn, b in a.get("bones", {}).items():
            nb = {}
            for ch, v in b.items():
                if ch not in ("rotation", "position", "scale"):
                    continue
                nb[ch] = _kf(v)
            bones[bn] = nb
        na["bones"] = bones
        aid = "animation.the_sift.%s.%s" % (name, an)
        out[aid] = na
        ids[an] = aid
    RP_ANIMS[name] = {"format_version": "1.8.0", "animations": out}
    return ids


def client_entity(name, geometry, textures, animations, controllers, scripts, render_controllers,
                  materials=None, egg=True, extra=None):
    desc = {
        "identifier": sid(name),
        "materials": materials or {"default": "entity_alphatest"},
        "textures": textures,
        "geometry": geometry,
        "render_controllers": render_controllers,
    }
    if animations:
        desc["animations"] = animations
    if scripts:
        desc["scripts"] = scripts
    if controllers:
        desc["animation_controllers"] = controllers
    if egg:
        desc["spawn_egg"] = {"texture": item_tex(name + "_spawn_egg"), "texture_index": 0}
    if extra:
        desc.update(extra)
    RP_ENTITIES[name] = {"format_version": "1.10.0", "minecraft:client_entity": {"description": desc}}


def simple_rc(name, texture_expr="Texture.default", part_visibility=None):
    rc = {"geometry": "Geometry.default", "materials": [{"*": "Material.default"}], "textures": [texture_expr]}
    if part_visibility:
        rc["part_visibility"] = part_visibility
    RP_RCS["controller.render.the_sift." + name] = rc
    return "controller.render.the_sift." + name


def ac(name, states, initial="default"):
    cid = "controller.animation.the_sift." + name
    RP_ACS[cid] = {"initial_state": initial, "states": states}
    return cid


def copy_entity_tex(file, sub=""):
    rel = "textures/the_sift/entity/" + (sub + "/" if sub else "") + os.path.splitext(os.path.basename(file))[0]
    copy_png(asset("textures", "entity", *(([sub] if sub else []) + [file])), rel)
    return rel


def bp_entity(name, components, groups=None, events=None, spawnable=True, summonable=True, properties=None,
              runtime=None):
    desc = {"identifier": sid(name), "is_spawnable": spawnable, "is_summonable": summonable, "is_experimental": False}
    if properties:
        desc["properties"] = properties
    if runtime:
        desc["runtime_identifier"] = runtime
    ent = {"description": desc, "components": components}
    if groups:
        ent["component_groups"] = groups
    if events:
        ent["events"] = events
    BP_ENTITIES[name] = {"format_version": "1.21.0", "minecraft:entity": ent}


def common_mob(health, speed, width, height, family, extra=None):
    c = {
        "minecraft:type_family": {"family": family},
        "minecraft:health": {"value": health, "max": health},
        "minecraft:movement": {"value": speed},
        "minecraft:collision_box": {"width": width, "height": height},
        "minecraft:physics": {},
        "minecraft:pushable": {"is_pushable": True, "is_pushable_by_piston": True},
        "minecraft:nameable": {},
        "minecraft:jump.static": {},
        "minecraft:can_climb": {},
        "minecraft:movement.basic": {},
        "minecraft:navigation.walk": {"can_path_over_water": True, "avoid_damage_blocks": True, "avoid_water": True},
        "minecraft:breathable": {"total_supply": 15, "suffocate_time": 0},
        "minecraft:hurt_on_condition": {"damage_conditions": [{"filters": {"test": "in_lava", "subject": "self", "operator": "==", "value": True},
                                                               "cause": "lava", "damage_per_tick": 4}]},
        "minecraft:conditional_bandwidth_optimization": {},
        "minecraft:behavior.float": {"priority": 0},
        "minecraft:behavior.look_at_player": {"priority": 8, "look_distance": 8, "probability": 0.02},
        "minecraft:behavior.random_look_around": {"priority": 9},
    }
    if extra:
        c.update(extra)
    return c


def build_entities():
    # ---- Sifter (hostil) ----
    geo = convert_gecko_geo("sifter")
    an = convert_gecko_anims("sifter")
    tex = copy_entity_tex("sifter.png")
    client_entity("sifter", {"default": geo}, {"default": tex},
                  {"running": an["running"], "attack": an["attack"], "look_at_target": "animation.common.look_at_target"},
                  [{"move": ac("sifter.move", {
                      "default": {"transitions": [{"running": "q.modified_move_speed > 0.05"}], "blend_transition": 0.2},
                      "running": {"animations": ["running"], "transitions": [{"default": "q.modified_move_speed <= 0.05"}], "blend_transition": 0.2}})},
                   {"attack": ac("sifter.attack", {
                       "default": {"transitions": [{"attacking": "v.attack_time > 0"}]},
                       "attacking": {"animations": ["attack"], "transitions": [{"default": "q.any_animation_finished"}]}})}],
                  None, [simple_rc("sifter")])
    bp_entity("sifter", common_mob(40, 0.31, 0.9, 0.95, ["sifter", "monster", "mob"], {
        "minecraft:attack": {"damage": 10},
        "minecraft:follow_range": {"value": 28, "max": 28},
        "minecraft:experience_reward": {"on_death": "q.last_hit_by_player ? 5 : 0"},
        "minecraft:loot": {"table": loot_path("entities", "sifter")},
        "minecraft:despawn": {"despawn_from_distance": {}},
        "minecraft:behavior.melee_attack": {"priority": 2, "speed_multiplier": 1.18, "track_target": True},
        "minecraft:behavior.random_stroll": {"priority": 5, "speed_multiplier": 0.95},
        "minecraft:behavior.hurt_by_target": {"priority": 1},
        "minecraft:behavior.nearest_attackable_target": {"priority": 2, "must_see": True, "reselect_targets": True,
                                                         "entity_types": [{"filters": {"test": "is_family", "subject": "other", "value": "player"}, "max_dist": 28}]},
        "minecraft:ambient_sound_interval": {"value": 8, "range": 16, "event_name": "ambient"},
    }))
    add_loot("entities", "sifter", [{"rolls": 1, "entries": [{"type": "item", "name": sid("raw_sifter_meat"), "functions": [
        {"function": "set_count", "count": {"min": 1, "max": 2}},
        {"function": "furnace_smelt", "conditions": [{"condition": "entity_properties", "entity": "this", "properties": {"on_fire": True}}]},
        {"function": "looting_enchant", "count": {"min": 0, "max": 1}}]}]}])

    # ---- Blub (domesticável) ----
    geo = convert_gecko_geo("blub")
    an = convert_gecko_anims("blub")
    t_wild = copy_entity_tex("blub.png")
    t_tame = copy_entity_tex("tamed_blub.png")
    t_m = copy_entity_tex("blub_mielon.png")
    t_mt = copy_entity_tex("blub_mielon_tamed.png")
    RP_RCS["controller.render.the_sift.blub"] = {
        "arrays": {"textures": {"Array.skins": ["Texture.default", "Texture.tamed", "Texture.mielon", "Texture.mielon_tamed"]}},
        "geometry": "Geometry.default", "materials": [{"*": "Material.default"}],
        "textures": ["Array.skins[(q.is_tamed ? 1 : 0) + (q.get_name == 'Mielon' ? 2 : 0)]"]}
    client_entity("blub", {"default": geo}, {"default": t_wild, "tamed": t_tame, "mielon": t_m, "mielon_tamed": t_mt},
                  {"hopping": an["hopping"], "flapping": an["flapping"], "sitting": an["sitting"], "happy": an["happy"]},
                  [{"move": ac("blub.move", {
                      "default": {"transitions": [{"sitting": "q.is_sitting"}, {"flapping": "q.is_in_water"},
                                                  {"hopping": "q.modified_move_speed > 0.05"}], "blend_transition": 0.15},
                      "hopping": {"animations": ["hopping"], "transitions": [{"default": "q.modified_move_speed <= 0.05 || q.is_in_water || q.is_sitting"}], "blend_transition": 0.15},
                      "flapping": {"animations": ["flapping"], "transitions": [{"default": "!q.is_in_water"}], "blend_transition": 0.15},
                      "sitting": {"animations": ["sitting"], "transitions": [{"default": "!q.is_sitting"}], "blend_transition": 0.15}})}],
                  None, ["controller.render.the_sift.blub"])
    blub = common_mob(20, 0.3, 0.8, 0.9, ["blub", "mob"])
    del blub["minecraft:navigation.walk"]
    blub.update({
        "minecraft:attack": {"damage": 3},
        "minecraft:follow_range": {"value": 24, "max": 24},
        "minecraft:navigation.generic": {"can_path_over_water": True, "can_swim": True, "can_walk": True,
                                         "can_breach": True, "avoid_damage_blocks": True},
        "minecraft:movement.amphibious": {"max_turn": 15},
        "minecraft:underwater_movement": {"value": 0.2},
        "minecraft:breathable": {"total_supply": 300, "suffocate_time": 0, "breathes_water": True, "breathes_air": True},
        "minecraft:experience_reward": {"on_death": "q.last_hit_by_player ? 2 : 0"},
        "minecraft:loot": {"table": add_loot("entities", "blub", [])},
        "minecraft:healable": {"items": [{"item": sid("soul_block"), "heal_amount": 4},
                                         {"item": sid("cooked_sifter_meat"), "heal_amount": 4},
                                         {"item": sid("raw_sifter_meat"), "heal_amount": 2}]},
        "minecraft:behavior.tempt": {"priority": 4, "speed_multiplier": 1.1, "items": [sid("soul_block")]},
        "minecraft:behavior.melee_attack": {"priority": 3, "speed_multiplier": 1.2, "track_target": True},
        "minecraft:behavior.hurt_by_target": {"priority": 3, "alert_same_type": True},
        "minecraft:behavior.random_stroll": {"priority": 7, "speed_multiplier": 1.0},
        "minecraft:ambient_sound_interval": {"value": 10, "range": 16, "event_name": "ambient",
                                             "event_names": [{"event_name": "ambient.in.water", "condition": "q.is_in_water"}]},
    })
    bp_entity("blub", blub, groups={
        "the_sift:wild": {
            "minecraft:tameable": {"probability": 0.33, "tame_items": sid("soul_block"),
                                   "tame_event": {"event": "the_sift:on_tame", "target": "self"}},
            "minecraft:despawn": {"despawn_from_distance": {}},
        },
        "the_sift:tame": {
            "minecraft:is_tamed": {},
            "minecraft:sittable": {},
            "minecraft:behavior.stay_while_sitting": {"priority": 1},
            "minecraft:behavior.owner_hurt_by_target": {"priority": 1},
            "minecraft:behavior.owner_hurt_target": {"priority": 2},
            "minecraft:behavior.follow_owner": {"priority": 5, "speed_multiplier": 1.1, "start_distance": 10, "stop_distance": 2},
            "minecraft:behavior.teleport_to_owner": {"priority": 1, "filters": {"test": "owner_distance", "operator": ">", "value": 24}},
        },
    }, events={
        "minecraft:entity_spawned": {"add": {"component_groups": ["the_sift:wild"]}},
        "the_sift:on_tame": {"remove": {"component_groups": ["the_sift:wild"]}, "add": {"component_groups": ["the_sift:tame"]}},
    })

    # ---- Echo Golem ----
    geo = convert_gecko_geo("echo_golem")
    an = convert_gecko_anims("echo_golem")
    tex = copy_entity_tex("echo_golem.png")
    client_entity("echo_golem", {"default": geo}, {"default": tex},
                  {"idle": an["idle"], "walk": an["walk"], "carry_idle": an["carry_idle"], "carry_walk": an["carry_walk"],
                   "bow": an["bow"]},
                  [{"move": ac("echo_golem.move", {
                      "default": {"transitions": [{"walk": "q.modified_move_speed > 0.03 && !q.property('the_sift:carrying')"},
                                                  {"carry_idle": "q.property('the_sift:carrying')"}], "animations": ["idle"], "blend_transition": 0.2},
                      "walk": {"animations": ["walk"], "transitions": [{"default": "q.modified_move_speed <= 0.03 || q.property('the_sift:carrying')"}], "blend_transition": 0.2},
                      "carry_idle": {"animations": ["carry_idle"], "transitions": [{"default": "!q.property('the_sift:carrying')"},
                                                                                   {"carry_walk": "q.modified_move_speed > 0.03"}], "blend_transition": 0.2},
                      "carry_walk": {"animations": ["carry_walk"], "transitions": [{"default": "!q.property('the_sift:carrying')"},
                                                                                   {"carry_idle": "q.modified_move_speed <= 0.03"}], "blend_transition": 0.2}})}],
                  None, [simple_rc("echo_golem", part_visibility=[{"soul_block": "q.property('the_sift:carrying')"}])])
    bp_entity("echo_golem", common_mob(34, 0.23, 1.15, 1.65, ["echo_golem", "mob"], {
        "minecraft:knockback_resistance": {"value": 0.25},
        "minecraft:follow_range": {"value": 64, "max": 64},
        "minecraft:experience_reward": {"on_death": "q.last_hit_by_player ? 4 + math.random_integer(0, 3) : 0"},
        "minecraft:loot": {"table": loot_path("blocks", "empty")},
        "minecraft:behavior.random_stroll": {"priority": 6, "speed_multiplier": 0.8},
        "minecraft:behavior.panic": {"priority": 2, "speed_multiplier": 1.2},
    }), properties={"the_sift:carrying": {"type": "bool", "default": False, "client_sync": True}}, groups={
        "the_sift:wild": {
            "minecraft:tameable": {"probability": 1.0, "tame_items": "minecraft:echo_shard",
                                   "tame_event": {"event": "the_sift:on_bond", "target": "self"}},
        },
        "the_sift:bonded": {
            "minecraft:is_tamed": {},
            "minecraft:behavior.follow_owner": {"priority": 4, "speed_multiplier": 1.0, "start_distance": 12, "stop_distance": 4},
            "minecraft:behavior.teleport_to_owner": {"priority": 1, "filters": {"test": "owner_distance", "operator": ">", "value": 32}},
        },
    }, events={
        "minecraft:entity_spawned": {"add": {"component_groups": ["the_sift:wild"]}},
        "the_sift:on_bond": {"remove": {"component_groups": ["the_sift:wild"]}, "add": {"component_groups": ["the_sift:bonded"]}},
    })

    # ---- Singer (aparece ao tocar a buzina no centro da cidade ancestral) ----
    geo = convert_gecko_geo("singer")
    an = convert_gecko_anims("singer")
    tex = copy_entity_tex("singer.png")
    client_entity("singer", {"default": geo}, {"default": tex},
                  {"idle": an["idle"], "walk": an["walk"], "appear": an["appear"], "sing": an["sing"],
                   "disappear": an["disappear"], "receive_soul": an["receive_soul"]},
                  [{"phase": ac("singer.phase", {
                      "default": {"animations": ["idle"], "transitions": [
                          {"appear": "q.property('the_sift:phase') == 1"}, {"sing": "q.property('the_sift:phase') == 2"},
                          {"disappear": "q.property('the_sift:phase') == 3"}, {"walk": "q.modified_move_speed > 0.03"}]},
                      "walk": {"animations": ["walk"], "transitions": [{"default": "q.modified_move_speed <= 0.03"},
                                                                       {"appear": "q.property('the_sift:phase') == 1"}]},
                      "appear": {"animations": ["appear"], "transitions": [{"sing": "q.property('the_sift:phase') == 2"},
                                                                           {"default": "q.property('the_sift:phase') == 0"}]},
                      "sing": {"animations": ["sing"], "transitions": [{"disappear": "q.property('the_sift:phase') == 3"},
                                                                       {"default": "q.property('the_sift:phase') == 0"}]},
                      "disappear": {"animations": ["disappear"], "transitions": [{"default": "q.property('the_sift:phase') == 0"}]},
                  })}], None, [simple_rc("singer")])
    bp_entity("singer", {
        "minecraft:type_family": {"family": ["singer", "mob"]},
        "minecraft:health": {"value": 40, "max": 40},
        "minecraft:collision_box": {"width": 0.8, "height": 4.0},
        "minecraft:physics": {"has_gravity": True},
        "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
        "minecraft:knockback_resistance": {"value": 1.0},
        "minecraft:damage_sensor": {"triggers": [{"cause": "all", "deals_damage": "no"}]},
        "minecraft:movement": {"value": 0.0},
        "minecraft:persistent": {},
        "minecraft:nameable": {},
    }, properties={"the_sift:phase": {"type": "int", "range": [0, 3], "default": 0, "client_sync": True}})

    # ---- Dark Sniffer (sniffer infectado por sculk; usa o modelo do sniffer) ----
    tex = copy_entity_tex("dark_sniffer.png")
    client_entity("dark_sniffer", {"default": "geometry.sniffer"}, {"default": tex},
                  {"walk": "animation.sniffer.walk", "look_at_target": "animation.common.look_at_target",
                   "sniffsniff": "animation.sniffer.sniffsniff"},
                  [{"general": "controller.animation.sniffer.general"}, {"walk": "controller.animation.sniffer.walk"},
                   {"sniffsniff": "controller.animation.sniffer.sniffsniff"}],
                  {"pre_animation": ["variable.moving = math.min(1.0, query.modified_move_speed * 10);"]},
                  [simple_rc("dark_sniffer")], materials={"default": "sniffer"})
    bp_entity("dark_sniffer", common_mob(40, 0.1, 1.9, 1.75, ["dark_sniffer", "monster", "mob"], {
        "minecraft:attack": {"damage": 7},
        "minecraft:follow_range": {"value": 32, "max": 32},
        "minecraft:experience_reward": {"on_death": "q.last_hit_by_player ? 10 : 0"},
        "minecraft:loot": {"table": add_loot("entities", "dark_sniffer", [{"rolls": 1, "entries": [entry("minecraft:sculk")]}])},
        "minecraft:behavior.melee_attack": {"priority": 2, "speed_multiplier": 1.4, "track_target": True},
        "minecraft:behavior.hurt_by_target": {"priority": 1},
        "minecraft:behavior.nearest_attackable_target": {"priority": 2, "must_see": True,
                                                         "entity_types": [{"filters": {"test": "is_family", "subject": "other", "value": "player"}, "max_dist": 24}]},
        "minecraft:behavior.random_stroll": {"priority": 6, "speed_multiplier": 1.0},
        "minecraft:spawn_entity": {"entities": [{"min_wait_time": 240, "max_wait_time": 600,
                                                 "spawn_item": sid("sculkflower_seeds"), "spawn_sound": "plop"}]},
        "minecraft:ambient_sound_interval": {"value": 8, "range": 16, "event_name": "ambient"},
    }))

    # ---- Ichor Snowball ----
    tex = "textures/the_sift/items/ichor_snowball"
    item_tex("ichor_snowball")
    RP_ENTITIES["ichor_snowball"] = {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
        "identifier": sid("ichor_snowball"), "materials": {"default": "snowball"}, "textures": {"default": tex},
        "geometry": {"default": "geometry.item_sprite"}, "render_controllers": ["controller.render.item_sprite"],
        "animations": {"flying": "animation.actor.billboard"}, "scripts": {"animate": ["flying"]}}}}
    bp_entity("ichor_snowball", {
        "minecraft:type_family": {"family": ["projectile", "snowball"]},
        "minecraft:collision_box": {"width": 0.25, "height": 0.25},
        "minecraft:physics": {},
        "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": True},
        "minecraft:projectile": {
            "anchor": "eye_height", "angle_offset": 0.0, "offset": [0, -0.1, 0], "gravity": 0.03, "power": 1.5,
            "on_hit": {"impact_damage": {"damage": 0, "knockback": True},
                       "particle_on_hit": {"num_particles": 6, "on_other_hit": True, "on_entity_hit": True,
                                           "particle_type": "snowballpoof"},
                       "remove_on_hit": {}}},
    }, spawnable=False)

    # ---- Rift (fenda entre dimensões) ----
    geo = convert_gecko_geo("rift")
    an = convert_gecko_anims("rift")
    t_ow = copy_entity_tex("overworld.png", "rift")
    t_sift = copy_entity_tex("sift.png", "rift")
    RP_RCS["controller.render.the_sift.rift"] = {
        "arrays": {"textures": {"Array.skins": ["Texture.overworld", "Texture.sift"]}},
        "geometry": "Geometry.default", "materials": [{"*": "Material.default"}],
        "textures": ["Array.skins[q.property('the_sift:to_sift') ? 1 : 0]"], "light_color_multiplier": 1.0}
    client_entity("rift", {"default": geo}, {"overworld": t_ow, "sift": t_sift},
                  {"appear": an["appear"]}, None, {"animate": ["appear"]},
                  ["controller.render.the_sift.rift"], materials={"default": "entity_alphatest"}, egg=False)
    bp_entity("rift", {
        "minecraft:type_family": {"family": ["rift", "inanimate"]},
        "minecraft:health": {"value": 1, "max": 1},
        "minecraft:collision_box": {"width": 1.0, "height": 4.25},
        "minecraft:physics": {"has_gravity": False, "has_collision": False},
        "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
        "minecraft:damage_sensor": {"triggers": [{"cause": "all", "deals_damage": "no"}]},
        "minecraft:knockback_resistance": {"value": 1.0},
        "minecraft:persistent": {},
        "minecraft:fire_immune": {},
    }, spawnable=False, properties={"the_sift:to_sift": {"type": "bool", "default": True, "client_sync": True}})


def build_entity_sounds():
    """entity_sounds do RP/sounds.json."""
    return {
        sid("sifter"): {"events": {"ambient": "mob.parrot.idle", "hurt": "mob.parrot.hurt", "death": "mob.parrot.death",
                                   "step": "mob.parrot.step", "attack.strong": "mob.evocation_fangs.attack"},
                        "pitch": [0.6, 0.8], "volume": 1.0},
        sid("blub"): {"events": {"ambient": "mob.axolotl.idle", "ambient.in.water": "mob.axolotl.idle_water",
                                 "attack": "mob.axolotl.attack", "death": "mob.axolotl.death", "hurt": "mob.axolotl.hurt",
                                 "splash": "mob.axolotl.splash", "swim": "mob.axolotl.swim"}, "pitch": [0.8, 1.2], "volume": 1.0},
        sid("echo_golem"): {"events": {"death": "mob.copper_golem.death", "hurt": "mob.copper_golem.hurt",
                                       "spawn": "mob.copper_golem.spawn", "step": "mob.copper_golem.step"}, "pitch": 0.8, "volume": 1.0},
        sid("singer"): {"events": {"ambient": "the_sift.entity.singer.idle", "hurt": "the_sift.entity.singer.hurt",
                                   "death": "the_sift.entity.singer.death"}, "pitch": 1.0, "volume": 1.0},
        sid("dark_sniffer"): {"events": {"ambient": "mob.sniffer.idle", "death": "mob.sniffer.death", "hurt": "mob.sniffer.hurt",
                                         "plop": "mob.sniffer.plop", "step": "mob.sniffer.step"}, "pitch": [0.6, 0.8], "volume": 1.0},
    }


def build_sound_definitions():
    defs = {}
    sdir = os.path.join(RP, "sounds", "the_sift")
    for root, _, files in os.walk(asset("sounds")):
        for f in files:
            if f.endswith(".ogg"):
                rel = os.path.relpath(os.path.join(root, f), asset("sounds"))
                dst = os.path.join(sdir, rel)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copyfile(os.path.join(root, f), dst)
    js = load_json(asset("sounds.json"))
    cat = {"music_disc.rift": "record"}
    for key, v in js.items():
        sounds = []
        for s in v["sounds"]:
            if isinstance(s, str):
                s = {"name": s}
            if s.get("type") == "event":
                continue
            name = s["name"].replace("the_sift:", "sounds/the_sift/")
            e = {"name": name}
            if s.get("stream"):
                e["stream"] = True
            sounds.append(e)
        if not sounds:
            continue
        c = cat.get(key, "block" if key.startswith("block") or key.startswith("sonorous") or key.startswith("the_sift_portal") else "neutral")
        if key.startswith("block.sonorous") or key.startswith("sonorous"):
            c = "record"
        defs["the_sift." + key] = {"category": c, "sounds": sounds}
    return {"format_version": "1.20.20", "sound_definitions": defs}


# ---------------------------------------------------------------------------
# Partículas (Bedrock tem o próprio formato; recriadas a partir das texturas)
# ---------------------------------------------------------------------------
PARTICLES = {}


def particle(name, texture, props):
    base = {
        "format_version": "1.10.0",
        "particle_effect": {
            "description": {"identifier": sid(name),
                            "basic_render_parameters": {"material": props.get("material", "particles_alpha"), "texture": texture}},
            "components": props["components"],
        }}
    PARTICLES[name] = base


def build_particles():
    for f in ("sift_note", "soul", "sound_wave", "ichor_bubble", "sift_portal_mist"):
        copy_png(asset("textures", "particle", f + ".png"), "textures/the_sift/particle/" + f)
    # nota colorida (a cor vem do script: variable.color)
    particle("sonorous_note", "textures/the_sift/particle/sift_note", {"components": {
        "minecraft:emitter_rate_instant": {"num_particles": 1},
        "minecraft:emitter_lifetime_once": {"active_time": 0.1},
        "minecraft:emitter_shape_point": {"offset": [0, 0, 0], "direction": [0, 1, 0]},
        "minecraft:particle_lifetime_expression": {"max_lifetime": 0.9},
        "minecraft:particle_initial_speed": 1.2,
        "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 3},
        "minecraft:particle_appearance_billboard": {"size": [0.18, 0.18], "facing_camera_mode": "rotate_xyz",
                                                    "uv": {"texture_width": 8, "texture_height": 8, "uv": [0, 0], "uv_size": [8, 8]}},
        "minecraft:particle_appearance_tinting": {"color": ["variable.color.r", "variable.color.g", "variable.color.b", 1.0]},
        "minecraft:particle_appearance_lighting": {},
    }})
    # coluna de luz que sobe do bloco sonoro durante o autoplay
    particle("sonorous_beam", "textures/particle/particles", {"material": "particles_add", "components": {
        "minecraft:emitter_rate_steady": {"spawn_rate": 40, "max_particles": 120},
        "minecraft:emitter_lifetime_once": {"active_time": 1.5},
        "minecraft:emitter_shape_disc": {"radius": 0.25, "direction": [0, 1, 0]},
        "minecraft:particle_lifetime_expression": {"max_lifetime": 1.6},
        "minecraft:particle_initial_speed": 6,
        "minecraft:particle_motion_dynamic": {},
        "minecraft:particle_appearance_billboard": {"size": [0.12, 0.12], "facing_camera_mode": "lookat_xyz",
                                                    "uv": {"texture_width": 128, "texture_height": 128, "uv": [0, 0], "uv_size": [8, 8]}},
        "minecraft:particle_appearance_tinting": {"color": ["variable.color.r", "variable.color.g", "variable.color.b", 1.0]},
    }})
    particle("sonorous_burst", "textures/the_sift/particle/sift_note", {"components": {
        "minecraft:emitter_rate_instant": {"num_particles": 16},
        "minecraft:emitter_lifetime_once": {"active_time": 0.1},
        "minecraft:emitter_shape_sphere": {"radius": 0.4, "direction": "outwards"},
        "minecraft:particle_lifetime_expression": {"max_lifetime": 1.0},
        "minecraft:particle_initial_speed": 2.5,
        "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 2.5},
        "minecraft:particle_appearance_billboard": {"size": [0.14, 0.14], "facing_camera_mode": "rotate_xyz",
                                                    "uv": {"texture_width": 8, "texture_height": 8, "uv": [0, 0], "uv_size": [8, 8]}},
        "minecraft:particle_appearance_tinting": {"color": ["variable.color.r", "variable.color.g", "variable.color.b", 1.0]},
    }})
    # onda sonora do Singer: vai do Singer até o bloco (direção em variable.dir)
    particle("sound_wave", "textures/the_sift/particle/sound_wave", {"material": "particles_blend", "components": {
        "minecraft:emitter_rate_instant": {"num_particles": 1},
        "minecraft:emitter_lifetime_once": {"active_time": 0.1},
        "minecraft:emitter_shape_point": {"offset": [0, 0, 0], "direction": ["variable.dir.x", "variable.dir.y", "variable.dir.z"]},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "variable.life"},
        "minecraft:particle_initial_speed": 12,
        "minecraft:particle_motion_dynamic": {},
        "minecraft:particle_appearance_billboard": {"size": ["0.4 + variable.particle_age", "0.4 + variable.particle_age"],
                                                    "facing_camera_mode": "rotate_xyz",
                                                    "uv": {"texture_width": 10, "texture_height": 10, "uv": [0, 0], "uv_size": [10, 10]}},
    }})
    # alma flutuando (Soul Canyon / Echo Golem)
    particle("soul", "textures/the_sift/particle/soul", {"material": "particles_blend", "components": {
        "minecraft:emitter_rate_instant": {"num_particles": 1},
        "minecraft:emitter_lifetime_once": {"active_time": 0.1},
        "minecraft:emitter_shape_box": {"half_dimensions": [0.4, 0.2, 0.4], "direction": [0, 1, 0]},
        "minecraft:particle_lifetime_expression": {"max_lifetime": 2.5},
        "minecraft:particle_initial_speed": 0.6,
        "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 0.5},
        "minecraft:particle_appearance_billboard": {"size": [0.25, 0.25], "facing_camera_mode": "rotate_xyz",
                                                    "uv": {"texture_width": 275, "texture_height": 275, "uv": [0, 0], "uv_size": [275, 275]}},
        "minecraft:particle_appearance_tinting": {"color": [1, 1, 1, "1 - variable.particle_age / variable.particle_lifetime"]},
    }})
    # névoa do portal
    particle("portal_mist", "textures/the_sift/particle/sift_portal_mist", {"material": "particles_blend", "components": {
        "minecraft:emitter_rate_instant": {"num_particles": 3},
        "minecraft:emitter_lifetime_once": {"active_time": 0.1},
        "minecraft:emitter_shape_box": {"half_dimensions": [0.5, 0.5, 0.5], "direction": "outwards"},
        "minecraft:particle_lifetime_expression": {"max_lifetime": 1.8},
        "minecraft:particle_initial_speed": 0.3,
        "minecraft:particle_motion_dynamic": {},
        "minecraft:particle_appearance_billboard": {"size": [0.35, 0.35], "facing_camera_mode": "rotate_xyz",
                                                    "uv": {"texture_width": 320, "texture_height": 320, "uv": [0, 0], "uv_size": [320, 320]}},
        "minecraft:particle_appearance_tinting": {"color": [0.7, 0.95, 1.0, "0.6 * (1 - variable.particle_age / variable.particle_lifetime)"]},
    }})
    # bolhas do ichor
    particle("ichor_bubble", "textures/the_sift/particle/ichor_bubble", {"components": {
        "minecraft:emitter_rate_instant": {"num_particles": 2},
        "minecraft:emitter_lifetime_once": {"active_time": 0.1},
        "minecraft:emitter_shape_box": {"half_dimensions": [0.4, 0.1, 0.4], "direction": [0, 1, 0]},
        "minecraft:particle_lifetime_expression": {"max_lifetime": 0.8},
        "minecraft:particle_initial_speed": 0.8,
        "minecraft:particle_motion_dynamic": {},
        "minecraft:particle_appearance_billboard": {"size": [0.08, 0.08], "facing_camera_mode": "rotate_xyz",
                                                    "uv": {"texture_width": 8, "texture_height": 8, "uv": [0, 0], "uv_size": [8, 8]}},
    }})


# ---------------------------------------------------------------------------
# Estruturas (.nbt do Java -> .mcstructure do Bedrock)
# ---------------------------------------------------------------------------
from nbt import load_java, Byte, Int, Str, List_, Comp, dump_bedrock  # noqa: E402

BLOCK_VERSION = 18168865  # 1.21.60.33


def bedrock_state(name, props, ctx):
    """Nome + estados do bloco Bedrock para um estado do Java. None = vazio."""
    short = name.replace("the_sift:", "")
    if name == "minecraft:jigsaw":
        # no portal principal o jigsaw é o piso da moldura, onde o jogador chega
        return (sid("reinforced_siftslate"), {}) if ctx.get("main") else None
    if name == "minecraft:structure_void":
        return None
    if name in ("minecraft:air", "minecraft:cave_air"):
        return ("minecraft:air", {})
    if name == "minecraft:chest":
        return ("minecraft:chest", {"minecraft:cardinal_direction": Str(props.get("facing", "north"))})
    if short in (W + "_log", W + "_wood", "stripped_" + W + "_log", "stripped_" + W + "_wood"):
        face = {"y": "up", "x": "east", "z": "south"}[props.get("axis", "y")]
        return (name, {"minecraft:block_face": Str(face)})
    if short == W + "_foliage":
        return (name, {"the_sift:persistent": Byte(0)})
    if short == W + "_vines":
        support = next((d for d in ("north", "east", "south", "west") if props.get(d) == "true"), "north")
        face = {"north": "south", "south": "north", "east": "west", "west": "east"}[support]
        if ctx.get("above_supports"):
            face = "down"
        return (name, {"minecraft:block_face": Str(face), "the_sift:facing": Str(support),
                       "the_sift:tip": Byte(1 if props.get("bottom") == "true" else 0)})
    if short == "sift_portal":
        return (name, {"the_sift:axis": Str(ctx["portal_axis"])})
    if short == "sonorous_deepslate" and props.get("mode") == "note":
        return (sid("sonorous_deepslate_note"), {})
    if short in BLOCKS:
        return (name, {})
    raise ValueError("bloco sem mapeamento: %s %s" % (name, props))


def convert_structure(nbt_path, out_name, keep_air):
    d = load_java(nbt_path)
    sx, sy, sz = d["size"]
    pal = d["palette"]
    portal_pos = [b["pos"] for b in d["blocks"] if pal[b["state"]]["Name"] == sid("sift_portal")]
    ctx = {"portal_axis": "z" if portal_pos and len(set(p[0] for p in portal_pos)) == 1 else "x", "main": keep_air}
    bpal = []
    bindex = {}
    layer0 = [-1] * (sx * sy * sz)
    layer1 = [-1] * (sx * sy * sz)
    posdata = {}
    by_pos = {tuple(b["pos"]): pal[b["state"]]["Name"] for b in d["blocks"]}
    for b in d["blocks"]:
        st = pal[b["state"]]
        x0, y0, z0 = b["pos"]
        above = by_pos.get((x0, y0 + 1, z0), "")
        ctx["above_supports"] = above.endswith("_foliage") or above.endswith("_vines") or above.endswith("_log") or above.endswith("_wood")
        res = bedrock_state(st["Name"], st.get("Properties", {}), ctx)
        if res is None or (res[0] == "minecraft:air" and not keep_air):
            continue
        key = (res[0], tuple(sorted((k, v.t, v.v) for k, v in res[1].items())))
        if key not in bindex:
            bindex[key] = len(bpal)
            bpal.append(Comp({"name": Str(res[0]), "states": Comp(res[1]), "version": Int(BLOCK_VERSION)}))
        x, y, z = b["pos"]
        idx = (x * sy + y) * sz + z
        layer0[idx] = bindex[key]
        if st["Name"] == "minecraft:chest":
            posdata[str(idx)] = Comp({"block_entity_data": Comp({
                "id": Str("Chest"), "Items": List_(10, []), "isMovable": Byte(1), "Findable": Byte(0),
                "LootTable": Str(loot_path("chests", "abandoned_portal")), "LootTableSeed": Int(0),
                "x": Int(x), "y": Int(y), "z": Int(z)})})
    root = Comp({
        "format_version": Int(1),
        "size": List_(3, [Int(sx), Int(sy), Int(sz)]),
        "structure": Comp({
            "block_indices": List_(9, [List_(3, [Int(i) for i in layer0]), List_(3, [Int(i) for i in layer1])]),
            "entities": List_(10, []),
            "palette": Comp({"default": Comp({
                "block_palette": List_(10, bpal),
                "block_position_data": Comp(posdata)})}),
        }),
        "structure_world_origin": List_(3, [Int(0), Int(0), Int(0)]),
    })
    out = os.path.join(BP, "structures", "the_sift", out_name + ".mcstructure")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    dump_bedrock(root, out)
    info = {"size": [sx, sy, sz]}
    logs = [b["pos"] for b in d["blocks"] if pal[b["state"]]["Name"] == sid(W + "_log")]
    if logs:
        low = min(p[1] for p in logs)
        base = sorted(p for p in logs if p[1] == low)
        info["trunk"] = list(base[len(base) // 2])
    return info


def build_structures():
    info = {}
    sdir = data("structure")
    for root, _, files in os.walk(sdir):
        for f in files:
            if f.endswith(".nbt"):
                rel = os.path.relpath(os.path.join(root, f), sdir)[:-4].replace(os.sep, "_")
                info[rel] = convert_structure(os.path.join(root, f), rel, keep_air=(rel == "main_portal"))
    # loot dos baús dos portais abandonados
    j = load_json(data("loot_table", "chests", "abandoned_portal.json"))

    def conv_entry(e, weight=None):
        ne = {"type": "item", "name": e["name"], "weight": weight or e.get("weight", 1)}
        for m in e.get("functions", e.get("modifier", [])):
            if m.get("type", m.get("function", "")).endswith("set_count"):
                cnt = m["count"]
                if isinstance(cnt, dict):
                    cnt = {"min": cnt["min"], "max": cnt["max"]}
                ne["functions"] = [{"function": "set_count", "count": cnt}]
        return ne

    pools = []
    for p in j["pools"]:
        rolls = p["rolls"]
        if isinstance(rolls, dict):
            rolls = {"min": rolls["min"], "max": rolls["max"]}
        entries = []
        for e in p["entries"]:
            if e["type"].endswith("alternatives"):
                # "alternatives" com um filho de 10%: vira dois pesos 1:9
                kids = e["children"]
                chance = kids[0].get("condition", {}).get("chance", 0.5)
                entries.append(conv_entry(kids[0], max(1, round(chance * 10))))
                entries.append(conv_entry(kids[1], max(1, round((1 - chance) * 10))))
                continue
            if e["name"].replace("the_sift:", "") in SKIP_RESULTS:
                continue
            entries.append(conv_entry(e))
        pool = {"rolls": rolls, "entries": entries}
        cond = p.get("condition")
        if cond and cond.get("type", "").endswith("random_chance"):
            pool["conditions"] = [{"condition": "random_chance", "chance": cond["chance"]}]
        pools.append(pool)
    add_loot("chests", "abandoned_portal", pools)
    return info


# ---------------------------------------------------------------------------
# Dimensão, bioma, névoa
# ---------------------------------------------------------------------------
def build_world_defs():
    write_json(os.path.join(BP, "dimensions", "the_sift.json"), {
        "format_version": "1.21.80",
        "minecraft:dimension": {
            "description": {"identifier": sid("the_sift")},
            "components": {
                "minecraft:dimension_bounds": {"min": 0, "max": 256},
                "minecraft:generation": {"generator_type": "void"},
                "minecraft:default_biome": {"biome": sid("sift")},
            }}})
    write_json(os.path.join(BP, "biomes", "sift.json"), {
        "format_version": "1.21.40",
        "minecraft:biome": {
            "description": {"identifier": sid("sift")},
            "components": {
                "minecraft:climate": {"temperature": 0.7, "downfall": 0.6, "snow_accumulation": [0.0, 0.0]},
                "minecraft:tags": {"tags": ["the_sift", "sift", "no_legacy_worldgen"]},
            }}})
    write_json(os.path.join(RP, "biomes", "sift.client_biome.json"), {
        "format_version": "1.21.40",
        "minecraft:client_biome": {
            "description": {"identifier": sid("sift")},
            "components": {
                "minecraft:fog_appearance": {"fog_identifier": sid("fog_sift")},
                "minecraft:sky_color": {"sky_color": "#CFEFF2"},
                "minecraft:water_appearance": {"surface_color": "#4ADCE8"},
            }}})
    # névoas: a padrão do Sift e as que o script empilha por "bioma" e subsolo
    fogs = {
        "fog_sift": ("#D7F1F3", 40, 190),
        "fog_sift_overgrown": ("#A9DCCB", 30, 160),
        "fog_sift_snowy": ("#EEF8FA", 24, 150),
        "fog_sift_deep": ("#0B1417", 8, 60),
    }
    for name, (color, start, end) in fogs.items():
        write_json(os.path.join(RP, "fogs", name + ".fog.json"), {
            "format_version": "1.16.100",
            "minecraft:fog_settings": {
                "description": {"identifier": sid(name)},
                "distance": {
                    "air": {"fog_start": start, "fog_end": end, "fog_color": color, "render_distance_type": "fixed"},
                    "water": {"fog_start": 0, "fog_end": 40, "fog_color": "#2E8E99", "render_distance_type": "fixed"},
                }}})


# ---------------------------------------------------------------------------
# Traduções
# ---------------------------------------------------------------------------
def java_lang(code):
    p = asset("lang", code + ".json")
    return load_json(p) if os.path.exists(p) else {}


def to_bedrock_lang(j):
    out = {}
    for k, v in j.items():
        m = re.match(r"entity\.the_sift\.(\w+)$", k)
        if m:
            out["entity.the_sift:%s.name" % m.group(1)] = v
            continue
        m = re.match(r"item\.the_sift\.(\w+)_spawn_egg$", k)
        if m:
            out["item.spawn_egg.entity.the_sift:%s.name" % m.group(1)] = v
            continue
        out[k] = v
    return out


EXTRA_EN = {
    "pack.name": "Mielon's The Sift",
    "pack.description": "Bedrock port of Mielon's The Sift: siftslate, Ichor, ancient life and resonant souls.",
    "block.the_sift.sonorous_deepslate_note": "Sonorous Deepslate (Note)",
    "block.the_sift.sculkflower_crop": "Sculkflower Crop",
    "item.the_sift.ichor_snow": "Ichor Snow",
    "message.the_sift.sift_generating": "The Sift is taking shape around you...",
    "message.the_sift.no_frame": "There is no reinforced deepslate frame nearby.",
    "message.the_sift.singer_arrives": "Something answers the horn...",
    "message.the_sift.advancement": "Advancement made: %s",
    "message.the_sift.golem_soul": "The Echo Golem found a soul for you. Interact with it to receive the Soul Block.",
    "message.the_sift.back_to_spawn": "The way back was lost. You returned to your spawn point.",
    "biome.the_sift.deep": "Deep",
    "entity.the_sift:ichor_snowball.name": "Ichor Snowball",
}


def build_lang():
    langs = {}
    en = to_bedrock_lang(java_lang("en_us"))
    en.update(EXTRA_EN)
    pt_extra = load_json(os.path.join(HERE, "pt_br.json"))
    pt = dict(en)
    pt.update(to_bedrock_lang(pt_extra))
    langs["en_US"] = en
    langs["pt_BR"] = pt
    for code, jc in (("pl_PL", "pl_pl"), ("ko_KR", "ko_kr")):
        m = dict(en)
        m.update(to_bedrock_lang(java_lang(jc)))
        langs[code] = m
    for pack in (BP, RP):
        tdir = os.path.join(pack, "texts")
        os.makedirs(tdir, exist_ok=True)
        for code, d in langs.items():
            with open(os.path.join(tdir, code + ".lang"), "w", encoding="utf-8") as f:
                for k, v in d.items():
                    if pack == BP and not k.startswith("pack."):
                        continue
                    v = v.replace("\n", " ")
                    f.write("%s=%s\n" % (k, v))
        write_json(os.path.join(tdir, "languages.json"), list(langs.keys()))
    return langs


# ---------------------------------------------------------------------------
# Manifests e saída
# ---------------------------------------------------------------------------
def manifests():
    write_json(os.path.join(BP, "manifest.json"), {
        "format_version": 2,
        "header": {"name": "pack.name", "description": "pack.description", "uuid": BP_UUID,
                   "version": VERSION, "min_engine_version": MIN_ENGINE},
        "modules": [
            {"type": "data", "uuid": BP_DATA_UUID, "version": VERSION},
            {"type": "script", "language": "javascript", "uuid": BP_SCRIPT_UUID, "entry": "scripts/main.js",
             "version": VERSION},
        ],
        "dependencies": [
            {"uuid": RP_UUID, "version": VERSION},
            {"module_name": "@minecraft/server", "version": "2.8.0"},
        ],
        "metadata": {"authors": ["Mielon (original)", "Bedrock port"], "license": "MIT", "product_type": "addon"},
    })
    write_json(os.path.join(RP, "manifest.json"), {
        "format_version": 2,
        "header": {"name": "pack.name", "description": "pack.description", "uuid": RP_UUID,
                   "version": VERSION, "min_engine_version": MIN_ENGINE},
        "modules": [{"type": "resources", "uuid": RP_RES_UUID, "version": VERSION}],
        "dependencies": [{"uuid": BP_UUID, "version": VERSION}],
        "metadata": {"authors": ["Mielon (original)", "Bedrock port"], "license": "MIT", "product_type": "addon"},
    })
    for pack in (BP, RP):
        shutil.copyfile(asset("icon.png"), os.path.join(pack, "pack_icon.png"))
        # a licença MIT do mod original vai junto com qualquer cópia
        shutil.copyfile(src("LICENSE_the_sift"), os.path.join(pack, "LICENSE_the_sift.txt"))


def clean():
    for pack in (BP, RP):
        if not os.path.isdir(pack):
            continue
        for entry_ in os.listdir(pack):
            if pack == BP and entry_ == "scripts":
                continue
            p = os.path.join(pack, entry_)
            shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)


def main():
    global JAR
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    JAR = os.path.abspath(sys.argv[1])
    clean()
    os.makedirs(BP, exist_ok=True)
    os.makedirs(RP, exist_ok=True)
    load_tool_tags()

    build_blocks()
    build_items()
    convert_recipes()
    build_entities()
    build_particles()
    structures = build_structures()
    build_world_defs()

    for name, b in BLOCKS.items():
        write_json(os.path.join(BP, "blocks", name + ".json"), b)
    for name, it in list(ITEMS.items()) + list(BLOCK_ITEMS.items()):
        write_json(os.path.join(BP, "items", name + ".json"), it)
    for name, r in RECIPES.items():
        write_json(os.path.join(BP, "recipes", name + ".json"), r)
    for path, lt in LOOT.items():
        write_json(os.path.join(BP, path), lt)
    for name, e in BP_ENTITIES.items():
        write_json(os.path.join(BP, "entities", name + ".json"), e)

    for name, e in RP_ENTITIES.items():
        write_json(os.path.join(RP, "entity", name + ".entity.json"), e)
    for name, g in RP_MODELS.items():
        write_json(os.path.join(RP, "models", "entity", name + ".geo.json"), g)
    for name, g in GEOS.items():
        write_json(os.path.join(RP, "models", "blocks", name + ".geo.json"), g)
    for name, a in RP_ANIMS.items():
        write_json(os.path.join(RP, "animations", name + ".animation.json"), a)
    write_json(os.path.join(RP, "animation_controllers", "the_sift.animation_controllers.json"),
               {"format_version": "1.10.0", "animation_controllers": RP_ACS})
    write_json(os.path.join(RP, "render_controllers", "the_sift.render_controllers.json"),
               {"format_version": "1.8.0", "render_controllers": RP_RCS})
    for name, a in build_attachables().items():
        write_json(os.path.join(RP, "attachables", name + ".json"), a)
    for name, p in PARTICLES.items():
        write_json(os.path.join(RP, "particles", name + ".json"), p)

    write_json(os.path.join(RP, "textures", "terrain_texture.json"), {
        "resource_pack_name": NS, "texture_name": "atlas.terrain", "padding": 8, "num_mip_levels": 4,
        "texture_data": {k: {"textures": v} for k, v in sorted(TERRAIN.items())}})
    write_json(os.path.join(RP, "textures", "item_texture.json"), {
        "resource_pack_name": NS, "texture_name": "atlas.items",
        "texture_data": {k: {"textures": v} for k, v in sorted(ITEMS_TEX.items())}})
    write_json(os.path.join(RP, "textures", "flipbook_textures.json"), FLIPBOOKS)
    blocks_json = {"format_version": [1, 1, 0]}
    for name, snd in sorted(BLOCK_SOUNDS.items()):
        blocks_json[sid(name)] = {"sound": snd}
    write_json(os.path.join(RP, "blocks.json"), blocks_json)
    write_json(os.path.join(RP, "sounds", "sound_definitions.json"), build_sound_definitions())
    write_json(os.path.join(RP, "sounds.json"), {"entity_sounds": {"entities": build_entity_sounds()}})
    build_lang()
    manifests()

    # dados que o script precisa (tamanhos das estruturas etc.)
    with open(os.path.join(BP, "scripts", "generated.js"), "w", encoding="utf-8") as f:
        f.write("// Gerado por tools/port.py. Não editar à mão.\n")
        f.write("export const STRUCTURES = %s;\n" % json.dumps(structures, indent=2, sort_keys=True))
    print("blocos:", len(BLOCKS), "itens:", len(ITEMS) + len(BLOCK_ITEMS), "receitas:", len(RECIPES),
          "entidades:", len(BP_ENTITIES), "estruturas:", len(structures), "texturas:", len(TERRAIN) + len(ITEMS_TEX))


if __name__ == "__main__":
    main()
