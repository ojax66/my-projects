/* =========================================================================
 * Dimensão do Espaço — configuração central.
 *
 * Tudo que dá pra ajustar sem mexer na lógica está aqui: posição e tamanho
 * dos corpos celestes, altitude de entrada, ritmo da geração e as regras de
 * respiração. Os ids de dimensão do Spacecraft e do Vehicles ficam aqui
 * também, num só lugar, pra facilitar se algum addon renomear alguma coisa.
 * ========================================================================= */

export const DIMENSION_ID = "gh:outer_space";

// Limites verticais — precisam bater com dimensions/outer_space.json.
export const DIM_MIN_Y = -64;
export const DIM_MAX_Y = 320;

// Plano "eclíptico": todos os corpos celestes ficam centrados nesse Y.
export const ORBIT_Y = 128;

// ---------------------------------------------------------------------------
// Entrada no espaço
// ---------------------------------------------------------------------------
// Mesma altitude em que o Spacecraft troca o foguete de dimensão durante o
// lançamento (launch.js: `yPos > 800` → aparece o overview e o jogador vai pra
// Lua). Subir até aqui no Overworld — de OVNI, de foguete próprio, de elytra ou
// voando no criativo — leva pro espaço.
export const SPACE_ENTRY_Y = 800;

// Onde o jogador aparece ao chegar no espaço fica em BODIES[].arrival, um por
// corpo: quem sobe do Overworld aparece do lado da Terra, quem sobe da Lua do
// lado da Lua, e assim por diante.
// Espalha a chegada num raio pequeno pra dois jogadores não aparecerem
// exatamente no mesmo bloco.
export const ARRIVAL_JITTER = 4;

// Folga entre o ponto de chegada e a BORDA DO CAMPO DE GRAVIDADE do corpo de
// onde se veio — não a superfície dele.
//
// Chegar dentro do campo era o bug: o jogador é teleportado, fica uns ticks
// parado enquanto o veículo é recolocado, e nesse tempo o planeta o arrastava
// pra longe do OVNI. Ele montava no vazio, ou não montava. Da Terra, que puxa
// mais forte, dava pra ser levado até a superfície e cair de volta no Overworld
// achando que a nave tinha sumido.
//
// tools/tests/test_arrival.mjs confere isto pra cada corpo, com o jitter no
// pior caso, e também que nenhuma chegada cai no campo de OUTRO corpo.
export const ARRIVAL_CLEARANCE = 12;

// Altitude de reentrada no Overworld ao entrar na Terra.
export const OVERWORLD_REENTRY_Y = 300;

// Carência, em ticks (100 = 5 s), logo após chegar ao espaço: nesse intervalo
// encostar num corpo celeste não teleporta. Evita disparar uma viagem no
// mesmo instante da chegada, e evita repetir mensagem de erro a cada tick.
export const ARRIVAL_GRACE_TICKS = 100;

