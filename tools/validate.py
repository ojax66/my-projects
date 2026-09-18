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
BP = os.path.join(ROOT, "packs", "Galactic Horizons BP")
RP = os.path.join(ROOT, "packs", "Galactic Horizons RP")

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
config_path = os.path.join(BP, "scripts", "gh", "config.js")
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
bodies_path = os.path.join(BP, "scripts", "gh", "bodies.js")
used_blocks = set()
if os.path.isfile(bodies_path):
    with open(bodies_path, encoding="utf-8") as f:
        used_blocks = set(re.findall(r'"(gh:[a-z0-9_]+)"', f.read()))
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
        lang_names = set(re.findall(r"^tile\.(gh:[a-z0-9_]+)\.name=", f.read(), re.M))
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

# A tabela de minérios, a mesma que os geradores usam.
ORES_SPEC = {}
_ores_path = os.path.join(ROOT, "tools", "assets", "ores.json")
if os.path.isfile(_ores_path):
    try:
        with open(_ores_path, encoding="utf-8") as f:
            ORES_SPEC = json.load(f)
    except Exception as e:  # noqa: BLE001
        err(f"ores.json ilegível: {e}")
else:
    err("tools/assets/ores.json ausente — é a fonte dos minérios")

# "Usado" não é só pelas paletas dos corpos celestes: o terreno da Lua e de
# Marte (planets.js) tem os blocos de camada, o gelo, a bedrock e os minérios,
# e nenhum deles aparece em paleta nenhuma.
_planets_src = ""
_planets_path = os.path.join(BP, "scripts", "gh", "planets.js")
if os.path.isfile(_planets_path):
    with open(_planets_path, encoding="utf-8") as f:
        _planets_src = f.read()
used_blocks |= set(re.findall(r'"(gh:[a-z0-9_]+)"', _planets_src))

# Os minérios não aparecem mais por id em planets.js: lá está o TIPO
# ("silicon"), e o bloco é montado no gerador a partir do planeta, do tipo e da
# pedra. Então o que conta como uso aqui é o par que a tabela manda existir.
for _planeta, _host in ORES_SPEC.get("hosts", {}).items():
    for _tipo in _host.get("ores", []):
        used_blocks.add(f"gh:{_planeta}_{_tipo}_ore")
        used_blocks.add(f"gh:{_planeta}_{_tipo}_ore_deep")

# Blocos que o jogador coloca e nenhum gerador usa. Não são peso morto — são o
# ponto.
used_blocks |= set(re.findall(r'"(gh:[a-z0-9_]+)"', config_src))

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
# As entidades que o BP declara. Serve pra reconhecer o ovo de geração delas
# como item válido numa receita: o jogo cria esse item a partir da entidade, e
# ele nunca aparece em items/.
declared_entities = set()
for p, d in docs.items():
    if not isinstance(d, dict):
        continue
    eid = described(d, "minecraft:entity")
    if eid:
        declared_entities.add(eid)

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
        item_lang = set(re.findall(r"^item\.(gh:[a-z0-9_]+)=", f.read(), re.M))

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

# --- 4d-quinquies. O arquivo de textura se chama como a coisa que ele desenha -
#
# A regra: tirando o prefixo do namespace, a CHAVE do atlas e o NOME DO ARQUIVO
# são a mesma palavra. `gh_basic_spacesuit_helmet` mora em `basic_spacesuit_helmet.png`.
#
# Sem isso o nome derrapa sozinho — metade dos ícones estava em
# `gh_basic_spacesuit_helmet.png` e a outra metade em `star_helmet.png`, as duas
# funcionando, e ninguém achava nada procurando pelo nome do item.
for _atlas, _pasta in (
    (os.path.join(RP, "textures", "item_texture.json"), "items"),
    (os.path.join(RP, "textures", "terrain_texture.json"), "blocks"),
):
    _doc = docs.get(_atlas)
    if not isinstance(_doc, dict):
        continue
    for _chave, _entrada in (_doc.get("texture_data") or {}).items():
        _tex = _entrada.get("textures")
        if not isinstance(_tex, str):
            continue                      # lista de faces: outro assunto
        _esperado = _chave[len("gh_"):] if _chave.startswith("gh_") else _chave
        _arquivo = _tex.rsplit("/", 1)[-1]
        if _arquivo != _esperado:
            err(f"{_pasta}: a chave {_chave} aponta pra {_arquivo}.png; "
                f"o arquivo tem que se chamar {_esperado}.png")

# --- 4d-sexies. Modelo de bloco cabe DENTRO do bloco --------------------------
#
# A lixeira veio com 20x20x27 unidades e o canto em x = -9,3. Espaço de modelo
# de bloco vai de -8 a 8 em x e z e de 0 a 16 em y: o que passa disso invade o
# vizinho e a caixa de colisão não acompanha. make_trash_can.py encolhe o
# modelo; esta regra é o que garante que ele encolheu o bastante.
_models_dir = os.path.join(RP, "models", "blocks")
for _p, _d in docs.items():
    if not _p.startswith(_models_dir) or not isinstance(_d, dict):
        continue
    for _geo in _d.get("minecraft:geometry", []) or []:
        _gid = _geo.get("description", {}).get("identifier", os.path.basename(_p))
        for _bone in _geo.get("bones", []) or []:
            for _c in _bone.get("cubes", []) or []:
                _o, _t = _c.get("origin"), _c.get("size")
                if not (_o and _t):
                    continue
                _lim = [(-8, 8), (0, 16), (-8, 8)]
                for _i, _eixo in enumerate("xyz"):
                    _a, _b = _o[_i], _o[_i] + _t[_i]
                    if _a < _lim[_i][0] - 0.001 or _b > _lim[_i][1] + 0.001:
                        err(f"{_gid}: o cubo vai de {_a:.2f} a {_b:.2f} em {_eixo}, "
                            f"fora do bloco ({_lim[_i][0]} a {_lim[_i][1]})")

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
    # Ovo de geração de uma entidade que ESTE addon declara: o jogo cria o item
    # sozinho a partir da entidade, então ele não aparece em items/.
    if name.endswith("_spawn_egg") and name[:-len("_spawn_egg")] in declared_entities:
        return
    if not name.startswith("gh:"):
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
config_path = os.path.join(BP, "scripts", "gh", "config.js")
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
    if not os.path.isfile(os.path.join(RP, "textures", "gh", "sky", f"{extra}.png")):
        err(f"falta a textura da {extra}")

def png_rgba(path):
    import zlib as _z
    with open(path, "rb") as f:
        raw = f.read()
    w, h = struct.unpack(">II", raw[16:24])
    idat = b""
    i = 8
    while i < len(raw):
        ln = struct.unpack(">I", raw[i:i + 4])[0]
        if raw[i + 4:i + 8] == b"IDAT":
            idat += raw[i + 8:i + 8 + ln]
        i += 12 + ln
    data = _z.decompress(idat)
    stride = w * 4
    out = bytearray()
    prev = bytearray(stride)
    pos = 0
    for _ in range(h):
        f_ = data[pos]; pos += 1
        line = bytearray(data[pos:pos + stride]); pos += stride
        for x in range(stride):
            a = line[x - 4] if x >= 4 else 0
            b = prev[x]
            c = prev[x - 4] if x >= 4 else 0
            if f_ == 1: line[x] = (line[x] + a) & 255
            elif f_ == 2: line[x] = (line[x] + b) & 255
            elif f_ == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f_ == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        prev = line
        out += line
    return w, h, out


# Cada corpo declara na entidade do RP qual textura, geometria e material usa.
# Nem todos usam os mesmos: o Sol e VOLUMETRICO — um empilhado de cascas
# transl0cidas —, entao usa `sky_glow` com `entity_emissive_alpha`, enquanto os
# outros usam o cubo unico com o material opaco emissivo. Ler da entidade em vez
# de fixar o nome e o que mantem as duas familias conferidas pelas mesmas regras.
def sky_desc(bid):
    doc = docs.get(os.path.join(RP, "entity", f"sky_{bid}.entity.json"))
    if not isinstance(doc, dict):
        return {}
    return doc.get("minecraft:client_entity", {}).get("description", {})


