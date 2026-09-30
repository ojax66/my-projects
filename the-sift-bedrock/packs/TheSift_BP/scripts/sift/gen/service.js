/* =========================================================================
 * Serviço de chunks: calcula em segundo plano (system.runJob) o chunk final
 * do Sift e guarda o resultado pronto para ser escrito.
 *
 *   chunk final (C)  <- decoração dos 3 x 3 chunks de origem em volta de C
 *   decoração (O)    <- chunks base dos 3 x 3 em volta de O
 *   chunk base       <- relevo + biomas + superfície + carvers (chunkgen.js)
 *
 * Nada aqui toca no mundo: o worldgen.js pede chunks (request) e escreve os
 * que ficaram prontos (take). Assim o mesmo código roda nos testes em Node.
 * ========================================================================= */

import { SiftChunkGen, HEIGHT } from "./chunkgen.js";
import { decorateJob, checkFeatures } from "./features.js";
import { reservePortal } from "./sift_features.js";
import { AIR, blockId } from "./palette.js";
import { isPlantLike, isSiftTerrain, B } from "./level.js";

const key = (cx, cz) => cx + "," + cz;

class Lru {
  constructor(max) {
    this.max = max;
    this.map = new Map();
  }
  get(k) {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k, v) {
    this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
  has(k) {
    return this.map.has(k);
  }
  get size() {
    return this.map.size;
  }
}

const ZONE_MARGIN = 14;
const smooth = (t) => t * t * (3 - 2 * t);

export class ChunkService {
  constructor(seed, opts = {}) {
    this.seed = seed | 0;
    this.gen = new SiftChunkGen(this.seed);
    this.bases = new Lru(opts.maxBases ?? 220);
    this.decors = new Lru(opts.maxDecors ?? 900);
    this.finals = new Lru(opts.maxFinals ?? 400);
    this.want = new Map(); // chave -> prioridade (menor = antes)
    this.zone = null;
    this.onError = opts.onError ?? (() => { });
    this.stats = { bases: 0, decors: 0, finals: 0, ms: 0, erros: 0 };
    this.missing = checkFeatures();
  }

  // -------------------------------------------------------------------------
  // Zona do portal principal: terreno aplainado e protegido das features
  // -------------------------------------------------------------------------
  /** origin = canto da estrutura 9 x 40, ground = y da camada 0 dela. */
  setZone(origin, ground) {
    this.zone = origin ? { x0: origin.x, x1: origin.x + 8, z0: origin.z, z1: origin.z + 39, ground } : null;
    if (origin) reservePortal(origin.x, origin.z, 9, 40);
    else reservePortal();
  }

  zoneDistance(x, z) {
    const Z = this.zone;
    if (!Z) return Infinity;
    const dx = Math.max(Z.x0 - x, 0, x - Z.x1);
    const dz = Math.max(Z.z0 - z, 0, z - Z.z1);
    return Math.sqrt(dx * dx + dz * dz);
  }

