import { BlockVolume, StructureSaveMode, system, world } from "@minecraft/server";
import { BUILD_BOX, BUILD_CHUNKS } from "./tiles.js";

export const DIMENSION_ID = "rick:01";

// Terreno da rick:01 = cópia exata do overworld deste mundo, nas mesmas
// coordenadas. O próprio jogo gera o chunk do overworld a partir da seed
// (ticking area temporária) e ele é copiado inteiro para a rick:01 com
// structureManager — mesmos blocos, minérios, cavernas, árvores, água,
// baús de estruturas e as entidades que estiverem no chunk.
//
// Nos chunks do quadrado da construção, o pedaço dela (um .mcstructure por
// chunk) é colocado junto, na altura do chão do overworld no centro do
// quadrado; abaixo dela vem o overworld copiado, acima só o céu.

// Velocidade: uma ticking area grande no overworld acompanha cada jogador que
// está na rick:01 (o "espelho"), então os chunks do overworld em volta dele já
// estão carregados quando chega a vez deles e a cópia é imediata. Se algum
// chunk ficar fora do espelho, ele é pedido sozinho (MAX_PENDING de cada vez).
export const GEN_RADIUS_CHUNKS = 7;
const MIRROR_RADII = [(GEN_RADIUS_CHUNKS + 1) * 16 + 32, (GEN_RADIUS_CHUNKS + 1) * 16, GEN_RADIUS_CHUNKS * 16];
const MIRROR_RECENTER = 32;
// milissegundos por tick gastos copiando chunks (o resto fica para o jogo)
const TICK_BUDGET_MS = 30;

const MAX_PENDING = 8; // chunks do overworld carregando sozinhos ao mesmo tempo
const STALE_TICKS = 400; // libera ticking areas de chunks que saíram da fila
const BASE_PROP = "rick01:build_base_y";

const pending = new Map(); // "cx,cz" -> { id, ready, since, promise }
let areaN = 0;
let structN = 0;

const key = (cx, cz) => cx + "," + cz;
const overworld = () => world.getDimension("minecraft:overworld");

// ------------------------------------------------ altura da construção

let baseY = null;
let baseYPromise = null;

// blocos que não contam como chão ao medir o overworld
const NOT_GROUND = /leaves|_log$|_wood$|vine|short_grass|tall_grass|fern|flower|bush|sapling|mushroom|snow_layer|sugar_cane|bamboo|kelp|seagrass|dandelion|poppy|tulip|orchid|allium|bluet|daisy|cornflower|lily|rose|peony|lilac/;

function groundY(ow, x, z) {
  let b = ow.getTopmostBlock({ x, z });
  while (b && b.y > ow.heightRange.min && NOT_GROUND.test(b.typeId)) b = b.below();
  return b?.y;
}

/**
 * Y onde começa a construção (a grama dela fica em Y + grassOffset). Na
 * primeira vez mede o chão do overworld no centro do quadrado; depois fica
 * salvo no mundo.
 */
export function ensureBaseY() {
  if (baseY !== null) return Promise.resolve(baseY);
  const saved = world.getDynamicProperty(BASE_PROP);
  if (typeof saved === "number") {
    baseY = saved;
    return Promise.resolve(baseY);
  }
  baseYPromise ??= (async () => {
    const ow = overworld();
    const id = "rick01_base";
    try {
      await world.tickingAreaManager.createTickingArea(id, {
        dimension: ow,
        from: { x: -24, y: ow.heightRange.min, z: -24 },
        to: { x: 24, y: ow.heightRange.max - 1, z: 24 },
      });
      const ys = [];
      for (let x = -24; x <= 24; x += 8) for (let z = -24; z <= 24; z += 8) {
        const y = groundY(ow, x, z);
        if (y !== undefined) ys.push(y);
      }
      ys.sort((a, b) => a - b);
      const ground = ys.length ? ys[ys.length >> 1] : 63;
      const hr = ow.heightRange;
      baseY = Math.max(hr.min, Math.min(ground - BUILD_BOX.grassOffset, hr.max - BUILD_BOX.height));
      world.setDynamicProperty(BASE_PROP, baseY);
      return baseY;
    } finally {
      if (world.tickingAreaManager.hasTickingArea(id)) world.tickingAreaManager.removeTickingArea(id);
      baseYPromise = null;
    }
  })();
  return baseYPromise;
}

/** Ponto de chegada do /rick:01: em pé na grama no centro da construção. */
export function spawnPoint() {
  return { x: 0.5, y: baseY + BUILD_BOX.grassOffset + 1, z: 0.5 };
}

// ------------------------------------------------ carregar o overworld

function releaseArea(k) {
  const p = pending.get(k);
  if (!p) return;
  pending.delete(k);
  const manager = world.tickingAreaManager;
  if (manager.hasTickingArea(p.id)) manager.removeTickingArea(p.id);
}

