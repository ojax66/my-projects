/* =========================================================================
 * Gerador de chunk do Sift: a etapa "noise + surface + carvers" do Java.
 *
 *   1. densidade: final_density do mod, avaliada nos cantos das células
 *      (4 x 8 x 4 blocos) e interpolada, igual ao NoiseChunk do Java.
 *      Densidade > 0 é siftslate; o resto é ar (o fluido padrão do Sift é ar).
 *   2. biomas: multi-noise com os mesmos parâmetros da dimensão do mod,
 *      amostrados em quartos (4 x 4 x 4) como no Java.
 *   3. superfície: material_rule do mod (surface.js).
 *   4. carvers: cavernas e cânions (carvers.js).
 *
 * Tudo é determinístico a partir da semente. As funções *Job são geradores:
 * dão yield no meio do trabalho para rodar em system.runJob sem travar o
 * tick. Fora do jogo (testes), runSync() as roda de uma vez.
 * ========================================================================= */

import { BIOMES, CARVERS, DENSITY, MATERIAL_RULE, NOISES, ROUTER } from "./data.js";
import { makeNoises } from "./noise.js";
import { makeCompiler } from "./density.js";
import { compileSurfaceRule } from "./surface.js";
import { makeCarvers } from "./carvers.js";
import { AIR, blockId } from "./palette.js";
import { hash01 } from "./rng.js";

export const MIN_Y = 0;
export const HEIGHT = 256;
const CELL_W = 4;
const CELL_H = 8;
const CY = HEIGHT / CELL_H + 1; // 33 cantos na vertical

export const SLATE = blockId("the_sift:siftslate");
export const BEDROCK = blockId("minecraft:bedrock");

export const BIOME_NAMES = Object.keys(BIOMES).sort();
const BIOME_PARAMS = BIOME_NAMES.map((n) => BIOMES[n].params);

/** Índice na coluna de um chunk: (lx*16 + lz)*256 + y. */
export const idx = (lx, lz, y) => ((lx << 4) | lz) * HEIGHT + y;

/** Roda um gerador até o fim (fora do jogo). */
export function runSync(gen) {
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}

function paramDist(v, range) {
  if (v < range[0]) return range[0] - v;
  if (v > range[1]) return v - range[1];
  return 0;
}

export class SiftChunkGen {
  constructor(seed) {
    this.seed = seed | 0;
    const noises = makeNoises(this.seed, NOISES);
    this.noises = noises;
    const c = makeCompiler(DENSITY, noises);
    this.finalDensity = c.compile(ROUTER.final_density).f;
    this.continents = c.compile(ROUTER.continents).f;
    this.erosion = c.compile(ROUTER.erosion).f;
    this.weirdness = c.compile(ROUTER.ridges).f;
    this.humidity = c.compile(ROUTER.vegetation).f;
    this.depth = c.compile(ROUTER.depth).f;
    this.surface = compileSurfaceRule(MATERIAL_RULE);
    this.surfaceNoise = noises.surface;
    this.secondaryNoise = noises.surface_secondary;
    // todos os biomas têm os mesmos carvers
    this.carvers = makeCarvers(this.seed, CARVERS, BIOMES[BIOME_NAMES[0]].carvers);
    const uncarvable = ["the_sift:dry_healthy_sculk", "the_sift:dry_healthy_sculk_growth", "minecraft:bedrock"].map((b) => blockId(b));
    this.canCarve = (b) => !uncarvable.includes(b);
  }

  // -------------------------------------------------------------------------
  // Biomas
  // -------------------------------------------------------------------------
  /** Clima 2D (tudo menos a profundidade) numa posição de bloco. */
  climate(x, z) {
    return [this.continents(x, 0, z), this.erosion(x, 0, z), this.weirdness(x, 0, z), this.humidity(x, 0, z)];
  }

