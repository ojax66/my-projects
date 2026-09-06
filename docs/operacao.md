# Operação do dia a dia

## Comandos

```bash
make up          # sobe          make logs      # acompanha o log
make status      # ping + estado make console   # console interativo
make restart     # reinicia      make update    # atualiza a imagem
make backup      # backup agora  make restore   # restaura o mais recente
```

Enviar comandos sem abrir o console:

```bash
./scripts/mcctl.sh cmd "list"
./scripts/mcctl.sh cmd "say servidor reiniciando em 5 minutos"
```

No console interativo, saia com **Ctrl-p Ctrl-q**. `Ctrl-c` derruba o servidor.

## Jogadores, operadores e whitelist

O Bedrock identifica jogadores por **XUID**, não por gamertag. Descubra o XUID
nos logs quando a pessoa entra:

```
[INFO] Player connected: Fulano, xuid: 2533274792395639
```

No `server/.env`:

```ini
OPS=2533274792395639,2533274812345678
MEMBERS=
VISITORS=
WHITE_LIST=true          # exige lista de permissões
```

`make restart` aplica. Com `WHITE_LIST=true`, apenas quem estiver em
`OPS`/`MEMBERS`/`VISITORS` entra.

## Backups

- Automático: timer systemd `mcbe-backup.timer`, diário às 05:00 UTC, mantendo
  os 14 mais recentes em `backups/`.
- Manual: `./scripts/backup.sh` (a quente, via `save hold`/`save resume`) ou
  `./scripts/backup.sh --stop` (para o servidor, cópia 100% consistente).
- Cópia externa: `OCI_BUCKET=meu-bucket ./scripts/backup.sh` envia para o
  Object Storage (10 GB grátis) com o CLI `oci`.

Ver e ajustar o agendamento:

```bash
systemctl list-timers mcbe-backup.timer
sudo systemctl edit mcbe-backup.timer     # muda OnCalendar
MCBE_KEEP=30 ./scripts/backup.sh          # muda a retenção
```

Restaurar em outra máquina: copie o `.tar.gz` para `backups/` e rode
`./scripts/restore.sh backups/mcbe-....tar.gz`.

## Atualizar o servidor

```bash
./scripts/backup.sh          # sempre antes
make update                  # docker compose pull + up -d
make logs
```

Com `VERSION=LATEST` o servidor atualiza sozinho a cada recriação do container.
Em servidor com addons, fixe a versão (`VERSION=1.21.44.01`) e atualize quando
os addons forem compatíveis. **Downgrade não é suportado**: um mundo aberto por
uma versão nova não volta para a antiga — por isso o backup antes.

## Desempenho

| Sintoma | Ajuste |
|---|---|
| Travadas com muitos jogadores | reduza `VIEW_DISTANCE` (16 → 10) |
| CPU no talo em ARM | reduza `TICK_DISTANCE` (4 → 3) e aumente `ocpus` |
| Container morto por OOM | aumente `MEMORY_LIMIT` e a RAM da VM |

Acompanhe com `docker stats mcbe`. Lembre que na Ampere o binário roda sob
box64 (veja `docs/oracle-cloud.md`).

## Problemas comuns

**Ninguém conecta.** Confira as três camadas, nessa ordem:

```bash
docker ps                                   # 1. container de pé?
sudo iptables -L INPUT -n | grep 19132      # 2. firewall do SO
nc -vzu <ip-publico> 19132                  # 3. security list da VCN
```

**O servidor não aparece na aba "Servidores" do jogo.** É esperado: essa aba
lista apenas servidores parceiros. Use *Jogar → Servidores → Adicionar servidor*
e informe IP e porta 19132.

**Console/Switch não deixam adicionar servidor.** Limitação da plataforma, não
do servidor. A solução usual é um app de DNS (BedrockConnect e similares) que
substitui um servidor parceiro pelo seu endereço.

**`Unable to connect to world` intermitente.** Quase sempre é MTU/ICMP. A
security list já libera ICMP 3/4; se você editou a rede na mão, recoloque.

**Container reiniciando em loop.** `docker logs mcbe --tail 100`. Causas
frequentes: `LEVEL_NAME` apontando para um mundo inexistente, permissão errada
em `server/data` (`sudo chown -R 1000:1000 server/data`) ou pouca memória.

**Perdi o IP após parar a VM.** Só acontece com `reserve_public_ip = false`.
Com o padrão do Terraform, o IP é reservado e permanece.
