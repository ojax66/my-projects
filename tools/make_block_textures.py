#!/usr/bin/env python3
"""Gera as texturas 16x16 dos blocos dos corpos celestes.

Sem Pillow no ambiente, então tem um escritor de PNG aqui do lado (o mesmo de
make_textures.py). O ruído é PERIÓDICO: a rede de gradientes fecha em 16, então
a textura casa com ela mesma nos quatro lados e uma parede de blocos não mostra
emenda. Sem isso, uma esfera de 200 blocos vira um xadrez visível.

Cada bloco é um ruído fbm passado por uma rampa de cores. As rampas vieram de
foto: o oceano não é azul chapado, o regolito não é cinza chapado.
"""
import math
import os
import struct
import zlib

SIZE = 16
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "packs", "Space Dimension RP", "textures", "space_dim", "blocks")


# --- PNG ---------------------------------------------------------------------
def write_png(path, rows):
    h = len(rows)
    w = len(rows[0])
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


# --- Ruído periódico ---------------------------------------------------------
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
    """Ruído de valor que fecha em `period` — a textura casa nas bordas."""
    x0, y0 = math.floor(x), math.floor(y)
    sx, sy = _smooth(x - x0), _smooth(y - y0)
    n00 = _hash(x0, y0, period, seed)
    n10 = _hash(x0 + 1, y0, period, seed)
    n01 = _hash(x0, y0 + 1, period, seed)
    n11 = _hash(x0 + 1, y0 + 1, period, seed)
    ix0 = n00 + (n10 - n00) * sx
    ix1 = n01 + (n11 - n01) * sx
    return ix0 + (ix1 - ix0) * sy


def fbm(px, py, seed, octaves=4, base=2, persistence=0.5):
    """Soma de oitavas; cada uma com o dobro de detalhe e todas fechando em 16."""
    total = 0.0
    amp = 1.0
    max_amp = 0.0
    period = base
    for _ in range(octaves):
        if period > SIZE:
            break
        total += value_noise(px / SIZE * period, py / SIZE * period, period, seed) * amp
        max_amp += amp
        amp *= persistence
        period *= 2
        seed += 7919
    return total / max_amp if max_amp else 0.5


def turbulence(px, py, seed, octaves=4, base=2):
    """fbm com valor absoluto — dá os filamentos que o plasma do Sol precisa."""
    total = 0.0
    amp = 1.0
    max_amp = 0.0
    period = base
    for _ in range(octaves):
        if period > SIZE:
            break
        v = abs(value_noise(px / SIZE * period, py / SIZE * period, period, seed) - 0.5) * 2
        total += v * amp
        max_amp += amp
        amp *= persistence_const
        period *= 2
        seed += 7919
    return total / max_amp if max_amp else 0.5


persistence_const = 0.5


# --- Cor ---------------------------------------------------------------------
def ramp(t, stops):
    """Interpola uma lista [(posição, (r,g,b)), ...] já ordenada."""
    t = max(0.0, min(1.0, t))
    if t <= stops[0][0]:
        return stops[0][1]
    for i in range(1, len(stops)):
        p0, c0 = stops[i - 1]
        p1, c1 = stops[i]
        if t <= p1:
            k = (t - p0) / (p1 - p0) if p1 > p0 else 0
            return tuple(int(round(c0[j] + (c1[j] - c0[j]) * k)) for j in range(3))
    return stops[-1][1]


def speckle(px, py, seed, density, amount):
    """Grão fino por pixel — tira o aspecto de borrão liso das texturas."""
    v = _hash(px * 31 + 7, py * 17 + 3, 4096, seed)
    if v > 1 - density:
        return amount
    if v < density:
        return -amount
    return 0


def build(fn):
    rows = []
    for y in range(SIZE):
        row = []
        for x in range(SIZE):
            r, g, b = fn(x, y)
            row.append((max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)), 255))
        rows.append(row)
    return rows


def shade(color, delta):
    return tuple(int(max(0, min(255, c + delta))) for c in color)


# --- Texturas ----------------------------------------------------------------
# Cada função devolve a cor de um pixel. Os seeds são fixos: rodar de novo dá
# exatamente a mesma textura, então o PNG no git não muda à toa.

def sun_plasma(x, y):
    # Granulação: células claras com bordas escuras, como a fotosfera.
    cell = turbulence(x, y, 11, octaves=3, base=4)
    warm = fbm(x, y, 23, octaves=3, base=2)
    t = cell * 0.65 + warm * 0.35
    c = ramp(t, [
        (0.00, (255, 246, 214)),
        (0.30, (255, 206, 92)),
        (0.60, (255, 142, 26)),
        (0.85, (226, 88, 12)),
        (1.00, (168, 52, 8)),
    ])
    return shade(c, speckle(x, y, 31, 0.10, 12))


def sun_flare(x, y):
    # Região mais quente: quase branca no miolo dos filamentos.
    cell = turbulence(x, y, 47, octaves=3, base=4)
    t = cell ** 1.4
    c = ramp(t, [
        (0.00, (255, 255, 246)),
        (0.35, (255, 240, 170)),
        (0.70, (255, 198, 74)),
        (1.00, (255, 146, 30)),
    ])
    return shade(c, speckle(x, y, 53, 0.08, 10))


