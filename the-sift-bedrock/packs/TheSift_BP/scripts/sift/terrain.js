/* =========================================================================
 * O terreno do Sift.
 *
 * Mesmo esquema do planetTerrain.js do Galactic Horizons: o relevo é uma
 * função pura de (x, z) feita com os ruídos da world_generator_API, e cada
 * coluna vira trechos { y0, y1, id } que o gerador escreve.
 *
 * O que se copiou do mod Java foi o que se VÊ, com os mesmos números:
 *   - a altura base em torno de y 93, e por cima dela os deslocamentos do mod:
 *     platôs em 5 degraus, cânions em 3 degraus, penhascos gigantes,
 *     prateleiras em camadas, o vale raso dos caminhos de sculk e as
 *     cordilheiras; tudo interpolado numa grade de 4 blocos, que é o que dá
 *     as encostas íngremes de 4 blocos de largura entre os degraus;
 *   - a aspereza 3D das escarpas e penhascos;
 *   - os biomas nas mesmas faixas de clima;
 *   - a superfície: caminhos de sculk saudável serpenteando, bordas secas,
 *     manchas de sculk, crescimento nos biomas tomados;
 *   - cavernas, lava no fundo, bedrock irregular;
 *   - minérios, bolhas de sculk, plantas nas densidades medidas no mod,
 *     lagos de ichor com praia, monólitos, espinhos de sculk seco, arcos,
 *     cânion das almas, regiões de sculk, neve de ichor, salgueiros e
 *     portais abandonados (moldes originais).
 *
 * Tudo aqui é determinístico: a mesma (x, z) sempre dá a mesma coluna.
 * ========================================================================= */

import { hash2, hashSalt, noiseSeed, octaveNoise, octaveNoise3D, valueNoise, valueNoise3D } from "../lib/world_generator_API.js";

