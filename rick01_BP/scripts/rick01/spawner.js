import { system, world } from "@minecraft/server";

// Mobs na rick:01. Os que já existem no chunk do overworld vêm junto na cópia;
// este spawner faz o resto nascer como no overworld: animais de dia no chão do
// bioma certo (o bioma é lido do overworld, na mesma coordenada), monstros no
// escuro (à noite na superfície ou em cavernas), slimes nos slime chunks
// (abaixo do Y 40) e em pântanos à noite, e peixes/lulas na água.

const DIMENSION_ID = "rick:01";
const INTERVAL = 10; // ticks entre rodadas
const ATTEMPTS = 4; // tentativas por jogador por rodada
const MIN_DIST = 24;
const MAX_DIST = 64;
const CAP_RADIUS = 96;
const CAP_HOSTILE = 30;
const CAP_PASSIVE = 12;
const CAP_WATER = 8;

const overworld = () => world.getDimension("minecraft:overworld");

// [entidade, peso]
const HOSTILE = [
  ["minecraft:zombie", 100],
  ["minecraft:skeleton", 100],
  ["minecraft:spider", 100],
  ["minecraft:creeper", 100],
  ["minecraft:enderman", 10],
  ["minecraft:witch", 5],
  ["minecraft:zombie_villager", 5],
];
const PASSIVE_DEFAULT = [["minecraft:cow", 8], ["minecraft:sheep", 12], ["minecraft:pig", 10], ["minecraft:chicken", 10]];
// bioma do overworld (trecho do id) -> animais
const PASSIVE_BY_BIOME = [
  ["mushroom", [["minecraft:mooshroom", 8]]],
  ["desert", [["minecraft:rabbit", 4], ["minecraft:camel", 1]]],
  ["badlands", [["minecraft:armadillo", 6]]],
  ["mesa", [["minecraft:armadillo", 6]]],
  ["savanna", [["minecraft:horse", 1], ["minecraft:donkey", 1], ["minecraft:llama", 8], ["minecraft:armadillo", 10], ...PASSIVE_DEFAULT]],
  ["jungle", [["minecraft:parrot", 40], ["minecraft:ocelot", 2], ["minecraft:panda", 1], ["minecraft:chicken", 10]]],
  ["frozen", [["minecraft:rabbit", 10], ["minecraft:polar_bear", 1]]],
  ["ice", [["minecraft:rabbit", 10], ["minecraft:polar_bear", 1]]],
  ["snow", [["minecraft:rabbit", 10], ["minecraft:polar_bear", 1]]],
  ["grove", [["minecraft:rabbit", 8], ["minecraft:wolf", 1], ["minecraft:fox", 8]]],
  ["taiga", [["minecraft:wolf", 8], ["minecraft:rabbit", 4], ["minecraft:fox", 8], ...PASSIVE_DEFAULT]],
  ["meadow", [["minecraft:donkey", 1], ["minecraft:rabbit", 2], ["minecraft:sheep", 2]]],
  ["cherry", [["minecraft:pig", 1], ["minecraft:rabbit", 2], ["minecraft:sheep", 2]]],
  ["swamp", [["minecraft:frog", 10], ...PASSIVE_DEFAULT]],
  ["plains", [["minecraft:horse", 5], ["minecraft:donkey", 1], ...PASSIVE_DEFAULT]],
  ["forest", [["minecraft:wolf", 5], ...PASSIVE_DEFAULT]],
];
const WATER_BY_BIOME = [
  ["warm", [["minecraft:tropicalfish", 25], ["minecraft:pufferfish", 3], ["minecraft:dolphin", 2], ["minecraft:squid", 3]]],
  ["lukewarm", [["minecraft:tropicalfish", 25], ["minecraft:pufferfish", 5], ["minecraft:cod", 15], ["minecraft:dolphin", 2], ["minecraft:squid", 3]]],
  ["ocean", [["minecraft:cod", 15], ["minecraft:squid", 3], ["minecraft:dolphin", 1], ["minecraft:salmon", 5]]],
  ["river", [["minecraft:salmon", 5], ["minecraft:squid", 2]]],
];
const GROUND_FOR_ANIMALS = /grass_block|sand|snow|podzol|mycelium|dirt|moss/;

const ALL_PASSIVE = new Set([
  ...PASSIVE_DEFAULT.map((e) => e[0]),
  ...PASSIVE_BY_BIOME.flatMap((b) => b[1].map((e) => e[0])),
]);
const ALL_WATER = new Set(WATER_BY_BIOME.flatMap((b) => b[1].map((e) => e[0])));

function pick(list) {
  let total = 0;
  for (const [, w] of list) total += w;
  let r = Math.random() * total;
  for (const [id, w] of list) if ((r -= w) < 0) return id;
  return list[list.length - 1][0];
}

function byBiome(table, biomeId, fallback) {
  for (const [part, list] of table) if (biomeId.includes(part)) return list;
  return fallback;
}

// ---------------------------------------------------------------- slime chunks
// Slime chunks do Bedrock não dependem da seed: MT19937 com semente
// (cx * 0x1f1f1f1f) ^ cz, primeiro número % 10 === 0.
const slimeCache = new Map();
function isSlimeChunk(cx, cz) {
  const k = cx + "," + cz;
  let v = slimeCache.get(k);
  if (v !== undefined) return v;
  const mt = new Uint32Array(624);
  mt[0] = (Math.imul(cx, 0x1f1f1f1f) ^ cz) >>> 0;
  for (let i = 1; i < 624; i++) {
    const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
    mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
  }
  // só o primeiro número: basta torcer as posições 0 e 1 e 397
  let y = (mt[0] & 0x80000000) | (mt[1] & 0x7fffffff);
  let first = mt[397] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
  first ^= first >>> 11;
  first ^= (first << 7) & 0x9d2c5680;
  first ^= (first << 15) & 0xefc60000;
  first ^= first >>> 18;
  v = (first >>> 0) % 10 === 0;
  if (slimeCache.size > 4096) slimeCache.clear();
  slimeCache.set(k, v);
  return v;
}

