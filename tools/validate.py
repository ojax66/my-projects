#!/usr/bin/env python3
"""Confere o addon antes de empacotar.

Checa o que quebra silenciosamente no Bedrock: JSON malformado, UUID repetido,
dependência apontando pro pack errado, identificador que um arquivo declara e
outro referencia com outro nome, textura citada que não existe.
"""
import json
import os
import re
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "Distant Horizons BP")
RP = os.path.join(ROOT, "packs", "Distant Horizons RP")

errors = []
warnings = []


def err(msg):
    errors.append(msg)


def warn(msg):
    warnings.append(msg)


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:  # noqa: BLE001
        err(f"JSON inválido em {os.path.relpath(path, ROOT)}: {e}")
        return None


def all_json(root):
    for dirpath, _, names in os.walk(root):
        for n in names:
            if n.endswith(".json"):
                yield os.path.join(dirpath, n)


# --- 1. Todo JSON precisa carregar --------------------------------------------
docs = {}
for base in (BP, RP):
    for p in all_json(base):
        d = load(p)
        if d is not None:
            docs[p] = d

# --- 2. Manifests: UUIDs únicos e dependências cruzadas certas -----------------
bp_manifest = docs.get(os.path.join(BP, "manifest.json"))
rp_manifest = docs.get(os.path.join(RP, "manifest.json"))

if not bp_manifest or not rp_manifest:
    err("manifest.json faltando no BP ou no RP")
else:
    uuids = []
    for name, m in (("BP", bp_manifest), ("RP", rp_manifest)):
        uuids.append((f"{name}.header", m["header"]["uuid"]))
        for mod in m.get("modules", []):
            uuids.append((f"{name}.module", mod["uuid"]))

    seen = {}
    for where, u in uuids:
        if u in seen:
            err(f"UUID repetido {u} ({seen[u]} e {where})")
        seen[u] = where

    UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    for where, u in uuids:
        if not UUID_RE.match(u):
            err(f"UUID mal formado em {where}: {u}")

    # BP depende do RP e vice-versa, pelo header uuid do outro.
    bp_deps = {d.get("uuid") for d in bp_manifest.get("dependencies", [])}
    rp_deps = {d.get("uuid") for d in rp_manifest.get("dependencies", [])}
    if rp_manifest["header"]["uuid"] not in bp_deps:
        err("BP não declara dependência do RP")
    if bp_manifest["header"]["uuid"] not in rp_deps:
        err("RP não declara dependência do BP")

    # A entry do módulo de script precisa existir.
    for mod in bp_manifest.get("modules", []):
        if mod.get("type") == "script":
            entry = os.path.join(BP, mod["entry"])
            if not os.path.isfile(entry):
                err(f"entry do script não existe: {mod['entry']}")


# --- 3. Dimensão, bioma e client biome falando do mesmo identificador ---------
def described(doc, key):
    # languages.json e afins são listas — nem todo JSON do pack é um objeto.
    if not isinstance(doc, dict):
        return None
    return doc.get(key, {}).get("description", {}).get("identifier")


dim_doc = docs.get(os.path.join(BP, "dimensions", "outer_space.json"))
biome_doc = docs.get(os.path.join(BP, "biomes", "espaco_sideral.json"))
client_biome_doc = docs.get(os.path.join(RP, "biomes", "espaco_sideral.client_biome.json"))

dim_id = described(dim_doc or {}, "minecraft:dimension")
biome_id = described(biome_doc or {}, "minecraft:biome")
client_biome_id = described(client_biome_doc or {}, "minecraft:client_biome")

if not dim_id:
    err("dimensão sem identifier")
if biome_id != client_biome_id:
    err(f"bioma do BP ({biome_id}) e client biome do RP ({client_biome_id}) não batem")

default_biome = (
    (dim_doc or {}).get("minecraft:dimension", {}).get("components", {})
    .get("minecraft:default_biome", {}).get("biome")
)
if default_biome != biome_id:
    err(f"default_biome da dimensão ({default_biome}) não é o bioma declarado ({biome_id})")

# --- 4. Os scripts usam os mesmos ids que os JSONs declaram -------------------
config_path = os.path.join(BP, "scripts", "space_dim", "config.js")
config_src = ""
if os.path.isfile(config_path):
    with open(config_path, encoding="utf-8") as f:
        config_src = f.read()
else:
    err("config.js não encontrado")