// ---------------------------------------------------------------------------
// Ferramentas
// ---------------------------------------------------------------------------
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (e0, e1, t) => {
  const u = clamp((t - e0) / (e1 - e0), 0, 1);
  return u * u * (3 - 2 * u);
};
const smoother = (v) => {
  const t = clamp(v, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const jround = (v) => Math.floor(v + 0.5);

/** Cache simples: esvazia quando passa do tamanho (o gerador anda em ondas). */
function makeCache(max) {
  const m = new Map();
  return {
    get: (k) => m.get(k),
    set(k, v) {
      if (m.size >= max) m.clear();
      m.set(k, v);
      return v;
    },
    clear: () => m.clear(),
  };
}

// ---------------------------------------------------------------------------
// Blocos
// ---------------------------------------------------------------------------
const S = (n) => "the_sift:" + n;
export const B = {
  slate: S("siftslate"),
  growth: S("siftslate_growth"),
  healthy: S("healthy_sculk"),
  dry: S("dry_healthy_sculk"),
  dryGrowth: S("dry_healthy_sculk_growth"),
  ichor: S("ichor"),
  soul: S("soul_block"),
  snow: S("ichor_snow"),
  coal: S("siftslate_coal_ore"),
  diamond: S("siftslate_diamond_ore"),
  emerald: S("siftslate_emerald_ore"),
  charoite: S("siftslate_charoite_ore"),
  siftite: S("siftslate_siftite_ore"),
  stalks: S("siftslate_stalks"),
  fronds: S("overgrown_fronds"),
  ostalks: S("overgrown_stalks"),
  chard: S("overgrown_chard"),
  lotus: S("overgrown_lotus"),
  sunburst: S("sunburst_plant"),
  whisper: S("whisperbloom"),
  sprouts: S("healthy_sculk_sprouts"),
  drySprouts: S("dry_healthy_sculk_sprouts"),
  slateRoots: S("siftslate_hanging_roots"),
  overRoots: S("overgrown_hanging_roots"),
  bedrock: "minecraft:bedrock",
  lava: "minecraft:lava",
  sculk: "minecraft:sculk",
  vein: "minecraft:sculk_vein",
  sensor: "minecraft:sculk_sensor",
  shrieker: "minecraft:sculk_shrieker",
  catalyst: "minecraft:sculk_catalyst",
  torch: "minecraft:torchflower",
  pitcher: "minecraft:pitcher_plant",
  wild: "minecraft:wildflowers",
};

// estados de alguns blocos (o resto usa o padrão)
export const STATES = {
  vein: { multi_face_direction_bits: 1 },
  shrieker: { can_summon: true },
  pitcherLow: { upper_block_bit: false },
  pitcherHigh: { upper_block_bit: true },
};

const isTerrain = (id) => id === B.slate || id === B.growth || id === B.healthy || id === B.dry || id === B.dryGrowth;

// ---------------------------------------------------------------------------
// Semente e ruídos
//
// Oitava inicial e amplitudes de cada ruído são as do mod (worldgen/noise).
// ---------------------------------------------------------------------------
const NOISES = {
  regional: [-10, [1.0, 0.52, 0.24]],
  plateau: [-8, [1.0, 0.7, 0.38, 0.16]],
  terrace: [-6, [1.0, 0.5, 0.24]],
  canyon: [-8, [1.0, 0.74, 0.44, 0.2]],
  detail: [-5, [1.0, 0.5, 0.24]],
  biome: [-9, [1.0, 0.62, 0.32]],
  giant: [-8, [1.0, 0.55, 0.24]],
  shelf: [-7, [1.0, 0.52, 0.21]],
  paths: [-8, [1.0, 0.68, 0.28]],
  ranges: [-9, [1.0, 0.58, 0.31, 0.14]],
  ridges: [-8, [1.0, 0.62, 0.34, 0.16]],
  blobs: [-5, [1.0, 0.52, 0.22]],
  dryRegions: [-9, [1.0, 0.42, 0.16]],
  escarp: [-5, [1.0, 0.58, 0.3, 0.12]],
  cliff: [-4, [1.0, 0.48, 0.22]],
  surface: [-6, [1.0, 1.0, 1.0]],
  surface2: [-6, [1.0, 1.0, 0.0, 1.0]],
};

let SEED = 0;
const SEEDS = {};
const caches = [];
const cache = (max) => {
  const c = makeCache(max);
  caches.push(c);
  return c;
};

/** A semente muda o Sift inteiro. Chamado uma vez, antes de gerar. */
export function setSeed(seed) {
  SEED = seed | 0;
  for (const k of Object.keys(NOISES)) SEEDS[k] = noiseSeed(SEED, k);
  SEEDS.caveA = noiseSeed(SEED, "caveA");
  SEEDS.caveB = noiseSeed(SEED, "caveB");
  SEEDS.caveW = noiseSeed(SEED, "caveW");
  for (const c of caches) c.clear();
}
setSeed(0);

function n2(name, x, z, scale) {
  const p = NOISES[name];
  return octaveNoise(x * scale, z * scale, p[0], p[1], SEEDS[name]);
}
function n3(name, x, y, z, xz, ys) {
  const p = NOISES[name];
  return octaveNoise3D(x * xz, y * ys, z * xz, p[0], p[1], SEEDS[name]);
}
/** Sorteio 0..1 por posição e sal, dependente da semente. */
const rnd = (x, y, z, salt) => hashSalt(x, y, z, salt ^ SEED);

// ---------------------------------------------------------------------------
// Biomas
// ---------------------------------------------------------------------------
export const BIOMES = {
  sift_wastes: { id: "sift_wastes", fog: null },
  overgrown_clearing: { id: "overgrown_clearing", fog: null },
  overgrown_forest: { id: "overgrown_forest", fog: null },
  overgrown_slopes: { id: "overgrown_slopes", fog: null },
  overgrown_forest_slopes: { id: "overgrown_forest_slopes", fog: null },
  overgrown_peaks: { id: "overgrown_peaks", fog: null },
  siftslate_slopes: { id: "siftslate_slopes", fog: null },
  siftslate_peaks: { id: "siftslate_peaks", fog: null },
  ichor_snowy_peaks: { id: "ichor_snowy_peaks", fog: null },
  sift_deep_dark: { id: "sift_deep_dark", fog: "the_sift:fog_sift_deep" },
};
export const ALL_SURFACE_BIOMES = Object.keys(BIOMES).filter((b) => b !== "sift_deep_dark");

const OVERGROWN = new Set(["overgrown_clearing", "overgrown_forest", "overgrown_slopes", "overgrown_forest_slopes", "overgrown_peaks"]);
const HIGHLANDS = new Set(["siftslate_slopes", "overgrown_slopes", "overgrown_forest_slopes", "siftslate_peaks", "overgrown_peaks", "ichor_snowy_peaks"]);
const GROWTH_TOP = new Set([...OVERGROWN, "ichor_snowy_peaks"]);

/** Mesmas faixas de clima da dimensão do mod. */
function pickBiome(f, y) {
  const C = f.cont;
  if (C < 0.58) {
    if (f.hum < 0) return "sift_wastes";
    return f.weird < 0.18 ? "overgrown_clearing" : "overgrown_forest";
  }
  if (C < 0.88) {
    if (f.hum < 0) return "siftslate_slopes";
    return f.weird < 0.18 ? "overgrown_slopes" : "overgrown_forest_slopes";
  }
  if (y <= 46) return "sift_deep_dark";
  if (f.ero < 0) return "ichor_snowy_peaks";
  return f.hum < 0 ? "siftslate_peaks" : "overgrown_peaks";
}

// ---------------------------------------------------------------------------
// O relevo
//
// Tudo em "densidade": 1,02 em y 0 caindo até -1,78 em y 256 (0,0109 por
// bloco), mais os deslocamentos. O chão fica onde a soma cruza zero; um
// deslocamento de +0,1 levanta o chão ~9 blocos.
// ---------------------------------------------------------------------------
const GRAD = 2.8 / 256;
const CELL = 4;

/** Os campos 2D num canto da grade de 4 blocos. */
const latticeCache = cache(60000);
function lattice(x, z) {
  const k = x + "," + z;
  const hit = latticeCache.get(k);
  if (hit) return hit;

  const regional = 0.12 * n2("regional", x, z, 0.52);
  const hum = n2("biome", x, z, 0.62);
  const weird = n2("plateau", x, z, 0.7);
  const ero = n2("canyon", x, z, 0.61);
  const flat = clamp(0.5 + 0.9 * hum, 0, 1) * clamp(0.62 - 1.35 * weird, 0, 1);
  const intensity = 1 - 0.42 * flat;

  // platôs: 5 degraus
  const pf = weird + 0.16 * n2("terrace", x, z, 0.86);
  const plateau = pf < -0.58 ? -0.245 : pf < -0.19 ? -0.085 : pf < 0.19 ? 0.04 : pf < 0.56 ? 0.195 : 0.345;

  // cânions: 3 degraus para baixo
  const cv = ero + 0.115 * n2("terrace", x, z, 1.05);
  const acv = Math.abs(cv);
  let canyon = 0;
  if (cv >= -0.2 && cv < 0.2) {
    if (cv >= -0.108 && cv < 0.108) {
      canyon = cv >= -0.046 && cv < 0.046 ? -0.385 + 0.045 * n2("detail", x, z, 0.72) : -0.245;
    } else canyon = -0.115;
  }
  void acv;

  const detail = 0.041 * n2("detail", x, z, 0.96);

  // o vale raso dos caminhos de sculk
  const canyonRaw = n2("canyon", x, z, 1.0);
  const paths = n2("paths", x, z, 1.0);
  const valley = canyonRaw >= -0.72 && canyonRaw < 0.72 ? -0.94 * clamp(0.036 - Math.abs(paths), 0, 0.036) : 0;

  // penhascos gigantes e prateleiras
  const gc = n2("giant", x, z, 0.72) + 0.1 * n2("terrace", x, z, 0.9);
  const giant = gc >= 0.7 ? (gc < 0.82 ? 0.19 : 0.46) : 0;
  let shelf = 0;
  if (giant < 0.01) {
    const sf = n2("shelf", x, z, 0.55) + 0.13 * n2("terrace", x, z, 0.48);
    let step = 0;
    if (sf >= 0.74) {
      if (sf < 0.81) step = 0.115 + 0.016 * n2("detail", x, z, 0.44);
      else if (sf < 0.87) step = 0.255 + 0.02 * n2("detail", x, z, 0.38);
      else step = 0.42 + 0.024 * n2("detail", x, z, 0.33);
    }
    shelf = (0.72 + 0.28 * intensity) * step;
  }

  // cordilheiras
  const mc = clamp(-0.12 + 1.85 * n2("ranges", x, z, 1.1), -1, 1);
  const mMask = clamp(7.1428571 * mc - 4.8571429, 0, 1);
  const foothill = clamp(0.75 * mc - 0.375, 0, 0.06);
  const slopeMask = clamp(1.6666667 * mc - 0.9666667, 0, 0.3);
  const r = clamp(1 - 1.9 * Math.abs(n2("ridges", x, z, 1.05)), 0, 1);
  const ridge = r * r;
  const twist = clamp(0.5 + 0.85 * n2("terrace", x, z, 0.48), 0, 1);
  const mountain = foothill + slopeMask + mMask * ridge * (0.9 + 0.2 * twist);
  const cont = clamp(mc + 0.25 * mMask * ridge, -1, 1);

  const off = regional + intensity * (plateau + canyon) + detail + valley + giant + shelf;
  return latticeCache.set(k, { off, mountain, intensity, cont, hum, weird, ero });
}

/** Aspereza 3D (escarpas + penhascos) num canto da grade 4 x 8 x 4. */
const roughCache = cache(120000);
function roughAt(x, y, z, intensity) {
  const k = x + "," + y + "," + z;
  let v = roughCache.get(k);
  if (v === undefined) {
    v = 0.05 * n3("escarp", x, y, z, 0.58, 0.46) + 0.04 * n3("cliff", x, y, z, 1.12, 0.76);
    roughCache.set(k, v);
  }
  return v * intensity;
}

/** As montanhas achatam no alto (de y 220 a 255), como no mod. */
const mountainFade = (y) => 1 - 0.92 * clamp((y - 220) / 35, 0, 1);

/**
 * O relevo de uma coluna: os campos interpolados e a função densidade(y).
 * `f` guarda o clima do canto da grade (o bioma do Java também é em blocos).
 */
function relief(x, z) {
  const x0 = Math.floor(x / CELL) * CELL;
  const z0 = Math.floor(z / CELL) * CELL;
  const tx = (x - x0) / CELL;
  const tz = (z - z0) / CELL;
  const a = lattice(x0, z0);
  const b = lattice(x0 + CELL, z0);
  const c = lattice(x0, z0 + CELL);
  const d = lattice(x0 + CELL, z0 + CELL);
  const bl = (k) => lerp(lerp(a[k], b[k], tx), lerp(c[k], d[k], tx), tz);
  const off = bl("off");
  const mountain = bl("mountain");
  const corners = [a, b, c, d];
  const w = [(1 - tx) * (1 - tz), tx * (1 - tz), (1 - tx) * tz, tx * tz];
  const pts = [[x0, z0], [x0 + CELL, z0], [x0, z0 + CELL], [x0 + CELL, z0 + CELL]];
  const memo = new Map();
  const roughY = (y8) => {
    const m = memo.get(y8);
    if (m !== undefined) return m;
    let s = 0;
    for (let i = 0; i < 4; i++) s += w[i] * roughAt(pts[i][0], y8, pts[i][1], corners[i].intensity);
    memo.set(y8, s);
    return s;
  };
  const density = (y) => {
    const y8 = Math.floor(y / 8) * 8;
    const t = (y - y8) / 8;
    const r = lerp(roughY(y8), roughY(y8 + 8), t);
    return 1.02 - GRAD * y + off + mountain * mountainFade(y) + r;
  };
  return { density, f: a, off, mountain };
}

/** y do bloco mais alto do relevo natural (sem features). */
const topCache = cache(80000);
function naturalTop(x, z) {
  const k = x + "," + z;
  const hit = topCache.get(k);
  if (hit !== undefined) return hit;
  const r = relief(x, z);
  let est = Math.floor((1.02 + r.off + r.mountain) / GRAD);
  if (est > 220) est = Math.floor((1.02 + r.off + r.mountain * mountainFade(est)) / GRAD);
  let y = clamp(est + 12, 1, 250);
  const low = Math.max(1, est - 16);
  while (y > low && r.density(y) <= 0) y--;
  return topCache.set(k, clamp(y, 6, 250));
}

// ---------------------------------------------------------------------------
// Zona do portal principal: o terreno é aplainado pra estrutura assentar
// ---------------------------------------------------------------------------
let ZONE = null;
const ZONE_MARGIN = 14;

/** origin = canto da estrutura (9 x 40), ground = y da camada 0 dela. */
export function setPortalZone(origin, ground) {
  ZONE = origin ? { x0: origin.x, x1: origin.x + 8, z0: origin.z, z1: origin.z + 39, ground } : null;
  for (const c of caches) if (c !== latticeCache && c !== roughCache && c !== topCache) c.clear();
}

function zoneDistance(x, z) {
  if (!ZONE) return Infinity;
  const dx = Math.max(ZONE.x0 - x, 0, x - ZONE.x1);
  const dz = Math.max(ZONE.z0 - z, 0, z - ZONE.z1);
  return Math.sqrt(dx * dx + dz * dz);
}
/** Features grandes ficam longe do portal (como o SiftFeaturePlacementGuard). */
const nearPortal = (x, z, r) => zoneDistance(x, z) <= r + 15;

function zoneTop(x, z, h) {
  const d = zoneDistance(x, z);
  if (d > ZONE_MARGIN) return h;
  if (d === 0) return ZONE.ground - 1;
  return Math.round(ZONE.ground - 1 + (h - ZONE.ground + 1) * sstep(0, ZONE_MARGIN, d));
}

// ---------------------------------------------------------------------------
// Grade de "lugares" (um sorteio por célula, como as crateras dos planetas)
// ---------------------------------------------------------------------------
function cellRand(cx, cz, salt) {
  return rnd(cx, 0, cz, salt);
}

// ---------------------------------------------------------------------------
// Lagos de ichor
//
// Um lugar por célula de 48 blocos. Como no mod: o tamanho depende de quão
// plano é o terreno em volta (quanto mais plano, maior o lago), o espelho é
// UM nível só (tirado das alturas em volta), a margem vira praia rampada com
// a paleta do lago, e o fundo é forrado de sculk.
// ---------------------------------------------------------------------------
const LAKE_CELL = 48;
const LAKE_VARIANTS = [
  { max: 3, rMin: 14, rMax: 16, beach: [5, 6], depth: 6, relief: 4 },
  { max: 5, rMin: 12, rMax: 15, beach: [4, 5], depth: 5, relief: 5 },
  { max: 7, rMin: 8, rMax: 12, beach: [2, 3], depth: 4, relief: 4 },
  { max: 12, rMin: 4, rMax: 7, beach: [1, 2], depth: 3, relief: 4 },
];

const lakeCache = cache(4000);
function lakeOf(cx, cz) {
  const k = cx + "," + cz;
  const hit = lakeCache.get(k);
  if (hit !== undefined) return hit;
  let lake = null;
  if (cellRand(cx, cz, 0x1a4e) < 0.14) {
    const px = Math.floor((cx + 0.2 + 0.6 * cellRand(cx, cz, 0x2b)) * LAKE_CELL);
    const pz = Math.floor((cz + 0.2 + 0.6 * cellRand(cx, cz, 0x3c)) * LAKE_CELL);
    const hs = [];
    for (let dx = -16; dx <= 16; dx += 4) {
      for (let dz = -16; dz <= 16; dz += 4) if (dx * dx + dz * dz <= 256) hs.push(naturalTop(px + dx, pz + dz));
    }
    hs.sort((a, b) => a - b);
    const reliefV = hs[hs.length - 1] - hs[0];
    const v = LAKE_VARIANTS.find((q) => reliefV <= q.max);
    const biome = pickBiome(lattice(Math.floor(px / 4) * 4, Math.floor(pz / 4) * 4), hs[hs.length >> 1]);
    if (v && biome !== "sift_deep_dark" && !nearPortal(px, pz, 30)) {
      const R = lerp(v.rMin, v.rMax, cellRand(cx, cz, 0x4d));
      const rz = clamp(R + (cellRand(cx, cz, 0x5e) * 6 - 3), v.rMin, v.rMax);
      const angle = cellRand(cx, cz, 0x6f) * Math.PI;
      const beach = v.beach[0] + Math.floor(cellRand(cx, cz, 0x70) * (v.beach[1] - v.beach[0] + 1));
      // nível: as alturas dentro do espelho, no percentil 36 (como o mod)
      const inner = [];
      for (let dx = -R; dx <= R; dx += 3) for (let dz = -R; dz <= R; dz += 3) if (dx * dx + dz * dz <= R * R * 0.8) inner.push(naturalTop(px + dx, pz + dz));
      inner.sort((a, b) => a - b);
      if (inner.length && inner[inner.length - 1] - inner[0] <= v.relief + 2) {
        const over = OVERGROWN.has(biome);
        const br = cellRand(cx, cz, 0x81) * 100;
        const sr = cellRand(cx, cz, 0x92) * 100;
        lake = {
          px, pz, rx: R, rz, angle, cos: Math.cos(angle), sin: Math.sin(angle), beach, depth: v.depth,
          level: inner[Math.floor((inner.length - 1) * 0.36)],
          basin: br < 70 ? B.dry : br < 91 ? B.healthy : B.slate,
          shore: over && sr < 58 ? B.growth : sr < (over ? 79 : 72) ? B.dry : sr < 93 ? B.healthy : B.slate,
          flower: Math.floor(cellRand(cx, cz, 0xa3) * 6),
          salt: Math.floor(cellRand(cx, cz, 0xb4) * 1e9),
        };
      }
    }
  }
  return lakeCache.set(k, lake);
}

/** Distância normalizada ao espelho do lago (<= 1 dentro), com a margem ondulada do mod. */
function lakeDistance(L, x, z) {
  const dx = x - L.px;
  const dz = z - L.pz;
  const lx = (dx * L.cos - dz * L.sin) / L.rx;
  const lz = (dx * L.sin + dz * L.cos) / L.rz;
  const wx = lx + Math.sin(lz * 2.7 + L.angle * 1.9) * 0.045;
  const wz = lz + Math.sin(lx * 2.2 - L.angle * 1.3) * 0.04;
  const polar = Math.atan2(lz, lx);
  const shore = 0.95 + Math.sin(polar * 3 + L.angle * 1.7) * 0.09 + Math.sin(polar * 5 - L.angle * 0.8) * 0.055 +
    Math.cos(polar * 7 + L.angle * 0.37) * 0.028;
  return Math.sqrt(wx * wx + wz * wz) / shore;
}

/** O lago que afeta esta coluna: { L, t (0..1 dentro), layer (praia) } ou null. */
function lakeAt(x, z) {
  const cx0 = Math.floor(x / LAKE_CELL);
  const cz0 = Math.floor(z / LAKE_CELL);
  let best = null;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const L = lakeOf(cx0 + i, cz0 + j);
      if (!L) continue;
      const reach = Math.max(L.rx, L.rz) * 1.2 + L.beach + 1;
      if (Math.abs(x - L.px) > reach || Math.abs(z - L.pz) > reach) continue;
      const t = lakeDistance(L, x, z);
      if (t <= 1) return { L, t, layer: 0 };
      // praia: distância em blocos até a borda
      const dist = (t - 1) * Math.min(L.rx, L.rz);
      const layer = Math.ceil(dist);
      if (layer >= 1 && layer <= L.beach && (!best || layer < best.layer)) best = { L, t, layer };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Monólitos e espinhos de sculk seco (um por chunk, quando sai no sorteio)
// ---------------------------------------------------------------------------
function terraceBoost(p, main) {
  let b = 0;
  if (Math.abs(p - 0.28) < 0.035) b += main ? 1.35 : 0.75;
  if (Math.abs(p - 0.58) < 0.03) b += main ? 1.05 : 0.55;
  if (Math.abs(p - 0.81) < 0.025) b += main ? 0.75 : 0.35;
  return b;
}

function stableGround(x, z, radius, maxRelief) {
  let mn = Infinity;
  let mx = -Infinity;
  for (let dx = -radius; dx <= radius; dx += 2) {
    for (let dz = -radius; dz <= radius; dz += 2) {
      if (dx * dx + dz * dz > radius * radius) continue;
      if (lakeAt(x + dx, z + dz)) return false;
      const h = naturalTop(x + dx, z + dz);
      mn = Math.min(mn, h);
      mx = Math.max(mx, h);
    }
  }
  return mx - mn <= maxRelief;
}

const pillarCache = cache(6000);
/** Pilares (monólito ou espinho) cujo centro fica no chunk (cx, cz). */
function pillarsOf(cx, cz) {
  const k = cx + "," + cz;
  const hit = pillarCache.get(k);
  if (hit !== undefined) return hit;
  const out = [];
  const x = cx * 16 + 8 + Math.floor(cellRand(cx, cz, 0x301) * 5) - 2;
  const z = cz * 16 + 8 + Math.floor(cellRand(cx, cz, 0x302) * 5) - 2;
  const y = naturalTop(x, z) + 1;
  const biome = pickBiome(lattice(Math.floor(x / 4) * 4, Math.floor(z / 4) * 4), y);
  const wastes = biome === "sift_wastes" || biome === "siftslate_slopes" || biome === "siftslate_peaks";
  const over = OVERGROWN.has(biome);
  const peaks = biome === "siftslate_peaks";
  const r = (s) => cellRand(cx, cz, s);
  if ((wastes || over) && !nearPortal(x, z, 22)) {
    // monólito exuberante (1/8 nos ermos, 1/11 nos tomados; não nos picos de siftslate)
    const lushChance = peaks ? 0 : wastes ? 1 / 16 : 1 / 22;
    const bareChance = wastes ? 1 / 30 : 1 / 40;
    const spikeChance = wastes ? 1 / 24 : 1 / 32;
    let kind = null;
    const roll = r(0x310);
    if (roll < lushChance) kind = "lush";
    else if (roll < lushChance + bareChance) kind = "bare";
    else if (roll < lushChance + bareChance + spikeChance) kind = "spike";
    // espaçamento (a reserva de 22 blocos do mod): o vizinho de sorteio menor ganha
    if (kind) {
      for (let i = -1; i <= 1 && kind; i++) {
        for (let j = -1; j <= 1; j++) {
          if ((i || j) && cellRand(cx + i, cz + j, 0x310) < roll && cellRand(cx + i, cz + j, 0x310) < lushChance + bareChance + spikeChance) {
            kind = null;
            break;
          }
        }
      }
    }
    if (kind === "lush" || kind === "bare") {
      const lush = kind === "lush";
      const radius = lush ? 5 + Math.floor(r(0x311) * 3) : 4 + Math.floor(r(0x311) * 3);
      if (stableGround(x, z, radius + 2, lush ? 14 : 12)) {
        const height = Math.min(lush ? 31 + Math.floor(r(0x312) * 25) : 24 + Math.floor(r(0x312) * 21), 252 - y);
        if (height >= 18) {
          out.push({ x, y, z, radius, height, lush, main: true, spike: false, leanX: Math.floor(r(0x313) * 5) - 2, leanZ: Math.floor(r(0x314) * 5) - 2, salt: Math.floor(r(0x315) * 1e9) });
          const sats = lush ? 1 + Math.floor(r(0x316) * 3) : Math.floor(r(0x316) * 2);
          for (let i = 0; i < sats; i++) {
            const a = r(0x320 + i) * Math.PI * 2;
            const d = radius + 4 + Math.floor(r(0x330 + i) * 4);
            const sx = x + jround(Math.cos(a) * d);
            const sz = z + jround(Math.sin(a) * d);
            const sy = naturalTop(sx, sz) + 1;
            const sr = 2 + Math.floor(r(0x340 + i) * 2);
            if (!stableGround(sx, sz, sr + 2, 10)) continue;
            const sh = Math.min(13 + Math.floor(r(0x350 + i) * Math.max(7, height / 2)), 252 - sy);
            if (sh >= 10) out.push({ x: sx, y: sy, z: sz, radius: sr, height: sh, lush: lush && r(0x360 + i) < 0.72, main: false, spike: false, leanX: Math.floor(r(0x370 + i) * 5) - 2, leanZ: Math.floor(r(0x380 + i) * 5) - 2, salt: Math.floor(r(0x390 + i) * 1e9) });
          }
        }
      }
    } else if (kind === "spike") {
      const main = 3 + Math.floor(r(0x401) * 2);
      if (stableGround(x, z, main + 2, 12)) {
        const push = (px, pz, radius, h, salt) => {
          const py = naturalTop(px, pz) + 1;
          const height = Math.min(h, 253 - py);
          if (height >= 8 && stableGround(px, pz, radius + 2, 12)) {
            out.push({ x: px, y: py, z: pz, radius, height, spike: true, leanX: Math.floor(r(salt) * 7) - 3, leanZ: Math.floor(r(salt + 1) * 7) - 3, salt: Math.floor(r(salt + 2) * 1e9) });
          }
        };
        push(x, z, main, 19 + Math.floor(r(0x402) * 13), 0x410);
        const sats = 2 + Math.floor(r(0x403) * 3);
        for (let i = 0; i < sats; i++) {
          const a = r(0x420 + i) * Math.PI * 2;
          const d = 4 + Math.floor(r(0x430 + i) * 6);
          push(x + jround(Math.cos(a) * d), z + jround(Math.sin(a) * d), 2 + Math.floor(r(0x440 + i) * 2), 10 + Math.floor(r(0x450 + i) * 13), 0x460 + i * 4);
        }
      }
    }
  }
  return pillarCache.set(k, out);
}

/**
 * O que os pilares põem nesta coluna: lista de { y, id } (blocos soltos) e a
 * nova "base" levantada pelo pé do pilar.
 */
function pillarBlocks(x, z, groundTop) {
  const cx0 = Math.floor(x / 16);
  const cz0 = Math.floor(z / 16);
  const out = [];
  let raise = groundTop;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      for (const p of pillarsOf(cx0 + i, cz0 + j)) {
        const reach = p.radius + 4 + Math.abs(p.leanX) + Math.abs(p.leanZ);
        if (Math.abs(x - p.x) > reach || Math.abs(z - p.z) > reach) continue;
        const block = p.spike ? B.dry : B.slate;
        // o pé que se espalha no chão
        const rr = p.radius + 2;
        const d2 = (x - p.x) ** 2 + (z - p.z) ** 2;
        const edge = rr + (rnd(x, p.y, z, p.salt ^ 0x77) - 0.5) * (p.spike ? 0.8 : 0.9);
        if (d2 <= edge * edge && Math.abs(groundTop + 1 - p.y) <= (p.spike ? 6 : 8)) {
          const strength = 1 - Math.min(1, Math.sqrt(d2) / rr);
          const top = p.y + jround(strength * (p.spike ? 1.5 : 2));
          if (groundTop + 1 <= top + 1) {
            for (let y = groundTop - 1; y <= top; y++) out.push({ y, id: block });
            raise = Math.max(raise, top);
          }
        }
        // o corpo
        const baseY = p.spike ? p.y : p.y - 2;
        for (let dy = 0; dy <= p.height; dy++) {
          const t = dy / p.height;
          const cx = p.x + jround(p.leanX * t * t);
          const cz = p.z + jround(p.leanZ * t * t);
          let radius;
          if (p.spike) radius = Math.max(0.32, p.radius * Math.pow(1 - t, 0.72));
          else radius = p.radius - (p.radius - 2.25) * t + terraceBoost(t, p.main);
          const y = baseY + dy;
          const er = radius + (rnd(x, y, z, p.salt) - 0.5) * (p.spike ? 0.45 : 0.82);
          if ((x - cx) ** 2 + (z - cz) ** 2 <= er * er) {
            out.push({ y, id: block });
            if (y > raise) raise = y;
          }
        }
        // o topo (com crescimento nos exuberantes)
        if (!p.spike) {
          const tx = p.x + p.leanX;
          const tz = p.z + p.leanZ;
          const ty = baseY + p.height;
          const tr = Math.max(2, p.radius - 2) + (p.main ? 1 : 0);
          const er = tr + (rnd(x, ty, z, p.salt ^ 0x6a09) - 0.5) * 0.7;
          if ((x - tx) ** 2 + (z - tz) ** 2 <= er * er) {
            out.push({ y: ty, id: p.lush ? B.growth : B.slate, cap: true });
            if (ty > raise) raise = ty;
          }
        }
      }
    }
  }
  return { blocks: out, raise };
}

// ---------------------------------------------------------------------------
// Arcos (SiftArchFeature): uma ponte de rocha sobre um vale
// ---------------------------------------------------------------------------
const AXES = [[1, 0], [0, 1], [1, 1], [1, -1]];
const phase = (salt, shift) => (((salt * 2654435761 + shift * 40503) >>> 0) % 65536) / 65535 * Math.PI * 2;

const archCache = cache(4000);
function archOf(cx, cz) {
  const k = cx + "," + cz;
  const hit = archCache.get(k);
  if (hit !== undefined) return hit;
  let arch = null;
  const r = (s) => cellRand(cx, cz, s);
  if (r(0x501) < 1 / 5) {
    const x = cx * 16 + 8 + Math.floor(r(0x502) * 3) - 1;
    const z = cz * 16 + 8 + Math.floor(r(0x503) * 3) - 1;
    const cy = naturalTop(x, z) + 1;
    const biome = pickBiome(lattice(Math.floor(x / 4) * 4, Math.floor(z / 4) * 4), cy);
    if (biome !== "sift_deep_dark" && !nearPortal(x, z, 23)) {
      const half = 13 + Math.floor(r(0x504) * 3);
      let best = null;
      let bestScore = -Infinity;
      for (let ai = 0; ai < AXES.length; ai++) {
        const d = AXES[ai];
        const norm = d[0] && d[1] ? 0.70710678118 : 1;
        const ax = d[0] * norm;
        const az = d[1] * norm;
        const ly = naturalTop(x - jround(ax * half), z - jround(az * half)) + 1;
        const ry = naturalTop(x + jround(ax * half), z + jround(az * half)) + 1;
        const inner = Math.max(7, Math.floor(half / 2));
        const liy = naturalTop(x - jround(ax * (half - inner)), z - jround(az * (half - inner))) + 1;
        const riy = naturalTop(x + jround(ax * (half - inner)), z + jround(az * (half - inner))) + 1;
        const diff = Math.abs(ly - ry);
        const valley = Math.min(ly, ry) - cy;
        const ld = ly - liy;
        const rd = ry - riy;
        if (diff <= 20 && valley >= 6 && ld >= 3 && rd >= 3 && ld + rd >= 8) {
          const score = valley * 5.5 + (ld + rd) * 2.2 - diff * 0.75 + r(0x510 + ai);
          if (score > bestScore) {
            bestScore = score;
            best = { ax, az, ly, ry, valley };
          }
        }
      }
      if (best) {
        let rise = 7 + Math.floor(r(0x505) * 6) + Math.min(5, Math.trunc(best.valley / 5));
        const top = Math.trunc((best.ly + best.ry) / 2) + rise + 5;
        if (top >= 255) rise -= top - 254;
        if (rise >= 6) {
          const lf = surfaceBlockNatural(x - jround(best.ax * half), z - jround(best.az * half));
          const rf = surfaceBlockNatural(x + jround(best.ax * half), z + jround(best.az * half));
          const healthyGround = lf === B.healthy || lf === B.dry || rf === B.healthy || rf === B.dry;
          const growthGround = lf === B.growth || rf === B.growth;
          const healthy = r(0x506) < (healthyGround ? 0.78 : growthGround ? 0.22 : 0.43);
          const salt = Math.floor(r(0x507) * 1e9);
          const thick = 2.45 + r(0x508) * 0.9;
          const spheres = [];
          const steps = half * 4;
          const curve = (t) => {
            const signed = (t * 2 - 1) * half;
            const mask = Math.sin(Math.PI * t);
            const lat = (Math.sin(t * Math.PI * 2 + phase(salt, 7)) * 0.68 + Math.sin(t * Math.PI * 5 + phase(salt, 23)) * 0.32) * 1.45 * mask;
            const ver = (Math.sin(t * Math.PI * 3 + phase(salt, 17)) * 0.72 + Math.sin(t * Math.PI * 7 + phase(salt, 37)) * 0.28) * 1.05 * mask;
            return {
              x: x + best.ax * signed - best.az * lat,
              y: best.ly + (best.ry - best.ly) * t + rise * 4 * t * (1 - t) + ver,
              z: z + best.az * signed + best.ax * lat,
            };
          };
          for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const p = curve(t);
            const wave = 0.93 + 0.09 * Math.sin(t * Math.PI * 5 + phase(salt, 11)) + 0.045 * Math.sin(t * Math.PI * 9 + phase(salt, 29));
            spheres.push({ ...p, r: thick * wave + Math.pow(Math.abs(t * 2 - 1), 4) * 1.15 });
          }
          // os pés fundem no terreno dos dois lados
          for (const left of [true, false]) {
            const ep = curve(left ? 0 : 1);
            const out = left ? -1 : 1;
            let prev = left ? best.ly : best.ry;
            for (let s = 0; s < 5; s++) {
              const prog = (s + 1) / 5;
              const dist = 0.85 + s * 0.78;
              const px = ep.x + best.ax * out * dist;
              const pz = ep.z + best.az * out * dist;
              const surf = naturalTop(jround(px), jround(pz)) + 1;
              if (Math.abs(surf - prev) > 9) break;
              prev = surf;
              const py = ep.y + (surf - 0.35 - ep.y) * smoother(prog);
              spheres.push({ x: px, y: py, z: pz, r: Math.max(1.25, thick + 0.9 - prog * (thick - 0.55)) });
            }
          }
          arch = { spheres, body: healthy ? B.healthy : B.slate, healthy, growthTop: !healthy && growthGround, salt, x, z, reach: half + 8 };
        }
      }
    }
  }
  return archCache.set(k, arch);
}

