# Mielon's The Sift — port para Minecraft Bedrock

Port do mod Fabric **Mielon's The Sift 1.0.2** (Minecraft Java 26.3) para
add-on do Bedrock. **Mínimo: Bedrock 26.0 (1.26.0).** Usa a API de script estável
(`@minecraft/server` 2.8.0). Não precisa de nenhum experimento.

**Download:** [`dist/The_Sift_Bedrock.mcaddon`](dist/The_Sift_Bedrock.mcaddon).
Abra o arquivo com o Minecraft e ative os dois pacotes (comportamento +
recursos) no mundo.

> ⚠️ Este port não foi testado dentro do jogo. Todas as referências entre os
> arquivos foram conferidas por script (`tools/validate.py`), os scripts
> passaram na checagem de tipos contra as tipagens oficiais da API e o
> gerador de terreno foi simulado fora do jogo, mas é bom testar num mundo de
> teste antes de usar num mundo que importa.

## Como chegar ao Sift

Igual ao mod:

1. Ache uma **Cidade Ancestral** e vá até a moldura de ardósia reforçada no centro.
2. Toque uma **Buzina de Cabra** perto dela. A **Cantora** aparece, canta e
   cada onda sonora transforma um bloco de **Ardósia Sonora** (modo buzina) em
   modo nota.
   *Diferença do Bedrock:* o add-on não consegue trocar a estrutura da
   Cidade Ancestral como o mod faz. Então, quando você anda no subsolo perto
   de uma, o script acha a moldura grande de ardósia reforçada do centro e
   põe as oito Ardósias Sonoras (modo buzina) exatamente onde o molde do mod
   as põe: 5 blocos à frente da moldura, 3 abaixo da base, de dois em dois.
   Se mesmo assim faltarem, a Cantora ergue as oito ao chegar.
3. Ponha um **Bloco de Notas** em cima de cada Ardósia Sonora (modo nota).
   Cada um toca um de 8 sons próprios:
   - **agachar + usar** troca o som do bloco;
   - **usar** (ou bater) toca e registra a nota.
4. Toque a sequência **1 – 3 – 7 – 6 – 5 – 2 – 4 – 8**. O console toca sozinho,
   solta colunas de luz e o **Portal do Sift** se abre na moldura.
   A sequência ao contrário fecha o portal.
5. Atravesse. Do outro lado fica o portal principal do Sift, que leva de volta
   ao ponto de onde você saiu. Se o portal do Overworld for fechado enquanto
   você explora, você é avisado ao voltar.

No criativo, a **Fenda do Sift** cria uma fenda que leva direto entre as duas
dimensões (e abre outra de volta do lado de lá).

## O que foi portado

| Parte | Situação |
|---|---|
| Dimensão do Sift (altura 0–256) | ✅ dimensão custom, gerada pela world_generator_API (veja "Como foi feito") |
| Relevo | ✅ o mesmo formato do mod: altura base em torno de y 93 com os platôs em 5 degraus, cânions, penhascos gigantes, prateleiras, vales dos caminhos e cordilheiras, nas mesmas escalas e limiares; encostas de 4 blocos entre degraus e aspereza nas escarpas |
| Biomas (ermos, clareira, floresta, encostas, picos, picos nevados de ichor, escuro profundo) | ✅ mesmas faixas de clima do mod (proporção e alturas conferidas contra o gerador do Java); o nome aparece na tela ao mudar de bioma |
| Superfície | ✅ caminhos finos de sculk saudável serpenteando, bordas de sculk seco, manchas de sculk, crescimento nos biomas tomados, fundo de bedrock |
| Cavernas | ✅ túneis, na mesma quantidade por altura que as do mod, lava no fundo, raízes penduradas, sculk no escuro profundo |
| Minérios e bolhas de sculk | ✅ quantidades e faixas de altura do mod (conferidas contra o Java) |
| Plantas | ✅ densidades medidas no mod para cada tipo de chão e bioma; canteiros de flores e plantas do farejador |
| Lagos de ichor, monólitos, espinhos de sculk seco, arcos, cânion das almas, regiões de sculk (com Farejador Sombrio), neve de ichor | ✅ |
| Salgueiros Tomados e Portais Abandonados (com baú e loot) | ✅ moldes originais do mod, girados |
| Cavernas do farejador | ❌ ainda não |
| Portal principal do Sift | ✅ estrutura original, terreno aplainado em volta |
| 47 blocos: siftslate, minérios, sculk saudável/seco, neve de ichor (camadas), bloco de alma, ardósia sonora, plantas, conjunto de madeira de salgueiro | ✅ |
| Madeira: tronco, madeira, descascados, tábuas, laje (dupla), escada, cerca, portão, porta, alçapão, botão, placa de pressão | ✅ |
| Placas, placas suspensas, prateleira, barcos de salgueiro | ❌ o Bedrock não permite esses tipos de bloco/entidade custom |
| Siftita: ferramentas, lança, armadura, modelo de ferraria (receitas na mesa de ferraria) | ✅ |
| "Manter Inventário": itens de Siftita voltam pro dono ao renascer | ✅ |
| Criaturas: Peneirador, Blub (domesticável com Bloco de Alma), Golem do Eco (afeiçoado com Fragmento de Eco, traz Bloco de Alma), Farejador Sombrio, Cantora | ✅ modelos e animações originais |
| Farejador sobre sculk vira Farejador Sombrio | ✅ |
| Ichor (fluido) | ⚠️ o Bedrock não aceita fluidos novos: é um bloco translúcido e atravessável com a animação original e o mesmo efeito (regeneração); balde e frasco funcionam |
| Caldeirão de Ichor | ❌ |
| Disco "Rift" (Fuzja Jądrowa) | ✅ toca numa jukebox via script |
| Conquistas | ⚠️ viram aviso no chat + som (o Bedrock não tem conquistas custom). `/scriptevent the_sift:advancements` lista as suas |
| Charoíta como combustível da mesa de encantamento | ❌ não dá pra alterar a mesa de encantamento |
| Céu | ⚠️ céu normal do Overworld (sem o céu procedural do mod) |
| Shaders do portal/fenda, chuva de ichor | ⚠️ trocados por textura animada e partículas |

