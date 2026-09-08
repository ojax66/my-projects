/* =========================================================================
 * Dimensão do Espaço — configuração central.
 *
 * Tudo que dá pra ajustar sem mexer na lógica está aqui: posição e tamanho
 * dos corpos celestes, altitude de entrada, ritmo da geração e as regras de
 * respiração. Os ids de dimensão do Spacecraft e do Vehicles ficam aqui
 * também, num só lugar, pra facilitar se algum addon renomear alguma coisa.
 * ========================================================================= */

export const DIMENSION_ID = "space_dim:outer_space";

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
      { radius: 100, shell: 3, palette: "sun_corona", passable: true },
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
    layers: [{ radius: 12, shell: 4, palette: "moon" }],
    portal: { kind: "spacecraft", planet: "nv_sc:moon" },
    // Lua puxa pouco, como na vida real.
    gravity: { reach: 26, strength: 0.012 },
    // Chegada vinda da Lua do Spacecraft: 56 do centro, com a borda do campo
    // dela em 12 + 26 = 38.
    arrival: { x: 56, y: ORBIT_Y, z: 190 },
  },
  {
    id: "mars",
    name: "§cMarte",
    center: { x: 520, y: ORBIT_Y, z: -120 },
    radius: 20,
    layers: [{ radius: 20, shell: 4, palette: "mars" }],
    portal: { kind: "spacecraft", planet: "nv_sc:mars" },
    gravity: { reach: 38, strength: 0.022 },
    // Chegada vinda de Marte do Spacecraft: 76 do centro, com a borda do campo
    // dele em 20 + 38 = 58.
    arrival: { x: 444, y: ORBIT_Y, z: -120 },
  },
];

// Margem, em blocos, além da superfície em que o portal do corpo dispara.
// A casca é sólida, então o jogador encosta nela antes de chegar ao centro.
export const PORTAL_MARGIN = 2.5;

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
export const GEN_RADIUS_CHUNKS = 5;
export const CHUNKS_PER_TICK = 2;

// Teto de blocos escritos por tick. É ELE que segura o custo, não o número de
// chunks: perto do Sol uma única chunk chega a 8 mil blocos, e duas por tick
// sem teto dariam ~16 mil escritas num frame — travadinha garantida.
// Estourou o teto, a chunk para onde está e retoma no tick seguinte, do ponto
// exato onde parou. O Sol inteiro leva uns 12 s de geração contínua.
export const BLOCK_BUDGET_PER_TICK = 2500;

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
export const SPACESUIT_PIECES = [
  { slot: "Head", item: "nv_sc:spacesuit_helmet" },
  { slot: "Chest", item: "nv_sc:spacesuit_chestplate" },
  { slot: "Legs", item: "nv_sc:spacesuit_leggings" },
  { slot: "Feet", item: "nv_sc:spacesuit_boots" },
];
export const OXYGEN_BACKPACK = "nv_sc:oxygen_backpack";
// Dentro de qualquer um destes o jogador respira normal — o OVNI é pressurizado.
export const PRESSURIZED_VEHICLES = ["dlb_van:ufo"];
// Trechos de typeId que também contam como veículo pressurizado (foguete/mech
// do Spacecraft, que já tratam oxigênio por conta própria).
export const PRESSURIZED_VEHICLE_MATCHES = ["_rocket", "space_mech"];

// ---------------------------------------------------------------------------
// Armadura de núcleo de estrela
// ---------------------------------------------------------------------------
// O conjunto INTEIRO é o que protege — meia armadura não segura pressão de
// estrela.
export const STAR_ARMOR_PIECES = [
  { slot: "Head", item: "space_dim:star_helmet" },
  { slot: "Chest", item: "space_dim:star_chestplate" },
  { slot: "Legs", item: "space_dim:star_leggings" },
  { slot: "Feet", item: "space_dim:star_boots" },
];
// Além da pressão, a armadura também poupa do calor? Ligado: é o que faz dela
// a alternativa permanente à poção de resistência a fogo.
export const STAR_ARMOR_PROTECTS_FROM_HEAT = true;