def sun_spot(x, y):
    # Mancha solar: umbra escura com a penumbra fibrosa em volta.
    #
    # Sem termo radial de propósito. Uma primeira versão usava a distância ao
    # centro DO BLOCO pra desenhar a umbra, e aí cada bloco ficava com a mesma
    # bolinha escura no meio: uma parede deles virava bolinha de polá. A forma
    # da mancha tem que vir do ruído, que é contínuo entre blocos vizinhos.
    fib = turbulence(x, y, 71, octaves=4, base=2)
    veil = fbm(x, y, 73, octaves=3, base=2)
    t = min(1.0, fib * 0.55 + veil * 0.45)
    c = ramp(t, [
        (0.00, (40, 18, 6)),
        (0.30, (68, 30, 10)),
        (0.60, (104, 50, 16)),
        (0.85, (150, 76, 22)),
        (1.00, (196, 108, 32)),
    ])
    return shade(c, speckle(x, y, 89, 0.10, 8))


def earth_ocean(x, y):
    # Azul profundo com veios um pouco mais claros — correntes, não xadrez.
    t = fbm(x, y, 101, octaves=4, base=2)
    c = ramp(t, [
        (0.00, (8, 26, 68)),
        (0.35, (12, 44, 106)),
        (0.65, (18, 68, 146)),
        (1.00, (30, 96, 178)),
    ])
    return shade(c, speckle(x, y, 103, 0.08, 7))


def earth_shallow(x, y):
    # Plataforma continental: turquesa, mais clara onde é raso.
    # Seed escolhido por busca (tools: varredura de viés centro/borda). O 107
    # original centralizava uma mancha clara no meio do bloco, e uma parede
    # dele repetia a mancha em cada bloco.
    t = fbm(x, y, 353, octaves=4, base=2)
    c = ramp(t, [
        (0.00, (26, 92, 150)),
        (0.40, (38, 132, 178)),
        (0.75, (62, 172, 196)),
        (1.00, (108, 206, 210)),
    ])
    return shade(c, speckle(x, y, 109, 0.08, 8))


def earth_land(x, y):
    # Vegetação: verdes variados com um toque de terra exposta.
    t = fbm(x, y, 113, octaves=4, base=2)
    c = ramp(t, [
        (0.00, (28, 66, 30)),
        (0.30, (44, 96, 40)),
        (0.58, (70, 124, 52)),
        (0.82, (104, 146, 66)),
        (1.00, (132, 152, 88)),
    ])
    return shade(c, speckle(x, y, 127, 0.11, 10))


def earth_desert(x, y):
    # Deserto e cordilheira: areia, ocre e rocha.
    t = fbm(x, y, 131, octaves=4, base=2)
    c = ramp(t, [
        (0.00, (128, 92, 52)),
        (0.32, (162, 122, 70)),
        (0.62, (196, 158, 100)),
        (1.00, (216, 186, 134)),
    ])
    return shade(c, speckle(x, y, 137, 0.12, 10))


def earth_ice(x, y):
    # Calota: branco com fendas levemente azuladas.
    t = fbm(x, y, 139, octaves=4, base=2)
    crack = turbulence(x, y, 149, octaves=3, base=4)
    c = ramp(t, [
        (0.00, (206, 224, 240)),
        (0.45, (228, 240, 250)),
        (1.00, (250, 253, 255)),
    ])
    if crack < 0.16:
        c = shade(c, -26)
    return shade(c, speckle(x, y, 151, 0.07, 6))


def moon_regolith(x, y):
    # Regolito: cinza claro empoeirado, com micro-crateras.
    t = fbm(x, y, 157, octaves=4, base=2)
    c = ramp(t, [
        (0.00, (124, 122, 118)),
        (0.35, (152, 150, 146)),
        (0.68, (178, 176, 171)),
        (1.00, (200, 198, 193)),
    ])
    # Crateras pequenas: pontos escuros com borda clara.
    cr = _hash(x * 13 + 5, y * 29 + 11, 4096, 163)
    if cr > 0.965:
        c = shade(c, -34)
    elif cr > 0.94:
        c = shade(c, 18)
    return shade(c, speckle(x, y, 167, 0.10, 9))


def moon_highland(x, y):
    # Terras altas: a parte mais clara e mais craterada da Lua.
    t = fbm(x, y, 229, octaves=4, base=2)
    c = ramp(t, [
        (0.00, (166, 163, 157)),
        (0.35, (190, 187, 181)),
        (0.70, (210, 207, 201)),
        (1.00, (226, 223, 217)),
    ])
    cr = _hash(x * 19 + 3, y * 11 + 7, 4096, 233)
    if cr > 0.955:
        c = shade(c, -40)
    elif cr > 0.925:
        c = shade(c, 14)
    return shade(c, speckle(x, y, 239, 0.10, 9))


