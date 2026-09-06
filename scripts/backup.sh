#!/usr/bin/env bash
# Backup dos mundos, addons e configuracao do servidor Bedrock.
#
#   scripts/backup.sh              backup a quente (save hold/resume)
#   scripts/backup.sh --stop       para o servidor durante a copia
#   OCI_BUCKET=meu-bucket scripts/backup.sh   envia tambem ao Object Storage
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${MCBE_DATA:-$REPO_DIR/server/data}"
BACKUP_DIR="${MCBE_BACKUPS:-$REPO_DIR/backups}"
CONTAINER="${MCBE_CONTAINER:-mcbe}"
KEEP="${MCBE_KEEP:-14}"
STOP_MODE=0
[[ "${1:-}" == "--stop" ]] && STOP_MODE=1

stamp="$(date -u +%Y%m%d-%H%M%S)"
archive="$BACKUP_DIR/mcbe-$stamp.tar.gz"
mkdir -p "$BACKUP_DIR"

running() { [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo false)" == "true" ]]; }
send() { docker exec "$CONTAINER" send-command "$*" >/dev/null 2>&1 || return 1; }

restore_state() {
  if [[ $STOP_MODE -eq 1 ]]; then
    (cd "$REPO_DIR/server" && docker compose up -d) || true
  else
    send "save resume" || true
  fi
}

if running; then
  if [[ $STOP_MODE -eq 1 ]]; then
    echo "parando o servidor para backup consistente..."
    (cd "$REPO_DIR/server" && docker compose stop)
  else
    trap restore_state EXIT
    if send "save hold"; then
      echo "escrita do mundo pausada (save hold)"
      for _ in $(seq 1 30); do send "save query" && break; sleep 1; done
    else
      echo "aviso: nao foi possivel pausar a escrita; use --stop para backup garantido" >&2
    fi
  fi
else
  echo "servidor parado; copiando diretamente"
fi

echo "gerando $archive"
tar -czf "$archive" -C "$(dirname "$DATA_DIR")" \
  --exclude='*/cache' --exclude='*.bak' \
  "$(basename "$DATA_DIR")"

if [[ $STOP_MODE -eq 1 ]] && [[ "$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null)" == "exited" ]]; then
  (cd "$REPO_DIR/server" && docker compose up -d)
fi

size="$(du -h "$archive" | cut -f1)"
echo "backup concluido: $archive ($size)"

# rotacao local ------------------------------------------------------------- #
mapfile -t old < <(ls -1t "$BACKUP_DIR"/mcbe-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)))
if ((${#old[@]})); then
  printf 'removendo backup antigo: %s\n' "${old[@]}"
  rm -f "${old[@]}"
fi

# copia remota opcional (OCI Object Storage) --------------------------------- #
if [[ -n "${OCI_BUCKET:-}" ]]; then
  if command -v oci >/dev/null 2>&1; then
    echo "enviando para o bucket $OCI_BUCKET"
    oci os object put --bucket-name "$OCI_BUCKET" --file "$archive" \
      --name "mcbe/$(basename "$archive")" --force
  else
    echo "aviso: OCI_BUCKET definido mas o CLI 'oci' nao esta instalado" >&2
  fi
fi