def sky_texture_path(bid):
    ref = sky_desc(bid).get("textures", {}).get("default")
    if not ref:
        return os.path.join(RP, "textures", "gh", "sky", f"{bid}.png")
    return os.path.join(RP, *ref.split("/")) + ".png"


def sky_is_glow(bid):
    return sky_desc(bid).get("geometry", {}).get("default", "").endswith("sky_glow")


for bid in body_ids:
    bp_entity = os.path.join(BP, "entities", f"sky_{bid}.json")
    rp_entity = os.path.join(RP, "entity", f"sky_{bid}.entity.json")
    texture = sky_texture_path(bid)
    if not os.path.isfile(bp_entity):
        err(f"corpo {bid} sem entidade de ceu no BP (entities/sky_{bid}.json) — "
            f"ele sumiria passando da distancia de renderizacao")
    if not os.path.isfile(rp_entity):
        err(f"corpo {bid} sem entidade de ceu no RP (entity/sky_{bid}.entity.json)")
    if not os.path.isfile(texture):
        err(f"corpo {bid} sem a textura de ceu que a entidade declara ({texture})")

# `config_number` continua servindo pras outras checagens do config.
def config_number(name):
    m = re.search(rf"^export const {name} = ([0-9.]+);", config_src, re.M)
    return float(m.group(1)) if m else None

# Todo corpo visto de longe usa o material PROPRIO do addon, e ele tem que
# existir de verdade no RP.
#
# Historico: `entity_emissive_alpha` trata alfa 0 como TRANSPARENTE, e as
# texturas do ceu sao todas alfa 0 (alfa e a mascara de brilho) — resultado,
# todo corpo ficou invisivel e nada no jogo dizia por que. O material proprio
# herda de `entity`, que e opaco e nao tem teste de alfa, e liga USE_EMISSIVE.
# O trecho de config de CADA corpo, do `id:` dele ate o do proximo.
#
# Regex solto nao serve aqui: `id: "sun" ... atmosphere:` casa atravessando o
# corpo inteiro e atribui ao Sol a atmosfera da Terra. Cada propriedade tem que
# ser lida dentro do pedaco do seu dono.
def body_blocks(src):
    marcas = [(m.start(), m.group(1)) for m in re.finditer(r'id:\s*"(\w+)"', src)]
    out = {}
    for i, (pos, bid) in enumerate(marcas):
        fim = marcas[i + 1][0] if i + 1 < len(marcas) else len(src)
        out.setdefault(bid, src[pos:fim])
    return out


BODY_SRC = body_blocks(config_src)

SKY_MATERIAL = "gh_sky"
GLOW_MATERIAL = "gh_glow"

mat_doc = {}
mat_path = os.path.join(RP, "materials", "entity.material")
if os.path.isfile(mat_path):
    with open(mat_path, encoding="utf-8") as f:
        mat_doc = json.load(f)
mats = mat_doc.get("materials", {})


def material_base(name):
    for key in mats:
        if key.split(":")[0] == name:
            return key.split(":")[1] if ":" in key else "", mats[key]
    return None, None


# O material dos corpos OPACOS: herda de `entity` e liga USE_EMISSIVE, que e o
# que transforma o canal alfa em mascara de brilho. Trocar a base por uma que
# mistura ou descarta por alfa deixaria todo corpo invisivel — a textura deles e
# toda alfa 0.
base, entry = material_base(SKY_MATERIAL)
if entry is None:
    err(f"RP/materials/entity.material nao define {SKY_MATERIAL} — "
        f"os corpos vistos de longe nao teriam material")
else:
    if base != "entity":
        err(f"o material {SKY_MATERIAL} herda de '{base}', esperado 'entity' — "
            f"as outras bases descartam ou misturam por alfa, e a textura "
            f"do ceu e toda alfa 0")
    if "USE_EMISSIVE" not in (entry.get("+defines") or []):
        err(f"o material {SKY_MATERIAL} nao liga USE_EMISSIVE — "
            f"sem isso o alfa nao vira brilho e o corpo fica preto")

# O material das CASCAS e o oposto: ele TEM que misturar, senao a casca de fora
# tapa todas as de dentro e o volume vira um cubo chapado. `entity_emissive_alpha`
# mistura por alfa e tira o brilho de (1 - alfa) — por isso a textura das cascas
# nao e alfa 0, e sim alfa intermediario.
glow_base, glow_entry = material_base(GLOW_MATERIAL)
if any(sky_is_glow(b) for b in body_ids):
    if glow_entry is None:
        err(f"RP/materials/entity.material nao define {GLOW_MATERIAL} — "
            f"o corpo volumetrico ficaria sem material")
    else:
        if glow_base != "entity_emissive_alpha":
            err(f"o material {GLOW_MATERIAL} herda de '{glow_base}', esperado "
                f"'entity_emissive_alpha' — sem mistura a casca de fora tapa as "
                f"de dentro e nao ha volume nenhum")
        if "DisableCulling" not in (glow_entry.get("+states") or []):
            err(f"o material {GLOW_MATERIAL} sem DisableCulling — metade das "
                f"faces de cada casca nao seria desenhada e a soma cairia pela "
                f"metade")

for bid in list(body_ids) + ["star"]:
    doc = docs.get(os.path.join(RP, "entity", f"sky_{bid}.entity.json"))
    if not isinstance(doc, dict):
        continue
    desc = doc.get("minecraft:client_entity", {}).get("description", {})
    mat = desc.get("materials", {}).get("default")
    # Tres famílias. O corpo opaco usa `gh_sky`; o volumetrico (o Sol)
    # usa `gh_glow`; e o corpo com ANEL de atmosfera usa
    # `gh_halo`, que e o sky mais DisableDepthWrite — sem isso o cubo do
    # corpo, que esta atras dos aneis, e recusado pelo teste de profundidade.
    tem_anel = "atmosphere:" in BODY_SRC.get(bid, "")
    esperado = (GLOW_MATERIAL if sky_is_glow(bid)
                else "gh_halo" if tem_anel else SKY_MATERIAL)
    if mat != esperado:
        err(f"sky_{bid} usa o material {mat}, esperado {esperado}")
    if not desc.get("scripts", {}).get("should_update_bones_and_effects_offscreen"):
        err(f"sky_{bid} sem should_update_bones_and_effects_offscreen — "
            f"a escala congelaria quando o modelo saisse da tela")

# E a textura tem que ser toda alfa 0: e assim que USE_EMISSIVE le brilho
# maximo. Uma textura opaca aqui daria um corpo preto no vacuo.
for bid in list(body_ids) + ["star"]:
    tex = sky_texture_path(bid)
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
            if sky_is_glow(bid):
                continue          # esse usa sky_glow, conferido logo abaixo
            # Corpo com anel tem geometria e folha PRÓPRIAS (a folha ganha uma
            # linha só pros aneis), entao nao se mede contra a compartilhada.
            if "atmosphere:" in BODY_SRC.get(bid, ""):
                continue
            tex = sky_texture_path(bid)
            if not os.path.isfile(tex):
                continue
            with open(tex, "rb") as f:
                head = f.read(24)
            w, h = struct.unpack(">II", head[16:24])
            if (w, h) != (tw, th):
                err(f"a textura de ceu {bid}.png e {w}x{h}, mas o modelo declara "
                    f"{tw}x{th} — as faces cairiam no lugar errado")

radii = {}
for m in re.finditer(r'id:\s*"(\w+)",[\s\S]*?radius:\s*(\d+)', config_src):
    radii.setdefault(m.group(1), int(m.group(2)))

