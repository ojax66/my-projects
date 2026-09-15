/* =========================================================================
 * As dimensões de SUPERFÍCIE: a Lua e Marte.
 *
 * Até aqui entrar na Lua ou em Marte mandava pro addon Spacecraft. Agora cada
 * um tem a sua própria dimensão, gerada por este addon, com o terreno e o céu
 * dele. É o começo do desapego: o traje e as receitas do Spacecraft continuam
 * valendo (ver gear.js), mas o chão é nosso.
 *
 * ---------------------------------------------------------------------------
 * A estratigrafia, que é a regra que ele deu
 * ---------------------------------------------------------------------------
 * As três tonalidades de cada planeta não são decoração: elas são CAMADAS, na
 * mesma ordem em todo lugar, como grama/terra/pedra/deepslate no Overworld.
 *
 *   mais clara  → em cima  → POEIRA   (regolito / ferrita)
 *   meio termo  → no meio  → PEDRA
 *   mais escura → embaixo  → ARDÓSIA
 *
 * A luminância média das texturas confere com isso: regolito 216 / 161 / 94, e
 * ferrita 100 / 78 / 40. O que muda de bioma pra bioma é a ESPESSURA de cada
 * camada — num mar de basalto a poeira é fina e a ardósia aflora quase na
 * superfície; nas terras altas a poeira é funda. A ordem nunca muda.
 *
 * ---------------------------------------------------------------------------
 * Biomas
 * ---------------------------------------------------------------------------
 * O Bedrock não tem API de script pra PINTAR bioma por coluna: uma dimensão
 * custom usa o `default_biome` e pronto. Então cada bioma aqui é duas coisas:
 *
 *  1. uma definição de bioma de verdade no pacote (BP/biomes + RP/biomes),
 *     que é o que dá nome, clima e céu; e
 *  2. uma REGIÃO do terreno, escolhida pelo mesmo ruído que desenha o relevo,
 *     que decide espessura das camadas, força das crateras, gelo e a névoa que
 *     o jogador recebe ali.
 *
 * O que o jogador sente — o chão muda, o ar muda, o nome aparece — é (2). (1)
 * existe pra o bioma ser um bioma de verdade no mundo, não um apelido.
 *
 * E o relevo é uma função CONTÍNUA: o bioma não entra na conta da altura, só
 * rotula o ruído que já a produziu. Sem isso toda fronteira de bioma viraria um
 * paredão de um bloco de largura.
 * ========================================================================= */

// Altitude que devolve pro espaço — a MESMA do Overworld, de propósito.
//
// Ela já foi 300, e por um motivo que deixou de existir: o teto de uma dimensão
// custom era 320, então 800 aqui seria uma porta que nunca abre e o jogador
// ficaria preso no planeta. O Minecraft passou a deixar o addon escolher os
// limites verticais, então o número volta a ser um só pro jogo inteiro: sobe a
// 800, de onde for, e você está no espaço.
//
// `tools/tests/test_planets.mjs` confere que ele é igual a SPACE_ENTRY_Y — duas
// constantes com o mesmo valor combinado é exatamente o tipo de coisa que
// escorrega sozinha depois.
export const PLANET_EXIT_Y = 800;

// Limites verticais das duas dimensões, agora que o motor deixa escolher.
//
// O teto tem que ficar ACIMA de PLANET_EXIT_Y, senão a porta de volta não abre.
// O piso é fundo porque o relevo usa: o cânion de Marte desce muito abaixo do
// nível médio, e é ele que pede espaço — não a crosta, que tem sempre a mesma
// espessura e desce junto com a superfície.
//
// Isso NÃO custa geração: uma coluna escreve `crust` blocos, onde quer que a
// superfície esteja. Teto alto é espaço pra construir; piso fundo é espaço pro
// relevo cair.
// Medido no gerador: o ponto mais alto é um vulcão a 274 e o fundo do cânion
// mais fundo é -70, com a bedrock dele a -100. O teto a 1024 é céu pra
// construir; o piso a -128 é folga embaixo do mais fundo que o relevo alcança.
export const PLANET_BOUNDS = { min: -128, max: 1024 };

// Quanto a chegada se espalha, pra dois jogadores não pousarem no mesmo bloco.
export const PLANET_LANDING_JITTER = 24;

// Raio de busca, em chunks, do ponto de pouso. 2 = 25 chunks no pior caso, mas
// a primeira já costuma servir: qualquer coluna de superfície vale.
export const PLANET_SPOT_SEARCH_CHUNKS = 2;