  /** Índice do bioma para um clima e um y (profundidade vem do y). */
  pickBiome(cl, y) {
    const depth = this.depth(0, y, 0);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < BIOME_PARAMS.length; i++) {
      const p = BIOME_PARAMS[i];
      const a = paramDist(cl[0], p.continentalness);
      const b = paramDist(cl[1], p.erosion);
      const w = paramDist(cl[2], p.weirdness);
      const h = paramDist(cl[3], p.humidity);
      const d = paramDist(depth, p.depth);
      const off = p.offset || 0;
      const dist = a * a + b * b + w * w + h * h + d * d + off * off;
      if (dist < bestD) {
        bestD = dist;
        best = i;
      }
    }
    return best;
  }

  /** Nome do bioma numa posição de bloco (resolução de quarto, como o Java). */
  biomeAt(x, y, z) {
    const qx = x & ~3;
    const qz = z & ~3;
    return BIOME_NAMES[this.pickBiome(this.climate(qx, qz), Math.max(0, Math.min(HEIGHT - 1, y)) & ~3)];
  }

  // -------------------------------------------------------------------------
  // Altura aproximada de uma coluna (sem carvers nem features)
  // -------------------------------------------------------------------------
  /** y do primeiro bloco de ar acima do chão natural. */
  surfaceY(x, z) {
    const cx0 = Math.floor(x / CELL_W) * CELL_W;
    const cz0 = Math.floor(z / CELL_W) * CELL_W;
    const tx = (x - cx0) / CELL_W;
    const tz = (z - cz0) / CELL_W;
    const col = new Float64Array(CY);
    for (let k = 0; k < 4; k++) {
      const px = cx0 + (k & 1) * CELL_W;
      const pz = cz0 + (k >> 1) * CELL_W;
      const wgt = ((k & 1) ? tx : 1 - tx) * ((k >> 1) ? tz : 1 - tz);
      for (let j = 0; j < CY; j++) col[j] += wgt * this.finalDensity(px, j * CELL_H, pz);
    }
    for (let y = HEIGHT - 1; y >= 0; y--) {
      const j = Math.floor(y / CELL_H);
      const t = (y - j * CELL_H) / CELL_H;
      if (col[j] + t * (col[j + 1] - col[j]) > 0) return y + 1;
    }
    return 0;
  }

  // -------------------------------------------------------------------------
  // Chunk base
  // -------------------------------------------------------------------------
  /**
   * Chunk "proto": blocos depois do relevo, superfície e carvers.
   * { cx, cz, blocks: Uint8Array(65536), biomes: Uint8Array(16*64), height: Uint16Array(256) }
   *   biomes[(qx*4+qz)*64 + qy]; height[lx*16+lz] = y do ar acima do topo.
   */
  *baseJob(cx, cz) {
    const x0 = cx * 16;
    const z0 = cz * 16;
    const fd = this.finalDensity;

    // 1. densidade nos cantos das células
    const N = 16 / CELL_W + 1; // 5
    const corners = new Float64Array(N * N * CY);
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < N; k++) {
        const o = (i * N + k) * CY;
        for (let j = 0; j < CY; j++) corners[o + j] = fd(x0 + i * CELL_W, j * CELL_H, z0 + k * CELL_W);
        yield;
      }
    }

    // 2. interpolação e preenchimento
    const blocks = new Uint8Array(16 * 16 * HEIGHT);
    const col = new Float64Array(CY);
    for (let lx = 0; lx < 16; lx++) {
      const i = lx >> 2;
      const tx = (lx & 3) / CELL_W;
      for (let lz = 0; lz < 16; lz++) {
        const k = lz >> 2;
        const tz = (lz & 3) / CELL_W;
        const o00 = (i * N + k) * CY;
        const o10 = ((i + 1) * N + k) * CY;
        const o01 = (i * N + k + 1) * CY;
        const o11 = ((i + 1) * N + k + 1) * CY;
        for (let j = 0; j < CY; j++) {
          const a = corners[o00 + j] + tx * (corners[o10 + j] - corners[o00 + j]);
          const b = corners[o01 + j] + tx * (corners[o11 + j] - corners[o01 + j]);
          col[j] = a + tz * (b - a);
        }
        const base = ((lx << 4) | lz) * HEIGHT;
        for (let y = 0; y < HEIGHT; y++) {
          const j = y >> 3;
          const t = (y & 7) / CELL_H;
          if (col[j] + t * (col[j + 1] - col[j]) > 0) blocks[base + y] = SLATE;
        }
      }
    }
    yield;

    // 3. biomas por quarto
    const biomes = new Uint8Array(16 * 64);
    for (let qx = 0; qx < 4; qx++) {
      for (let qz = 0; qz < 4; qz++) {
        const cl = this.climate(x0 + qx * 4, z0 + qz * 4);
        const o = (qx * 4 + qz) * 64;
        let last = -1;
        let lastBiome = 0;
        for (let qy = 0; qy < 64; qy++) {
          // a profundidade só muda o bioma embaixo dos picos: reaproveita
          const b = cl[0] < 0.8 && last >= 0 ? lastBiome : this.pickBiome(cl, qy * 4);
          biomes[o + qy] = b;
          last = qy;
          lastBiome = b;
        }
      }
    }
    yield;

    // 4. superfície
    this.applySurface(x0, z0, blocks, biomes);
    yield;

    // 5. carvers
    this.carvers.carve(cx, cz, blocks, this.canCarve);
    yield;

    // 6. mapa de altura (WORLD_SURFACE_WG)
    const height = new Uint16Array(256);
    for (let c = 0; c < 256; c++) {
      const base = c * HEIGHT;
      let y = HEIGHT - 1;
      while (y >= 0 && blocks[base + y] === AIR) y--;
      height[c] = y + 1;
    }
    return { cx, cz, blocks, biomes, height };
  }

  applySurface(x0, z0, blocks, biomes) {
    const rule = this.surface.fn;
    const limit = this.surface.maxDepth;
    const self = this;
    const ctx = {
      x: 0, y: 0, z: 0, above: 0, below: 0, surfaceDepth: 0,
      _sec: NaN, _noise: null, _biomeCol: 0,
      secondary() {
        if (Number.isNaN(this._sec)) this._sec = self.secondaryNoise.getValue(this.x, 0, this.z);
        return this._sec;
      },
      noise(name) {
        let v = this._noise[name];
        if (v === undefined) {
          v = self.noises[name].getValue(this.x, 0, this.z);
          this._noise[name] = v;
        }
        return v;
      },
      biome() {
        return BIOME_NAMES[biomes[this._biomeCol + (this.y >> 2)]];
      },
    };
    const SALT = 0x5f3759df;
    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        const x = x0 + lx;
        const z = z0 + lz;
        const base = ((lx << 4) | lz) * HEIGHT;
        let top = HEIGHT - 1;
        while (top >= 0 && blocks[base + top] === AIR) top--;
        if (top < 0) continue;
        ctx.x = x;
        ctx.z = z;
        ctx._sec = NaN;
        ctx._noise = {};
        ctx._biomeCol = ((lx >> 2) * 4 + (lz >> 2)) * 64;
        ctx.surfaceDepth = Math.trunc(this.surfaceNoise.getValue(x, 0, z) * 2.75 + 3 + hash01(x, 0, z, SALT) * 0.25);
        let above = 0;
        let ceil = Infinity; // y do bloco sólido mais baixo do trecho atual
        for (let y = top; y >= 0; y--) {
          const b = blocks[base + y];
          if (b === AIR) {
            above = 0;
            continue;
          }
          if (ceil >= y) {
            ceil = 0;
            for (let s = y - 1; s >= 0; s--) {
              if (blocks[base + s] === AIR) {
                ceil = s + 1;
                break;
              }
            }
          }
          above++;
          if (b !== SLATE) continue;
          if (above > limit && y > 5) continue; // fundo: nenhuma regra muda o bloco
          ctx.y = y;
          ctx.above = above;
          ctx.below = y - ceil + 1;
          const r = rule(ctx);
          if (r >= 0) blocks[base + y] = r;
        }
      }
    }
  }
}
