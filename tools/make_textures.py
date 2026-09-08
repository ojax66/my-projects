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

def pack_icon(size=128):
    """Black sky, a warm sun in the corner, a blue earth and a scatter of stars."""
    rng = random.Random(7)
    rows = [[(4, 4, 12, 255) for _ in range(size)] for _ in range(size)]
    for _ in range(90):
        x, y = rng.randrange(size), rng.randrange(size)
        b = rng.randint(150, 255)
        rows[y][x] = (b, b, b, 255)
    def disc(cx, cy, r, inner, outer, glow=0):
        for y in range(size):
            for x in range(size):
                d = math.hypot(x - cx, y - cy)
                if d <= r:
                    t = d / r
                    col = tuple(int(inner[i] + (outer[i] - inner[i]) * t) for i in range(3))
                    rows[y][x] = col + (255,)
                elif glow and d <= r + glow:
                    t = (d - r) / glow
                    a = (1 - t) ** 2
                    old = rows[y][x]
                    col = tuple(int(old[i] + (outer[i] - old[i]) * a * 0.75) for i in range(3))
                    rows[y][x] = col + (255,)
    disc(24, 26, 26, (255, 250, 210), (255, 140, 20), glow=22)   # sun
    disc(88, 88, 26, (90, 190, 255), (10, 60, 150))              # earth
    for _ in range(150):                                          # continents
        a, rr = rng.random() * math.tau, rng.random() * 24
        x, y = int(88 + math.cos(a) * rr), int(88 + math.sin(a) * rr)
        if 0 <= x < size and 0 <= y < size and math.hypot(x - 88, y - 88) <= 26:
            if math.sin(x * 0.16) + math.cos(y * 0.19) > 0.55:
                rows[y][x] = (60, 150, 70, 255)
    return rows

if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    write_png(os.path.join(root, "packs/New Horizons RP/textures/space_dim/star.png"), 16, 16, star_texture())
    icon = pack_icon()
    for p in ("packs/New Horizons BP/pack_icon.png", "packs/New Horizons RP/pack_icon.png"):
        write_png(os.path.join(root, p), 128, 128, icon)
    print("textures written")
