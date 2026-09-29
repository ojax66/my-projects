# Dragon-forge-
Addon

## Rick's Multiverse — 55 dimensões `rick:01` … `rick:55`

Behavior pack em [`rick01_BP/`](rick01_BP). Prontos para instalar (gerados por `python3 tools/build_packs.py`):

- [`dist/Ricks_Multiverse.mcpack`](dist/Ricks_Multiverse.mcpack) — completo: clones do overworld + cidade do Rick.
- [`dist/Ricks_Multiverse_Overworld.mcpack`](dist/Ricks_Multiverse_Overworld.mcpack) — **só os clones do
  overworld**, sem a cidade; o comando leva para o chão em X 0 / Z 0.

As duas criam as mesmas dimensões e comandos: ative só uma delas no mundo.

- Cria **55 dimensões customizadas**, `rick:01` até `rick:55`, com a Custom Dimension API do
  `@minecraft/server` (`dimensionRegistry.registerCustomDimension` no startup, igual ao exemplo oficial
  [microsoft/minecraft-samples/custom_dimensions](https://github.com/microsoft/minecraft-samples/tree/main/custom_dimensions)).
  A lista fica em [`scripts/rick01/dimensions.js`](rick01_BP/scripts/rick01/dimensions.js).
- Todas fazem a mesma coisa. O terreno é gerado pela `world_generator_API.js` (versão do Galactic
  Horizons) **até onde o jogador enxerga (raio de 6 chunks), primeiro o que está na frente dele**, e é
  uma **cópia exata do overworld deste mundo nas mesmas coordenadas**: uma ticking area no overworld
  acompanha o jogador, o jogo gera aqueles chunks pela seed e cada um é copiado (minérios, cavernas,
  árvores, água, vilas, baús e as entidades que estiverem nele) em fatias de 16×16×16 blocos.
- A construção do `RAMNeighbourhood.mcworld` (o quadrado dos prints, X -293…203, Z -278…244) fica
  com o centro em X 0 / Z 0 em cada dimensão, cortada em um pedaço por chunk que nasce junto com o
  terreno. A altura é a do chão do overworld no centro do quadrado; abaixo dela vem o overworld
  copiado, sem camadas extras.
- Mobs nascem como no overworld: animais do bioma (lido do overworld) de dia, monstros no escuro,
  slimes nos slime chunks e em pântanos, peixes e lulas na água.

### Otimização

- **Um orçamento por tick para todas as dimensões juntas** (no máximo 10 fatias de 4096 blocos e
  12 ms de script por tick): 55 dimensões gerando ao mesmo tempo nunca fazem mais trabalho por tick
  do que uma sozinha. Um chunk que não terminou continua no próximo tick de onde parou.
- **Cada gerador só liga quando alguém entra naquela dimensão**; as que ninguém visitou não gastam
  nada.
- Pedidos de chunk do overworld, a altura da construção e os arquivos de estrutura são
  **compartilhados** entre as 55 (o pack não cresce). Um espelho no overworld por jogador e um
  spawner só, que passa pelas dimensões onde tem alguém.

- **O centro (X 0 / Z 0) das 55 dimensões é gerado quando o mundo abre**, uma de cada vez em segundo
  plano (dentro do mesmo orçamento por tick). As que já estão prontas ficam salvas no mundo. Assim a
  Portal Gun (`0 100 0 rick:NN` na tela "Definir Local") acha chão em qualquer dimensão, mesmo sem
  ninguém ter entrado nela antes.

### Comandos

`/rick:rick01` … `/rick:rick55` — leva você para o meio da construção na dimensão com o mesmo número.

### Como ativar

1. Abra o `.mcpack` da versão que quiser para importar.
2. Nas configurações do mundo, ative o pack (API estável `@minecraft/server` `2.8.0`,
   Minecraft 1.26.10 ou mais novo).
3. Deixe o addon **Portal Gun** ativo também: a construção tem blocos dele (`ram_pg:beaker`, soluções…).

Erros (ex.: ticking area sem espaço) não aparecem no chat: vão para o log de conteúdo com
`[rick]`, e a etapa que falhou é tentada de novo sozinha.

### Regerar a construção

```sh
pip install amulet-leveldb amulet-nbt==2.1.5 numpy
python3 tools/export_build.py <pasta_do_mundo_extraido> rick01_BP
```