// Sem ar em nenhum dos dois. Marte tem 0,6% da pressão da Terra — na prática é
// vácuo pra um pulmão. Vale a mesma regra do espaço: traje completo + mochila,
// ou estar dentro de um veículo pressurizado.
export const PLANET_VACUUM = true;

// Gravidade baixa. O Bedrock não deixa mudar a gravidade da dimensão, então o
// que dá pra fazer é o efeito dela: pular mais alto e cair mais devagar.
// `jump` é o amplificador de jump_boost (0 = +1 nível).
export const PLANET_LOW_GRAVITY = true;
// De quantos em quantos ticks os efeitos são renovados. Eles são aplicados com
// duração folgada e sem partícula; renovar a cada 2 s evita piscar.
export const PLANET_EFFECT_INTERVAL = 40;
export const PLANET_EFFECT_SECONDS = 6;

// ---------------------------------------------------------------------------
// Ruído: os comprimentos de onda, em blocos
// ---------------------------------------------------------------------------
// `scale` do fbm é 1/comprimento de onda. Estão aqui com nome pra ficar claro
// que a "região" é MUITO maior que o "detalhe" — é isso que faz um bioma ter
// tamanho de bioma e não de quarteirão.
const WL_REGION = 900;   // que bioma é aqui
const WL_ROUGH = 520;    // o segundo eixo da escolha (aspereza)
const WL_ELEV = 700;     // a elevação regional
const WL_DETAIL = 90;    // o relevo pequeno
const WL_GRAIN = 17;     // o granulado de superfície

export const NOISE = {
  region: 1 / WL_REGION,
  rough: 1 / WL_ROUGH,
  elev: 1 / WL_ELEV,
  detail: 1 / WL_DETAIL,
  grain: 1 / WL_GRAIN,
};

// Latitude, em blocos, onde começa a calota polar. Um mundo de Minecraft é
// plano e infinito, então "polo" aqui é uma FAIXA em |z| — é a tradução honesta
// de latitude num mundo que não é uma esfera.
const POLE_Z = 2600;
// Largura da transição pro polo, pra a calota não começar num paredão.
const POLE_FADE = 500;

export { POLE_Z, POLE_FADE };

