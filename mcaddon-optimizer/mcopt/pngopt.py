"""Otimizacao de PNG sem perda (e, opcionalmente, com perda controlada).

Estrategia:
  1. Descarta chunks auxiliares (tEXt, iCCP, pHYs, tIME, eXIf...) que o
     Minecraft nunca le.
  2. Gera candidatos: re-encode no mesmo modo de cor e, quando a imagem tem
     <= 256 cores unicas, uma versao indexada (paleta) na menor profundidade
     de bits possivel (1/2/4/8 bpp).
  3. Recomprime o IDAT com zopfli, que costuma render 5-15% a mais que o
     deflate do zlib.
  4. VERIFICA: todo candidato so e aceito se a imagem redecodificada for
     identica pixel a pixel (RGBA) a original. Qualquer divergencia descarta
     o candidato.
  5. Devolve o menor entre original e candidatos aprovados.
"""

from __future__ import annotations

import io
import struct
import zlib

from PIL import Image

try:
    import zopfli.zlib as _zopfli

    HAVE_ZOPFLI = True
except ImportError:  # pragma: no cover
    HAVE_ZOPFLI = False

Image.MAX_IMAGE_PIXELS = None

PNG_SIG = b"\x89PNG\r\n\x1a\n"
# chunks que precisam sobreviver; o resto e descartavel para o jogo
KEEP_CHUNKS = {b"IHDR", b"PLTE", b"tRNS", b"IDAT", b"IEND"}
# se algum destes existir, a imagem e especial demais para reescrevermos
BAIL_CHUNKS = {b"acTL", b"fcTL", b"fdAT"}


def _deflate(data: bytes) -> bytes:
    """Stream zlib (com header e adler32), o mais forte disponivel.

    O IDAT do PNG carrega um datastream zlib completo -- nao deflate cru.
    """
    best = zlib.compress(data, 9)
    if HAVE_ZOPFLI:
        try:
            cand = _zopfli.compress(data, numiterations=15)
            if len(cand) < len(best):
                best = cand
        except Exception:
            pass
    return best


def _chunk(tag: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + tag
        + payload
        + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
    )


def iter_chunks(data: bytes):
    if not data.startswith(PNG_SIG):
        return
    pos = len(PNG_SIG)
    while pos + 8 <= len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        tag = data[pos + 4 : pos + 8]
        payload = data[pos + 8 : pos + 8 + length]
        yield tag, payload
        pos += 12 + length
        if tag == b"IEND":
            break


def _strip_and_recompress(data: bytes) -> bytes | None:
    """Mantem o encoding original, so limpa metadados e recomprime o IDAT."""
    chunks = list(iter_chunks(data))
    if not chunks:
        return None
    tags = {t for t, _ in chunks}
    if tags & BAIL_CHUNKS:
        return None

    idat = b"".join(p for t, p in chunks if t == b"IDAT")
    if not idat:
        return None
    try:
        raw = zlib.decompress(idat)
    except zlib.error:
        return None

    out = bytearray(PNG_SIG)
    wrote_idat = False
    for tag, payload in chunks:
        if tag not in KEEP_CHUNKS:
            continue
        if tag == b"IDAT":
            if not wrote_idat:
                out += _chunk(b"IDAT", _deflate(raw))
                wrote_idat = True
            continue
        out += _chunk(tag, payload)
    return bytes(out)


def _write_indexed(width, height, indices, palette, alphas, bit_depth) -> bytes:
    """Escreve um PNG indexado na profundidade de bits pedida, sem filtro.

    Filtro 0 (None) e o indicado para imagens de paleta: filtrar indices de
    cor gera ruido em vez de correlacao.
    """
    per_byte = 8 // bit_depth
    rows = bytearray()
    for y in range(height):
        rows.append(0)  # filter type None
        row = indices[y * width : (y + 1) * width]
        if bit_depth == 8:
            rows += bytes(row)
        else:
            packed = bytearray()
            acc = 0
            count = 0
            for value in row:
                acc = (acc << bit_depth) | value
                count += 1
                if count == per_byte:
                    packed.append(acc)
                    acc = 0
                    count = 0
            if count:
                packed.append(acc << (bit_depth * (per_byte - count)))
            rows += packed

    out = bytearray(PNG_SIG)
    out += _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, bit_depth, 3, 0, 0, 0))
    out += _chunk(b"PLTE", bytes(b for rgb in palette for b in rgb))
    if alphas is not None:
        out += _chunk(b"tRNS", bytes(alphas))
    out += _chunk(b"IDAT", _deflate(bytes(rows)))
    out += _chunk(b"IEND", b"")
    return bytes(out)


