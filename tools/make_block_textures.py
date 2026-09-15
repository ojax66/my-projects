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



# --- Chão: a estatística da areia --------------------------------------------
#
# Duas tentativas erradas antes desta, e as duas eram sobre o número errado.
#
#   1ª  cinco tons espalhados por 41 de luma, colocados por ruído de valor.
#       O ruído faz MANCHAS, e a mancha é do tamanho do bloco: uma planície de
#       um bloco só repete a mesma mancha lado a lado e o olho lê a grade.
#       Virou papel de parede quadriculado.
#   2ª  os mesmos cinco tons comprimidos pra 19 de luma. Sumiu a grade e sumiu
#       tudo: um borrão liso, que ele chamou de "extremamente artificial".
#
# Os dois erros são o mesmo erro: mexer no CONTRASTE achando que o problema era
# o contraste. Não era. O problema é a ESTRUTURA — o que a areia tem e o ruído
# de valor não dá é grão SOLTO.
#
# Uma foto de areia, ou de regolito, é isto:
#
#   um corpo quase uniforme (três tons quase iguais, faixa curta)
#   + grãos escuros SOLTOS, um aqui outro ali, nunca encostados
#   + alguns brilhos claros, do mesmo jeito
#
# É por isso que a areia do jogo funciona e o ruído de valor não: o grão da
# areia não forma desenho nenhum, então não há desenho pra se repetir de bloco
# em bloco — mas há o que ver de perto. Contraste ALTO com estrutura SOLTA lê
# como areia; contraste baixo com estrutura em mancha lê como plástico.
#
# A regra "nunca encostados" é o que garante isso, e ela vale ATRAVESSANDO a
# borda do bloco (a vizinhança é calculada em módulo), senão dois grãos de
# blocos vizinhos se juntariam numa manchinha na emenda.
def mix(cor, fator):
    """A mesma cor, mais clara ou mais escura por FATOR, não por soma.

    Multiplicativo de propósito: somar -30 num tom claro é um grão discreto e no
    tom mais escuro do addon (a ardósia de ferrita, luma 42) seria quase preto.
    Multiplicar dá o mesmo contraste RELATIVO em todos, que é como o olho lê.
    """
    return "#%02X%02X%02X" % tuple(
        max(0, min(255, round(c * fator))) for c in hex_rgb(cor))


# Os fatores do chão. Curtos de propósito: o corpo quase não varia, e o que se
# vê são os grãos.
BODY_STEPS = (0.985, 1.0, 1.015)
GRAIN_STEPS = (0.87, 0.81)
SPARK_STEPS = (1.05, 1.09)