// ---------------------------------------------------------------------------
// Corpos celestes
//
// Cada corpo é uma casca esférica oca (`shell` blocos de espessura radial).
// `portal` diz pra onde entrar nele leva; `null` = só cenário (o Sol).
// As distâncias seguem a ideia de representação de livro didático: o Sol é
// muito maior que os planetas, mas a Terra é um pouco maior do que ficaria
// numa escala real (senão seria um ponto perto de um Sol de 100 de raio).
// ---------------------------------------------------------------------------
export const BODIES = [
  {
    id: "sun",
    name: "§6Sol",
    center: { x: -520, y: ORBIT_Y, z: 120 },
    radius: 100,
    // O modelo do Sol é VOLUMÉTRICO: cascas concêntricas translúcidas em vez de
    // um cubo com textura por face.
    //
    // Medindo a referência, o brilho dela não cai ao atravessar a aresta interna
    // do cubo, e os anéis seguem a SILHUETA — hexagonais de quina, quadrados de
    // frente. Nenhuma textura por face faz isso: a silhueta muda com o ângulo, e
    // qualquer borda escura desenhada na face escurece as arestas internas
    // junto. O que produz aquilo é luz somada ao longo do caminho dentro do
    // corpo, e é isso que as cascas fazem.
    volumetric: true,
    // Como o Sol se vê POR DENTRO: pela NEBLINA, não por um modelo.
    //
    // Tentei um modelo de interior — poucas cascas, cor de brasa — e ele não
    // pode funcionar: o material é opaco (ver a nota da atmosfera da Terra),
    // então um cubo em volta do jogador é uma parede de cor sólida. Trocaria o
    // branco chapado por um vermelho chapado.
    //
    // Quem resolve é FOG_INSIDE_ID: a tela inteira fica da cor do Sol, que é o
    // que estar dentro dele tem que parecer, e ainda dá pra ver a nave e os
    // blocos por perto.
    // O Sol é ATRAVESSÁVEL: coroa e plasma são cascas sem colisão, com vácuo
    // entre elas, e no meio o núcleo sólido. Quem furar o calor entra de
    // verdade, camada por camada, até ter onde pousar.
    //
    // `shell >= radius` numa camada quer dizer esfera maciça — é assim que o
    // núcleo é gerado.
    // `passable` marca a camada que não tem colisão: dá pra atravessar. A
    // gravidade usa isso pra saber onde existe CHÃO — cair até a coroa não
    // seria cair em lugar nenhum, já que se passa direto por ela.
    layers: [
      // `modelOnly`: esta camada NÃO é construída de blocos — quem a desenha é
      // o modelo visto de longe.
      //
      // Ela não fazia diferença nenhuma: era atravessável, então o jogador
      // passava direto por ela sem nada acontecer, e custava 720 mil blocos —
      // dois terços de todo o Sol. O disco do Sol que se vê é o modelo; a casca
      // de blocos só aparecia como uma película fina que não muda nada.
      { radius: 100, shell: 3, palette: "sun_corona", passable: true, modelOnly: true },
      { radius: 62, shell: 2, palette: "sun_plasma", passable: true },
      { radius: 22, shell: 22, palette: "sun_core" },
    ],
    // Campo de calor: começa BEM antes da superfície. Quanto mais perto, mais
    // tempo de fogo e mais dano — chegar dentro é quase impossível sem
    // resistência a fogo.
    heat: {
      zone: 70,          // blocos além da superfície onde já se pega fogo
      maxFireSeconds: 10,
      insideDamage: 8,   // dano por segundo dentro do Sol
    },
    // Pressão: dentro do Sol o esmagamento é o que mata mesmo quem aguenta o
    // calor. Só a armadura de núcleo de estrela segura.
    pressure: { damage: 6 },
    // O Sol é o mais massivo: puxa de longe e puxa forte. Chegar perto pra
    // "só olhar" já vira uma queda.
    gravity: { reach: 150, strength: 0.055 },
    // Visto de longe o Sol é EMISSIVO: brilha com luz própria, sem depender da
    // iluminação do mundo. É o que o faz cegar mesmo no escuro do espaço.
    glow: true,
    portal: null,
  },
  {
    id: "earth",
    name: "§bTerra",
    center: { x: 0, y: ORBIT_Y, z: 0 },
    radius: 26,
    // Sem blocos: o planeta é o MODELO, e só ele.
    //
    // A versão de blocos piscava na troca com o modelo e não mostrava nada que
    // o modelo já não mostre — as duas têm o mesmo tamanho e o mesmo desenho.
    // Os blocos, as paletas e as texturas continuam todos no addon, intactos,
    // pras dimensões de planeta que vêm depois; o que mudou é só que ninguém os
    // coloca AQUI.
    //
    // Em troca o modelo deixa de ser atravessável: `solid` faz o corpo empurrar
    // quem entrar nele, como um bloco gigante — ver solidBodies() em bodies.js.
    built: false,
    solid: true,
    // Atmosfera: dois anéis opacos em volta da silhueta, no modelo do corpo.
    //
    // Foram três tentativas até a medição resolver.
    //
    // 1. Cascas translúcidas por fora: virou um quadrado azul tapando a Terra.
    //    O pixel dele era (10,19,48) — exatamente a cor da textura da casca,
    //    prova de que o material NÃO mistura.
    // 2. Borda dentro da textura da superfície: não tapa nada, mas o halo fica
    //    preso DENTRO da silhueta, e ele queria o azul passando pra fora.
    // 3. Esta: anéis opacos, que é como o Sol já funciona. Cubos concêntricos
    //    maiores que o corpo, desenhados ANTES dele no mesmo modelo. O cubo do
    //    corpo, desenhado por último, tapa o miolo — e o que sobra visível de
    //    cada anel é a silhueta dele, que acompanha o ângulo da câmera de graça.
    //
    // As cores não são inventadas: são as que ele aprovou, medidas pixel a pixel
    // na imagem que ele mandou, de dentro pra fora. E o Sol provou que a cor da
    // textura sai inteira (casca branca de alfa 128 renderiza 255,255,255), então
    // o que está escrito aqui é o que aparece.
    //
    // Isto exige `DisableDepthWrite` no material, senão o cubo do corpo — que
    // está ATRÁS dos anéis — é recusado pelo teste de profundidade e some.
    // `haze` é o véu que a atmosfera deixa sobre a própria superfície: na
    // imagem que ele aprovou o oceano estava (33,166,255) e a terra
    // (31,191,138), contra (5,117,156) e (3,144,1) da superfície crua. A conta
    // que leva de um ao outro é somar a cor da atmosfera `passes` vezes, e ela
    // reproduz os dois valores no pixel — por isso está aqui como conta, e não
    // como uma cor chutada.
    atmosphere: {
      reach: 1.14,
      rings: ["#305EE6", "#1E3A90"],
      haze: { color: "#0A1430", alpha: 6, passes: 3 },
    },
    layers: [{ radius: 26, shell: 4, palette: "earth" }],
    portal: { kind: "overworld" },
    gravity: { reach: 46, strength: 0.03 },
    // Chegada vinda do Overworld. 90 do centro: a borda do campo dela está em
    // 26 + 46 = 72, e daí saem os 12 de folga mais a margem do jitter. A Lua
    // continua no campo de visão.
    arrival: { x: 0, y: ORBIT_Y, z: 90 },
  },
  {
    id: "moon",
    name: "§7Lua",
    center: { x: 0, y: ORBIT_Y, z: 190 },
    radius: 12,
    built: false,
    solid: true,
    layers: [{ radius: 12, shell: 4, palette: "moon" }],
    // A Lua agora é NOSSA dimensão, não a do Spacecraft. Ver planets.js.
    portal: { kind: "planet", dimension: "gh:moon" },
    // Lua puxa pouco, como na vida real.
    gravity: { reach: 26, strength: 0.012 },
    // Chegada vinda da Lua do Spacecraft: 56 do centro, com a borda do campo
    // dela em 12 + 26 = 38.
    arrival: { x: 56, y: ORBIT_Y, z: 190 },
  },
  {
    id: "venus",
    name: "§eVênus",
    // Entre o Sol e a Terra, que é onde ela está de verdade: a segunda órbita.
    center: { x: -270, y: ORBIT_Y, z: -60 },
    // Vênus tem 95% do diâmetro da Terra — é a gêmea dela em tamanho. A Terra
    // aqui tem raio 26, então 25.
    radius: 25,
    built: false,
    solid: true,
    // AS QUATRO CAMADAS DE ATMOSFERA, que são as de verdade, de fora pra
    // dentro: névoa superior (70–90 km), nuvem superior (57–70 km), nuvem
    // média/baixa (48–57 km) e névoa inferior (30–48 km).
    //
    // As escalas são dramatizadas, como já são na Terra (atmosfera real de
    // 1,002 desenhada a 1,14): na escala certa a nuvem de Vênus daria 1,012 e
    // não se veria nada. O que se mantém é a proporção entre elas e a ordem
    // das cores — clara por fora, laranja por dentro.
    //
    // E o disco NÃO é a superfície: é o topo da nuvem, a 70 km. Ninguém jamais
    // viu o chão de Vênus de fora — foi preciso pousar ou usar radar.
    // Ver tools/make_sky_venus.py.
    atmosphere: {
      reach: 1.26,
      rings: ["#E8DCC4", "#E0CFA0", "#D4B678", "#C09A55"],
      haze: { color: "#C9A05A", alpha: 10, passes: 2 },
    },
    layers: [{ radius: 25, shell: 4, palette: "venus" }],
    portal: { kind: "planet", dimension: "gh:venus" },
    // 0,90 da gravidade da Terra: o campo é mais forte que o de Marte, e o
    // alcance acompanha o raio maior.
    gravity: { reach: 44, strength: 0.030 },
    // A chegada fica do lado de FORA, na direção oposta ao Sol.
    //
    // Direto entre Vênus e o Sol não dá: o campo de calor do Sol vai até 250
    // do centro dele, e Vênus inteira está a 308 — uma chegada a 85 blocos de
    // Vênus voltada pro Sol cairia a 227, ou seja, dentro do forno. Do outro
    // lado ela fica a 393, com folga.
    arrival: { x: -189, y: ORBIT_Y, z: -118 },
  },
  {
    id: "mars",
    name: "§cMarte",
    center: { x: 520, y: ORBIT_Y, z: -120 },
    radius: 20,
    built: false,
    solid: true,
    layers: [{ radius: 20, shell: 4, palette: "mars" }],
    portal: { kind: "planet", dimension: "gh:mars" },
    gravity: { reach: 38, strength: 0.022 },
    // Chegada vinda de Marte do Spacecraft: 76 do centro, com a borda do campo
    // dele em 20 + 38 = 58.
    arrival: { x: 444, y: ORBIT_Y, z: -120 },
  },
];

