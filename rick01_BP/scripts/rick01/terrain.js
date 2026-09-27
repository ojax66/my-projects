import { BlockPermutation, BlockVolume } from "@minecraft/server";
import { fbm, hash2, hash3, smooth } from "../world_generator_API.js";
import { BUILD_BOX } from "./tiles.js";

// Terreno estilo overworld para rick:01: continentes/oceanos, rios, colinas,
// montanhas, biomas (planície, floresta, taiga, neve, deserto, savana),
// cavernas, minérios, árvores e vegetação. Em volta da construção o terreno
// sobe suavemente até o chão dela (Y 106), formando um platô natural.

export const SEA_LEVEL = 62;
const BLEND = 72; // largura da transição até o chão da construção
const GROUND = BUILD_BOX.ground;

const permCache = new Map();
function perm(id, states) {
  const key = states ? id + JSON.stringify(states) : id;
  let p = permCache.get(key);
  if (!p) {
    p = BlockPermutation.resolve(id, states);
    permCache.set(key, p);
  }
  return p;
}

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const lerp = (a, b, t) => a + (b - a) * t;
const band = (lo, hi, v) => smooth(clamp01((v - lo) / (hi - lo)));

function distToBuild(x, z) {
  const dx = Math.max(BUILD_BOX.min.x - x, 0, x - BUILD_BOX.max.x);
  const dz = Math.max(BUILD_BOX.min.z - z, 0, z - BUILD_BOX.max.z);
  return Math.sqrt(dx * dx + dz * dz);
}

export function insideBuild(x, z) {
  return x >= BUILD_BOX.min.x && x <= BUILD_BOX.max.x && z >= BUILD_BOX.min.z && z <= BUILD_BOX.max.z;
}

// ---------------------------------------------------------------- amostragem

export function sample(x, z) {
  const cont = fbm(x + 10000, z + 10000, 4, 0.5, 1 / 700);
  const hills = fbm(x - 3000, z + 5000, 4, 0.5, 1 / 110);
  const mnt = fbm(x + 20000, z - 8000, 4, 0.5, 1 / 360);
  const temp = fbm(x - 15000, z - 15000, 3, 0.5, 1 / 900);
  const hum = fbm(x + 30000, z - 2000, 3, 0.5, 1 / 750);
  const riv = Math.abs(fbm(x - 7000, z + 9000, 3, 0.5, 1 / 480) - 0.5);

  // continente -> altura base (contínua, para a costa ficar suave)
  const coast = 0.44;
  let h = cont >= coast
    ? SEA_LEVEL + 1 + (cont - coast) * 90
    : Math.max(SEA_LEVEL + 1 - (coast - cont) * 170, 28);
  const land = clamp01((cont - coast) * 10);
  const mountain = band(0.56, 0.7, mnt);
  h += land * ((hills - 0.5) * 26 + mountain * (40 + hills * 75));

  // rios cortam a terra até abaixo do nível do mar
  let river = false;
  if (land > 0 && riv < 0.03 && h < 125) {
    const t = smooth(riv / 0.03);
    const carved = lerp(SEA_LEVEL - 3, h, t);
    if (carved < h) {
      h = carved;
      river = riv < 0.018;
    }
  }

  // platô em volta da construção
  const d = distToBuild(x, z);
  const blend = smooth(clamp01(d / BLEND));
  h = lerp(GROUND, h, blend);
  h = Math.floor(h);

  let biome;
  if (h < SEA_LEVEL - 1) biome = temp < 0.33 ? "frozen_ocean" : "ocean";
  else if (river && h < SEA_LEVEL) biome = "river";
  else if (h <= SEA_LEVEL + 2 && cont < coast + 0.02 && blend > 0.5) biome = temp < 0.33 ? "stony_shore" : "beach";
  else if (h > 128) biome = "peaks";
  else if (temp < 0.33) biome = "snowy";
  else if (temp > 0.62 && hum < 0.47) biome = "desert";
  else if (temp > 0.57 && hum < 0.55) biome = "savanna";
  else if (temp < 0.4) biome = "taiga";
  else if (hum > 0.55) biome = hum > 0.6 && temp > 0.5 ? "birch_forest" : "forest";
  else biome = "plains";

  return { h, biome, d, temp };
}