def const_of(name):
    m = re.search(rf'export const {name} = "([^"]+)"', config_src)
    return m.group(1) if m else None


if config_src:
    if const_of("DIMENSION_ID") != dim_id:
        err(f"DIMENSION_ID ({const_of('DIMENSION_ID')}) != dimensão declarada ({dim_id})")

    # Limites verticais do config x do JSON da dimensão.
    bounds = (
        (dim_doc or {}).get("minecraft:dimension", {}).get("components", {})
        .get("minecraft:dimension_bounds", {})
    )
    for const, key in (("DIM_MIN_Y", "min"), ("DIM_MAX_Y", "max")):
        m = re.search(rf"export const {const} = (-?\d+)", config_src)
        if m and bounds.get(key) is not None and int(m.group(1)) != bounds[key]:
            err(f"{const} ({m.group(1)}) != dimension_bounds.{key} ({bounds[key]})")

    # Névoa e partículas citadas no config precisam existir no RP.
    fog_ids = set()
    for p, d in docs.items():
        fid = described(d, "minecraft:fog_settings")
        if fid:
            fog_ids.add(fid)
    if const_of("FOG_ID") not in fog_ids:
        err(f"FOG_ID {const_of('FOG_ID')} não existe no RP (achei: {sorted(fog_ids)})")

    particle_ids = set()
    for p, d in docs.items():
        if not isinstance(d, dict):
            continue
        pid = d.get("particle_effect", {}).get("description", {}).get("identifier")
        if pid:
            particle_ids.add(pid)
    for const in ("STARFIELD_PARTICLE", "SPACE_DUST_PARTICLE"):
        if const_of(const) not in particle_ids:
            err(f"{const} {const_of(const)} não existe no RP (achei: {sorted(particle_ids)})")

    # O client biome tem que apontar pra névoa que existe.
    cb_fog = (
        (client_biome_doc or {}).get("minecraft:client_biome", {}).get("components", {})
        .get("minecraft:fog_appearance", {}).get("fog_identifier")
    )
    if cb_fog and cb_fog not in fog_ids:
        err(f"client biome aponta pra névoa inexistente: {cb_fog}")

# --- 4b. Blocos custom: definidos no BP, no RP, com textura e nome -----------
#
# Um bloco custom precisa de quatro peças em dois packs. Faltando uma, o bloco
# vira cubo roxo no jogo e nada avisa. Aqui as quatro são conferidas contra os
# ids que as paletas de bodies.js realmente usam.
bodies_path = os.path.join(BP, "scripts", "space_dim", "bodies.js")
used_blocks = set()
if os.path.isfile(bodies_path):
    with open(bodies_path, encoding="utf-8") as f:
        used_blocks = set(re.findall(r'"(space_dim:[a-z0-9_]+)"', f.read()))
else:
    err("bodies.js não encontrado")

declared_blocks = {}
for p, d in docs.items():
    if not isinstance(d, dict):
        continue
    bid = described(d, "minecraft:block")
    if bid:
        declared_blocks[bid] = (p, d)

rp_blocks = docs.get(os.path.join(RP, "blocks.json"), {})
terrain = docs.get(os.path.join(RP, "textures", "terrain_texture.json"), {})
terrain_data = terrain.get("texture_data", {}) if isinstance(terrain, dict) else {}

# Nome de item, bloco e bioma e coisa do cliente: o jogo so le esses .lang no
# RESOURCE pack. Enquanto ficaram no BP, o addon carregava sem reclamar e todo
# item aparecia com o id cru no inventario.
lang_names = set()
lang_path = os.path.join(RP, "texts", "en_US.lang")
if os.path.isfile(lang_path):
    with open(lang_path, encoding="utf-8") as f:
        lang_names = set(re.findall(r"^tile\.(space_dim:[a-z0-9_]+)\.name=", f.read(), re.M))
else:
    err("RP/texts/en_US.lang nao existe — nenhum nome apareceria no jogo")

# E o BP nao pode ter nome nenhum: se tiver, alguem escreveu no lugar errado.
bp_lang = os.path.join(BP, "texts", "en_US.lang")
if os.path.isfile(bp_lang):
    with open(bp_lang, encoding="utf-8") as f:
        stray = re.findall(r"^(?:item|tile|biome)\.[^=]+=", f.read(), re.M)
    if stray:
        err(f"BP/texts/en_US.lang tem {len(stray)} nome(s) de item/bloco/bioma — "
            f"o jogo ignora isso no behavior pack; mova pro RP/texts")

