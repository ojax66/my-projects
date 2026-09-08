#!/usr/bin/env python3
"""Prova que as checagens do validate.py realmente pegam o que deviam pegar.

Cada caso aqui e um bug que ja aconteceu no addon e passou batido: o
validate.py dizia "ok" enquanto o jogo mostrava o id cru no lugar do nome, ou
recusava o item no slot da mesa de ferraria. Um validador que so aprova nao
serve pra nada — entao cada checagem nova ganha aqui um caso que a quebra e
espera o erro aparecer.

Roda o validate.py de verdade, sobre uma copia dos packs numa pasta temporaria.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

fails = 0
passes = 0


def run_validate(root):
    """Roda o validate.py da copia e devolve (codigo, saida)."""
    p = subprocess.run(
        [sys.executable, os.path.join(root, "tools", "validate.py")],
        capture_output=True, text=True,
    )
    return p.returncode, p.stdout + p.stderr


def case(name, mutate, expect):
    """Copia o repo, aplica `mutate`, e espera que o validate.py reclame com `expect`."""
    global fails, passes
    with tempfile.TemporaryDirectory() as tmp:
        for sub in ("tools", "packs"):
            shutil.copytree(os.path.join(ROOT, sub), os.path.join(tmp, sub),
                            ignore=shutil.ignore_patterns("__pycache__", "tests"))
        os.makedirs(os.path.join(tmp, "tools", "tests"), exist_ok=True)
        mutate(tmp)
        code, out = run_validate(tmp)
        if code != 0 and re.search(expect, out):
            print(f"  PASS  {name}")
            passes += 1
        else:
            print(f"  FALHOU  {name}")
            print(f"          esperava erro casando /{expect}/, veio codigo {code}:")
            print("          " + out.strip().replace("\n", "\n          "))
            fails += 1


def bp(tmp, *parts):
    return os.path.join(tmp, "packs", "Distant Horizons BP", *parts)


def rp(tmp, *parts):
    return os.path.join(tmp, "packs", "Distant Horizons RP", *parts)


# --- linha de base: sem mexer em nada, o validador aprova ---------------------
with tempfile.TemporaryDirectory() as tmp:
    for sub in ("tools", "packs"):
        shutil.copytree(os.path.join(ROOT, sub), os.path.join(tmp, sub),
                        ignore=shutil.ignore_patterns("__pycache__", "tests"))
    os.makedirs(os.path.join(tmp, "tools", "tests"), exist_ok=True)
    code, out = run_validate(tmp)
    if code == 0:
        print("  PASS  o addon como esta passa na validacao")
        passes += 1
    else:
        print("  FALHOU  o addon como esta NAO passa na validacao:")
        print("          " + out.strip().replace("\n", "\n          "))
        fails += 1


# --- 1. nome no behavior pack (o jogo so le nome no resource pack) ------------
def name_in_bp(tmp):
    line = "item.space_dim:star_core_ingot=Lingote Estelar\n"
    for lang in ("pt_BR", "en_US", "en_GB"):
        with open(bp(tmp, "texts", f"{lang}.lang"), "a", encoding="utf-8") as f:
            f.write(line)


case("nome de item escrito no BP em vez do RP", name_in_bp,
     r"BP/texts/en_US\.lang tem \d+ nome")


# --- 2. item sem nome nenhum: apareceria como o id ---------------------------
def drop_name(tmp):
    for lang in ("pt_BR", "en_US", "en_GB"):
        path = rp(tmp, "texts", f"{lang}.lang")
        keep = [l for l in open(path, encoding="utf-8").read().splitlines()
                if not l.startswith("item.space_dim:star_helmet=")]
        open(path, "w", encoding="utf-8").write("\n".join(keep) + "\n")


case("peca de armadura sem nome no RP", drop_name,
     r"star_helmet sem nome em RP/texts/en_US\.lang")


# --- 3. bloco sem nome -------------------------------------------------------
def drop_block_name(tmp):
    for lang in ("pt_BR", "en_US", "en_GB"):
        path = rp(tmp, "texts", f"{lang}.lang")
        keep = [l for l in open(path, encoding="utf-8").read().splitlines()
                if not l.startswith("tile.space_dim:moon_regolith.name=")]
        open(path, "w", encoding="utf-8").write("\n".join(keep) + "\n")


case("bloco sem nome no RP", drop_block_name,
     r"moon_regolith sem nome em RP/texts/en_US\.lang")


# --- 4. o .lang inteiro no lugar errado --------------------------------------
def no_rp_lang(tmp):
    os.remove(rp(tmp, "texts", "en_US.lang"))


case("RP/texts/en_US.lang ausente", no_rp_lang,
     r"RP/texts/en_US\.lang nao existe")


# --- 5. material sem a tag do slot da mesa de ferraria -----------------------
def drop_material_tag(tmp):
    path = bp(tmp, "items", "star_core_ingot.json")
    doc = json.load(open(path, encoding="utf-8"))
    doc["minecraft:item"]["components"].pop("minecraft:tags", None)
    json.dump(doc, open(path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)


case("lingote sem minecraft:transform_materials", drop_material_tag,
     r"star_core_ingot esta no slot 'addition'.*transform_materials")


# --- 6. molde sem a tag do slot do molde -------------------------------------
def drop_template_tag(tmp):
    path = bp(tmp, "items", "star_upgrade_template.json")
    doc = json.load(open(path, encoding="utf-8"))
    doc["minecraft:item"]["components"]["minecraft:tags"] = {"tags": ["space_dim:qualquer"]}
    json.dump(doc, open(path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)


case("molde sem minecraft:transform_templates", drop_template_tag,
     r"star_upgrade_template esta no slot 'template'.*transform_templates")



# --- 7. troca de UUID que esquece a dependência cruzada ----------------------
#
# tools/new_uuids.py troca os cinco UUIDs a cada entrega. O jeito de errar isso
# e trocar o header e deixar a dependencia do outro pack apontando pro UUID
# velho: os dois packs passam a pedir um pack que nao existe, e o jogo recusa
# os dois sem dizer por que.
def stale_cross_dep(tmp):
    path = bp(tmp, "manifest.json")
    doc = json.load(open(path, encoding="utf-8"))
    doc["dependencies"][0]["uuid"] = "00000000-0000-4000-8000-000000000000"
    json.dump(doc, open(path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)


case("dependencia cruzada apontando pro UUID antigo", stale_cross_dep,
     r"BP nao declara dependencia do RP|BP não declara dependência do RP")


# --- 8. dois UUIDs iguais ----------------------------------------------------
def duplicate_uuid(tmp):
    path = bp(tmp, "manifest.json")
    doc = json.load(open(path, encoding="utf-8"))
    doc["modules"][0]["uuid"] = doc["header"]["uuid"]
    json.dump(doc, open(path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)


case("modulo com o mesmo UUID do header", duplicate_uuid, r"UUID repetido")



# --- 9. corpo sem o modelo que o mostra de longe -----------------------------
def drop_sky_entity(tmp):
    os.remove(bp(tmp, "entities", "sky_mars.json"))


case("corpo sem entidade de ceu", drop_sky_entity,
     r"corpo mars sem entidade de ceu no BP")


def drop_sky_texture(tmp):
    os.remove(rp(tmp, "textures", "space_dim", "sky", "earth.png"))


case("corpo sem textura de ceu", drop_sky_texture,
     r"corpo earth sem textura de ceu")


# --- 10. faixa da propriedade de escala menor do que o config pede -----------
#
# O motor ignora calado um valor fora da faixa: o corpo fica do tamanho errado
# e nada aparece no console.
def narrow_scale(tmp):
    path = bp(tmp, "entities", "sky_sun.json")
    doc = json.load(open(path, encoding="utf-8"))
    doc["minecraft:entity"]["description"]["properties"]["space_dim:size"]["range"] = [0.5, 2]
    json.dump(doc, open(path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)


case("faixa de escala menor do que o config usa", narrow_scale,
     r"sky_sun: a faixa de space_dim:size")


# --- 11. mapa estelar de um sistema que nao existe ---------------------------
def orphan_chart(tmp):
    src = bp(tmp, "items", "star_chart_sol.json")
    doc = json.load(open(src, encoding="utf-8"))
    doc["minecraft:item"]["description"]["identifier"] = "space_dim:star_chart_fantasma"
    json.dump(doc, open(bp(tmp, "items", "star_chart_fantasma.json"), "w",
                        encoding="utf-8"), indent=2, ensure_ascii=False)


case("mapa estelar de um sistema inexistente", orphan_chart,
     r"star_chart_fantasma abre o sistema 'fantasma'")


# --- 12. server-ui usado e nao declarado -------------------------------------
#
# Sem a dependencia o import falha no carregamento e TODOS os scripts do addon
# morrem juntos — nao so o menu.
def drop_ui_dependency(tmp):
    path = bp(tmp, "manifest.json")
    doc = json.load(open(path, encoding="utf-8"))
    doc["dependencies"] = [d for d in doc["dependencies"]
                           if d.get("module_name") != "@minecraft/server-ui"]
    json.dump(doc, open(path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)


case("server-ui importado mas nao declarado", drop_ui_dependency,
     r"nao declara essa dependencia")


# --- 12b. material trocado entre emissivo e alphatest ------------------------
def swap_material(tmp):
    path = rp(tmp, "entity", "sky_sun.entity.json")
    doc = json.load(open(path, encoding="utf-8"))
    doc["minecraft:client_entity"]["description"]["materials"]["default"] = "entity_alphatest"
    json.dump(doc, open(path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)


case("Sol com material nao-emissivo", swap_material,
     r"sky_sun usa o material entity_alphatest")


# --- 12c. corpo fora do alcance da luz do Sol --------------------------------
#
# Um corpo alem de SOLAR_SYSTEM_RADIUS fica na nevoa do espaco profundo: o Sol
# nao o ilumina, e nada avisa.
def shrink_system(tmp):
    path = os.path.join(tmp, "packs", "Distant Horizons BP",
                        "scripts", "space_dim", "config.js")
    src = open(path, encoding="utf-8").read()
    src = src.replace("export const SOLAR_SYSTEM_RADIUS = 1500;",
                      "export const SOLAR_SYSTEM_RADIUS = 600;")
    open(path, "w", encoding="utf-8").write(src)


case("corpo alem do alcance da luz do Sol", shrink_system,
     r"mars esta a \d+ do Sol, alem de SOLAR_SYSTEM_RADIUS")


# --- 12d. nevoa citada que nao existe ----------------------------------------
def missing_fog(tmp):
    os.remove(rp(tmp, "fogs", "outer_space.fog.json"))


case("nevoa citada pelo config e ausente do RP", missing_fog,
     r"nevoa space_dim:fog_outer_space, que nao existe")


# --- 13. os geradores nao podem depender da ordem ----------------------------
#
# Cada gerador e dono de um bloco do .lang. A versao antiga guardava so o que
# vinha ANTES do proprio marcador e descartava o resto, entao rodar um deles
# sozinho apagava os nomes dos outros — e o unico sinal era o item aparecendo
# no jogo com o id no lugar do nome. Aconteceu tres vezes.
def scrambled_generators():
    global fails, passes
    import subprocess
    with tempfile.TemporaryDirectory() as tmp:
        for sub in ("tools", "packs"):
            shutil.copytree(os.path.join(ROOT, sub), os.path.join(tmp, sub),
                            ignore=shutil.ignore_patterns("__pycache__", "tests"))
        os.makedirs(os.path.join(tmp, "tools", "tests"), exist_ok=True)
        # ordem de proposito trocada, e cada um rodado sozinho
        for gen in ("make_tracker.py", "make_spacesuit.py",
                    "make_blocks.py", "make_star_gear.py", "make_tracker.py"):
            r = subprocess.run([sys.executable, os.path.join(tmp, "tools", gen)],
                               capture_output=True, text=True)
            if r.returncode != 0:
                print(f"  FALHOU  gerador {gen} quebrou: {r.stderr.strip()}")
                fails += 1
                return
        code, out = run_validate(tmp)
        if code == 0:
            print("  PASS  geradores rodados fora de ordem, um a um")
            passes += 1
        else:
            print("  FALHOU  rodar os geradores fora de ordem quebrou o pack:")
            print("          " + out.strip().replace("\n", "\n          "))
            fails += 1


scrambled_generators()


print(f"\n{passes} PASS, {fails} FALHOU")
sys.exit(1 if fails else 0)
