# Mundos exportados e addons

O servidor entende os mesmos arquivos que o jogo exporta:

| Arquivo | O que é | Comando |
|---|---|---|
| `.mcworld` | mundo exportado do jogo | `./scripts/mcctl.sh import mundo.mcworld` |
| `.mcaddon` | pacote com behavior + resource packs | `./scripts/mcctl.sh import addon.mcaddon` |
| `.mcpack` | um único pacote (comportamento **ou** recurso) | `./scripts/mcctl.sh import pack.mcpack` |
| `.mctemplate` | template de mundo | tratado como mundo |

Todos são arquivos ZIP com outro nome — o importador extrai, lê o
`manifest.json` de cada pacote e faz o registro no mundo.

## Fluxo normal

```bash
# 1. coloque os arquivos na pasta de entrada (local ou na VM)
cp ~/Downloads/*.mcworld ~/Downloads/*.mcaddon server/incoming/

# 2. importe tudo de uma vez (mundos primeiro, depois os addons)
./scripts/mcctl.sh import

# 3. reinicie para o servidor carregar
./scripts/mcctl.sh restart

# 4. confira o que ficou ativo
./scripts/mcctl.sh packs
```

Os arquivos já processados vão para `server/incoming/processados/`.

Pelo celular, sem SSH: a página `http://SEU-IP:8080/?t=SEU-TOKEN` faz os passos
1 a 3 sozinha (veja [celular.md](celular.md)).

Direto na VM:

```bash
scp mundo.mcworld addon.mcaddon ubuntu@<ip>:/opt/mcbe/server/incoming/
ssh ubuntu@<ip> "cd /opt/mcbe && ./scripts/mcctl.sh import && ./scripts/mcctl.sh restart"
```

## Exportar do jogo

- **Mundo** — *Jogar → Mundos → lápis ao lado do mundo → Exportar mundo*.
  Gera um `.mcworld`. Vale para Android, iOS, Windows e consoles com acesso a
  arquivos.
- **Addon** — o `.mcaddon` que você baixou já serve. Se o addon veio como pasta
  solta, aponte o importador para a pasta: `python3 scripts/mcpack.py addon ./MeuAddon`.

## O que o importador faz

Mundo (`mcpack.py world`):

1. Valida que existe `level.dat` (senão não é um mundo Bedrock).
2. Extrai para `server/data/worlds/<nome>` e preserva o nome original em
   `levelname.txt`.
3. Se já existir um mundo com esse nome, o antigo vira `<nome>.bak`.
4. Com `--activate` (ou `make import` quando é o único mundo), grava
   `LEVEL_NAME` no `server/.env`.

Addon (`mcpack.py addon`):

1. Extrai o `.mcaddon`, inclusive `.mcpack` aninhados.
2. Lê cada `manifest.json` — tolera comentários e vírgulas sobrando, comuns nos
   manifestos publicados.
3. Classifica pelo `modules[].type`: `resources` → resource pack; `data`/`script`
   → behavior pack.
4. Copia para `server/data/behavior_packs/` ou `resource_packs/`, em uma pasta
   `nome-do-pacote-<8 primeiros do uuid>`.
5. Registra `pack_id` + `version` em `world_behavior_packs.json` /
   `world_resource_packs.json` do mundo de destino. Reimportar a mesma versão
   não duplica nada; versão nova atualiza o registro.

## Comandos úteis

```bash
# escolher o mundo de destino explicitamente
python3 scripts/mcpack.py addon addon.mcaddon --world meu-mundo

# importar um mundo com outro nome de pasta e já ativá-lo
python3 scripts/mcpack.py world mundo.mcworld --name survival-2025 --activate

# listar tudo (mundos, pacotes instalados, pacotes ativos no mundo)
python3 scripts/mcpack.py list

# desativar e apagar um pacote pelo uuid
python3 scripts/mcpack.py remove aaaaaaaa-1111-2222-3333-444444444444
```

## Armadilhas conhecidas

**Addon com scripts não carrega.** Behavior packs que usam a API de scripts
exigem *Experimental Gameplay* ativo **no mundo**. Essa flag mora dentro do
`level.dat` e não é ligada por variável de ambiente: crie/ative o mundo no
cliente com a opção ligada, exporte o `.mcworld` e importe aqui.

**Pacote ativo mas ausente.** Se `mcpack.py list` mostrar
`PACOTE AUSENTE em data/*_packs`, o mundo referencia um pacote que veio junto do
`.mcworld` mas cujos arquivos não foram importados. Importe o `.mcaddon`
correspondente — o `pack_id` tem que bater.

**Jogadores não veem as texturas.** Resource packs são baixados na entrada.
Se quiser tornar obrigatório, use `TEXTUREPACK_REQUIRED=true` no `server/.env`.

**Versão do addon x versão do servidor.** Um addon feito para uma versão mais
nova que a do servidor pode ser ignorado silenciosamente. Fixe `VERSION` no
`.env` na mesma versão em que o addon foi testado.

**Mundo grande demora a subir.** A primeira inicialização depois de importar um
mundo grande pode passar de um minuto — acompanhe com `./scripts/mcctl.sh logs -f`
antes de concluir que travou.
