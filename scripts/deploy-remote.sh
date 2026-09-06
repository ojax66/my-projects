#!/usr/bin/env bash
# Copia este repositorio para a VM na Oracle Cloud e prepara o host.
#
#   scripts/deploy-remote.sh ubuntu@140.238.x.x [caminho-remoto]
#
# Nao envia server/data, server/.env nem backups: dados do servidor ficam
# apenas na VM.
set -euo pipefail

target="${1:-}"
remote_dir="${2:-/opt/mcbe}"
[[ -n "$target" ]] || { echo "uso: $0 usuario@ip [caminho-remoto]" >&2; exit 1; }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> preparando $remote_dir em $target"
ssh "$target" "sudo mkdir -p '$remote_dir' && sudo chown \$(id -u):\$(id -g) '$remote_dir'"

echo "==> sincronizando arquivos"
rsync -az --delete \
  --exclude '.git' \
  --exclude 'server/data' \
  --exclude 'server/incoming' \
  --exclude 'server/.env' \
  --exclude 'backups' \
  --exclude 'terraform/.terraform' \
  --exclude '*.tfstate*' \
  "$REPO_DIR/" "$target:$remote_dir/"

echo "==> executando bootstrap remoto"
ssh -t "$target" "sudo $remote_dir/scripts/bootstrap.sh"

cat <<EOF

==> repositorio publicado em $target:$remote_dir

    ssh $target
    cd $remote_dir
    ./scripts/mcctl.sh up

    Para enviar mundos/addons:
      scp meu-mundo.mcworld $target:$remote_dir/server/incoming/
      ssh $target "cd $remote_dir && ./scripts/mcctl.sh import && ./scripts/mcctl.sh restart"
EOF
