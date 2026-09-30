/* =========================================================================
 * A dimensão do Sift: registro, gerador de terreno, árvores e estruturas,
 * criaturas, névoa e nome do bioma.
 *
 * O terreno é escrito pelo world_generator_API (o mesmo do Galactic
 * Horizons), com o orçamento de blocos por tick do budget.js. Cada coluna
 * vem pronta de terrain.js; aqui só se escreve.
 * ========================================================================= */

import { world, system, BlockPermutation } from "@minecraft/server";
import { createTerrainGenerator } from "../lib/world_generator_API.js";
import { BudgetExhausted, isBudgetError, makeChunkCursor, takeBudget, writeRun } from "../lib/budget.js";
import {
  CHUNKS_PER_TICK, GEN_RADIUS_CHUNKS, SIFT_DIM, SIFT_MAX_Y, SIFT_MIN_Y, SPAWN_CAP_PER_PLAYER, SPAWN_INTERVAL,
} from "../config.js";
import { biomeForPlayer, chunkExtras, columnAt, heightAt, setSeed, ALL_SURFACE_BIOMES } from "./terrain.js";
import { award } from "./advancements.js";

// ---------------------------------------------------------------------------
// Erros (o fim do orçamento é fluxo normal, não erro)
// ---------------------------------------------------------------------------
const lastWarn = new Map();
const recentErrors = [];
export function warn(context, err) {
  if (isBudgetError(err)) return;
  const text = err?.stack ? String(err) + " @ " + String(err.stack).split("\n")[1]?.trim() : String(err);
  const key = context + "|" + text;
  const now = system.currentTick;
  const prev = lastWarn.get(key);
  if (prev !== undefined && now - prev < 200) return;
  lastWarn.set(key, now);
  recentErrors.push("[" + now + "] " + context + ": " + text);
  if (recentErrors.length > 12) recentErrors.shift();
  console.warn("[the_sift] " + context + ": " + text);
}

// ---------------------------------------------------------------------------
// Semente
// ---------------------------------------------------------------------------
const SEED_KEY = "the_sift:seed";
world.afterEvents.worldLoad.subscribe(() => {
  let seed = world.getDynamicProperty(SEED_KEY);
  if (typeof seed !== "number") {
    seed = Math.floor(Math.random() * 1e9);
    world.setDynamicProperty(SEED_KEY, seed);
  }
  setSeed(seed);
});

