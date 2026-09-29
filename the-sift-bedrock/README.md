# Mielon's The Sift — port para Minecraft Bedrock

Port do mod Fabric **Mielon's The Sift 1.0.2** (Minecraft Java 26.3) para
add-on do Bedrock. **Mínimo: Bedrock 26.40.** Usa a API de script estável
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
   *Diferença do Bedrock:* o add-on não consegue alterar a estrutura da
   Cidade Ancestral, então, se não houver ardósias sonoras perto da moldura,
   a própria Cantora ergue as oito na frente dela, na mesma disposição do mod.
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
| Dimensão do Sift (altura 0–256) | ✅ dimensão custom, terreno gerado por script |
| Biomas (ermos, clareira, floresta, encostas, picos, picos nevados de ichor, escuro profundo) | ✅ recriados no gerador; o nome aparece na tela ao mudar de bioma, com névoa própria |
| Lagos de Ichor, cavernas, minérios nas faixas do mod | ✅ |
| Salgueiros Tomados e Portais Abandonados (com baú e loot) | ✅ estruturas originais convertidas pra `.mcstructure` |
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
| Céu procedural, shaders do portal/fenda, chuva de ichor | ⚠️ trocados por cor de céu, névoa, textura animada e partículas |

## Como foi feito

- `tools/port.py` lê o `.jar` do mod e gera todo o conteúdo dos pacotes:
  JSON de blocos/itens/entidades, texturas, sons, traduções, receitas, loot
  tables e as estruturas (`.nbt` do Java → `.mcstructure` do Bedrock).
  Os modelos e animações das criaturas são GeckoLib, que já usa o formato de
  geometria do Bedrock; o script só renomeia e converte os keyframes.
- `packs/TheSift_BP/scripts/` são os scripts, escritos à mão:
  - `lib/world_generator_API.js` e `lib/budget.js` — a API de geração
    procedural do **Galactic Horizons**, usada sem alterações;
  - `sift/terrain.js` — o relevo do Sift como função pura de (x, z);
  - `sift/worldgen.js` — registro da dimensão, gerador, árvores/estruturas,
    criaturas, névoa e bioma;
  - `sift/portal.js`, `sift/teleport.js`, `sift/singer.js` — console sonoro,
    portal e viagem, Cantora;
  - `sift/blocks.js`, `sift/items.js`, `sift/mobs.js`, `sift/advancements.js`.
- `tools/validate.py` confere as referências cruzadas; `tools/build.py` gera
  o `.mcaddon`.

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