  applyZone(cx, cz, blocks) {
    if (!this.zone) return;
    const g = this.zone.ground;
    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        const d = this.zoneDistance(cx * 16 + lx, cz * 16 + lz);
        if (d > ZONE_MARGIN) continue;
        const base = ((lx << 4) | lz) * HEIGHT;
        let top = HEIGHT - 1;
        while (top > 0 && (blocks[base + top] === AIR || isPlantLike(blocks[base + top]))) top--;
        const surface = isSiftTerrain(blocks[base + top]) ? blocks[base + top] : B.SIFTSLATE;
        const target = d === 0 ? g - 1 : Math.round(g - 1 + (top - g + 1) * smooth(d / ZONE_MARGIN));
        for (let y = Math.min(top, target); y < target; y++) if (blocks[base + y] === AIR || y > top) blocks[base + y] = B.SIFTSLATE;
        for (let y = target + 1; y < HEIGHT; y++) blocks[base + y] = AIR;
        blocks[base + target] = d < 2 ? B.SIFTSLATE : surface;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Pedidos
  // -------------------------------------------------------------------------
  request(cx, cz, priority) {
    const k = key(cx, cz);
    if (this.finals.has(k)) return;
    const p = this.want.get(k);
    if (p === undefined || priority < p) this.want.set(k, priority);
  }

  /** Esquece pedidos que ninguém mais quer (fora de todos os raios). */
  prune(keep) {
    for (const k of this.want.keys()) if (!keep(k)) this.want.delete(k);
  }

  /** Chunk final pronto, ou undefined. */
  peek(cx, cz) {
    return this.finals.get(key(cx, cz));
  }

  /** Solta o chunk final da memória depois de escrito. */
  release(cx, cz) {
    this.finals.map.delete(key(cx, cz));
  }

  /** y do bloco do topo (sem plantas), pelo chunk pronto ou pelo relevo. */
  topAt(x, z) {
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const f = this.finals.get(key(cx, cz));
    if (f) return f.top[((x - cx * 16) << 4) | (z - cz * 16)];
    const b = this.bases.get(key(cx, cz));
    let h;
    if (b) h = b.height[((x - cx * 16) << 4) | (z - cz * 16)] - 1;
    else h = this.gen.surfaceY(x, z) - 1;
    const d = this.zoneDistance(x, z);
    if (d <= ZONE_MARGIN) {
      const g = this.zone.ground;
      h = d === 0 ? g - 1 : Math.round(g - 1 + (h - g + 1) * smooth(d / ZONE_MARGIN));
    }
    return h;
  }

  // -------------------------------------------------------------------------
  // O trabalho em segundo plano
  // -------------------------------------------------------------------------
  *baseOf(cx, cz) {
    const k = key(cx, cz);
    let c = this.bases.get(k);
    if (!c) {
      c = yield* this.gen.baseJob(cx, cz);
      this.bases.set(k, c);
      this.stats.bases++;
    }
    return c;
  }

  *decorOf(ox, oz) {
    const k = key(ox, oz);
    let d = this.decors.get(k);
    if (d) return d;
    const local = new Map();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) local.set(key(ox + dx, oz + dz), yield* this.baseOf(ox + dx, oz + dz));
    }
    d = yield* decorateJob(this.seed, ox, oz, (cx, cz) => local.get(key(cx, cz)), {
      onError: (name, e) => {
        this.stats.erros++;
        this.onError("feature " + name, e);
      },
    });
    this.decors.set(k, d);
    this.stats.decors++;
    return d;
  }

  /** plain: sem decoração (último recurso se uma feature quebrar). */
  *finalOf(cx, cz, plain = false) {
    const decs = [];
    if (!plain) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) decs.push([dx, dz, yield* this.decorOf(cx + dx, cz + dz)]);
    const base = yield* this.baseOf(cx, cz);
    const blocks = base.blocks.slice();
    const entities = [];
    const chests = [];
    const x0 = cx * 16;
    const z0 = cz * 16;
    const inside = (p) => p.x >= x0 && p.x < x0 + 16 && p.z >= z0 && p.z < z0 + 16;
    for (const [dx, dz, d] of decs) {
      const t = d.targets[(1 - dx) * 3 + (1 - dz)];
      for (let i = 0; i < t.idx.length; i++) blocks[t.idx[i]] = t.blocks[i];
      for (const e of d.entities) if (inside({ x: Math.floor(e.x), z: Math.floor(e.z) })) entities.push(e);
      for (const c of d.chests) if (inside({ x: c[0], z: c[2] })) chests.push(c);
    }
    this.applyZone(cx, cz, blocks);
    yield;
    // trechos por coluna: [y0, y1, bloco] de baixo pra cima, sem o ar
    const runs = [];
    const top = new Int16Array(256);
    for (let c = 0; c < 256; c++) {
      const base0 = c * HEIGHT;
      const list = [];
      let y = 0;
      let highest = -1;
      while (y < HEIGHT) {
        const b = blocks[base0 + y];
        if (b === AIR) {
          y++;
          continue;
        }
        let y1 = y;
        while (y1 + 1 < HEIGHT && blocks[base0 + y1 + 1] === b) y1++;
        list.push(y, y1, b);
        if (!isPlantLike(b)) highest = y1;
        y = y1 + 1;
      }
      runs.push(list);
      top[c] = highest;
    }
    return { cx, cz, runs, top, entities, chests, biomes: base.biomes };
  }

  /** Gerador infinito para system.runJob: calcula o pedido mais urgente. */
  *worker(now = () => Date.now()) {
    for (;;) {
      let best = null;
      let bp = Infinity;
      for (const [k, p] of this.want) {
        if (p < bp) {
          bp = p;
          best = k;
        }
      }
      if (best === null) {
        yield;
        continue;
      }
      const [cx, cz] = best.split(",").map(Number);
      const t0 = now();
      try {
        const f = yield* this.finalOf(cx, cz);
        this.finals.set(best, f);
        this.stats.finals++;
      } catch (e) {
        this.stats.erros++;
        this.onError("chunk " + best, e);
        try {
          this.finals.set(best, yield* this.finalOf(cx, cz, true));
        } catch (e2) {
          this.onError("chunk " + best + " (sem decoração)", e2);
        }
      }
      this.stats.ms += now() - t0;
      this.want.delete(best);
      yield;
    }
  }
}

export { blockId };
