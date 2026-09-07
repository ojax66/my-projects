#!/usr/bin/env bash
# Empacota os dois packs num único .mcaddon (que é só um zip com outro nome).
# Uso: tools/build.sh [pasta-de-saida]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$ROOT/dist}"
NAME="Space_Dimension"

BP="$ROOT/packs/Space Dimension BP"
RP="$ROOT/packs/Space Dimension RP"

for d in "$BP" "$RP"; do
  [ -d "$d" ] || { echo "faltando: $d" >&2; exit 1; }
done

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