// Margem, em blocos, além da superfície em que o portal do corpo dispara.
// A casca é sólida, então o jogador encosta nela antes de chegar ao centro.
export const PORTAL_MARGIN = 2.5;

// A que distância da superfície o corpo PARA DE PUXAR.
//
// Três blocos, que foi o número que ele pediu. E ele tem que ser MAIOR OU IGUAL
// ao PORTAL_MARGIN, nunca menor — esta é a regra que importa, e eu a tinha
// escrito errada antes ("tem que ser igual"):
//
//   gravidade desliga ANTES do portal disparar   →  seguro. Sobra uma casca
//     fina onde não há puxão e ainda não há viagem, e não há nada de errado
//     nisso: o jogador só flutua.
//   gravidade desliga DEPOIS                     →  o bug. Existe uma casca em
//     que a viagem já começou e o puxão continua, e é nela que a nave é
//     arrancada no meio do teleporte.
//
// tools/tests/test_gravity_cold_storm.mjs confere a desigualdade.
export const GRAVITY_OFF_MARGIN = 3;

// O calor do Sol pode ser desligado inteiro aqui (o campo `heat` do Sol em
// BODIES é que diz o alcance e a intensidade).
export const SUN_HEAT_ENABLED = true;
// Resistência a fogo poupa do calor? Deixar ligado dá o caminho pra chegar
// dentro do Sol — sem ela é só morte.
export const FIRE_RESISTANCE_PROTECTS = true;

// ---------------------------------------------------------------------------
// Geração
//
// Os valores seguem o que o Venzenulon-7 do Spacecraft usa (3 chunks / 1 por
// tick), com um empurrãozinho: aqui a esmagadora maioria das colunas é vácuo
// e sai de graça. Se em celular pesar, baixe os dois.
// ---------------------------------------------------------------------------
// 7 chunks = 112 blocos em volta do jogador.
//
// Subiu de 5 (80 blocos) junto com o conserto da fila: com a fila descartando
// chunk que não coubesse no orçamento, aumentar o raio só aumentaria o número
// de buracos. Agora que ela termina uma chunk antes de começar a próxima, e na
// ordem do campo de visão, o raio maior vira o que ele devia ser desde sempre:
// mais mundo pronto na frente de quem olha.
export const GEN_RADIUS_CHUNKS = 7;
export const CHUNKS_PER_TICK = 4;

// Teto de blocos escritos por tick. É ELE que segura o custo, não o número de
// chunks: perto do Sol uma única chunk chega a 8 mil blocos, e duas por tick
// sem teto dariam ~16 mil escritas num frame — travadinha garantida.
// Estourou o teto, a chunk para onde está e retoma no tick seguinte, do ponto
// exato onde parou. O Sol inteiro leva uns 12 s de geração contínua.
export const BLOCK_BUDGET_PER_TICK = 6000;

// ---------------------------------------------------------------------------
// Gravidade zero
// ---------------------------------------------------------------------------
// O jogador não cai: um controlador segura o Y dele. Pular sobe, agachar desce.
export const ZERO_G_ENABLED = true;
export const ZERO_G_RISE_PER_TICK = 0.32; // blocos por tick segurando pular
export const ZERO_G_SINK_PER_TICK = 0.32; // blocos por tick agachado
// Faixa segura: fora dela o jogador é empurrado de volta em vez de cair no void.
export const SAFE_MIN_Y = DIM_MIN_Y + 24;
export const SAFE_MAX_Y = DIM_MAX_Y - 16;

// ---------------------------------------------------------------------------
// Gravidade dos corpos
// ---------------------------------------------------------------------------
// Longe de tudo o espaço é sem gravidade. Perto de um corpo ele PUXA: quanto
// mais perto, mais forte, com queda quadrática como a gravidade de verdade.
// Vale pro jogador, pro veículo que ele estiver pilotando e pras entidades
// soltas — item largado perto da Lua cai nela.
export const BODY_GRAVITY_ENABLED = true;
// Quantas vezes por segundo a gravidade age nas entidades soltas. Puxar toda
// entidade todo tick sairia caro à toa; 4 vezes por segundo já lê como queda.
export const ENTITY_GRAVITY_INTERVAL = 5;
// Raio, em blocos, em que as entidades soltas são procuradas ao redor de cada
// jogador. Fora disso nem estão carregadas.
export const ENTITY_GRAVITY_SCAN = 48;

// ---------------------------------------------------------------------------
// Respiração (mesmas regras do Spacecraft)
// ---------------------------------------------------------------------------
export const BREATHING_ENABLED = true;
// Traje completo do Spacecraft + mochila de oxigênio com carga = pode respirar.
// Continua valendo pra quem joga com o addon deles; o traje DAQUI é o de baixo.
export const SPACESUIT_PIECES = [
  { slot: "Head", item: "nv_sc:spacesuit_helmet" },
  { slot: "Chest", item: "nv_sc:spacesuit_chestplate" },
  { slot: "Legs", item: "nv_sc:spacesuit_leggings" },
  { slot: "Feet", item: "nv_sc:spacesuit_boots" },
];
export const OXYGEN_BACKPACK = "nv_sc:oxygen_backpack";

// ---------------------------------------------------------------------------
// Idioma
// ---------------------------------------------------------------------------
// O idioma de tudo que o SCRIPT escreve (avisos, títulos, o rastreador). Os
// NOMES de item e bloco não passam por aqui: eles vêm dos .lang do pack de
// recurso, e quem escolhe é a engrenagem do pack, nas configurações do mundo.
//
// Isto é só o PADRÃO de quem nunca escolheu. Cada jogador troca o dele na
// engrenagem que ganha ao entrar — ver i18n.js e gear.js... (settings.js).
//
// Inglês, e não português: é a língua que mais gente que baixa o addon lê, e
// quem fala outra troca no primeiro toque da engrenagem.
export const IDIOMA_PADRAO = "en";
// A engrenagem: o item que abre a tela de idioma.
export const SETTINGS_ITEM = "gh:settings_gear";
// Marca de que este jogador já ganhou a dele. Sem isto ele ganharia uma a cada
// entrada, e em pouco tempo o inventário seria só engrenagem.
export const SETTINGS_GIVEN_PROP = "gh:gear_given";

