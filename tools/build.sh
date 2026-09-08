#!/usr/bin/env bash
# Empacota os dois packs num único .mcaddon (que é só um zip com outro nome).
# Uso: tools/build.sh [pasta-de-saida]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$ROOT/dist}"
NAME="Distant_Horizons"

BP="$ROOT/packs/Distant Horizons BP"
RP="$ROOT/packs/Distant Horizons RP"

for d in "$BP" "$RP"; do
  [ -d "$d" ] || { echo "faltando: $d" >&2; exit 1; }
done

# Regenera texturas e definições de bloco antes de validar: os dois scripts são
# determinísticos, então isso não muda nada se já estiver em dia — mas garante
# que o .mcaddon nunca sai com bloco e textura fora de sincronia.
python3 "$ROOT/tools/make_textures.py"
python3 "$ROOT/tools/make_block_textures.py"
python3 "$ROOT/tools/make_blocks.py"
python3 "$ROOT/tools/make_star_gear.py"
python3 "$ROOT/tools/make_spacesuit.py"
python3 "$ROOT/tools/validate.py"

mkdir -p "$OUT_DIR"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp -r "$BP" "$STAGE/"
cp -r "$RP" "$STAGE/"

# Nada de lixo do sistema de arquivos dentro do addon.
find "$STAGE" \( -name '.DS_Store' -o -name 'Thumbs.db' -o -name '*.swp' \) -delete

ADDON="$OUT_DIR/$NAME.mcaddon"
rm -f "$ADDON"
( cd "$STAGE" && zip -qr "$ADDON" . -x '.*' )

echo "gerado: $ADDON  ($(du -h "$ADDON" | cut -f1))"
