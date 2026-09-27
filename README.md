# Dragon-forge-
Addon

## Rick 01 — dimensão `rick:01`

Behavior pack em [`rick01_BP/`](rick01_BP) (pronto para instalar: [`dist/rick01_BP.mcpack`](dist/rick01_BP.mcpack)).

- Cria a dimensão customizada **`rick:01`** com a Custom Dimension API do `@minecraft/server`
  (`dimensionRegistry.registerCustomDimension` no startup, igual ao exemplo oficial
  [microsoft/minecraft-samples/custom_dimensions](https://github.com/microsoft/minecraft-samples/tree/main/custom_dimensions)).
- O terreno é gerado pela `world_generator_API.js` (versão do Galactic Horizons) **até onde o jogador
  enxerga (raio de 6 chunks), primeiro o que está na frente dele**, e é uma **cópia exata do overworld
  deste mundo nas mesmas coordenadas**: uma ticking area no overworld acompanha o jogador, o jogo
  gera aqueles chunks pela seed e cada um é copiado inteiro (minérios, cavernas, árvores, água, vilas,
  baús e as entidades que estiverem nele). A cópia é feita em fatias de 16×16×16 blocos, no máximo
  10 fatias (e 12 ms de script) por tick; um chunk que não terminou continua no próximo tick.
- Mobs nascem como no overworld: animais do bioma (lido do overworld) de dia, monstros no escuro,
  slimes nos slime chunks e em pântanos, peixes e lulas na água.
- A construção do `RAMNeighbourhood.mcworld` (o quadrado dos prints, X -293…203, Z -278…244) fica
  com o centro em X 0 / Z 0, cortada em um pedaço por chunk que nasce junto com o terreno. A altura
  é a do chão do overworld no centro do quadrado (medida na primeira vez); abaixo dela vem o
  overworld copiado, sem camadas extras.

### Comando

`/rick:rick01` — leva você para o meio da construção, na dimensão `rick:01`.

### Como ativar

1. Abra o `dist/rick01_BP.mcpack` para importar.
2. Nas configurações do mundo, ative o pack (API estável `@minecraft/server` `2.8.0`,
   Minecraft 1.26.10 ou mais novo).
3. Deixe o addon **Portal Gun** ativo também: a construção tem blocos dele (`ram_pg:beaker`, soluções…).

Erros (ex.: ticking area sem espaço) não aparecem no chat: vão para o log de conteúdo com
`[rick:01]`, e a etapa que falhou é tentada de novo sozinha.

### Regerar a construção

```sh
pip install amulet-leveldb amulet-nbt==2.1.5 numpy
python3 tools/export_build.py <pasta_do_mundo_extraido> rick01_BP
```