// ---------------------------------------------------------------------------
// Lixeira
// ---------------------------------------------------------------------------
// Bloco em que o jogador clica com um item na mão e o item some. Ver
// trashCan.js; o bloco e o modelo saem de tools/make_trash_can.py.
export const TRASH_CAN_BLOCK = "gh:trash_can";

// ---------------------------------------------------------------------------
// Traje básico — o nosso traje de entrada
// ---------------------------------------------------------------------------
// Fabricável na Terra com material do jogo base: é o traje que existe ANTES da
// primeira subida. Ele é SELADO — as quatro peças bastam pra respirar nas
// dimensões deste addon, sem mochila nenhuma (não há item de oxigênio aqui).
// O que ele NÃO faz: não isola do frio do espaço e não segura a pressão do
// Sol. Pra isso é o reforçado, logo abaixo.
export const BASIC_SUIT_PIECES = [
  { slot: "Head", item: "gh:basic_spacesuit_helmet" },
  { slot: "Chest", item: "gh:basic_spacesuit_chestplate" },
  { slot: "Legs", item: "gh:basic_spacesuit_leggings" },
  { slot: "Feet", item: "gh:basic_spacesuit_boots" },
];
// Dentro de qualquer um destes o jogador respira normal — e não congela, que é
// o outro eixo (ver cold.js). A Nave Level 1 é dele, e agora mora aqui dentro:
// o addon dela foi juntado a este, pra não ficarem dois pacotes separados.
// A Level 2 entra junto: ela é a Level 1 reforçada, e seria absurdo a nave que
// aguenta 92 atmosferas de Vênus não pressurizar a cabine no vácuo.
export const PRESSURIZED_VEHICLES = [
  "dlb_van:ufo", "gh:level_1_spaceship", "gh:level_2_spaceship",
];
// Trechos de typeId que também contam como veículo pressurizado (foguete/mech
// do Spacecraft, que já tratam oxigênio por conta própria).
export const PRESSURIZED_VEHICLE_MATCHES = ["_rocket", "space_mech"];

// ---------------------------------------------------------------------------
// Armadura de núcleo de estrela
// ---------------------------------------------------------------------------
// O conjunto INTEIRO é o que protege — meia armadura não segura pressão de
// estrela.
export const STAR_ARMOR_PIECES = [
  { slot: "Head", item: "gh:star_helmet" },
  { slot: "Chest", item: "gh:star_chestplate" },
  { slot: "Legs", item: "gh:star_leggings" },
  { slot: "Feet", item: "gh:star_boots" },
];
// Além da pressão, a armadura também poupa do calor? Ligado: é o que faz dela
// a alternativa permanente à poção de resistência a fogo.
export const STAR_ARMOR_PROTECTS_FROM_HEAT = true;

// --- O que ela faz ALÉM disso (ver starPowers.js) ---------------------------
// A netherite não queima, resiste a repulsão e tem tenacidade. A de estrela
// tem as três, melhores, mais o fogo em quem encosta.
//
// Resistência ao fogo DE VERDADE, no jogador: a netherite protege a peça do
// fogo, esta protege quem a veste.
export const STAR_ARMOR_FIRE_RESISTANCE = true;
// A tenacidade da netherite, na moeda que dá pra aplicar por script: nível de
// Resistência permanente. 1 = Resistência I = 20% de TODO dano a menos,
// inclusive o que armadura nenhuma segura. 0 desliga.
export const STAR_ARMOR_RESISTANCE = 1;
// O empurrão do golpe é desfeito no mesmo tick.
export const STAR_ARMOR_KNOCKBACK_RESISTANCE = true;
// Quantos segundos de fogo leva quem ataca quem está com o conjunto. 0 desliga.
export const STAR_ARMOR_BURN_SECONDS = 8;
// Outro jogador também pega fogo? Desligado: numa briga entre dois, quem tem a
// armadura já ganhou.
export const STAR_ARMOR_BURNS_PLAYERS = false;

// ---------------------------------------------------------------------------
// Traje reforçado
// ---------------------------------------------------------------------------
// O traje básico reforçado com os minérios dos planetas: titânio na estrutura,
// silício na eletrônica, hélio-3 no aquecimento.
export const REINFORCED_SUIT_PIECES = [
  { slot: "Head", item: "gh:reinforced_spacesuit_helmet" },
  { slot: "Chest", item: "gh:reinforced_spacesuit_chestplate" },
  { slot: "Legs", item: "gh:reinforced_spacesuit_leggings" },
  { slot: "Feet", item: "gh:reinforced_spacesuit_boots" },
];
// Quanto da pressão do Sol ainda passa com o traje reforçado: 0 = ANULA o dano
// de pressão por completo, como a armadura de estrela. O que ainda separa os
// dois é o CALOR de dentro do Sol — com o traje dá pra chegar e entrar sem ser
// esmagado, mas o jogador pega fogo lá dentro; só a armadura de estrela
// aguenta isso (ver REINFORCED_SUIT_BLOCKS_APPROACH_HEAT logo abaixo).
export const REINFORCED_SUIT_PRESSURE_FACTOR = 0;
// O traje segura o calor da APROXIMAÇÃO (fora da superfície do Sol), mas não o
// de dentro. Só a armadura de estrela aguenta lá dentro.
export const REINFORCED_SUIT_BLOCKS_APPROACH_HEAT = true;

// Dimensões do Spacecraft onde o traje reforçado precisa valer como traje.
// O addon deles checa as peças DELES pra decidir se o jogador respira; quem
// trocar pelo reforçado sufocaria na Lua sem isto. Ver gear/lifeSupport.
export const SPACECRAFT_DIMENSIONS = [
  "nv_sc:moon",
  "nv_sc:mars",
  "nv_sc:andrella",
  "nv_sc:station",
  "custom_dim:venzenulon_7",
  "minecraft:the_end",
];
// A tag que o próprio Spacecraft usa pra suspender o dano de oxigênio.
export const SPACECRAFT_SAFE_TAG = "nv_sc:cant_hurt";

// ---------------------------------------------------------------------------
// Veículos
// ---------------------------------------------------------------------------
// O OVNI viaja junto com o jogador. Qualquer montaria vai junto, menos as que
// o Spacecraft controla — o lançamento do foguete tem coreografia própria e
// não pode ser interrompido.
export const MOUNT_BLOCKLIST_MATCHES = ["_rocket"];

// Tags postas no veículo pra ele não sumir enquanto ninguém está montado.
// `dlb_van_ufo_captured` é a do próprio Vehicles: o `minecraft:despawn` do
// OVNI só apaga a entidade se ela NÃO tiver essa tag (e for dia, e o jogador
// mais próximo estiver a 6+ blocos). O addon dele já marca sozinho quando
// alguém monta; marcar de novo cobre a entidade recém-recriada da estrutura.
// `gh_ship_captured` é a da Nave Level 1: o `minecraft:despawn` dela tem o
// mesmo desenho que o do OVNI — só apaga a entidade se ela NÃO tiver a tag.
export const VEHICLE_KEEP_ALIVE_TAGS = ["dlb_van_ufo_captured", "gh_ship_captured"];