for bid in sorted(used_blocks):
    if bid not in declared_blocks:
        err(f"paleta usa {bid}, que não tem JSON de bloco no BP")
        continue
    if bid not in rp_blocks:
        err(f"{bid} não está em RP/blocks.json — viraria cubo roxo")
    if bid not in lang_names:
        err(f"{bid} sem nome em RP/texts/en_US.lang — apareceria como o id")

    # material_instances -> terrain_texture -> arquivo de textura
    _, doc = declared_blocks[bid]
    mats = doc["minecraft:block"]["components"].get("minecraft:material_instances", {})
    tex_key = mats.get("*", {}).get("texture")
    if not tex_key:
        err(f"{bid} sem texture em material_instances")
        continue
    if tex_key not in terrain_data:
        err(f"{bid} usa a chave de textura {tex_key}, ausente de terrain_texture.json")
        continue
    tex_path = terrain_data[tex_key].get("textures")
    if not any(os.path.isfile(os.path.join(RP, tex_path + ext)) for ext in (".png", ".tga")):
        err(f"{bid} aponta pra textura inexistente: {tex_path}")

    # a entrada do RP tem que apontar pra mesma chave de textura
    rp_tex = rp_blocks.get(bid, {}).get("textures")
    if rp_tex and rp_tex != tex_key:
        err(f"{bid}: blocks.json usa {rp_tex} mas o BP usa {tex_key}")

# Blocos declarados que ninguém usa: não quebra nada, mas é peso morto.
for bid in sorted(set(declared_blocks) - used_blocks):
    warn(f"{bid} está definido mas nenhuma paleta usa")

# --- 4c. O Sol precisa ser atravessável ---------------------------------------
#
# A coroa e o plasma não podem ter colisão: é o que deixa o jogador entrar no
# Sol camada por camada. Se alguém regenerar os blocos sem `solid=False`, o Sol
# vira uma bola maciça e ninguém percebe até tentar entrar.
for bid, (path, doc) in sorted(declared_blocks.items()):
    comps = doc["minecraft:block"]["components"]
    short = bid.split(":", 1)[1]
    if short in ("sun_corona", "sun_plasma"):
        if comps.get("minecraft:collision_box") is not False:
            err(f"{bid} precisa de collision_box false — o Sol tem que ser atravessável")
        if not comps.get("minecraft:light_emission"):
            err(f"{bid} devia emitir luz; sem isso o Sol é uma silhueta no vácuo")
    if short == "sun_core":
        if comps.get("minecraft:collision_box") is False:
            err("sun_core devia ser sólido — é o destino de quem atravessa o Sol")

# --- 4c-bis. O que vem de outros packs ---------------------------------------
#
# O traje reforçado aponta pro modelo, textura e itens do Spacecraft em vez de
# duplicar a arte deles aqui. Esses caminhos não existem NESTE pack, então o
# validador precisa saber quais são legítimos — e só esses. Liberar qualquer
# coisa que comece com "textures/nv/" deixaria um erro de digitação passar.
EXTERNAL = {"textures": set(), "geometries": set(), "items": set(), "prefixes": []}
_ext_path = os.path.join(ROOT, "tools", "assets", "external_assets.json")
if os.path.isfile(_ext_path):
    try:
        with open(_ext_path, encoding="utf-8") as f:
            _ext = json.load(f)
        for key, block in _ext.items():
            if key.startswith("_") or not isinstance(block, dict):
                continue
            EXTERNAL["textures"].update(block.get("textures", []))
            EXTERNAL["geometries"].update(block.get("geometries", []))
            EXTERNAL["items"].update(block.get("items", []))
        EXTERNAL["prefixes"] = _ext.get("vanilla_geometry_prefixes", [])
    except Exception as e:  # noqa: BLE001
        err(f"external_assets.json ilegível: {e}")
else:
    warn("tools/assets/external_assets.json ausente — nada de outro pack é aceito")


def texture_exists(path):
    """A textura existe neste pack, ou é uma emprestada e declarada?"""
    if path in EXTERNAL["textures"]:
        return True
    return any(os.path.isfile(os.path.join(RP, path + e)) for e in (".png", ".tga"))


def geometry_known(geo, pack_geometries):
    if geo in pack_geometries or geo in EXTERNAL["geometries"]:
        return True
    return any(geo.startswith(p) for p in EXTERNAL["prefixes"])


