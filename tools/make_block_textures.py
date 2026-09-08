#!/usr/bin/env python3
"""Gera as texturas dos blocos dos corpos celestes, no estilo do jogo.

Duas coisas separadas, e confundi-las já custou duas rodadas:

  DENTRO de um bloco   variação SUTIL — tons vizinhos, sem mancha escura.
  ENTRE os blocos      variação GRANDE — é daqui que sai o desenho do planeta.

As manchas de um corpo (os mares da Lua, o basalto de Marte) são BLOCOS
DIFERENTES que o gerador espalha pela superfície, não pintura dentro da
textura. Uma textura com tom escuro dentro dela repete aquela mesma mancha em
cada bloco, e o planeta inteiro fica salpicado do mesmo carimbo.

O que já foi errado aqui, nesta ordem:

  1ª versão   ruído fbm com rampa contínua: dezenas de tons e degradê suave.
              Cara de render.
  2ª versão   4 tons quase idênticos em grão de 16x16 (`earth_land` tinha
              faixa de luma 16). De longe vira uma cor chapada sem forma.
  3ª versão   6 tons com faixa de até 170 — contraste alto DENTRO do bloco.
              Resolveu o borrão e criou o carimbo: mancha escura repetida no
              planeta inteiro.

Agora:

  1. o desenho é feito numa grade de 8x8 CÉLULAS, cada uma virando 2x2 pixels
     na textura de 16x16 — pixel grosso, como no print de referência;
  2. cada paleta tem 5 ou 6 tons VIZINHOS, com faixa de luma curta;
  3. os blocos de um mesmo corpo ficam bem separados entre si, pra que a troca
     de bloco no gerador seja o que se vê de longe;
  4. o pixel recebe a cor por RANKING: os valores do ruído são ordenados e
     fatiados nas proporções pedidas, então a proporção sai exata em toda
     textura e nenhuma fica lavada por azar do sorteio.

As cores saem das referências: a rampa da Lua é a do print
(#505666 … #D9E4FF), fatiada em três blocos; a do Sol é a do sol do jogo
(#FFD64A / #FFFFA9 / #FFFFD9); a de Marte vem do cubo vermelho
(#6D3435 / #A6433B).
"""
import math
import os
import struct
import zlib

SIZE = 16
# Lado da grade de desenho. 8 células em 16 pixels = cada célula é um quadrado
# 2x2. É a resolução do print de referência, e é o que dá o pixel grosso.
CELLS = 8
CELL_PX = SIZE // CELLS
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "packs", "Distant Horizons RP", "textures", "space_dim", "blocks")


# --- PNG ---------------------------------------------------------------------
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


def hex_rgb(s):
    s = s.lstrip("#")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))


# --- Ruído -------------------------------------------------------------------
def _hash(ix, iy, period, seed):
    ix %= period
    iy %= period
    n = ix * 374761393 + iy * 668265263 + seed * 2147483647
    n = (n ^ (n >> 13)) * 1274126177
    n ^= n >> 16
    return ((n & 0x7FFFFFFF) % 100000) / 100000.0


def _smooth(t):
    return t * t * (3 - 2 * t)


def value_noise(x, y, period, seed):
    """Ruído de valor que fecha em `period`, pra a textura casar nas bordas."""
    x0, y0 = math.floor(x), math.floor(y)
    sx, sy = _smooth(x - x0), _smooth(y - y0)
    n00 = _hash(x0, y0, period, seed)
    n10 = _hash(x0 + 1, y0, period, seed)
    n01 = _hash(x0, y0 + 1, period, seed)
    n11 = _hash(x0 + 1, y0 + 1, period, seed)
    ix0 = n00 + (n10 - n00) * sx
    ix1 = n01 + (n11 - n01) * sx
    return ix0 + (ix1 - ix0) * sy


