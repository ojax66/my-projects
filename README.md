# Dimensão do Espaço

Addon de Minecraft Bedrock que adiciona a dimensão do **espaço sideral**: escura,
cheia de estrelas, sem gravidade, com o Sol, a Terra, a Lua e Marte construídos
como esferas gigantes. Serve de ponte entre o **Spacecraft (Venzenulon-7)** e o
**Vehicles 3.0** — entrar na Lua e em Marte leva pros planetas do Spacecraft, e
dá pra chegar lá de OVNI.

```
tools/build.sh          →  dist/Space_Dimension.mcaddon
tools/test.sh           →  validação dos packs + testes de geração e de viagem
packs/Space Dimension BP/   comportamento (dimensão, bioma, blocos, scripts)
packs/Space Dimension RP/   visual (texturas, névoa, céu preto, estrelas)
```

## Instalação

1. `bash tools/build.sh` gera `dist/Space_Dimension.mcaddon`.
2. Abre o arquivo no Minecraft (ele importa os dois packs de uma vez).
3. No mundo, ativa **Dimensão do Espaço** (BP) e **Dimensão do Espaço RP** (RP),
   junto com o Spacecraft e o Vehicles.
4. É preciso ligar **Beta APIs** nas configurações do mundo — o addon usa
   `@minecraft/server` 2.8.0, igual ao Spacecraft.

O addon funciona sozinho, mas a Lua e Marte só têm pra onde levar com o
Spacecraft ativo, e o OVNI só existe com o Vehicles ativo.

## Como chegar

**Subindo até Y 800 — no Overworld, na Lua ou em Marte.** É a mesma altitude em
que o Spacecraft troca o foguete de dimensão durante o lançamento (`launch.js`,
`yPos > 800`, o ponto em que aparece o overview e o jogador vai pra Lua), e ela
vale igual nos três mundos. Quem sobe do Overworld chega ao lado da Terra, quem
sobe da Lua chega ao lado da Lua, quem sobe de Marte chega ao lado de Marte.
Vale de OVNI, de elytra ou voando no criativo.

**De OVNI, e o OVNI vai junto** — na ida, na volta pra Terra e no pouso na Lua e
em Marte. A única montaria que não viaja é o foguete do Spacecraft: o lançamento
dele tem coreografia própria e interromper no meio quebra a viagem.

Atalho pra teste: `/scriptevent space_dim:go` (sobe até a altitude de saída) e
`/scriptevent space_dim:info` (mostra o estado da dimensão e da respiração).

## O que tem lá

Quatro esferas ocas, geradas conforme o jogador se aproxima. O jogador chega
entre a Terra e a Lua, com as duas à vista.

| Corpo | Raio | Centro | Entrar nele leva pra | Subir a Y 800 de lá |
|---|---|---|---|---|
| **Sol** | 100 | −520, 128, 120 | atravessável — queima, não teleporta | — |
| **Terra** | 26 | 0, 128, 0 | Overworld | volta pro espaço |
| **Lua** | 12 | 0, 128, 190 | `nv_sc:moon` (Lua do Spacecraft) | volta pro espaço |
| **Marte** | 20 | 520, 128, −120 | `nv_sc:mars` (Marte do Spacecraft) | volta pro espaço |

O Sol é ~4× a Terra em raio. Na escala real seriam 109×, o que faria a Terra
sumir; a proporção aqui segue as representações de livro didático, com a Terra
um pouco maior do que nelas.

### Os blocos

Cada corpo tem blocos próprios, 15 no total, gerados por
`tools/make_block_textures.py`:

| Corpo | Blocos |
|---|---|
| **Sol** | coroa, plasma, núcleo |
| **Terra** | oceano profundo, água rasa, continente, floresta, calota polar |
| **Lua** | regolito claro, regolito, regolito escuro |
| **Marte** | poeira, rocha, basalto, gelo seco |

As texturas seguem o jeito do jogo: **4 cores chapadas cada uma**, sem
gradiente, com o ruído aparecendo como mancha de pixel. Não há cratera nem
mancha desenhada dentro de um bloco — quem desenha as manchas grandes é o
gerador da esfera, trocando de bloco conforme o ruído. Por isso um mare lunar
é uma região escura de centenas de blocos, como na Lua de verdade, em vez de
cada bloco carregar o mesmo buraquinho repetido.