# --- 4d. Itens, armadura, attachables e receitas ------------------------------
#
# Um item custom espalha as peças por seis arquivos nos dois packs. O que
# quebra em silêncio: ícone sem entrada no item_texture, attachable apontando
# pra geometria que não existe, receita citando item que ninguém declarou.
declared_items = {}
for p, d in docs.items():
    if not isinstance(d, dict):
        continue
    iid = described(d, "minecraft:item")
    if iid:
        declared_items[iid] = (p, d)

item_tex = docs.get(os.path.join(RP, "textures", "item_texture.json"), {})
item_tex_data = item_tex.get("texture_data", {}) if isinstance(item_tex, dict) else {}

attachables = {}
for p, d in docs.items():
    if not isinstance(d, dict):
        continue
    aid = described(d, "minecraft:attachable")
    if aid:
        attachables[aid] = (p, d)

# Geometrias que o pack define, mais as do próprio jogo que é válido usar.
pack_geometries = set()
for p, d in docs.items():
    if not isinstance(d, dict):
        continue
    for geo in d.get("minecraft:geometry", []) or []:
        gid = geo.get("description", {}).get("identifier")
        if gid:
            pack_geometries.add(gid)

item_lang = set()
if os.path.isfile(lang_path):
    with open(lang_path, encoding="utf-8") as f:
        item_lang = set(re.findall(r"^item\.(space_dim:[a-z0-9_]+)=", f.read(), re.M))

for iid, (path, doc) in sorted(declared_items.items()):
    comps = doc["minecraft:item"]["components"]

    icon = comps.get("minecraft:icon")
    if not icon:
        err(f"{iid} sem minecraft:icon")
    elif icon not in item_tex_data:
        err(f"{iid} usa o ícone {icon}, ausente de item_texture.json")
    else:
        tex = item_tex_data[icon].get("textures")
        if not texture_exists(tex):
            err(f"{iid} aponta pra textura de ícone inexistente: {tex}")

    if iid not in item_lang:
        err(f"{iid} sem nome em RP/texts/en_US.lang — apareceria como o id")

    # Peça de armadura precisa do attachable, senão ela é invisível vestida.
    if comps.get("minecraft:wearable"):
        if iid not in attachables:
            err(f"{iid} é vestível mas não tem attachable — ficaria invisível no corpo")
            continue
        _, att = attachables[iid]
        desc = att["minecraft:attachable"]["description"]
        geo = desc.get("geometry", {}).get("default")
        if not geo:
            err(f"attachable de {iid} sem geometria")
        elif not geometry_known(geo, pack_geometries):
            err(f"attachable de {iid} usa a geometria {geo}, que nem o pack define "
                f"nem está declarada em external_assets.json")
        atex = desc.get("textures", {}).get("default")
        if atex and not texture_exists(atex):
            err(f"attachable de {iid} aponta pra textura inexistente: {atex}")

# Attachable órfão: existe mas nenhum item o usa.
for aid in sorted(set(attachables) - set(declared_items)):
    warn(f"attachable {aid} não corresponde a nenhum item")

# --- 4e. Receitas só citam coisas que existem ---------------------------------
known = set(declared_items) | set(declared_blocks)


def check_recipe_ref(ref, where):
    if not isinstance(ref, str):
        ref = (ref or {}).get("item") if isinstance(ref, dict) else None
    if not isinstance(ref, str):
        return
    name = ref.split("(")[0].strip()
    if name.startswith("minecraft:"):
        return              # item do jogo: fora do nosso alcance conferir
    if not name.startswith("space_dim:"):
        # Item de outro addon (o Spacecraft). Só passa se estiver declarado —
        # assim uma receita que dependa deles fica visível, e um id errado de
        # digitação é pego em vez de virar receita que nunca funciona.
        if name not in EXTERNAL["items"]:
            err(f"receita {where} cita {name}, de outro addon, "
                f"não declarado em external_assets.json")
        return
    if name not in known:
        err(f"receita {where} cita {name}, que o addon não declara")


for p, d in docs.items():
    if not isinstance(d, dict):
        continue
    for key in ("minecraft:recipe_shapeless", "minecraft:recipe_shaped",
                "minecraft:recipe_smithing_transform", "minecraft:recipe_furnace"):
        r = d.get(key)
        if not r:
            continue
        where = r.get("description", {}).get("identifier", os.path.basename(p))
        for ing in r.get("ingredients", []) or []:
            check_recipe_ref(ing, where)
        for k in ("template", "base", "addition", "input", "result"):
            v = r.get(k)
            if isinstance(v, list):
                for item in v:
                    check_recipe_ref(item, where)
            else:
                check_recipe_ref(v, where)
        for v in (r.get("key") or {}).values():
            check_recipe_ref(v, where)

