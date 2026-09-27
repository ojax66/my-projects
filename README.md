# Dragon-forge-
Addon

## Rick 01 — dimensão `rick:01`

Behavior pack em [`rick01_BP/`](rick01_BP) (pronto para instalar: [`dist/rick01_BP.mcpack`](dist/rick01_BP.mcpack)).

- Cria a dimensão customizada **`rick:01`**.
- Coloca a construção inteira do `RAMNeighbourhood.mcworld` com o **centro em `0 107 0`**:
  o quadrado dos prints (X -293…203, Z -278…244) vira X -248…248, Z -261…261, e o chão de
  grama fica em Y 106, então você chega em pé no gramado. Vêm junto baús, placas, estantes,
  molduras, suportes de armadura, pinturas e carrinhos com baú.
- O resto da dimensão é gerado com a `world_generator_API.js`: terreno estilo overworld
  (oceanos, rios, praias, colinas, montanhas com neve, planície, floresta, bétula, taiga,
  neve, deserto, savana, cavernas, minérios, árvores e flores). Perto da construção o terreno
  sobe devagar até o nível dela.

### Comandos

| Comando | O que faz |
| --- | --- |
| `/rick:tp01` | Teleporta você para `0 107 0` na dimensão `rick:01` |
| `/rick:tp01 @p` | Mesmo, para outro jogador (funciona em bloco de comando) |
| `/rick:voltar` | Volta para onde você estava antes do teleporte |

Na primeira vez a construção é colocada aos poucos (72 pedaços de 64×64); a barra de ação mostra
o progresso. Se o mundo fechar no meio, continua de onde parou.

### Como ativar

1. Abra o `dist/rick01_BP.mcpack` para importar.
2. Nas configurações do mundo, ative o pack e o experimento **APIs Beta** (e ative os cheats para
   usar os comandos).
3. Deixe o addon **Portal Gun** ativo também: a construção tem blocos dele (`ram_pg:beaker`, soluções…).

Feito para o Minecraft **1.26.44** (`@minecraft/server` `2.10.0-beta`). No 1.26.5x, troque em
`rick01_BP/manifest.json` a versão para `2.11.0-beta`.

### Regerar a construção

```sh
pip install amulet-leveldb amulet-nbt==2.1.5 numpy
python3 tools/export_build.py <pasta_do_mundo_extraido> rick01_BP
```
