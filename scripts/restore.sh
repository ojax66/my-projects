#!/usr/bin/env bash
# Restaura um backup gerado por scripts/backup.sh.
#
#   scripts/restore.sh                      restaura o backup mais recente
#   scripts/restore.sh backups/mcbe-....tar.gz
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${MCBE_DATA:-$REPO_DIR/server/data}"
BACKUP_DIR="${MCBE_BACKUPS:-$REPO_DIR/backups}"

archive="${1:-$(ls -1t "$BACKUP_DIR"/mcbe-*.tar.gz 2>/dev/null | head -1 || true)}"
[[ -n "$archive" && -f "$archive" ]] || { echo "nenhum backup encontrado em $BACKUP_DIR" >&2; exit 1; }

echo "restaurando $archive sobre $DATA_DIR"
read -rp "isso substitui os dados atuais. continuar? [s/N] " ok
[[ "${ok,,}" == "s" ]] || { echo "cancelado"; exit 0; }

(cd "$REPO_DIR/server" && docker compose stop) || true

if [[ -d "$DATA_DIR" ]]; then
  safety="$DATA_DIR.pre-restore-$(date -u +%Y%m%d-%H%M%S)"
  mv "$DATA_DIR" "$safety"
  echo "dados anteriores preservados em $safety"
fi

mkdir -p "$DATA_DIR"
tar -xzf "$archive" -C "$(dirname "$DATA_DIR")"

(cd "$REPO_DIR/server" && docker compose up -d)
echo "restauracao concluida; acompanhe com scripts/mcctl.sh logs -f"
