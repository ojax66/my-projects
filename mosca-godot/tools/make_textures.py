#!/usr/bin/env python3
"""Gera as texturas do projeto (botoes de movimento, folhas, casca de arvore).

Uso: python3 tools/make_textures.py   (requer Pillow)
"""
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
UI = ROOT / "assets/ui"
TEX = ROOT / "assets/textures"
S = 4  # supersampling
SIZE = 112


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def rounded_button(state):
    """Botao arredondado estilo 'folha envernizada' com brilho e sombra."""
    w = SIZE * S
    img = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    pad = 8 * S
    off = 3 * S if state == "pressed" else 0
    # sombra
    sh = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle(
        (pad, pad + 6 * S, w - pad, w - pad + 6 * S - off), radius=26 * S, fill=(0, 0, 0, 110 if state != "pressed" else 60)
    )
    sh = sh.filter(ImageFilter.GaussianBlur(5 * S))
    img.alpha_composite(sh)
    top = {"normal": (120, 196, 96), "hover": (150, 222, 120), "pressed": (84, 150, 70)}[state]
    bot = {"normal": (36, 102, 52), "hover": (48, 124, 64), "pressed": (28, 78, 40)}[state]
    body = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    for y in range(w):
        t = y / w
        bd.line([(0, y), (w, y)], fill=lerp(top, bot, t) + (255,))
    mask = Image.new("L", (w, w), 0)
    ImageDraw.Draw(mask).rounded_rectangle((pad, pad + off, w - pad, w - pad - 2 * S + off), radius=26 * S, fill=255)
    # veio de folha sutil
    veins = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    vd = ImageDraw.Draw(veins)
    for i in range(-6, 7):
        x0 = w / 2 + i * 14 * S
        vd.line([(x0, w), (x0 + 40 * S, 0)], fill=(255, 255, 255, 14), width=3 * S)
    body.alpha_composite(veins)
    img.paste(body, (0, 0), mask)
    # borda
    ImageDraw.Draw(img).rounded_rectangle(
        (pad, pad + off, w - pad, w - pad - 2 * S + off), radius=26 * S, outline=(20, 50, 24, 255), width=3 * S
    )
    # brilho superior
    gl = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    ImageDraw.Draw(gl).rounded_rectangle(
        (pad + 8 * S, pad + 6 * S + off, w - pad - 8 * S, w / 2 - 4 * S + off), radius=20 * S, fill=(255, 255, 255, 60 if state != "pressed" else 25)
    )
    gl = gl.filter(ImageFilter.GaussianBlur(2 * S))
    img.alpha_composite(gl)
    return img, off


def arrow_poly(kind, c, s):
    """Poligonos (em coordenadas normalizadas -1..1) para cada icone."""
    if kind in ("forward", "back", "left", "right"):
        base = [(0, -0.62), (0.55, 0.02), (0.22, 0.02), (0.22, 0.58), (-0.22, 0.58), (-0.22, 0.02), (-0.55, 0.02)]
        ang = {"forward": 0, "right": 90, "back": 180, "left": 270}[kind]
        return [rot(base, ang)]
    if kind in ("up", "down"):
        ch = [(-0.55, 0.05), (0, -0.45), (0.55, 0.05), (0.55, 0.3), (0, -0.18), (-0.55, 0.3)]
        a = [(x, y - 0.18) for x, y in ch]
        b = [(x, y + 0.32) for x, y in ch]
        if kind == "down":
            a = [(x, -y) for x, y in a]
            b = [(x, -y) for x, y in b]
        return [a, b]
    return []


def rot(pts, deg):
    r = math.radians(deg)
    return [(x * math.cos(r) - y * math.sin(r), x * math.sin(r) + y * math.cos(r)) for x, y in pts]


def draw_arc_arrow(d, cx, cy, rad, clockwise, s, color, width):
    start, end = (200, 470) if clockwise else (70, 340)
    bbox = (cx - rad, cy - rad, cx + rad, cy + rad)
    d.arc(bbox, start=start if clockwise else start, end=end, fill=color, width=width)
    a = math.radians(end if clockwise else start)
    tip = (cx + rad * math.cos(a), cy + rad * math.sin(a))
    tang = a + (math.pi / 2 if clockwise else -math.pi / 2)
    hl = 0.32 * rad
    p1 = (tip[0] + hl * math.cos(tang), tip[1] + hl * math.sin(tang))
    n = a
    p2 = (tip[0] + 0.45 * hl * math.cos(n), tip[1] + 0.45 * hl * math.sin(n))
    p3 = (tip[0] - 0.45 * hl * math.cos(n), tip[1] - 0.45 * hl * math.sin(n))
    d.polygon([p1, p2, p3], fill=color)