As paletas vieram das referências: a da Lua é literalmente a do print
(`#D9E4FF` … `#505666`), a do Sol são os anéis do sol do jogo, a da Terra o
azul e o verde saturados do ícone, a de Marte a ferrugem do bloco.

As proporções são calibradas pelos percentis reais do ruído em cada
superfície, não por chute — e há teste travando cada faixa:

| Terra | | Lua | | Marte | |
|---|---|---|---|---|---|
| oceano | 55% | regolito claro | 44% | poeira | 59% |
| água rasa | 15% | regolito | 43% | rocha | 33% |
| continente | 18% | regolito escuro | 13% | basalto | 6% |
| floresta | 10% | | | gelo | 1,5% |
| calota | 2,6% | | | | |

Ou seja, a Terra fica com os 70% de água que ela tem de verdade, e a Lua com
os mares escuros minoritários.

### O Sol: atravessável e mortal

O Sol **não é maciço**. Coroa e plasma são cascas sem colisão, com vácuo entre
elas, e no meio há o núcleo sólido. Uma coluna pelo centro é:

```
coroa(28..31)  ⋯vácuo⋯  plasma(66..68)  ⋯vácuo⋯  núcleo(106..150)  ⋯vácuo⋯  plasma  ⋯vácuo⋯  coroa
```

Quem furar o calor entra de verdade, camada por camada, e tem onde pousar no
fim. Os três blocos emitem luz 15 — no vácuo preto, sem isso o Sol seria só
uma silhueta.

**O calor começa muito antes da superfície.** A 70 blocos dela o jogador já
pega fogo, e a intensidade cresce a cada bloco: perto da superfície são ~10 s
de fogo renovados a cada meio segundo, e lá dentro entra dano direto que
escala até o núcleo. Dar a volta pra admirar é seguro; chegar perto é
assustador; entrar sem preparo é morte.

O "quase impossível" tem uma saída de propósito: **resistência a fogo**. Com
ela o campo não queima e o núcleo vira um destino de verdade. Dá pra fechar
essa brecha em `FIRE_RESISTANCE_PROTECTS`, no config.

O Sol e Marte ficam bem além da distância de renderização, então a action bar
mostra uma bússola com rumo (`<` `|` `>`) e distância de cada corpo.

### Voltar

Encostar na Terra devolve pro Overworld, nas coordenadas X/Z de onde o jogador
saiu, a Y 300 e com slow falling — uma reentrada, não uma cratera.

## Gravidade

**Longe de tudo não há gravidade.** O jogador não cai: não sobe nem desce
sozinho, só para de seguir a física de queda e se desloca pros lados.
**Pular sobe, agachar desce.**

**Perto de um corpo, ele puxa.** A força cresce com o inverso do quadrado da
distância, como a de verdade, e some suave na borda do alcance em vez de ligar
de repente:

| Corpo | Alcance além da superfície | Força na superfície |
|---|---|---|
| Sol | 150 blocos | 0,055 |
| Terra | 46 | 0,030 |
| Marte | 38 | 0,022 |
| Lua | 26 | 0,012 |

Vale pro jogador, pro veículo que ele estiver pilotando (é o Sol arrastando o
OVNI junto) e pras entidades soltas — item largado perto da Lua cai nela.
Pilotando, quem leva o puxão é o veículo; a pé, o componente horizontal vai por
`applyKnockback` e o vertical entra no controlador de altitude, que já mantém um
Y-alvo por jogador. Chegar perto da Terra deixa de ser flutuar e passa a ser
cair.

Por baixo é um controlador de altitude: cada jogador tem um Y-alvo e, a cada
tick, levitação é ligada ou desligada pra corrigir a diferença. Com slow falling
sempre ativo, a queda entre uma correção e outra é lenta, e a oscilação fica em
poucos centésimos de bloco — lê como estar boiando. Encostou num bloco (pousou
na Terra, na Lua), o alvo passa a acompanhar o jogador e ele anda normal.

Montado no OVNI o controlador sai do caminho: o OVNI já tem `has_gravity: false`
e controle de voo próprio.

**Não existe void que mata.** O alvo do controlador é limitado à faixa segura, e
há uma rede embaixo: quem chegar perto do fundo da dimensão é devolvido pra
cima. Montado, quem sobe é o veículo — teleportar o passageiro sozinho o
desmontaria no meio do nada.

## Pressão do Sol e os dois equipamentos

