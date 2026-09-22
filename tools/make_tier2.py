#!/usr/bin/env python3
"""A Nave Level 2 e o kit que transforma a Level 1 nela.

A Level 2 é DERIVADA da Level 1, e não escrita do zero. A Level 1 tem 400
linhas de componentes que fazem ela voar, tocar buzina, explodir na queda,
abduzir gato e não sumir sozinha — copiar isso à mão é copiar errado em algum
lugar e só descobrir no jogo. Aqui o arquivo dela é lido e só o que MUDA é
mudado:

  - o identificador e a geometria;
  - a caixa de colisão, medida no modelo novo;
  - o assento: um só, no meio, pra o piloto ficar dentro do modelo;
  - mais vida, porque é a nave que aguenta Vênus.

O que ela herda de graça: a captura pela tag, o transporte entre dimensões
(vehicle.js reconhece as duas pelo `minecraft:rideable`), o despawn protegido
e as animações.
"""
import json
import os
import shutil
import struct
import sys
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from langfile import escreve_idiomas  # noqa: E402

MARK = "## a Nave Level 2 e o kit dela (gerado por tools/make_tier2.py)"
BP = os.path.join(ROOT, "packs", "Galactic Horizons BP")
RP = os.path.join(ROOT, "packs", "Galactic Horizons RP")
SRC = os.path.join(ROOT, "tools", "assets", "tier2")

# ---------------------------------------------------------------------------
# O kit: o que a Level 1 precisa receber pra virar Level 2
# ---------------------------------------------------------------------------
# (id, arquivo da textura, cor do nome, quantos o craft dá)
#
# Os seis saem das artes que ele mandou, e cada um existe por um motivo que a
# nave de verdade teria — não são seis pedras com nome diferente:
#
#   blindagem dourada   a folha de ouro que envolve sonda de verdade; é o que
#                       reflete o calor de Vênus em vez de absorvê-lo
#   dissipador térmico  as aletas que jogam pra fora o calor que entrou
#   anel de casco       o reforço que segura 92 atmosferas de pressão
#   célula de energia   energia pra aguentar sem Sol sob a nuvem permanente
#   núcleo de navegação o cristal que enxerga através da nuvem
#   computador de bordo quem pilota quando não dá pra ver nada lá fora
ITENS = [
    ("gold_shielding", "gold_shielding.png", "yellow",
     "Blindagem Dourada", "Gold Shielding"),
    ("heat_sink", "heat_sink.png", "aqua",
     "Dissipador Térmico", "Heat Sink"),
    ("hull_ring", "hull_ring.png", "gray",
     "Anel de Casco", "Hull Ring"),
    ("energy_cell", "energy_cell.png", "aqua",
     "Célula de Energia", "Energy Cell"),
    ("nav_core", "nav_core.png", "blue",
     "Núcleo de Navegação", "Navigation Core"),
    ("flight_computer", "flight_computer.png", "gray",
     "Computador de Bordo", "Flight Computer"),
]

# Medido em tools/tests/test_tier2.mjs a partir da própria geometria: o modelo
# tem 6,07 blocos de largura e 3,69 de altura. A colisão é a mesma proporção
# que a Level 1 usa (3,8 de colisão pra 5,98 de modelo), arredondada pra baixo
# — colisão maior que o modelo empurra o jogador no ar sem nada visível ali.
#
# E ela continua cabendo na caixa 5x5 que salva o veículo na troca de dimensão
# (SAVE_HALF em vehicle.js). Se um dia crescer, o teste reclama antes do jogo.
COLISAO = {"height": 2.7, "width": 3.9}

# UM lugar só, no meio.
#
# Eram três em fila, e a fila não cabia: a cúpula da Level 2 tem 2,3 blocos de
# largura útil, e os assentos das pontas jogavam o jogador PRA FORA do casco —
# ele aparecia sentado no ar, do lado da nave. Um assento centrado é o único
# que fica dentro do modelo em qualquer ângulo de câmera.
#
# y 2.1 é a altura do piso da cúpula: mais baixo e a cabeça fica dentro do
# casco, mais alto e ela atravessa o teto. z 0.15 é o miolo dela.
ASSENTOS = [
    {"position": [0.0, 2.1, 0.15]},
]

