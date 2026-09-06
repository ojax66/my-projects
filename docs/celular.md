# Instalar pelo celular, sem computador

Um arquivo só, colado na hora de criar a instância: **[`deploy/oracle-cloud-init.yaml`](../deploy/oracle-cloud-init.yaml)**.
Ele instala o Docker, sobe o servidor, libera o firewall do sistema e publica
uma página web para você enviar mundos e addons do próprio celular.

Sem Terraform, sem SSH, sem `scp`.

## Passo a passo

### 1. Pegue o arquivo no celular

Abra o arquivo no GitHub e toque em **Raw** — ou baixe direto:

```
https://raw.githubusercontent.com/ojax66/my-projects/main/deploy/oracle-cloud-init.yaml
```

Selecione tudo e copie (ou salve o arquivo, para usar o "Choose file" da
console da Oracle).

### 2. Edite as 6 linhas marcadas

No topo do arquivo, procure por `<<< EDITE`:

| Linha | O que é |
|---|---|
| `SERVER_NAME` | nome que aparece na lista de servidores |
| `GAMEMODE` | `survival`, `creative` ou `adventure` |
| `DIFFICULTY` | `peaceful`, `easy`, `normal` ou `hard` |
| `MAX_PLAYERS` | limite de jogadores |
| `MCBE_UPLOAD_TOKEN` | **senha da página de envio** — invente uma, 12+ caracteres |
| `MCBE_UPLOAD_PORT` | porta da página (opcional, padrão 8080) |

Se você não trocar o token, a página de envio **não sobe** — é proposital, para
não deixar um endereço de upload aberto com senha conhecida. O servidor de jogo
sobe do mesmo jeito.

### 3. Crie a instância

Em <https://cloud.oracle.com>, no navegador do celular:

1. Menu ☰ → **Compute → Instances → Create instance**
2. **Image and shape → Edit**
   - Image: **Canonical Ubuntu 22.04**
   - Shape: **VM.Standard.A1.Flex**, 2 OCPUs, 12 GB (free tier)
3. **Add SSH keys**: pode deixar "No SSH keys" — tudo aqui é pelo navegador
4. **Show advanced options → Management → Paste cloud-init script**: cole o
   arquivo inteiro
5. **Create** e anote o **Public IP address**

### 4. Libere as portas (uma vez só)

**Networking → Virtual cloud networks →** sua VCN **→ Security Lists → Default
Security List → Add Ingress Rules**:

| Source | Protocolo | Portas | Para quê |
|---|---|---|---|
| `0.0.0.0/0` | UDP | `19132-19133` | o jogo |
| `0.0.0.0/0` | TCP | `8080` | a página de envio |

### 5. Use

Espere cerca de 5 minutos (a VM baixa o servidor da Mojang na primeira vez).

- **Enviar mundos e addons:** `http://SEU-IP:8080/?t=SEU-TOKEN`
  Escolha os arquivos `.mcworld`/`.mcaddon`, toque em **Enviar e instalar** —
  a página importa tudo e reinicia o servidor sozinha.
- **Jogar:** Minecraft → *Servidores* → *Adicionar servidor* → `SEU-IP`, porta
  `19132`.

## A página de envio

| Botão | O que faz |
|---|---|
| Enviar e instalar | envia os arquivos, importa (`mcpack.py`) e reinicia o servidor |
| Ver mundos e addons | lista mundos, pacotes instalados e o que está ativo |
| Reiniciar servidor | reinicia o container |

Aceita `.mcworld`, `.mcaddon`, `.mcpack` e `.mctemplate`, vários de uma vez;
qualquer outra extensão é recusada. O limite padrão é 2 GB por envio
(`MCBE_UPLOAD_MAX_MB`).

### Segurança, sem rodeios

A página roda em **HTTP puro**: o token viaja em claro e qualquer pessoa com o
endereço e o token envia arquivos para o seu servidor. Isso é o preço de não
depender de SSH nem de certificado no celular. Reduza o risco assim:

- token longo e aleatório (não reaproveite senha de outro lugar);
- **remova a regra de ingresso da porta 8080** quando terminar de enviar seus
  mundos, e recoloque quando precisar de novo — o servidor de jogo continua
  funcionando sem ela;
- se preferir, restrinja o *Source* da regra ao IP do seu celular
  (ele muda com frequência em rede móvel).

## Quando algo não funciona

Sem SSH, o diagnóstico é pela console da Oracle: **Instances → sua instância →
Console connection → Launch Cloud Shell connection** (ou use o Cloud Shell, que
roda no navegador).

| Sintoma | Causa provável |
|---|---|
| A página 8080 não abre | regra de ingresso TCP 8080 faltando, ou o token não foi trocado (o serviço se recusa a subir) |
| Página abre, mas dá 403 | token na URL diferente do que está em `/opt/mcbe/upload.env` |
| O jogo não acha o servidor | regra UDP 19132-19133 faltando; espere os ~5 min da primeira inicialização |
| "Out of host capacity" ao criar | falta Ampere na região agora: tente 1 OCPU / 6 GB, outro AD ou mais tarde |
| Envio grande falha | rede móvel caindo no meio; use Wi-Fi para mundos de centenas de MB |

No Cloud Shell da instância, os comandos úteis:

```bash
sudo tail -50 /var/log/cloud-init-output.log   # o que a instalação fez
sudo systemctl status mcbe-upload              # a página de envio
cd /opt/mcbe && sudo ./scripts/mcctl.sh logs   # o servidor
```

## Diferença para o caminho com Terraform

O `deploy/oracle-cloud-init.yaml` é a versão "tudo pelo navegador": você cria a
VM e as regras de rede na mão, e ganha a página de envio.

O caminho do [`docs/oracle-cloud.md`](oracle-cloud.md) cria rede, firewall, VM e
IP reservado por código (`make tf-apply`), mas espera que você tenha um
computador com Terraform e SSH — e não sobe a página de envio por padrão, já
que ali dá para usar `scp` e `make import`.
