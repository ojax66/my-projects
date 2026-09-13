"""Escrita de .mcaddon/.mcpack com a maior compressao possivel.

Usa o zipfile da stdlib (portanto cabecalhos, CRCs e o directory central sao
gerados pelo codigo testado do Python) mas troca o compressor deflate por
zopfli, que produz um stream deflate valido e tipicamente 3-8% menor.
"""

from __future__ import annotations

import zipfile
import zlib

try:
    import zopfli.zlib as _zopfli

    HAVE_ZOPFLI = True
except ImportError:  # pragma: no cover
    HAVE_ZOPFLI = False


class _ZopfliCompressor:
    """Adaptador com a interface de zlib.compressobj usada pelo zipfile."""

    def __init__(self, iterations: int = 15):
        self._buf = bytearray()
        self._iterations = iterations

    def compress(self, data: bytes) -> bytes:
        self._buf += data
        return b""

    def flush(self, mode: int = zlib.Z_FINISH) -> bytes:
        data = bytes(self._buf)
        self._buf.clear()
        fallback = zlib.compress(data, 9)[2:-4]
        try:
            # [2:-4] descarta header zlib e adler32 -> deflate cru, que e o
            # que uma entrada de ZIP armazena.
            candidate = _zopfli.compress(data, numiterations=self._iterations)[2:-4]
        except Exception:
            return fallback
        return candidate if len(candidate) < len(fallback) else fallback


class zopfli_deflate:
    """Context manager que faz o zipfile comprimir com zopfli."""

    def __init__(self, enabled: bool = True, iterations: int = 15):
        self.enabled = enabled and HAVE_ZOPFLI
        self.iterations = iterations
        self._original = None

    def __enter__(self):
        if not self.enabled:
            return self
        self._original = zipfile._get_compressor
        iterations = self.iterations

        def patched(compress_type, compresslevel=None):
            if compress_type == zipfile.ZIP_DEFLATED:
                return _ZopfliCompressor(iterations)
            return self._original(compress_type, compresslevel)

        zipfile._get_compressor = patched
        return self

    def __exit__(self, *exc):
        if self._original is not None:
            zipfile._get_compressor = self._original
        return False


def write_archive(path, entries, use_zopfli: bool = True, iterations: int = 15) -> None:
    """Grava `entries` -- lista de (nome_no_zip, bytes) -- em `path`.

    Arquivos que ja sao containers comprimidos (png/ogg/etc) entram como
    STORED: recomprimi-los gasta CPU e normalmente aumenta o tamanho.
    """
    precompressed = (".png", ".ogg", ".fsb", ".jpg", ".jpeg", ".zip", ".mp3", ".wav")
    with zopfli_deflate(use_zopfli, iterations):
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
            for name, data in entries:
                lowered = name.lower()
                if lowered.endswith(precompressed):
                    info = zipfile.ZipInfo(name)
                    info.compress_type = zipfile.ZIP_STORED
                    info.external_attr = 0o644 << 16
                    zf.writestr(info, data)
                else:
                    info = zipfile.ZipInfo(name)
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o644 << 16
                    zf.writestr(info, data)


def verify_archive(path, expected: dict[str, bytes]) -> list[str]:
    """Reabre o arquivo e confere byte a byte. Devolve lista de problemas."""
    problems: list[str] = []
    try:
        with zipfile.ZipFile(path) as zf:
            bad = zf.testzip()
            if bad:
                problems.append(f"CRC invalido em {bad}")
            names = set(zf.namelist())
            missing = set(expected) - names
            extra = names - set(expected)
            for name in sorted(missing):
                problems.append(f"faltando no pacote: {name}")
            for name in sorted(extra):
                problems.append(f"sobrando no pacote: {name}")
            for name in sorted(names & set(expected)):
                if zf.read(name) != expected[name]:
                    problems.append(f"conteudo divergente: {name}")
    except Exception as exc:
        problems.append(f"pacote ilegivel: {exc}")
    return problems