Resistência a fogo resolve o **calor** e é o que permite entrar no Sol. Mas lá
dentro continua a **pressão**, e ela é outra coisa: 6 de dano por segundo, mais
lentidão e cegueira.

Contra isso há dois degraus, e a diferença entre eles é o ponto:

| | Calor da aproximação | Calor dentro do Sol | Pressão |
|---|---|---|---|
| nada | queima | queima | 6/s |
| **Traje Espacial Reforçado** | protege | queima | 2/s (corta 65%) |
| **Armadura de Estrela** | protege | protege | nenhuma |

O traje **ajuda**; a armadura **anula**. Dá pra encostar no Sol de traje e
entrar correndo com uma poção; morar lá dentro só de armadura.

Isso fecha um ciclo: a primeira ida ao núcleo é de traje reforçado e poção,
correndo, só pra arrancar alguns blocos e sair antes do esmagamento. Com o que
se traz de lá sai a armadura — e aí o Sol vira um lugar onde dá pra ficar.

## Traje Espacial Reforçado

É o traje do **Spacecraft** melhorado com materiais dos planetas deles. Fica
entre o traje comum e a armadura de estrela.

Receita, por peça, na bancada normal (a peça do traje deles no meio):

```
 H M H       H  liga de termita      — a parte que aguenta calor
 A S A       M  barra de magnetita   (Marte)
 T F T       A  liga de andrenita    (Andrella)
             T  placa de titânio     (Lua) — estrutura contra pressão
             F  tecido isolante
             S  a peça do traje do Spacecraft
```

| Peça | Proteção | Durabilidade |
|---|---|---|
| Capacete | 3 | 480 |
| Peitoral | 7 | 620 |
| Calças | 5 | 580 |
| Botas | 3 | 500 |

O traje base é 3 em tudo, com 320 de durabilidade; a armadura de estrela é
4/9/7/4. O reforçado fica no meio dos dois.

**O modelo e a textura são os do Spacecraft**, apontados por caminho em vez de
copiados: os packs de recurso se fundem no mundo, então referenciar
`textures/nv/moon/entity/spacesuit` e `geometry.nv_sc.nv_moon.spacesuit_*`
funciona, e duplicar a arte de outra pessoa dentro deste addon não seria certo.
Cada caminho emprestado está declarado em `tools/assets/external_assets.json` e
foi conferido contra o addon deles — o validador confere um a um, então um erro
de digitação continua sendo pego.

### Um detalhe de convivência entre addons

O Spacecraft decide se o jogador respira **procurando as quatro peças dele** no
corpo. O traje reforçado ocupa os mesmos espaços com outros ids, então, pra ele,
quem fez o upgrade está sem traje — e sufocaria na Lua justamente por ter
melhorado o equipamento. Uma armadilha feia de cair.

Não dá pra mudar o código deles, mas dá pra usar a chave que eles mesmos têm: a
tag `nv_sc:cant_hurt`, que o loop deles consulta pra suspender o dano de
oxigênio. Enquanto o jogador estiver numa dimensão deles, de traje reforçado e
com a mochila carregada, a tag é reposta a cada tick. Eles a removem sozinhos
quando o jogador está no chão, mas **consultam antes de remover**, dentro do
mesmo tick — então repor uma vez por tick basta, e a ordem entre os dois loops
não importa.

### A linha da armadura

```
destroços de OVNI (Overworld, raros)  →  Molde de Ferraria de Estrela
      │                                       │
      │  duplicar: 7 diamantes + 1 end stone + molde → 2 moldes
      │
núcleo do Sol  →  Bloco de Núcleo Solar  →  9 Fragmentos
                                                │
                        4 Fragmentos + 4 Diamantes → 1 Barra
                                                │
       peça de netherite + Barra + Molde, na bancada de ferraria
                                                │
                                    peça da Armadura de Estrela
```

A barra segue o craft da netherite, trocando o ouro por diamante e a sucata
pelo fragmento. O molde se duplica como os do jogo: gasta o original e devolve
dois.

| Peça | Proteção | Durabilidade |
|---|---|---|
| Capacete | 4 | 610 |
| Peitoral | 9 | 888 |
| Calças | 7 | 832 |
| Botas | 4 | 721 |

Um degrau acima da netherite (3/8/6/3). O conjunto vale **inteiro** — meia
armadura não segura pressão de estrela. Além da pressão ela também poupa do
calor, o que a torna a alternativa permanente à poção.