def _indexed_candidate(im: Image.Image) -> bytes | None:
    """Versao indexada sem perda, se a imagem couber em 256 cores."""
    rgba = im.convert("RGBA")
    counted = rgba.getcolors(256)
    if not counted:
        return None

    # opacos por ultimo: o chunk tRNS so precisa cobrir o prefixo transparente
    colors = sorted((c for _, c in counted), key=lambda c: (c[3] == 255, c))
    index_of = {c: i for i, c in enumerate(colors)}
    indices = [index_of[p] for p in rgba.getdata()]

    palette = [(r, g, b) for r, g, b, _ in colors]
    alpha_list = [a for *_, a in colors]
    last_transparent = -1
    for i, a in enumerate(alpha_list):
        if a != 255:
            last_transparent = i
    alphas = alpha_list[: last_transparent + 1] if last_transparent >= 0 else None

    count = len(colors)
    bit_depth = 8 if count > 16 else 4 if count > 4 else 2 if count > 2 else 1
    w, h = rgba.size
    return _write_indexed(w, h, indices, palette, alphas, bit_depth)


def _pillow_candidate(im: Image.Image) -> bytes | None:
    buf = io.BytesIO()
    try:
        im.save(buf, format="PNG", optimize=True, compress_level=9)
    except Exception:
        return None
    return _strip_and_recompress(buf.getvalue())


def _same_pixels(a: bytes, b: bytes) -> bool:
    try:
        with Image.open(io.BytesIO(a)) as ia, Image.open(io.BytesIO(b)) as ib:
            if ia.size != ib.size:
                return False
            return ia.convert("RGBA").tobytes() == ib.convert("RGBA").tobytes()
    except Exception:
        return False


def optimize(data: bytes, allow_indexed: bool = True) -> tuple[bytes, str]:
    """Devolve (bytes_otimizados, tecnica). Nunca perde pixels."""
    if not data.startswith(PNG_SIG):
        return data, "nao-png"

    try:
        with Image.open(io.BytesIO(data)) as probe:
            probe.load()
            im = probe.copy()
    except Exception:
        return data, "ilegivel"

    if {t for t, _ in iter_chunks(data)} & BAIL_CHUNKS:
        return data, "apng-preservado"

    candidates: list[tuple[bytes, str]] = []
    stripped = _strip_and_recompress(data)
    if stripped:
        candidates.append((stripped, "recompressao"))
    pillow = _pillow_candidate(im)
    if pillow:
        candidates.append((pillow, "reencode"))
    if allow_indexed:
        indexed = _indexed_candidate(im)
        if indexed:
            candidates.append((indexed, "paleta"))

    best, how = data, "inalterado"
    for blob, name in candidates:
        if len(blob) >= len(best):
            continue
        if not _same_pixels(data, blob):
            continue
        best, how = blob, name
    return best, how


def quantize(data: bytes, quality: str = "70-92", speed: int = 1) -> bytes | None:
    """Modo com perda: reduz para paleta de 256 cores via pngquant."""
    import subprocess

    try:
        proc = subprocess.run(
            ["pngquant", "--quality", quality, "--speed", str(speed),
             "--strip", "--force", "--output", "-", "-"],
            input=data, capture_output=True, timeout=120,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0 or not proc.stdout:
        return None
    return proc.stdout


def downscale(data: bytes, max_side: int) -> bytes | None:
    """Modo com perda: reduz a textura por fator inteiro, mantendo proporcao.

    Usa NEAREST de proposito -- arte de Minecraft e pixel art, e qualquer
    reamostragem suave borra a textura. O fator e inteiro para que a grade de
    pixels continue alinhada; flipbooks (tiras verticais) encolhem nos dois
    eixos pelo mesmo fator, preservando a contagem de quadros.
    """
    try:
        with Image.open(io.BytesIO(data)) as im:
            im.load()
            width, height = im.size
            short = min(width, height)
            if short <= max_side:
                return None
            factor = short // max_side
            while factor > 1 and (width % factor or height % factor):
                factor -= 1
            if factor < 2:
                return None
            resized = im.resize((width // factor, height // factor), Image.NEAREST)
            buf = io.BytesIO()
            resized.save(buf, format="PNG", optimize=True, compress_level=9)
    except Exception:
        return None
    return buf.getvalue()