# --- 4e-bis. format_version das receitas --------------------------------------
#
# Um format_version que o jogo não reconhece pra receita faz o arquivo inteiro
# não carregar, EM SILÊNCIO: nada no console, a receita simplesmente não existe
# na bancada. Foi assim que todas as receitas do addon ficaram sem funcionar de
# uma vez, por estarem em "1.21.80" — que é versão de item/bloco, não de
# receita. As versões abaixo são as que o Spacecraft usa (e funcionam) e as
# que a documentação usa pra ferraria.
RECIPE_FORMAT_OK = {
    "minecraft:recipe_shaped": {"1.12", "1.16", "1.17", "1.19", "1.20.10", "1.20.30"},
    "minecraft:recipe_shapeless": {"1.12", "1.16", "1.17", "1.19", "1.20.10", "1.20.30"},
    "minecraft:recipe_furnace": {"1.12", "1.16", "1.17", "1.19", "1.20.10", "1.20.30"},
    "minecraft:recipe_brewing_mix": {"1.12", "1.16", "1.17", "1.19", "1.20.10"},
    "minecraft:recipe_smithing_transform": {"1.19", "1.20.10", "1.20.30", "1.21.0"},
    "minecraft:recipe_smithing_trim": {"1.19", "1.20.10", "1.20.30", "1.21.0"},
}

# --- 4d-bis. corpos vistos de longe -------------------------------------------
#
# Cada corpo de BODIES precisa da entidade que o desenha de longe, dos dois
# lados, e da textura. Faltando qualquer peça o corpo some quando passa da
# distância de renderização — que no espaço é quase sempre.
config_src = ""
config_path = os.path.join(BP, "scripts", "space_dim", "config.js")
if os.path.isfile(config_path):
    with open(config_path, encoding="utf-8") as f:
        config_src = f.read()

body_ids = re.findall(r'^\s*id:\s*"([a-z0-9_]+)"', config_src, re.M)
if not body_ids:
    warn("nao consegui ler os ids de BODIES no config.js")

# A estrela é o terceiro nível: o corpo visto de fora do sistema. Sem ela, quem
# se afastasse da borda nao veria nada — nem bloco, nem modelo, nem ponto.
for extra in ("star",):
    if not os.path.isfile(os.path.join(BP, "entities", f"sky_{extra}.json")):
        err(f"falta a entidade sky_{extra} no BP")
    if not os.path.isfile(os.path.join(RP, "entity", f"sky_{extra}.entity.json")):
        err(f"falta a entidade sky_{extra} no RP")
    if not os.path.isfile(os.path.join(RP, "textures", "space_dim", "sky", f"{extra}.png")):
        err(f"falta a textura da {extra}")

for bid in body_ids:
    bp_entity = os.path.join(BP, "entities", f"sky_{bid}.json")
    rp_entity = os.path.join(RP, "entity", f"sky_{bid}.entity.json")
    texture = os.path.join(RP, "textures", "space_dim", "sky", f"{bid}.png")
    if not os.path.isfile(bp_entity):
        err(f"corpo {bid} sem entidade de ceu no BP (entities/sky_{bid}.json) — "
            f"ele sumiria passando da distancia de renderizacao")
    if not os.path.isfile(rp_entity):
        err(f"corpo {bid} sem entidade de ceu no RP (entity/sky_{bid}.entity.json)")
    if not os.path.isfile(texture):
        err(f"corpo {bid} sem textura de ceu (textures/space_dim/sky/{bid}.png)")

# A escala do modelo vem de uma propriedade de entidade. Se o config pedir um
# valor fora da faixa declarada, o motor ignora calado e o corpo fica do
# tamanho errado — nada no console, nenhum erro.
def config_number(name):
    m = re.search(rf"^export const {name} = ([0-9.]+);", config_src, re.M)
    return float(m.group(1)) if m else None