def moon_mare(x, y):
    # Mare: basalto escuro, bem mais liso que o regolito.
    t = fbm(x, y, 173, octaves=3, base=2)
    c = ramp(t, [
        (0.00, (54, 54, 58)),
        (0.40, (72, 72, 77)),
        (0.75, (92, 92, 97)),
        (1.00, (110, 110, 114)),
    ])
    return shade(c, speckle(x, y, 179, 0.08, 7))


def mars_dust(x, y):
    # Poeira marciana: laranja-avermelhado, grão fino.
    t = fbm(x, y, 341, octaves=4, base=2)
    c = ramp(t, [
        (0.00, (124, 56, 30)),
        (0.32, (158, 78, 40)),
        (0.62, (188, 104, 56)),
        (1.00, (212, 136, 84)),
    ])
    return shade(c, speckle(x, y, 191, 0.12, 10))


def mars_rock(x, y):
    # Rocha basáltica: ferrugem escura com grãos quase pretos.
    t = fbm(x, y, 193, octaves=4, base=2)
    c = ramp(t, [
        (0.00, (74, 34, 24)),
        (0.35, (102, 48, 32)),
        (0.68, (128, 64, 42)),
        (1.00, (150, 82, 54)),
    ])
    g = _hash(x * 7 + 1, y * 23 + 9, 4096, 197)
    if g > 0.955:
        c = shade(c, -28)
    return shade(c, speckle(x, y, 199, 0.10, 9))


def mars_ice(x, y):
    # Calota de gelo seco: branco puxando pro rosado da poeira.
    t = fbm(x, y, 211, octaves=4, base=2)
    c = ramp(t, [
        (0.00, (216, 202, 196)),
        (0.45, (234, 224, 218)),
        (1.00, (250, 246, 242)),
    ])
    return shade(c, speckle(x, y, 223, 0.08, 7))


TEXTURES = {
    "sun_plasma": sun_plasma,
    "sun_flare": sun_flare,
    "sun_spot": sun_spot,
    "earth_ocean": earth_ocean,
    "earth_shallow": earth_shallow,
    "earth_land": earth_land,
    "earth_desert": earth_desert,
    "earth_ice": earth_ice,
    "moon_regolith": moon_regolith,
    "moon_highland": moon_highland,
    "moon_mare": moon_mare,
    "mars_dust": mars_dust,
    "mars_rock": mars_rock,
    "mars_ice": mars_ice,
}


def average_color(rows):
    n = len(rows) * len(rows[0])
    r = sum(px[0] for row in rows for px in row) // n
    g = sum(px[1] for row in rows for px in row) // n
    b = sum(px[2] for row in rows for px in row) // n
    return f"#{r:02X}{g:02X}{b:02X}"


def seam_error(rows):
    """Quanto a borda esquerda difere da direita (e topo do fundo).

    Serve de teste: ruído periódico de verdade fecha com erro baixo. Se isso
    subir, a esfera vai mostrar emenda entre blocos vizinhos.
    """
    n = len(rows)
    horiz = sum(
        abs(rows[y][0][c] - rows[y][n - 1][c]) for y in range(n) for c in range(3)
    ) / (n * 3)
    vert = sum(
        abs(rows[0][x][c] - rows[n - 1][x][c]) for x in range(n) for c in range(3)
    ) / (n * 3)
    return max(horiz, vert)


def center_bias(rows):
    """Brilho médio do miolo menos o da borda.

    Se um bloco é claramente mais escuro (ou mais claro) no centro, uma parede
    dele mostra a mesma marca repetida em cada bloco — o efeito bolinha. O
    detalhe tem que vir do ruído, que atravessa a fronteira entre blocos.
    """
    n = len(rows)
    def lum(px):
        return 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2]
    mid = [rows[y][x] for y in range(n // 4, 3 * n // 4) for x in range(n // 4, 3 * n // 4)]
    edge = [rows[y][x] for y in range(n) for x in range(n)
            if x < n // 4 or x >= 3 * n // 4 or y < n // 4 or y >= 3 * n // 4]
    return abs(sum(map(lum, mid)) / len(mid) - sum(map(lum, edge)) / len(edge))


if __name__ == "__main__":
    colors = {}
    worst_seam = 0
    worst_bias = 0
    failures = []
    for name, fn in TEXTURES.items():
        rows = build(fn)
        write_png(os.path.join(OUT, f"{name}.png"), rows)
        colors[name] = average_color(rows)
        seam = seam_error(rows)
        bias = center_bias(rows)
        worst_seam = max(worst_seam, seam)
        worst_bias = max(worst_bias, bias)
        flag = ""
        if bias > 14:
            flag = "  <-- efeito bolinha"
            failures.append(name)
        print(f"  {name:16s} cor média {colors[name]}  emenda {seam:5.1f}  centro {bias:5.1f}{flag}")
    print(f"\n{len(TEXTURES)} texturas em {os.path.relpath(OUT, ROOT)}")
    print(f"pior emenda entre bordas opostas: {worst_seam:.1f} de 255")
    print(f"pior viés centro/borda: {worst_bias:.1f} de 255 (limite 14)")
    if failures:
        print("FALHOU: " + ", ".join(failures))
        raise SystemExit(1)