// ---------------------------------------------------------------- tentativa

const isNight = () => {
  const t = world.getTimeOfDay();
  return t >= 13000 && t <= 23000;
};

function solid(b) {
  return b && !b.isAir && !b.isLiquid;
}

function counts(dim, loc) {
  let hostile = 0, passive = 0, water = 0;
  for (const e of dim.getEntities({ location: loc, maxDistance: CAP_RADIUS })) {
    const t = e.typeId;
    if (ALL_WATER.has(t)) water++;
    else if (ALL_PASSIVE.has(t)) passive++;
    else if (e.matches({ families: ["monster"] })) hostile++;
  }
  return { hostile, passive, water };
}

function spawn(dim, id, loc, group = 1) {
  for (let i = 0; i < group; i++) {
    const p = { x: loc.x + 0.5 + (i ? Math.random() * 3 - 1.5 : 0), y: loc.y, z: loc.z + 0.5 + (i ? Math.random() * 3 - 1.5 : 0) };
    try {
      dim.spawnEntity(id, p);
    } catch {
      // posição inválida: ignora
    }
  }
}

function attempt(dim, isReady, player, cap) {
  const a = Math.random() * Math.PI * 2;
  const d = MIN_DIST + Math.random() * (MAX_DIST - MIN_DIST);
  const x = Math.floor(player.location.x + Math.cos(a) * d);
  const z = Math.floor(player.location.z + Math.sin(a) * d);
  if (!isReady(x, z)) return;

  const top = dim.getTopmostBlock({ x, z });
  if (!top) return;
  let biome = "";
  try {
    biome = overworld().getBiome({ x, y: top.y, z }).id;
  } catch {
    // chunk do overworld descarregado: sem bioma
  }

  // água: peixes e lulas
  if (top.isLiquid && top.typeId.includes("water")) {
    if (cap.water >= CAP_WATER) return;
    const list = byBiome(WATER_BY_BIOME, biome, null);
    if (!list) return;
    const id = pick(list);
    spawn(dim, id, { x, y: top.y - 1, z }, id.includes("fish") || id === "minecraft:cod" || id === "minecraft:salmon" ? 3 : 1);
    cap.water++;
    return;
  }

  // superfície ou caverna
  const underground = Math.random() < 0.5;
  let pos = { x, y: top.y + 1, z };
  if (underground) {
    const hr = dim.heightRange;
    const y0 = hr.min + 5 + Math.floor(Math.random() * Math.max(1, top.y - 8 - hr.min - 5));
    pos = null;
    for (let y = y0; y < y0 + 12 && y < top.y - 4; y++) {
      const b = dim.getBlock({ x, y, z });
      if (b?.isAir && dim.getBlock({ x, y: y + 1, z })?.isAir && solid(dim.getBlock({ x, y: y - 1, z }))) {
        pos = { x, y, z };
        break;
      }
    }
    if (!pos) return;
  } else if (!solid(top)) {
    return;
  }

  const light = dim.getLightLevel(pos);
  const sky = dim.getSkyLightLevel(pos);
  const dark = light === 0 || (sky > 0 && isNight() && light <= 7);

  // slimes: slime chunk abaixo do Y 40, ou pântano à noite
  const slimeHere =
    (pos.y < 40 && isSlimeChunk(Math.floor(x / 16), Math.floor(z / 16)) && Math.random() < 0.3) ||
    (biome.includes("swamp") && !underground && isNight() && light <= 7 && Math.random() < 0.3);
  if (slimeHere && cap.hostile < CAP_HOSTILE) {
    spawn(dim, "minecraft:slime", pos);
    cap.hostile++;
    return;
  }

  if (dark) {
    if (cap.hostile >= CAP_HOSTILE) return;
    let id = pick(HOSTILE);
    if (!underground && biome.includes("desert") && id === "minecraft:zombie") id = "minecraft:husk";
    if (!underground && /frozen|ice|snow/.test(biome) && id === "minecraft:skeleton") id = "minecraft:stray";
    spawn(dim, id, pos, id === "minecraft:enderman" || id === "minecraft:witch" ? 1 : 1 + Math.floor(Math.random() * 3));
    cap.hostile++;
    return;
  }

  // animais: de dia, na superfície, no chão do bioma
  if (underground || isNight() || cap.passive >= CAP_PASSIVE) return;
  if (!GROUND_FOR_ANIMALS.test(top.typeId) || light < 9) return;
  const id = pick(byBiome(PASSIVE_BY_BIOME, biome, PASSIVE_DEFAULT));
  spawn(dim, id, pos, 2 + Math.floor(Math.random() * 3));
  cap.passive++;
}

/** Liga o spawner. `isReady(x, z)` diz se aquele chunk da rick:01 já foi gerado. */
export function startSpawner(isReady) {
  system.runInterval(() => {
    let dim;
    try {
      dim = world.getDimension(DIMENSION_ID);
    } catch {
      return;
    }
    const players = dim.getPlayers();
    if (!players.length) return;
    try {
      if (world.gameRules.doMobSpawning === false) return;
    } catch {
      // sem gamerule: segue
    }
    for (const player of players) {
      try {
        const cap = counts(dim, player.location);
        for (let i = 0; i < ATTEMPTS; i++) attempt(dim, isReady, player, cap);
      } catch (e) {
        console.warn("[rick:01] spawner: " + e);
      }
    }
  }, INTERVAL);
}