export function getHeight(x, z) {
  return insideBuild(x, z) ? GROUND : sample(x, z).h;
}

// ---------------------------------------------------------------- blocos

const B = {
  air: () => perm("minecraft:air"),
  bedrock: () => perm("minecraft:bedrock"),
  stone: () => perm("minecraft:stone"),
  deepslate: () => perm("minecraft:deepslate"),
  dirt: () => perm("minecraft:dirt"),
  grass: () => perm("minecraft:grass_block"),
  sand: () => perm("minecraft:sand"),
  sandstone: () => perm("minecraft:sandstone"),
  gravel: () => perm("minecraft:gravel"),
  water: () => perm("minecraft:water"),
  ice: () => perm("minecraft:ice"),
  snowBlock: () => perm("minecraft:snow"),
  snowLayer: () => perm("minecraft:snow_layer"),
  lava: () => perm("minecraft:lava"),
};

// [bloco, versão deepslate, y mínimo, y máximo, chance por coluna, tamanho máx do veio]
const ORES = [
  ["minecraft:coal_ore", "minecraft:deepslate_coal_ore", 0, 190, 0.09, 4],
  ["minecraft:iron_ore", "minecraft:deepslate_iron_ore", -60, 110, 0.07, 3],
  ["minecraft:copper_ore", "minecraft:deepslate_copper_ore", -16, 96, 0.05, 4],
  ["minecraft:gold_ore", "minecraft:deepslate_gold_ore", -64, 32, 0.02, 3],
  ["minecraft:redstone_ore", "minecraft:deepslate_redstone_ore", -64, 16, 0.025, 4],
  ["minecraft:lapis_ore", "minecraft:deepslate_lapis_ore", -64, 64, 0.012, 3],
  ["minecraft:diamond_ore", "minecraft:deepslate_diamond_ore", -64, 16, 0.01, 2],
  ["minecraft:emerald_ore", "minecraft:emerald_ore", 60, 240, 0.004, 1],
  ["minecraft:granite", "minecraft:granite", 0, 120, 0.02, 5],
  ["minecraft:diorite", "minecraft:diorite", 0, 120, 0.02, 5],
  ["minecraft:andesite", "minecraft:andesite", 0, 120, 0.02, 5],
  ["minecraft:tuff", "minecraft:tuff", -64, 0, 0.02, 5],
  ["minecraft:gravel", "minecraft:gravel", -64, 90, 0.01, 4],
];

const FLOWERS = ["minecraft:dandelion", "minecraft:poppy", "minecraft:azure_bluet", "minecraft:oxeye_daisy", "minecraft:cornflower"];

function column(dim, x, z, y0, y1, p) {
  if (y1 < y0) return;
  dim.fillBlocks(new BlockVolume({ x, y: y0, z }, { x, y: y1, z }), p);
}

function setBlock(dim, x, y, z, p, onlyIfAir) {
  const b = dim.getBlock({ x, y, z });
  if (!b) return;
  if (onlyIfAir && !b.isAir) return;
  b.setPermutation(p);
}

// ---------------------------------------------------------------- árvores

// Árvores ficam pendentes até a última coluna do chunk, para nenhuma coluna
// gerada depois sobrescrever as folhas.
const pendingTrees = new Map();
const chunkKey = (x, z) => Math.floor(x / 16) + "," + Math.floor(z / 16);

function leafBlob(dim, x, y, z, r, leaves, seed) {
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      if (Math.abs(dx) === r && Math.abs(dz) === r && hash3(x + dx, y + seed, z + dz) < 0.6) continue;
      setBlock(dim, x + dx, y, z + dz, leaves, true);
    }
  }
}

