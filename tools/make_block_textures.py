#!/usr/bin/env python3
"""Gera as texturas 16x16 dos blocos dos corpos celestes, no estilo do jogo.

A primeira versão era ruído fbm passado por rampas de cor contínuas: bonito de
perto, mas com dezenas de tons e gradiente suave — cara de render, não de
Minecraft. Textura de bloco do jogo é o contrário disso: **poucas cores
chapadas**, sem gradiente, e o ruído aparece como mancha de pixel, não como
degradê.

Então aqui cada textura é só duas coisas:

  1. uma PALETA curta (3 a 5 tons) e as proporções de cada tom;
  2. um ruído grosso que decide qual tom cai em cada pixel.

O pixel recebe a cor por RANKING, não por limiar: os 256 valores são ordenados
e fatiados nas proporções pedidas. Assim a proporção sai exata em toda textura
e nenhuma fica lavada ou escura demais por azar do ruído.

As paletas vieram das referências que o usuário mandou — a da Lua é literalmente
a do print dele (#D9E4FF … #505666).
"""
import math
import os
import struct
import zlib

SIZE = 16
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "packs", "New Horizons RP", "textures", "space_dim", "blocks")


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
    """Uma textura de bloco.

    palette : lista de cores "#RRGGBB", da mais escura pra mais clara (ou a
              ordem que fizer sentido pro bloco)
    weights : proporção de cada cor; normalizada aqui
    clump   : quantas células de ruído cabem nos 16 px. 3-4 dá mancha grossa,
              tipo pedra do jogo; 8 dá grão fino, tipo areia.
    jitter  : quanto de sorteio por pixel entra na conta. 0 deixa manchas de
              borda lisa (parece plástico); alto demais vira chuvisco.
    """
    cols = [hex_rgb(c) for c in palette]

    vals = []
    for y in range(SIZE):
        for x in range(SIZE):
            n = value_noise(x / SIZE * clump, y / SIZE * clump, clump, seed)
            j = _hash(x, y, 4096, seed + 977)
            vals.append((n * (1 - jitter) + j * jitter, x, y))

    # Cor por ranking: garante a proporção exata pedida em weights.
    vals.sort(key=lambda v: v[0])
    total = sum(weights)
    rows = [[None] * SIZE for _ in range(SIZE)]
    i = 0
    for idx, w in enumerate(weights):
        take = round(len(vals) * w / total) if idx < len(weights) - 1 else len(vals) - i
        for _, x, y in vals[i:i + take]:
            rows[y][x] = cols[idx] + (255,)
        i += take
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
    "sun_corona": (
        ["#B87708", "#D18F12", "#E8A317", "#F5B82B"],
        [1, 3, 4, 2], 353, 3, 0.42,
    ),
    "sun_plasma": (
        ["#E8A317", "#F5B82B", "#FFCB2E", "#FFD84D"],
        [1, 3, 4, 2], 101, 3, 0.42,
    ),
    "sun_core": (
        ["#FFCB2E", "#FFE55C", "#FFF7A0", "#FFFBD0"],
        [1, 2, 4, 3], 31, 3, 0.40,
    ),

    # --- Terra ---------------------------------------------------------------
    "earth_ocean": (
        ["#062C6E", "#0A3A8C", "#0049A6", "#0B57C4"],
        [2, 4, 3, 1], 41, 4, 0.45,
    ),
    "earth_shallow": (
        ["#00506E", "#006386", "#0A7FA8", "#1596C0"],
        [2, 4, 3, 1], 340, 4, 0.45,
    ),
    "earth_land": (
        ["#036E02", "#048400", "#068D00", "#00A200"],
        [2, 4, 3, 1], 61, 4, 0.48,
    ),
    "earth_forest": (
        ["#01430A", "#025C00", "#036E02", "#048400"],
        [2, 4, 3, 1], 71, 4, 0.48,
    ),
    "earth_ice": (
        ["#C6D4EC", "#DDE7F8", "#EEF4FF", "#FFFFFF"],
        [1, 3, 4, 2], 83, 4, 0.42,
    ),

    # --- Lua (paleta da referência) -----------------------------------------
    "moon_regolith_light": (
        ["#AFB8CC", "#C6D0E8", "#D9E4FF", "#E6EEFF"],
        [2, 4, 3, 1], 477, 4, 0.46,
    ),
    "moon_regolith": (
        ["#747D93", "#9097A5", "#AFB8CC", "#C6D0E8"],
        [2, 4, 3, 1], 103, 4, 0.46,
    ),
    "moon_regolith_dark": (
        ["#41465A", "#505666", "#5F677A", "#747D93"],
        [2, 4, 3, 1], 109, 4, 0.46,
    ),

    # --- Marte ---------------------------------------------------------------
    "mars_dust": (
        ["#A8451F", "#B94A2C", "#C1522A", "#D16438"],
        [2, 4, 3, 1], 127, 4, 0.47,
    ),
    "mars_rock": (
        ["#7A2F19", "#8E3A21", "#A04628", "#B04E2E"],
        [2, 4, 3, 1], 137, 4, 0.47,
    ),
    "mars_rock_dark": (
        ["#3F1710", "#4A1B0E", "#5C2312", "#6E2C18"],
        [2, 4, 3, 1], 149, 4, 0.47,
    ),
    "mars_ice": (
        ["#C9BBB1", "#D9CCC4", "#E8DCD4", "#F5EEE8"],
        [1, 3, 4, 2], 157, 4, 0.42,
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


if __name__ == "__main__":
    failures = []
    print(f"  {'bloco':22s} {'cores':>5s} {'média':>8s} {'centro':>7s}")
    for name, (pal, w, seed, clump, jitter) in TEXTURES.items():
        rows = build(pal, w, seed, clump, jitter)
        write_png(os.path.join(OUT, f"{name}.png"), rows)

        nc = distinct_colors(rows)
        bias = center_bias(rows)
        flags = []
        if nc > MAX_COLORS:
            flags.append(f"cores demais (>{MAX_COLORS})")
        if bias > MAX_BIAS:
            flags.append("efeito bolinha")
        if flags:
            failures.append(f"{name}: {', '.join(flags)}")
        print(f"  {name:22s} {nc:5d} {average_color(rows):>8s} {bias:7.1f}"
              + ("   <-- " + "; ".join(flags) if flags else ""))

    print(f"\n{len(TEXTURES)} texturas em {os.path.relpath(OUT, ROOT)}")
    if failures:
        print("FALHOU:\n  " + "\n  ".join(failures))
        raise SystemExit(1)
    print(f"todas com no máximo {MAX_COLORS} cores e sem viés de centro")
