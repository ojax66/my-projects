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
import json
import math
import os
import struct
import zlib

# 32x32, não 16x16.
#
# A folha de contato que mandei pra revisão mostrava cada textura repetida 2x2
# — quatro blocos por quadro. O padrão aprovado ali era, portanto, o dobro do
# que cabia num bloco: no jogo cada bloco mostrava um QUARTO daquele desenho.
#
# Dobrando a textura, um bloco passa a mostrar o quadro inteiro, e a célula
# continua com 2 pixels de lado — o pixel grosso não muda, o que muda é quanto
# padrão cabe em cada bloco.
SIZE = 32
# Lado da grade de desenho. 16 células em 32 pixels = cada célula é um quadrado
# 2x2, o mesmo pixel grosso do print de referência.
CELLS = 16
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




TEXTURES = {
    # --- Sol -----------------------------------------------------------------
    # Rampa do sol de referência (#FFD64A / #FFFFA9 / #FFFFD9), fatiada em três
    # camadas. Cada bloco fica dentro da sua fatia: a diferença coroa → plasma →
    # núcleo é entre BLOCOS, não dentro de nenhum deles.
    # Os seis tons do disco solar, do vermelho da borda ao branco do miolo. As
    # cores saem da referência que o autor mandou, amostrada do centro pra
    # quina. Cada bloco continua com variação interna sutil: o degradê é feito
    # pela TROCA de bloco, como os mares da Lua.
    "sun_edge": (
        ["#93290A", "#9E2D0B", "#AA300B", "#B6340C", "#C2380D"],
        [2, 3, 4, 3, 2], 263, 3, 0.40,
    ),
    "sun_corona": (
        ["#D64E11", "#E35313", "#F05914", "#F76216", "#FD6B1B"],
        [2, 3, 4, 3, 2], 742, 3, 0.40,
    ),
    "sun_ember": (
        ["#E88C18", "#F5961D", "#FFA123", "#FFAC33", "#FFB744"],
        [2, 3, 4, 3, 2], 354, 3, 0.40,
    ),
    "sun_plasma": (
        ["#F5CE4B", "#FAD657", "#FFDF64", "#FFE677", "#FFED8A"],
        [2, 3, 4, 3, 2], 354, 3, 0.40,
    ),
    "sun_flare": (
        ["#F3DE8A", "#F9E592", "#FEEC9A", "#FFF1AD", "#FFF6C0"],
        [2, 3, 4, 3, 2], 190, 3, 0.38,
    ),
    # Mesma cor do núcleo, papel oposto: este é o miolo claro da casca externa,
    # e ele é atravessável.
    "sun_blaze": (
        ["#FFF4C8", "#FFF8DC", "#FFFDF1", "#FFFEF8", "#FFFFFF"],
        [2, 3, 4, 3, 2], 863, 3, 0.38,
    ),
    "sun_core": (
        ["#FFF4C8", "#FFF8DC", "#FFFDF1", "#FFFEF8", "#FFFFFF"],
        [2, 3, 4, 3, 2], 863, 3, 0.38,
    ),

    # --- Terra ---------------------------------------------------------------
    # Oceano, plataforma, continente, floresta e gelo já SÃO cinco blocos: é a
    # troca entre eles que desenha os continentes. Dentro de cada um, só a
    # granulação.
    "earth_ocean": (
        ["#05327C", "#063E93", "#0847A5", "#0A51B4", "#0D5AC2"],
        [2, 3, 4, 3, 2], 259, 3, 0.44,
    ),
    "earth_shallow": (
        ["#045C79", "#056C91", "#06769E", "#0781AB", "#088BB8"],
        [2, 3, 4, 3, 2], 810, 3, 0.44,
    ),
    "earth_land": (
        ["#026E00", "#038500", "#049200", "#059F00", "#06AC0A"],
        [2, 3, 4, 3, 2], 665, 3, 0.46,
    ),
    "earth_forest": (
        ["#014A02", "#026002", "#026C02", "#037803", "#048404"],
        [2, 3, 4, 3, 2], 294, 3, 0.46,
    ),
    "earth_ice": (
        ["#D6DFEE", "#E8EFFA", "#EFF4FD", "#F6F9FF", "#FFFFFF"],
        [2, 3, 4, 3, 2], 40, 3, 0.42,
    ),



    # --- Marte ----------------------------------------------------------------
    # ELE ESCOLHEU ESTAS TRÊS. Mandou os arquivos; conferi que o gerador as
    # reproduz pixel a pixel com estes parâmetros, então não entrou PNG solto:
    # tools/assets/ref_mars_*.png são a conferência, e o build falha se mudarem.
    "mars_dust": (
        ["#B24A27", "#B74C29", "#BA4E2A", "#BE522D", "#C15730"],
        [2, 3, 4, 3, 2], 318, 3, 0.45,
    ),
    "mars_rock": (
        ["#8B3A20", "#8F3C21", "#923D22", "#964024", "#9A4326"],
        [2, 3, 4, 3, 2], 664, 3, 0.45,
    ),
    "mars_rock_dark": (
        ["#4A1C0F", "#4D1D0F", "#501E10", "#542011", "#572213"],
        [2, 3, 4, 3, 2], 664, 3, 0.45,
    ),
    # O gelo segue a mesma receita, pra a família de Marte ser uma família só.
    "mars_ice": (
        ["#DBCFC6", "#DFD4CC", "#E2D7CF", "#E5DBD3", "#E9DFD8"],
        [2, 3, 4, 3, 2], 123, 3, 0.42,
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

# Pares que dividem a mesma cor DE PROPÓSITO.
#
# `sun_blaze` e `sun_core` são o mesmo branco: o que muda entre eles não é a
# aparência, é a colisão. Um é o miolo claro da casca externa, que tem que ser
# atravessável; o outro é o chão maciço lá no meio do Sol. O jogador nunca vê os
# dois lado a lado — estão separados por setenta e oito blocos de Sol.
#
# A exceção é declarada aqui, e não afrouxando o limiar: baixar o limiar pra
# caber este par deixaria passar dois tons de verde que deveriam ser distintos.
SAME_COLOR_ON_PURPOSE = {
    frozenset({"sun_blaze", "sun_core"}),
}


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


# ---------------------------------------------------------------------------
# MINÉRIOS
#
# A textura de um minério é a PEDRA DO PRÓPRIO PLANETA com grãos do metal por
# cima. Não é escolha estética: minério do jogo base tem textura de pedra do
# Overworld, e um bloco de pedra cinza no meio do regolito ou da ferrita
# denunciaria na hora que ele veio de outro lugar.
#
# Os grãos são colocados na mesma grade grossa do resto (2x2 pixels), em
# aglomerados de 2 a 4 células — é assim que minério do jogo se parece, e é o
# que impede o grão de virar chuvisco.
ORE_SPECKS = 13          # quantas células de metal, de 256
ORE_CLUSTER = 3          # até quantas células vizinhas cada aglomerado toma


def build_ore(base_rows, cor, seed):
    """A pedra do planeta com grãos de metal por cima."""
    rows = [list(r) for r in base_rows]
    metal = hex_rgb(cor) + (255,)
    # uma versão mais escura, pra o grão ter volume em vez de ser um adesivo
    sombra = tuple(max(0, round(c * 0.72)) for c in hex_rgb(cor)) + (255,)

    postas = set()
    ordem = sorted((_hash(cx, cy, 4096, seed), cx, cy)
                   for cy in range(CELLS) for cx in range(CELLS))
    for h, cx, cy in ordem:
        if len(postas) >= ORE_SPECKS:
            break
        if (cx, cy) in postas:
            continue
        # um aglomerado: a célula e alguns vizinhos dela
        quantas = 1 + int(_hash(cx, cy, 4096, seed + 31) * ORE_CLUSTER)
        vizinhos = [(0, 0), (1, 0), (0, 1), (1, 1), (-1, 0), (0, -1)]
        for i in range(min(quantas, len(vizinhos))):
            if len(postas) >= ORE_SPECKS:
                break
            dx, dy = vizinhos[i]
            nx, ny = (cx + dx) % CELLS, (cy + dy) % CELLS
            if (nx, ny) in postas:
                continue
            postas.add((nx, ny))
            # a borda de baixo do aglomerado fica na cor de sombra
            cor_cel = sombra if (i and i % 3 == 0) else metal
            for py in range(ny * CELL_PX, (ny + 1) * CELL_PX):
                for px in range(nx * CELL_PX, (nx + 1) * CELL_PX):
                    rows[py][px] = cor_cel
    return rows


# id do minério → (bloco de base, cor do metal, seed)
#
# Onde cada um mora está em planets.js, junto com a faixa de profundidade e a
# raridade. Aqui só existe a aparência.
ORES = {
    "moon_iron_ore":     ("moon_regolith", "#D8AF93", 811),
    "moon_gold_ore":     ("moon_regolith", "#FCEE4B", 412),
    "moon_redstone_ore": ("moon_regolith_dark", "#C62D28", 157),
    "moon_diamond_ore":  ("moon_regolith_dark", "#4AEDD9", 933),
    "mars_iron_ore":     ("mars_rock", "#D8AF93", 244),
    "mars_copper_ore":   ("mars_rock", "#E0734D", 655),
    "mars_gold_ore":     ("mars_rock_dark", "#FCEE4B", 388),
    "mars_diamond_ore":  ("mars_rock_dark", "#4AEDD9", 701),
}


# ---------------------------------------------------------------------------
# A LUA É DESENHADA POR ELE
#
# Depois de cinco versões minhas, ele pegou a última, escureceu a paleta,
# reduziu pra 16x16 e mexeu à mão em 11% das células (conferido: 89% delas
# mantêm o mesmo posto de tom que a minha). O arquivo dele é a FONTE — não é
# gerado aqui, é copiado:
#
#   tools/assets/ref_moon_regolith_light.png   →   moon_regolith_light
#
# As outras duas camadas saem do MESMO desenho, com os tons multiplicados pros
# patamares de pedra e de ardósia. Assim a família inteira tem o traço dele, e
# não o meu misturado com o dele.
#
# Os fatores vêm da rampa original da Lua: pedra 0,733 e ardósia 0,419 do tom
# claro (154/210 e 88/210 nos centros de antes).
MOON_SOURCE = "ref_moon_regolith_light.png"
MOON_LAYERS = {
    "moon_regolith_light": 1.0,
    "moon_regolith": 0.733,
    "moon_regolith_dark": 0.419,
}


def moon_from_source(rows, fator):
    """O desenho dele, com os tons multiplicados — e dobrado pra 32x32.

    Dobrar é por segurança de atlas: todo o resto do pacote é 32x32, e misturar
    resoluções no mesmo atlas de terreno é pedir pro motor reescalar alguma
    coisa com filtro. Vizinho-mais-próximo em 2x é pixel a pixel idêntico ao
    arquivo dele — cada pixel vira um quadrado 2x2, que é o mesmo "pixel grosso"
    do resto do pacote.
    """
    n = len(rows)
    out = []
    for y in range(n):
        linha = []
        for x in range(n):
            px = rows[y][x]
            cor = tuple(max(0, min(255, round(c * fator))) for c in px[:3]) + (255,)
            linha.extend([cor, cor])
        out.append(linha)
        out.append(list(linha))
    return out


# O arquivo que ele escolheu, guardado. A conferência abaixo é o que impede
# esta textura de ser "melhorada" de novo: ela já passou por quatro versões e a
# quinta foi ele que mandou.
REF_DIR = os.path.join(ROOT, "tools", "assets")


def read_png(path):
    """Lê um PNG RGBA de 8 bits como lista de linhas de tuplas."""
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
    data = zlib.decompress(idat)
    stride = w * 4
    out = []
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
        out.append([tuple(line[x:x + 4]) for x in range(0, stride, 4)])
        prev = line
    return out


if __name__ == "__main__":
    failures = []
    built = {}
    print(f"  {'bloco':22s} {'cores':>5s} {'faixa':>6s} {'média':>8s} {'centro':>7s}")
    fonte_lua = read_png(os.path.join(REF_DIR, MOON_SOURCE))

    todos = ([(n, "corpo") for n in TEXTURES]
             + [(n, "lua") for n in MOON_LAYERS]
             + [(n, "minério") for n in ORES])
    for name, tipo in todos:
        if tipo == "lua":
            rows = moon_from_source(fonte_lua, MOON_LAYERS[name])
        elif tipo == "minério":
            base, cor, seed = ORES[name]
            rows = build_ore(built[base], cor, seed)
        else:
            pal, w, seed, clump, jitter = TEXTURES[name]
            rows = build(pal, w, seed, clump, jitter)
        write_png(os.path.join(OUT, f"{name}.png"), rows)

        nc = distinct_colors(rows)
        bias = center_bias(rows)
        rng = luma_range(rows)
        built[name] = rows
        flags = []
        if tipo == "minério":
            # O grão de metal é o ponto: ele TEM que destoar da pedra, senão
            # ninguém enxerga o minério. As checagens de "não pode ter mancha
            # escura" são sobre a pedra, e a pedra dele já passou por elas.
            print(f"  {name:22s} {nc:5d} {rng:6.0f} {average_color(rows):>8s} {bias:7.1f}")
            continue
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

    # --- as texturas que ELE escolheu, sem uma vírgula mudada ----------------
    #
    # A da Lua ele desenhou (16x16, dobrada aqui pra 32x32); as três de Marte
    # ele escolheu entre as que eu tinha gerado. Nos dois casos o arquivo dele é
    # a autoridade, e o build falha se o gerador sair diferente.
    print()
    ref = read_png(os.path.join(REF_DIR, MOON_SOURCE))
    got = built["moon_regolith_light"]
    difs = sum(1 for y in range(len(ref)) for x in range(len(ref[0]))
               if tuple(got[y * 2][x * 2]) != ref[y][x])
    if difs:
        failures.append(f"moon_regolith_light não bate com {MOON_SOURCE} "
                        f"({difs} pixels) — esse desenho é dele; não é pra mexer")
    else:
        print(f"  a poeira da Lua bate pixel a pixel com {MOON_SOURCE}")

    for name in ("mars_dust", "mars_rock", "mars_rock_dark"):
        arquivo = f"ref_{name}.png"
        ref = read_png(os.path.join(REF_DIR, arquivo))
        got = built[name]
        difs = sum(1 for y in range(len(ref)) for x in range(len(ref[0]))
                   if tuple(got[y][x]) != ref[y][x])
        if difs:
            failures.append(f"{name} não bate com {arquivo} ({difs} pixels) — "
                            f"essa textura foi escolhida por ele")
        else:
            print(f"  {name} bate pixel a pixel com {arquivo}")

    # --- separação entre os blocos de cada corpo -----------------------------
    # É a troca de bloco que desenha o planeta. Dois blocos do mesmo corpo com
    # luma parecida não produzem mancha nenhuma: o gerador troca e nada muda.
    # Os MINÉRIOS ficam de fora desta conferência, e de propósito.
    #
    # Ela existe pra garantir que trocar de bloco na superfície de um corpo
    # celeste desenhe uma mancha visível de longe — por isso mede a cor MÉDIA.
    # Um minério é a pedra do planeta com alguns grãos de metal: a média dele é
    # quase a da pedra, e tem que ser. O que distingue um minério não é a média,
    # são os grãos; e nenhum minério é usado no desenho de corpo nenhum.
    bodies = {}
    for name in built:
        if name in ORES:
            continue
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
            others = [o for o in others
                      if frozenset({n, o[1]}) not in SAME_COLOR_ON_PURPOSE]
            if not others:
                continue
            gap, nearest = min(others)
            mark = "" if gap >= MIN_BODY_SEPARATION else "   <-- perto demais"
            print(f"  {body:6s} {n:22s} mais parecido com {nearest:22s} "
                  f"distância {gap:5.0f}{mark}")
            if gap < MIN_BODY_SEPARATION:
                failures.append(
                    f"{n} e {nearest} tem cor quase igual ({gap:.0f} < "
                    f"{MIN_BODY_SEPARATION}) — trocar de bloco nao desenharia mancha"
                )

    # Cor média de cada textura, num JSON à parte.
    #
    # Quem desenha os corpos vistos de longe (tools/make_sky_bodies.mjs) usa
    # isto pra pintar cada bloco da superfície. Tem que ser a média da TEXTURA
    # de verdade, não o `map_color` declarado à mão: era esse o descompasso que
    # fazia o planeta de longe não bater com o de perto.
    colors_path = os.path.join(ROOT, "tools", "assets", "block_colors.json")
    os.makedirs(os.path.dirname(colors_path), exist_ok=True)
    with open(colors_path, "w", encoding="utf-8") as f:
        json.dump({f"space_dim:{n}": average_color(rows) for n, rows in built.items()},
                  f, indent=2)
        f.write("\n")

    print(f"\n{len(TEXTURES)} texturas em {os.path.relpath(OUT, ROOT)}")
    if failures:
        print("FALHOU:\n  " + "\n  ".join(failures))
        raise SystemExit(1)
    print(f"todas em células {CELLS}x{CELLS}, {MIN_COLORS}-{MAX_COLORS} tons, "
          f"faixa interna <= {MAX_LUMA_RANGE}, separadas por >= "
          f"{MIN_BODY_SEPARATION}, sem viés de centro")