function placeTree(dim, t) {
  const { x, y, z, kind } = t;
  const r = hash3(x, y, z);
  const leavesOf = (id) => perm(id, { persistent_bit: true });

  if (kind === "spruce") {
    const hgt = 7 + Math.floor(r * 4);
    const leaves = leavesOf("minecraft:spruce_leaves");
    column(dim, x, z, y, y + hgt - 1, perm("minecraft:spruce_log"));
    let rad = 0;
    for (let yy = y + hgt; yy >= y + 3; yy--) {
      if (rad === 0) setBlock(dim, x, yy, z, leaves, true);
      else leafBlob(dim, x, yy, z, rad, leaves, 7);
      rad = rad >= 2 || (yy - y) % 3 === 0 ? 1 : rad + 1;
    }
    return;
  }

  if (kind === "acacia") {
    const hgt = 4 + Math.floor(r * 2);
    const log = perm("minecraft:acacia_log");
    column(dim, x, z, y, y + hgt - 2, log);
    const ox = r < 0.5 ? 1 : -1;
    setBlock(dim, x + ox, y + hgt - 1, z, log);
    const leaves = leavesOf("minecraft:acacia_leaves");
    leafBlob(dim, x + ox, y + hgt, z, 2, leaves, 3);
    leafBlob(dim, x + ox, y + hgt + 1, z, 1, leaves, 5);
    return;
  }

  const birch = kind === "birch";
  const hgt = (birch ? 5 : 4) + Math.floor(r * 3);
  const leaves = leavesOf(birch ? "minecraft:birch_leaves" : "minecraft:oak_leaves");
  column(dim, x, z, y, y + hgt - 1, perm(birch ? "minecraft:birch_log" : "minecraft:oak_log"));
  const top = y + hgt;
  leafBlob(dim, x, top - 3, z, 2, leaves, 1);
  leafBlob(dim, x, top - 2, z, 2, leaves, 2);
  leafBlob(dim, x, top - 1, z, 1, leaves, 3);
  setBlock(dim, x, top, z, leaves, true);
  setBlock(dim, x + 1, top, z, leaves, true);
  setBlock(dim, x - 1, top, z, leaves, true);
  setBlock(dim, x, top, z + 1, leaves, true);
  setBlock(dim, x, top, z - 1, leaves, true);
}

function flushTrees(dim, key) {
  const list = pendingTrees.get(key);
  if (!list) return;
  pendingTrees.delete(key);
  for (const t of list) placeTree(dim, t);
}

const TREE_CHANCE = { forest: 0.035, birch_forest: 0.035, taiga: 0.025, snowy: 0.012, plains: 0.002, savanna: 0.004 };
const TREE_KIND = { forest: "oak", birch_forest: "birch", taiga: "spruce", snowy: "spruce", plains: "oak", savanna: "acacia" };

// ---------------------------------------------------------------- coluna

let heightRange = null;