O modelo veio pronto com capacete, peitoral e botas no mesmo geo;
`tools/make_star_gear.py` divide em três, um por peça, e renomeia os ossos
(`Head` → `head`, `Right Arm` → `rightArm`…) pros nomes do esqueleto do
jogador — sem isso a armadura fica parada enquanto o jogador anda. A calça usa
o modelo padrão do jogo, com a camada 64×32 que veio junto.

As botas cobrem **só o pé**. Os ossos de perna do modelo trazem a perna
inteira, então o gerador corta os cubos nos 4 blocos de baixo. Encolher o cubo
e deixar o `uv` de caixa mostraria o alto da perna esticado no pé, então as
faces laterais passam a ser declaradas uma a uma, puxando as últimas 4 linhas
do desenho da perna; a de cima e a de baixo ficam onde estavam. No pé
espelhado, as faces leste e oeste trocam de lugar — com UV por face o `mirror`
do cubo deixa de valer.

## Destroços de OVNI

O molde só é achado em discos caídos no Overworld — o primeiro elo da corrente
fica fora do espaço de propósito, pra dar pra começar a linha antes de ter ido
lá. São raros (sorteio a cada minuto, ~0,8% de chance por jogador andando),
nunca dois a menos de 400 blocos um do outro, e as coordenadas ficam gravadas
pra recarregar o mundo não gerar outro em cima.

São desenhados por geometria em vez de virem de um `.mcstructure`: um arquivo
NBT binário não daria pra revisar nem ajustar, e assim cada queda sai um pouco
diferente — a direção do rombo no casco e o tamanho do disco mudam.

Três cuidados pra isso não virar vandalismo: só em terreno aberto (o bloco mais
alto precisa ser chão natural, então nada de cair no meio de uma casa), nunca
substitui bloco que não seja terreno, e o baú procura um lugar livre antes de
ser posto. `/scriptevent space_dim:wreck` força uma queda perto, pra ver.

## O renascimento não fica no espaço

Entrar na dimensão do espaço estava mudando o ponto de renascimento dos
jogadores: quem morresse depois acordava lá em cima em vez de voltar pra cama
ou pro spawn do mundo.

O addon não faz isso — não há uma chamada de `setSpawnPoint` nem de
`setDefaultSpawnLocation` em arquivo nenhum. É o próprio jogo que reatribui o
renascimento quando o jogador entra numa dimensão custom.

Como a causa está fora do alcance do addon, o que dá pra fazer é garantir a
regra: **o renascimento de um jogador nunca fica na dimensão do espaço.** O
spawn é anotado antes de cada viagem (numa property, então sobrevive a sair e
voltar do mundo) e devolvido sempre que aparecer apontando pra cá — na troca de
dimensão, ao entrar no mundo, e de 2 em 2 segundos enquanto se está no espaço.
Quem não tinha spawn próprio volta a não ter, ou seja, ao spawn do mundo.

A regra é segura porque não existe jeito legítimo de querer renascer aqui: cama
não funciona em dimensão custom e âncora de renascimento só vale no Nether.

## Respiração

Vale a mesma regra do Spacecraft: **traje completo + mochila de oxigênio com
carga**. Sem isso, dano por vácuo, no mesmo ritmo que o Spacecraft usa na Lua e
em Marte. Também não machuca dentro de um veículo pressurizado, perto de um
distribuidor de oxigênio ligado, ou no criativo/espectador.

**Dentro do OVNI o jogador respira normal** — a cabine conta como pressurizada.

O addon não consome a mochila: o loop do Spacecraft já gasta durabilidade e
atualiza o HUD dela em todo tick, em qualquer dimensão. Duplicar isso gastaria
oxigênio em dobro no espaço.

## Uma pegadinha do Bedrock: versão de receita

Item e bloco aceitam `format_version` novo (`1.21.80`); **receita não**. Ela usa
outro schema, e uma versão que o jogo não reconhece faz o arquivo não carregar
sem avisar nada — a receita simplesmente não aparece na bancada.

As versões usadas aqui:

| Tipo | Versão | De onde vem |
|---|---|---|
| shaped / shapeless | `1.12` | é a que o Spacecraft usa nas dele, que funcionam |
| smithing transform | `1.20.10` | a receita de ferraria nem existia em 1.12 |

A barra de estrela usa `count` no ingrediente em vez de repetir o item oito
vezes, que é como a receita da barra de netherite é escrita no jogo.

