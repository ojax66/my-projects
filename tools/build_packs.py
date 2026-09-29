"""Gera os .mcpack em dist/ a partir de rick01_BP/.

Uso:
    python3 tools/build_packs.py

- dist/Ricks_Multiverse.mcpack            -> completo (clones do overworld + cidade do Rick)
- dist/Ricks_Multiverse_Overworld.mcpack  -> só os clones do overworld, sem a cidade
                                             (sem as estruturas e com a lista de pedaços vazia)

As duas versões criam as mesmas dimensões (rick:01 … rick:55) e os mesmos comandos,
então só uma delas pode estar ativa num mundo.
"""
import json
import os
import re
import shutil
import tempfile
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'rick01_BP')
DIST = os.path.join(ROOT, 'dist')

# UUIDs próprios da versão só overworld (fixos, para o jogo reconhecer as atualizações)
OVERWORLD_ONLY = {
    'name': "Rick's Multiverse (só overworld)",
    'description': 'Dimensões rick:01 a rick:55: cópias do overworld, sem a cidade do Rick. '
                   'Comandos /rick:rick01 a /rick:rick55',
    'header_uuid': '75e03cee-eca4-42d4-96a9-258829b0766f',
    'module_uuids': ['11918f8d-5548-4d58-afed-41f4b218d299', '4902a950-d4a0-4493-9754-57bff97b2918'],
}


def dump_manifest(m):
    s = json.dumps(m, indent=2, ensure_ascii=False)
    return re.sub(r'\[\s+(-?\d+),\s+(-?\d+),\s+(-?\d+)\s+\]', r'[\1, \2, \3]', s) + '\n'


def zip_dir(folder, out):
    if os.path.exists(out):
        os.remove(out)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for base, dirs, files in os.walk(folder):
            dirs[:] = sorted(d for d in dirs if not d.startswith('.'))
            for f in sorted(files):
                if f.startswith('.'):
                    continue
                full = os.path.join(base, f)
                z.write(full, os.path.relpath(full, folder))


def main():
    os.makedirs(DIST, exist_ok=True)
    zip_dir(SRC, os.path.join(DIST, 'Ricks_Multiverse.mcpack'))

    with tempfile.TemporaryDirectory() as tmp:
        dst = os.path.join(tmp, 'pack')
        shutil.copytree(SRC, dst, ignore=shutil.ignore_patterns('structures', '.*'))

        # sem a cidade: mantém BUILD_BOX (o código importa), esvazia BUILD_CHUNKS
        tiles = os.path.join(dst, 'scripts', 'rick01', 'tiles.js')
        src_tiles = open(tiles, encoding='utf-8').read()
        box = re.search(r'export const BUILD_BOX = .*?;\n', src_tiles).group(0)
        with open(tiles, 'w', encoding='utf-8') as f:
            f.write('// Versão só overworld: sem a cidade do Rick (gerado por tools/build_packs.py).\n')
            f.write(box)
            f.write('export const BUILD_CHUNKS = {};\n')

        mpath = os.path.join(dst, 'manifest.json')
        m = json.load(open(mpath, encoding='utf-8'))
        m['header']['name'] = OVERWORLD_ONLY['name']
        m['header']['description'] = OVERWORLD_ONLY['description']
        m['header']['uuid'] = OVERWORLD_ONLY['header_uuid']
        for mod, u in zip(m['modules'], OVERWORLD_ONLY['module_uuids']):
            mod['uuid'] = u
        with open(mpath, 'w', encoding='utf-8') as f:
            f.write(dump_manifest(m))

        zip_dir(dst, os.path.join(DIST, 'Ricks_Multiverse_Overworld.mcpack'))

    for f in sorted(os.listdir(DIST)):
        print(f, os.path.getsize(os.path.join(DIST, f)), 'bytes')


if __name__ == '__main__':
    main()
