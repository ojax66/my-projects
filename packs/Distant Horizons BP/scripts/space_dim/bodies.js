/* =========================================================================
 * Corpos celestes — geometria e paleta.
 *
 * Cada corpo é um CUBO oco, na estética do jogo: um planeta redondo feito de
 * blocos vira uma bola de degraus, e de longe lê como uma bolha. O cubo tem
 * faces chapadas e arestas retas, que é a linguagem do Minecraft.
 *
 * A geração é por coluna (x, z), como o world_generator_API espera. Com cubo
 * isso fica exato, sem raiz quadrada nenhuma:
 *
 *   dentro da pegada     |dx| <= R  e  |dz| <= R
 *   dentro do miolo      |dx| <= Ri e  |dz| <= Ri      (Ri = R - espessura)
 *
 * Coluna na parede (fora do miolo, dentro da pegada): maciça de cy-R a cy+R.
 * Coluna sobre o miolo: só a tampa de baixo e a de cima.
 *
 * As distâncias seguem a forma. Pra "encostar" num cubo o que vale é a
 * distância de Chebyshev (o maior dos três eixos), não a euclidiana — senão o
 * portal dispararia no ar em frente às faces e não dispararia nas quinas.
 * ========================================================================= */

import { system, BlockVolume } from "@minecraft/server";
import { valueNoise3D } from "./world_generator_API.js";
import { BODIES, DIM_MIN_Y, DIM_MAX_Y, BLOCK_BUDGET_PER_TICK } from "./config.js";

const AIR = "minecraft:air";

// Calota polar num corpo cúbico: até onde ela chega na vertical (fração do
// raio, 1 = tampa) e quanto ela se espalha na horizontal a partir do eixo.
// A largura é o que decide o tamanho da mancha branca vista de cima.
const POLAR_CAP_HEIGHT = 0.82;
const POLAR_CAP_WIDTH = 0.34;

/**
 * O degradê do disco solar, do miolo da face pra borda.
 *
 * Seis tons, não três: com três a passagem do branco ao vermelho saía em
 * faixas duras, e o que se quer é um degradê. Os limiares e as cores vêm da
 * referência do autor, amostrada do centro pra quina.
 *
 * Cada faixa é um BLOCO diferente — o degradê é feito trocando de bloco, como
 * os mares da Lua, não pintando tom escuro dentro de uma textura.
 */
const SUN_DISC = [
  // `sun_blaze`, não `sun_core`: os dois são o mesmo branco, mas o núcleo é o
  // chão MACIÇO lá no meio do Sol. Pintar a casca externa com ele fechou a
  // primeira camada — dava pra encostar no Sol, não pra entrar.
  // As faixas seguem as proporções da referência: miolo branco ocupando mais da
  // metade do raio da face, e o fogo numa borda FINA. Antes o laranja comia
  // quase metade do corpo e o Sol parecia uma caixa laranja com um ponto claro.
  { until: 0.50, block: "space_dim:sun_blaze" },    // branco, atravessável
  { until: 0.68, block: "space_dim:sun_flare" },    // amarelo claro
  { until: 0.80, block: "space_dim:sun_plasma" },   // amarelo
  { until: 0.89, block: "space_dim:sun_ember" },    // laranja
  { until: 0.95, block: "space_dim:sun_corona" },   // laranja avermelhado
  { until: Infinity, block: "space_dim:sun_edge" }, // vermelho
];

// Quanto a fronteira entre as faixas balança.
const SUN_EDGE_NOISE = 0.22;

/**
 * Quão longe da MEIA da face este ponto está, de 0 a 1.
 *
 * Num cubo cada ponto pertence à face do eixo em que ele está mais distante do
 * centro. Dentro dessa face, o que mede o afastamento são os OUTROS dois eixos
 * — o da face é constante ali. Sem isso o degradê seria concêntrico ao corpo
 * inteiro e as faces sairiam todas com a mesma cor chapada.
 */
