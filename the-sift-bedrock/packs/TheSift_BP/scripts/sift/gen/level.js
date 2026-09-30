/* =========================================================================
 * A "WorldGenLevel" das features: os 3 x 3 chunks em volta do chunk de
 * origem, como no Java (uma feature só escreve nesse quadrado).
 *
 * As features portadas do mod usam a mesma API do Java: getBlockState,
 * setBlock, getHeight, ensureCanWrite, getBiome... O que elas escrevem fica
 * registrado e depois é aplicado em cada um dos 9 chunks.
 * ========================================================================= */

import { AIR, blockId, blockOf } from "./palette.js";
import { BIOME_NAMES, HEIGHT } from "./chunkgen.js";

const W = 48;

// ---------------------------------------------------------------------------
// Blocos que as features consultam
// ---------------------------------------------------------------------------
const S = (n) => blockId("the_sift:" + n);
const M = (n, st) => blockId("minecraft:" + n, st);

export const B = {
  AIR,
  SIFTSLATE: S("siftslate"),
  GROWTH: S("siftslate_growth"),
  HEALTHY: S("healthy_sculk"),
  DRY: S("dry_healthy_sculk"),
  DRY_GROWTH: S("dry_healthy_sculk_growth"),
  REINFORCED: S("reinforced_siftslate"),
  ICHOR: S("ichor"),
  ICHOR_SNOW_BLOCK: S("ichor_snow_block"),
  SOUL: S("soul_block"),
  COAL: S("siftslate_coal_ore"),
  DIAMOND: S("siftslate_diamond_ore"),
  EMERALD: S("siftslate_emerald_ore"),
  CHAROITE: S("siftslate_charoite_ore"),
  SIFTITE: S("siftslate_siftite_ore"),
  FRONDS: S("overgrown_fronds"),
  STALKS: S("overgrown_stalks"),
  CHARD: S("overgrown_chard"),
  LOTUS: S("overgrown_lotus"),
  SUNBURST: S("sunburst_plant"),
  WHISPERBLOOM: S("whisperbloom"),
  SLATE_STALKS: S("siftslate_stalks"),
  SPROUTS: S("healthy_sculk_sprouts"),
  DRY_SPROUTS: S("dry_healthy_sculk_sprouts"),
  SLATE_ROOTS: S("siftslate_hanging_roots"),
  OVERGROWN_ROOTS: S("overgrown_hanging_roots"),
  FOLIAGE: blockId("the_sift:overgrown_willow_foliage", { "the_sift:persistent": true }),
  LOG_Y: blockId("the_sift:overgrown_willow_log", { "minecraft:block_face": "up" }),
  LOG_X: blockId("the_sift:overgrown_willow_log", { "minecraft:block_face": "east" }),
  LOG_Z: blockId("the_sift:overgrown_willow_log", { "minecraft:block_face": "south" }),
  BEDROCK: M("bedrock"),
  LAVA: M("lava"),
  SCULK: M("sculk"),
  SCULK_VEIN: M("sculk_vein", { multi_face_direction_bits: 1 }),
  SCULK_SENSOR: M("sculk_sensor"),
  SCULK_SHRIEKER: M("sculk_shrieker", { can_summon: true }),
  SCULK_CATALYST: M("sculk_catalyst"),
  TORCHFLOWER: M("torchflower"),
  SNIFFER_EGG: M("sniffer_egg"),
  CHEST: M("chest"),
};

/** Nome curto (sem namespace) do bloco de um índice. */
const nameCache = [];
export function nameOf(i) {
  let n = nameCache[i];
  if (n === undefined) {
    n = blockOf(i).id.replace("the_sift:", "").replace("minecraft:", "");
    nameCache[i] = n;
  }
  return n;
}
export const is = (i, ...names) => names.includes(nameOf(i));

