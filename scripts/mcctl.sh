#!/usr/bin/env bash
# Controle do servidor Bedrock (wrapper fino sobre docker compose).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$REPO_DIR/server"
CONTAINER="${MCBE_CONTAINER:-mcbe}"

compose() { (cd "$SERVER_DIR" && docker compose "$@"); }

require_env() {
  if [[ ! -f "$SERVER_DIR/.env" ]]; then
    echo "server/.env nao encontrado; criando a partir de .env.example" >&2
    cp "$SERVER_DIR/.env.example" "$SERVER_DIR/.env"
    echo "revise server/.env antes de subir o servidor" >&2
  fi
}

usage() {
  cat <<'EOF'
uso: mcctl.sh <comando>

  up               sobe o servidor (cria .env se faltar)
  down             para e remove o container
  restart          reinicia (necessario apos importar mundos/addons)
  status           estado do container e ping do servidor
  logs [-f]        logs do servidor
  console          console interativo (saia com Ctrl-p Ctrl-q)
  cmd "<comando>"  envia um comando ao servidor, ex.: cmd "list"
  import [arquivo] importa server/incoming/ (ou um arquivo especifico)
  packs            lista mundos e addons instalados
  update           baixa a imagem mais recente e recria o container
  shell            shell dentro do container
EOF
}

cmd="${1:-}"; shift || true
case "$cmd" in
  up)      require_env; compose up -d; echo "servidor subindo; acompanhe com: $0 logs -f" ;;
  down)    compose down ;;
  restart) compose restart ;;
  status)
    compose ps
    docker exec "$CONTAINER" mc-monitor status-bedrock --host 127.0.0.1 --port 19132 2>/dev/null \
      || echo "servidor ainda nao respondeu ao ping (pode estar iniciando)"
    ;;
  logs)    compose logs "${@:---tail=100}" ;;
  console)
    echo "Ctrl-p Ctrl-q desanexa sem derrubar o servidor. NAO use Ctrl-c."
    docker attach --sig-proxy=false "$CONTAINER"
    ;;
  cmd)
    [[ $# -ge 1 ]] || { echo "informe o comando, ex.: $0 cmd \"list\"" >&2; exit 1; }
    if docker exec "$CONTAINER" sh -c 'command -v send-command' >/dev/null 2>&1; then
      docker exec "$CONTAINER" send-command "$*"
    else
      echo "send-command indisponivel nesta imagem; use: $0 console" >&2
      exit 1
    fi
    ;;
  import)
    if [[ $# -ge 1 ]]; then
      case "${1,,}" in
        *.mcworld|*.mctemplate) python3 "$REPO_DIR/scripts/mcpack.py" world "$@" ;;
        *)                      python3 "$REPO_DIR/scripts/mcpack.py" addon "$@" ;;
      esac
    else
      python3 "$REPO_DIR/scripts/mcpack.py" auto
    fi
    ;;
  packs)   python3 "$REPO_DIR/scripts/mcpack.py" list ;;
  update)  compose pull && compose up -d ;;
  shell)   docker exec -it "$CONTAINER" bash ;;
  ""|-h|--help|help) usage ;;
  *) echo "comando desconhecido: $cmd" >&2; usage; exit 1 ;;
esac