// ---------------------------------------------------------------------------
// Blocos com estado (plantas altas, neve em camadas, veias de sculk)
// ---------------------------------------------------------------------------
const permCache = new Map();
function perm(id, states) {
  const k = id + JSON.stringify(states);
  let p = permCache.get(k);
  if (!p) {
    try {
      p = BlockPermutation.resolve(id, states);
    } catch {
      p = BlockPermutation.resolve(id); // estado desconhecido: fica o padrão
    }
    permCache.set(k, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Fila de estruturas (salgueiros e portais abandonados) e criaturas da geração
// ---------------------------------------------------------------------------
const structureQueue = [];
const queued = new Set();

function queueStructure(s) {
  const key = s.name + "@" + s.x + "," + s.y + "," + s.z;
  if (queued.has(key)) return;
  queued.add(key);
  structureQueue.push({ ...s, key, tries: 0 });
}

function placeQueued() {
  if (!structureQueue.length) return;
  const dim = world.getDimension(SIFT_DIM);
  // no máximo duas por tick: uma árvore são algumas centenas de blocos
  for (let n = 0; n < 2 && structureQueue.length; n++) {
    const job = structureQueue.shift();
    try {
      world.structureManager.place(job.name, dim, { x: job.x, y: job.y, z: job.z },
        { includeEntities: false, rotation: job.rotation });
      queued.delete(job.key);
    } catch (e) {
      if (++job.tries < 80) structureQueue.push(job);
      else {
        queued.delete(job.key);
        warn("estrutura " + job.name, e);
      }
    }
  }
}

function finishChunk(dim, cx, cz) {
  const extras = chunkExtras(cx, cz);
  for (const s of extras.structures) queueStructure(s);
  for (const e of extras.entities) {
    try {
      dim.spawnEntity(e.id, { x: e.x, y: e.y, z: e.z });
    } catch (err) {
      warn("criatura " + e.id, err);
    }
  }
}

// ---------------------------------------------------------------------------
// O gerador que o world_generator_API consome (como o makePlanetGenerator)
// ---------------------------------------------------------------------------
const cursor = makeChunkCursor();

function generateColumn(dim, x, z) {
  const state = cursor.stateOf(x, z);
  if (state === "done") return heightAt(x, z);
  // alguma coluna ANTES desta falhou nesta passada: o cursor só anda em ordem
  if (state === "ahead") throw BudgetExhausted;

  const col = columnAt(x, z);
  let blocks = 0;
  for (const r of col.runs) blocks += r.y1 - r.y0 + 1;
  if (!takeBudget(blocks, SIFT_DIM)) throw BudgetExhausted;

  for (const r of col.runs) {
    if (r.states) dim.setBlockPermutation({ x, y: r.y0, z }, perm(r.id, r.states));
    else writeRun(dim, x, z, r.y0, r.y1, r.id);
  }
  cursor.advance(x, z);

  // última coluna do chunk: árvores, portais e criaturas
  const lx = ((x % 16) + 16) % 16;
  const lz = ((z % 16) + 16) % 16;
  if (lx === 15 && lz === 15) finishChunk(dim, Math.floor(x / 16), Math.floor(z / 16));
  return col.top;
}

export const siftGen = createTerrainGenerator({
  dimensionId: SIFT_DIM,
  generateColumn,
  getHeight: heightAt,
  genRadiusChunks: GEN_RADIUS_CHUNKS,
  chunksPerTick: CHUNKS_PER_TICK,
  registerDimension: true,
  heightRangeFallback: { min: SIFT_MIN_Y, max: SIFT_MAX_Y },
  // chunk grande pode levar vários ticks de orçamento: sem desistir no meio
  maxChunkAttempts: 100000,
  onError: (ctx, err) => warn(ctx, err),
});
siftGen.start();

system.runInterval(() => {
  try {
    placeQueued();
  } catch (e) {
    warn("fila de estruturas", e);
  }
}, 1);

// /scriptevent the_sift:debug — estado do gerador e últimos erros
system.afterEvents.scriptEventReceive.subscribe((e) => {
  if (e.id !== "the_sift:debug") return;
  const api = siftGen.estatisticas();
  const lines = [
    "§b[The Sift] gerador",
    `semente ${world.getDynamicProperty(SEED_KEY)} · estruturas na fila ${structureQueue.length}`,
    `escritos: ${api.chunks} chunks (${api.refeitas} refeitos) · fila ${api.fila} · marcadores ok ${api.marcadorOk}/falhou ${api.marcadorFalhou}`,
    ...recentErrors.map((r) => "§7" + r),
  ];
  const target = e.sourceEntity;
  for (const l of lines) {
    if (target && typeof target.sendMessage === "function") target.sendMessage(l);
    else world.sendMessage(l);
  }
});

// ---------------------------------------------------------------------------
// Névoa e nome do bioma
// ---------------------------------------------------------------------------
const FOG_LABEL = "the_sift_fog";
const fogOf = new Map();
const biomeOf = new Map();
const VISITED = "the_sift:biomes";

function pushFog(player, fogId) {
  if (fogOf.get(player.id) === fogId) return;
  fogOf.set(player.id, fogId);
  try {
    player.runCommand(`fog @s remove ${FOG_LABEL}`);
    player.runCommand(`fog @s push ${fogId} ${FOG_LABEL}`);
  } catch { }
}

export function popFog(player) {
  if (!fogOf.delete(player.id)) return;
  try { player.runCommand(`fog @s remove ${FOG_LABEL}`); } catch { }
}

function markVisited(player, id) {
  if (!ALL_SURFACE_BIOMES.includes(id)) return;
  let list = [];
  try {
    const raw = player.getDynamicProperty(VISITED);
    if (typeof raw === "string") list = JSON.parse(raw);
  } catch { }
  if (list.includes(id)) return;
  list.push(id);
  try { player.setDynamicProperty(VISITED, JSON.stringify(list)); } catch { }
  if (ALL_SURFACE_BIOMES.every((b) => list.includes(b))) award(player, "certified_sifter");
}

system.runInterval(() => {
  let dim;
  try { dim = world.getDimension(SIFT_DIM); } catch { return; }
  for (const player of dim.getPlayers()) {
    try {
      const l = player.location;
      const biome = biomeForPlayer(Math.floor(l.x), Math.floor(l.y), Math.floor(l.z));
      // céu e névoa normais; só o subsolo fundo tem névoa própria
      if (biome.fog) pushFog(player, biome.fog);
      else popFog(player);
      if (biomeOf.get(player.id) !== biome.id) {
        biomeOf.set(player.id, biome.id);
        player.onScreenDisplay.setActionBar({ rawtext: [{ text: "§b" }, { translate: "dimension.the_sift.the_sift" }, { text: " §8· §r" }, { translate: "biome.the_sift." + biome.id }] });
        markVisited(player, biome.id);
      }
    } catch (e) {
      warn("bioma", e);
    }
  }
}, 10);

world.afterEvents.playerDimensionChange.subscribe((e) => {
  if (e.fromDimension.id === SIFT_DIM) {
    popFog(e.player);
    biomeOf.delete(e.player.id);
  }
});
world.beforeEvents.playerLeave.subscribe((e) => {
  fogOf.delete(e.player.id);
  biomeOf.delete(e.player.id);
});

// ---------------------------------------------------------------------------
// Criaturas (o Bedrock não popula dimensão custom sozinho)
// ---------------------------------------------------------------------------
const SPAWNS = {
  surface: [
    { id: "minecraft:sniffer", w: 4, min: 1, max: 3 },
    { id: "the_sift:blub", w: 5, min: 1, max: 3 },
    { id: "the_sift:echo_golem", w: 1, min: 1, max: 1, spacing: 96 },
  ],
  night: [{ id: "the_sift:sifter", w: 5, min: 1, max: 2 }],
  deep: [
    { id: "the_sift:blub", w: 3, min: 1, max: 2 },
    { id: "the_sift:sifter", w: 2, min: 1, max: 1 },
  ],
};

function weighted(list) {
  let total = 0;
  for (const s of list) total += s.w;
  let r = Math.random() * total;
  for (const s of list) {
    r -= s.w;
    if (r < 0) return s;
  }
  return list[0];
}

function isNight() {
  const t = world.getTimeOfDay();
  return t > 13000 && t < 23000;
}

function airAt(dim, loc) {
  try {
    const b = dim.getBlock(loc);
    const a = dim.getBlock({ x: loc.x, y: loc.y + 1, z: loc.z });
    return !!b && !!a && b.isAir && a.isAir;
  } catch {
    return false;
  }
}

function trySpawnNear(dim, player) {
  const around = dim.getEntities({ location: player.location, maxDistance: 64 })
    .filter((e) => e.typeId.startsWith("the_sift:") || e.typeId === "minecraft:sniffer");
  if (around.length >= SPAWN_CAP_PER_PLAYER) return;

  const ang = Math.random() * Math.PI * 2;
  const rad = 24 + Math.random() * 30;
  const x = Math.floor(player.location.x + Math.cos(ang) * rad);
  const z = Math.floor(player.location.z + Math.sin(ang) * rad);
  if (!siftGen.isChunkReady(x, z)) return;

  let loc;
  let table;
  const deep = player.location.y < heightAt(Math.floor(player.location.x), Math.floor(player.location.z)) - 12;
  if (deep) {
    // procura um vão de caverna perto da altura do jogador
    const y0 = Math.floor(player.location.y);
    for (let dy = -6; dy <= 6 && !loc; dy++) {
      const c = { x, y: y0 + dy, z };
      if (airAt(dim, c)) {
        const below = dim.getBlock({ x, y: c.y - 1, z });
        if (below && !below.isAir && !below.isLiquid) loc = c;
      }
    }
    table = SPAWNS.deep;
  } else {
    loc = { x, y: heightAt(x, z) + 1, z };
    if (!airAt(dim, loc)) return;
    table = isNight() && Math.random() < 0.6 ? SPAWNS.night : SPAWNS.surface;
  }
  if (!loc) return;

  const pickd = weighted(table);
  if (pickd.spacing) {
    const near = dim.getEntities({ type: pickd.id, location: loc, maxDistance: pickd.spacing });
    if (near.length) return;
  }
  const n = pickd.min + Math.floor(Math.random() * (pickd.max - pickd.min + 1));
  for (let i = 0; i < n; i++) {
    try {
      dim.spawnEntity(pickd.id, { x: loc.x + 0.5 + (i % 2), y: loc.y, z: loc.z + 0.5 + Math.floor(i / 2) });
    } catch (e) {
      warn("spawn " + pickd.id, e);
    }
  }
}

system.runInterval(() => {
  let dim;
  try { dim = world.getDimension(SIFT_DIM); } catch { return; }
  for (const player of dim.getPlayers()) {
    try {
      if (player.getGameMode() === "Spectator") continue;
      trySpawnNear(dim, player);
    } catch (e) {
      warn("spawner", e);
    }
  }
}, SPAWN_INTERVAL);

// "Madeira Temperada": pôr fogo em madeira no Sift
world.afterEvents.playerInteractWithBlock.subscribe((e) => {
  try {
    if (e.player.dimension.id !== SIFT_DIM) return;
    const it = e.itemStack?.typeId;
    if (it !== "minecraft:flint_and_steel" && it !== "minecraft:fire_charge") return;
    if (e.block.typeId.includes("overgrown_willow") || e.block.hasTag("wood")) award(e.player, "spicewood");
  } catch { }
});

