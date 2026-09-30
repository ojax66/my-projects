/* =========================================================================
 * A dimensão do Sift: registro, gerador de terreno, árvores e estruturas,
 * criaturas, névoa e nome do bioma.
 *
 * O terreno é escrito pelo world_generator_API (o mesmo do Galactic
 * Horizons), com o orçamento de blocos por tick do budget.js. Cada coluna
 * vem pronta de terrain.js; aqui só se escreve.
 * ========================================================================= */

import { world, system, BlockPermutation, BlockVolume } from "@minecraft/server";
import { createTerrainGenerator } from "../lib/world_generator_API.js";
import { BudgetExhausted, isBudgetError, makeChunkCursor, takeBudget } from "../lib/budget.js";
import {
  CHUNKS_PER_TICK, GEN_RADIUS_CHUNKS, SIFT_DIM, SIFT_MAX_Y, SIFT_MIN_Y, SPAWN_CAP_PER_PLAYER, SPAWN_INTERVAL,
} from "../config.js";
import { biomeForPlayer, getService, heightAt, onGenError, ALL_SURFACE_BIOMES } from "./terrain.js";
import { blockOf } from "./gen/palette.js";
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
onGenError(warn);

// ---------------------------------------------------------------------------
// Blocos: índice da paleta do gerador -> BlockPermutation
// ---------------------------------------------------------------------------
const perms = [];
function permOf(i) {
  let p = perms[i];
  if (p) return p;
  const b = blockOf(i);
  try {
    p = BlockPermutation.resolve(b.id, b.states);
  } catch (e) {
    // estado que o Bedrock não conhece: fica o bloco com os estados padrão
    try {
      p = BlockPermutation.resolve(b.id);
    } catch (e2) {
      warn("bloco " + b.id, e2);
      p = BlockPermutation.resolve("minecraft:stone");
    }
  }
  perms[i] = p;
  return p;
}

function writeRun(dim, x, z, y0, y1, block) {
  const p = permOf(block);
  if (y0 === y1) dim.setBlockPermutation({ x, y: y0, z }, p);
  else dim.fillBlocks(new BlockVolume({ x, y: y0, z }, { x, y: y1, z }), p);
}

// ---------------------------------------------------------------------------
// Depois de escrito: criaturas da geração (farejadores) e baús com loot
// ---------------------------------------------------------------------------
function finishChunk(dim, f) {
  for (const e of f.entities) {
    try {
      if (e.baby) dim.runCommand(`summon ${e.id} ${e.x} ${e.y} ${e.z} 0 0 minecraft:entity_born`);
      else dim.spawnEntity(e.id, { x: e.x, y: e.y, z: e.z });
    } catch (err) {
      warn("criatura " + e.id, err);
    }
  }
  for (const c of f.chests) {
    try {
      dim.runCommand(`loot replace block ${c[0]} ${c[1]} ${c[2]} slot.container 0 loot "the_sift/chests/abandoned_portal"`);
    } catch (err) {
      warn("baú", err);
    }
  }
}

// ---------------------------------------------------------------------------
// O gerador: a API escreve, o serviço calcula em segundo plano
// ---------------------------------------------------------------------------
const cursor = makeChunkCursor();

function generateColumn(dim, x, z) {
  const s = getService();
  const cx = Math.floor(x / 16);
  const cz = Math.floor(z / 16);
  const f = s.peek(cx, cz);
  if (!f) {
    s.request(cx, cz, -1);
    throw BudgetExhausted;
  }
  const col = ((x - cx * 16) << 4) | (z - cz * 16);
  const state = cursor.stateOf(x, z);
  if (state === "done") return f.top[col];
  if (state === "ahead") throw BudgetExhausted;

  const runs = f.runs[col];
  let blocks = 0;
  for (let i = 0; i < runs.length; i += 3) blocks += runs[i + 1] - runs[i] + 1;
  if (!takeBudget(Math.max(1, blocks), SIFT_DIM)) throw BudgetExhausted;
  for (let i = 0; i < runs.length; i += 3) writeRun(dim, x, z, runs[i], runs[i + 1], runs[i + 2]);
  cursor.advance(x, z);
  if (col === 255) {
    finishChunk(dim, f);
    s.release(cx, cz);
  }
  return f.top[col];
}