def make_icon_button(kind, state):
    img, off = rounded_button(state)
    w = SIZE * S
    cx, cy = w / 2, w / 2 + off - S
    sc = 30 * S
    layer = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    col = (255, 252, 230, 255)
    if kind in ("turn_left", "turn_right"):
        draw_arc_arrow(d, cx, cy, 26 * S, kind == "turn_right", S, col, 9 * S)
    else:
        for poly in arrow_poly(kind, (cx, cy), sc):
            d.polygon([(cx + x * sc, cy + y * sc) for x, y in poly], fill=col)
    shadow = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    shadow.paste((10, 40, 16, 150), (0, 0), layer.split()[3])
    shadow = shadow.filter(ImageFilter.GaussianBlur(2 * S))
    img.alpha_composite(shadow, (0, 2 * S))
    img.alpha_composite(layer)
    return img.resize((SIZE, SIZE), Image.LANCZOS)


def make_panel_button(state):
    """Textura 9-patch (160x64) para botoes de texto, mesmo estilo dos direcionais."""
    w, h = 160 * S, 64 * S
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    pad = 4 * S
    off = 2 * S if state == "pressed" else 0
    sh = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((pad, pad + 4 * S, w - pad, h - pad), radius=16 * S, fill=(0, 0, 0, 100))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(3 * S)))
    top = {"normal": (120, 196, 96), "hover": (150, 222, 120), "pressed": (84, 150, 70)}[state]
    bot = {"normal": (36, 102, 52), "hover": (48, 124, 64), "pressed": (28, 78, 40)}[state]
    body = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    for y in range(h):
        bd.line([(0, y), (w, y)], fill=lerp(top, bot, y / h) + (255,))
    mask = Image.new("L", (w, h), 0)
    box = (pad, pad + off, w - pad, h - pad - 4 * S + off)
    ImageDraw.Draw(mask).rounded_rectangle(box, radius=16 * S, fill=255)
    img.paste(body, (0, 0), mask)
    ImageDraw.Draw(img).rounded_rectangle(box, radius=16 * S, outline=(20, 50, 24, 255), width=2 * S)
    gl = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(gl).rounded_rectangle((pad + 6 * S, pad + 4 * S + off, w - pad - 6 * S, h / 2 + off), radius=12 * S, fill=(255, 255, 255, 55 if state != "pressed" else 20))
    img.alpha_composite(gl.filter(ImageFilter.GaussianBlur(2 * S)))
    return img.resize((160, 64), Image.LANCZOS)


def make_leaf():
    w, h = 256, 256
    img = Image.new("RGBA", (w * 2, h * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pts = []
    for i in range(0, 181):
        t = i / 180
        y = 2 * h * (0.04 + 0.92 * t)
        width = math.sin(math.pi * t) ** 0.8 * (0.36 + 0.06 * math.sin(t * 9)) * 2 * w
        pts.append((w - width, y))
    pts += [(2 * w - x, y) for x, y in reversed(pts)]
    for yy in range(2 * h):
        t = yy / (2 * h)
        d.line([(0, yy), (2 * w, yy)], fill=lerp((170, 210, 90), (60, 130, 40), t) + (255,))
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).polygon(pts, fill=255)
    vein = ImageDraw.Draw(img)
    vein.line([(w, 2 * h * 0.02), (w, 2 * h * 0.97)], fill=(210, 230, 150, 255), width=7)
    for i in range(1, 9):
        y = 2 * h * (0.1 + i * 0.095)
        for sgn in (-1, 1):
            vein.line([(w, y), (w + sgn * w * 0.55 * math.sin(math.pi * i / 10), y - 60)], fill=(180, 215, 120, 255), width=4)
    img.putalpha(mask)
    return img.resize((w, h), Image.LANCZOS)


def make_bark():
    w = h = 256
    random.seed(3)
    img = Image.new("RGB", (w, h), (92, 66, 46))
    d = ImageDraw.Draw(img)
    for _ in range(900):
        x = random.randrange(w)
        y = random.randrange(h)
        l = random.randint(12, 70)
        c = random.randint(-28, 22)
        col = (92 + c, 66 + c, 46 + c // 2)
        d.line([(x, y), (x + random.randint(-3, 3), y + l)], fill=col, width=random.randint(1, 4))
        d.line([(x, y - h), (x, y - h + l)], fill=col, width=2)
    return img.filter(ImageFilter.GaussianBlur(0.6))


def main():
    UI.mkdir(parents=True, exist_ok=True)
    TEX.mkdir(parents=True, exist_ok=True)
    for kind in ("forward", "back", "left", "right", "up", "down", "turn_left", "turn_right"):
        for state in ("normal", "hover", "pressed"):
            make_icon_button(kind, state).save(UI / f"btn_{kind}_{state}.png")
    for state in ("normal", "hover", "pressed"):
        make_panel_button(state).save(UI / f"panel_{state}.png")
    make_leaf().save(TEX / "leaf.png")
    make_bark().save(TEX / "bark.png")
    print("texturas geradas")


if __name__ == "__main__":
    main()
