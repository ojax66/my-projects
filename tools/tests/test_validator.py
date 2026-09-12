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
     r"corpo earth sem a textura de ceu")


# --- 10. degraus de escala do modelo ------------------------------------------
#
# O modelo fica preso ao jogador e e escalado pra dar o mesmo angulo que o corpo
# daria la longe. A conta e `2 * distancia_do_modelo * raio / distancia`; a
# versao anterior dividia por 8, tratando a meia-aresta do cubo como 8 BLOCOS
# quando ela e meio bloco — dezesseis vezes menor, e nada media isso.
def zero_step(tmp):
    path = os.path.join(tmp, "packs", "Distant Horizons BP",
                        "scripts", "space_dim", "skySteps.js")
    src = open(path, encoding="utf-8").read()
    open(path, "w", encoding="utf-8").write(src.replace("[0.05,", "[0,"))


case("degrau de escala igual a zero", zero_step, r"degrau de escala <= 0")


def steps_out_of_sync(tmp):
    path = bp(tmp, "entities", "sky_moon.json")
    doc = json.load(open(path, encoding="utf-8"))
    doc["minecraft:entity"]["component_groups"].pop("space_dim:size_3")
    json.dump(doc, open(path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)


case("degraus do BP fora de sincronia com skySteps.js", steps_out_of_sync,
     r"as listas divergiram")


def steps_too_narrow(tmp):
    # tira os degraus grandes: o Sol visto do ponto de troca nao caberia
    path = os.path.join(tmp, "packs", "Distant Horizons BP",
                        "scripts", "space_dim", "skySteps.js")
    src = open(path, encoding="utf-8").read()
    nums = re.search(r"\[(.*)\]", src).group(1).split(",")
    curto = "[" + ",".join(nums[:10]) + "]"
    open(path, "w", encoding="utf-8").write(
        re.sub(r"\[.*\]", curto, src))


case("degraus que nao cobrem o que a conta pede", steps_too_narrow,
     r"a conta pede de")


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


# A mensagem vem da checagem de FOG_ID que ja existia; nao ha uma segunda
# checagem de nevoa, e nao deve haver — duas mensagens pro mesmo defeito so
# fazem quem le a saida procurar dois problemas onde ha um.
case("nevoa citada pelo config e ausente do RP", missing_fog,
     r"FOG_ID space_dim:fog_outer_space n[ãa]o existe no RP")


# --- 12e. material do ceu que descarta alfa 0 --------------------------------
#
# O bug que deixou TODO corpo invisivel: `entity_emissive_alpha` trata alfa 0
# como transparente, e a textura do ceu e toda alfa 0 porque o alfa e a
# mascara de brilho. Nada no jogo dizia por que os planetas nao apareciam.
def wrong_sky_material(tmp):
    path = rp(tmp, "entity", "sky_earth.entity.json")
    doc = json.load(open(path, encoding="utf-8"))
    doc["minecraft:client_entity"]["description"]["materials"]["default"] = "entity_emissive_alpha"
    json.dump(doc, open(path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)


case("corpo do ceu com material que descarta alfa", wrong_sky_material,
     r"sky_earth usa o material entity_emissive_alpha")


def material_without_emissive(tmp):
    path = os.path.join(tmp, "packs", "Distant Horizons RP", "materials", "entity.material")
    doc = json.load(open(path, encoding="utf-8"))
    doc["materials"]["space_dim_sky:entity"]["+defines"] = []
    json.dump(doc, open(path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)


case("material do ceu sem USE_EMISSIVE", material_without_emissive,
     r"nao liga USE_EMISSIVE")


def frozen_offscreen(tmp):
    path = rp(tmp, "entity", "sky_mars.entity.json")
    doc = json.load(open(path, encoding="utf-8"))
    del doc["minecraft:client_entity"]["description"]["scripts"][
        "should_update_bones_and_effects_offscreen"]
    json.dump(doc, open(path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)


case("escala que congela fora da tela", frozen_offscreen,
     r"sky_mars sem should_update_bones_and_effects_offscreen")


# --- 12f. modelo do ceu que mostra so um pedaco da textura --------------------
def box_uv(tmp):
    path = os.path.join(tmp, "packs", "Distant Horizons RP",
                        "models", "entity", "sky_body.geo.json")
    doc = json.load(open(path, encoding="utf-8"))
    doc["minecraft:geometry"][0]["bones"][0]["cubes"][0]["uv"] = [0, 0]
    json.dump(doc, open(path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)


case("modelo do ceu com box UV", box_uv, r"usa box UV")


def wrong_texture_size(tmp):
    # troca a textura da Lua por uma de outro tamanho
    import shutil as sh
    sh.copyfile(rp(tmp, "textures", "space_dim", "blocks", "moon_regolith.png"),
                rp(tmp, "textures", "space_dim", "sky", "moon.png"))


case("textura de ceu com tamanho diferente do modelo", wrong_texture_size,
     r"moon\.png e 32x32, mas o modelo declara")


# --- 12g. cliente voltando a animar a escala ---------------------------------
def animate_scale_again(tmp):
    path = rp(tmp, "entity", "sky_earth.entity.json")
    doc = json.load(open(path, encoding="utf-8"))
    doc["minecraft:client_entity"]["description"]["animations"] = {"size": "x"}
    json.dump(doc, open(path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)


case("cliente voltando a animar a escala", animate_scale_again,
     r"anima a escala no cliente")


# --- 12h. camada atravessavel pintada com bloco solido -----------------------
#
# O bug: o degrade do Sol pintava o miolo de cada face da casca externa com
# `sun_core`, que e o chao macico do nucleo. A primeira camada do Sol fechou —
# dava pra encostar nele, nao pra entrar — e nada apontava pra isso.
def solid_on_passable_layer(tmp):
    path = os.path.join(tmp, "packs", "Distant Horizons BP",
                        "scripts", "space_dim", "bodies.js")
    src = open(path, encoding="utf-8").read()
    open(path, "w", encoding="utf-8").write(
        src.replace('block: "space_dim:sun_blaze"', 'block: "space_dim:sun_core"'))


case("camada atravessavel pintada com bloco solido", solid_on_passable_layer,
     r"pinta com space_dim:sun_core, que TEM colisao")


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



# --- moldura preta no atlas do ceu -------------------------------------------
#
# Metade de cada textura de ceu (as seis celulas nao usadas da planificacao 4x3)
# nascia preta. O mipmap mistura isso na borda das faces e o corpo ganha uma
# moldura escura justamente quando esta longe.
def paint_black_corner(tmp):
    import struct
    import zlib
    tex = rp(tmp, "textures", "space_dim", "sky", "earth.png")
    with open(tex, "rb") as f:
        raw = f.read()
    w, h = struct.unpack(">II", raw[16:24])
    # reescreve a textura inteira: preta no canto de cima a esquerda (celula que
    # nao carrega face), branca no resto
    lines = bytearray()
    for y in range(h):
        lines.append(0)
        for x in range(w):
            black = x < 64 and y < 64
            lines += bytes((0, 0, 0, 0) if black else (255, 255, 255, 0))

    def chunk(typ, data):
        body = typ + data
        return struct.pack(">I", len(data)) + body + struct.pack(
            ">I", zlib.crc32(body) & 0xffffffff)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    with open(tex, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
                + chunk(b"IDAT", zlib.compress(bytes(lines), 9))
                + chunk(b"IEND", b""))


case("textura de ceu com texel preto puro", paint_black_corner, r"preto\(s\) puro")



# --- as cascas do Sol volumetrico -------------------------------------------
#
# O Sol deixou de ser um cubo com textura e virou um empilhado de cascas
# transl0cidas. Cada peca disso quebra sozinha e em silencio: material errado,
# casca faltando, alfa no extremo, ordem invertida. Uma regra pra cada.
def glow_geo(tmp):
    return rp(tmp, "models", "entity", "sky_glow.geo.json")


def material_sem_mistura(tmp):
    caminho = rp(tmp, "materials", "entity.material")
    with open(caminho, encoding="utf-8") as f:
        doc = json.load(f)
    doc["materials"]["space_dim_glow:entity"] = doc["materials"].pop(
        "space_dim_glow:entity_emissive_alpha")
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2)


case("material das cascas sem mistura", material_sem_mistura,
     r"esperado 'entity_emissive_alpha'")


def cascas_de_menos(tmp):
    with open(glow_geo(tmp), encoding="utf-8") as f:
        doc = json.load(f)
    bone = doc["minecraft:geometry"][0]["bones"][0]
    bone["cubes"] = bone["cubes"][:2]
    with open(glow_geo(tmp), "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2)


case("cascas de menos no Sol volumetrico", cascas_de_menos, r"casca\(s\) —")


def casca_descentrada(tmp):
    with open(glow_geo(tmp), encoding="utf-8") as f:
        doc = json.load(f)
    doc["minecraft:geometry"][0]["bones"][0]["cubes"][0]["origin"][0] += 3
    with open(glow_geo(tmp), "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2)


case("casca do Sol fora do centro", casca_descentrada, r"nao esta centrada")


def cascas_opacas(tmp):
    import struct
    import zlib
    tex = rp(tmp, "textures", "space_dim", "sky", "glow_sun.png")
    with open(tex, "rb") as f:
        raw = f.read()
    w, h = struct.unpack(">II", raw[16:24])
    lines = bytearray()
    for y in range(h):
        lines.append(0)
        for x in range(w):
            lines += bytes((200, 100, 40, 255))     # alfa no extremo

    def chunk(typ, data):
        body = typ + data
        return struct.pack(">I", len(data)) + body + struct.pack(
            ">I", zlib.crc32(body) & 0xffffffff)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    with open(tex, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
                + chunk(b"IDAT", zlib.compress(bytes(lines), 9))
                + chunk(b"IEND", b""))


case("cascas do Sol com alfa opaco", cascas_opacas, r"alfa 255")

scrambled_generators()


print(f"\n{passes} PASS, {fails} FALHOU")
sys.exit(1 if fails else 0)
