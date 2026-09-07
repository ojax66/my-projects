#!/usr/bin/env python3
"""Confere o addon antes de empacotar.

Checa o que quebra silenciosamente no Bedrock: JSON malformado, UUID repetido,
dependência apontando pro pack errado, identificador que um arquivo declara e
outro referencia com outro nome, textura citada que não existe.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "Space Dimension BP")
RP = os.path.join(ROOT, "packs", "Space Dimension RP")

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