export function generateColumn(dim, x, z) {
  if (!heightRange) heightRange = { min: dim.heightRange.min, max: dim.heightRange.max };
  const bottom = heightRange.min;
  const lx = ((x % 16) + 16) % 16;
  const lz = ((z % 16) + 16) % 16;
  const ck = chunkKey(x, z);

  try {
    if (insideBuild(x, z)) {
      // debaixo da construção: só o subsolo, a construção é colocada por estrutura
      const top = BUILD_BOX.min.y - 1;
      fillUnderground(dim, x, z, bottom, top - 3, top);
      column(dim, x, z, top - 2, top, B.dirt());
      return GROUND;
    }

    const s = sample(x, z);
    const h = s.h;
    const biome = s.biome;

    let topBlock = B.grass(), filler = B.dirt(), fillerDepth = 3;
    if (biome === "desert" || biome === "beach") { topBlock = B.sand(); filler = biome === "desert" ? B.sandstone() : B.sand(); fillerDepth = 4; }
    else if (biome === "ocean" || biome === "frozen_ocean" || biome === "river") { topBlock = h > SEA_LEVEL - 8 ? B.sand() : B.gravel(); filler = topBlock; }
    else if (biome === "stony_shore") { topBlock = B.gravel(); filler = B.stone(); }
    else if (biome === "peaks") {
      topBlock = h > 150 + hash2(x, z) * 8 ? B.snowBlock() : B.stone();
      filler = B.stone();
    }

    fillUnderground(dim, x, z, bottom, h - fillerDepth - 1, h);
    column(dim, x, z, h - fillerDepth, h - 1, filler);
    column(dim, x, z, h, h, topBlock);

    if (h < SEA_LEVEL) {
      const frozen = biome === "frozen_ocean" || (biome === "river" && s.temp < 0.33);
      column(dim, x, z, h + 1, frozen ? SEA_LEVEL - 1 : SEA_LEVEL, B.water());
      if (frozen) column(dim, x, z, SEA_LEVEL, SEA_LEVEL, B.ice());
      return h;
    }

    // vegetação
    const r = hash2(x, z);
    const snowy = biome === "snowy" || (biome === "peaks" && h > 140);
    if (s.d > 6) {
      const tc = TREE_CHANCE[biome] ?? 0;
      if (tc && r < tc && lx >= 2 && lx <= 13 && lz >= 2 && lz <= 13) {
        if (!pendingTrees.has(ck)) pendingTrees.set(ck, []);
        const kind = biome === "forest" && hash3(x, 1, z) < 0.25 ? "birch" : TREE_KIND[biome];
        pendingTrees.get(ck).push({ x, y: h + 1, z, kind });
      } else if (biome === "desert") {
        if (r > 0.994) column(dim, x, z, h + 1, h + 1 + Math.floor(hash3(x, 2, z) * 3), perm("minecraft:cactus"));
        else if (r > 0.985) setBlock(dim, x, h + 1, z, perm("minecraft:deadbush"));
      } else if (snowy) {
        setBlock(dim, x, h + 1, z, B.snowLayer());
      } else if (biome !== "beach" && biome !== "stony_shore" && biome !== "peaks") {
        const grassChance = biome === "savanna" ? 0.3 : biome === "plains" ? 0.22 : 0.12;
        if (r > 1 - grassChance) setBlock(dim, x, h + 1, z, perm(biome === "taiga" && r > 0.95 ? "minecraft:fern" : "minecraft:short_grass"));
        else if ((biome === "plains" || biome === "forest" || biome === "birch_forest") && r < 0.03 + (biome === "plains" ? 0.02 : 0)) {
          setBlock(dim, x, h + 1, z, perm(FLOWERS[Math.floor(hash3(x, 3, z) * FLOWERS.length)]));
        }
      }
    } else if (snowy) {
      setBlock(dim, x, h + 1, z, B.snowLayer());
    }

    return h;
  } finally {
    if (lx === 15 && lz === 15) flushTrees(dim, ck);
  }
}

// pedra/deepslate + minérios + cavernas, de bottom+1 até stoneTop (h = superfície)
function fillUnderground(dim, x, z, bottom, stoneTop, h) {
  const deepTop = Math.min(-1, stoneTop);
  column(dim, x, z, bottom + 1, deepTop, B.deepslate());
  column(dim, x, z, Math.max(bottom + 1, 0), stoneTop, B.stone());

  for (let i = 0; i < ORES.length; i++) {
    const [id, deepId, minY, maxY, chance, size] = ORES[i];
    if (hash3(x, i * 131 + 7, z) >= chance) continue;
    const lo = Math.max(minY, bottom + 5);
    const hi = Math.min(maxY, stoneTop - 1);
    if (hi <= lo) continue;
    const y = lo + Math.floor(hash3(x, i * 17 + 3, z) * (hi - lo));
    const len = 1 + Math.floor(hash3(x, i * 29 + 5, z) * size);
    const top = Math.min(y + len - 1, stoneTop - 1);
    column(dim, x, z, y, Math.min(top, -1), perm(deepId));
    column(dim, x, z, Math.max(y, 0), top, perm(id));
  }

  // túneis de caverna: duas camadas de "minhocas" feitas de ruído
  for (let k = 0; k < 3; k++) {
    const n = fbm(x + k * 977, z - k * 1231, 3, 0.5, 1 / 70);
    if (Math.abs(n - 0.5) > 0.018) continue;
    const cy = Math.floor(-44 + k * 40 + fbm(x - k * 311, z + k * 713, 2, 0.5, 1 / 90) * 30);
    const tall = 3 + Math.floor(hash3(x, k, z) * 2);
    if (cy <= bottom + 5 || cy + tall >= h - 8) continue;
    column(dim, x, z, cy, cy + tall - 1, B.air());
    if (cy < -54) column(dim, x, z, cy, cy, B.lava());
  }

  // fundo de bedrock irregular como no overworld
  column(dim, x, z, bottom, bottom, B.bedrock());
  for (let i = 1; i <= 3; i++) if (hash3(x, bottom + i, z) < 0.8 - i * 0.2) column(dim, x, z, bottom + i, bottom + i, B.bedrock());
}