/** Trechos verticais que os arcos ocupam nesta coluna: [{ y0, y1, id, growthTop }]. */
function archSpans(x, z) {
  const cx0 = Math.floor(x / 16);
  const cz0 = Math.floor(z / 16);
  const spans = [];
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const a = archOf(cx0 + i, cz0 + j);
      if (!a || Math.abs(x - a.x) > a.reach || Math.abs(z - a.z) > a.reach) continue;
      const cells = new Set();
      for (const s of a.spheres) {
        const rr = s.r + 0.31;
        const d2 = (x - s.x) ** 2 + (z - s.z) ** 2;
        if (d2 > rr * rr) continue;
        const h = Math.sqrt(rr * rr - d2);
        for (let y = Math.ceil(s.y - h); y <= Math.floor(s.y + h); y++) {
          const er = s.r + (rnd(x, y, z, a.salt) - 0.5) * 0.62;
          if (d2 + (y - s.y) ** 2 <= er * er) cells.add(y);
        }
      }
      if (!cells.size) continue;
      const ys = [...cells].sort((p, q) => p - q);
      for (const y of ys) {
        const vein = a.healthy && rnd(x, y, z, a.salt ^ 0x3c6e) < 0.18;
        spans.push({ y0: y, y1: y, id: vein ? B.dry : a.body, top: !cells.has(y + 1), growthTop: a.growthTop });
      }
    }
  }
  return spans;
}

