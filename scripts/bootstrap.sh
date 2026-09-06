#!/usr/bin/env bash
# Prepara uma VM Linux (Oracle Linux 8/9 ou Ubuntu 22.04/24.04) para rodar o
# servidor: Docker Engine + compose plugin, firewall do SO e backup diario.
#
# Idempotente: pode rodar de novo sem quebrar nada.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_PORT="${SERVER_PORT:-19132}"
RUN_USER="${SUDO_USER:-${USER:-$(id -un)}}"

need_root() { [[ $EUID -eq 0 ]] || exec sudo -E "$0" "$@"; }
need_root "$@"

. /etc/os-release
echo "==> distribuicao detectada: $PRETTY_NAME ($(uname -m))"

install_docker_rpm() {
  dnf install -y dnf-plugins-core
  dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo 2>/dev/null \
    || dnf config-manager --addrepo=https://download.docker.com/linux/centos/docker-ce.repo
  dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin tar rsync python3
}

install_docker_deb() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg tar rsync python3
  install -m 0755 -d /etc/apt/keyrings
  if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
    curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
  fi
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
}

if ! command -v docker >/dev/null 2>&1; then
  echo "==> instalando Docker"
  case "$ID" in
    ol|rhel|centos|almalinux|rocky|fedora) install_docker_rpm ;;
    ubuntu|debian)                         install_docker_deb ;;
    *) echo "distribuicao nao suportada automaticamente: $ID" >&2; exit 1 ;;
  esac
else
  echo "==> Docker ja instalado: $(docker --version)"
fi

systemctl enable --now docker
usermod -aG docker "$RUN_USER" || true

# --- firewall do sistema operacional --------------------------------------- #
# As imagens da Oracle vem com regras restritivas (iptables no Ubuntu,
# firewalld no Oracle Linux). Sem isso o trafego UDP nunca chega ao container.
echo "==> liberando UDP $SERVER_PORT/$((SERVER_PORT + 1)) no firewall local"
if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-port="$SERVER_PORT/udp" >/dev/null
  firewall-cmd --permanent --add-port="$((SERVER_PORT + 1))/udp" >/dev/null
  firewall-cmd --reload >/dev/null
elif command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow "$SERVER_PORT/udp" >/dev/null
  ufw allow "$((SERVER_PORT + 1))/udp" >/dev/null
else
  for port in "$SERVER_PORT" "$((SERVER_PORT + 1))"; do
    iptables -C INPUT -p udp --dport "$port" -j ACCEPT 2>/dev/null \
      || iptables -I INPUT 1 -p udp --dport "$port" -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null 2>&1; then
    netfilter-persistent save >/dev/null
  elif [[ -d /etc/iptables ]]; then
    iptables-save > /etc/iptables/rules.v4
  else
    echo "aviso: regra iptables aplicada mas nao persistida; reveja apos reboot" >&2
  fi
fi

# --- configuracao do servidor ---------------------------------------------- #
if [[ ! -f "$REPO_DIR/server/.env" ]]; then
  cp "$REPO_DIR/server/.env.example" "$REPO_DIR/server/.env"
  uid="$(id -u "$RUN_USER")"; gid="$(id -g "$RUN_USER")"
  sed -i "s/^PUID=.*/PUID=$uid/;s/^PGID=.*/PGID=$gid/;s/^SERVER_PORT=.*/SERVER_PORT=$SERVER_PORT/" "$REPO_DIR/server/.env"
  echo "==> server/.env criado a partir do exemplo (revise antes de subir)"
fi
mkdir -p "$REPO_DIR/server/data" "$REPO_DIR/server/incoming" "$REPO_DIR/backups"
chown -R "$RUN_USER":"$(id -gn "$RUN_USER")" "$REPO_DIR/server" "$REPO_DIR/backups"

# --- backup diario as 05:00 UTC -------------------------------------------- #
cat > /etc/systemd/system/mcbe-backup.service <<UNIT
[Unit]
Description=Backup do servidor Minecraft Bedrock
After=docker.service

[Service]
Type=oneshot
User=$RUN_USER
WorkingDirectory=$REPO_DIR
ExecStart=$REPO_DIR/scripts/backup.sh
UNIT

cat > /etc/systemd/system/mcbe-backup.timer <<'UNIT'
[Unit]
Description=Backup diario do servidor Minecraft Bedrock

[Timer]
OnCalendar=*-*-* 05:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now mcbe-backup.timer

cat <<EOF

==> pronto.

    1) revise  $REPO_DIR/server/.env
    2) suba    $REPO_DIR/scripts/mcctl.sh up
    3) logs    $REPO_DIR/scripts/mcctl.sh logs -f

    Backups diarios ativos (systemd timer mcbe-backup.timer).
    Se '$RUN_USER' acabou de entrar no grupo docker, refaca o login.
EOF