// ---------------------------------------------------------------------------
// A Lua
// ---------------------------------------------------------------------------
// O que define a Lua de verdade, e o que o gerador reproduz:
//
//  - Não há atmosfera: nenhuma erosão. Cratera feita há 3 bilhões de anos
//    continua com a borda afiada. Por isso as crateras aqui são FUNDAS e se
//    empilham uma por cima da outra, em três escalas.
//  - Dois terrenos dominam: os MARES (mare), planícies de basalto escuro que
//    encheram bacias de impacto — lisos, baixos e pouco cratejados porque a
//    lava é "recente"; e as TERRAS ALTAS (terrae), crosta antiga de anortosito
//    claro, alta e saturada de cratera.
//  - Nos polos há crateras cujo fundo nunca vê o Sol, e é lá que a sonda LCROSS
//    achou água em gelo.
const MOON = {
  id: "moon",
  bodyId: "moon",
  dimensionId: "space_dim:moon",
  name: "§7Lua",
  defaultBiome: "space_dim:lua_terras_altas",
  // A MESMA névoa do espaço, o mesmo arquivo. Não uma cópia parecida: o céu da
  // Lua tem que ser igual ao do espaço, e duas definições separadas com a
  // mesma intenção é como elas acabam diferentes. Faz sentido físico também —
  // não há atmosfera nenhuma entre a superfície da Lua e o vácuo, então o céu
  // dela É o vácuo.
  fog: "space_dim:fog_outer_space",
  skyColor: "#000000",

  baseY: 72,
  // A crosta gerada: do chão até a bedrock. Não é a Lua inteira — é quanto dá
  // pra cavar antes de bater no fundo. 30 blocos é o mesmo custo por coluna que
  // uma chunk do Sol já tinha, e o teto de blocos por tick segura o resto.
  crust: 30,

  // 1/6 da gravidade da Terra: pulo alto e queda mansa. O Bedrock não deixa
  // mudar a gravidade da dimensão, então o que dá pra fazer é o efeito dela.
  gravity: { jump: 2, slowFall: true },

  elevAmp: 34,     // quanto a elevação regional sobe e desce, de ponta a ponta
  detailAmp: 6,    // o relevo pequeno por cima dela
  grainAmp: 1.4,   // o granulado, que tira a aparência de plástico

  blocks: {
    dust: "space_dim:moon_regolith_light",
    stone: "space_dim:moon_regolith",
    deep: "space_dim:moon_regolith_dark",
    ice: "minecraft:packed_ice",
    floor: "minecraft:bedrock",
  },

  // Três escalas de cratera, das bacias aos pedregulhos. `chance` é a fração
  // das células da grade que têm cratera; `depth` e `rim` são frações do RAIO
  // da cratera (uma cratera real tem profundidade ~1/5 do diâmetro, ou seja
  // ~2/5 do raio — daí o 0.34 das grandes).
  craters: [
    { cell: 240, chance: 0.55, rMin: 42, rMax: 92, depth: 0.34, rim: 0.055 },
    { cell: 74, chance: 0.70, rMin: 13, rMax: 30, depth: 0.32, rim: 0.070 },
    { cell: 23, chance: 0.75, rMin: 3.5, rMax: 8.5, depth: 0.28, rim: 0.090 },
  ],

  biomes: [
    {
      id: "mar_de_basalto",
      biomeId: "space_dim:lua_mar_de_basalto",
      name: "§8Mar de Basalto",
      // Lava que encheu a bacia: liso, baixo, e a ardósia escura logo embaixo
      // de uma poeira fina.
      dust: [1, 2],
      stone: [4, 7],
      craterScale: 0.55,
      // Rilles: canais sinuosos de lava colapsada. Só existem nos mares.
      rille: { width: 0.016, depth: 7 },
    },
    {
      id: "terras_altas",
      biomeId: "space_dim:lua_terras_altas",
      name: "§fTerras Altas",
      dust: [3, 6],
      stone: [9, 15],
      craterScale: 1.0,
    },
    {
      id: "bacia_de_impacto",
      biomeId: "space_dim:lua_bacia_de_impacto",
      name: "§7Bacia de Impacto",
      // O manto de ejeção: material jogado pra fora do impacto, misturado. A
      // poeira é grossa e a pedra vem logo depois.
      dust: [4, 8],
      stone: [6, 10],
      craterScale: 1.25,
    },
    {
      id: "polo_sombrio",
      biomeId: "space_dim:lua_polo_sombrio",
      name: "§bPolo Sombrio",
      dust: [2, 4],
      stone: [8, 13],
      craterScale: 1.1,
      // Gelo só no FUNDO das crateras — é exatamente onde ele existe na Lua,
      // porque é o único lugar onde o Sol nunca bate. `below` é quanto a coluna
      // precisa estar abaixo do relevo sem cratera pra contar como fundo.
      ice: { below: 6, thickness: [1, 3] },
    },
  ],
};