# --- O corpo VOLUMETRICO: as cascas -----------------------------------------
#
# O Sol nao e um cubo com textura: e um empilhado de cascas transl0cidas, e o
# brilho e a soma do que o raio atravessa. E isso que reproduz a referencia —
# miolo estourado, queda ate o vermelho no contorno, e nenhuma aresta interna
# aparecendo, porque nao ha borda de face pra escurecer.
#
# Cada peca disso pode quebrar sozinha e em silencio, entao cada uma tem regra.
for bid in body_ids:
    if not sky_is_glow(bid):
        continue
    gpath = os.path.join(RP, "models", "entity", "sky_glow.geo.json")
    gdoc = docs.get(gpath)
    if not isinstance(gdoc, dict):
        err(f"sky_{bid} usa geometry.gh.sky_glow, que nao existe no RP")
        continue
    gentry = (gdoc.get("minecraft:geometry") or [{}])[0]
    gdesc = gentry.get("description", {})
    cubes = (gentry.get("bones") or [{}])[0].get("cubes") or []
    if len(cubes) < 4:
        err(f"sky_glow tem so {len(cubes)} casca(s) — com poucas o degrade vira "
            f"degrau e o volume some")
    # As cascas tem que ser ANINHADAS e de tamanhos diferentes: duas do mesmo
    # tamanho somariam no mesmo lugar em vez de somar ao longo do caminho.
    tamanhos = [c.get("size", [0])[0] for c in cubes]
    if len(set(tamanhos)) != len(tamanhos):
        err(f"sky_glow tem cascas de tamanho repetido ({tamanhos}) — elas tem "
            f"que ser aninhadas pra a soma seguir o caminho do raio")
    if max(tamanhos) != 16:
        err(f"a casca de fora do sky_glow tem {max(tamanhos)} unidades, esperado "
            f"16 — a conta de escala do skybox supoe uma aresta de um bloco")
    for c in cubes:
        sz = c.get("size", [0, 0, 0])
        org = c.get("origin", [0, 0, 0])
        if sz[0] != sz[1] or sz[1] != sz[2]:
            err(f"casca do sky_glow nao e cubica: {sz}")
        if [round(v + sz[i] / 2, 4) for i, v in enumerate(org)] != [0, 0, 0]:
            err(f"casca do sky_glow de tamanho {sz[0]} nao esta centrada "
                f"(origin {org}) — descentrada ela sai por um lado do corpo")

    # A textura: uma celula chapada por casca, todas com o MESMO alfa, e esse
    # alfa nem 0 nem 255. Em 0 a casca some (foi o que deixou os corpos
    # invisiveis da primeira vez); em 255 ela fica opaca, tapa as de dentro e
    # ainda por cima perde o brilho, que vem de (1 - alfa).
    tex = sky_texture_path(bid)
    if os.path.isfile(tex):
        try:
            gw, gh, gpx = png_rgba(tex)
            if (gw, gh) != (gdesc.get("texture_width"), gdesc.get("texture_height")):
                err(f"a textura {os.path.basename(tex)} e {gw}x{gh}, mas sky_glow "
                    f"declara {gdesc.get('texture_width')}x{gdesc.get('texture_height')}")
            alfas = {gpx[k + 3] for k in range(0, len(gpx), 4)}
            if len(alfas) != 1:
                err(f"as cascas de {bid} tem alfas diferentes ({sorted(alfas)}) — "
                    f"cada casca tem que somar a mesma fatia de luz")
            a = next(iter(alfas))
            if a in (0, 255):
                err(f"as cascas de {bid} tem alfa {a}: em 0 elas somem, em 255 "
                    f"ficam opacas e sem brilho. Precisa ser intermediario")
            cores = {tuple(gpx[k:k + 3]) for k in range(0, len(gpx), 4)}
            if len(cores) < len(cubes):
                err(f"as cascas de {bid} tem {len(cores)} cor(es) pra "
                    f"{len(cubes)} casca(s) — alguma nao recebeu a sua")
        except Exception as e:  # noqa: BLE001
            warn(f"nao consegui conferir as cascas de {bid}: {e}")

# --- Corpos sem bloco e a atmosfera -----------------------------------------
#
# Os planetas viraram `built: false`: existem, mas ninguem coloca bloco deles no
# mundo. Duas coisas tem que valer junto, e cada uma quebra o corpo sozinha.

for bid, trecho in BODY_SRC.items():
    if "built: false" not in trecho:
        continue
    # Sem bloco pra assumir o lugar, um corpo que nao for solido fica
    # atravessavel — e foi o contrario disso que ele pediu.
    if "solid: true" not in trecho:
        err(f"{bid} e built:false mas nao e solid — um corpo sem bloco e sem "
            f"barreira fica atravessavel, e ele pediu o contrario")

# `solid` so tem efeito se alguem chamar solidPushOut. Sem isso a marca no
# config e decorativa e o planeta continua atravessavel.
grav_src = ""
grav_path = os.path.join(BP, "scripts", "gh", "gravity.js")
if os.path.isfile(grav_path):
    with open(grav_path, encoding="utf-8") as f:
        grav_src = f.read()
if "solid: true" in config_src and "solidPushOut" not in grav_src:
    err("ha corpo `solid` no config, mas a gravidade nao chama solidPushOut — "
        "a marca nao faz nada e o planeta continua atravessavel")