export function isSiftTerrain(i) {
  return i === B.SIFTSLATE || i === B.GROWTH || i === B.HEALTHY || i === B.DRY || i === B.DRY_GROWTH;
}

const PLANTS = new Set(["overgrown_chard", "overgrown_stalks", "overgrown_fronds", "overgrown_lotus", "sunburst_plant",
  "whisperbloom", "siftslate_stalks", "healthy_sculk_sprouts", "dry_healthy_sculk_sprouts", "wildflowers", "torchflower",
  "pitcher_plant", "pitcher_crop", "sculk_vein", "overgrown_hanging_roots", "siftslate_hanging_roots",
  "overgrown_willow_vines", "overgrown_willow_sapling", "ichor_snow"]);

/** Planta ou cobertura que não bloqueia movimento (heightmap MOTION_BLOCKING). */
export const isPlantLike = (i) => PLANTS.has(nameOf(i));
export const isFluid = (i) => i === B.ICHOR || i === B.LAVA;
export const isFoliage = (i) => nameOf(i) === "overgrown_willow_foliage";
/** "solid" do Java (bloqueia movimento): sólido e não planta/fluido. */
export const isSolid = (i) => i !== AIR && !isPlantLike(i) && !isFluid(i);

/** Planta de chão sobrevive aqui? (canSurvive das plantas do mod) */
export function plantCanSurvive(level, x, y, z) {
  const b = level.getBlockState(x, y - 1, z);
  return isSiftTerrain(b);
}

// ---------------------------------------------------------------------------
// Hash das features do mod (a versão de 32 bits do hash01 de 64 bits)
// ---------------------------------------------------------------------------
function mix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}
export function fhash01(x, y, z, salt) {
  let h = mix32((salt | 0) ^ Math.imul(x | 0, 0x9e3779b1));
  h = mix32(h ^ Math.imul(y | 0, 0x85ebca77));
  h = mix32(h ^ Math.imul(z | 0, 0xc2b2ae3d));
  return h / 4294967296;
}
export const fmix = (v) => mix32(v | 0);
export const unit = (v) => mix32(v | 0) / 4294967296;

// ---------------------------------------------------------------------------
// A região
// ---------------------------------------------------------------------------
export class Level {
  /**
   * @param {number} seed
   * @param {number} ox  chunk de origem
   * @param {number} oz
   * @param {(cx:number, cz:number) => any} base  chunk base pronto
   */
  constructor(seed, ox, oz, base) {
    this.seed = seed;
    this.ox = ox;
    this.oz = oz;
    this.minX = (ox - 1) * 16;
    this.minZ = (oz - 1) * 16;
    this.blocks = new Uint8Array(W * W * HEIGHT);
    this.dirty = new Uint8Array(W * W * HEIGHT);
    this.written = [];
    this.height = new Int16Array(W * W);
    this.biomeCols = [];
    this.entities = [];
    this.chests = [];
    for (let dx = 0; dx < 3; dx++) {
      for (let dz = 0; dz < 3; dz++) {
        const c = base(ox - 1 + dx, oz - 1 + dz);
        this.biomeCols[dx * 3 + dz] = c.biomes;
        for (let lx = 0; lx < 16; lx++) {
          for (let lz = 0; lz < 16; lz++) {
            const src = ((lx << 4) | lz) * HEIGHT;
            const col = (dx * 16 + lx) * W + dz * 16 + lz;
            this.blocks.set(c.blocks.subarray(src, src + HEIGHT), col * HEIGHT);
            this.height[col] = c.height[(lx << 4) | lz];
          }
        }
      }
    }
  }

  getSeed() { return this.seed; }
  getMinY() { return 0; }
  getMaxY() { return HEIGHT - 1; }

  inside(x, z) {
    const rx = x - this.minX;
    const rz = z - this.minZ;
    return rx >= 0 && rx < W && rz >= 0 && rz < W;
  }

  ensureCanWrite(x, y, z) {
    return y >= 0 && y < HEIGHT && this.inside(x, z);
  }