function faceOffset(x, y, z, body, layer) {
  // Normaliza pelo raio da CAMADA, não do corpo.
  //
  // Com a coroa virando `modelOnly`, a casca que se vê passou a ser a do plasma
  // (raio 62 num corpo de raio 100). Medindo pelo corpo, o afastamento máximo
  // na casca visível era 0,62 — a rampa parava no meio e os dois últimos tons
  // do degradê nunca apareciam.
  const R = layer?.radius ?? body.radius;
  const dx = Math.abs(x - body.center.x);
  const dy = Math.abs(y - body.center.y);
  const dz = Math.abs(z - body.center.z);

  let a;
  let b;
  if (dx >= dy && dx >= dz) { a = dy; b = dz; }
  else if (dy >= dz) { a = dx; b = dz; }
  else { a = dx; b = dy; }

  // Anéis de SUPERELIPSE: redondos por dentro, quadrados na borda.
  //
  // Chebyshev puro — max(a,b) — dá anéis QUADRADOS, e era o que estava errado
  // comparado com a referência: lá os anéis de dentro são claramente redondos.
  //
  // Mas trocar por distância redonda pura também não serve: aí o tom mais
  // escuro só aparece nas quinas, o contorno do corpo some e o cubo vira uma
  // bola lavada.
  //
  // A norma-p com p = 3 é o meio-termo exato: as curvas de nível de dentro são
  // arredondadas, e a borda inteira da face chega no último tom (o meio da
  // aresta dá 1, a quina dá 2^(1/3) e satura). Silhueta desenhada, anéis
  // redondos.
  const P = 3;
  const ua = Math.min(1, a / R);
  const ub = Math.min(1, b / R);
  return Math.min(1, Math.pow(Math.pow(ua, P) + Math.pow(ub, P), 1 / P));
}

// ---------------------------------------------------------------------------
// Paletas
//
// Blocos próprios (space_dim:*), com textura feita pra cada corpo — plasma
// granulado no Sol, oceano com correntes na Terra, regolito craterado na Lua,
// poeira e basalto em Marte. As texturas saem de tools/make_block_textures.py
// e o ruído delas é periódico, então a esfera não mostra emenda entre blocos.
// ---------------------------------------------------------------------------

// Ruído em três frequências dá manchas grandes com borda irregular, em vez do
// chuviscado que uma frequência só produz.
function surfaceNoise(x, y, z, scale) {
  return (
    valueNoise3D(x * scale, y * scale, z * scale) * 0.6 +
    valueNoise3D(x * scale * 2.3, y * scale * 2.3, z * scale * 2.3) * 0.27 +
    valueNoise3D(x * scale * 5.1, y * scale * 5.1, z * scale * 5.1) * 0.13
  );
}

// Latitude normalizada (-1 no polo sul, +1 no polo norte).
function latitude(y, body) {
  return (y - body.center.y) / body.radius;
}

/**
 * Quanto este bloco é "polar", de 0 a 1, num corpo cúbico.
 *
 * Numa esfera bastava a latitude: quanto mais perto do polo, menos volta o
 * paralelo dá, e a calota fechava sozinha. Num cubo não fecha — a tampa
 * inteira está na latitude máxima, então usar só latitude pintaria as duas
 * faces de gelo de ponta a ponta. Duas faces de seis é um terço da superfície
 * visível: um planeta de gelo com uma cinta de terra no meio.
 *
 * Então a calota também se fecha na horizontal: ela é uma mancha no MEIO da
 * tampa, medida pela distância de Chebyshev até o eixo do corpo. Fica como
 * uma calota de verdade vista de cima, e as bordas da tampa continuam sendo
 * superfície normal.
 *
 * 1 = no eixo e na tampa; 0 = fora da calota.
 */