function requestOverworldChunk(cx, cz) {
  const k = key(cx, cz);
  const existing = pending.get(k);
  if (existing) return existing;
  if (pending.size >= MAX_PENDING) return null;

  const ow = overworld();
  const hr = ow.heightRange;
  // 3x3 chunks: os vizinhos garantem que árvores/estruturas da borda já foram geradas
  const options = {
    dimension: ow,
    from: { x: cx * 16 - 16, y: hr.min, z: cz * 16 - 16 },
    to: { x: cx * 16 + 31, y: hr.max - 1, z: cz * 16 + 31 },
  };
  const manager = world.tickingAreaManager;
  if (!manager.hasCapacity(options)) return null;

  const entry = { id: "rick01_ow_" + ++areaN, ready: false, since: system.currentTick, promise: null };
  pending.set(k, entry);
  entry.promise = manager.createTickingArea(entry.id, options).then(
    () => {
      entry.ready = true;
      entry.since = system.currentTick;
    },
    (e) => {
      console.warn("[rick:01] ticking area do overworld " + k + ": " + e);
      releaseArea(k);
      throw e;
    },
  );
  entry.promise.catch(() => {});
  return entry;
}

const inBuild = (cx, cz) => BUILD_CHUNKS[key(cx, cz)] !== undefined;

// ------------------------------------------------ espelho no overworld

const mirrors = new Map(); // player.id -> { id, x, z }
const mirrorBusy = new Set();
let mirrorN = 0;

async function syncMirror(player) {
  if (mirrorBusy.has(player.id)) return;
  const loc = player.location;
  const cur = mirrors.get(player.id);
  if (cur && Math.abs(loc.x - cur.x) < MIRROR_RECENTER && Math.abs(loc.z - cur.z) < MIRROR_RECENTER) return;

  mirrorBusy.add(player.id);
  const manager = world.tickingAreaManager;
  const ow = overworld();
  const hr = ow.heightRange;
  const id = "rick01_mirror_" + ++mirrorN;
  try {
    let options = null;
    for (const r of MIRROR_RADII) {
      const o = {
        dimension: ow,
        from: { x: Math.floor(loc.x - r), y: hr.min, z: Math.floor(loc.z - r) },
        to: { x: Math.floor(loc.x + r), y: hr.max - 1, z: Math.floor(loc.z + r) },
      };
      if (manager.hasCapacity(o)) {
        options = o;
        break;
      }
    }
    // sem espaço nem para o menor: solta o espelho antigo e usa o menor
    if (!options) {
      if (cur && manager.hasTickingArea(cur.id)) manager.removeTickingArea(cur.id);
      mirrors.delete(player.id);
      const r = MIRROR_RADII[MIRROR_RADII.length - 1];
      options = {
        dimension: ow,
        from: { x: Math.floor(loc.x - r), y: hr.min, z: Math.floor(loc.z - r) },
        to: { x: Math.floor(loc.x + r), y: hr.max - 1, z: Math.floor(loc.z + r) },
      };
    }
    await manager.createTickingArea(id, options);
    const old = mirrors.get(player.id);
    if (old && manager.hasTickingArea(old.id)) manager.removeTickingArea(old.id);
    mirrors.set(player.id, { id, x: loc.x, z: loc.z });
  } catch (e) {
    // tenta de novo no próximo tick
    if (manager.hasTickingArea(id)) manager.removeTickingArea(id);
    console.warn("[rick:01] espelho do overworld: " + e);
  } finally {
    mirrorBusy.delete(player.id);
  }
}

function dropMirror(playerId) {
  const cur = mirrors.get(playerId);
  if (cur && world.tickingAreaManager.hasTickingArea(cur.id)) world.tickingAreaManager.removeTickingArea(cur.id);
  mirrors.delete(playerId);
}

// Todo tick: espelho para quem está na rick:01, solta o de quem saiu.
system.runInterval(() => {
  let players;
  try {
    players = world.getDimension(DIMENSION_ID).getPlayers();
  } catch {
    return;
  }
  const inside = new Set();
  for (const p of players) {
    inside.add(p.id);
    syncMirror(p);
  }
  for (const id of [...mirrors.keys()]) if (!inside.has(id) && !mirrorBusy.has(id)) dropMirror(id);
}, 1);

// ------------------------------------------------ orçamento de tempo por tick

let budgetTick = -1;
let spentMs = 0;
function budgetLeft() {
  if (system.currentTick !== budgetTick) {
    budgetTick = system.currentTick;
    spentMs = 0;
  }
  return spentMs < TICK_BUDGET_MS;
}

// o chunk do overworld e os vizinhos (árvores/estruturas que cruzam a borda) carregados
function overworldReady(ow, cx, cz) {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (!ow.isChunkLoaded({ x: (cx + dx) * 16, y: 0, z: (cz + dz) * 16 })) return false;
    }
  }
  return true;
}

/**
 * Hook da API: o chunk só é gerado quando o mesmo chunk do overworld já está
 * carregado (e, no quadrado da construção, quando a altura dela é conhecida).
 */