// ---------------------------------------------------------------------------
// Destroços de OVNI no Overworld
// ---------------------------------------------------------------------------
// Onde o molde de ferraria é encontrado — o primeiro elo da linha da armadura,
// e o único que fica no Overworld.
export const WRECK_ENABLED = true;
// De quanto em quanto tempo se sorteia, e com que chance. Os dois juntos dão
// uma queda a cada ~2 h de jogo por jogador andando por aí: raro de achar,
// não raro a ponto de nunca acontecer.
export const WRECK_CHECK_INTERVAL = 1200;   // 1 min
export const WRECK_CHANCE = 0.008;
// Distância do jogador: longe o bastante pra ele não ver os blocos surgindo,
// perto o bastante pra a chunk estar carregada.
export const WRECK_MIN_DISTANCE = 90;
export const WRECK_MAX_DISTANCE = 160;
// Distância mínima entre duas quedas, pra não virar um campo de destroços.
export const WRECK_MIN_GAP = 400;

export const WRECK_HULL_BLOCK = "minecraft:light_gray_concrete";
export const WRECK_GLASS_BLOCK = "minecraft:tinted_glass";
export const WRECK_SCORCH_BLOCK = "minecraft:coarse_dirt";

export const WRECK_TEMPLATE_ITEM = "gh:star_upgrade_template";
// Companhia do molde no baú. O molde entra sempre; estes são sorteados.
export const WRECK_LOOT = [
  { item: "minecraft:iron_ingot", chance: 0.8, min: 2, max: 6 },
  { item: "minecraft:gold_ingot", chance: 0.5, min: 1, max: 4 },
  { item: "minecraft:diamond", chance: 0.35, min: 1, max: 2 },
  { item: "minecraft:redstone", chance: 0.6, min: 3, max: 9 },
  { item: "minecraft:amethyst_shard", chance: 0.4, min: 1, max: 4 },
];

// ---------------------------------------------------------------------------
// Vênus
// ---------------------------------------------------------------------------
// O que mata em Vênus não é falta de ar: é ter ar DEMAIS. São 92 atmosferas de
// gás carbônico a 464 °C — mais pressão que a 900 m de profundidade no oceano,
// e quente o bastante pra derreter chumbo. As sondas soviéticas Venera
// aguentaram entre 23 minutos e 2 horas lá embaixo, e foram as que duraram
// mais; as primeiras foram esmagadas antes de pousar.
//
// No addon isso vira uma regra só: SÓ O TRAJE REFORÇADO (ou a armadura de
// estrela, que é melhor que ele em tudo) segura Vênus. O traje básico resolve
// ar e frio, e nenhum dos dois é o problema aqui.
export const VENUS_ENABLED = true;
// Dano por intervalo pra quem está lá sem o traje certo, e de quanto em quanto.
// 4 de dano a cada segundo mata um jogador com vida cheia em 5 segundos: é
// tempo de entender o que está acontecendo e de voltar pra nave, e não é tempo
// de explorar nada.
export const VENUS_DAMAGE = 4;
export const VENUS_DAMAGE_INTERVAL = 20;
// E pega fogo, porque 464 °C é acima do ponto de fulgor de quase tudo.
export const VENUS_BURN_SECONDS = 4;

// ---------------------------------------------------------------------------
// Ácido sulfúrico
// ---------------------------------------------------------------------------
// A nuvem de Vênus É ácido sulfúrico — 60 km dela. Aqui ele aparece em poças
// pequenas na planície (ver `acidPools` em planets.js).
//
// SÓ O BALDE DE TITÂNIO enche, e o motivo é químico: ácido sulfúrico
// concentrado come ferro (dá sulfato de ferro e gás hidrogênio) e não come
// titânio, que se protege com uma casca de óxido. O balde de ferro do jogo
// seria comido — quem tentar recebe a explicação, não um "não" seco.
export const ACID_ENABLED = true;
export const ACID_BLOCK = "gh:sulfuric_acid";
export const ACID_BUCKET = "gh:sulfuric_acid_bucket";
export const TITANIUM_BUCKET = "gh:titanium_bucket";
// Os baldes que o ácido comeria. Leite e água contam: é o mesmo ferro.
export const VANILLA_BUCKETS = [
  "minecraft:bucket", "minecraft:water_bucket", "minecraft:milk_bucket",
  "minecraft:lava_bucket", "minecraft:powder_snow_bucket",
];
// Dano por intervalo pra quem está DENTRO da poça, e de quanto em quanto.
// O traje reforçado corta pela metade e a armadura de estrela pra um quarto —
// nenhum dos dois zera. Um traje que anulasse o ácido faria a poça deixar de
// ser perigo pra todo mundo que consegue chegar em Vênus, que é todo mundo que
// tem o traje.
export const ACID_DAMAGE = 4;
export const ACID_DAMAGE_INTERVAL = 10;
export const ACID_BURN_SECONDS = 3;

// ANDAR EM VÊNUS: sem correr, e com pulo de um bloco só.
//
// Não é capricho de dificuldade — é o que 92 atmosferas fazem. O ar lá tem
// densidade de 65 kg/m³, cerca de 6,5% da água: andar na superfície de Vênus
// é mais parecido com andar no fundo de uma piscina do que com andar na Terra.
// Correr é impossível, e sair do chão custa caro.
export const VENUS_HEAVY_MOVEMENT = true;

// Teto da velocidade horizontal, em blocos por tick. Andar no Minecraft é
// ~0,10 e correr é ~0,13; o teto fica logo acima do andar, pra o controlador
// não brigar com quem só está caminhando.
export const VENUS_WALK_CAP = 0.105;

// Velocidade vertical máxima ao sair do chão.
//
// Medido no modelo do próprio jogo (v -= g todo tick, y += v) com o g de
// Vênus: 0,36 dá um ápice de ~1,1 bloco. É o suficiente pra subir UM bloco e
// não é suficiente pra dois — que é exatamente o que ele pediu. Sem isto o
// pulo em Vênus seria de 1,44, mais alto que o da Terra, porque a gravidade
// daqui é um pouco menor que a de lá.
export const VENUS_JUMP_SPEED = 0.36;

