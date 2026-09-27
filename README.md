# Dragon-forge-
Addon

## Rick 01 — dimensão `rick:01`

Behavior pack em [`rick01_BP/`](rick01_BP) (pronto para instalar: [`dist/rick01_BP.mcpack`](dist/rick01_BP.mcpack)).

- Cria a dimensão customizada **`rick:01`** com a Custom Dimension API do `@minecraft/server`
  (`dimensionRegistry.registerCustomDimension` no startup, igual ao exemplo oficial
  [microsoft/minecraft-samples/custom_dimensions](https://github.com/microsoft/minecraft-samples/tree/main/custom_dimensions)).
- O terreno é gerado pela `world_generator_API.js` **em volta do jogador, do chunk mais perto para
  o mais longe**, e é uma **cópia exata do overworld deste mundo nas mesmas coordenadas**: o jogo
  carrega/gera o mesmo chunk do overworld pela seed e ele é copiado inteiro (minérios, cavernas,
  árvores, água, vilas, baús…). Mobs não são copiados.
- A construção do `RAMNeighbourhood.mcworld` (o quadrado dos prints, X -293…203, Z -278…244) fica
  com o centro em X 0 / Z 0, cortada em um pedaço por chunk que nasce junto com o terreno. A altura
  é a do chão do overworld no centro do quadrado (medida na primeira vez); abaixo dela vem o
  overworld copiado, sem camadas extras.

### Comando

`/rick:01` — leva você para o meio da construção, na dimensão `rick:01`.

### Como ativar

1. Abra o `dist/rick01_BP.mcpack` para importar.
2. Nas configurações do mundo, ative o pack (API estável `@minecraft/server` `2.8.0`,
   Minecraft 1.26.10 ou mais novo).
3. Deixe o addon **Portal Gun** ativo também: a construção tem blocos dele (`ram_pg:beaker`, soluções…).

Se algo der errado, o erro aparece no chat com `[rick:01]`.

### Regerar a construção

```sh
pip install amulet-leveldb amulet-nbt==2.1.5 numpy
python3 tools/export_build.py <pasta_do_mundo_extraido> rick01_BP
```