// ---------------------------------------------------------------------------
// Cânion das almas (SoulCanyonFeature): um corte fundo com veios de alma
// ---------------------------------------------------------------------------
const SOUL_CELL = 12;
const soulCache = cache(400);
function soulCanyonOf(cellX, cellZ) {
  const k = cellX + "," + cellZ;
  const hit = soulCache.get(k);
  if (hit !== undefined) return hit;
  const ccx = cellX * SOUL_CELL + Math.floor(cellRand(cellX, cellZ, 0x601) * SOUL_CELL);
  const ccz = cellZ * SOUL_CELL + Math.floor(cellRand(cellX, cellZ, 0x602) * SOUL_CELL);
  const cx = ccx * 16 + 8;
  const cz = ccz * 16 + 8;
  const r = (s) => cellRand(cellX, cellZ, s);
  let plan = null;
  if (!nearPortal(cx, cz, 34)) {
    const length = 49 + Math.floor(r(0x603) * 3);
    const baseRadius = 4 + Math.floor(r(0x604) * 2);
    const maxDepth = 22 + Math.floor(r(0x605) * 5);
    const ph = r(0x606) * Math.PI * 2;
    const orient = Math.floor(r(0x607) * 4);
    const dX = (orient & 1) === 0 ? 0.7071 : -0.7071;
    const dZ = (orient & 2) === 0 ? 0.7071 : -0.7071;
    const half = Math.floor(length / 2);
    const cols = new Map();
    let prevFloor = null;
    let prevSurf = null;
    let ok = true;
    for (let step = 0; step < length && ok; step++) {
      const off = step - half;
      const meander = Math.sin(ph + step * 0.22) * 1.65 + Math.sin(ph * 1.73 + step * 0.071) * 0.7;
      const radius = Math.max(3, baseRadius + jround(Math.sin(ph * 0.63 + step * 0.39)));
      const ex = cx + dX * off - dZ * meander;
      const ez = cz + dZ * off + dX * meander;
      const cs = naturalTop(jround(ex), jround(ez));
      if (prevSurf !== null && Math.abs(cs - prevSurf) > 6) ok = false;
      prevSurf = cs;
      const prog = step / (length - 1);
      const ramp = Math.min(maxDepth, 1 + jround(step * 0.67));
      const cfd = 1 + jround((ramp - 1) * smoother(clamp((1 - prog) / 0.34, 0, 1)));
      const desired = cs - cfd;
      const floor = prevFloor === null ? desired : Math.max(prevFloor - 1, Math.min(prevFloor + 1, desired));
      prevFloor = floor;
      for (let x = Math.floor(ex) - radius - 2; x <= Math.ceil(ex) + radius + 2; x++) {
        for (let z = Math.floor(ez) - radius - 2; z <= Math.ceil(ez) + radius + 2; z++) {
          const rx = x - ex;
          const rz = z - ez;
          if (Math.abs(rx * dX + rz * dZ) > 0.82) continue;
          const signed = -rx * dZ + rz * dX;
          const sd = Math.abs(signed);
          if (sd > radius + 0.35) continue;
          if (sd > radius - 0.35 && rnd(x, 0, z, 0x5011) < 0.18) continue;
          const ratio = sd / (radius + 0.35);
          const arch = Math.sqrt(Math.max(0, 1 - ratio * ratio));
          const sy = naturalTop(x, z);
          const corridor = sd <= 1.55;
          const fy = corridor ? floor : sy - Math.max(1, jround((sy - floor) * arch));
          if (fy <= 3) {
            ok = false;
            break;
          }
          const key = x + "," + z;
          const prev = cols.get(key);
          if (!prev || fy < prev.floor) cols.set(key, { floor: fy, depth: sy - fy, progress: prog, along: step, signed, side: sd });
        }
      }
    }
    if (ok && cols.size > 50) {
      // veios de alma no trecho fundo
      const souls = new Set();
      for (const [key, c] of cols) {
        if (c.depth < maxDepth * 0.5 || c.progress < 0.53 || c.progress > 0.86 || c.side > baseRadius) continue;
        const a = c.along;
        const vc = Math.sin(ph + a * 0.31) * 1.15 + Math.sin(ph * 0.71 + a * 0.13) * 0.48;
        const w = 0.82 + (Math.sin(ph * 1.37 + a * 0.43) + 1) * 0.24;
        const er = Math.abs(c.signed - vc) / w;
        const [x, z] = key.split(",").map(Number);
        const grain = rnd(x, 1, z, 0x5022);
        const p1 = ((c.progress - 0.63) / 0.055) ** 2 + ((c.signed + 1.65 + Math.sin(ph) * 0.55) / 1.55) ** 2;
        const p2 = ((c.progress - 0.77) / 0.048) ** 2 + ((c.signed - 1.35 - Math.cos(ph) * 0.45) / 1.35) ** 2;
        if ((er <= 1 && (er < 0.48 || grain > 0.2 + er * 0.42)) || (Math.min(p1, p2) <= 1 && grain > 0.16)) souls.add(key);
      }
      if (souls.size >= 8) plan = { cols, souls, cx, cz };
    }
  }
  return soulCache.set(k, plan);
}

