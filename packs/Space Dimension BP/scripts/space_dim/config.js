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
    // Casca fina de propósito: numa esfera de raio 100 cada bloco a mais de
    // espessura são ~125 mil blocos a gerar. 3 já é totalmente opaca.
    shell: 3,
    portal: null,
    palette: "sun",
  },
  {
    id: "earth",
    name: "§bTerra",
    center: { x: 0, y: ORBIT_Y, z: 0 },
    radius: 26,
    shell: 4,
    portal: { kind: "overworld" },
    // Chegada vinda do Overworld: 58 do centro, com a Lua também no campo de
    // visão. Longe o bastante pra não disparar o portal de volta na hora.
    arrival: { x: 0, y: ORBIT_Y, z: 58 },
    palette: "earth",
  },
  {
    id: "moon",
    name: "§7Lua",
    center: { x: 0, y: ORBIT_Y, z: 190 },
    radius: 12,
    shell: 4,
    portal: { kind: "spacecraft", planet: "nv_sc:moon" },
    // Chegada vinda da Lua do Spacecraft: 40 do centro (28 da superfície).
    arrival: { x: 40, y: ORBIT_Y, z: 190 },
    palette: "moon",
  },
  {
    id: "mars",
    name: "§cMarte",
    center: { x: 520, y: ORBIT_Y, z: -120 },
    radius: 20,
    shell: 4,
    portal: { kind: "spacecraft", planet: "nv_sc:mars" },
    // Chegada vinda de Marte do Spacecraft: 50 do centro (30 da superfície).
    arrival: { x: 470, y: ORBIT_Y, z: -120 },
    palette: "mars",
  },
];

// Margem, em blocos, além da superfície em que o portal do corpo dispara.
// A casca é sólida, então o jogador encosta nela antes de chegar ao centro.
export const PORTAL_MARGIN = 2.5;

// O Sol queima quem encosta nele? Desligado por padrão — o pedido era uma
// construção gigante, não uma armadilha. Ligar aqui se quiser o risco.
export const SUN_BURNS = false;
export const SUN_BURN_MARGIN = 6;

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
// Ambiente
// ---------------------------------------------------------------------------
export const STARFIELD_PARTICLE = "space_dim:starfield";
export const SPACE_DUST_PARTICLE = "space_dim:space_dust";
export const STARFIELD_INTERVAL_TICKS = 200; // o efeito dura ~14 s
export const SPACE_DUST_INTERVAL_TICKS = 120;
export const FOG_ID = "space_dim:fog_outer_space";
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