// A Nave Level 1 NÃO sobrevive a Vênus.
//
// Ela é uma casca de vidro e ferro montada numa lixeira: aguenta vácuo, que é
// ausência de pressão, e não aguenta 92 atmosferas empurrando pra dentro. A
// Level 2 aguenta — é pra isso que existe o kit que a transforma.
//
// Os segundos são o tempo entre chegar e o casco ceder: dá pra ver a nave
// rangendo e sair de dentro dela antes.
export const VENUS_CRUSHES_TIER1 = true;
export const VENUS_CRUSH_SECONDS = 6;
export const TIER1_SHIP = "gh:level_1_spaceship";
export const TIER2_SHIP = "gh:level_2_spaceship";

// Agachar e clicar na nave guarda ela no inventário, como ovo.
//
// Sem isto uma nave só se perde: ela fica onde pousou, e voltar a pé de outro
// planeta pra buscá-la não é jogo, é castigo. O `crouching_skip_interact` da
// nave já faz o agachar não montar, então o gesto estava livre.
export const SHIP_PICKUP_ON_SNEAK = true;
export const SHIP_EGGS = {
  "gh:level_1_spaceship": "gh:level_1_spaceship_spawn_egg",
  "gh:level_2_spaceship": "gh:level_2_spaceship_spawn_egg",
};

// ---------------------------------------------------------------------------
// Ponto de renascimento
// ---------------------------------------------------------------------------
// O jogo reatribui o renascimento do jogador ao entrar numa dimensão custom, e
// quem morresse depois acordava no espaço. O addon não chama setSpawnPoint em
// lugar nenhum; isto aqui só desfaz o que o jogo fez. Ver spawnGuard.js.
export const SPAWN_GUARD_ENABLED = true;
// De quantos em quantos ticks conferir, pra quem está no espaço. Não precisa
// ser todo tick: só importa antes de morrer.
export const SPAWN_GUARD_INTERVAL = 40;

// ---------------------------------------------------------------------------
// Ambiente
// ---------------------------------------------------------------------------
export const STARFIELD_PARTICLE = "gh:starfield";
export const SPACE_DUST_PARTICLE = "gh:space_dust";
export const STARFIELD_INTERVAL_TICKS = 200; // o efeito dura ~14 s
export const SPACE_DUST_INTERVAL_TICKS = 120;
// ---------------------------------------------------------------------------
// Corpos vistos de longe
// ---------------------------------------------------------------------------
// Um corpo de blocos some passando da distância de renderização. O modelo é
// uma entidade mantida perto do jogador e encolhida pra dar o mesmo ângulo que
// o corpo daria lá longe — ver skybox.js.
export const SKY_MODELS_ENABLED = true;

// A faixa de profundidades em que os modelos ficam do jogador.
//
// Aqui morava o bug que fez os corpos sumirem de novo. O Bedrock só mantém e
// desenha entidade dentro da DISTÂNCIA DE SIMULAÇÃO, que no celular começa em
// 4 chunks — 64 blocos. O modelo estava indo pra posição REAL do corpo, até 112
// blocos: passava dos 64, a entidade descarregava, parava de ser desenhada, e
// no tick seguinte o script via `isValid` falso, apagava, criava outra em cima
// do jogador e mandava de volta pros mesmos 112, que descarregava de novo.
//
// É exatamente o pisca-pisca das fotos: duas a UM bloco de distância uma da
// outra, numa não há corpo nenhum e na outra a Lua e a Terra estão lá.
//
// Então o modelo volta a ficar perto — bem dentro dos 64 — e é encolhido pra
// dar o mesmo ângulo que o corpo daria lá longe.
//
// Mas não todos na MESMA distância, que foi o problema da versão de 34 blocos:
// dois cubos no mesmo raio, em direções parecidas, se interpenetram — o "os
// modelos se atravessam". Cada corpo ganha o SEU degrau de profundidade, na
// ordem da distância real: o que está mais perto de verdade fica no degrau mais
// perto. Assim um nunca atravessa o outro; o da frente simplesmente tapa o de
// trás, que é o que tem que acontecer.
// Jogadores a menos que isto um do outro DIVIDEM um único conjunto de modelos.
//
// O modelo é um truque de ponto de vista: ele fica perto de quem olha e é
// encolhido pra dar o mesmo ângulo do corpo lá longe. Isso só está certo pra UM
// observador — e em multijogador cada um tinha o seu conjunto, então todo mundo
// via os cubos dos outros flutuando no lugar errado. Era o que estava "bugado".
//
// Não tem como esconder uma entidade de um jogador só no Bedrock. A regra que
// resolve está logo abaixo, junto de SKY_SHARE_RADIUS.

// Até esta distância o modelo vai pra posição REAL do corpo, no tamanho real.
//
// O truque do modelo perto quebra de perto: pousando num planeta, a superfície
// do cubo encolhido fica mais perto de você do que o chão em que você está. Aqui
// não precisa de truque nenhum — o corpo já está dentro da distância de
// simulação, então o modelo vai pro lugar dele e no tamanho dele, e aí é exato.
// Até esta distância DO CENTRO o corpo é GLOBAL: uma entidade só no mundo
// inteiro, no lugar de verdade e no tamanho de verdade.
//
// DO CENTRO, e essa palavra custou uma rodada. Eu media da superfície, mas a
// entidade fica no CENTRO — e pra Terra isso são 26 blocos de diferença. Com o
// limite em 64 da superfície, chegar a 59 m dela punha a entidade a 86 blocos
// do jogador, longe demais pro cliente desenhar. Era a Terra sumindo de perto.
//
// O teto vem do que está medido: modelo a 28 blocos aparece, entidade a 86 não.
// 40 fica com folga dos dois lados.
//
// A consequência honesta: com esse teto, só vira global quem está bem do lado.
// A Terra (raio 26) só a partir de uns 14 m da superfície; o Sol (raio 100),
// nunca. Mais longe que isso continua um modelo por jogador, e dois jogadores
// afastados voltam a ver dois planetas. Não é falta de vontade: entidade que o
// cliente não desenha não adianta existir.
export const SKY_GLOBAL_BELOW = 40;

export const SKY_MODEL_REAL_BELOW = 40;

// A faixa dos degraus: 20..40.
//
// Ela já foi 16..40, caiu pra 12..28 quando Marte duplicava, e agora sobe de
// novo. O que mudou no meio: a varredura de órfãs, que era uma leitura só num
// try (bastava uma entidade descarregada pra abortar tudo) e rodava a cada meio
// minuto, virou robusta e roda a cada dois segundos. Era ela que deixava o
// fantasma na tela, não a distância sozinha.
//
// E perto demais tem o seu preço, que foi o que ele viu: "tudo parece pequeno e
// perto". O tamanho na tela está certo — é o ângulo do corpo de verdade —, mas
// um cubo a 12 blocos fica no meio da nave e o olho lê como objeto ali do lado.
// Mais longe, ele volta a parecer o que é.
//
// O teto vem do medido: modelo a 28 blocos aparece, entidade a 86 não aparece.
// 40 fica do lado seguro, e é o mesmo número do limite global.
export const SKY_MODEL_NEAREST = 20;
export const SKY_MODEL_DISTANCE = 40;