## Como foi feito

- `tools/port.py` lê o `.jar` do mod e gera todo o conteúdo dos pacotes:
  JSON de blocos/itens/entidades, texturas, sons, traduções, receitas, loot
  tables e as estruturas (`.nbt` do Java → `.mcstructure` do Bedrock).
  Os modelos e animações das criaturas são GeckoLib, que já usa o formato de
  geometria do Bedrock; o script só renomeia e converte os keyframes.
- `packs/TheSift_BP/scripts/` são os scripts, escritos à mão:
  - `lib/world_generator_API.js` e `lib/budget.js` — a API de geração
    procedural do **Galactic Horizons**. A API ganhou ruído de gradiente e
    ruído em oitavas no esquema do Java (`gradientNoise`, `octaveNoise`,
    `octaveNoise3D`, `noiseSeed`, `hashSalt`), com a mesma dispersão do
    ruído do Minecraft; o resto dela ficou igual;
  - `sift/terrain.js` — o terreno do Sift como função pura de (x, z), no
    mesmo esquema do `planetTerrain.js` dos planetas: altura, bioma,
    superfície, cavernas, minérios, lagos, monólitos, arcos, plantas e a
    lista de estruturas de cada chunk;
  - `sift/worldgen.js` — registro da dimensão, o gerador (escreve as colunas
    com o orçamento de blocos, põe árvores e portais abandonados), criaturas,
    névoa do subsolo e bioma;
  - `sift/ancient_city.js` — as Ardósias Sonoras da Cidade Ancestral;
  - `sift/portal.js`, `sift/teleport.js`, `sift/singer.js` — console sonoro,
    portal e viagem, Cantora;
  - `sift/blocks.js`, `sift/items.js`, `sift/mobs.js`, `sift/advancements.js`.
- `tools/validate.py` confere as referências cruzadas; `tools/build.py` gera
  o `.mcaddon`.

### Diagnóstico

`/scriptevent the_sift:debug` mostra o estado do gerador (semente, chunks
escritos, fila, estruturas pendentes) e os últimos erros. Se algo der errado no Sift,
mande a saída desse comando e o log de conteúdo.

Para regenerar a partir do jar:

```
unzip mielons-the-sift-1.0.2-FIX-mc26.3-fabric.jar -d jar/
python3 tools/port.py jar/        # precisa de Pillow
python3 tools/validate.py
python3 tools/build.py
```

## Traduções

Inglês, português do Brasil (nova), polonês e coreano (as do mod).

## Créditos e licença

- **Mielon** — autor do mod original *Mielon's The Sift* (licença MIT, incluída
  em `LICENSE` e dentro dos pacotes). [@MielonDev](https://x.com/MielonDev)
- **ImpSteve** — textura do Farejador Sombrio
- **Fuzja Jądrowa** — música do disco *Rift*
- API de geração procedural do add-on **Galactic Horizons**
