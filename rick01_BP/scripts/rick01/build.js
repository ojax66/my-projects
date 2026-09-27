import { system, world } from "@minecraft/server";
import { TILES } from "./tiles.js";

// Coloca a construção do RAMNeighbourhood (72 estruturas de 64x64) na
// dimensão. Cada pedaço é colocado uma única vez; o progresso fica salvo no
// mundo, então se o jogo fechar no meio ele continua de onde parou.

const PLACED_PROP = "rick01:tiles_placed";
const STARTED_PROP = "rick01:build_started";

function loadPlaced() {
  try {
    return new Set(JSON.parse(world.getDynamicProperty(PLACED_PROP) ?? "[]"));
  } catch {
    return new Set();
  }
}

let placed = null;
const isPlaced = (tile) => (placed ??= loadPlaced()).has(tile.id);

function markPlaced(tile) {
  (placed ??= loadPlaced()).add(tile.id);
  world.setDynamicProperty(PLACED_PROP, JSON.stringify([...placed]));
}

// Fila única: nenhum pedaço é colocado duas vezes ao mesmo tempo.
let chain = Promise.resolve();
function enqueue(fn) {
  const p = chain.then(fn);
  chain = p.catch((e) => console.warn("[rick:01] construção: " + e));
  return p;
}

let areaN = 0;

async function placeTile(dim, tile) {
  if (isPlaced(tile)) return;
  const manager = world.tickingAreaManager;
  const options = {
    dimension: dim,
    from: { x: tile.x, y: tile.y, z: tile.z },
    to: { x: tile.x + tile.sx - 1, y: tile.y + tile.sy - 1, z: tile.z + tile.sz - 1 },
  };
  // espera sobrar espaço de ticking area (o gerador de terreno também usa)
  for (let i = 0; i < 60 && !manager.hasCapacity(options); i++) await system.waitTicks(20);

  const id = "rick01_build_" + ++areaN;
  await manager.createTickingArea(id, options);
  try {
    world.structureManager.place(tile.id, dim, { x: tile.x, y: tile.y, z: tile.z });
    markPlaced(tile);
  } finally {
    if (manager.hasTickingArea(id)) manager.removeTickingArea(id);
  }
}

const distTo = (tile, x, z) => {
  const dx = Math.max(tile.x - x, 0, x - (tile.x + tile.sx - 1));
  const dz = Math.max(tile.z - z, 0, z - (tile.z + tile.sz - 1));
  return dx * dx + dz * dz;
};

/** Coloca os pedaços num raio `radius` em volta de (x, z). */
export function placeAround(dim, x, z, radius) {
  const tiles = TILES.filter((t) => !isPlaced(t) && distTo(t, x, z) <= radius * radius);
  return Promise.all(tiles.map((t) => enqueue(() => placeTile(dim, t))));
}

let fullBuild = null;

/** Coloca o resto da construção, do centro para fora. */
export function placeAll(dim) {
  if (fullBuild) return fullBuild;
  world.setDynamicProperty(STARTED_PROP, true);
  const todo = TILES.filter((t) => !isPlaced(t)).sort((a, b) => distTo(a, 0, 0) - distTo(b, 0, 0));
  let done = TILES.length - todo.length;
  fullBuild = Promise.all(
    todo.map((t) =>
      enqueue(async () => {
        await placeTile(dim, t);
        done++;
        for (const p of dim.getPlayers()) p.onScreenDisplay.setActionBar(`§aCarregando construção: ${done}/${TILES.length}`);
      }),
    ),
  ).finally(() => {
    fullBuild = null;
  });
  return fullBuild;
}

export function isBuildComplete() {
  return TILES.every(isPlaced);
}

/** Se a colocação começou numa sessão anterior e não terminou, continua. */
export function resumeBuild(dim) {
  if (world.getDynamicProperty(STARTED_PROP) && !isBuildComplete()) placeAll(dim);
}