// ---------------------------------------------------------------------------
// NUNCA DOIS PLANETAS NA TELA
// ---------------------------------------------------------------------------
// Até onde o cliente recebe e desenha uma entidade. Não é chute: está medido
// duas vezes neste arquivo — modelo a 28 blocos aparece, entidade a 86 não.
//
// É a DISTÂNCIA DE SIMULAÇÃO que manda nisso, e não a de renderização. Aumentar
// o slider de chunks (que é o que os packs de "render distance" fazem, e eles
// nem são pack: são arquivos trocados dentro do app) não move este número, e é
// por isso que modelo fixo na posição real continua fora de alcance: o Sol está
// a 500 blocos e Marte a 520.
export const SKY_ENTITY_RANGE = 86;

// A regra do compartilhamento: dois jogadores dividem UM conjunto sempre que um
// deles PUDER VER o conjunto do outro.
//
// O conjunto do outro fica no máximo a SKY_MODEL_DISTANCE dele, e é visível
// até SKY_ENTITY_RANGE de quem olha — logo, a soma dos dois é a distância a
// partir da qual ninguém vê o conjunto de ninguém. Abaixo dela, o grupo é um
// só e existe um conjunto só. É o que faz "dois planetas na tela" deixar de
// existir, e não só ficar mais raro.
//
// E o agrupamento é TRANSITIVO: A com B, B com C, junta os três. Sem isso, B
// no meio do caminho veria o conjunto de A e o de C.
//
// O preço, que é real e assumido: num grupo esparramado o céu é montado no
// CENTRO do grupo, então quem está na ponta vê os corpos numa direção um pouco
// torta. Ele escolheu assim — um céu só, nem que não seja perfeito pra quem
// está na borda, em vez de dois planetas na tela.
export const SKY_SHARE_RADIUS = SKY_ENTITY_RANGE + SKY_MODEL_DISTANCE;

// A que distância DA CASCA o modelo sai e o corpo de blocos assume.
//
// Da casca, não do centro — e essa distinção era um buraco de verdade. Medindo
// do centro com um número só, o ponto de troca mudava por corpo: com 190, o
// modelo do Sol (raio 100) sumia com a casca ainda a 90 blocos, e o da Lua
// (raio 12) com a casca a 178.
//
// E 178 é longe demais: o gerador só constrói dentro de GEN_RADIUS_CHUNKS do
// jogador, ou seja 80 blocos. Entre 80 e 178 não havia bloco nenhum construído
// E o modelo já tinha sumido — uma faixa de quase cem blocos onde o planeta
// simplesmente não existia pra quem olhava.
//
// Então o limite é o alcance do gerador, com folga: só se desliga o modelo
// onde os blocos garantidamente estão lá. tools/tests/test_sky_gap.mjs não
// deixa a folga sumir de novo.
export const SKY_MODEL_HIDE_BELOW = GEN_RADIUS_CHUNKS * 16 - 24;

// De quantos em quantos ticks os modelos são reposicionados. 1 seria o mais
// suave, mas 2 já não dá pra perceber e custa metade.
export const SKY_MODEL_INTERVAL = 2;

// ---------------------------------------------------------------------------
// Estrelas: o terceiro nível
// ---------------------------------------------------------------------------
// Além da borda do sistema solar o corpo deixa de ser um mundo visitável e vira
// um ponto de luz — como qualquer estrela vista da Terra. É o que fecha o
// objetivo: cada pontinho branco no espaço é uma estrela de verdade, com um
// sistema em volta dela, e não um enfeite pintado no céu.
export const STAR_ENTITY = "gh:sky_star";

// O tamanho da estrela é fixo e mora na entidade (minecraft:scale), não aqui:
// a essa distância, dobrar ou triplicar a distância real não mudaria nada que o
// olho perceba.

// ---------------------------------------------------------------------------
// Onde o rastreador escreve
// ---------------------------------------------------------------------------
// A barra de ação some quando outro addon roda `hud @s hide all` — o Spacecraft
// faz isso nas cinemáticas dele (racoTriggers.js) e desfaz com `hud @s reset
// all` no fim. Se a cinemática não terminar limpa (o jogador sai, morre, dá
// erro no meio), o HUD fica escondido pra sempre, e com ele a barra de ação.
// Não dá pra ler esse estado por script: não existe consulta ao `hud`.
//
// O placar lateral NÃO é um `hud_element` — `hud hide all` não o alcança. Por
// isso ele é o canal padrão: funciona mesmo com o HUD escondido.
//
// Canais: "sidebar" | "actionbar" | "off". O jogador troca no menu do
// rastreador, que é um formulário e aparece de qualquer jeito.
export const HUD_CHANNEL_DEFAULT = "sidebar";

// Objetivo do placar usado pelo rastreador. Criado sozinho, e removido quando
// ninguém está mais usando.
export const HUD_OBJECTIVE = "gh_track";

export const FOG_ID = "gh:fog_outer_space";

// A névoa de DENTRO de um corpo, entre os blocos dele.
//
// No Sol, lá dentro é tudo bloco branco com emissão máxima a um palmo do rosto:
// a tela vira um branco chapado e não dá pra enxergar nada — nem a própria nave.
// Uma névoa curta cor de brasa troca esse branco por um laranja escuro, e aí dá
// pra ver. Não mexe em nada visto de fora, que era a condição.
export const FOG_INSIDE_ID = "gh:fog_inside_sun";

// A luz do Sol.
//
// Duas tentativas anteriores erraram o alvo: a primeira acendia só o entorno do
// Sol (alcance 230, com a Terra a 520 — ninguém via nada), e a segunda pintava
// o ESPAÇO de dourado em faixas e dava visão noturna ao jogador. As duas
// mexiam no lugar errado: o espaço tem que continuar sendo espaço.
//
// O que ilumina são os CORPOS. Os blocos dos planetas emitem luz baixa
// (BODY_LIGHT em tools/make_blocks.py) e os modelos vistos de longe são
// emissivos, então todo corpo aparece iluminado — como um corpo recebendo luz
// do Sol aparece. O vazio entre eles fica escuro, que é o certo.
//
// Até onde vai o sistema solar, medido do Sol. Marte, o mais distante hoje,
// está a 1040. Ainda usado pelo rastreador e conferido pelo validate.py.
export const SOLAR_SYSTEM_RADIUS = 1500;
export const FOG_LABEL = "gh_fog";