def build_sand(centro, seed, grain_frac=0.12, spark_frac=0.07):
    """Uma textura de CHÃO: corpo liso salpicado de grãos.

    `centro` é o tom médio do bloco — o mesmo de antes, então a cor do bloco
    visto de longe não muda. O resto sai dele por multiplicação.
    """
    cols = [hex_rgb(mix(centro, f)) + (255,) for f in BODY_STEPS]
    graos = [hex_rgb(mix(centro, f)) + (255,) for f in GRAIN_STEPS]
    brilhos = [hex_rgb(mix(centro, f)) + (255,) for f in SPARK_STEPS]

    # O corpo: hash puro por célula, sem ruído de valor nenhum. É de propósito —
    # o ruído de valor é justamente o que faz mancha do tamanho do bloco.
    vals = sorted((_hash(cx, cy, 4096, seed), cx, cy)
                  for cy in range(CELLS) for cx in range(CELLS))
    cells = [[None] * CELLS for _ in range(CELLS)]
    fatia = len(vals) // len(cols)
    for i, (_, cx, cy) in enumerate(vals):
        cells[cy][cx] = cols[min(i // fatia, len(cols) - 1)]

    ocupadas = set()

    def espalha(tons, fracao, chave):
        alvo = round(CELLS * CELLS * fracao)
        postas = 0
        for _, cx, cy in sorted((_hash(cx, cy, 4096, seed + chave), cx, cy)
                                for cy in range(CELLS) for cx in range(CELLS)):
            if postas >= alvo:
                break
            if (cx, cy) in ocupadas:
                continue
            ocupadas.add((cx, cy))
            k = int(_hash(cx, cy, 4096, seed + chave + 5) * len(tons)) % len(tons)
            cells[cy][cx] = tons[k]
            postas += 1

    # Sorteio livre, sem regra de "não encostar". A regra deixava os grãos numa
    # malha quase regular — dava pra ver a treliça. Deixando livre, de vez em
    # quando dois se juntam, que é o que um grão um pouco maior parece.
    espalha(graos, grain_frac, 7717)
    espalha(brilhos, spark_frac, 3391)

    rows = []
    for cy in range(CELLS):
        line = []
        for cx in range(CELLS):
            line.extend([cells[cy][cx]] * CELL_PX)
        for _ in range(CELL_PX):
            rows.append(list(line))
    return rows


# O tom MÉDIO de cada bloco de chão — o mesmo de sempre, que é o que o bloco
# parece de longe. Tudo o mais sai dele.
# Só MARTE. A Lua tem textura escolhida — ver LUA_ESCOLHIDA logo abaixo.
GROUND = {
    "mars_dust": ("#BA4E2A", 318),
    "mars_rock": ("#923D22", 664),
    "mars_rock_dark": ("#501E10", 209),
    "mars_ice": ("#E2D7CF", 123),
}


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



    # --- Marte ---------------------------------------------------------------
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

# E o CHÃO é medido por ESTRUTURA, não por contraste.
#
# Duas tentativas erradas antes desta, e as duas mexeram no número errado:
#
#   1ª  cinco tons por 41 de luma, colocados por ruído de valor. O ruído faz
#       MANCHA do tamanho do bloco, e a mancha se repete lado a lado: papel de
#       parede quadriculado.
#   2ª  os mesmos tons comprimidos pra 19 de luma. Sumiu a grade e sumiu tudo:
#       um borrão liso, "extremamente artificial".
#
# O contraste não era o problema nas duas vezes — a ESTRUTURA era. Areia tem
# contraste ALTO e estrutura SOLTA: um corpo quase uniforme salpicado de grãos
# que não formam desenho nenhum. Sem desenho, não há o que se repetir de bloco
# em bloco, e ainda assim há o que ver de perto.
#
# Então o que é medido aqui é isso, e não a faixa total:
#
#   MAX_BODY_RANGE   o CORPO (os tons que cobrem a maior parte) tem que ser
#                    quase uniforme — é ele que não pode desenhar nada;
#   MAX_GRAIN_CLUMP  nenhum aglomerado de grãos pode virar mancha.
MAX_BODY_RANGE = 12
MAX_GRAIN_CLUMP = 6
MAX_COLORS_GROUND = 8


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


def body_range(rows):
    """Faixa de luma dos tons que formam o CORPO da textura.

    Corpo = os tons mais comuns até cobrir 60% dos pixels. Os grãos ficam de
    fora por serem poucos, que é exatamente a distinção que interessa.
    """
    conta = {}
    for row in rows:
        for px in row:
            conta[px[:3]] = conta.get(px[:3], 0) + 1
    total = sum(conta.values())
    lums = []
    acc = 0
    for cor, n in sorted(conta.items(), key=lambda kv: -kv[1]):
        lums.append((cor[0] + cor[1] + cor[2]) / 3)
        acc += n
        if acc >= total * 0.6:
            break
    return max(lums) - min(lums)


def grain_clump(rows):
    """Maior aglomerado contíguo de células mais escuras que o corpo.

    Grão é grão: um, dois, no máximo um tropeço de três juntos. Um aglomerado
    grande é uma mancha — e mancha é o que se repete em cada bloco.
    """
    n = len(rows)
    lum = lambda p: (p[0] + p[1] + p[2]) / 3
    todos = sorted({lum(px) for row in rows for px in row})
    if len(todos) < 3:
        return 0
    # "escuro" = abaixo do tom mais escuro do corpo. O corpo são os 3 tons do
    # meio da lista; os grãos são os de baixo.
    corte = todos[1] + 1e-6
    escuro = [[lum(rows[y][x]) <= corte for x in range(n)] for y in range(n)]

    visto = [[False] * n for _ in range(n)]
    maior = 0
    for y0 in range(n):
        for x0 in range(n):
            if not escuro[y0][x0] or visto[y0][x0]:
                continue
            pilha = [(x0, y0)]
            visto[y0][x0] = True
            tam = 0
            while pilha:
                x, y = pilha.pop()
                tam += 1
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    # Em módulo: o bloco encosta nele mesmo, então um grão na
                    # borda direita é vizinho de um na borda esquerda.
                    nx, ny = (x + dx) % n, (y + dy) % n
                    if escuro[ny][nx] and not visto[ny][nx]:
                        visto[ny][nx] = True
                        pilha.append((nx, ny))
            maior = max(maior, tam)
    # em células, não em pixels
    return maior / (CELL_PX * CELL_PX)


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
             + [(n, "chão") for n in GROUND])
    for name, tipo in todos:
        if tipo == "lua":
            rows = moon_from_source(fonte_lua, MOON_LAYERS[name])
        elif tipo == "chão":
            centro, seed = GROUND[name]
            rows = build_sand(centro, seed)
        else:
            pal, w, seed, clump, jitter = TEXTURES[name]
            rows = build(pal, w, seed, clump, jitter)
        write_png(os.path.join(OUT, f"{name}.png"), rows)

        nc = distinct_colors(rows)
        bias = center_bias(rows)
        rng = luma_range(rows)
        built[name] = rows
        flags = []
        if nc > (MAX_COLORS_GROUND if tipo == "chão" else MAX_COLORS):
            flags.append("cores demais")
        if nc < MIN_COLORS:
            flags.append(f"cores de menos (<{MIN_COLORS})")
        if bias > MAX_BIAS:
            flags.append("efeito bolinha")
        if tipo == "chão":
            corpo = body_range(rows)
            aglomerado = grain_clump(rows)
            if corpo > MAX_BODY_RANGE:
                flags.append(f"o corpo do chão desenha ({corpo:.0f} > {MAX_BODY_RANGE}) "
                             f"— num chão de um bloco só, desenho vira papel de parede")
            if aglomerado > MAX_GRAIN_CLUMP:
                flags.append(f"aglomerado de {aglomerado:.0f} células (> {MAX_GRAIN_CLUMP}) "
                             f"— isso é mancha, não grão, e se repete em cada bloco")
        elif rng > MAX_LUMA_RANGE:
            flags.append(f"contraste alto demais ({rng:.0f} > {MAX_LUMA_RANGE}) — "
                         f"a mancha escura se repete no planeta inteiro")
        if not is_chunky(rows):
            flags.append(f"grão fino demais (não está na grade de {CELLS}x{CELLS})")
        if flags:
            failures.append(f"{name}: {', '.join(flags)}")
        extra = (f" corpo {body_range(rows):4.0f} grão {grain_clump(rows):3.0f}"
                 if tipo == "chão" else "")
        print(f"  {name:22s} {nc:5d} {rng:6.0f} {average_color(rows):>8s} {bias:7.1f}{extra}"
              + ("   <-- " + "; ".join(flags) if flags else ""))

    # --- a poeira da Lua é o desenho DELE, sem uma vírgula mudada ------------
    ref = read_png(os.path.join(REF_DIR, MOON_SOURCE))
    got = built["moon_regolith_light"]
    difs = sum(1 for y in range(len(ref)) for x in range(len(ref[0]))
               if tuple(got[y * 2][x * 2]) != ref[y][x])
    if difs:
        failures.append(
            f"moon_regolith_light não bate com {MOON_SOURCE} ({difs} pixels) — "
            f"esse desenho é dele; não é pra mexer")
    else:
        print(f"\n  a poeira da Lua bate pixel a pixel com {MOON_SOURCE}")

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