# --- Construção da textura ---------------------------------------------------
def build(palette, weights, seed, clump=4, jitter=0.45):
    """Uma textura de bloco, desenhada em células grossas.

    palette : cores "#RRGGBB", da mais escura pra mais clara
    weights : proporção de cada cor; normalizada aqui
    clump   : quantas células de ruído cabem na grade. 3 dá mancha larga, tipo
              pedra; 6 dá grão miúdo, tipo areia.
    jitter  : quanto de sorteio por célula entra na conta. 0 deixa manchas de
              borda lisa (parece plástico); alto demais vira chuvisco.
    """
    cols = [hex_rgb(c) for c in palette]

    vals = []
    for cy in range(CELLS):
        for cx in range(CELLS):
            n = value_noise(cx / CELLS * clump, cy / CELLS * clump, clump, seed)
            j = _hash(cx, cy, 4096, seed + 977)
            vals.append((n * (1 - jitter) + j * jitter, cx, cy))

    # Cor por ranking: garante a proporção exata pedida em weights.
    vals.sort(key=lambda v: v[0])
    total = sum(weights)
    cells = [[None] * CELLS for _ in range(CELLS)]
    i = 0
    for idx, w in enumerate(weights):
        take = round(len(vals) * w / total) if idx < len(weights) - 1 else len(vals) - i
        for _, cx, cy in vals[i:i + take]:
            cells[cy][cx] = cols[idx] + (255,)
        i += take

    # Cada célula vira um quadrado CELL_PX x CELL_PX.
    rows = []
    for cy in range(CELLS):
        line = []
        for cx in range(CELLS):
            line.extend([cells[cy][cx]] * CELL_PX)
        for _ in range(CELL_PX):
            rows.append(list(line))
    return rows


# --- Paletas -----------------------------------------------------------------
# Cada entrada: (paleta, proporções, seed, clump, jitter)
#
# Os seeds não são arbitrários: foram escolhidos por varredura, buscando viés
# centro/borda perto de zero. Um seed ruim concentra o tom claro no meio do
# bloco, e aí uma parede dele repete a mesma marca em cada bloco.
#
# SOL — cores dos anéis do sol do jogo, do âmbar da borda ao creme do miolo.
# TERRA — azul e verde saturados do ícone de referência.
# LUA — a paleta do print, exatamente. Nada de cratera desenhada dentro do
#   bloco: os tons viram BLOCOS SEPARADOS (regolito claro, médio, escuro), e
#   quem desenha as manchas grandes é o gerador da esfera, não a textura.
# MARTE — ferrugem do bloco de referência.

TEXTURES = {
    # --- Sol -----------------------------------------------------------------
    # Rampa do sol de referência (#FFD64A / #FFFFA9 / #FFFFD9), fatiada em três
    # camadas. Cada bloco fica dentro da sua fatia: a diferença coroa → plasma →
    # núcleo é entre BLOCOS, não dentro de nenhum deles.
    "sun_corona": (
        ["#D18E10", "#DE9C17", "#E8A81E", "#F0B227", "#F7BC33"],
        [2, 3, 4, 3, 2], 562, 3, 0.40,
    ),
    "sun_plasma": (
        ["#F2B62A", "#F9C330", "#FFCF3E", "#FFD64A", "#FFE066"],
        [2, 3, 4, 3, 2], 388, 3, 0.40,
    ),
    "sun_core": (
        ["#FFE87A", "#FFF095", "#FFF6B4", "#FFFAC9", "#FFFDD9"],
        [2, 3, 4, 3, 2], 432, 3, 0.38,
    ),

    # --- Terra ---------------------------------------------------------------
    # Oceano, plataforma, continente, floresta e gelo já SÃO cinco blocos: é a
    # troca entre eles que desenha os continentes. Dentro de cada um, só a
    # granulação.
    "earth_ocean": (
        ["#05327C", "#063E93", "#0847A5", "#0A51B4", "#0D5AC2"],
        [2, 3, 4, 3, 2], 496, 3, 0.44,
    ),
    "earth_shallow": (
        ["#045C79", "#056C91", "#06769E", "#0781AB", "#088BB8"],
        [2, 3, 4, 3, 2], 623, 3, 0.44,
    ),
    "earth_land": (
        ["#026E00", "#038500", "#049200", "#059F00", "#06AC0A"],
        [2, 3, 4, 3, 2], 178, 3, 0.46,
    ),
    "earth_forest": (
        ["#014A02", "#026002", "#026C02", "#037803", "#048404"],
        [2, 3, 4, 3, 2], 178, 3, 0.46,
    ),
    "earth_ice": (
        ["#D6DFEE", "#E8EFFA", "#EFF4FD", "#F6F9FF", "#FFFFFF"],
        [2, 3, 4, 3, 2], 382, 3, 0.42,
    ),

    # --- Lua -----------------------------------------------------------------
    # A rampa do print (#505666 #5F677A #747D93 #9097A5 #AFB8CC #D9E4FF) fatiada
    # em três blocos. É exatamente o que ele pediu lá atrás: "não é pra fazer um
    # bloco da lua que tenha buraquinhos escuros, vai ter o regolito claro,
    # escuro e etc". Os mares são regiões de centenas de blocos escuros que o
    # gerador desenha — não um buraco pintado dentro de cada bloco.
    "moon_regolith_light": (
        ["#B9C2D6", "#C6CFE4", "#D2DBF1", "#D9E4FF", "#E2ECFF"],
        [2, 3, 4, 3, 2], 495, 3, 0.44,
    ),
    "moon_regolith": (
        ["#868D9C", "#9097A5", "#9AA1B0", "#A5ACBB", "#AFB8CC"],
        [2, 3, 4, 3, 2], 807, 3, 0.44,
    ),
    "moon_regolith_dark": (
        ["#4A4F5E", "#505666", "#585E70", "#5F677A", "#6A7286"],
        [2, 3, 4, 3, 2], 623, 3, 0.44,
    ),

    # --- Marte ---------------------------------------------------------------
    "mars_dust": (
        ["#A94523", "#B44A28", "#BA4E2A", "#C25730", "#CA6238"],
        [2, 3, 4, 3, 2], 1068, 3, 0.45,
    ),
    "mars_rock": (
        ["#82361E", "#8B3A20", "#923D22", "#9A4326", "#A34B2C"],
        [2, 3, 4, 3, 2], 499, 3, 0.45,
    ),
    "mars_rock_dark": (
        ["#43190D", "#4A1B0E", "#501E10", "#582213", "#602716"],
        [2, 3, 4, 3, 2], 1068, 3, 0.45,
    ),
    "mars_ice": (
        ["#D2C6BC", "#DCD1C8", "#E2D7CF", "#E9E0D8", "#F1E9E3"],
        [2, 3, 4, 3, 2], 382, 3, 0.42,
    ),
}


