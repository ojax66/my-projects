/* =========================================================================
 * Corpos celestes — geometria e paleta.
 *
 * Cada corpo é uma casca esférica oca. A geração é por coluna (x, z), como o
 * world_generator_API espera: pra cada coluna a gente resolve analiticamente
 * quais Y caem dentro da casca, em vez de varrer os 384 blocos de altura.
 *
 *   dh  = distância horizontal da coluna até o centro
 *   yo  = meia-altura da esfera externa  = sqrt(R² - dh²)
 *   yi  = meia-altura da esfera interna  = sqrt(Ri² - dh²)   (0 se dh >= Ri)
 *
 * Os blocos ficam em [cy-yo, cy-yi] e [cy+yi, cy+yo] — a calota de baixo e a
 * de cima. Sem varredura, sem buraco.
 * ========================================================================= */

import { system, BlockVolume } from "@minecraft/server";
import { valueNoise3D } from "./world_generator_API.js";
import { BODIES, DIM_MIN_Y, DIM_MAX_Y, BLOCK_BUDGET_PER_TICK } from "./config.js";

const AIR = "minecraft:air";

// ---------------------------------------------------------------------------
// Paletas
//
// Concreto e terracota lêem bem de longe: cor chapada, sem textura ruidosa —
// é o que faz um globo de 52 blocos parecer um planeta e não uma pilha de
// blocos. O Sol usa só blocos que emitem luz 15.
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

const PALETTES = {
  // Sol: laranja incandescente com veios mais claros e algumas manchas
  // escuras (as manchas solares). Tudo que brilha, brilha em luz 15.
  sun(x, y, z) {
    const n = surfaceNoise(x, y, z, 0.045);
    if (n >= 0.795) return "minecraft:blackstone";
    if (n >= 0.6) return "minecraft:ochre_froglight";
    if (n >= 0.3) return "minecraft:shroomlight";
    return "minecraft:glowstone";
  },

  // Terra: oceano azul, plataforma continental mais clara, continentes verdes
  // com cordilheiras/desertos marrons e calotas polares brancas.
  earth(x, y, z, body) {
    // Calota sólida a partir de ~70 graus, com uma borda irregular até ~62 —
    // as latitudes reais do gelo permanente, não uma touca até a Europa.
    const lat = Math.abs(latitude(y, body));
    if (lat > 0.94) return "minecraft:white_concrete";

    const n = surfaceNoise(x, y, z, 0.05);
    if (lat > 0.88 && n > 0.55) return "minecraft:white_concrete";

    if (n >= 0.68) return "minecraft:brown_concrete";
    if (n >= 0.56) return "minecraft:green_concrete";
    if (n >= 0.5) return "minecraft:light_blue_concrete";
    return "minecraft:blue_concrete";
  },

  // Lua: cinza claro com os mares (as manchas escuras) e crateras de pedra.
  moon(x, y, z) {
    const n = surfaceNoise(x, y, z, 0.09);
    if (n >= 0.66) return "minecraft:gray_concrete";
    if (n >= 0.34) return "minecraft:light_gray_concrete";
    return "minecraft:smooth_stone";
  },

  // Marte: terracota alaranjada com regiões mais vermelhas e calotas de gelo
  // seco pequenas, bem menores que as da Terra.
  mars(x, y, z, body) {
    // Calotas menores que as da Terra, como as de gelo seco de Marte — mas
    // grandes o bastante pra aparecer: numa esfera de raio 20, cada grau de
    // latitude vale pouquíssimo bloco.
    const lat = Math.abs(latitude(y, body));
    if (lat > 0.93) return "minecraft:white_concrete";

    const n = surfaceNoise(x, y, z, 0.07);
    if (lat > 0.87 && n > 0.6) return "minecraft:white_concrete";
    if (n >= 0.66) return "minecraft:red_terracotta";
    if (n >= 0.34) return "minecraft:orange_terracotta";
    return "minecraft:terracotta";
  },
};

// ---------------------------------------------------------------------------
// Consultas geométricas
// ---------------------------------------------------------------------------

export function distanceTo(loc, body) {
  const dx = loc.x - body.center.x;
  const dy = loc.y - body.center.y;
  const dz = loc.z - body.center.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Corpos cuja "sombra" horizontal alcança esta coluna. Quase toda coluna do
// espaço não alcança nenhum, e sai daqui na primeira comparação.
function bodiesOverColumn(x, z) {
  let hits = null;
  for (let i = 0; i < BODIES.length; i++) {
    const b = BODIES[i];
    const dx = x - b.center.x;
    const dz = z - b.center.z;
    const dh2 = dx * dx + dz * dz;
    if (dh2 > b.radius * b.radius) continue;
    (hits ??= []).push({ body: b, dh2 });
  }
  return hits;
}

// Intervalos [de, até] de Y que a casca de um corpo ocupa nesta coluna.
function shellSpans(body, dh2) {
  const R = body.radius;
  const Ri = Math.max(0, R - body.shell);
  const cy = body.center.y;

  const outer = Math.sqrt(Math.max(0, R * R - dh2));
  const inner = dh2 >= Ri * Ri ? 0 : Math.sqrt(Ri * Ri - dh2);

  // Coluna que passa longe do miolo: a casca vira um bloco maciço só.
  if (inner <= 0) {
    return [[cy - outer, cy + outer]];
  }
  return [
    [cy - outer, cy - inner],
    [cy + inner, cy + outer],
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
  const hits = bodiesOverColumn(x, z);
  if (!hits) return [];

  const runs = [];

  for (let i = 0; i < hits.length; i++) {
    const { body, dh2 } = hits[i];
    const palette = PALETTES[body.palette];
    if (!palette) continue;

    const spans = shellSpans(body, dh2);
    for (let s = 0; s < spans.length; s++) {
      const from = Math.max(DIM_MIN_Y, Math.ceil(spans[s][0]));
      const to = Math.min(DIM_MAX_Y - 1, Math.floor(spans[s][1]));
      if (to < from) continue;

      let runStart = from;
      let runId = palette(x, from, z, body);
      for (let y = from + 1; y <= to + 1; y++) {
        const id = y <= to ? palette(x, y, z, body) : null;
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