export const siftGen = createTerrainGenerator({
  dimensionId: SIFT_DIM,
  generateColumn,
  getHeight: (x, z) => heightAt(x, z),
  genRadiusChunks: GEN_RADIUS_CHUNKS,
  chunksPerTick: CHUNKS_PER_TICK,
  registerDimension: true,
  heightRangeFallback: { min: SIFT_MIN_Y, max: SIFT_MAX_Y },
  // o chunk só é escrito quando o cálculo em segundo plano termina: esperar
  // não é falha, então não há limite de tentativas
  maxChunkAttempts: Number.MAX_SAFE_INTEGER,
  onError: (ctx, err) => warn(ctx, err),
});
siftGen.start();

// cálculo em segundo plano
let workerStarted = false;
world.afterEvents.worldLoad.subscribe(() => {
  if (workerStarted) return;
  workerStarted = true;
  system.runJob(getService().worker(() => Date.now()));
});

// chunks já escritos em sessões anteriores (marcador da API no fundo)
const markerDone = new Set();
function chunkDone(dim, cx, cz) {
  const k = cx + "," + cz;
  if (markerDone.has(k) || siftGen.isChunkReady(cx * 16, cz * 16)) return true;
  try {
    if (dim.getBlock({ x: cx * 16, y: SIFT_MIN_Y, z: cz * 16 })?.typeId === "minecraft:barrier") {
      markerDone.add(k);
      return true;
    }
  } catch { }
  return false;
}

// Pede com antecedência os chunks em volta de quem está no Sift (os mais
// perto e os da frente primeiro), e esquece os que ficaram longe.
system.runInterval(() => {
  if (!workerStarted) return;
  let dim;
  try { dim = world.getDimension(SIFT_DIM); } catch { return; }
  const players = dim.getPlayers();
  if (!players.length) return;
  const s = getService();
  const centers = [];
  const R = GEN_RADIUS_CHUNKS + 1;
  for (const p of players) {
    const pcx = Math.floor(p.location.x / 16);
    const pcz = Math.floor(p.location.z / 16);
    centers.push([pcx, pcz]);
    let v = { x: 0, z: 0 };
    try { v = p.getViewDirection(); } catch { }
    const len = Math.hypot(v.x, v.z) || 1;
    for (let dx = -R; dx <= R; dx++) {
      for (let dz = -R; dz <= R; dz++) {
        if (chunkDone(dim, pcx + dx, pcz + dz)) continue;
        const d2 = dx * dx + dz * dz;
        const cos = d2 ? (dx * v.x + dz * v.z) / (len * Math.sqrt(d2)) : 1;
        s.request(pcx + dx, pcz + dz, d2 * (1 + (1 - cos)));
      }
    }
  }
  s.prune((k) => {
    const [cx, cz] = k.split(",").map(Number);
    return centers.some((c) => Math.abs(c[0] - cx) <= R + 1 && Math.abs(c[1] - cz) <= R + 1);
  });
}, 10);

// /scriptevent the_sift:debug — estado do gerador e últimos erros
system.afterEvents.scriptEventReceive.subscribe((e) => {
  if (e.id !== "the_sift:debug") return;
  const s = getService();
  const api = siftGen.estatisticas();
  const lines = [
    "§b[The Sift] gerador",
    `semente ${s.seed} · pedidos ${s.want.size} · prontos ${s.finals.size}`,
    `calculados: base ${s.stats.bases}, decoração ${s.stats.decors}, final ${s.stats.finals} · erros ${s.stats.erros}`,
    `escritos: ${api.chunks} chunks (${api.refeitas} refeitos) · fila ${api.fila} · marcadores ok ${api.marcadorOk}/falhou ${api.marcadorFalhou}`,
    s.missing.length ? "§cfeatures faltando: " + s.missing.join(", ") : "features: todas ok",
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
      // de noite a névoa escurece, como o fog_color do timeline do Java
      const deep = biome.fog === "the_sift:fog_sift_deep";
      pushFog(player, !deep && isNight() ? biome.fog + "_night" : biome.fog);
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
    .filter((e) => (e.typeId.startsWith("the_sift:") && e.typeId !== "the_sift:sky") || e.typeId === "minecraft:sniffer");
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