// Bússola na action bar com rumo e distância dos corpos celestes. Sem ela não
// dá pra achar o Sol e Marte, que ficam bem além da distância de renderização.
export const HUD_ENABLED = true;
export const HUD_INTERVAL_TICKS = 10;

// ---------------------------------------------------------------------------
// Spacecraft — destino da Lua e de Marte
// ---------------------------------------------------------------------------
// O Spacecraft roteia cada planeta pra uma dimensão custom (mundos novos) ou
// pro the_end em coordenadas distantes (mundos antigos, de antes da v2). Estas
// são as duas rotas; qual usar é decidido em runtime (travel.js).
// Mantidas por compatibilidade: mundos criados antes da v2 do Spacecraft põem
// os planetas DELES em cantos distantes do the_end, e gear.js ainda precisa
// reconhecer esses mundos pra o traje reforçado valer lá. As rotas de viagem
// deste addon não usam mais nada disso — a Lua e Marte são dimensões nossas.
export const SPACECRAFT_LEGACY_ORIGINS = {
  "nv_sc:moon": { x: -200000, z: -200000 },
  "nv_sc:mars": { x: 200000, z: 200000 },
};
// Meia-largura da área de cada planeta no the_end legado (planets.js: `size`).
// Serve pra saber se um jogador a 800 de altura no the_end está sobre a Lua,
// sobre Marte, ou em algum outro canto do End que não leva a lugar nenhum.
export const SPACECRAFT_LEGACY_RADIUS = 30000;
// Teto congelado dos planetas do Spacecraft (planetDimensions.js: LANDING_Y).
export const SPACECRAFT_LANDING_Y = 254;
// Espalha o pouso pra dois jogadores não caírem no mesmo bloco.
export const LANDING_JITTER = 8;

// ---------------------------------------------------------------------------
// Frio do espaço
// ---------------------------------------------------------------------------
// O vácuo não "gela" por contato — não há o que conduzir calor. O que ele faz é
// não devolver NADA: o corpo irradia calor pro nada e não recebe de volta,
// menos o que o Sol manda. Por isso o frio aqui não é instantâneo, é uma
// reserva que escorre: o jogador aguenta um bom tempo e depois começa a perder
// vida, e se voltar pro quente ela enche de novo.
//
// É um eixo SEPARADO do oxigênio, de propósito. O traje comum do Spacecraft
// resolve o ar mas não isola: ele deixa explorar, não morar. Quem quiser ficar
// precisa do traje reforçado ou da armadura de estrela — e é isso que dá ao
// traje reforçado um trabalho que antes ele não tinha.
export const COLD_ENABLED = true;
// O CONGELAMENTO É O DA NEVE FOFA, com os números do próprio jogo.
//
// Na neve fofa o jogador congela em 140 ticks (7 segundos), e congelado perde
// 1 de vida a cada 2 segundos, com lentidão junto. Armadura de couro impede o
// congelamento; aqui quem impede é o traje reforçado, a armadura de estrela ou
// estar dentro de um veículo.
//
// O que NÃO dá pra copiar é a moldura azul na beirada da tela: ela é do
// contador de congelamento do motor, e não há API de script que o encoste. O
// mais perto é a névoa gelada (FOG_COLD_ID), que a tela já usa.
export const COLD_SECONDS = 7;
// Dano por vez, e de quanto em quanto tempo. Os dois são os da neve fofa.
export const COLD_DAMAGE = 1;
export const COLD_DAMAGE_INTERVAL = 40;
// Lentidão enquanto congelado, como na neve fofa. 1 = Lentidão I. 0 desliga.
export const COLD_SLOWNESS = 1;
// Descongela na mesma proporção do jogo: lá o contador cai 2 por tick fora da
// neve, contra 1 por tick dentro dela.
export const COLD_RECOVER_FACTOR = 2;
// A partir de quanta reserva o aviso aparece. Em 7 segundos de reserva isso é
// pouco mais de 3 segundos de sobra — o mesmo tempo que a tela do jogo leva
// pra ficar azul de vez.
export const COLD_WARN_AT = 0.45;
export const COLD_FOG_AT = 0.25;
export const FOG_COLD_ID = "gh:fog_cold";

// ---------------------------------------------------------------------------
// Tempestades de areia de Marte
// ---------------------------------------------------------------------------
// Uma tempestade de areia é uma MANCHA que caminha pelo planeta — não um
// interruptor que liga o dia inteiro em todo lugar. Foi o que ele pediu depois
// de ver a primeira versão: "não é na dimensão inteira, apenas em um pedaço e
// ela vai andando".
//
// Cada tempestade nasce numa célula da grade, tem um raio próprio, anda em
// linha reta e morre. A conta é determinística — sai de (época, célula) por
// hash —, então não há estado guardado, não há sorteio por jogador e não há
// nada pra sincronizar: dois jogadores no mesmo lugar veem a mesma mancha, no
// mesmo lugar, do mesmo tamanho.
export const MARS_STORM_ENABLED = true;
// Quanto tempo uma tempestade dura, em ticks. 9000 = 7,5 min de jogo.
export const MARS_STORM_EPOCH = 9000;
// O tamanho da célula da grade. Uma tempestade por célula por época.
export const MARS_STORM_CELL = 700;
// Chance de uma célula ter tempestade naquela época.
export const MARS_STORM_CHANCE = 0.35;
// O raio da mancha, em blocos. 200 a 380 = 400 a 760 de ponta a ponta: um
// pedaço do planeta, não o planeta.
export const MARS_STORM_RADIUS_MIN = 200;
export const MARS_STORM_RADIUS_MAX = 380;
// Quanto o centro anda por tick. 0,02 = 180 blocos ao longo da vida dela, e uma
// velocidade que o jogador ganha andando — dá pra sair de dentro dela a pé.
export const MARS_STORM_DRIFT = 0.02;
// Fração do raio que é MIOLO (intensidade cheia). Fora disso ela desbota até a
// borda, pra a tempestade ter uma frente em vez de uma parede.
export const MARS_STORM_CORE = 0.45;

// Quantas partículas por emissão no auge, e de quantos em quantos ticks.
export const MARS_STORM_PARTICLES = 9;
export const MARS_STORM_INTERVAL = 3;
export const MARS_STORM_PARTICLE = "gh:mars_sand";

// Duas forças de névoa: a borda fecha um pouco, o miolo fecha quase tudo.
export const FOG_MARS_STORM_ID = "gh:fog_mars_storm";
export const FOG_MARS_STORM_HEAVY_ID = "gh:fog_mars_storm_heavy";
export const MARS_STORM_FOG_AT = 0.12;
export const MARS_STORM_HEAVY_AT = 0.45;