  isOutsideBuildHeight(y) {
    return y < 0 || y >= HEIGHT;
  }

  getBlockState(x, y, z) {
    if (y < 0 || y >= HEIGHT || !this.inside(x, z)) return AIR;
    return this.blocks[((x - this.minX) * W + (z - this.minZ)) * HEIGHT + y];
  }

  isEmptyBlock(x, y, z) {
    return this.getBlockState(x, y, z) === AIR;
  }

  setBlock(x, y, z, b) {
    if (!this.ensureCanWrite(x, y, z)) return false;
    const col = (x - this.minX) * W + (z - this.minZ);
    const i = col * HEIGHT + y;
    this.blocks[i] = b;
    if (!this.dirty[i]) {
      this.dirty[i] = 1;
      this.written.push(i);
    }
    const h = this.height[col];
    if (b !== AIR) {
      if (y >= h) this.height[col] = y + 1;
    } else if (y === h - 1) {
      let t = y;
      const base = col * HEIGHT;
      while (t > 0 && this.blocks[base + t - 1] === AIR) t--;
      this.height[col] = t;
    }
    return true;
  }

  /** WORLD_SURFACE_WG (e OCEAN_FLOOR_WG: o Sift não tem água). */
  getHeight(x, z) {
    if (!this.inside(x, z)) return 0;
    return this.height[(x - this.minX) * W + (z - this.minZ)];
  }

  /** MOTION_BLOCKING(_NO_LEAVES): ignora plantas (e folhas, se pedido). */
  getMotionHeight(x, z, noLeaves) {
    let y = this.getHeight(x, z) - 1;
    while (y >= 0) {
      const b = this.getBlockState(x, y, z);
      if (b !== AIR && !isPlantLike(b) && !(noLeaves && isFoliage(b))) break;
      y--;
    }
    return y + 1;
  }

  /** Nome do bioma (sem namespace) na resolução de quarto. */
  getBiome(x, y, z) {
    if (!this.inside(x, z)) x = Math.min(Math.max(x, this.minX), this.minX + W - 1), z = Math.min(Math.max(z, this.minZ), this.minZ + W - 1);
    const rx = x - this.minX;
    const rz = z - this.minZ;
    const arr = this.biomeCols[((rx >> 4) * 3) + (rz >> 4)];
    const q = (((rx & 15) >> 2) * 4 + ((rz & 15) >> 2)) * 64 + (Math.max(0, Math.min(HEIGHT - 1, y)) >> 2);
    return BIOME_NAMES[arr[q]];
  }

  isOvergrownBiome(x, y, z) {
    const b = this.getBiome(x, y, z);
    return b === "overgrown_clearing" || b === "overgrown_forest" || b === "overgrown_forest_slopes" ||
      b === "overgrown_slopes" || b === "overgrown_peaks";
  }

  spawnLater(id, x, y, z, extra) {
    this.entities.push({ id, x, y, z, ...extra });
  }

  /**
   * Resultado: por chunk alvo (dx,dz em 0..2), índices dentro do chunk e
   * blocos finais; mais entidades e baús.
   */
  export() {
    const out = [];
    for (let k = 0; k < 9; k++) out.push({ idx: [], blocks: [] });
    for (const i of this.written) {
      const col = Math.floor(i / HEIGHT);
      const y = i - col * HEIGHT;
      const rx = Math.floor(col / W);
      const rz = col - rx * W;
      const t = out[(rx >> 4) * 3 + (rz >> 4)];
      t.idx.push((((rx & 15) << 4) | (rz & 15)) * HEIGHT + y);
      t.blocks.push(this.blocks[i]);
    }
    return {
      targets: out.map((t) => ({ idx: Int32Array.from(t.idx), blocks: Uint8Array.from(t.blocks) })),
      entities: this.entities,
      chests: this.chests,
    };
  }
}