`validate.py` trava isso: qualquer receita com versão fora da lista vira erro
de build.

## Ajustes

Tudo que dá pra mexer está em `packs/Space Dimension BP/scripts/space_dim/config.js`:
posição e tamanho dos corpos, altitude de entrada, ritmo da geração, regras de
respiração, gravidade zero, bússola. Alguns que importam:

- `BLOCK_BUDGET_PER_TICK` (2500) — teto de blocos escritos por tick. É ele que
  segura o custo. Perto do Sol, uma única chunk passa de 5 mil blocos: sem teto,
  duas por tick dariam ~10 mil escritas num frame. Estourou, a chunk para onde
  está e **retoma no tick seguinte do ponto exato** — cada chunk guarda um
  cursor de coluna. O Sol inteiro leva ~8 s de geração contínua.
- `GEN_RADIUS_CHUNKS` (5) e `CHUNKS_PER_TICK` (2) — o Venzenulon-7 do Spacecraft
  usa 3/1 e o autor dele avisa no código pra só aumentar depois de confirmar
  estabilidade. Aqui dá pra ser um pouco mais generoso porque a maioria das
  colunas é vácuo e sai de graça. Se pesar em celular, baixa os dois.
- `SUN_HEAT_ENABLED` (true) e o campo `heat` do Sol em `BODIES` — alcance
  (70 blocos além da superfície), tempo máximo de fogo e dano interno.
- `FIRE_RESISTANCE_PROTECTS` (true) — se resistência a fogo é o caminho pra
  entrar no Sol.
- `SPACE_ENTRY_Y` (800) — a altitude de saída.

## Testes

`tools/test.sh` roda a validação dos packs e os testes de geração no Node, com
um stub do `@minecraft/server` — a geometria e o orçamento são JS puro, então dá
pra exercitar tudo fora do jogo.

- **`validate.py`** pega o que quebra silenciosamente no Bedrock: JSON malformado,
  UUID repetido, dependência cruzada errada entre BP e RP, identificador que um
  arquivo declara e outro referencia com outro nome (dimensão, bioma, névoa,
  partícula), textura citada que não existe, import de script que não resolve.
- **`test_bodies.mjs`** — as cascas não têm buraco (nenhuma coluna interna
  vazia), têm no mínimo 3 blocos contínuos de espessura, usam só os blocos
  próprios do addon (e usam todos os 14), os corpos não se sobrepõem e cabem
  nos limites verticais.
- **`validate.py`** confere ainda que cada bloco que as paletas usam tem as
  quatro peças que um bloco custom precisa: JSON no BP, entrada no `blocks.json`
  do RP, entrada no `terrain_texture.json` e o arquivo de textura. Faltando uma,
  o bloco vira cubo roxo no jogo e nada avisa.
- **`test_budget.mjs`** — a chunk mais cara do Sol termina, o teto por tick é
  respeitado, `fillBlocks` agrupa ~8,8 blocos por chamada, e **a geração fatiada
  em vários ticks dá exatamente o mesmo resultado que a de uma passada só**.
- **`test_gear.mjs`** cobre a gravidade (some longe, cresce perto, aponta pro
  centro, o Sol puxa mais que a Terra que puxa mais que a Lua), que pilotando
  quem leva o puxão é o veículo e não o passageiro, que item solto cai e veículo
  pilotado não leva impulso em dobro, que meia armadura não conta, que a pressão
  do Sol machuca sem armadura e não machuca com ela, e que os destroços saem em
  terreno plano, recusam encosta, põem o molde no baú e **não apagam bloco
  construído por jogador** — foi este último que pegou o baú passando por cima
  da guarda.
- **`test_travel.mjs`** roda as rotas de viagem contra um Bedrock falso
  (dimensões, entidades, montaria, `structureManager`, fila de `runTimeout`):
  que subir a Y 800 leva pro espaço do Overworld, da Lua e de Marte mas não do
  Nether; que no the_end legado só a área do planeta conta; que **o OVNI chega
  junto nas quatro rotas e o jogador volta montado**; que o foguete do
  Spacecraft não é sequestrado; e que, com o `structureManager` quebrado de
  propósito, o jogador ainda sai com um veículo do tipo certo em vez de ficar
  a pé no vácuo.