VIDA = 140          # o dobro da Level 1: é a que aguenta Vênus


def png_rgba(path):
    """Lê um PNG (8 bits, RGB ou RGBA, sem entrelace) como (w, h, pixels)."""
    data = open(path, "rb").read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", path
    pos, idat, w = 8, b"", None
    while pos < len(data):
        n = struct.unpack(">I", data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + n]
        if kind == b"IHDR":
            w, h, depth, color = struct.unpack(">IIBB", body[:10])
            assert depth == 8 and color in (2, 6), (path, depth, color)
            canais = 4 if color == 6 else 3
        elif kind == b"IDAT":
            idat += body
        elif kind == b"IEND":
            break
        pos += 12 + n
    raw = zlib.decompress(idat)
    linha = w * canais
    px, ant = [], bytearray(linha)
    p = 0
    for _ in range(h):
        filtro = raw[p]; p += 1
        atual = bytearray(raw[p:p + linha]); p += linha
        for i in range(linha):
            a = atual[i - canais] if i >= canais else 0
            b = ant[i]
            c = ant[i - canais] if i >= canais else 0
            if filtro == 1: atual[i] = (atual[i] + a) & 255
            elif filtro == 2: atual[i] = (atual[i] + b) & 255
            elif filtro == 3: atual[i] = (atual[i] + (a + b) // 2) & 255
            elif filtro == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                atual[i] = (atual[i] + pr) & 255
        ant = atual
        for x in range(w):
            q = x * canais
            px.append((atual[q], atual[q + 1], atual[q + 2],
                       atual[q + 3] if canais == 4 else 255))
    return w, h, px


def escreve_png(path, w, h, px):
    raw = b""
    for y in range(h):
        raw += b"\x00" + bytes(v for x in range(w) for v in px[y * w + x])
    def bloco(tipo, body):
        return (struct.pack(">I", len(body)) + tipo + body
                + struct.pack(">I", zlib.crc32(tipo + body) & 0xFFFFFFFF))
    open(path, "wb").write(
        b"\x89PNG\r\n\x1a\n"
        + bloco(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
        + bloco(b"IDAT", zlib.compress(raw, 9))
        + bloco(b"IEND", b""))


def quadrado(origem, destino, lado=128):
    """Deixa a arte QUADRADA antes de virar ícone.

    O slot do inventário é quadrado e estica o que não for: o render da nave é
    600x430, e sem isto ela apareceria 1,4 vez mais larga do que é. Aqui ela é
    centrada num quadro transparente e reduzida com média de área, que é o que
    não deixa a redução virar chuvisco.
    """
    w, h, px = png_rgba(origem)
    lado_src = max(w, h)
    ox, oy = (lado_src - w) // 2, (lado_src - h) // 2
    saida = []
    for y in range(lado):
        for x in range(lado):
            x0, x1 = x * lado_src // lado, (x + 1) * lado_src // lado
            y0, y1 = y * lado_src // lado, (y + 1) * lado_src // lado
            r = g = b = a = n = 0
            for sy in range(y0, max(y0 + 1, y1)):
                for sx in range(x0, max(x0 + 1, x1)):
                    fx, fy = sx - ox, sy - oy
                    n += 1
                    if 0 <= fx < w and 0 <= fy < h:
                        pr, pg, pb, pa = px[fy * w + fx]
                        r += pr * pa; g += pg * pa; b += pb * pa; a += pa
            if a:
                saida.append((r // a, g // a, b // a, a // n))
            else:
                saida.append((0, 0, 0, 0))
    escreve_png(destino, lado, lado, saida)


def junta(caminho, chave, novos):
    """Acrescenta entradas a um .json de texturas sem apagar as que já existem."""
    doc = json.load(open(caminho, encoding="utf-8")) if os.path.exists(caminho) else {}
    doc.setdefault(chave, {}).update(novos)
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")


def main():
    # --- a entidade, derivada da Level 1 ------------------------------------
    doc = json.load(open(os.path.join(BP, "entities", "level_1_spaceship.json"),
                         encoding="utf-8"))
    ent = doc["minecraft:entity"]
    ent["description"]["identifier"] = "gh:level_2_spaceship"

    c = ent["components"]
    c["minecraft:collision_box"] = dict(COLISAO)
    c["minecraft:health"] = {"value": VIDA}
    rid = c["minecraft:rideable"]
    rid["seat_count"] = len(ASSENTOS)
    rid["seats"] = [dict(s) for s in ASSENTOS]

    # O grupo que devolve a colisão depois de alguém desmontar tem que devolver
    # a colisão DESTA nave, não a da Level 1 — senão ela encolhe pra sempre no
    # primeiro desmonte.
    grupos = ent.get("component_groups", {})
    if "gh:collision_restart" in grupos:
        grupos["gh:collision_restart"]["minecraft:collision_box"] = dict(COLISAO)

    with open(os.path.join(BP, "entities", "level_2_spaceship.json"), "w",
              encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")

    # --- o cliente ----------------------------------------------------------
    rpdoc = json.load(open(os.path.join(RP, "entity", "level_1_spaceship.json"),
                           encoding="utf-8"))
    desc = rpdoc["minecraft:client_entity"]["description"]
    desc["identifier"] = "gh:level_2_spaceship"
    desc["textures"]["default"] = "textures/gh/level_2_spaceship"
    desc["geometry"]["default"] = "geometry.gh.level_2_spaceship"
    desc["spawn_egg"] = {"texture": "gh_ship2_spawn_egg", "texture_index": 0}
    with open(os.path.join(RP, "entity", "level_2_spaceship.json"), "w",
              encoding="utf-8") as f:
        json.dump(rpdoc, f, indent=2, ensure_ascii=False)
        f.write("\n")

    # --- os seis itens do kit ----------------------------------------------
    novas_texturas = {}
    for item_id, arquivo, cor, _pt, _en in ITENS:
        with open(os.path.join(BP, "items", item_id + ".json"), "w",
                  encoding="utf-8") as f:
            json.dump({
                "format_version": "1.21.80",
                "minecraft:item": {
                    "description": {
                        "identifier": "gh:" + item_id,
                        "menu_category": {"category": "items"},
                    },
                    "components": {
                        "minecraft:icon": "gh_" + item_id,
                        "minecraft:max_stack_size": 64,
                        "minecraft:hover_text_color": cor,
                    },
                },
            }, f, indent=2, ensure_ascii=False)
            f.write("\n")
        shutil.copyfile(os.path.join(SRC, arquivo),
                        os.path.join(RP, "textures", "gh", "items", item_id + ".png"))
        novas_texturas["gh_" + item_id] = {"textures": "textures/gh/items/" + item_id}

    # --- o ovo da Level 2 ---------------------------------------------------
    quadrado(os.path.join(SRC, "level_2_spaceship_render.png"),
             os.path.join(RP, "textures", "gh", "items", "ship2_spawn_egg.png"))
    novas_texturas["gh_ship2_spawn_egg"] = {
        "textures": "textures/gh/items/ship2_spawn_egg"}

    junta(os.path.join(RP, "textures", "item_texture.json"),
          "texture_data", novas_texturas)

    # --- os nomes, nos cinco .lang -----------------------------------------
    # A chave de ITEM no Bedrock é `item.<id>=`, SEM `.name` — quem leva
    # `.name` é bloco (`tile.<id>.name=`) e entidade. Escrito com `.name` o
    # jogo simplesmente ignora a linha e mostra o id cru, sem reclamar de nada.
    pt = [f"item.gh:{i}={p}" for i, _, _, p, _ in ITENS]
    en = [f"item.gh:{i}={e}" for i, _, _, _, e in ITENS]
    pt.append("item.gh:level_2_spaceship_spawn_egg=Nave Level 2")
    en.append("item.gh:level_2_spaceship_spawn_egg=Level 2 Spaceship")
    pt.append("entity.gh:level_2_spaceship.name=Nave Level 2")
    en.append("entity.gh:level_2_spaceship.name=Level 2 Spaceship")
    escreve_idiomas(RP, MARK, pt, en)

    print(f"Nave Level 2: colisão {COLISAO['width']}x{COLISAO['height']}, "
          f"{len(ASSENTOS)} assentos em fila atrás, {VIDA} de vida")
    print(f"  kit de {len(ITENS)} itens: " + ", ".join(i for i, _, _, _, _ in ITENS))


if __name__ == "__main__":
    main()
