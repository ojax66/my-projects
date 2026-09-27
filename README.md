# Dragon-forge-
Addon

## Rick 01 — dimensão `rick:01`

Behavior pack em [`rick01_BP/`](rick01_BP) (pronto para instalar: [`dist/rick01_BP.mcpack`](dist/rick01_BP.mcpack)).

- Cria a dimensão customizada **`rick:01`**.
- Coloca a construção inteira do `RAMNeighbourhood.mcworld` com o **centro em `0 107 0`**:
  o quadrado dos prints (X -293…203, Z -278…244) vira X -248…248, Z -261…261, e o chão de
  grama fica em Y 106, então você chega em pé no gramado. Vêm junto baús, placas, estantes,
  molduras, suportes de armadura, pinturas e carrinhos com baú.
- O resto da dimensão é uma **cópia exata do overworld deste mundo, nas mesmas coordenadas**
  (usando a `world_generator_API.js`). Quando um chunk da `rick:01` vai ser gerado, o script
  faz o próprio jogo carregar/gerar o mesmo chunk do overworld pela seed e copia ele inteiro:
  se em uma coordenada do overworld tem um diamante, na `rick:01` tem o mesmo diamante —
  e o mesmo vale para cavernas, árvores, água, vilas e baús de estruturas.
  - Dentro do quadrado da construção só é copiado o que fica abaixo dela (até Y 102); o espaço
    entre o chão do overworld e a construção vira pedra com terra em cima.
  - Mobs não são copiados.
  - O que for gerado no overworld por causa disso fica salvo no overworld também (é o jogo
    gerando aqueles chunks), e alterações feitas no overworld antes da cópia vêm junto.

### Comandos

| Comando | O que faz |
| --- | --- |
| `/rick:01` | Teleporta você para `0 107 0` na dimensão `rick:01` |
| `/rick:01 @p` | Mesmo, para outro jogador (funciona em bloco de comando) |
| `/rick:voltar` | Volta para onde você estava antes do teleporte |

Na primeira vez a construção é colocada aos poucos (72 pedaços de 64×64); a barra de ação mostra
o progresso. Se o mundo fechar no meio, continua de onde parou.

### Como ativar

1. Abra o `dist/rick01_BP.mcpack` para importar.
2. Nas configurações do mundo, ative o pack (não precisa de experimento nenhum).
3. Deixe o addon **Portal Gun** ativo também: a construção tem blocos dele (`ram_pg:beaker`, soluções…).

Usa a API estável `@minecraft/server` `2.8.0` (Minecraft 1.26.10 ou mais novo). Se algo der
errado (por exemplo, a dimensão não ser criada), o erro aparece no chat com `[rick:01]`.

### Regerar a construção

```sh
pip install amulet-leveldb amulet-nbt==2.1.5 numpy
python3 tools/export_build.py <pasta_do_mundo_extraido> rick01_BP
```