# A atmosfera: entidade propria, material que mistura, e alfa BAIXO.
#
# Alfa alto aqui nao e "atmosfera mais forte": e uma cupula de vidro fosco
# tampando o planeta. O efeito depende de cada casca somar pouco.
# A atmosfera: ANÉIS OPACOS no modelo do proprio corpo.
#
# Tres tentativas ate acertar, e cada uma deixou uma regra aqui.
#
# 1. Cascas transl0cidas por fora viraram um quadrado azul tapando a Terra. O
#    pixel dele era (10,19,48) — a cor exata da textura da casca, prova de que o
#    material NAO mistura. Entidade propria de atmosfera e o bug, nao a solucao.
# 2. Borda dentro da textura da superficie nao tapa nada, mas prende o halo
#    DENTRO da silhueta, e ele queria o azul passando pra fora.
# 3. Aneis opacos, como o Sol ja faz. Exige tres coisas juntas, e faltar uma
#    quebra tudo em silencio: os aneis no MESMO modelo do corpo, o cubo do corpo
#    por ULTIMO, e DisableDepthWrite no material.
for bid, trecho in BODY_SRC.items():
    m = re.search(r"atmosphere:\s*\{", trecho)
    if not m:
        continue
    for proibido, oque in (
        (os.path.join(BP, "entities", f"sky_atmo_{bid}.json"), "entidade no BP"),
        (os.path.join(RP, "entity", f"sky_atmo_{bid}.entity.json"), "entidade no RP"),
        (os.path.join(RP, "models", "entity", f"atmo_{bid}.geo.json"), "modelo"),
    ):
        if os.path.isfile(proibido):
            err(f"a atmosfera de {bid} voltou a ter {oque} — com material opaco "
                f"uma casca por fora TAPA o planeta; ela tem que ser anel no "
                f"modelo do proprio corpo")

    rings = re.search(r"rings:\s*\[([^\]]*)\]", trecho)
    reach = re.search(r"reach:\s*([\d.]+)", trecho)
    if not rings or not reach:
        err(f"a atmosfera de {bid} sem rings/reach — sao eles que definem o halo")
        continue
    n_rings = len(re.findall(r'"#[0-9A-Fa-f]{6}"', rings.group(1)))
    if float(reach.group(1)) <= 1:
        err(f"a atmosfera de {bid} tem reach {reach.group(1)} — precisa passar "
            f"de 1, senao o anel fica DENTRO do corpo e nao se ve nada")

    # A SUPERFICIE do corpo com anel vai a alfa 254, os ANEIS ficam em 0.
    #
    # E dele, e resolve a ordem de desenho: 255 o jogo trata como opaco, 254
    # manda o pixel pra passada TRANSPARENTE sem mudar nada a olho nu. Os aneis
    # ficam na passada opaca e saem primeiro; o corpo, na transparente, vem
    # depois e tapa o miolo deles. Se a superficie voltar pra 0 a ordem passa a
    # depender so dos cubos, e o halo pode tapar o planeta de novo.
    tex_a = sky_texture_path(bid)
    if os.path.isfile(tex_a):
        try:
            aw, ah, apx = png_rgba(tex_a)
            cel_a = aw // 4
            def alfa(x, y):
                return apx[(y * aw + x) * 4 + 3]
            # A face do norte fica sempre na coluna 1, linha 1. O anel, onde a
            # geometria disser — ele mudou de lugar quando encostar numa face
            # passou a vazar cor pra dentro dela.
            sup = alfa(cel_a + cel_a // 2, cel_a + cel_a // 2)
            gdoc_a = docs.get(os.path.join(RP, "models", "entity", f"sky_{bid}.geo.json"))
            cubos_a = ((gdoc_a or {}).get("minecraft:geometry") or [{}])[0]
            cubos_a = (cubos_a.get("bones") or [{}])[0].get("cubes") or []
            anel = None
            if len(cubos_a) > 1:
                uv_a = cubos_a[0].get("uv", {}).get("north", {}).get("uv", [0, 0])
                anel = alfa(int(uv_a[0]), int(uv_a[1]))
            if sup != 254:
                err(f"a superficie de {bid} esta com alfa {sup}, esperado 254 — "
                    f"254 poe o corpo na passada transparente, que e o que faz "
                    f"ele ser desenhado DEPOIS dos aneis e tapar o miolo deles")
            if anel is not None and anel != 0:
                err(f"os aneis de {bid} estao com alfa {anel}, esperado 0 — eles "
                    f"tem que ficar na passada opaca, desenhados antes do corpo")
        except Exception as e:  # noqa: BLE001
            warn(f"nao consegui conferir os alfas de {bid}: {e}")

    # NENHUMA celula de anel pode encostar numa celula de FACE.
    #
    # Foi o bug que ele viu: a face de cima e a virada pra Lua "sem textura". Os
    # aneis moravam nas celulas vazias da planificacao, e celula vazia da
    # planificacao faz fronteira com face — cor chapada colada na borda vaza pra
    # dentro dela. As duas faces que ele reportou sao exatamente as duas
    # vizinhas de anel que dava pra ver de onde ele estava.
    gdoc_v = docs.get(os.path.join(RP, "models", "entity", f"sky_{bid}.geo.json"))
    if isinstance(gdoc_v, dict):
        cubos_v = ((gdoc_v.get("minecraft:geometry") or [{}])[0]
                   .get("bones") or [{}])[0].get("cubes") or []
        # As faces do corpo (ultimo cubo) e as celulas de cada anel, em celulas.
        corpo_v = cubos_v[-1] if cubos_v else {}
        celulas_face = set()
        for f, spec in (corpo_v.get("uv") or {}).items():
            uv = spec.get("uv", [0, 0])
            celulas_face.add((int(uv[0]) // 64, int(uv[1]) // 64))
        for anel_cubo in cubos_v[:-1]:
            uv = (anel_cubo.get("uv") or {}).get("north", {}).get("uv", [0, 0])
            cel = (int(uv[0]) // 64, int(uv[1]) // 64)
            vizinhas = {(cel[0] + 1, cel[1]), (cel[0] - 1, cel[1]),
                        (cel[0], cel[1] + 1), (cel[0], cel[1] - 1)}
            encosta = vizinhas & celulas_face
            if encosta:
                err(f"um anel de {bid} esta na celula {cel}, encostando na(s) "
                    f"face(s) {sorted(encosta)} — cor chapada colada na borda "
                    f"vaza pra dentro da face e ela fica sem textura")

    # O material tem que ser o que NAO escreve profundidade.
    doc = docs.get(os.path.join(RP, "entity", f"sky_{bid}.entity.json"))
    mat = None
    if isinstance(doc, dict):
        d = doc.get("minecraft:client_entity", {}).get("description", {})
        mat = d.get("materials", {}).get("default")
        geo_ref = d.get("geometry", {}).get("default", "")
        if not geo_ref.endswith(f"sky_{bid}"):
            err(f"{bid} tem atmosfera mas usa a geometria {geo_ref} — os aneis "
                f"moram numa geometria propria do corpo")
    base_h, entry_h = material_base(mat) if mat else (None, None)
    if entry_h is None:
        err(f"o material {mat} de {bid} nao existe em entity.material")
    elif "DisableDepthWrite" not in (entry_h.get("+states") or []):
        err(f"o material {mat} de {bid} nao tem DisableDepthWrite — os aneis sao "
            f"cubos MAIORES que o corpo e ficam na frente dele no buffer de "
            f"profundidade; sem isso o planeta some atras do proprio halo")
    elif "DisableCulling" in (entry_h.get("+states") or []):
        # As duas coisas juntas sao o bug das faces pretas. Sem escrita de
        # profundidade, quem decide o pixel e a ORDEM de desenho; sem culling,
        # a face de TRAS do cubo tambem e desenhada, e quando ela vem depois da
        # da frente na ordem interna do cubo, ela ganha. A face de tras tem a
        # normal invertida: nao recebe luz. Nos outros corpos isso nao aparece
        # porque a textura deles e alfa 0 (brilho maximo, a luz nao importa);
        # aqui a superficie e alfa 254, quase sem brilho, entao a face de tras
        # sai PRETA — e preto no vacuo e indistinguivel de buraco.
        err(f"o material {mat} de {bid} tem DisableCulling junto com "
            f"DisableDepthWrite — a face de tras do cubo passa na frente da da "
            f"frente e, sem luz, sai preta: a face parece invisivel")

    # E na geometria: aneis primeiro, corpo por ultimo e com 16 unidades.
    gdoc = docs.get(os.path.join(RP, "models", "entity", f"sky_{bid}.geo.json"))
    if not isinstance(gdoc, dict):
        err(f"{bid} tem atmosfera mas nao tem modelo sky_{bid}.geo.json")
        continue
    cubes = ((gdoc.get("minecraft:geometry") or [{}])[0]
             .get("bones") or [{}])[0].get("cubes") or []
    if len(cubes) != n_rings + 1:
        err(f"o modelo de {bid} tem {len(cubes)} cubo(s) e o config pede "
            f"{n_rings} anel(is) + o corpo")
    tam = [c.get("size", [0])[0] for c in cubes]
    if tam and tam[-1] != 16:
        err(f"o ultimo cubo de sky_{bid} tem {tam[-1]} unidades, esperado 16 — "
            f"o corpo tem que ser o ULTIMO (e o que tapa o miolo dos aneis) e a "
            f"conta de escala do skybox depende do 16")
    if tam and any(t <= 16 for t in tam[:-1]):
        err(f"ha anel de {bid} com {min(tam[:-1])} unidades — anel tem que ser "
            f"MAIOR que os 16 do corpo, senao ele nasce escondido dentro dele")
    if tam[:-1] != sorted(tam[:-1], reverse=True):
        err(f"os aneis de {bid} nao estao de fora pra dentro ({tam[:-1]}) — "
            f"na ordem errada o de fora tapa os de dentro")

# A neblina de DENTRO tem que existir e ser CURTA.
#
# La dentro do Sol e tudo bloco branco de emissao maxima a um palmo do rosto: a
# tela vira um chapado e nao da pra enxergar nada. Uma neblina curta cor de
# brasa e o que troca esse branco por algo legivel. Longa demais ela nao corta o
# brilho e o problema volta.
main_src = ""
main_path = os.path.join(BP, "scripts", "gh", "main.js")
if os.path.isfile(main_path):
    with open(main_path, encoding="utf-8") as f:
        main_src = f.read()

fog_inside = None
mfi = re.search(r'export const FOG_INSIDE_ID = "([^"]+)";', config_src)
if mfi:
    fog_inside = mfi.group(1)
    achou = False
    for caminho, doc in docs.items():
        if not caminho.startswith(os.path.join(RP, "fogs")):
            continue
        if not isinstance(doc, dict):
            continue
        fs = doc.get("minecraft:fog_settings", {})
        if fs.get("description", {}).get("identifier") != fog_inside:
            continue
        achou = True
        ar = fs.get("distance", {}).get("air", {})
        fim = ar.get("fog_end")
        if not isinstance(fim, (int, float)) or fim > 32:
            err(f"a neblina de dentro ({fog_inside}) tem fog_end {fim} — longa "
                f"demais pra cortar o branco dos blocos do Sol")
    if not achou:
        err(f"{fog_inside} nao existe em RP/fogs — a neblina de dentro do Sol "
            f"nao seria aplicada e a tela continuaria um branco chapado")
    if "FOG_INSIDE_ID" not in main_src:
        err("FOG_INSIDE_ID existe no config mas main.js nao usa — a neblina de "
            "dentro nunca seria empilhada")

# A escala do modelo e a PROJECAO do corpo, em degraus de component group.
#
# O modelo fica preso ao jogador a SKY_MODEL_DISTANCE e e escalado pra dar o
# mesmo angulo que o corpo daria la longe:
#
#     escala = 2 * SKY_MODEL_DISTANCE * raio / distancia
#
# O 2 vem da meia-aresta do cubo do geometry, que e 0,5 bloco (16 unidades de
# aresta). A versao anterior dividia por 8, tratando a meia-aresta como 8
# BLOCOS: dezesseis vezes menor, e nada media isso.
steps_path = os.path.join(BP, "scripts", "gh", "skySteps.js")
steps = []
if os.path.isfile(steps_path):
    with open(steps_path, encoding="utf-8") as f:
        m = re.search(r"SKY_SIZE_STEPS = \[([^\]]*)\]", f.read())
    if m:
        steps = [float(x) for x in m.group(1).split(",") if x.strip()]
if not steps:
    err("scripts/gh/skySteps.js sem degraus de escala")
if any(v <= 0 for v in steps):
    err("ha um degrau de escala <= 0 em skySteps.js — escala zero e um modelo "
        "invisivel, que e exatamente o defeito que isto substitui")

for bid in list(body_ids) + ["star"]:
    doc = docs.get(os.path.join(BP, "entities", f"sky_{bid}.json"))
    if not isinstance(doc, dict):
        continue
    ent = doc.get("minecraft:entity", {})
    groups = ent.get("component_groups", {})
    events = ent.get("events", {})
    if bid == "star":
        if "minecraft:scale" not in ent.get("components", {}):
            err("sky_star sem minecraft:scale — a estrela tem tamanho fixo")
        continue
    if len(groups) != len(steps) or len(events) != len(steps):
        err(f"sky_{bid} tem {len(groups)} grupos e {len(events)} eventos, mas "
            f"skySteps.js declara {len(steps)} degraus — as listas divergiram e "
            f"o script pediria um evento que nao existe")
        continue
    for i, value in enumerate(steps):
        got = groups.get(f"gh:size_{i}", {}).get("minecraft:scale", {}).get("value")
        if got is None or abs(float(got) - value) > 1e-6:
            err(f"sky_{bid}: grupo size_{i} tem escala {got}, skySteps.js diz {value}")
        if f"gh:set_size_{i}" not in events:
            err(f"sky_{bid} sem o evento set_size_{i}")

# A faixa dos degraus tem que cobrir o que a conta realmente pede: do corpo
# maior visto do ponto de troca ate o menor visto da borda do sistema.
model_dist = config_number("SKY_MODEL_DISTANCE")
hide_below = None
mh = re.search(r"export const SKY_MODEL_HIDE_BELOW = GEN_RADIUS_CHUNKS \* 16 - (\d+);",
               config_src)
gen_chunks = config_number("GEN_RADIUS_CHUNKS")
if mh and gen_chunks:
    hide_below = gen_chunks * 16 - int(mh.group(1))
sys_radius = config_number("SOLAR_SYSTEM_RADIUS")

near_dist = config_number("SKY_MODEL_NEAREST")
if steps and near_dist and sys_radius and radii:
    # escala = 2 * at * raio / distancia, com at <= distancia.
    #
    #   maior: at == distancia (corpo mais perto que o degrau) -> 2 * raio
    #   menor: at == SKY_MODEL_NEAREST, corpo na borda do sistema
    maior = 2 * max(radii.values())
    menor = 2 * near_dist * min(radii.values()) / sys_radius
    if maior > max(steps) or menor < min(steps):
        err(f"os degraus vao de {min(steps)} a {max(steps)}, mas a conta pede de "
            f"{menor:.3f} a {maior:.1f} — o modelo sairia do tamanho "
            f"errado nas pontas")

# O degrau mais longe tem que caber na distancia de simulacao do Bedrock, que no
# celular comeca em 4 chunks — 64 blocos. Alem dela a entidade descarrega e para
# de ser desenhada: foi assim que os modelos sumiram com SKY_MODEL_DISTANCE=112.
if model_dist and model_dist > 48:
    err(f"SKY_MODEL_DISTANCE e {model_dist}, perto demais dos 64 blocos da "
        f"distancia de simulacao — o modelo descarrega e para de aparecer")
if near_dist and model_dist and near_dist >= model_dist:
    err(f"SKY_MODEL_NEAREST ({near_dist}) tem que ser menor que "
        f"SKY_MODEL_DISTANCE ({model_dist}): sem faixa nao ha degrau por corpo "
        f"e os modelos voltam a se atravessar")

# E o RP nao pode animar a escala: seria uma terceira fonte.
for bid in list(body_ids) + ["star"]:
    doc = docs.get(os.path.join(RP, "entity", f"sky_{bid}.entity.json"))
    if not isinstance(doc, dict):
        continue
    desc = doc.get("minecraft:client_entity", {}).get("description", {})
    if "animations" in desc or (desc.get("scripts", {}).get("animate")):
        err(f"sky_{bid} anima a escala no cliente — ela e do servidor agora, e "
            f"duas fontes brigando dao o tamanho errado")

# As cascas do Sol vao do miolo CLARO pra borda ESCURA, nessa ordem.
#
# A ordem e o degrade inteiro: invertida, o Sol fica vermelho no meio e branco
# na borda, e nada mais no addon notaria. As cascas sao declaradas de fora pra
# dentro no geometry, e a cor de cada uma vem da celula que o UV dela aponta.
for bid in body_ids:
    if not sky_is_glow(bid):
        continue
    gdoc = docs.get(os.path.join(RP, "models", "entity", "sky_glow.geo.json"))
    tex = sky_texture_path(bid)
    if not isinstance(gdoc, dict) or not os.path.isfile(tex):
        continue
    try:
        gw, gh, gpx = png_rgba(tex)
        cubes = ((gdoc.get("minecraft:geometry") or [{}])[0]
                 .get("bones") or [{}])[0].get("cubes") or []
        porTamanho = []
        for c in cubes:
            u = c.get("uv", {}).get("north", {}).get("uv", [0, 0])
            k = (min(gh - 1, 0) * gw + min(gw - 1, int(u[0]))) * 4
            lum = 0.299 * gpx[k] + 0.587 * gpx[k + 1] + 0.114 * gpx[k + 2]
            porTamanho.append((c.get("size", [0])[0], lum))
        porTamanho.sort()
        lums = [l for _, l in porTamanho]
        if lums and any(lums[i] < lums[i + 1] - 1 for i in range(len(lums) - 1)):
            err(f"as cascas de {bid} nao escurecem de dentro pra fora "
                f"({[round(l) for l in lums]}) — o degrade do Sol esta invertido "
                f"ou embaralhado")
    except Exception as e:  # noqa: BLE001
        warn(f"nao consegui conferir a ordem das cascas de {bid}: {e}")

# Nenhuma textura de ceu pode ter texel PRETO PURO.
#
# A planificacao 4x3 tem doze celulas e so seis carregam face. As outras seis
# nasciam zeradas, ou seja (0,0,0). Preto parado num canto nao usado parece
# inofensivo e nao e: com o corpo longe o modelo fica pequeno e a GPU desce de
# mipmap, cada nivel e a media de quatro texels do nivel acima, e essa media
# ATRAVESSA a borda da celula. A borda de cada face vai se lambuzando de preto —
# a moldura escura em volta do Sol, pior quanto mais longe, que e justo quando o
# modelo e a unica coisa visivel.
#
# O gerador preenche os buracos com a cor pintada mais proxima. Esta regra
# existe pra isso nunca mais voltar sem ninguem ver.


for bid in list(body_ids) + ["star"]:
    tex = sky_texture_path(bid)
    if not os.path.isfile(tex):
        continue
    try:
        w_, h_, px_ = png_rgba(tex)
    except Exception as e:  # noqa: BLE001
        warn(f"nao consegui ler {bid}.png: {e}")
        continue
    black = sum(1 for k in range(0, len(px_), 4)
                if px_[k] == 0 and px_[k + 1] == 0 and px_[k + 2] == 0)
    if black:
        err(f"a textura de ceu {bid}.png tem {black} texel(s) preto(s) puro(s) "
            f"de {w_ * h_} — o mipmap mistura isso na borda das faces e o corpo "
            f"ganha moldura escura quando esta longe")

# Uma camada marcada `passable` no config so pode ser pintada com blocos SEM
# colisao.
#
# O bug que isto pega: a casca externa do Sol e atravessavel, mas o degrade
# pintava o miolo de cada face com `sun_core`, que e o chao macico do nucleo.
# A primeira camada do Sol fechou — dava pra encostar nele, nao pra entrar — e
# nada apontava pra isso: o bloco existe, tem textura, tem nome, e o config diz
# que a camada e atravessavel.
#
# A lista de blocos de cada paleta sai do proprio bodies.js.
bodies_src = ""
bodies_path = os.path.join(BP, "scripts", "gh", "bodies.js")
if os.path.isfile(bodies_path):
    with open(bodies_path, encoding="utf-8") as f:
        bodies_src = f.read()

# Quais paletas sao de camadas passable CONSTRUIDAS, lido do config.
#
# Camada `modelOnly` nao vira bloco nenhum — quem a desenha e o modelo visto de
# longe —, entao nao ha paleta pra conferir nela. A coroa do Sol e assim.
passable_palettes = set()
for m in re.finditer(r"\{\s*radius:[^}]*?\}", config_src, re.S):
    layer = m.group(0)
    if "passable: true" not in layer or "modelOnly: true" in layer:
        continue
    pm = re.search(r'palette:\s*"(\w+)"', layer)
    if pm:
        passable_palettes.add(pm.group(1))

def block_is_solid(block_id):
    doc = docs.get(os.path.join(BP, "blocks", block_id.split(":")[1] + ".json"))
    if not isinstance(doc, dict):
        return None
    comps = doc.get("minecraft:block", {}).get("components", {})
    return comps.get("minecraft:collision_box", True) is not False

def palette_body(name):
    """O corpo da funcao daquela paleta, dentro de PALETTES.

    Nao da pra procurar ate o proximo `\n  },`: as paletas simples sao de UMA
    linha (`sun_plasma() { return "..."; },`) e nao tem esse delimitador, entao
    a busca engolia as paletas seguintes e acusava blocos que nao sao daquela.
    O corte certo e a proxima declaracao de paleta, seja ela de uma linha ou de
    um bloco.
    """
    start = re.search(rf"^  {name}\(", bodies_src, re.M)
    if not start:
        return ""
    rest = bodies_src[start.end():]
    nxt = re.search(r"^  \w+\(|^\};", rest, re.M)
    return rest[:nxt.start()] if nxt else rest


for palette in sorted(passable_palettes):
    body_src = palette_body(palette)
    # a rampa do disco solar mora numa constante; inclui ela quando citada
    if "SUN_DISC" in body_src:
        m2 = re.search(r"const SUN_DISC = \[(.*?)\];", bodies_src, re.S)
        if m2:
            body_src += m2.group(1)
    used = set(re.findall(r'"(gh:\w+)"', body_src))
    if not used:
        warn(f"nao consegui ler os blocos da paleta {palette}")
    for block_id in sorted(used):
        solid = block_is_solid(block_id)
        if solid is None:
            err(f"a paleta {palette} usa {block_id}, que nao tem JSON de bloco")
        elif solid:
            err(f"a camada {palette} e `passable` no config, mas pinta com "
                f"{block_id}, que TEM colisao — a camada ficaria fechada")

# --- 4d-ter. mapas estelares e sistemas ---------------------------------------
#
# O id do item de mapa carrega o id do sistema que ele abre. Um mapa apontando
# pra um sistema que nao existe no catalogo e um item que nao faz nada: o
# jogador usa, nao acontece nada, e nada explica por que.
catalog_src = ""
catalog_path = os.path.join(BP, "scripts", "gh", "catalog.js")
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
        if not isinstance(iid, str) or not iid.startswith("gh:"):
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

# --- 4f. O config e os itens gerados falam do mesmo equipamento ---------------
# Estas três listas são o que decide se o jogador está protegido. Se uma delas
# citar um id que não existe mais, a proteção simplesmente nunca liga — e nada
# avisa: o item some do inventário e o jogador morre sem saber por quê.
for const in ("STAR_ARMOR_PIECES", "BASIC_SUIT_PIECES", "REINFORCED_SUIT_PIECES"):
    m = re.search(rf"export const {const} = \[(.*?)\];", config_src, re.S)
    if not m:
        warn(f"não achei {const} no config para conferir")
        continue
    pieces = re.findall(r'\{ slot: "(\w+)", item: "([a-z0-9_]+:[a-z0-9_]+)" \}', m.group(1))
    if len(pieces) != 4:
        err(f"{const} tem {len(pieces)} peças; uma armadura são 4")
    slots = [slot for slot, _ in pieces]
    if slots != ["Head", "Chest", "Legs", "Feet"]:
        err(f"{const} não cobre os quatro espaços na ordem certa: {slots}")
    for _, piece in pieces:
        if piece.startswith("gh:") and piece not in declared_items:
            err(f"{const} cita {piece}, que não existe como item")

# O conjunto inteiro tem que caber num corpo só: dois ids iguais em listas
# diferentes fariam um traje contar como o outro.
_all_pieces = re.findall(r'\{ slot: "\w+", item: "(gh:[a-z0-9_]+)" \}', config_src)
if len(_all_pieces) != len(set(_all_pieces)):
    err("o mesmo id de peça aparece em mais de um conjunto do config")

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

# --- 5c. As dimensões de superfície: Lua e Marte -------------------------------
#
# A fonte da verdade é planets.js, e tudo aqui é conferência de que o PACOTE
# concorda com ele. Um bioma citado no script e sem arquivo no pacote não dá
# erro nenhum no jogo: vira um pedaço de mundo sem névoa e sem nome, e ninguém
# descobre por quê.
planets_src = ""
planets_path = os.path.join(BP, "scripts", "gh", "planets.js")
if os.path.isfile(planets_path):
    with open(planets_path, encoding="utf-8") as f:
        planets_src = f.read()


def planet_blocks(src):
    """O trecho de cada planeta, do `const MOON = {` até o `};` dele."""
    out = {}
    for m in re.finditer(r"\nconst (MOON|MARS) = \{(.*?)\n\};", src, re.S):
        body = m.group(2)
        pid = re.search(r'\n  id: "(\w+)"', body)
        if pid:
            out[pid.group(1)] = body
    return out


PLANET_SRC = planet_blocks(planets_src)

if planets_src and len(PLANET_SRC) != 2:
    err(f"planets.js: li {len(PLANET_SRC)} planeta(s), esperado 2 (Lua e Marte)")

# A altitude que devolve pro espaço tem que caber DENTRO da dimensão. Se ela
# passar do teto, a porta de volta não abre nunca e o jogador fica preso lá.
m = re.search(r"^export const PLANET_EXIT_Y = ([0-9]+);", planets_src, re.M)
planet_exit_y = int(m.group(1)) if m else None
if planets_src and planet_exit_y is None:
    err("planets.js sem PLANET_EXIT_Y — é a altitude que devolve pro espaço")

# E ela é a MESMA do Overworld, de propósito: uma regra só pro jogo inteiro.
# Duas constantes com o mesmo valor combinado escorregam sozinhas depois.
space_entry_y = config_number("SPACE_ENTRY_Y")
if planet_exit_y is not None and space_entry_y is not None:
    if planet_exit_y != int(space_entry_y):
        err(f"PLANET_EXIT_Y ({planet_exit_y}) diferente de SPACE_ENTRY_Y "
            f"({int(space_entry_y)}) — a altitude de saida e uma so: subir a ela "
            f"leva pro espaco de onde for")

# Os limites verticais das duas dimensões moram no script (PLANET_BOUNDS),
# porque o gerador de terreno usa os MESMOS números pra limitar a altura.
# Escrever o teto no JSON e no script em separado é como o relevo acaba passando
# do teto sem nada avisar.
m = re.search(r"PLANET_BOUNDS = \{ min: (-?\d+), max: (-?\d+) \};", planets_src)
planet_bounds = {"min": int(m.group(1)), "max": int(m.group(2))} if m else None
if planets_src and planet_bounds is None:
    err("planets.js sem PLANET_BOUNDS — são os limites verticais dos planetas")
elif planet_bounds and planet_bounds["min"] >= planet_bounds["max"]:
    err(f"PLANET_BOUNDS invertido: min {planet_bounds['min']} >= max {planet_bounds['max']}")

# Os ids de bloco que o terreno usa têm que existir de verdade.
def block_exists(bid):
    if bid.startswith("minecraft:"):
        return True
    ns, _, name = bid.partition(":")
    return os.path.isfile(os.path.join(BP, "blocks", f"{name}.json"))


# Luminância média de uma textura de bloco — é assim que a regra das CAMADAS
# deixa de ser opinião: a mais clara em cima, a mais escura embaixo.
def block_luma(bid):
    name = bid.partition(":")[2]
    path = os.path.join(RP, "textures", "gh", "blocks", f"{name}.png")
    if not os.path.isfile(path):
        return None
    w, h, px = png_rgba(path)
    total = 0.0
    for i in range(w * h):
        total += 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]
    return total / (w * h)


client_biomes = {}
for path, doc in docs.items():
    if not isinstance(doc, dict) or "minecraft:client_biome" not in doc:
        continue
    ident = doc["minecraft:client_biome"].get("description", {}).get("identifier")
    if not ident:
        continue
    # Dois arquivos com o MESMO identificador é um bug silencioso: o jogo carrega
    # um dos dois e não diz qual. Já aconteceu aqui — o céu do espaço tinha duas
    # cores diferentes declaradas, e qual valia dependia da ordem da pasta.
    if ident in client_biomes:
        err(f"dois biomas de cliente com o mesmo identificador {ident}: "
            f"{os.path.basename(client_biomes[ident])} e {os.path.basename(path)} — "
            f"o jogo carrega um dos dois e não diz qual")
    client_biomes[ident] = path

# As névoas existentes, pra cruzar com o que os biomas pedem.
fog_ids = set()
for path, doc in docs.items():
    if isinstance(doc, dict) and "minecraft:fog_settings" in doc:
        fid = doc["minecraft:fog_settings"].get("description", {}).get("identifier")
        if fid:
            fog_ids.add(fid)

for pid, src in PLANET_SRC.items():
    dim_id = re.search(r'dimensionId: "([^"]+)"', src)
    dim_id = dim_id.group(1) if dim_id else None
    default_biome = re.search(r'defaultBiome: "([^"]+)"', src)
    default_biome = default_biome.group(1) if default_biome else None
    planet_fog = re.search(r'\n  fog: "([^"]+)"', src)
    planet_fog = planet_fog.group(1) if planet_fog else None

    if not dim_id:
        err(f"planeta {pid} sem dimensionId")
        continue

    # 1. A dimensão existe, é vazia (o script é que escreve o terreno) e o teto
    #    dela deixa a porta de volta caber.
    short = dim_id.partition(":")[2]
    dim_doc = docs.get(os.path.join(BP, "dimensions", f"{short}_surface.json"))
    if not isinstance(dim_doc, dict):
        err(f"planeta {pid}: falta BP/dimensions/{short}_surface.json")
    else:
        comp = dim_doc.get("minecraft:dimension", {}).get("components", {})
        ident = dim_doc.get("minecraft:dimension", {}).get("description", {}).get("identifier")
        if ident != dim_id:
            err(f"{short}_surface.json declara {ident}, e planets.js pede {dim_id}")
        gen = comp.get("minecraft:generation", {}).get("generator_type")
        if gen != "void":
            err(f"a dimensão de {pid} usa generator_type {gen}, esperado void — "
                f"quem escreve o terreno é planetTerrain.js, e um gerador do "
                f"motor por baixo faria os dois brigarem pela mesma coluna")
        got_biome = comp.get("minecraft:default_biome", {}).get("biome")
        if got_biome != default_biome:
            err(f"a dimensão de {pid} tem default_biome {got_biome}, e planets.js "
                f"pede {default_biome}")
        bounds = comp.get("minecraft:dimension_bounds", {})
        top = bounds.get("max")
        if planet_exit_y is not None and isinstance(top, (int, float)) and planet_exit_y >= top:
            err(f"PLANET_EXIT_Y ({planet_exit_y}) nao cabe embaixo do teto de {pid} "
                f"({top}) — a porta de volta pro espaco nunca abriria e o jogador "
                f"ficaria preso la")
        if planet_bounds and (bounds.get("min") != planet_bounds["min"]
                              or bounds.get("max") != planet_bounds["max"]):
            err(f"os limites de {pid} no JSON sao {bounds.get('min')}..{bounds.get('max')} "
                f"e PLANET_BOUNDS pede {planet_bounds['min']}..{planet_bounds['max']} — "
                f"rode tools/make_planet_worlds.py. O gerador de terreno corta a "
                f"altura pelo PLANET_BOUNDS, entao um teto menor no JSON deixaria "
                f"relevo do lado de fora da dimensao")

    # 2. Cada bioma tem os DOIS arquivos, e a névoa que ele pede existe.
    biomes = re.findall(
        r'\{\s*\n\s*id: "(\w+)",\s*\n\s*biomeId: "([^"]+)",\s*\n\s*name: "([^"]+)",',
        src)
    if not biomes:
        err(f"planeta {pid} sem bioma nenhum em planets.js")
    ids = [b[1] for b in biomes]
    if default_biome and default_biome not in ids:
        err(f"o default_biome de {pid} ({default_biome}) nao esta entre os biomas dele")

    for _bid, biome_id, _name in biomes:
        name = biome_id.partition(":")[2]
        if not os.path.isfile(os.path.join(BP, "biomes", f"{name}.json")):
            err(f"o bioma {biome_id} de {pid} nao tem BP/biomes/{name}.json — "
                f"rode tools/make_planet_worlds.py")
        if biome_id not in client_biomes:
            err(f"o bioma {biome_id} de {pid} nao tem bioma de cliente no RP — "
                f"ficaria sem ceu e sem nevoa")
        else:
            cdoc = docs[client_biomes[biome_id]]
            fog = (cdoc["minecraft:client_biome"].get("components", {})
                   .get("minecraft:fog_appearance", {}).get("fog_identifier"))
            if fog and fog_ids and fog not in fog_ids:
                err(f"o bioma {biome_id} pede a nevoa {fog}, que nao existe em RP/fogs")

    # Toda névoa citada no script também tem que existir.
    for fog in set(re.findall(r'fog: "([^"]+)"', src)):
        if fog_ids and fog not in fog_ids:
            err(f"planets.js cita a nevoa {fog} em {pid}, que nao existe em RP/fogs")

    # 2b. O ceu da LUA e o mesmo do espaco — o mesmo arquivo de nevoa e a mesma
    #     cor, nao uma copia parecida. Ela nao tem atmosfera nenhuma: o ceu dela
    #     E o vacuo. Duas definicoes separadas com a mesma intencao e como elas
    #     acabam diferentes.
    if pid == "moon":
        espaco = client_biomes.get("gh:espaco_sideral")
        if espaco:
            ec = docs[espaco]["minecraft:client_biome"].get("components", {})
            alvo_fog = ec.get("minecraft:fog_appearance", {}).get("fog_identifier")
            alvo_ceu = ec.get("minecraft:sky_color", {}).get("sky_color")
            for _bid, biome_id, _name in re.findall(
                    r'\{\s*\n\s*id: "(\w+)",\s*\n\s*biomeId: "([^"]+)",\s*\n\s*name: "([^"]+)",',
                    src):
                path_cb = client_biomes.get(biome_id)
                if not path_cb:
                    continue
                cc = docs[path_cb]["minecraft:client_biome"].get("components", {})
                fog = cc.get("minecraft:fog_appearance", {}).get("fog_identifier")
                ceu = cc.get("minecraft:sky_color", {}).get("sky_color")
                if fog != alvo_fog or ceu != alvo_ceu:
                    err(f"o ceu de {biome_id} e {fog}/{ceu} e o do espaco e "
                        f"{alvo_fog}/{alvo_ceu} — a Lua nao tem atmosfera, entao "
                        f"o ceu dela tem que ser o MESMO do espaco")

    # 2c. Os MINÉRIOS: existem, têm tabela de loot, e a faixa de profundidade
    #     cabe dentro da crosta. Um minério com `from` maior que a crosta nunca
    #     apareceria, e nada no jogo diria por quê.
    crosta = re.search(r"\n  crust: (\d+)", src)
    crosta = int(crosta.group(1)) if crosta else None
    for m in re.finditer(
            r'\{ block: "([^"]+)", from: (\d+), to: (\d+), weight: (\d+) \}', src):
        bloco, de, ate, peso = m.group(1), int(m.group(2)), int(m.group(3)), int(m.group(4))
        nome = bloco.partition(":")[2]
        if not os.path.isfile(os.path.join(BP, "blocks", f"{nome}.json")):
            err(f"o minerio {bloco} de {pid} nao tem BP/blocks/{nome}.json")
        elif not os.path.isfile(os.path.join(BP, "loot_tables", "gh",
                                             "blocks", f"{nome}.json")):
            err(f"o minerio {bloco} nao tem tabela de loot — ele largaria ele "
                f"mesmo, e um bloco de minerio no inventario nao serve pra nada")
        if de >= ate:
            err(f"a faixa do minerio {bloco} esta invertida ({de}..{ate})")
        if crosta and ate >= crosta:
            err(f"o minerio {bloco} vai ate a profundidade {ate} e a crosta de "
                f"{pid} tem {crosta} — o fundo dela e bedrock")
        if peso <= 0:
            err(f"o minerio {bloco} tem peso {peso}: nunca seria sorteado")

    # As CAVERNAS não podem furar a superfície nem encostar na bedrock.
    cav = re.search(r"caves: \{ scale: ([\d.]+), threshold: ([\d.]+), "
                    r"fromSurface: (\d+), aboveFloor: (\d+) \}", src)
    if cav:
        desde, acima = int(cav.group(3)), int(cav.group(4))
        if desde < 4:
            err(f"as cavernas de {pid} comecam a {desde} blocos da superficie — "
                f"perto demais: elas abririam buraco no chao e o jogador cairia "
                f"num vao andando na planicie")
        if acima < 1:
            err(f"as cavernas de {pid} encostam na bedrock (aboveFloor {acima}) — "
                f"daria pra ver o fundo do mundo de dentro delas")

    # 3. Os blocos do terreno existem...
    blocos = dict(re.findall(r'\n    (\w+): "([^"]+)",', src))
    for papel in ("dust", "stone", "deep", "ice", "floor"):
        bid = blocos.get(papel)
        if not bid:
            err(f"planeta {pid} sem o bloco de '{papel}'")
        elif not block_exists(bid):
            err(f"planeta {pid}: o bloco de '{papel}' ({bid}) nao existe no BP")

    # ...e obedecem a regra das CAMADAS: a mais clara em cima (poeira), a do
    # meio no meio (pedra), a mais escura embaixo (ardosia). Nao e gosto — e a
    # regra que ele deu, e da pra medir na textura.
    lumas = {}
    for papel in ("dust", "stone", "deep"):
        bid = blocos.get(papel)
        if bid and not bid.startswith("minecraft:"):
            lumas[papel] = block_luma(bid)
    if all(lumas.get(k) is not None for k in ("dust", "stone", "deep")):
        if not (lumas["dust"] > lumas["stone"] > lumas["deep"]):
            err(f"as camadas de {pid} estao fora de ordem de tom: poeira "
                f"{lumas['dust']:.0f}, pedra {lumas['stone']:.0f}, ardosia "
                f"{lumas['deep']:.0f} — a mais clara vai em cima e a mais escura "
                f"embaixo")

# 4. E o caminho de ida: todo corpo com portal `planet` aponta pra um planeta
#    que existe. Um id trocado aqui viraria um portal que nao abre.
for bid, src in BODY_SRC.items():
    m = re.search(r'portal:\s*\{\s*kind:\s*"planet",\s*dimension:\s*"([^"]+)"', src)
    if not m:
        continue
    alvo = m.group(1)
    if alvo not in {re.search(r'dimensionId: "([^"]+)"', s2).group(1)
                    for s2 in PLANET_SRC.values()
                    if re.search(r'dimensionId: "([^"]+)"', s2)}:
        err(f"o corpo {bid} tem portal pra {alvo}, que nao e um planeta de planets.js")

# --- 5d. Névoas e partículas citadas no config existem ------------------------
#
# Uma névoa que não existe não dá erro no jogo: o comando `fog push` falha
# calado e a tela fica sem névoa nenhuma. Uma partícula idem. Os dois são o
# tipo de coisa que só se descobre estando lá dentro na hora certa — no meio de
# uma tempestade de areia, ou congelando.
particle_ids = set()
for path, doc in docs.items():
    if isinstance(doc, dict) and "particle_effect" in doc:
        pid_ = doc["particle_effect"].get("description", {}).get("identifier")
        if pid_:
            particle_ids.add(pid_)

for nome, valor in re.findall(
        r'^export const (\w*(?:FOG|PARTICLE)\w*) = "([^"]+)";', config_src, re.M):
    # FOG_LABEL nao e uma nevoa: e o rotulo da PILHA de nevoas do comando
    # `fog push`, que nao aponta pra arquivo nenhum.
    if nome.endswith("_LABEL"):
        continue
    if "fog" in valor:
        if fog_ids and valor not in fog_ids:
            err(f"{nome} aponta pra nevoa {valor}, que nao existe em RP/fogs")
    elif particle_ids and valor not in particle_ids:
        err(f"{nome} aponta pra particula {valor}, que nao existe em RP/particles")

# --- 5e. A Nave Level 1 veio inteira ------------------------------------------
#
# O addon dela foi juntado a este. Juntar addon à mão é onde se perde arquivo:
# falta uma textura e a nave fica roxa e preta; falta o render controller e ela
# não aparece; falta a entidade do RP e o jogo mostra um cubo branco. Nenhum
# desses casos dá erro no log — todos aparecem só voando.
NAVE = "gh:level_1_spaceship"
if any(NAVE in (config_src or "") for _ in (1,)) or True:
    faltando = []
    for caminho in (
        os.path.join(BP, "entities", "level_1_spaceship.json"),
        os.path.join(BP, "spawn_rules", "level_1_spaceship.json"),
        os.path.join(BP, "animation_controllers", "ship.animation_controllers.json"),
        os.path.join(BP, "loot_tables", "gh", "spaceship_death.json"),
        os.path.join(BP, "loot_tables", "gh", "spaceship_disassembled.json"),
        os.path.join(RP, "entity", "level_1_spaceship.json"),
        os.path.join(RP, "models", "entity", "level_1_spaceship.geo.json"),
        os.path.join(RP, "render_controllers", "level_1_spaceship.render_controllers.json"),
        os.path.join(RP, "animations", "level_1_spaceship.animation.json"),
        os.path.join(RP, "animation_controllers", "level_1_spaceship.animation_controllers.json"),
        os.path.join(RP, "particles", "gh_ship_circle.particle.json"),
        os.path.join(RP, "textures", "gh", "level_1_spaceship.png"),
        os.path.join(RP, "textures", "gh", "shockwave.png"),
        os.path.join(RP, "sounds", "sound_definitions.json"),
        os.path.join(RP, "sounds", "gh", "ship_engine.ogg"),
    ):
        if not os.path.isfile(caminho):
            faltando.append(os.path.relpath(caminho, ROOT))
    if faltando:
        err("a Nave Level 1 veio incompleta: falta " + ", ".join(faltando))

    # O nome dela tem que estar no RP, senão o jogo mostra o id cru.
    for lang in ("pt_BR", "en_US", "en_GB"):
        caminho = os.path.join(RP, "texts", f"{lang}.lang")
        if not os.path.isfile(caminho):
            continue
        with open(caminho, encoding="utf-8") as f:
            txt = f.read()
        if f"entity.{NAVE}.name=" not in txt:
            err(f"a Nave Level 1 sem nome em RP/texts/{lang}.lang — apareceria "
                f"como '{NAVE}' no jogo")

    # E ela tem que contar como veículo pressurizado, senão o piloto sufoca e
    # congela dentro da própria nave.
    if NAVE not in (config_src or ""):
        err(f"{NAVE} nao esta em PRESSURIZED_VEHICLES — o piloto sufocaria e "
            f"congelaria dentro da propria nave")

# --- 6. Ícones dos packs ------------------------------------------------------
for base, name in ((BP, "BP"), (RP, "RP")):
    if not os.path.isfile(os.path.join(base, "pack_icon.png")):
        warn(f"{name} sem pack_icon.png")

# --- 7. Imports dos scripts resolvem ------------------------------------------
script_dir = os.path.join(BP, "scripts", "gh")
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