// ---------------------------------------------------------------------------
// Traje espacial reforçado
// ---------------------------------------------------------------------------
// O traje do Spacecraft melhorado com materiais dos planetas deles. Fica ENTRE
// o traje comum e a armadura de estrela: ajuda, não anula.
export const REINFORCED_SUIT_PIECES = [
  { slot: "Head", item: "space_dim:reinforced_spacesuit_helmet" },
  { slot: "Chest", item: "space_dim:reinforced_spacesuit_chestplate" },
  { slot: "Legs", item: "space_dim:reinforced_spacesuit_leggings" },
  { slot: "Feet", item: "space_dim:reinforced_spacesuit_boots" },
];
// Quanto da pressão do Sol ainda passa com o traje: 0,35 = corta 65%. Deixa
// entrar e minerar um pouco, não deixa morar lá — pra isso é a de estrela.
export const REINFORCED_SUIT_PRESSURE_FACTOR = 0.35;
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
export const VEHICLE_KEEP_ALIVE_TAGS = ["dlb_van_ufo_captured"];

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

export const WRECK_TEMPLATE_ITEM = "space_dim:star_upgrade_template";
// Companhia do molde no baú. O molde entra sempre; estes são sorteados.
export const WRECK_LOOT = [
  { item: "minecraft:iron_ingot", chance: 0.8, min: 2, max: 6 },
  { item: "minecraft:gold_ingot", chance: 0.5, min: 1, max: 4 },
  { item: "minecraft:diamond", chance: 0.35, min: 1, max: 2 },
  { item: "minecraft:redstone", chance: 0.6, min: 3, max: 9 },
  { item: "minecraft:amethyst_shard", chance: 0.4, min: 1, max: 4 },
];

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
export const STARFIELD_PARTICLE = "space_dim:starfield";
export const SPACE_DUST_PARTICLE = "space_dim:space_dust";
export const STARFIELD_INTERVAL_TICKS = 200; // o efeito dura ~14 s
export const SPACE_DUST_INTERVAL_TICKS = 120;
// ---------------------------------------------------------------------------
// Corpos vistos de longe
// ---------------------------------------------------------------------------
// Um corpo de blocos some passando da distância de renderização. O modelo é
// uma entidade mantida perto do jogador e encolhida pra dar o mesmo ângulo que
// o corpo daria lá longe — ver skybox.js.
export const SKY_MODELS_ENABLED = true;

// A que distância do jogador o modelo fica. Perto o bastante pra nunca sair de
// cena, longe o bastante pra não atravessar a cabeça dele.
export const SKY_MODEL_DISTANCE = 34;

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

// Limites da propriedade de escala declarada nas entidades (BP/entities/sky_*).
// Sair deles não faz o jogo reclamar: ele silenciosamente ignora o valor, e o
// corpo ficaria do tamanho errado.
// 0.005 e não 0.02: a Lua tem raio 12, e do outro lado do sistema ela precisa
// de escala 0.013. Pedir menos que o mínimo declarado não dá erro — o motor
// ignora calado e a Lua ficaria grande demais, do tamanho do menor valor
// aceito.
export const SKY_MODEL_MIN_SCALE = 0.005;

// ---------------------------------------------------------------------------
// Estrelas: o terceiro nível
// ---------------------------------------------------------------------------
// Além da borda do sistema solar o corpo deixa de ser um mundo visitável e vira
// um ponto de luz — como qualquer estrela vista da Terra. É o que fecha o
// objetivo: cada pontinho branco no espaço é uma estrela de verdade, com um
// sistema em volta dela, e não um enfeite pintado no céu.
export const STAR_ENTITY = "space_dim:sky_star";

// Tamanho aparente de uma estrela. Fixo: a essa distância, dobrar ou triplicar
// a distância não mudaria nada que o olho perceba.
export const STAR_SCALE = 0.035;
export const SKY_MODEL_MAX_SCALE = 40;

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
export const HUD_OBJECTIVE = "space_dim_track";

export const FOG_ID = "space_dim:fog_outer_space";

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
export const FOG_LABEL = "space_dim_fog";

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