function soulAt(x, z) {
  const cellX = Math.floor(Math.floor(x / 16) / SOUL_CELL);
  const cellZ = Math.floor(Math.floor(z / 16) / SOUL_CELL);
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const p = soulCanyonOf(cellX + i, cellZ + j);
      if (!p || Math.abs(x - p.cx) > 40 || Math.abs(z - p.cz) > 40) continue;
      const c = p.cols.get(x + "," + z);
      if (c) return { floor: c.floor, soul: p.souls.has(x + "," + z) };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Regiões de sculk (SiftSurfaceSculkRegionFeature): manchas enormes de sculk
// com sensores e gritadores, uma por célula de 512 blocos
// ---------------------------------------------------------------------------
const regionCache = cache(64);
function sculkRegion(cellX, cellZ) {
  const k = cellX + "," + cellZ;
  const hit = regionCache.get(k);
  if (hit !== undefined) return hit;
  const r = (s) => cellRand(cellX, cellZ, 0x7000 + s);
  const cx = cellX * 512 + 76 + Math.floor(r(1) * 361);
  const cz = cellZ * 512 + 76 + Math.floor(r(2) * 361);
  const major = (50 + Math.floor(r(3) * 71)) * 0.5;
  const minor = major * (0.72 + r(4) * 0.23);
  const angle = r(5) * Math.PI;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const blobs = [];
  const count = 6 + Math.floor(r(6) * 6);
  for (let i = 0; i < count; i++) {
    const dir = r(10 + i * 7) * Math.PI * 2;
    const dist = i === 0 ? 0 : Math.sqrt(r(11 + i * 7)) * major * 0.68;
    const lx = Math.cos(dir) * dist;
    const lz = Math.sin(dir) * dist * (minor / major);
    const br = major * (0.18 + r(12 + i * 7) * 0.18);
    const ba = r(13 + i * 7) * Math.PI;
    blobs.push({ x: cx + lx * cos - lz * sin, z: cz + lx * sin + lz * cos, rx: br, rz: br * (0.62 + r(14 + i * 7) * 0.36), cos: Math.cos(ba), sin: Math.sin(ba), salt: i * 131 + 17 });
  }
  const reg = { cx, cz, major, minor, cos, sin, blobs, seed: Math.floor(r(99) * 1e9) };
  return regionCache.set(k, reg);
}

function inEnvelope(reg, x, z) {
  const dx = x + 0.5 - reg.cx;
  const dz = z + 0.5 - reg.cz;
  const lx = dx * reg.cos + dz * reg.sin;
  const lz = -dx * reg.sin + dz * reg.cos;
  return (lx * lx) / (reg.major * reg.major) + (lz * lz) / (reg.minor * reg.minor) <= 1;
}
function inBlobs(reg, x, z) {
  if (!inEnvelope(reg, x, z)) return false;
  for (const b of reg.blobs) {
    const dx = x + 0.5 - b.x;
    const dz = z + 0.5 - b.z;
    const lx = dx * b.cos + dz * b.sin;
    const lz = -dx * b.sin + dz * b.cos;
    const e = (lx * lx) / (b.rx * b.rx) + (lz * lz) / (b.rz * b.rz);
    if (e <= 1 + (rnd(x, b.salt, z, reg.seed) - 0.5) * 0.22) return true;
  }
  return false;
}

/** "core", "fringe" (só veias) ou null, e a região. */
function sculkRegionAt(x, z) {
  const cellX = Math.floor(x / 512);
  const cellZ = Math.floor(z / 512);
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const reg = sculkRegion(cellX + i, cellZ + j);
      if (Math.abs(x - reg.cx) > reg.major + 3 || Math.abs(z - reg.cz) > reg.major + 3) continue;
      if (inBlobs(reg, x, z)) return { kind: "core", reg };
      if (inEnvelope(reg, x, z) && (inBlobs(reg, x + 1, z) || inBlobs(reg, x - 1, z) || inBlobs(reg, x, z + 1) || inBlobs(reg, x, z - 1) ||
        inBlobs(reg, x + 2, z) || inBlobs(reg, x - 2, z) || inBlobs(reg, x, z + 2) || inBlobs(reg, x, z - 2))) return { kind: "fringe", reg };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// A superfície (as regras de superfície do mod)
// ---------------------------------------------------------------------------
function surfaceParams(x, z, biome) {
  const canyonRaw = n2("canyon", x, z, 1.0);
  const paths = Math.abs(n2("paths", x, z, 1.0));
  const inPathZone = canyonRaw >= -0.72 && canyonRaw <= 0.72;
  const dryRegion = n2("dryRegions", x, z, 1.0) >= 0.18;
  const blobs = n2("blobs", x, z, 1.0);
  const sd = Math.trunc(n2("surface", x, z, 1.0) * 2.75 + 3 + hash2(x * 3 + 11, z * 7 - 5) * 0.25);
  const sec = n2("surface2", x, z, 1.0);
  const secR = (r) => Math.trunc(((sec + 1) / 2) * r);
  return { biome, paths, inPathZone, dryRegion, blobs, sd, secR, wastes: biome === "sift_wastes" };
}

/** O bloco na profundidade d (1 = topo) da camada de cima. null = siftslate. */
function surfaceBlock(p, d) {
  const sculk = () => (p.wastes || p.dryRegion ? B.dry : B.healthy);
  if (p.inPathZone) {
    if (p.paths <= 0.009 && d <= 5 + p.sd + p.secR(2)) return sculk();
    if (p.paths <= 0.02 && d <= 3 + p.sd + p.secR(2)) return sculk();
    if (p.paths <= 0.036 && d <= 1 + p.sd + p.secR(1)) return p.wastes ? B.healthy : p.dryRegion ? B.dry : B.healthy;
  }
  if (HIGHLANDS.has(p.biome)) {
    if (d <= 1 && (p.biome === "overgrown_slopes" || p.biome === "overgrown_forest_slopes" || p.biome === "overgrown_peaks" || p.biome === "ichor_snowy_peaks")) return B.growth;
    return null;
  }
  if (p.blobs >= 0.78 && d <= 5 + p.sd + p.secR(3)) return p.dryRegion ? B.dry : B.healthy;
  if (p.blobs >= 0.66 && d <= 2 + p.sd + p.secR(2)) return p.dryRegion ? B.dry : B.healthy;
  if (d <= 1 && GROWTH_TOP.has(p.biome)) return B.growth;
  return null;
}

/** Só o bloco do topo natural (usado pelos arcos pra escolher a rocha). */
function surfaceBlockNatural(x, z) {
  const top = naturalTop(x, z);
  const f = lattice(Math.floor(x / 4) * 4, Math.floor(z / 4) * 4);
  return surfaceBlock(surfaceParams(x, z, pickBiome(f, top)), 1) ?? B.slate;
}

// ---------------------------------------------------------------------------
// Cavernas
//
// Túneis de "espaguete": onde duas superfícies de ruído 3D se cruzam, abre um
// tubo. O ruído é lido numa grade de 4 blocos e interpolado (barato), e a
// largura varia com um terceiro ruído. Perto do chão os túneis afinam; alguns
// chegam a furar a superfície, como as entradas de caverna do mod.
// ---------------------------------------------------------------------------
// A grade de ruído das cavernas de um chunk inteiro, calculada de uma vez
// (5 x 47 x 5 pontos, a cada 4 blocos, de y 0 a 184).
const CAVE_NY = 47;
const caveGridCache = cache(512);
function caveGrid(cx, cz) {
  const k = cx + "," + cz;
  let g = caveGridCache.get(k);
  if (g) return g;
  g = new Float32Array(5 * 5 * CAVE_NY * 3);
  const A = SEEDS.caveA;
  const Bs = SEEDS.caveB;
  const Ws = SEEDS.caveW;
  let i = 0;
  for (let ix = 0; ix < 5; ix++) {
    const x = cx * 16 + ix * 4;
    for (let iz = 0; iz < 5; iz++) {
      const z = cz * 16 + iz * 4;
      for (let iy = 0; iy < CAVE_NY; iy++) {
        const y = iy * 4;
        g[i++] = valueNoise3D((x + A.x) / 26, (y + A.y) / 15, (z + A.z) / 26);
        g[i++] = valueNoise3D((x + Bs.x) / 26, (y + Bs.y) / 15, (z + Bs.z) / 26);
        g[i++] = valueNoise3D((x + Ws.x) / 64, (y + Ws.y) / 32, (z + Ws.z) / 64);
      }
    }
  }
  return caveGridCache.set(k, g);
}

/** Túneis de "espaguete": função y -> [a, b, largura] da coluna (x, z). */
const CAVE_AMOUNT = [[0, 0.83], [32, 0.83], [52, 0.6], [84, 0.36], [112, 0.14], [150, 0.04], [181, 0]];
function caveAmount(y) {
  for (let i = 1; i < CAVE_AMOUNT.length; i++) {
    const [y1, v1] = CAVE_AMOUNT[i];
    if (y <= y1) {
      const [y0, v0] = CAVE_AMOUNT[i - 1];
      return v0 + (v1 - v0) * (y - y0) / (y1 - y0);
    }
  }
  return 0;
}

function caveColumn(x, z) {
  const cx = Math.floor(x / 16);
  const cz = Math.floor(z / 16);
  const g = caveGrid(cx, cz);
  const lx = x - cx * 16;
  const lz = z - cz * 16;
  const ix = lx >> 2;
  const iz = lz >> 2;
  const tx = (lx & 3) / 4;
  const tz = (lz & 3) / 4;
  const base = (i, j) => ((ix + i) * 5 + (iz + j)) * CAVE_NY * 3;
  const b00 = base(0, 0);
  const b10 = base(1, 0);
  const b01 = base(0, 1);
  const b11 = base(1, 1);
  const w00 = (1 - tx) * (1 - tz);
  const w10 = tx * (1 - tz);
  const w01 = (1 - tx) * tz;
  const w11 = tx * tz;
  const out = [0, 0, 0];
  return (y) => {
    const iy = Math.min(CAVE_NY - 2, y >> 2);
    const ty = (y - iy * 4) / 4;
    for (let c = 0; c < 3; c++) {
      const o0 = iy * 3 + c;
      const o1 = o0 + 3;
      const lo = g[b00 + o0] * w00 + g[b10 + o0] * w10 + g[b01 + o0] * w01 + g[b11 + o0] * w11;
      const hi = g[b00 + o1] * w00 + g[b10 + o1] * w10 + g[b01 + o1] * w01 + g[b11 + o1] * w11;
      out[c] = lo + (hi - lo) * ty;
    }
    return out;
  };
}

// ---------------------------------------------------------------------------
// Minérios e bolhas de sculk (quantidades por chunk do mod)
// ---------------------------------------------------------------------------
const ORES = [
  { id: B.coal, count: 20, size: 17, y: [0, 127], below: 10 },
  { id: B.coal, count: 10, size: 3, surface: true },
  { id: B.diamond, count: 2, size: 9, y: [0, 31] },
  { id: B.emerald, count: 10, size: 9, y: [0, 63], below: 12 },
  { id: B.charoite, count: 1, size: 7, y: [0, 32], trapezoid: true },
  { id: B.siftite, count: 1, size: 8, y: [0, 15] },
  { id: B.healthy, count: 2, size: 52, y: [8, 118], trapezoid: true, blob: true },
  { id: B.dry, count: 1, size: 45, y: [8, 118], trapezoid: true, blob: true },
];

const oreCache = cache(3000);
function veinsOf(cx, cz) {
  const k = cx + "," + cz;
  const hit = oreCache.get(k);
  if (hit !== undefined) return hit;
  const out = [];
  let s = 0x900;
  for (const o of ORES) {
    for (let i = 0; i < o.count; i++, s += 8) {
      const r = (q) => cellRand(cx, cz, s + q);
      const x = cx * 16 + Math.floor(r(0) * 16);
      const z = cz * 16 + Math.floor(r(1) * 16);
      let y;
      const top = naturalTop(x, z);
      if (o.surface) y = top - 1;
      else if (o.trapezoid) y = Math.floor(lerp(o.y[0], o.y[1], (r(2) + r(3)) / 2));
      else y = Math.floor(lerp(o.y[0], o.y[1] + 1, r(2)));
      if (o.below && y > top - o.below) continue;
      const g = o.size / 8;
      const f = r(4) * Math.PI;
      const hMax = (r(5) * o.size) / 16;
      out.push({
        id: o.id, x0: x + Math.sin(f) * g, x1: x - Math.sin(f) * g, z0: z + Math.cos(f) * g, z1: z - Math.cos(f) * g,
        y0: y + Math.floor(r(6) * 3) - 2, y1: y + Math.floor(r(7) * 3) - 2,
        rad: (2 * hMax + 1) / 2, blob: !!o.blob,
      });
    }
  }
  return oreCache.set(k, out);
}

/** Minério na posição, ou null (só troca siftslate, como no mod). */
function oreAtFactory(x, z) {
  const cx0 = Math.floor(x / 16);
  const cz0 = Math.floor(z / 16);
  const near = [];
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      for (const v of veinsOf(cx0 + i, cz0 + j)) {
        const reach = v.rad + 1;
        if (x < Math.min(v.x0, v.x1) - reach || x > Math.max(v.x0, v.x1) + reach) continue;
        if (z < Math.min(v.z0, v.z1) - reach || z > Math.max(v.z0, v.z1) + reach) continue;
        near.push(v);
      }
    }
  }
  if (!near.length) return null;
  return (y) => {
    for (const v of near) {
      if (y < Math.min(v.y0, v.y1) - v.rad - 1 || y > Math.max(v.y0, v.y1) + v.rad + 1) continue;
      // distância ao segmento do veio; o raio incha no meio (sin), como o OreFeature
      const px = x + 0.5 - v.x0;
      const py = y + 0.5 - v.y0;
      const pz = z + 0.5 - v.z0;
      const ux = v.x1 - v.x0;
      const uy = v.y1 - v.y0;
      const uz = v.z1 - v.z0;
      const L = ux * ux + uy * uy + uz * uz || 1;
      const t = clamp((px * ux + py * uy + pz * uz) / L, 0, 1);
      const dx = px - ux * t;
      const dy = py - uy * t;
      const dz = pz - uz * t;
      const rr = (((Math.sin(Math.PI * t) + 1) * (v.rad - 0.5) + 1) / 2) * 1.08;
      if (dx * dx + dy * dy + dz * dz < rr * rr) return v.id;
    }
    return null;
  };
}

