"""Exporta a construção do RAMNeighbourhood.mcworld para arquivos .mcstructure.

Uso:
    python3 tools/export_build.py <pasta_do_mundo_extraido> rick01_BP

O quadrado vem dos prints (cantos -278,244 / -293,-242 / 173,210 / 203,-278),
na altura do mundo plano (Y -64 até -23, onde termina a construção). Ele é
cortado em blocos de 64x64 (limite prático de estrutura) e gravado em
<BP>/structures/rick01/tile_I_J.mcstructure, mais a tabela de posições em
<BP>/scripts/rick01/tiles.js.

Na dimensão rick:01 o centro do quadrado fica em X 0 / Z 0 e o chão de grama
(Y -61 no mundo original) fica em Y 106, então quem é teleportado para
0 107 0 aparece em pé no gramado.
"""
import json
import os
import struct
import sys

import numpy as np
import amulet_nbt as N
from amulet_nbt import CompoundTag, IntTag, ListTag, NamedTag, StringTag

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bedrock_world import load_multi, open_db, parse_subchunk  # noqa: E402

WORLD, BP = sys.argv[1], sys.argv[2]

X0, X1, Z0, Z1 = -293, 203, -278, 244
Y0, Y1 = -64, -23
SX, SY, SZ = X1 - X0 + 1, Y1 - Y0 + 1, Z1 - Z0 + 1
TILE = 64
# deslocamento mundo original -> rick:01
OFF_X, OFF_Y, OFF_Z = -((X0 + X1) // 2), 106 - (-61), -((Z0 + Z1) // 2)
ENTITY_TYPES = ('minecraft:armor_stand', 'minecraft:chest_minecart', 'minecraft:painting')
BLOCK_VERSION = IntTag(18168865)

pal_keys, palette = {}, []


def block(name):
    return CompoundTag({'name': StringTag(name), 'states': CompoundTag(), 'version': BLOCK_VERSION})


def pidx(c):
    k = c.to_snbt()
    i = pal_keys.get(k)
    if i is None:
        i = pal_keys[k] = len(palette)
        palette.append(CompoundTag({'name': c['name'], 'states': c.get('states', CompoundTag()),
                                    'version': c.get('version', BLOCK_VERSION)}))
    return i


AIR = pidx(block('minecraft:air'))
FLAT = [pidx(block(n)) for n in ('minecraft:stone', 'minecraft:dirt', 'minecraft:dirt', 'minecraft:grass_block')]

L0 = np.full((SX, SY, SZ), AIR, dtype=np.int32)
L1 = np.full((SX, SY, SZ), -1, dtype=np.int32)
seen = np.zeros((SX, SZ), dtype=bool)
block_entities, entities = [], []

db = open_db(os.path.join(WORLD, 'db'))
for k, v in db.iterate():
    if len(k) == 10 and k[8] == 47:  # SubChunkPrefix do overworld
        cx, cz = struct.unpack('<ii', k[:8])
        sy = struct.unpack('b', k[9:10])[0]
        bx, by, bz = cx * 16, sy * 16, cz * 16
        if bx + 15 < X0 or bx > X1 or bz + 15 < Z0 or bz > Z1 or by + 15 < Y0 or by > Y1:
            continue
        _, layers = parse_subchunk(v)
        # recorte da interseção subchunk x caixa
        ax0, ax1 = max(bx, X0), min(bx + 15, X1)
        az0, az1 = max(bz, Z0), min(bz + 15, Z1)
        ay0, ay1 = max(by, Y0), min(by + 15, Y1)
        seen[ax0 - X0:ax1 - X0 + 1, az0 - Z0:az1 - Z0 + 1] = True
        for li, (idx, pal) in enumerate(layers[:2]):
            gmap = np.array([pidx(p.compound) for p in pal], dtype=np.int32)
            a = gmap[idx].reshape(16, 16, 16)  # x, z, y
            if li == 1:
                a = np.where(a == AIR, -1, a)
            part = a[ax0 - bx:ax1 - bx + 1, az0 - bz:az1 - bz + 1, ay0 - by:ay1 - by + 1].transpose(0, 2, 1)
            (L0 if li == 0 else L1)[ax0 - X0:ax1 - X0 + 1, ay0 - Y0:ay1 - Y0 + 1, az0 - Z0:az1 - Z0 + 1] = part
    elif len(k) == 9 and k[8] == 49:  # BlockEntity do overworld
        for t in load_multi(v):
            c = t.compound
            x, y, z = int(c['x']), int(c['y']), int(c['z'])
            if X0 <= x <= X1 and Y0 <= y <= Y1 and Z0 <= z <= Z1:
                block_entities.append(c)
    elif k.startswith(b'digp') and len(k) == 12:  # entidades do overworld
        for i in range(0, len(v), 8):
            try:
                a = db.get(b'actorprefix' + v[i:i + 8])
            except KeyError:
                continue
            c = load_multi(a)[0].compound
            if c['identifier'].py_str not in ENTITY_TYPES:
                continue
            p = [float(q) for q in c['Pos']]
            if X0 <= p[0] < X1 + 1 and Y0 <= p[1] < Y1 + 1 and Z0 <= p[2] < Z1 + 1:
                entities.append(c)

# Chunks nunca gerados dentro do quadrado viram o chão plano normal.
for i, n in enumerate(FLAT):
    L0[:, i, :][~seen] = n
# A camada de bedrock do mundo plano vira pedra (senão fica bedrock no meio do terreno).
is_bedrock = np.array([p['name'].py_str == 'minecraft:bedrock' for p in palette])
L0[:, 0, :][is_bedrock[L0[:, 0, :]]] = FLAT[0]

out_dir = os.path.join(BP, 'structures', 'rick01')
os.makedirs(out_dir, exist_ok=True)
tiles = []
for ti in range((SX + TILE - 1) // TILE):
    for tj in range((SZ + TILE - 1) // TILE):
        ox, oz = ti * TILE, tj * TILE
        sx, sz = min(TILE, SX - ox), min(TILE, SZ - oz)
        b0 = L0[ox:ox + sx, :, oz:oz + sz]
        b1 = L1[ox:ox + sx, :, oz:oz + sz]
        used = np.unique(np.concatenate([b0.ravel(), b1[b1 >= 0].ravel()]))
        remap = np.full(len(palette), -1, dtype=np.int32)
        remap[used] = np.arange(len(used))
        # ordem do .mcstructure: x, depois y, depois z (= ordem C de um array [x, y, z])
        i0 = remap[b0].ravel()
        i1 = np.where(b1 >= 0, remap[np.maximum(b1, 0)], -1).ravel()
        wx0, wz0 = X0 + ox, Z0 + oz

        position_data = CompoundTag()
        for c in block_entities:
            lx, ly, lz = int(c['x']) - wx0, int(c['y']) - Y0, int(c['z']) - wz0
            if 0 <= lx < sx and 0 <= lz < sz:
                position_data[str((lx * SY + ly) * sz + lz)] = CompoundTag({'block_entity_data': c})
        tile_entities = [c for c in entities
                         if 0 <= float(c['Pos'][0]) - wx0 < sx and 0 <= float(c['Pos'][2]) - wz0 < sz]

        root = CompoundTag({
            'format_version': IntTag(1),
            'size': ListTag([IntTag(sx), IntTag(SY), IntTag(sz)]),
            'structure_world_origin': ListTag([IntTag(wx0), IntTag(Y0), IntTag(wz0)]),
            'structure': CompoundTag({
                'block_indices': ListTag([ListTag([IntTag(int(q)) for q in i0], 3),
                                          ListTag([IntTag(int(q)) for q in i1], 3)]),
                'entities': ListTag(tile_entities, 10),
                'palette': CompoundTag({'default': CompoundTag({
                    'block_palette': ListTag([palette[u] for u in used], 10),
                    'block_position_data': position_data,
                })}),
            }),
        })
        name = 'tile_%d_%d' % (ti, tj)
        data = NamedTag(root, '').to_nbt(compressed=False, little_endian=True,
                                         string_encoder=N.utf8_escape_encoder)
        with open(os.path.join(out_dir, name + '.mcstructure'), 'wb') as f:
            f.write(data)
        tiles.append({'id': 'rick01:' + name, 'x': wx0 + OFF_X, 'y': Y0 + OFF_Y, 'z': wz0 + OFF_Z,
                      'sx': sx, 'sy': SY, 'sz': sz})

with open(os.path.join(BP, 'scripts', 'rick01', 'tiles.js'), 'w') as f:
    f.write('// Gerado por tools/export_build.py — não edite à mão.\n')
    f.write('export const BUILD_BOX = %s;\n' % json.dumps({
        'min': {'x': X0 + OFF_X, 'y': Y0 + OFF_Y, 'z': Z0 + OFF_Z},
        'max': {'x': X1 + OFF_X, 'y': Y1 + OFF_Y, 'z': Z1 + OFF_Z},
        'ground': 106,
    }))
    f.write('export const TILES = [\n%s\n];\n' % ',\n'.join('  ' + json.dumps(t) for t in tiles))

print('paleta', len(palette), '| block entities', len(block_entities), '| entidades', len(entities),
      '| tiles', len(tiles))