min_scale = config_number("SKY_MODEL_MIN_SCALE")
max_scale = config_number("SKY_MODEL_MAX_SCALE")
for bid in body_ids:
    path = os.path.join(BP, "entities", f"sky_{bid}.json")
    doc = docs.get(path)
    if not isinstance(doc, dict):
        continue
    props = doc.get("minecraft:entity", {}).get("description", {}).get("properties", {})
    size = props.get("space_dim:size")
    if not size:
        err(f"sky_{bid} sem a propriedade space_dim:size — nao daria pra escalar")
        continue
    lo, hi = size.get("range", [None, None])
    if min_scale is not None and lo is not None and lo > min_scale:
        err(f"sky_{bid}: a faixa de space_dim:size comeca em {lo}, mas o config "
            f"pode pedir {min_scale} — o motor ignoraria o valor calado")
    if max_scale is not None and hi is not None and hi < max_scale:
        err(f"sky_{bid}: a faixa de space_dim:size termina em {hi}, mas o config "
            f"pode pedir {max_scale}")

# Todo corpo visto de longe usa o material PROPRIO do addon, e ele tem que
# existir de verdade no RP.
#
# Historico: `entity_emissive_alpha` trata alfa 0 como TRANSPARENTE, e as
# texturas do ceu sao todas alfa 0 (alfa e a mascara de brilho) — resultado,
# todo corpo ficou invisivel e nada no jogo dizia por que. O material proprio
# herda de `entity`, que e opaco e nao tem teste de alfa, e liga USE_EMISSIVE.
SKY_MATERIAL = "space_dim_sky"

material_defined = False
mat_path = os.path.join(RP, "materials", "entity.material")
if os.path.isfile(mat_path):
    with open(mat_path, encoding="utf-8") as f:
        mat_doc = json.load(f)
    for key in mat_doc.get("materials", {}):
        if key.split(":")[0] == SKY_MATERIAL:
            material_defined = True
            base = key.split(":")[1] if ":" in key else ""
            entry = mat_doc["materials"][key]
            if base != "entity":
                err(f"o material {SKY_MATERIAL} herda de '{base}', esperado 'entity' — "
                    f"as outras bases descartam ou misturam por alfa, e a textura "
                    f"do ceu e toda alfa 0")
            if "USE_EMISSIVE" not in (entry.get("+defines") or []):
                err(f"o material {SKY_MATERIAL} nao liga USE_EMISSIVE — "
                    f"sem isso o alfa nao vira brilho e o corpo fica preto")
if not material_defined:
    err(f"RP/materials/entity.material nao define {SKY_MATERIAL} — "
        f"os corpos vistos de longe nao teriam material")

for bid in list(body_ids) + ["star"]:
    doc = docs.get(os.path.join(RP, "entity", f"sky_{bid}.entity.json"))
    if not isinstance(doc, dict):
        continue
    desc = doc.get("minecraft:client_entity", {}).get("description", {})
    mat = desc.get("materials", {}).get("default")
    if mat != SKY_MATERIAL:
        err(f"sky_{bid} usa o material {mat}, esperado {SKY_MATERIAL}")
    if not desc.get("scripts", {}).get("should_update_bones_and_effects_offscreen"):
        err(f"sky_{bid} sem should_update_bones_and_effects_offscreen — "
            f"a escala congelaria quando o modelo saisse da tela")

# E a textura tem que ser toda alfa 0: e assim que USE_EMISSIVE le brilho
# maximo. Uma textura opaca aqui daria um corpo preto no vacuo.
for bid in list(body_ids) + ["star"]:
    tex = os.path.join(RP, "textures", "space_dim", "sky", f"{bid}.png")
    if not os.path.isfile(tex):
        continue
    with open(tex, "rb") as f:
        raw = f.read()
    # basta saber que existe pixel com alfa != 0 nas faces; a leitura completa
    # de PNG nao vale a pena aqui, entao confere so o tipo de cor (RGBA).
    if raw[25] != 6:
        err(f"a textura de ceu {bid}.png nao e RGBA — sem canal alfa nao ha "
            f"como o material saber o que acende")

# Todo corpo tem que caber dentro de SOLAR_SYSTEM_RADIUS: e a borda que decide
# quando o corpo vira uma estrela no ceu, e um corpo fora dela nunca apareceria
# como corpo — so como pontinho, pra sempre.
sys_radius = config_number("SOLAR_SYSTEM_RADIUS")
if sys_radius:
    coords = re.findall(
        r'id:\s*"(\w+)",[\s\S]*?center:\s*\{\s*x:\s*(-?\d+),\s*y:\s*\w+,\s*z:\s*(-?\d+)\s*\}',
        config_src)
    seen = {}
    for bid, x, z in coords:
        seen.setdefault(bid, (int(x), int(z)))
    if "sun" in seen:
        sx, sz = seen["sun"]
        for bid, (x, z) in seen.items():
            d = max(abs(x - sx), abs(z - sz))
            if d > sys_radius:
                err(f"{bid} esta a {d} do Sol, alem de SOLAR_SYSTEM_RADIUS "
                    f"({sys_radius:.0f})")