// ---------------------------------------------------------------------------
// Plantas: densidades medidas no mod, por tipo de chão e bioma
// ---------------------------------------------------------------------------
const PLANTS = {
  wastes: {
    [B.slate]: [[B.stalks, 0.175]],
    [B.healthy]: [[B.sprouts, 0.103], [B.stalks, 0.032], [B.torch, 0.009]],
    [B.dry]: [[B.drySprouts, 0.043], [B.stalks, 0.013], [B.torch, 0.009]],
    [B.growth]: [[B.fronds, 0.124], [B.chard, 0.062], [B.ostalks, 0.058], [B.stalks, 0.033]],
  },
  overgrown: {
    [B.slate]: [[B.stalks, 0.044], [B.fronds, 0.018], [B.chard, 0.009]],
    [B.healthy]: [[B.sprouts, 0.143]],
    [B.dry]: [[B.drySprouts, 0.157], [B.fronds, 0.017], [B.chard, 0.007]],
    [B.dryGrowth]: [[B.drySprouts, 0.08], [B.fronds, 0.06], [B.ostalks, 0.05]],
    [B.growth]: [[B.fronds, 0.355], [B.chard, 0.119], [B.ostalks, 0.05]],
  },
  forest: {
    [B.slate]: [[B.stalks, 0.071], [B.fronds, 0.038]],
    [B.healthy]: [[B.sprouts, 0.126], [B.chard, 0.01]],
    [B.dry]: [[B.drySprouts, 0.15]],
    [B.dryGrowth]: [[B.drySprouts, 0.08], [B.fronds, 0.06], [B.ostalks, 0.05]],
    [B.growth]: [[B.fronds, 0.215], [B.chard, 0.178], [B.ostalks, 0.076]],
  },
  highland: {
    [B.slate]: [[B.stalks, 0.12]],
    [B.healthy]: [[B.sprouts, 0.1]],
    [B.dry]: [[B.drySprouts, 0.05]],
    [B.growth]: [[B.fronds, 0.2], [B.chard, 0.1], [B.ostalks, 0.05]],
  },
};
const FLOWERS = [B.lotus, B.sunburst, B.whisper];