function polarness(x, y, z, body) {
  const R = body.radius;
  const vertical = Math.abs(y - body.center.y) / R;     // 1 na tampa
  const off = Math.max(
    Math.abs(x - body.center.x),
    Math.abs(z - body.center.z)
  ) / R;                                                 // 0 no eixo, 1 na quina

  if (vertical < POLAR_CAP_HEIGHT) return 0;
  if (off > POLAR_CAP_WIDTH) return 0;
  return 1 - off / POLAR_CAP_WIDTH;
}

const PALETTES = {
  // Sol — o disco tem VARIAÇÃO VISÍVEL: branco no miolo da face, amarelo em
  // volta, laranja nas bordas e nas quinas. É o que se vê olhando pra ele.
  //
  // A variação é feita com os TRÊS BLOCOS do Sol, não pintada dentro de uma
  // textura: é a mesma regra dos mares da Lua. E como a textura do modelo
  // distante sai deste mesmo código, o Sol de longe ganha o mesmo degradê sem
  // nada a mais.
  //
  // `t` é o quanto o ponto está longe do CENTRO DA FACE em que ele está: 0 no
  // meio, 1 na borda. Numa esfera isso seria a latitude; num cubo o que vale é
  // a distância aos dois eixos que não são o da face.
  // A camada da coroa não é mais construída de blocos (`modelOnly` no config):
  // ela era atravessável, não mudava nada, e custava dois terços de todo o Sol.
  // Quem a desenha é o modelo. O degradê ficou com a camada do plasma, que
  // passou a ser a casca externa que se vê chegando perto.
  sun_plasma(x, y, z, body, layer) {
    // Ruído na fronteira, senão os anéis viram alvo de tiro. A borda fica
    // irregular como a de uma chama — mesma ideia da calota polar.
    const t = faceOffset(x, y, z, body, layer)
      + (surfaceNoise(x, y, z, 0.04) - 0.5) * SUN_EDGE_NOISE;
    for (let i = 0; i < SUN_DISC.length; i++) {
      if (t < SUN_DISC[i].until) return SUN_DISC[i].block;
    }
    return SUN_DISC[SUN_DISC.length - 1].block;
  },
  sun_core() { return "space_dim:sun_core"; },

  // Terra: oceano profundo, plataforma continental, mata, floresta fechada e
  // calotas polares.
  earth(x, y, z, body) {
    const n = surfaceNoise(x, y, z, 0.05);

    // Calota polar: cheia no miolo da tampa, esfarrapada na borda pelo ruído.
    const pole = polarness(x, y, z, body);
    if (pole > 0.35) return "space_dim:earth_ice";
    if (pole > 0 && n > 0.52) return "space_dim:earth_ice";

    // Limiares vindos dos percentis reais do ruído neste corpo (medidos, não
    // chutados): ~9% floresta, ~20% continente, ~16% plataforma, o resto
    // oceano. Dá a proporção água/terra da Terra de verdade.
    if (n >= 0.617) return "space_dim:earth_forest";
    if (n >= 0.536) return "space_dim:earth_land";
    if (n >= 0.492) return "space_dim:earth_shallow";
    return "space_dim:earth_ocean";
  },

  // Lua: as manchas grandes são feitas AQUI, trocando de bloco conforme o
  // ruído — não desenhadas dentro da textura. Assim um mare é uma região de
  // centenas de blocos escuros, como na Lua de verdade, em vez de cada bloco
  // ter a mesma cratera repetida.
  moon(x, y, z) {
    // ~16% mare escuro, o resto claro — a proporção da Lua de verdade, onde
    // as terras altas dominam e os mares são manchas grandes e minoritárias.
    const n = surfaceNoise(x, y, z, 0.06);
    if (n >= 0.631) return "space_dim:moon_regolith_dark";
    if (n >= 0.483) return "space_dim:moon_regolith";
    return "space_dim:moon_regolith_light";
  },

  // Marte: poeira, rocha e basalto escuro, com calotas de gelo seco.
  mars(x, y, z, body) {
    const n = surfaceNoise(x, y, z, 0.07);

    // Calotas de gelo seco, menores que as da Terra.
    const pole = polarness(x, y, z, body);
    if (pole > 0.55) return "space_dim:mars_ice";
    if (pole > 0.2 && n > 0.58) return "space_dim:mars_ice";

    if (n >= 0.654) return "space_dim:mars_rock_dark";
    if (n >= 0.538) return "space_dim:mars_rock";
    return "space_dim:mars_dust";
  },
};