# O modelo do ceu tem que USAR a textura inteira. Box UV mapeia o tamanho do
# cubo direto em pixels — 16 unidades usariam 16 px de uma textura de 256, e o
# corpo visto de longe voltaria a ser uma mancha em vez do desenho da
# superficie. Por isso as faces sao mapeadas uma a uma.
geo_path = os.path.join(RP, "models", "entity", "sky_body.geo.json")
geo = docs.get(geo_path)
if isinstance(geo, dict):
    entry = (geo.get("minecraft:geometry") or [{}])[0]
    desc = entry.get("description", {})
    tw = desc.get("texture_width")
    th = desc.get("texture_height")
    cube = ((entry.get("bones") or [{}])[0].get("cubes") or [{}])[0]
    uv = cube.get("uv")
    if not isinstance(uv, dict):
        err("sky_body.geo.json usa box UV — com a textura de "
            f"{tw}x{th} o modelo mostraria so um pedaco dela; mapeie face a face")
    else:
        faltando = {"up", "down", "east", "west", "north", "south"} - set(uv)
        if faltando:
            err(f"sky_body.geo.json sem UV pras faces: {sorted(faltando)}")
        # E a textura do corpo tem que ter o tamanho que o modelo declara.
        for bid in list(body_ids) + ["star"]:
            tex = os.path.join(RP, "textures", "space_dim", "sky", f"{bid}.png")
            if not os.path.isfile(tex):
                continue
            with open(tex, "rb") as f:
                head = f.read(24)
            w, h = struct.unpack(">II", head[16:24])
            if (w, h) != (tw, th):
                err(f"a textura de ceu {bid}.png e {w}x{h}, mas o modelo declara "
                    f"{tw}x{th} — as faces cairiam no lugar errado")

# --- 4d-ter. mapas estelares e sistemas ---------------------------------------
#
# O id do item de mapa carrega o id do sistema que ele abre. Um mapa apontando
# pra um sistema que nao existe no catalogo e um item que nao faz nada: o
# jogador usa, nao acontece nada, e nada explica por que.
catalog_src = ""
catalog_path = os.path.join(BP, "scripts", "space_dim", "catalog.js")
if os.path.isfile(catalog_path):
    with open(catalog_path, encoding="utf-8") as f:
        catalog_src = f.read()
system_ids = set(re.findall(r'^\s*id:\s*"([a-z0-9_]+)",\s*$', catalog_src, re.M))

for iid in sorted(declared_items):
    short = iid.split(":", 1)[1]
    if not short.startswith("star_chart_"):
        continue
    target = short[len("star_chart_"):]
    if catalog_src and target not in system_ids:
        err(f"{iid} abre o sistema '{target}', que nao existe em catalog.js — "
            f"usar o mapa nao faria nada")

# Os corpos do catalogo que dizem `ref:` tem que existir em BODIES.
for ref in re.findall(r'\{\s*ref:\s*"([a-z0-9_]+)"', catalog_src):
    if body_ids and ref not in body_ids:
        err(f"catalog.js rastreia o corpo '{ref}', que nao existe em BODIES")

# --- 4d-quater. dependencia do server-ui --------------------------------------
#
# O menu do rastreador usa @minecraft/server-ui. Sem a dependencia declarada o
# import falha no carregamento e TODOS os scripts do addon morrem juntos.
uses_ui = False
scripts_dir = os.path.join(BP, "scripts")
for dirpath, _, names in os.walk(scripts_dir):
    for n in names:
        if not n.endswith(".js"):
            continue
        with open(os.path.join(dirpath, n), encoding="utf-8") as f:
            if "@minecraft/server-ui" in f.read():
                uses_ui = True
if uses_ui:
    declared = {d.get("module_name") for d in bp_manifest.get("dependencies", [])}
    if "@minecraft/server-ui" not in declared:
        err("os scripts importam @minecraft/server-ui, mas o manifest do BP nao "
            "declara essa dependencia — nenhum script carregaria")