// ---------------------------------------------------------------------------
// Marte
// ---------------------------------------------------------------------------
// O que define Marte, e o que o gerador reproduz:
//
//  - A DICOTOMIA: o hemisfério norte é uma planície baixa e lisa (Vastitas
//    Borealis), o sul é um planalto antigo e cratejado, e há uns 3 km de
//    degrau entre os dois. É o traço mais marcante do planeta, e aqui ele é a
//    latitude: z negativo é norte e baixo, z positivo é sul e alto.
//  - THARSIS: um planalto vulcânico com os maiores vulcões do sistema solar.
//    O Olympus Mons é um vulcão-escudo: altíssimo, mas de encosta mansa —
//    por isso o perfil aqui é potência 1.7, e não um cone.
//  - VALLES MARINERIS: um sistema de cânions de 4000 km de extensão e até 7 km
//    de profundidade. Um vale de rift, não um rio: paredes íngremes e fundo
//    chato.
//  - Dunas de areia basáltica escura por toda parte, e calotas polares de gelo.
//  - Há atmosfera, fina e cheia de poeira: o céu é ocre, e a visibilidade é
//    limitada pela poeira em suspensão — daí a névoa, que a Lua não tem.
const MARS = {
  id: "mars",
  bodyId: "mars",
  dimensionId: "space_dim:mars",
  name: "§cMarte",
  defaultBiome: "space_dim:marte_terras_altas_do_sul",
  fog: "space_dim:fog_mars",
  skyColor: "#C7A180",

  baseY: 76,
  crust: 30,

  // 0,38 da gravidade da Terra: pula mais alto, mas cai de verdade. Sem
  // slow_falling — em Marte uma queda ainda machuca.
  gravity: { jump: 0, slowFall: false },

  elevAmp: 30,
  detailAmp: 8,
  grainAmp: 1.2,

  // A dicotomia norte/sul: quanto o terreno cai no norte e sobe no sul, e em
  // quantos blocos de latitude a transição acontece.
  dichotomy: { amp: 22, fade: 1800 },

  blocks: {
    dust: "space_dim:mars_dust",
    stone: "space_dim:mars_rock",
    deep: "space_dim:mars_rock_dark",
    ice: "space_dim:mars_ice",
    floor: "minecraft:bedrock",
  },

  // Menos e mais rasas que as da Lua: aqui há vento e poeira há bilhões de
  // anos, e cratera marciana vive meio enterrada.
  craters: [
    { cell: 300, chance: 0.40, rMin: 40, rMax: 85, depth: 0.20, rim: 0.030 },
    { cell: 96, chance: 0.45, rMin: 12, rMax: 26, depth: 0.18, rim: 0.035 },
  ],

  // Vulcões-escudo. Raros e gigantes: a grade é enorme e o sorteio é baixo, o
  // que dá um deles a cada ~1900 blocos em média — encontrar um é um evento.
  //
  // O tamanho é onde o teto antigo apertava. O Olympus Mons tem 22 km de altura
  // e 600 km de base: a encosta média é de 5 graus. Na escala de um mundo de
  // Minecraft não dá pra ter as duas coisas — alto E manso —, mas com o teto
  // livre dá pra chegar perto: com raio 200-340 e altura 100-190, a encosta
  // mais íngreme fica em torno de 36 graus, que é montanha de subir andando, e
  // o pico passa dos 250 de altitude.
  volcanoes: { cell: 900, chance: 0.22, rMin: 200, rMax: 340, hMin: 100, hMax: 190 },

  // O cânion: onde o ruído de rift passa perto de zero, o chão despenca.
  //
  // 120 blocos, contra os 62 de antes. O Valles Marineris tem 7 km de
  // profundidade — o traço mais fundo do planeta — e ele estava raso porque o
  // piso da dimensão era -64 e não havia pra onde descer. Agora há.
  canyon: { width: 0.048, depth: 120, floor: 6 },

  // Dunas: cristas paralelas, como as de Nili Patera.
  dunes: { period: 26, amp: 4.5, angle: 0.55 },

  biomes: [
    {
      id: "planicie_boreal",
      biomeId: "space_dim:marte_planicie_boreal",
      name: "§6Planície Boreal",
      dust: [4, 8],
      stone: [8, 12],
      craterScale: 0.5,
      fog: "space_dim:fog_mars_dust",
    },
    {
      id: "terras_altas_do_sul",
      biomeId: "space_dim:marte_terras_altas_do_sul",
      name: "§cTerras Altas do Sul",
      dust: [2, 4],
      stone: [9, 14],
      craterScale: 1.0,
    },
    {
      id: "valles",
      biomeId: "space_dim:marte_valles",
      name: "§4Valles Marineris",
      dust: [1, 2],
      stone: [6, 10],
      craterScale: 0.25,
    },
    {
      id: "tharsis",
      biomeId: "space_dim:marte_tharsis",
      name: "§8Planalto de Tharsis",
      // Rocha vulcânica quase exposta: a poeira é só um véu. Mas ela existe —
      // a ordem poeira/pedra/ardósia vale em todo lugar, sem exceção.
      dust: [1, 2],
      stone: [5, 9],
      craterScale: 0.3,
    },
    {
      id: "campo_de_dunas",
      biomeId: "space_dim:marte_campo_de_dunas",
      name: "§eCampo de Dunas",
      dust: [7, 12],
      stone: [6, 10],
      craterScale: 0.15,
      fog: "space_dim:fog_mars_dust",
    },
    {
      id: "calota_polar",
      biomeId: "space_dim:marte_calota_polar",
      name: "§fCalota Polar",
      dust: [2, 4],
      stone: [8, 12],
      craterScale: 0.3,
      fog: "space_dim:fog_mars_polar",
      // A calota é uma capa de gelo por cima de tudo, não um forro de cratera.
      ice: { cap: true, thickness: [2, 6] },
    },
  ],
};

export const PLANETS = [MOON, MARS];

export function planetOfDimension(dimensionId) {
  for (let i = 0; i < PLANETS.length; i++) {
    if (PLANETS[i].dimensionId === dimensionId) return PLANETS[i];
  }
  return null;
}

export function planetOfBody(bodyId) {
  for (let i = 0; i < PLANETS.length; i++) {
    if (PLANETS[i].bodyId === bodyId) return PLANETS[i];
  }
  return null;
}
