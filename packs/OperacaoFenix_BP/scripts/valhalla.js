/* =========================================================================
 * Valhalla: a dimensão para onde vai quem já teve uma Operação Fênix e ficou
 * sem nenhuma (e sem clone pronto na rede). Quem está aqui continua aqui a cada
 * morte, até outro jogador tirar o DNA de um corpo seu com uma seringa e
 * reviver esse corpo numa Operação Fênix.
 *
 * O terreno é gerado pelo world_generator_API (o mesmo do Galactic Horizons):
 * ilhas de campo e neve flutuando no vazio, com orçamento de blocos por tick
 * para não travar o servidor.
 * ========================================================================= */

import { BlockVolume, EffectTypes, system, world } from "@minecraft/server";
import { VALHALLA } from "./config.js";
import { createTerrainGenerator, fbm, hash2 } from "./world_generator_API.js";

const BOUNDS = { min: 0, max: 256 };
const BLOCK_BUDGET_PER_TICK = 4000;
const CRUST = 18; // espessura das ilhas
const SPAWN_ISLAND = 48; // raio em volta do (0,0) que sempre tem chão

// ---- terreno ------------------------------------------------------------------

/** Altura do topo da ilha na coluna, ou null se ali é vazio. */
export function heightAt(x, z) {
  // Perto do (0,0) a chance de ter chão sobe aos poucos: a ilha de chegada se
  // mistura com as outras em vez de ser um círculo perfeito.
  const spawnBoost = Math.max(0, 1 - Math.hypot(x, z) / SPAWN_ISLAND) * 0.5;
  const island = fbm(x + 5000, z - 3000, 3, 0.5, 1 / 160) + spawnBoost;
  if (island < 0.46) return null;
  const hills = fbm(x, z, 4, 0.5, 1 / 96);
  return Math.floor(62 + hills * 34);
}

/** Trechos verticais de blocos iguais da coluna (de baixo para cima). */
function columnRuns(x, z) {
  const h = heightAt(x, z);
  if (h === null) return [];
  const bottom = h - CRUST;
  const runs = [
    { y0: bottom, y1: bottom + 1, id: "minecraft:calcite" },
    { y0: bottom + 2, y1: h - 4, id: "minecraft:stone" },
    { y0: h - 3, y1: h - 1, id: "minecraft:dirt" },
    { y0: h, y1: h, id: h >= 86 ? "minecraft:snow" : "minecraft:grass_block" },
  ];
  if (h < 86 && hash2(x, z) < 0.1) runs.push({ y0: h + 1, y1: h + 1, id: "minecraft:short_grass" });
  return runs;
}

// ---- orçamento e cursor (mesmas regras do budget.js do Galactic Horizons) --------

class BudgetExhaustedError extends Error {
  constructor() {
    super("orçamento de blocos do tick esgotado");
    this.isBudgetExhausted = true;
  }
}
const BudgetExhausted = new BudgetExhaustedError();

let budgetTick = -1;
let spent = 0;
function takeBudget(n) {
  if (system.currentTick !== budgetTick) {
    budgetTick = system.currentTick;
    spent = 0;
  }
  if (spent >= BLOCK_BUDGET_PER_TICK) return false;
  spent += n;
  return true;
}

// Cada chunk guarda o índice da próxima coluna: se o orçamento acaba no meio,
// ela retoma dali no tick seguinte em vez de recomeçar.
const cursors = new Map();
const chunkKey = (x, z) => Math.floor(x / 16) + "," + Math.floor(z / 16);
const columnIndex = (x, z) => (((x % 16) + 16) % 16) * 16 + (((z % 16) + 16) % 16);

function writeRun(dim, x, z, y0, y1, id) {
  if (y0 === y1) return dim.setBlockType({ x, y: y0, z }, id);
  try {
    dim.fillBlocks(new BlockVolume({ x, y: y0, z }, { x, y: y1, z }), id);
  } catch {
    for (let y = y0; y <= y1; y++) dim.setBlockType({ x, y, z }, id);
  }
}

function generateColumn(dim, x, z) {
  const k = chunkKey(x, z);
  const index = columnIndex(x, z);
  const cursor = cursors.get(k) ?? 0;
  if (index < cursor) return heightAt(x, z) ?? BOUNDS.min;
  if (index > cursor) throw BudgetExhausted;

  const runs = columnRuns(x, z);
  let blocks = 0;
  for (const r of runs) blocks += r.y1 - r.y0 + 1;
  if (!takeBudget(blocks)) throw BudgetExhausted;
  for (const r of runs) writeRun(dim, x, z, r.y0, r.y1, r.id);

  if (index + 1 >= 256) cursors.delete(k);
  else cursors.set(k, index + 1);
  return heightAt(x, z) ?? BOUNDS.min;
}

const lastWarn = new Map();
const generator = createTerrainGenerator({
  dimensionId: VALHALLA,
  generateColumn,
  getHeight: (x, z) => heightAt(x, z) ?? BOUNDS.min,
  genRadiusChunks: 5,
  chunksPerTick: 2,
  heightRangeFallback: BOUNDS,
  onError: (ctx, err) => {
    if (err?.isBudgetExhausted) return; // fluxo normal: a coluna volta no próximo tick
    const key = ctx + "|" + err;
    if (system.currentTick - (lastWarn.get(key) ?? -1000) < 200) return;
    lastWarn.set(key, system.currentTick);
    console.warn("[Fênix/Valhalla] " + ctx + ": " + err);
  },
});
generator.start();

// ---- chegada ------------------------------------------------------------------

let spawnCache;
async function valhallaSpawn() {
  if (spawnCache) return spawnCache;
  const saved = world.getDynamicProperty("fenix:valhalla_spawn");
  if (typeof saved === "string") return (spawnCache = JSON.parse(saved));
  const spot = (await generator.findValidSpot(0, 0, (_x, _z, h) => h > BOUNDS.min, { searchRadiusChunks: 2 })) ?? {
    x: 0,
    y: (heightAt(0, 0) ?? 80) + 1,
    z: 0,
  };
  spawnCache = spot;
  world.setDynamicProperty("fenix:valhalla_spawn", JSON.stringify(spot));
  return spot;
}

export const inValhalla = (player) => player.dimension.id === VALHALLA;

/** Leva o jogador para o ponto de chegada de Valhalla. */
export async function sendToValhalla(player) {
  const spot = await valhallaSpawn();
  if (!player.isValid) return;
  const angle = Math.random() * Math.PI * 2;
  player.teleport(
    { x: spot.x + 0.5 + Math.cos(angle) * 3, y: spot.y + 2, z: spot.z + 0.5 + Math.sin(angle) * 3 },
    { dimension: world.getDimension(VALHALLA) },
  );
  player.addEffect(EffectTypes.get("slow_falling"), 200, { showParticles: false });
  player.onScreenDisplay.setTitle("§6Valhalla", {
    subtitle: "§7Só o DNA do seu corpo pode te trazer de volta",
    fadeInDuration: 10,
    stayDuration: 60,
    fadeOutDuration: 20,
  });
}
