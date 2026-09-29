#!/usr/bin/env python3
"""
Confere as referências cruzadas do add-on sem abrir o jogo:
texturas, geometrias, loot tables, animações, render controllers, sons,
partículas, traduções, receitas e estruturas usadas pelos scripts.

Uso: python3 tools/validate.py   (sai com código 1 se achar problema)
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "TheSift_BP")
RP = os.path.join(ROOT, "packs", "TheSift_RP")

errors = []


def err(msg):
    errors.append(msg)


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def walk_json(base):
    for root, _, files in os.walk(base):
        for f in files:
            if f.endswith(".json"):
                p = os.path.join(root, f)
                try:
                    yield p, load(p)
                except Exception as e:  # noqa: BLE001
                    err("JSON inválido: %s (%s)" % (p, e))


def png(pack, rel):
    return os.path.exists(os.path.join(pack, rel + ".png"))


# ---- atlas -------------------------------------------------------------------
terrain = load(os.path.join(RP, "textures", "terrain_texture.json"))["texture_data"]
items_tex = load(os.path.join(RP, "textures", "item_texture.json"))["texture_data"]
for k, v in list(terrain.items()) + list(items_tex.items()):
    if not png(RP, v["textures"]):
        err("textura sem arquivo: %s -> %s" % (k, v["textures"]))
for fb in load(os.path.join(RP, "textures", "flipbook_textures.json")):
    if fb["atlas_tile"] not in terrain:
        err("flipbook sem atlas: " + fb["atlas_tile"])

# ---- geometrias ----------------------------------------------------------------
geos = {"minecraft:geometry.full_block", "minecraft:geometry.cross"}
for p, j in walk_json(os.path.join(RP, "models")):
    for g in j.get("minecraft:geometry", []):
        geos.add(g["description"]["identifier"])
VANILLA_GEOS = {"geometry.sniffer", "geometry.item_sprite", "geometry.humanoid.armor.helmet",
                "geometry.humanoid.armor.chestplate", "geometry.humanoid.armor.leggings", "geometry.humanoid.armor.boots"}

# ---- lang -----------------------------------------------------------------------
lang = {}
for line in open(os.path.join(RP, "texts", "en_US.lang"), encoding="utf-8"):
    if "=" in line:
        k, v = line.rstrip("\n").split("=", 1)
        lang[k] = v
for code in ("pt_BR", "pl_PL", "ko_KR"):
    keys = set(l.split("=", 1)[0] for l in open(os.path.join(RP, "texts", code + ".lang"), encoding="utf-8") if "=" in l)
    missing = set(lang) - keys
    if missing:
        err("%s sem %d chaves (ex.: %s)" % (code, len(missing), sorted(missing)[:3]))

# ---- blocos --------------------------------------------------------------------
block_ids = set()
custom_components = set()
for p, j in walk_json(os.path.join(BP, "blocks")):
    b = j["minecraft:block"]
    bid = b["description"]["identifier"]
    block_ids.add(bid)
    comps = [b["components"]] + [pp["components"] for pp in b.get("permutations", [])]
    states = set(b["description"].get("states", {}))
    for t in b["description"].get("traits", {}).values():
        for s in t.get("enabled_states", []):
            states |= {"minecraft:block_face", "minecraft:vertical_half", "minecraft:cardinal_direction",
                       "minecraft:multi_block_part"} if s else set()
    conds = [pp["condition"] for pp in b.get("permutations", [])]
    for c in conds:
        for s in re.findall(r"block_state\('([^']+)'\)", c):
            if s not in states:
                err("%s: estado '%s' não declarado" % (bid, s))
    for c in comps:
        for k in c:
            if not k.startswith("minecraft:") and not k.startswith("tag:"):
                custom_components.add(k)
        g = c.get("minecraft:geometry")
        if g:
            gid = g if isinstance(g, str) else g["identifier"]
            if gid not in geos:
                err("%s: geometria %s não existe" % (bid, gid))
            if isinstance(g, dict):
                for bone, expr in g.get("bone_visibility", {}).items():
                    if isinstance(expr, str):
                        for s in re.findall(r"block_state\('([^']+)'\)", expr):
                            if s not in states:
                                err("%s: estado '%s' (bone_visibility) não declarado" % (bid, s))
        for m in (c.get("minecraft:material_instances") or {}).values():
            if m["texture"] not in terrain:
                err("%s: textura %s fora do atlas" % (bid, m["texture"]))
        lt = c.get("minecraft:loot")
        if lt and not os.path.exists(os.path.join(BP, lt)):
            err("%s: loot %s não existe" % (bid, lt))
        dn = c.get("minecraft:display_name")
        if dn and dn["value"] not in lang:
            err("%s: tradução %s faltando" % (bid, dn["value"]))

# componentes custom registrados nos scripts
scripts = ""
for root, _, files in os.walk(os.path.join(BP, "scripts")):
    for f in files:
        if f.endswith(".js"):
            scripts += open(os.path.join(root, f), encoding="utf-8").read()
registered = set(re.findall(r'registerCustomComponent\("([^"]+)"', scripts))
for c in custom_components - registered:
    err("componente custom sem registro no script: " + c)

# ---- itens ---------------------------------------------------------------------
item_ids = set()
for p, j in walk_json(os.path.join(BP, "items")):
    it = j["minecraft:item"]
    iid = it["description"]["identifier"]
    item_ids.add(iid)
    c = it["components"]
    icon = c.get("minecraft:icon")
    if icon:
        key = icon if isinstance(icon, str) else icon["textures"]["default"]
        if key not in items_tex:
            err("%s: ícone %s fora do atlas" % (iid, key))
    dn = c.get("minecraft:display_name")
    if dn and dn["value"] not in lang:
        err("%s: tradução %s faltando" % (iid, dn["value"]))
    bp_ = c.get("minecraft:block_placer")
    if bp_ and bp_["block"] not in block_ids:
        err("%s: block_placer aponta pra %s" % (iid, bp_["block"]))
    pr = c.get("minecraft:projectile")
    if pr and not os.path.exists(os.path.join(BP, "entities", pr["projectile_entity"].split(":")[1] + ".json")):
        err("%s: projétil sem entidade" % iid)

known = block_ids | item_ids


def check_item_ref(where, name):
    if name.startswith("the_sift:") and name not in known:
        err("%s: item %s não existe" % (where, name))


# ---- receitas / loot -------------------------------------------------------------
for p, j in walk_json(os.path.join(BP, "recipes")):
    for s in re.findall(r'"(the_sift:[a-z_0-9]+)"', json.dumps(j)):
        if s == j[[k for k in j if k.startswith("minecraft:recipe")][0]]["description"]["identifier"]:
            continue
        check_item_ref(os.path.basename(p), s)
for p, j in walk_json(os.path.join(BP, "loot_tables")):
    for s in re.findall(r'"name": "(the_sift:[a-z_0-9]+)"', json.dumps(j)):
        check_item_ref(os.path.basename(p), s)

# ---- entidades ------------------------------------------------------------------
anims = set()
for p, j in walk_json(os.path.join(RP, "animations")):
    anims |= set(j["animations"])
acs = set()
for p, j in walk_json(os.path.join(RP, "animation_controllers")):
    acs |= set(j["animation_controllers"])
rcs = set()
for p, j in walk_json(os.path.join(RP, "render_controllers")):
    rcs |= set(j["render_controllers"])
bp_ents = set()
for p, j in walk_json(os.path.join(BP, "entities")):
    e = j["minecraft:entity"]
    bp_ents.add(e["description"]["identifier"])
    lt = e["components"].get("minecraft:loot")
    if lt and not os.path.exists(os.path.join(BP, lt["table"])):
        err("%s: loot %s" % (e["description"]["identifier"], lt["table"]))
for p, j in walk_json(os.path.join(RP, "entity")):
    d = j["minecraft:client_entity"]["description"]
    eid = d["identifier"]
    if eid not in bp_ents:
        err("client entity sem BP: " + eid)
    for g in d["geometry"].values():
        if g not in geos and g not in VANILLA_GEOS:
            err("%s: geometria %s" % (eid, g))
    for t in d["textures"].values():
        if t.startswith("textures/the_sift") and not png(RP, t):
            err("%s: textura %s" % (eid, t))
    for a in d.get("animations", {}).values():
        if a.startswith("animation.the_sift") and a not in anims:
            err("%s: animação %s" % (eid, a))
    for c in d.get("animation_controllers", []):
        for v in c.values():
            if v.startswith("controller.animation.the_sift") and v not in acs:
                err("%s: controller %s" % (eid, v))
    for r in d["render_controllers"]:
        if isinstance(r, str) and r.startswith("controller.render.the_sift") and r not in rcs:
            err("%s: render controller %s" % (eid, r))
    egg = d.get("spawn_egg")
    if egg and egg["texture"] not in items_tex:
        err("%s: ovo %s" % (eid, egg["texture"]))
    if "entity.%s.name" % eid not in lang:
        err("tradução faltando: entity.%s.name" % eid)
    if egg and "item.spawn_egg.entity.%s.name" % eid not in lang:
        err("tradução faltando: item.spawn_egg.entity.%s.name" % eid)
for p, j in walk_json(os.path.join(RP, "attachables")):
    d = j["minecraft:attachable"]["description"]
    if not png(RP, d["textures"]["default"]):
        err("armadura sem textura: " + d["identifier"])

# ---- sons, partículas, estruturas, traduções usadas pelos scripts ------------------
sounds = set(load(os.path.join(RP, "sounds", "sound_definitions.json"))["sound_definitions"])
for name, sd in load(os.path.join(RP, "sounds", "sound_definitions.json"))["sound_definitions"].items():
    for s in sd["sounds"]:
        if not os.path.exists(os.path.join(RP, s["name"] + ".ogg")):
            err("som sem arquivo: " + s["name"])
for s in set(re.findall(r'"(the_sift\.[a-z0-9_.]+)"', scripts)):
    if s not in sounds:
        err("script usa som inexistente: " + s)
parts = set()
for p, j in walk_json(os.path.join(RP, "particles")):
    parts.add(j["particle_effect"]["description"]["identifier"])
for s in set(re.findall(r'spawnParticle\("(the_sift:[a-z_]+)"', scripts)):
    if s not in parts:
        err("script usa partícula inexistente: " + s)
structs = set("the_sift:" + f[:-12] for f in os.listdir(os.path.join(BP, "structures", "the_sift")))
for s in set(re.findall(r'"(the_sift:(?:main_portal|overgrown_willow_[a-z0-9_]+|abandoned_portal_[a-z0-9_]+))"', scripts)):
    if s not in structs:
        err("script usa estrutura inexistente: " + s)
for s in set(re.findall(r'translate: "([a-z_.]+)"', scripts)):
    if s.endswith("."):
        continue  # prefixo concatenado no script
    if s not in lang:
        err("script usa tradução inexistente: " + s)
for s in set(re.findall(r'"(the_sift:[a-z_0-9]+)"', scripts)):
    if s.startswith("the_sift:fog") or s in ("the_sift:the_sift", "the_sift:seed", "the_sift:return", "the_sift:main_portal",
                                             "the_sift:advancements", "the_sift:biomes", "the_sift:infection",
                                             "the_sift:siftite_item", "the_sift:siftite_") or s in registered:
        continue
    if s not in known and s not in bp_ents and s not in parts and s not in structs:
        # estados e propriedades também começam com the_sift:
        if not re.search(r"(age|tip|facing|open|pressed|double|layers|persistent|axis|phase|carrying|to_sift|[nesw])$", s):
            err("script cita id desconhecido: " + s)

if errors:
    print("\n".join("✘ " + e for e in errors))
    print("%d problema(s)" % len(errors))
    sys.exit(1)
print("✔ tudo certo: %d blocos, %d itens, %d entidades" % (len(block_ids), len(item_ids), len(bp_ents)))
