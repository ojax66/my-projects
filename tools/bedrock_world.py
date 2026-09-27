"""Leitura mínima de mundos Bedrock (LevelDB) usada pelo export_build.py.

Dependências: pip install amulet-leveldb amulet-nbt==2.1.5 numpy
"""
import struct

import amulet_nbt as N
import leveldb
import numpy as np


def open_db(path):
    return leveldb.LevelDB(path)


def nbt_at(data, off):
    """Lê uma tag NBT little-endian em data[off:] e devolve (tag, novo_offset)."""
    ctx = N.ReadContext()
    t = N.load(bytes(data[off:]), compressed=False, little_endian=True,
               read_context=ctx, string_decoder=N.utf8_escape_decoder)
    return t, off + ctx.offset


def load_multi(data):
    """Lê várias tags NBT concatenadas (block entities, actors)."""
    out, off = [], 0
    while off < len(data):
        t, off = nbt_at(data, off)
        out.append(t)
    return out


def parse_subchunk(data):
    """Decodifica um SubChunkPrefix (versões 1, 8 e 9).

    Devolve (y, [(indices, palette), ...]) — uma entrada por camada.
    `indices` tem 4096 posições na ordem do Bedrock: (x * 16 + z) * 16 + y.
    """
    ver = data[0]
    off, y = 1, None
    if ver == 1:
        layer_count = 1
    elif ver in (8, 9):
        layer_count, off = data[1], 2
        if ver == 9:
            y, off = struct.unpack('b', data[2:3])[0], 3
    else:
        raise ValueError('versão de subchunk não suportada: %d' % ver)

    layers = []
    for _ in range(layer_count):
        bits = data[off] >> 1
        off += 1
        if bits == 0:
            idx = np.zeros(4096, dtype=np.int32)
            count = 1
        else:
            per = 32 // bits
            nwords = (4096 + per - 1) // per
            words = np.frombuffer(data, dtype='<u4', count=nwords, offset=off)
            off += nwords * 4
            shifts = np.arange(per, dtype=np.uint32) * bits
            idx = ((words[:, None] >> shifts[None, :]) & ((1 << bits) - 1)).reshape(-1)[:4096].astype(np.int32)
            count = struct.unpack('<i', data[off:off + 4])[0]
            off += 4
        pal = []
        for _ in range(count):
            t, off = nbt_at(data, off)
            pal.append(t)
        layers.append((idx, pal))
    return y, layers
