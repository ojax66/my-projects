import { BlockVolume, StructureSaveMode, system, world } from "@minecraft/server";
import { BUILD_BOX, BUILD_CHUNKS } from "./tiles.js";

// Terreno da rick:01 = cópia exata do overworld deste mundo, nas mesmas
// coordenadas. O próprio jogo gera o chunk do overworld a partir da seed
// (ticking area temporária) e ele é copiado inteiro para a rick:01 com
// structureManager — mesmos blocos, minérios, cavernas, árvores, água,
// baús de estruturas etc.
//
// Nos chunks do quadrado da construção, o pedaço dela (um .mcstructure por
// chunk) é colocado junto, na altura do chão do overworld no centro do
// quadrado; abaixo dela vem o overworld copiado, acima só o céu.

const MAX_PENDING = 8; // chunks do overworld carregando ao mesmo tempo
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
    await world.tickingAreaManager.createTickingArea(id, {
      dimension: ow,
      from: { x: -24, y: ow.heightRange.min, z: -24 },
      to: { x: 24, y: ow.heightRange.max - 1, z: 24 },
    });
    try {
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

/**
 * Hook da API: o chunk só é gerado quando o mesmo chunk do overworld já está
 * carregado (e, no quadrado da construção, quando a altura dela é conhecida).
 */
export function canGenerateChunk(dim, cx, cz) {
  if (inBuild(cx, cz) && baseY === null) {
    ensureBaseY().catch((e) => console.warn("[rick:01] altura da construção: " + e));
    return false;
  }
  return requestOverworldChunk(cx, cz)?.ready ?? false;
}

/** Espera o overworld carregar esses chunks (usado antes do teleporte). */
export async function preloadChunks(chunks) {
  for (const [cx, cz] of chunks) {
    let entry = requestOverworldChunk(cx, cz);
    while (!entry) {
      await system.waitTicks(5);
      entry = requestOverworldChunk(cx, cz);
    }
    await entry.promise;
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
    { includeEntities: false, saveMode: StructureSaveMode.Memory },
  );
  try {
    world.structureManager.place(structure, dim, from, { includeEntities: false });
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
  if (!ow.isChunkLoaded({ x: x0, y: 0, z: z0 })) throw new Error("chunk do overworld não carregado");

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
  try {
    copyChunk(dim, cx, cz);
  } finally {
    releaseArea(key(cx, cz));
  }
  return undefined;
}
