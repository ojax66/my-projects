#!/usr/bin/env bash
# Roda a validação dos packs e os testes de geração.
#
# Os testes rodam no Node com um stub do @minecraft/server (tools/tests/stub):
# a geometria e o orçamento de blocos são JS puro, então dá pra exercitar tudo
# fora do jogo. Os scripts são copiados pra uma pasta temporária junto com o
# stub, porque o Node resolve "@minecraft/server" por node_modules.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/packs/Space Dimension BP/scripts/space_dim"

echo "--- texturas dos blocos (emenda e viés centro/borda) ---"
python3 "$ROOT/tools/make_block_textures.py"

echo
echo "--- validação dos packs ---"
python3 "$ROOT/tools/validate.py"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/space_dim" "$STAGE/node_modules"
cp "$SRC"/*.js "$STAGE/space_dim/"
cp -r "$ROOT/tools/tests/stub/@minecraft" "$STAGE/node_modules/"
cp "$ROOT/tools/tests"/*.mjs "$STAGE/"
echo '{ "type": "module" }' > "$STAGE/package.json"

cd "$STAGE"

echo
echo "--- todos os módulos carregam ---"
node --input-type=module -e "
import('./space_dim/main.js').then(
  () => console.log('ok: main.js e as dependências dele carregam'),
  e  => { console.error('FALHOU:', e.message); process.exit(1); }
);"

echo
echo "--- geometria dos corpos celestes ---"
node test_bodies.mjs

echo
echo "--- orçamento de blocos por tick ---"
node test_budget.mjs

echo
echo "--- Sol: camadas e campo de calor ---"
node test_sun.mjs

echo
echo "--- rotas de viagem e transporte do veículo ---"
node test_travel.mjs

echo
echo "--- custo de geração (informativo) ---"
node cost.mjs
node caps.mjs
