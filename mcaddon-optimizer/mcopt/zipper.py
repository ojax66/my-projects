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


_PRECOMPUTED: bytes | None = None

# Tipos que ja carregam entropia alta. Vale tentar deflate neles mesmo assim
# (as vezes rende 1-2%, e 1% de 23 MB de audio ainda e 230 KB), mas com zlib
# rapido em vez de zopfli: o ganho extra do zopfli aqui nao paga o tempo.
FAST_TYPES = (".png", ".ogg", ".jpg", ".jpeg", ".zip", ".mp3", ".fsb", ".wav")


class _PrecomputedCompressor:
    """Devolve um payload deflate ja calculado, sem recomprimir."""

    def compress(self, data: bytes) -> bytes:
        return b""

    def flush(self, mode: int = zlib.Z_FINISH) -> bytes:
        global _PRECOMPUTED
        out = _PRECOMPUTED or b""
        _PRECOMPUTED = None
        return out


class _patch_compressor:
    """Faz o zipfile usar o payload pre-calculado em vez do zlib."""

    def __enter__(self):
        self._original = zipfile._get_compressor

        def patched(compress_type, compresslevel=None):
            if compress_type == zipfile.ZIP_DEFLATED and _PRECOMPUTED is not None:
                return _PrecomputedCompressor()
            return self._original(compress_type, compresslevel)

        zipfile._get_compressor = patched
        return self

    def __exit__(self, *exc):
        zipfile._get_compressor = self._original
        return False


def best_deflate(data: bytes, strong: bool, iterations: int = 15) -> bytes:
    """Deflate cru, o menor que conseguirmos produzir."""
    best = zlib.compress(data, 9)[2:-4]
    if strong and HAVE_ZOPFLI:
        try:
            # [2:-4] tira header zlib e adler32 -> deflate cru, que e o que
            # uma entrada de ZIP armazena.
            candidate = _zopfli.compress(data, numiterations=iterations)[2:-4]
            if len(candidate) < len(best):
                best = candidate
        except Exception:
            pass
    return best


def write_archive(path, entries, use_zopfli: bool = True, iterations: int = 15) -> None:
    """Grava `entries` -- lista de (nome_no_zip, bytes) -- em `path`.

    Para cada arquivo, comprime e so entao decide: se o deflate nao ficou
    menor que o original, grava STORED. Decidir por extensao, sem medir,
    custa caro -- arquivos como .fsb parecem comprimidos mas nao sao.
    """
    global _PRECOMPUTED
    with _patch_compressor():
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
            for name, data in entries:
                strong = use_zopfli and not name.lower().endswith(FAST_TYPES)
                payload = best_deflate(data, strong, iterations) if data else b""
                info = zipfile.ZipInfo(name)
                info.external_attr = 0o644 << 16
                if not data or len(payload) >= len(data):
                    info.compress_type = zipfile.ZIP_STORED
                    _PRECOMPUTED = None
                else:
                    info.compress_type = zipfile.ZIP_DEFLATED
                    _PRECOMPUTED = payload
                zf.writestr(info, data)
                _PRECOMPUTED = None


def verify_archive(path, expected: dict[str, bytes]) -> list[str]:
    """Reabre o arquivo e confere byte a byte. Devolve lista de problemas."""
    problems: list[str] = []
    try:
        with zipfile.ZipFile(path) as zf:
            bad = zf.testzip()
            if bad:
                problems.append(f"CRC invalido em {bad}")
            names = set(zf.namelist())
            for name in sorted(set(expected) - names):
                problems.append(f"faltando no pacote: {name}")
            for name in sorted(names - set(expected)):
                problems.append(f"sobrando no pacote: {name}")
            for name in sorted(names & set(expected)):
                if zf.read(name) != expected[name]:
                    problems.append(f"conteudo divergente: {name}")
    except Exception as exc:
        problems.append(f"pacote ilegivel: {exc}")
    return problems