- **`sideview.mjs`** desenha os corpos em ASCII, vistos de fora, pra conferir
  que a Terra parece a Terra (foi assim que se achou uma calota polar que descia
  até ~52° de latitude).
- **`test_sun.mjs`** prova que a coluna central do Sol é
  casca/vácuo/casca/vácuo/núcleo (senão não há o que atravessar), que o calor
  cresce sem nunca esfriar ao se aproximar, que longe não queima e perto queima
  mais, que só dentro há dano direto, que resistência a fogo é o caminho, e que
  nenhum ponto de chegada dos planetas cai dentro do campo de calor.
- **`make_block_textures.py`** falha se uma textura passar de 6 cores (aí já
  não é textura de bloco, é render) ou tiver viés centro/borda alto — o sinal
  de que ela vai virar bolinha repetida numa parede. Foi o que pegou a primeira
  versão da mancha solar, desenhada a partir da distância ao centro do bloco.
- **`validate.py`** confere o `format_version` de cada receita contra o schema
  que ela usa. Uma versão que o jogo não reconhece pra receita faz o arquivo
  inteiro não carregar **em silêncio** — nada no console, a receita só não
  existe na bancada. Foi assim que todas as receitas do addon pararam de uma
  vez, por estarem em `1.21.80`, que é versão de item e bloco, não de receita.
- **`validate.py`** confere também o que vem de outros packs contra
  `tools/assets/external_assets.json`: só os caminhos declarados ali passam sem
  arquivo local, então um `spacesuitt` de digitação é pego, e uma receita que
  cite um item do Spacecraft não declarado também.
- **`validate.py`** confere ainda a cadeia dos itens: ícone com entrada no
  `item_texture.json` e arquivo no lugar, peça vestível com attachable (sem ele
  a armadura fica invisível no corpo), attachable apontando pra geometria que o
  pack define, receita citando só coisa declarada, e `STAR_ARMOR_PIECES` do
  config batendo com os itens que existem — se esse último desandar, a proteção
  simplesmente nunca liga e nada avisa.
- **`validate.py`** também exige que a coroa e o plasma do Sol tenham
  `collision_box: false` e emitam luz, e que o núcleo seja sólido. Regenerar os
  blocos sem isso transformaria o Sol numa bola maciça sem ninguém notar.

## Levar o veículo junto

Teleportar a entidade pra outra dimensão a perde: no destino a chunk ainda não
está carregada, porque nenhum jogador chegou lá. Era o que fazia o OVNI sumir.

O caminho que funciona é o que o próprio Spacecraft usa pra levar mobs dentro do
foguete: guardar o veículo numa **estrutura** (`structureManager.createFromWorld`
com `includeEntities`), apagar o original, e recolocar a estrutura no destino
depois que o jogador chegou. A estrutura leva a entidade inteira — cor, vida,
nome, propriedades.

Um detalhe que morde: a entrada no espaço é a Y 800, muito acima do teto do
Overworld (320), e não dá pra salvar estrutura fora dos limites da dimensão. Por
isso o veículo desce pra um Y válido antes de ser salvo — teleporte dentro da
mesma dimensão, que é confiável. Se mesmo assim a estrutura falhar, o addon cria
um veículo novo do mesmo tipo: perde a cor, mas ninguém fica a pé no vácuo.

## Uma modificação no `world_generator_API.js`

O arquivo veio pronto e está quase intacto, com uma correção: `syncTickingArea`
é `async` e era chamado todo tick. Os ticks que passavam enquanto a primeira
criação de área ainda não tinha resolvido viam o mapa vazio e disparavam outra
criação — dezenas de áreas de ticking (`wgen_..._1`, `_2`, `_3`...) nos primeiros
segundos, e só a última ficava registrada; as outras vazavam. Agora há uma trava
por jogador enquanto a criação está em voo.

## Se a dimensão não abrir

O bioma `space_dim:espaco_sideral` é um bioma custom usado como `default_biome`
da dimensão. Se a versão do jogo não engolir isso, a dimensão não registra e
`/scriptevent space_dim:info` responde `dimensão: não registrada`. O contorno é
trocar, em `packs/Space Dimension BP/dimensions/outer_space.json`:

```json
"minecraft:default_biome": { "biome": "minecraft:the_end" }
```

O céu preto e a névoa continuam vindo do RP (o Spacecraft faz exatamente isso
com o Venzenulon-7), mas aí o bioma deixa de se chamar espaço sideral.
