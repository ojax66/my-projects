"""Generates the small PNG assets the pack needs (no Pillow available here)."""
import math, os, random, struct, zlib

def write_png(path, w, h, pixels):
    """pixels: list of rows, each row a list of (r,g,b,a) tuples."""
    raw = b"".join(b"\x00" + bytes(v for px in row for v in px) for row in pixels)
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(png)

def star_texture(size=16):
    """A soft round white dot that fades out at the edge."""
    c = (size - 1) / 2.0
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            d = math.hypot(x - c, y - c) / (size / 2.0)
            a = max(0.0, 1.0 - d) ** 1.6
            row.append((255, 255, 255, int(round(255 * a))))
        rows.append(row)
    return rows

# O ÍCONE DO PACK É DELE: tools/assets/pack_icon.png.
#
# Aqui havia um ícone DESENHADO EM CÓDIGO (céu preto, um sol no canto, uma
# Terra e estrelas espalhadas). Ele funcionava como marca d'água enquanto o
# addon não tinha arte, e virou um bug quando passou a ter: todo build
# reescrevia o ícone dele por cima do procedural, sem avisar nada. Foi assim
# que o ícone que ele mandou sumiu do pack — descoberto comparando o .mcaddon
# que ele editou à mão com o que sai daqui.
#
# Agora é cópia, e o validador confere que os dois packs têm o arquivo dele.
PACK_ICON = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "tools", "assets", "pack_icon.png")


if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    write_png(os.path.join(root, "packs/Galactic Horizons RP/textures/gh/star.png"), 16, 16, star_texture())
    import shutil
    for p in ("packs/Galactic Horizons BP/pack_icon.png",
              "packs/Galactic Horizons RP/pack_icon.png"):
        shutil.copyfile(PACK_ICON, os.path.join(root, p))
    print("textures written; pack_icon copiado de tools/assets/pack_icon.png")
