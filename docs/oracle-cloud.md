# Provisionar na Oracle Cloud (OCI)

Este guia cria, do zero, uma VM na Oracle Cloud rodando o servidor Bedrock.
Tudo cabe no **Always Free** da Oracle se você respeitar os limites da conta.

## 1. Pré-requisitos

| Ferramenta | Para quê | Instalação |
|---|---|---|
| Conta OCI | hospedar a VM | <https://cloud.oracle.com> |
| OCI CLI | autenticação do Terraform | `bash -c "$(curl -L https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)"` |
| Terraform ≥ 1.5 | criar a infraestrutura | <https://developer.hashicorp.com/terraform/downloads> |
| Chave SSH | acessar a VM | `ssh-keygen -t ed25519 -C "minecraft"` |

Configure o CLI uma única vez — ele cria `~/.oci/config`, que o Terraform reaproveita:

```bash
oci setup config      # pede tenancy OCID, user OCID, região e gera a chave de API
oci iam region list   # confirma que a autenticação funciona
```

O **OCID do compartimento** aparece em *Identity & Security → Compartments*.
Para começar, usar o compartimento raiz (o mesmo OCID do tenancy) é aceitável.

## 2. Configurar as variáveis

```bash
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
$EDITOR terraform/terraform.tfvars     # region, compartment_ocid, ssh_public_key
```

Recomendado: restrinja `ssh_allowed_cidr` ao seu IP (`curl -s ifconfig.me`) e deixe
`game_allowed_cidr` aberto, porque os jogadores vêm de qualquer lugar.

## 3. Criar

```bash
make tf-init
make tf-plan
make tf-apply
```

Saídas ao final:

```
minecraft_address = "140.238.10.20:19132"
ssh_command       = "ssh ubuntu@140.238.10.20"
deploy_command    = "scripts/deploy-remote.sh ubuntu@140.238.10.20"
```

O `cloud-init` já instala o Docker, libera o firewall do sistema operacional e
sobe o container. A primeira inicialização baixa o servidor da Mojang e leva de
2 a 5 minutos. Acompanhe com:

```bash
ssh ubuntu@<ip> "sudo tail -f /var/log/cloud-init-output.log"
```

## 4. Publicar os scripts de operação na VM

O `cloud-init` sobe o servidor, mas os scripts (`mcctl.sh`, importador de
addons, backup) chegam com:

```bash
make deploy HOST=ubuntu@<ip>
```

Se o repositório for público, dá para pular esse passo definindo `repo_url` no
`terraform.tfvars` — a própria VM clona o repositório no boot.

## O que o Terraform cria

| Recurso | Observação |
|---|---|
| VCN + subnet pública + internet gateway | rede isolada `10.42.0.0/16` |
| Security list | libera SSH (TCP 22), jogo (UDP 19132‑19133) e ICMP 3/4 |
| Instância `VM.Standard.A1.Flex` | 2 OCPU / 12 GB por padrão, Ubuntu 22.04 |
| IP público reservado | mantém o endereço após parar/ligar a VM |
| Timer systemd de backup | `.tar.gz` diário às 05:00 UTC em `/opt/mcbe/backups` |

## Free tier: os limites que importam

- **Ampere A1**: até 4 OCPUs e 24 GB de RAM somados em toda a conta. O padrão
  daqui (2 OCPU / 12 GB) deixa metade da cota livre.
- **Armazenamento em bloco**: 200 GB no total; o padrão usa 100 GB de boot.
- **Tráfego de saída**: 10 TB/mês — muito acima do consumo de um servidor com
  poucos jogadores.
- **VMs x86 sempre gratuitas**: duas `VM.Standard.E2.1.Micro` (1 OCPU / 1 GB).
  Rodam Bedrock puro, mas 1 GB fica apertado com addons — prefira o A1.

### "Out of host capacity" no Ampere

É o erro mais comum do free tier: a região não tem A1 disponível no momento.
Opções, em ordem de eficácia:

1. Repita `make tf-apply` mais tarde — a capacidade volta em janelas curtas.
2. Troque o *availability domain* (`availability_domain = "xxxx:SA-SAOPAULO-1-AD-1"`).
3. Reduza para `ocpus = 1`, `memory_in_gbs = 6`.
4. Use outra região (`region = "sa-vinhedo-1"`), lembrando que a região *home*
   da conta não pode mudar, mas outras regiões podem ser inscritas.
5. Como último recurso, `shape = "VM.Standard.E2.1.Micro"` (x86).

### ARM x x86

O servidor dedicado da Mojang só existe para x86_64. Na Ampere (ARM) a imagem
`itzg/minecraft-bedrock-server` executa o binário sob **box64**. Funciona bem
para grupos pequenos e médios; espere perda de desempenho em mundos grandes com
muitos addons. Se sentir travadas, aumente `ocpus` (dentro da cota) ou migre
para uma VM x86 paga pequena.

## Os dois firewalls

Tráfego bloqueado quase sempre é isso: a OCI tem **duas** camadas e o sistema
operacional já vem com regras restritivas.

1. **Security list da VCN** — criada pelo Terraform.
2. **Firewall do SO** — `iptables` no Ubuntu, `firewalld` no Oracle Linux;
   tratado pelo `cloud-init` e pelo `scripts/bootstrap.sh`.

Teste do seu computador (UDP não responde a `ping`):

```bash
nc -vzu <ip> 19132        # ou
docker run --rm itzg/mc-monitor status-bedrock --host <ip>
```

## Destruir

```bash
make tf-destroy   # apaga a VM, os discos e os mundos que estiverem só nela
```

Faça `scripts/backup.sh` e traga o `.tar.gz` para sua máquina antes.
