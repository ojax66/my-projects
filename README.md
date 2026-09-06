# Servidor Minecraft Bedrock na Oracle Cloud

Hospedagem completa de um *Bedrock Dedicated Server* com **importação de mundos
exportados (`.mcworld`) e addons (`.mcaddon`/`.mcpack`)**, provisionada na
Oracle Cloud com Terraform e operada por scripts simples.

- **Infraestrutura como código** — `make tf-apply` cria rede, firewall, VM e IP
  fixo. Cabe no Always Free da Oracle (Ampere A1).
- **Addons de verdade** — o importador lê o `manifest.json` de cada pacote,
  instala em `behavior_packs`/`resource_packs` e registra no mundo. Sem editar
  JSON na mão.
- **Mundos exportados do jogo** — jogue no celular, exporte, importe no
  servidor.
- **Backup diário** automático, restauração em um comando.

## Início rápido

### Na Oracle Cloud

```bash
git clone <este-repositorio> && cd my-projects

cp terraform/terraform.tfvars.example terraform/terraform.tfvars
$EDITOR terraform/terraform.tfvars        # region, compartment_ocid, ssh_public_key

make tf-init && make tf-apply             # cria a VM e sobe o servidor
make deploy HOST=ubuntu@<ip-da-saida>     # publica os scripts na VM
```

O endereço para colocar no jogo sai em `minecraft_address` (`<ip>:19132`).
Passo a passo, limites do free tier e o erro *Out of host capacity*:
**[docs/oracle-cloud.md](docs/oracle-cloud.md)**.

### Local (ou em qualquer outro servidor Linux)

```bash
./scripts/bootstrap.sh                    # instala Docker e libera o firewall
cp server/.env.example server/.env        # revise nome, gamemode, dificuldade
make up && make logs
```

Só Docker já instalado? `cd server && cp .env.example .env && docker compose up -d`.

### Mundos e addons

```bash
cp ~/Downloads/mundo.mcworld ~/Downloads/addon.mcaddon server/incoming/
make import      # importa mundos e addons, registra os pacotes no mundo
make restart     # o servidor carrega o que foi importado
make packs       # confere o que está ativo
```

Detalhes, exportação pelo jogo e armadilhas (experimentos, versões,
pacotes ausentes): **[docs/mundos-e-addons.md](docs/mundos-e-addons.md)**.

## Estrutura

```
terraform/          infraestrutura OCI (VCN, security list, VM, IP reservado)
  cloud-init.yaml.tftpl    provisiona Docker, firewall do SO e sobe o servidor
server/
  docker-compose.yml       itzg/minecraft-bedrock-server
  .env.example             toda a configuração do servidor
  data/                    mundos, behavior_packs, resource_packs (não versionado)
  incoming/                pasta de entrada dos .mcworld/.mcaddon
scripts/
  mcpack.py                importador de mundos e addons (stdlib apenas)
  mcctl.sh                 up/down/logs/console/cmd/import/status
  bootstrap.sh             prepara uma VM Linux do zero
  deploy-remote.sh         rsync do repositório para a VM + bootstrap
  backup.sh / restore.sh   backup a quente com rotação e restauração
docs/                 guias de nuvem, addons e operação
```

## Comandos

| Comando | O que faz |
|---|---|
| `make up` / `make down` / `make restart` | ciclo de vida do servidor |
| `make logs` / `make status` / `make console` | acompanhamento e console |
| `make import` / `make packs` | importa `server/incoming/`, lista o que está ativo |
| `make backup` / `make restore` | backup a quente e restauração |
| `make update` | atualiza a imagem do servidor |
| `make deploy HOST=user@ip` | publica o repositório na VM |
| `make tf-plan` / `make tf-apply` / `make tf-destroy` | infraestrutura |
| `./scripts/mcctl.sh cmd "list"` | envia um comando ao servidor |

`make help` lista tudo. Operação, whitelist, XUIDs e diagnóstico de conexão:
**[docs/operacao.md](docs/operacao.md)**.

## Requisitos

- Terraform ≥ 1.5 e OCI CLI configurado (`oci setup config`) — só para a nuvem.
- Docker Engine + plugin compose na máquina que roda o servidor
  (`scripts/bootstrap.sh` instala).
- Python 3.8+ para o importador (sem dependências externas).

## Notas

- O servidor da Mojang é x86_64; na Ampere (ARM) a imagem o executa sob box64.
  Funciona bem para grupos pequenos e médios — veja `docs/oracle-cloud.md`.
- `server/data`, `server/.env` e `backups/` ficam fora do git: são dados do seu
  servidor.
- Subir o servidor implica aceitar o
  [EULA da Minecraft](https://www.minecraft.net/eula) (`EULA=TRUE` no compose).