export function canGenerateChunk(dim, cx, cz) {
  if (inBuild(cx, cz) && baseY === null) {
    ensureBaseY().catch((e) => console.warn("[rick:01] altura da construção: " + e));
    return false;
  }
  if (overworldReady(overworld(), cx, cz)) return budgetLeft();
  // fora do espelho (ou ele ainda carregando): pede só esse chunk
  return (requestOverworldChunk(cx, cz)?.ready ?? false) && budgetLeft();
}

/** Espera o overworld carregar esses chunks (usado antes do teleporte). Tenta até conseguir. */
export async function preloadChunks(chunks) {
  for (const [cx, cz] of chunks) {
    for (;;) {
      const entry = requestOverworldChunk(cx, cz);
      if (entry) {
        try {
          await entry.promise;
          break;
        } catch {
          // falhou: tenta de novo abaixo
        }
      }
      await system.waitTicks(10);
    }
  }
}

// Se o jogador se afastou, o chunk pode sair da fila sem ser gerado.
system.runInterval(() => {
  const now = system.currentTick;
  for (const [k, p] of pending) if (p.ready && now - p.since > STALE_TICKS) releaseArea(k);
}, 100);

// ------------------------------------------------ cópia

function copyRect(ow, dim, r, minY, maxY) {
  if (maxY < minY) return;
  const from = { x: r.x0, y: minY, z: r.z0 };
  const structure = world.structureManager.createFromWorld(
    "rick01:ow_" + ++structN,
    ow,
    from,
    { x: r.x1, y: maxY, z: r.z1 },
    { includeEntities: true, saveMode: StructureSaveMode.Memory },
  );
  try {
    world.structureManager.place(structure, dim, from, { includeEntities: true });
  } finally {
    world.structureManager.delete(structure);
  }
}

// Separa o chunk em: a parte da construção e o resto (retângulos).
function splitChunk(x0, z0, x1, z1, b) {
  if (!b) return { outside: [{ x0, z0, x1, z1 }], inside: null };
  const ix0 = b.x, ix1 = b.x + b.sx - 1, iz0 = b.z, iz1 = b.z + b.sz - 1;
  const outside = [];
  if (x0 < ix0) outside.push({ x0, z0, x1: ix0 - 1, z1 });
  if (ix1 < x1) outside.push({ x0: ix1 + 1, z0, x1, z1 });
  if (z0 < iz0) outside.push({ x0: ix0, z0, x1: ix1, z1: iz0 - 1 });
  if (iz1 < z1) outside.push({ x0: ix0, z0: iz1 + 1, x1: ix1, z1 });
  return { outside, inside: { x0: ix0, z0: iz0, x1: ix1, z1: iz1 } };
}

// esvazia a parte acima da construção (em fatias de até 32768 blocos)
function clearAbove(dim, r, fromY, maxY) {
  const area = (r.x1 - r.x0 + 1) * (r.z1 - r.z0 + 1);
  const step = Math.max(1, Math.floor(32768 / area));
  for (let y = fromY; y <= maxY; y += step) {
    dim.fillBlocks(new BlockVolume({ x: r.x0, y, z: r.z0 }, { x: r.x1, y: Math.min(y + step - 1, maxY), z: r.z1 }), "minecraft:air");
  }
}

function copyChunk(dim, cx, cz) {
  const ow = overworld();
  const minY = Math.max(ow.heightRange.min, dim.heightRange.min);
  const maxY = Math.min(ow.heightRange.max, dim.heightRange.max) - 1;
  const x0 = cx * 16, z0 = cz * 16;
  if (!ow.isChunkLoaded({ x: x0, y: 0, z: z0 })) {
    // descarregou: pede a ticking area de novo
    releaseArea(key(cx, cz));
    throw new Error("chunk do overworld não carregado");
  }

  const build = BUILD_CHUNKS[key(cx, cz)];
  const { outside, inside } = splitChunk(x0, z0, x0 + 15, z0 + 15, build);
  for (const r of outside) copyRect(ow, dim, r, minY, maxY);
  if (inside) {
    copyRect(ow, dim, inside, minY, baseY - 1);
    clearAbove(dim, inside, baseY + BUILD_BOX.height, maxY);
    world.structureManager.place(build.id, dim, { x: build.x, y: baseY, z: build.z });
  }
}

/** generateColumn da API: a cópia é feita por chunk, na primeira coluna. */
export function generateColumn(dim, x, z) {
  const lx = ((x % 16) + 16) % 16;
  const lz = ((z % 16) + 16) % 16;
  if (lx !== 0 || lz !== 0) return undefined;
  const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
  const t0 = Date.now();
  try {
    copyChunk(dim, cx, cz);
  } finally {
    budgetLeft();
    spentMs += Date.now() - t0;
  }
  // só solta o overworld depois de copiar; se falhar, a área fica para a próxima tentativa
  releaseArea(key(cx, cz));
  return undefined;
}