# --- Verificações ------------------------------------------------------------
def distinct_colors(rows):
    return len({px[:3] for row in rows for px in row})


def center_bias(rows):
    """Brilho do miolo menos o da borda.

    Alto = cada bloco tem a mesma marca no meio, e uma parede deles vira
    bolinha repetida. O detalhe tem que vir do ruído, que atravessa a fronteira
    entre blocos vizinhos.
    """
    n = len(rows)
    lum = lambda p: 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]
    mid = [rows[y][x] for y in range(n // 4, 3 * n // 4) for x in range(n // 4, 3 * n // 4)]
    edge = [rows[y][x] for y in range(n) for x in range(n)
            if x < n // 4 or x >= 3 * n // 4 or y < n // 4 or y >= 3 * n // 4]
    return abs(sum(map(lum, mid)) / len(mid) - sum(map(lum, edge)) / len(edge))


def average_color(rows):
    n = len(rows) * len(rows[0])
    r = sum(p[0] for row in rows for p in row) // n
    g = sum(p[1] for row in rows for p in row) // n
    b = sum(p[2] for row in rows for p in row) // n
    return f"#{r:02X}{g:02X}{b:02X}"


MAX_COLORS = 6      # textura de bloco do jogo é chapada; mais que isso é render
MAX_BIAS = 14.0     # acima disso a textura vira bolinha repetida numa parede

# Os dois números abaixo são a diferença medida entre o que estava aqui e a
# referência que o usuário mandou. Sem eles, nada impedia a textura de voltar a
# ser um borrão: as checagens antigas só olhavam CORES DEMAIS, e quatro tons
# quase iguais passavam sem reclamação.
#
#   referência do usuário   6 tons, faixa de luma 144, células 8x8
#   o que estava gerado     4 tons, faixa de 16 a 83, grão 16x16
#
# `earth_land` tinha faixa 16: quatro verdes indistinguíveis, que de longe
# viram uma cor chapada sem forma. É essa a aparência que ele chamou de
# "inteligência artificial".
MIN_COLORS = 5      # menos que isso não tem o que desenhar

# O contraste DENTRO de um bloco tem teto, não piso.
#
# Um tom escuro dentro da textura vira uma mancha, e a mancha se repete em cada
# bloco: o planeta inteiro fica salpicado do mesmo carimbo. As manchas de
# verdade — os mares da Lua, o basalto de Marte — são BLOCOS DIFERENTES que o
# gerador espalha, e a separação entre eles é conferida logo abaixo.
MAX_LUMA_RANGE = 46

# E entre os blocos de um mesmo corpo a separação tem que existir, senão a troca
# de bloco não desenha nada e o corpo vira uma cor só.
#
# Medida como distância de COR, não de brilho: a floresta e o continente da
# Terra têm luma quase igual e matiz bem diferente — a mancha aparece
# perfeitamente, e uma checagem só de luma reprovaria os dois sem motivo.
MIN_BODY_SEPARATION = 24


def color_distance(a, b):
    ra, ga, ba = hex_rgb(a)
    rb, gb, bb = hex_rgb(b)
    return math.sqrt((ra - rb) ** 2 + (ga - gb) ** 2 + (ba - bb) ** 2)


def luma_range(rows):
    tones = {px[:3] for row in rows for px in row}
    lums = [(c[0] + c[1] + c[2]) / 3 for c in tones]
    return max(lums) - min(lums)


def is_chunky(rows):
    """A textura foi desenhada em células grossas, não pixel a pixel?"""
    n = len(rows)
    for y in range(0, n, CELL_PX):
        for x in range(0, n, CELL_PX):
            block = {rows[y + dy][x + dx][:3]
                     for dy in range(CELL_PX) for dx in range(CELL_PX)}
            if len(block) != 1:
                return False
    return True


if __name__ == "__main__":
    failures = []
    built = {}
    print(f"  {'bloco':22s} {'cores':>5s} {'faixa':>6s} {'média':>8s} {'centro':>7s}")
    for name, (pal, w, seed, clump, jitter) in TEXTURES.items():
        rows = build(pal, w, seed, clump, jitter)
        write_png(os.path.join(OUT, f"{name}.png"), rows)

        nc = distinct_colors(rows)
        bias = center_bias(rows)
        rng = luma_range(rows)
        built[name] = rows
        flags = []
        if nc > MAX_COLORS:
            flags.append(f"cores demais (>{MAX_COLORS})")
        if nc < MIN_COLORS:
            flags.append(f"cores de menos (<{MIN_COLORS})")
        if bias > MAX_BIAS:
            flags.append("efeito bolinha")
        if rng > MAX_LUMA_RANGE:
            flags.append(f"contraste alto demais ({rng:.0f} > {MAX_LUMA_RANGE}) — "
                         f"a mancha escura se repete no planeta inteiro")
        if not is_chunky(rows):
            flags.append(f"grão fino demais (não está na grade de {CELLS}x{CELLS})")
        if flags:
            failures.append(f"{name}: {', '.join(flags)}")
        print(f"  {name:22s} {nc:5d} {rng:6.0f} {average_color(rows):>8s} {bias:7.1f}"
              + ("   <-- " + "; ".join(flags) if flags else ""))

    # --- separação entre os blocos de cada corpo -----------------------------
    # É a troca de bloco que desenha o planeta. Dois blocos do mesmo corpo com
    # luma parecida não produzem mancha nenhuma: o gerador troca e nada muda.
    bodies = {}
    for name in built:
        bodies.setdefault(name.split("_")[0], []).append(name)

    print()
    for body, names in bodies.items():
        if len(names) < 2:
            continue
        # Cada bloco precisa estar longe do MAIS PARECIDO com ele: dois tons de
        # verde podem conviver desde que nenhum par fique indistinguível.
        avg = {n: average_color(built[n]) for n in names}
        for n in sorted(names):
            others = [(color_distance(avg[n], avg[m]), m) for m in names if m != n]
            gap, nearest = min(others)
            mark = "" if gap >= MIN_BODY_SEPARATION else "   <-- perto demais"
            print(f"  {body:6s} {n:22s} mais parecido com {nearest:22s} "
                  f"distância {gap:5.0f}{mark}")
            if gap < MIN_BODY_SEPARATION:
                failures.append(
                    f"{n} e {nearest} tem cor quase igual ({gap:.0f} < "
                    f"{MIN_BODY_SEPARATION}) — trocar de bloco nao desenharia mancha"
                )

    print(f"\n{len(TEXTURES)} texturas em {os.path.relpath(OUT, ROOT)}")
    if failures:
        print("FALHOU:\n  " + "\n  ".join(failures))
        raise SystemExit(1)
    print(f"todas em células {CELLS}x{CELLS}, {MIN_COLORS}-{MAX_COLORS} tons, "
          f"faixa interna <= {MAX_LUMA_RANGE}, separadas por >= "
          f"{MIN_BODY_SEPARATION}, sem viés de centro")