# --- 4e-ter. tags dos slots da mesa de ferraria --------------------------------
#
# A mesa filtra o que entra em cada slot POR TAG, antes de olhar receita
# nenhuma. Um item do addon sem a tag simplesmente nao encaixa: a receita
# existe, esta certa, e mesmo assim nao da pra montar nada.
SMITHING_SLOT_TAG = {
    "template": "minecraft:transform_templates",
    "addition": "minecraft:transform_materials",
}

def item_tags(iid):
    entry = declared_items.get(iid)
    if not entry:
        return None
    comps = entry[1]["minecraft:item"]["components"]
    return set((comps.get("minecraft:tags") or {}).get("tags", []))

for p, d in docs.items():
    if not isinstance(d, dict):
        continue
    r = d.get("minecraft:recipe_smithing_transform")
    if not r:
        continue
    rid = r.get("description", {}).get("identifier", os.path.basename(p))
    for slot, tag in SMITHING_SLOT_TAG.items():
        v = r.get(slot)
        iid = v.get("item") if isinstance(v, dict) else v
        if not isinstance(iid, str) or not iid.startswith("space_dim:"):
            continue  # item do jogo base ja vem com a tag
        tags = item_tags(iid)
        if tags is None:
            continue  # outra checagem ja reclama do item inexistente
        if tag not in tags:
            err(f"receita {rid}: {iid} esta no slot '{slot}' mas nao tem a tag "
                f"{tag} — a mesa de ferraria recusaria o item no slot")

for p, d in docs.items():
    if not isinstance(d, dict):
        continue
    for kind, allowed in RECIPE_FORMAT_OK.items():
        if kind not in d:
            continue
        ver = str(d.get("format_version"))
        if ver not in allowed:
            rid = d[kind].get("description", {}).get("identifier", os.path.basename(p))
            err(f"receita {rid}: format_version {ver} não vale pra {kind} — "
                f"o arquivo não carregaria e a receita sumiria sem aviso "
                f"(use uma de {sorted(allowed)})")

# --- 4f. O config e os itens gerados falam da mesma armadura ------------------
# STAR_ARMOR_PIECES é o que decide se o jogador está protegido. Se ele citar um
# id que não existe mais, a proteção simplesmente nunca liga e nada avisa.
star_pieces = re.findall(r'\{ slot: "\w+", item: "(space_dim:[a-z0-9_]+)" \}', config_src)
if not star_pieces:
    warn("não achei STAR_ARMOR_PIECES no config para conferir")
for piece in star_pieces:
    if piece not in declared_items:
        err(f"STAR_ARMOR_PIECES cita {piece}, que não existe como item")

# --- 5. Texturas citadas pelas partículas existem -----------------------------
for p, d in docs.items():
    if not isinstance(d, dict):
        continue
    tex = (
        d.get("particle_effect", {}).get("description", {})
        .get("basic_render_parameters", {}).get("texture")
    )
    if not tex:
        continue
    if not any(os.path.isfile(os.path.join(RP, tex + ext)) for ext in (".png", ".tga", ".jpg")):
        err(f"partícula {os.path.basename(p)} usa textura inexistente: {tex}")

# --- 6. Ícones dos packs ------------------------------------------------------
for base, name in ((BP, "BP"), (RP, "RP")):
    if not os.path.isfile(os.path.join(base, "pack_icon.png")):
        warn(f"{name} sem pack_icon.png")

# --- 7. Imports dos scripts resolvem ------------------------------------------
script_dir = os.path.join(BP, "scripts", "space_dim")
if os.path.isdir(script_dir):
    for name in os.listdir(script_dir):
        if not name.endswith(".js"):
            continue
        with open(os.path.join(script_dir, name), encoding="utf-8") as f:
            src = f.read()
        for spec in re.findall(r'from\s+"(\.[^"]+)"', src):
            target = os.path.normpath(os.path.join(script_dir, spec))
            if not os.path.isfile(target):
                err(f"{name} importa arquivo inexistente: {spec}")

# --- resultado ----------------------------------------------------------------
for w in warnings:
    print(f"aviso: {w}")
for e in errors:
    print(f"ERRO: {e}")

if errors:
    print(f"\n{len(errors)} erro(s).")
    sys.exit(1)

print(f"validação ok — {len(docs)} JSONs, 0 erro" + (f", {len(warnings)} aviso(s)" if warnings else ""))
