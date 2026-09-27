import { BlockVolume, StructureSaveMode, system, world } from "@minecraft/server";
import { BUILD_BOX } from "./tiles.js";

// Terreno da rick:01 = cópia exata do overworld deste mundo, nas mesmas
// coordenadas. O próprio jogo gera o chunk do overworld a partir da seed
// (ticking area temporária) e ele é copiado inteiro para a rick:01 com
// structureManager — mesmos blocos, minérios, cavernas, árvores, água,
// baús de estruturas etc.
//
// Dentro do quadrado da construção só é copiado o que fica abaixo dela
// (até Y 102) e o espaço entre o chão do overworld e a construção é
// preenchido com pedra e terra para ela não ficar flutuando.

const MAX_PENDING = 8; // chunks do overworld carregando ao mesmo tempo
const STALE_TICKS = 400; // libera ticking areas de chunks que saíram da fila

const pending = new Map(); // "cx,cz" -> { id, ready, since }
let areaN = 0;
let structN = 0;

const key = (cx, cz) => cx + "," + cz;
const overworld = () => world.getDimension("minecraft:overworld");

function releaseArea(k) {
  const p = pending.get(k);
  if (!p) return;
  pending.delete(k);
  const manager = world.tickingAreaManager;
  if (manager.hasTickingArea(p.id)) manager.removeTickingArea(p.id);
}

/**
 * Chamado pela API antes de gerar um chunk. Pede para o overworld carregar
 * (e gerar pela seed) o mesmo chunk e só libera quando ele estiver pronto.
 */
export function canGenerateChunk(dim, cx, cz) {
  const k = key(cx, cz);
  const p = pending.get(k);
  if (p) return p.ready;
  if (pending.size >= MAX_PENDING) return false;

  const ow = overworld();
  const hr = ow.heightRange;
  // 3x3 chunks: os vizinhos garantem que árvores/estruturas da borda já foram geradas
  const options = {
    dimension: ow,
    from: { x: cx * 16 - 16, y: hr.min, z: cz * 16 - 16 },
    to: { x: cx * 16 + 31, y: hr.max - 1, z: cz * 16 + 31 },
  };
  const manager = world.tickingAreaManager;
  if (!manager.hasCapacity(options)) return false;

  const entry = { id: "rick01_ow_" + ++areaN, ready: false, since: system.currentTick };
  pending.set(k, entry);
  manager
    .createTickingArea(entry.id, options)
    .then(() => {
      entry.ready = true;
      entry.since = system.currentTick;
    })
    .catch((e) => {
      console.warn("[rick:01] ticking area do overworld " + k + ": " + e);
      releaseArea(k);
    });
  return false;
}

// Se o jogador se afastou, o chunk pode sair da fila sem ser gerado.
system.runInterval(() => {
  const now = system.currentTick;
  for (const [k, p] of pending) if (p.ready && now - p.since > STALE_TICKS) releaseArea(k);
}, 100);

// Separa o chunk em retângulos: fora do quadrado da construção (altura toda)
// e dentro dele (só até abaixo da construção).
function splitChunk(x0, z0, x1, z1) {
  const b = BUILD_BOX;
  const ix0 = Math.max(x0, b.min.x), ix1 = Math.min(x1, b.max.x);
  const iz0 = Math.max(z0, b.min.z), iz1 = Math.min(z1, b.max.z);
  if (ix0 > ix1 || iz0 > iz1) return { outside: [{ x0, z0, x1, z1 }], inside: null };
  const outside = [];
  if (x0 < ix0) outside.push({ x0, z0, x1: ix0 - 1, z1 });
  if (ix1 < x1) outside.push({ x0: ix1 + 1, z0, x1, z1 });
  if (z0 < iz0) outside.push({ x0: ix0, z0, x1: ix1, z1: iz0 - 1 });
  if (iz1 < z1) outside.push({ x0: ix0, z0: iz1 + 1, x1: ix1, z1 });
  return { outside, inside: { x0: ix0, z0: iz0, x1: ix1, z1: iz1 } };
}

function copyRect(ow, dim, r, minY, maxY) {
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

// Preenche do chão do overworld até embaixo da construção.
function fillUnderBuild(ow, dim, r) {
  const top = BUILD_BOX.min.y - 1;
  for (let x = r.x0; x <= r.x1; x++) {
    for (let z = r.z0; z <= r.z1; z++) {
      const surface = ow.getTopmostBlock({ x, z })?.y ?? ow.heightRange.min;
      if (surface >= top) continue;
      const dirtFrom = Math.max(surface + 1, top - 2);
      if (surface + 1 < dirtFrom) dim.fillBlocks(blockVolume(x, surface + 1, dirtFrom - 1, z), "minecraft:stone");
      dim.fillBlocks(blockVolume(x, dirtFrom, top, z), "minecraft:dirt");
    }
  }
}

function blockVolume(x, y0, y1, z) {
  return new BlockVolume({ x, y: y0, z }, { x, y: y1, z });
}

function copyChunk(dim, cx, cz) {
  const ow = overworld();
  const minY = Math.max(ow.heightRange.min, dim.heightRange.min);
  const maxY = Math.min(ow.heightRange.max, dim.heightRange.max) - 1;
  const x0 = cx * 16, z0 = cz * 16;
  if (!ow.isChunkLoaded({ x: x0, y: 0, z: z0 })) throw new Error("chunk do overworld não carregado");

  const { outside, inside } = splitChunk(x0, z0, x0 + 15, z0 + 15);
  for (const r of outside) copyRect(ow, dim, r, minY, maxY);
  if (inside) {
    copyRect(ow, dim, inside, minY, BUILD_BOX.min.y - 1);
    fillUnderBuild(ow, dim, inside);
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