// ---------------------------------------------------------------------------
// Consultas geométricas
// ---------------------------------------------------------------------------

/** O raio da camada mais externa que é construída de BLOCOS.
 *
 * A coroa do Sol é `modelOnly`: ela não vira bloco nenhum (quem a desenha é o
 * modelo visto de longe), então medir a superfície pelo `radius` do corpo cai
 * no vazio. */
export const builtRadius = (body) => {
  // Um corpo do catálogo pode não ter camadas (nada a construir); aí o raio
  // nominal é a única casca que existe.
  const built = (body.layers ?? []).filter((l) => !l.modelOnly);
  return built.length ? Math.max(...built.map((l) => l.radius)) : body.radius;
};

/**
 * Corpo cuja superfície de fora só existe como MODELO.
 *
 * A coroa do Sol é `modelOnly`: nenhum bloco vai desenhá-la, nunca. Então a
 * troca normal — chegou perto, some o modelo e os blocos assumem — não vale pra
 * ele: quem chegasse perto veria a coroa desaparecer e sobrar só a bola de
 * plasma do raio 62. O modelo de um corpo assim fica ligado em toda distância.
 */
export const alwaysModel = (body) => (body.layers ?? []).some((l) => l.modelOnly);

/** Distância euclidiana até o centro. Usada pela gravidade, que é radial. */
export function distanceTo(loc, body) {
  const dx = loc.x - body.center.x;
  const dy = loc.y - body.center.y;
  const dz = loc.z - body.center.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Distância de Chebyshev até o centro: o maior dos três eixos.
 *
 * É a distância que combina com um cubo. Com a euclidiana, um ponto parado a
 * `radius` de distância em frente ao meio de uma face já estaria DENTRO do
 * corpo, e uma quina ficaria a `radius * sqrt(3)` — o portal disparava no ar e
 * não disparava encostado.
 */
export function chebyshevTo(loc, body) {
  const dx = Math.abs(loc.x - body.center.x);
  const dy = Math.abs(loc.y - body.center.y);
  const dz = Math.abs(loc.z - body.center.z);
  return Math.max(dx, dy, dz);
}

/** Quantos blocos faltam pra encostar na casca do cubo (0 = na superfície). */
export function surfaceGap(loc, body) {
  return chebyshevTo(loc, body) - body.radius;
}

// Camadas cuja "sombra" horizontal alcança esta coluna. Quase toda coluna do
// espaço não alcança nenhuma, e sai daqui na primeira comparação.
//
// Um corpo pode ter várias camadas concêntricas — o Sol tem coroa, plasma e
// núcleo. Os planetas têm uma só.
function layersOverColumn(x, z) {
  let hits = null;
  for (let i = 0; i < BODIES.length; i++) {
    const b = BODIES[i];
    const dx = Math.abs(x - b.center.x);
    const dz = Math.abs(z - b.center.z);
    // Pegada do cubo: o maior dos dois eixos decide.
    const dh = dx > dz ? dx : dz;
    if (dh > b.radius) continue;

    for (let j = 0; j < b.layers.length; j++) {
      const layer = b.layers[j];
      // Camada que só existe como modelo não vira bloco nenhum.
      if (layer.modelOnly) continue;
      if (dh > layer.radius) continue;
      (hits ??= []).push({ body: b, layer, dh });
    }
  }
  return hits;
}

// Intervalos [de, até] de Y que uma camada ocupa nesta coluna.
//
// Num cubo a altura não depende de onde a coluna está: a face de cima é plana.
// O que muda é se a coluna atravessa a parede (maciça de ponta a ponta) ou o
// miolo oco (só as duas tampas).
function shellSpans(body, layer, dh) {
  const R = layer.radius;
  const Ri = Math.max(0, R - layer.shell);
  const cy = body.center.y;

  // `shell >= radius` quer dizer camada maciça — é assim que o núcleo do Sol
  // é declarado no config.
  if (Ri <= 0 || dh > Ri) {
    return [[cy - R, cy + R]];
  }
  return [
    [cy - R, cy - Ri],
    [cy + Ri, cy + R],
  ];
}

// ---------------------------------------------------------------------------
// Núcleo puro: quais blocos uma coluna tem
//
// Sem efeito colateral e sem orçamento — só geometria e paleta. É o que os
// testes exercitam, e é o que as duas funções públicas abaixo consomem.
// Devolve os trechos contínuos de blocos iguais já agrupados: é assim que
// eles vão pro mundo (um fillBlocks por trecho), e agrupar aqui evita
// percorrer a coluna duas vezes.
// ---------------------------------------------------------------------------

/** @returns {{y0:number, y1:number, id:string}[]} trechos, de baixo pra cima */
export function columnRuns(x, z) {
  const hits = layersOverColumn(x, z);
  if (!hits) return [];

  const runs = [];

  for (let i = 0; i < hits.length; i++) {
    const { body, layer, dh } = hits[i];
    const palette = PALETTES[layer.palette];
    if (!palette) continue;

    const spans = shellSpans(body, layer, dh);
    for (let s = 0; s < spans.length; s++) {
      const from = Math.max(DIM_MIN_Y, Math.ceil(spans[s][0]));
      const to = Math.min(DIM_MAX_Y - 1, Math.floor(spans[s][1]));
      if (to < from) continue;

      let runStart = from;
      let runId = palette(x, from, z, body, layer);
      for (let y = from + 1; y <= to + 1; y++) {
        const id = y <= to ? palette(x, y, z, body, layer) : null;
        if (id === runId) continue;
        if (runId && runId !== AIR) runs.push({ y0: runStart, y1: y - 1, id: runId });
        runStart = y;
        runId = id;
      }
    }
  }

  return runs;
}

/** Versão sem escrita — usada pelo `findValidSpot` do gerador. */
export function getHeight(x, z) {
  const runs = columnRuns(x, z);
  let top = DIM_MIN_Y;
  for (let i = 0; i < runs.length; i++) {
    if (runs[i].y1 > top) top = runs[i].y1;
  }
  return top;
}

// ---------------------------------------------------------------------------
// Orçamento por tick e retomada de chunk
//
// O gerador do world_generator_API trabalha em chunks inteiras, mas perto do
// Sol uma chunk sozinha passa de 8 mil blocos — escrever isso num frame trava
// o jogo. Então o custo é limitado por BLOCO, não por chunk: estourou o teto
// do tick, a coluna atual joga BudgetExhausted, o gerador não marca a chunk
// como pronta e tenta de novo depois.
//
// Pra a retentativa não recomeçar do zero (e nunca terminar), cada chunk
// guarda um cursor: o índice da próxima coluna a processar. O gerador percorre
// as colunas sempre na mesma ordem (x por fora, z por dentro), então o índice
// é reprodutível e a chunk retoma exatamente de onde parou.
// ---------------------------------------------------------------------------

// Erro de verdade, não Symbol: o gerador entrega o erro pro onError, que o
// concatena numa string — e interpolar um Symbol lança TypeError. Uma
// instância só, reaproveitada, porque isso é fluxo normal e acontece dezenas
// de vezes por tick.
class BudgetExhaustedError extends Error {
  constructor() {
    super("orçamento de blocos do tick esgotado");
    this.name = "BudgetExhausted";
    this.isBudgetExhausted = true;
  }
}
const BudgetExhausted = new BudgetExhaustedError();

/** true se o erro veio do teto de blocos por tick (não é falha de verdade). */
export function isBudgetError(err) {
  return err?.isBudgetExhausted === true;
}

let budgetTick = -1;
let budgetLeft = 0;

function takeBudget(n) {
  if (system.currentTick !== budgetTick) {
    budgetTick = system.currentTick;
    budgetLeft = BLOCK_BUDGET_PER_TICK;
  }
  if (budgetLeft <= 0) return false;
  budgetLeft -= n;
  return true;
}

// chunkKey → índice da próxima coluna pendente
const chunkCursor = new Map();
const COLUMNS_PER_CHUNK = 256;

function columnIndex(x, z) {
  // Mesmo laço do gerador: for x { for z { ... } }
  const lx = ((x % 16) + 16) % 16;
  const lz = ((z % 16) + 16) % 16;
  return lx * 16 + lz;
}

function chunkKeyOf(x, z) {
  return Math.floor(x / 16) + "," + Math.floor(z / 16);
}

/**
 * Escreve um trecho contínuo de blocos iguais. Um fillBlocks vale por vários
 * setBlockType: as paletas são de ruído suave, então blocos vizinhos na
 * vertical repetem bastante e os trechos costumam ter vários blocos.
 */
function writeRun(dim, x, z, y0, y1, id) {
  if (y1 === y0) {
    dim.setBlockType({ x, y: y0, z }, id);
    return;
  }
  try {
    dim.fillBlocks(new BlockVolume({ x, y: y0, z }, { x, y: y1, z }), id);
  } catch (e) {
    // fillBlocks indisponível ou recusado: cai no caminho bloco a bloco.
    for (let y = y0; y <= y1; y++) dim.setBlockType({ x, y, z }, id);
  }
}

/**
 * Gera uma coluna. Assinatura exigida pelo world_generator_API: recebe a
 * dimensão e (x, z), devolve o Y do bloco mais alto que escreveu (ou DIM_MIN_Y
 * se a coluna ficou vazia, que é o caso do vácuo).
 */
export function generateColumn(dim, x, z) {
  const ckey = chunkKeyOf(x, z);
  const index = columnIndex(x, z);
  const cursor = chunkCursor.get(ckey) ?? 0;

  // Coluna já resolvida numa passada anterior desta mesma chunk.
  if (index < cursor) return DIM_MIN_Y;

  // Coluna adiante do cursor: alguma coluna ANTES desta falhou nesta mesma
  // passada (o orçamento acabou). O cursor só pode andar em ordem, senão uma
  // coluna vazia lá na frente o empurraria por cima das que ficaram pendentes
  // — e a chunk nunca terminaria de verdade.
  if (index > cursor) throw BudgetExhausted;

  // Chegar na última coluna com o cursor em dia significa que as 255
  // anteriores terminaram: a chunk acabou e o cursor pode sair da memória.
  const advance = () => {
    if (index + 1 >= COLUMNS_PER_CHUNK) chunkCursor.delete(ckey);
    else chunkCursor.set(ckey, index + 1);
  };

  const runs = columnRuns(x, z);

  // Vácuo: não gasta orçamento e conta como resolvida.
  if (!runs.length) {
    advance();
    return DIM_MIN_Y;
  }

  let blocks = 0;
  for (let i = 0; i < runs.length; i++) blocks += runs[i].y1 - runs[i].y0 + 1;
  if (!takeBudget(blocks)) throw BudgetExhausted;

  let top = DIM_MIN_Y;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    writeRun(dim, x, z, r.y0, r.y1, r.id);
    if (r.y1 > top) top = r.y1;
  }

  advance();
  return top;
}