function plantGroup(biome) {
  if (biome === "overgrown_forest" || biome === "overgrown_forest_slopes" || biome === "overgrown_peaks") return "forest";
  if (OVERGROWN.has(biome)) return "overgrown";
  if (biome === "sift_wastes") return "wastes";
  return "highland";
}

/** Planta (e estados) em cima do chão `floor` na coluna, ou null. */
function plantFor(x, y, z, floor, biome) {
  const table = PLANTS[plantGroup(biome)]?.[floor];
  // as plantas do mod vêm em moitas: um ruído de moita concentra a chance
  const clump = 0.5 + sstep(0.3, 0.7, valueNoise((x + 311) / 5, (z - 173) / 5));
  const roll = rnd(x, y, z, 0xa11) / Math.max(0.05, clump);
  if (table) {
    let acc = 0;
    for (const [id, p] of table) {
      acc += p;
      if (roll < acc) return { id };
    }
  }
  // canteiros de flores (sift_flower_patch: 1 a cada 9 chunks, 3-4 flores de uma espécie)
  const cx = Math.floor(x / 16);
  const cz = Math.floor(z / 16);
  const fr = cellRand(cx, cz, 0xf10);
  if (fr < (biome === "sift_wastes" ? 1 / 7 : 1 / 9) && Math.abs(x - (cx * 16 + 8)) <= 3 && Math.abs(z - (cz * 16 + 8)) <= 3 &&
    (floor === B.slate || floor === B.growth || floor === B.dry || floor === B.healthy) && rnd(x, y, z, 0xf11) < 0.09) {
    const sel = Math.floor(cellRand(cx, cz, 0xf12) * (OVERGROWN.has(biome) ? 6 : 24));
    if (sel < 3) return { id: B.wild, states: { growth: Math.floor(rnd(x, y, z, 0xf13) * 4), "minecraft:cardinal_direction": ["north", "east", "south", "west"][Math.floor(rnd(x, y, z, 0xf14) * 4)] } };
    return { id: FLOWERS[sel % 3] };
  }
  // plantas do farejador (1 a cada 14 chunks, em sculk e crescimento)
  if (cellRand(cx, cz, 0xf20) < 1 / 14 && Math.abs(x - (cx * 16 + 8)) <= 6 && Math.abs(z - (cz * 16 + 8)) <= 6 &&
    (floor === B.healthy || floor === B.dry || floor === B.growth) && rnd(x, y, z, 0xf21) < 0.05) {
    return cellRand(cx, cz, 0xf22) < 0.58 ? { id: B.torch } : { id: B.pitcher, tall: true };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Salgueiros e portais abandonados (moldes originais do mod)
// ---------------------------------------------------------------------------
const WILLOW = {
  big: { name: "overgrown_willow_big_01", size: [12, 14, 14], trunk: [7, 6] },
  small: { name: "overgrown_willow_small_01", size: [10, 10, 10], trunk: [3, 6] },
};
const PORTAL_SIZE = [9, 19, 40];
const PORTAL_PIVOT = [4, 19];
const ROTATIONS = ["None", "Rotate90", "Rotate180", "Rotate270"];

/** Canto de colocação e o ponto (px, pz) do molde que deve cair em (x, z), para cada rotação. */
function rotatedCorner(x, z, size, px, pz, rot) {
  const sx = size[0];
  const sz = size[2];
  // posição do pivô depois de girar o molde dentro da própria caixa (horário, visto de cima)
  let rx = px;
  let rz = pz;
  if (rot === 1) { rx = sz - 1 - pz; rz = px; }
  else if (rot === 2) { rx = sx - 1 - px; rz = sz - 1 - pz; }
  else if (rot === 3) { rx = pz; rz = sx - 1 - px; }
  return { x: x - rx, z: z - rz };
}

const isTreeGround = (id) => id === B.growth || id === B.healthy || id === B.dry || id === B.dryGrowth || id === B.slate;

const extraCache = cache(3000);
/**
 * O que o chunk (cx, cz) recebe depois dos blocos: árvores e portais
 * abandonados (estruturas) e criaturas da geração (Farejador Sombrio nas
 * regiões de sculk).
 */
export function chunkExtras(cx, cz) {
  const k = cx + "," + cz;
  const hit = extraCache.get(k);
  if (hit !== undefined) return hit;
  const structures = [];
  const entities = [];
  // salgueiros: denso = 5 tentativas por chunk; esparso = 1 a cada 7 chunks
  const trunks = [];
  for (let i = 0; i < 5; i++) {
    const x = cx * 16 + 4 + Math.floor(cellRand(cx, cz, 0xb00 + i) * 8);
    const z = cz * 16 + 4 + Math.floor(cellRand(cx, cz, 0xb10 + i) * 8);
    const col = columnAt(x, z);
    const biome = col.biome.id;
    const dense = biome === "overgrown_forest" || biome === "overgrown_forest_slopes" || biome === "overgrown_peaks";
    const sparse = biome === "overgrown_clearing" || biome === "overgrown_slopes" || biome === "ichor_snowy_peaks";
    if (!dense && !(sparse && i === 0 && cellRand(cx, cz, 0xb20) < 1 / 14)) continue;
    if (!isTreeGround(col.surface) || col.liquid || col.structureBlocked || nearPortal(x, z, 12)) continue;
    if (trunks.some((t) => Math.abs(t[0] - x) <= 5 && Math.abs(t[1] - z) <= 5)) continue;
    trunks.push([x, z]);
    const w = cellRand(cx, cz, 0xb30 + i) < 0.38 ? WILLOW.big : WILLOW.small;
    const rot = Math.floor(cellRand(cx, cz, 0xb40 + i) * 4);
    const c = rotatedCorner(x, z, w.size, w.trunk[0], w.trunk[1], rot);
    structures.push({ name: "the_sift:" + w.name, x: c.x, y: col.top + 1, z: c.z, rotation: ROTATIONS[rot] });
  }
  // portal abandonado: um candidato por célula de 32 x 32 chunks
  const cellX = Math.floor(cx / 32);
  const cellZ = Math.floor(cz / 32);
  const pcx = cellX * 32 + Math.floor(cellRand(cellX, cellZ, 0xc01) * 32);
  const pcz = cellZ * 32 + Math.floor(cellRand(cellX, cellZ, 0xc02) * 32);
  if (pcx === cx && pcz === cz) {
    const x = cx * 16 + 8;
    const z = cz * 16 + 8;
    const col = columnAt(x, z);
    const rot = Math.floor(cellRand(cellX, cellZ, 0xc03) * 4);
    let mn = Infinity;
    let mx = -Infinity;
    for (let lat = -4; lat <= 4; lat += 4) {
      for (let lw = -16; lw <= 16; lw += 8) {
        const h = heightAt(x + (rot % 2 ? lw : lat), z + (rot % 2 ? lat : lw));
        mn = Math.min(mn, h);
        mx = Math.max(mx, h);
      }
    }
    if (isTerrain(col.surface) && !col.liquid && mx - mn <= 20 && !nearPortal(x, z, 28)) {
      const over = col.biome.id.startsWith("overgrown_") || col.biome.id === "ichor_snowy_peaks";
      const name = (over ? "abandoned_portal_overgrown_" : "abandoned_portal_wastes_") + (1 + Math.floor(cellRand(cellX, cellZ, 0xc04) * 5));
      const c = rotatedCorner(x, z, PORTAL_SIZE, PORTAL_PIVOT[0], PORTAL_PIVOT[1], rot);
      structures.push({ name: "the_sift:" + name, x: c.x, y: col.top, z: c.z, rotation: ROTATIONS[rot] });
    }
  }
  // Farejador Sombrio: no meio de uma região de sculk (1 ou 2 por região)
  const cellRX = Math.floor((cx * 16 + 8) / 512);
  const cellRZ = Math.floor((cz * 16 + 8) / 512);
  const reg = sculkRegion(cellRX, cellRZ);
  reg.blobs.forEach((b, i) => {
    if (i > 1) return;
    if (Math.floor(b.x / 16) === cx && Math.floor(b.z / 16) === cz) {
      const bx = Math.floor(b.x);
      const bz = Math.floor(b.z);
      const col = columnAt(bx, bz);
      if (col.sculkCore) entities.push({ id: "the_sift:dark_sniffer", x: bx + 0.5, y: col.top + 1, z: bz + 0.5 });
    }
  });
  return extraCache.set(k, { structures, entities });
}

// ---------------------------------------------------------------------------
// A coluna
// ---------------------------------------------------------------------------
const colCache = cache(4096);

/**
 * Tudo sobre (x, z): os trechos { y0, y1, id, states? } de baixo pra cima, o
 * topo (onde se pisa), o bioma e o bloco da superfície.
 */
export function columnAt(x, z) {
  const key = x + "," + z;
  const hit = colCache.get(key);
  if (hit) return hit;

  const rel = relief(x, z);
  let top = zoneTop(x, z, naturalTop(x, z));
  const natural = top;
  const biomeId = pickBiome(rel.f, top);
  const sp = surfaceParams(x, z, biomeId);

  // coluna bloco a bloco (índice = y); depois vira trechos
  const col = new Array(256).fill(null);
  const states = {};

  // fundo: bedrock em y 0 e, de 1 a 4, cada vez mais rara
  col[0] = B.bedrock;
  for (let y = 1; y <= 4; y++) col[y] = hash2(x * 31 + y, z * 17 - y) < 1 - y / 5 ? B.bedrock : B.slate;
  for (let y = 5; y <= top; y++) col[y] = B.slate;

  // superfície
  for (let d = 1; d <= 24 && top - d + 1 > 4; d++) {
    const y = top - d + 1;
    const b = surfaceBlock(sp, d);
    if (b) col[y] = b;
  }

  // minérios e bolhas de sculk (só na siftslate)
  const oreAt = oreAtFactory(x, z);
  if (oreAt) {
    for (let y = 1; y <= top; y++) {
      if (col[y] !== B.slate) continue;
      const o = oreAt(y);
      if (o) col[y] = o;
    }
  }

  // cavernas
  const cave = caveColumn(x, z);
  const deepDark = rel.f.cont >= 0.88;
  for (let y = 6; y <= Math.min(top, 180); y++) {
    const [a, b, w] = cave(y);
    // quanto de caverna em cada altura: calibrado pelo mod (5% de ar até
    // y 36, 2,8% até 68, 1,4% até 100, quase nada acima)
    const width = (0.035 + 0.05 * w) * caveAmount(y);
    const depth = top - y;
    let limit = width;
    if (depth < 6) limit *= depth / 6 - 0.15; // perto do chão o túnel afina (e às vezes fura)
    if (limit > 0 && Math.abs(a - 0.5) < limit && Math.abs(b - 0.5) < limit * 1.4) {
      if (col[y] === B.dry || col[y] === B.dryGrowth) continue; // o sculk seco não é escavável no mod
      col[y] = y <= 11 ? B.lava : null;
    }
  }

  // lagos de ichor
  let liquid = false;
  const lake = lakeAt(x, z);
  if (lake && top > 8) {
    const L = lake.L;
    if (lake.layer === 0) {
      const strength = 1 - clamp(lake.t, 0, 1);
      const depth = clamp(1 + Math.floor(strength * (L.depth - 0.55) + rnd(x, L.level, z, L.salt) * 0.7), 1, L.depth);
      const floor = L.level - depth;
      for (let y = floor + 1; y <= Math.max(top, L.level) + 2; y++) col[y] = y <= L.level ? B.ichor : null;
      col[floor] = L.basin;
      col[floor - 1] = L.basin;
      top = floor;
      liquid = true;
    } else {
      const o = clamp((lake.layer - 1) / Math.max(1, L.beach - 1), 0, 1);
      const target = lake.layer <= 1 ? L.level : Math.floor(lerp(L.level, top, o * o * (3 - 2 * o)) + 0.5);
      for (let y = Math.min(top, target) - 2; y < target; y++) col[y] = y >= target - 2 ? L.basin : B.slate;
      for (let y = target + 1; y <= top + 3; y++) col[y] = null;
      col[target] = L.shore === B.growth && col[target - 1] === B.dry ? B.dryGrowth : L.shore;
      top = target;
    }
  }

  // cânion das almas
  const soul = soulAt(x, z);
  if (soul && !liquid) {
    for (let y = soul.floor + 1; y <= top + 2; y++) col[y] = null;
    if (soul.soul) col[soul.floor] = B.soul;
    top = soul.floor;
  }

  // monólitos e espinhos
  const pil = pillarBlocks(x, z, top);
  let capGrowth = false;
  for (const b of pil.blocks) {
    if (b.y < 1 || b.y > 254) continue;
    const cur = col[b.y];
    if (cur === null || isTerrain(cur) || cur === B.coal) col[b.y] = b.id;
    if (b.cap && b.id === B.growth) capGrowth = true;
  }
  if (pil.raise > top) top = pil.raise;

  // arcos
  for (const s of archSpans(x, z)) {
    for (let y = s.y0; y <= s.y1; y++) {
      if (col[y] === null || isTerrain(col[y])) col[y] = s.top && s.growthTop && s.id === B.slate ? B.growth : s.id;
      if (y > top) top = y;
    }
  }
  void capGrowth;

  // regiões de sculk: a superfície vira sculk, com sensores e gritadores
  let sculkCore = false;
  const region = !liquid ? sculkRegionAt(x, z) : null;
  let deco = null;
  if (region && isTerrain(col[top])) {
    if (region.kind === "core") {
      sculkCore = true;
      const depth = 6 + (Math.floor(rnd(x, 7, z, region.reg.seed) * 4));
      for (let d = 0; d < depth && isTerrain(col[top - d]); d++) col[top - d] = B.sculk;
      const roll = rnd(x, 3, z, region.reg.seed ^ 0x444f);
      if (roll < 0.0015) deco = { id: B.catalyst };
      else if (roll < 0.0055) deco = { id: B.shrieker, states: STATES.shrieker };
      else if (roll < 0.021) deco = { id: B.sensor };
      else if (roll < 0.115 && (!inBlobs(region.reg, x + 1, z) || !inBlobs(region.reg, x - 1, z) || !inBlobs(region.reg, x, z + 1) || !inBlobs(region.reg, x, z - 1))) deco = { id: B.vein, states: STATES.vein };
    } else {
      deco = { id: B.vein, states: STATES.vein };
    }
  }

  // o que vai em cima do chão: neve de ichor nos picos nevados, ou uma planta
  const surface = col[top];
  if (!deco && !liquid && top < 250) {
    if (biomeId === "ichor_snowy_peaks" && (isTerrain(surface) || surface === B.sculk)) {
      const field = valueNoise((x + SEEDS.terrace.x) / 26, (z + SEEDS.terrace.z) / 26);
      const detail = valueNoise((x - SEEDS.terrace.z) / 9, (z + SEEDS.terrace.x) / 9);
      deco = { id: B.snow, states: { "the_sift:layers": field + detail * 0.35 > 0.88 ? 2 : 1 } };
    } else if (lake && lake.layer > 0) {
      deco = shorePlant(x, top, z, surface, lake);
    } else {
      const p = plantFor(x, top + 1, z, surface, biomeId);
      if (p) deco = p;
    }
  }
  if (deco) {
    col[top + 1] = deco.id;
    if (deco.states) states[top + 1] = deco.states;
    if (deco.tall) {
      col[top + 1] = B.pitcher;
      states[top + 1] = STATES.pitcherLow;
      col[top + 2] = B.pitcher;
      states[top + 2] = STATES.pitcherHigh;
    }
  }

  // debaixo da terra: raízes no teto das cavernas, sculk no escuro profundo
  const overgrown = OVERGROWN.has(biomeId);
  for (let y = 8; y < top - 5; y++) {
    if (col[y] !== null) continue;
    const above = col[y + 1];
    const below = col[y - 1];
    if (above && isTerrain(above) && rnd(x, y, z, 0xc0a) < (overgrown ? 0.02 : 0.008)) {
      col[y] = overgrown && rnd(x, y, z, 0xc0b) < 0.4 ? B.overRoots : B.slateRoots;
    } else if (below && isTerrain(below)) {
      if (deepDark && y <= 46) {
        if (valueNoise(x / 7, z / 7) > 0.45) col[y - 1] = B.sculk;
        const r = rnd(x, y, z, 0xc0c);
        if (r < 0.04) {
          col[y] = B.vein;
          states[y] = STATES.vein;
        } else if (r < 0.047) col[y] = B.sensor;
      } else if (rnd(x, y, z, 0xc0d) < 0.012) {
        col[y] = below === B.healthy ? B.sprouts : below === B.dry ? B.drySprouts : B.stalks;
      }
    }
  }

  // trechos
  const runs = [];
  let cur = null;
  for (let y = 0; y < 256; y++) {
    const id = col[y];
    const st = states[y];
    if (!id) {
      cur = null;
      continue;
    }
    if (cur && cur.id === id && !st && !cur.states && cur.y1 === y - 1) {
      cur.y1 = y;
      continue;
    }
    cur = { y0: y, y1: y, id };
    if (st) cur.states = st;
    runs.push(cur);
  }

  const biome = BIOMES[biomeId];
  return colCache.set(key, { runs, top, natural, biome, surface, liquid, sculkCore, structureBlocked: !!soul || pil.blocks.length > 0 });
}

function shorePlant(x, y, z, floor, lake) {
  const L = lake.L;
  // canteiros de flores do oásis (mesma espécie por lago), perto da água
  if (lake.layer <= 3 && valueNoise((x + L.salt % 1000) / 3, (z - L.salt % 777) / 3) > 0.72 && (floor !== B.slate || rnd(x, y, z, 0xd01) < 0.5)) {
    if (L.flower === 4) return { id: B.pitcher, tall: true };
    if (L.flower === 5) return { id: B.wild, states: { growth: Math.floor(rnd(x, y, z, 0xd02) * 4), "minecraft:cardinal_direction": "north" } };
    return { id: [B.lotus, B.sunburst, B.whisper, B.torch][L.flower] };
  }
  const growth = floor === B.growth || floor === B.dryGrowth;
  const chance = growth ? 0.68 : floor === B.healthy ? 0.6 : floor === B.dry ? 0.5 : floor === B.slate ? 0.45 : 0;
  if (rnd(x, y, z, 0xd03) >= chance) return null;
  const roll = rnd(x, y, z, 0xd04);
  if (growth) return { id: roll < 0.38 ? B.fronds : roll < 0.72 ? B.ostalks : B.chard };
  if (floor === B.slate) return { id: roll < 0.82 ? B.stalks : B.sprouts };
  if (floor === B.healthy) return { id: roll < 0.82 ? B.sprouts : B.stalks };
  if (floor === B.dry) return { id: B.drySprouts };
  return null;
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------
/** y do bloco do topo (o chão onde se pisa). */
export function heightAt(x, z) {
  return columnAt(x, z).top;
}

/** Altura "natural", sem a zona do portal (usada pra escolher onde ele fica). */
export function naturalHeightAt(x, z) {
  return { h: naturalTop(x, z), lake: !!lakeAt(x, z) };
}

/** Bioma "visível" para o jogador: subsolo fundo vira escuro profundo. */
export function biomeForPlayer(x, y, z) {
  const t = columnAt(x, z);
  const f = lattice(Math.floor(x / 4) * 4, Math.floor(z / 4) * 4);
  if (f.cont >= 0.88 && y <= 46 && y < t.top - 8) return BIOMES.sift_deep_dark;
  if (y < t.top - 18 && y < 48) return { id: t.biome.id, fog: BIOMES.sift_deep_dark.fog };
  return t.biome;
}
