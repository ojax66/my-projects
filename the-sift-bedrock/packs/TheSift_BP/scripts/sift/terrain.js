/* =========================================================================
 * O terreno do Sift, como função pura de (x, z).
 *
 * O mod original usa o gerador de ruído do Java (noise_settings + density
 * functions + features). O Bedrock não deixa dimensão custom ter gerador
 * próprio — ela nasce vazia —, então o relevo é recriado aqui e escrito pelo
 * world_generator_API, coluna por coluna.
 *
 * O que se tentou manter do original:
 *   - altura de 0 a 256, fundo de siftslate reforçado;
 *   - os biomes (ermos, clareira, floresta, encostas, picos, picos nevados de
 *     ichor, e o "escuro profundo" nas cavernas grandes);
 *   - superfície de siftslate coberto nos ermos e sculk saudável nas áreas
 *     tomadas, com manchas de sculk seco;
 *   - lagos de ichor, minérios nas faixas de altura do mod, cavernas.
 *
 * Tudo aqui é determinístico: a mesma (x, z) sempre dá a mesma coluna, então
 * a altura pode ser consultada sem escrever bloco nenhum (pouso, spawn).
 * ========================================================================= */

import { fbm, hash2, hash3, valueNoise, valueNoise3D } from "../lib/world_generator_API.js";

let SEED_X = 0;
let SEED_Z = 0;

/** A semente muda o relevo inteiro. Chamado uma vez, antes de gerar. */
export function setSeed(seed) {
  const s = Math.abs(Math.floor(seed)) % 1000003;
  SEED_X = (s * 7919) % 200000 - 100000;
  SEED_Z = (s * 104729) % 200000 - 100000;
}

export const BIOMES = {
  sift_wastes: { id: "sift_wastes", fog: "the_sift:fog_sift" },
  overgrown_clearing: { id: "overgrown_clearing", fog: "the_sift:fog_sift_overgrown" },
  overgrown_forest: { id: "overgrown_forest", fog: "the_sift:fog_sift_overgrown" },
  overgrown_slopes: { id: "overgrown_slopes", fog: "the_sift:fog_sift_overgrown" },
  overgrown_forest_slopes: { id: "overgrown_forest_slopes", fog: "the_sift:fog_sift_overgrown" },
  overgrown_peaks: { id: "overgrown_peaks", fog: "the_sift:fog_sift_overgrown" },
  siftslate_slopes: { id: "siftslate_slopes", fog: "the_sift:fog_sift" },
  siftslate_peaks: { id: "siftslate_peaks", fog: "the_sift:fog_sift" },
  ichor_snowy_peaks: { id: "ichor_snowy_peaks", fog: "the_sift:fog_sift_snowy" },
  sift_deep_dark: { id: "sift_deep_dark", fog: "the_sift:fog_sift_deep" },
};

export const ALL_SURFACE_BIOMES = Object.keys(BIOMES).filter((b) => b !== "sift_deep_dark");

const B = {
  floor: "the_sift:reinforced_siftslate",
  slate: "the_sift:siftslate",
  growth: "the_sift:siftslate_growth",
  healthy: "the_sift:healthy_sculk",
  dry: "the_sift:dry_healthy_sculk",
  dryGrowth: "the_sift:dry_healthy_sculk_growth",
  snowBlock: "the_sift:ichor_snow_block",
  ichor: "the_sift:ichor",
  sculk: "minecraft:sculk",
  coal: "the_sift:siftslate_coal_ore",
  diamond: "the_sift:siftslate_diamond_ore",
  emerald: "the_sift:siftslate_emerald_ore",
  charoite: "the_sift:siftslate_charoite_ore",
  siftite: "the_sift:siftslate_siftite_ore",
};

const smoothstep = (a, b, t) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

// ---------------------------------------------------------------------------
// Relevo
// ---------------------------------------------------------------------------
function fields(x, z) {
  const sx = x + SEED_X;
  const sz = z + SEED_Z;
  const cont = fbm(sx, sz, 4, 0.5, 1 / 460);
  const detail = fbm(sx + 1013, sz - 777, 4, 0.5, 1 / 96);
  const ridgeRaw = fbm(sx - 4099, sz + 2503, 4, 0.5, 1 / 280);
  const ridge = 1 - Math.abs(2 * ridgeRaw - 1);
  const humidity = fbm(sx + 9001, sz + 3001, 3, 0.5, 1 / 420);
  const mountain = smoothstep(0.5, 0.7, cont);
  const regional = 60 + (cont - 0.5) * 44;
  const h = regional + (detail - 0.5) * 16 + mountain * ridge * ridge * 118;
  return { sx, sz, cont, detail, ridge, humidity, mountain, regional, h: Math.max(10, Math.min(236, Math.floor(h))) };
}

// ---------------------------------------------------------------------------
// Zona do portal principal: o terreno é aplainado pra estrutura assentar
// ---------------------------------------------------------------------------
let ZONE = null;
const ZONE_MARGIN = 14;

/** origin = canto da estrutura (9 x 40), ground = y da camada 0 dela. */
export function setPortalZone(origin, ground) {
  ZONE = origin ? { x0: origin.x, x1: origin.x + 8, z0: origin.z, z1: origin.z + 39, ground } : null;
  heightCache.clear();
}

function zoneDistance(x, z) {
  if (!ZONE) return Infinity;
  const dx = Math.max(ZONE.x0 - x, 0, x - ZONE.x1);
  const dz = Math.max(ZONE.z0 - z, 0, z - ZONE.z1);
  return Math.sqrt(dx * dx + dz * dz);
}

function applyZone(x, z, h) {
  const d = zoneDistance(x, z);
  if (d === Infinity || d > ZONE_MARGIN) return h;
  if (d === 0) return ZONE.ground - 1;
  const t = smoothstep(0, ZONE_MARGIN, d);
  return Math.round(ZONE.ground + 1 + (h - ZONE.ground - 1) * t);
}

function inZone(x, z) {
  return zoneDistance(x, z) <= ZONE_MARGIN;
}

/** Altura "natural", sem a zona do portal (usada pra escolher onde ele fica). */
export function naturalHeightAt(x, z) {
  const f = fields(x, z);
  const lake = lakeAt(f);
  return { h: lake ? Math.min(f.h, lake.bottom) : f.h, lake: !!lake };
}

function lakeAt(f) {
  if (f.mountain > 0.25) return null;
  if (inZone(f.sx - SEED_X, f.sz - SEED_Z)) return null;
  const n = fbm(f.sx + 311, f.sz + 809, 3, 0.5, 1 / 150);
  if (n < 0.66) return null;
  const level = Math.floor(f.regional) - 1;
  const depth = Math.min(7, Math.floor((n - 0.66) * 70) + 1);
  return { level, bottom: level - depth };
}

function pickBiome(f, h) {
  const temp = fbm(f.sx - 2203, f.sz + 5101, 2, 0.5, 1 / 520);
  const humid = f.humidity > 0.55;
  if (h >= 168) {
    if (temp < 0.47) return BIOMES.ichor_snowy_peaks;
    return humid ? BIOMES.overgrown_peaks : BIOMES.siftslate_peaks;
  }
  if (h >= 112) {
    if (humid) {
      const forest = fbm(f.sx + 71, f.sz - 133, 2, 0.5, 1 / 120);
      return forest > 0.55 ? BIOMES.overgrown_forest_slopes : BIOMES.overgrown_slopes;
    }
    return BIOMES.siftslate_slopes;
  }
  if (humid) {
    const forest = fbm(f.sx + 71, f.sz - 133, 2, 0.5, 1 / 120);
    return forest > 0.5 ? BIOMES.overgrown_forest : BIOMES.overgrown_clearing;
  }
  return BIOMES.sift_wastes;
}

// A inclinação de cada coluna consulta as quatro vizinhas, e o gerador anda
// coluna por coluna: sem cache, cada altura seria calculada cinco vezes.
const heightCache = new Map();

/** Altura final da superfície (o bloco sólido mais alto). Pura, barata. */
export function heightAt(x, z) {
  const k = x * 73856093 ^ z * 19349663;
  const hit = heightCache.get(k);
  if (hit !== undefined && hit.x === x && hit.z === z) return hit.h;
  const f = fields(x, z);
  const lake = lakeAt(f);
  const h = applyZone(x, z, lake ? Math.min(f.h, lake.bottom) : f.h);
  if (heightCache.size > 30000) heightCache.clear();
  heightCache.set(k, { x, z, h });
  return h;
}

/** Tudo o que se sabe da coluna sem escrever nada. */
export function terrainAt(x, z) {
  const f = fields(x, z);
  const lake = lakeAt(f);
  const top = applyZone(x, z, lake ? Math.min(f.h, lake.bottom) : f.h);
  const biome = pickBiome(f, f.h);
  return { top, biome, lake, f, zone: inZone(x, z) };
}

/** Bioma "visível" para o jogador: subsolo fundo vira escuro profundo. */
export function biomeForPlayer(x, y, z) {
  const t = terrainAt(x, z);
  if (y < t.top - 18 && y < 48) return BIOMES.sift_deep_dark;
  return t.biome;
}

// ---------------------------------------------------------------------------
// Cavernas e minérios
// ---------------------------------------------------------------------------
function isCave(sx, y, sz) {
  // "espaguete": o cruzamento de duas superfícies de ruído vira um túnel
  const a = valueNoise3D(sx / 26, y / 16, sz / 26);
  if (Math.abs(a - 0.5) > 0.05) return false;
  const b = valueNoise3D((sx + 517) / 26, (y + 93) / 16, (sz - 311) / 26);
  return Math.abs(b - 0.5) < 0.07;
}

function isCavern(sx, y, sz) {
  if (y > 44 || y < 8) return false;
  const n = valueNoise3D(sx / 44, y / 18, sz / 44);
  return n > 0.74;
}

function oreAt(sx, y, sz, f) {
  // h escolhe o veio (blocos de 2x2x2), r recorta o formato dele
  const h = hash3(Math.floor(sx / 2), Math.floor(y / 2), Math.floor(sz / 2));
  let ore = null;
  if (y <= 24 && h < 0.0022) ore = B.siftite;
  else if (y <= 30 && h > 0.9978) ore = B.diamond;
  else if (y >= 10 && y <= 96 && h > 0.35 && h < 0.355) ore = B.charoite;
  else if (y >= 80 && f.mountain > 0.15 && h > 0.6 && h < 0.604) ore = B.emerald;
  else if (y >= 16 && h > 0.8 && h < 0.8155) ore = B.coal;
  if (!ore) return null;
  return hash3(sx, y, sz) < 0.75 ? ore : null;
}

// ---------------------------------------------------------------------------
// A coluna: lista de trechos {y0, y1, id} de baixo pra cima + decoração
// ---------------------------------------------------------------------------

/**
 * @returns {{runs: {y0:number,y1:number,id:string}[], top:number, biome:any,
 *            deco: {y:number,id:string,states?:object}|null, tree:string|null}}
 */
export function columnAt(x, z) {
  const t = terrainAt(x, z);
  const f = t.f;
  const top = t.top;
  const biome = t.biome;
  const ids = new Array(top + 1);

  // superfície por bioma
  const patch = fbm(f.sx - 91, f.sz + 57, 2, 0.5, 1 / 34);
  const steep = Math.abs(heightAt(x + 1, z) - heightAt(x - 1, z)) + Math.abs(heightAt(x, z + 1) - heightAt(x, z - 1)) > 5;
  let surface = B.growth;
  let under = B.slate;
  let underDepth = 0;
  const overgrown = biome.id.startsWith("overgrown");
  if (t.lake) {
    surface = overgrown ? B.healthy : B.slate;
  } else if (biome === BIOMES.ichor_snowy_peaks) {
    surface = B.snowBlock;
    under = B.snowBlock;
    underDepth = 2;
  } else if (steep) {
    surface = B.slate;
  } else if (overgrown) {
    if (patch > 0.62) {
      surface = B.dryGrowth;
      under = B.dry;
      underDepth = 2;
    } else {
      surface = B.healthy;
      under = B.dry;
      underDepth = 2;
    }
  } else if (biome === BIOMES.siftslate_peaks) {
    surface = B.slate;
  } else if (patch > 0.7) {
    surface = B.dryGrowth;
    under = B.dry;
    underDepth = 1;
  }

  // Cavernas só até y 100 e com o ruído avaliado de 2 em 2 blocos: o grosso
  // do custo da coluna está aqui, e o Bedrock roda o script numa thread só.
  // Uma máscara 2D barata decide se a coluna tem caverna; só aí o ruído 3D
  // (o caro) é avaliado, de 3 em 3 blocos.
  const caveMask = valueNoise(f.sx / 72, f.sz / 72);
  const caveCeil = t.zone || caveMask < 0.42 ? 0 : Math.min(top - 7, 100);
  let caveHere = false;
  for (let y = 0; y <= top; y++) {
    let id;
    if (y === 0) id = B.floor;
    else if (y === top) id = surface;
    else if (y >= top - underDepth) id = under;
    else {
      id = oreAt(f.sx, y, f.sz, f) ?? B.slate;
      if (y > 3 && y < caveCeil) {
        if (y % 3 === 1) caveHere = isCavern(f.sx, y, f.sz) || isCave(f.sx, y, f.sz);
        if (caveHere) id = null;
      }
    }
    ids[y] = id;
  }

  // chão das cavernas grandes vira sculk (o "escuro profundo" do Sift)
  for (let y = 5; y < Math.min(caveCeil, 46); y++) {
    if (ids[y] && ids[y + 1] === null && isCavern(f.sx, y + 2, f.sz)) ids[y] = B.sculk;
  }

  const runs = [];
  let start = 0;
  for (let y = 1; y <= top + 1; y++) {
    if (y > top || ids[y] !== ids[start]) {
      if (ids[start]) runs.push({ y0: start, y1: y - 1, id: ids[start] });
      start = y;
    }
  }

  if (t.lake && t.lake.level > top) {
    runs.push({ y0: top + 1, y1: t.lake.level, id: B.ichor });
  }

  const deco = t.lake || t.zone ? null : decorationAt(x, z, top, biome, surface, f);
  return { runs, top, biome, deco, tree: t.lake || t.zone || steep ? null : treeAt(x, z, biome) };
}

// ---------------------------------------------------------------------------
// Plantas
// ---------------------------------------------------------------------------
function pick(r, table) {
  let acc = 0;
  for (const [p, id] of table) {
    acc += p;
    if (r < acc) return id;
  }
  return null;
}

const DECO = {
  sift_wastes: [[0.05, "the_sift:siftslate_stalks"], [0.015, "the_sift:overgrown_fronds"], [0.003, "the_sift:sunburst_plant"], [0.003, "the_sift:whisperbloom"]],
  siftslate_slopes: [[0.04, "the_sift:siftslate_stalks"], [0.004, "the_sift:whisperbloom"]],
  siftslate_peaks: [[0.02, "the_sift:siftslate_stalks"]],
  overgrown_clearing: [[0.07, "the_sift:overgrown_chard"], [0.07, "the_sift:overgrown_stalks"], [0.09, "the_sift:overgrown_fronds"],
                       [0.04, "the_sift:healthy_sculk_sprouts"], [0.012, "the_sift:overgrown_lotus"], [0.01, "the_sift:sunburst_plant"],
                       [0.01, "the_sift:whisperbloom"], [0.003, "the_sift:sculkflower"]],
  overgrown_forest: [[0.12, "the_sift:overgrown_fronds"], [0.05, "the_sift:overgrown_chard"], [0.05, "the_sift:healthy_sculk_sprouts"],
                     [0.008, "the_sift:overgrown_lotus"], [0.004, "the_sift:whisperbloom"]],
  overgrown_slopes: [[0.06, "the_sift:overgrown_stalks"], [0.05, "the_sift:overgrown_fronds"], [0.02, "the_sift:healthy_sculk_sprouts"]],
  overgrown_forest_slopes: [[0.08, "the_sift:overgrown_fronds"], [0.04, "the_sift:healthy_sculk_sprouts"]],
  overgrown_peaks: [[0.04, "the_sift:overgrown_stalks"], [0.02, "the_sift:healthy_sculk_sprouts"]],
};

function decorationAt(x, z, top, biome, surface, f) {
  if (top + 1 >= 255) return null;
  const r = hash2(x * 3 + SEED_X, z * 5 + SEED_Z);
  if (biome === BIOMES.ichor_snowy_peaks) {
    const layers = 1 + Math.floor(hash2(x - SEED_Z, z + SEED_X) * 4);
    return { y: top + 1, id: "the_sift:ichor_snow", states: { "the_sift:layers": layers } };
  }
  if (surface === B.slate && biome !== BIOMES.siftslate_peaks) return null;
  if (surface === B.dryGrowth) {
    const id = pick(r, [[0.07, "the_sift:dry_healthy_sculk_sprouts"], [0.02, "the_sift:siftslate_stalks"]]);
    return id ? { y: top + 1, id } : null;
  }
  const table = DECO[biome.id];
  if (!table) return null;
  const id = pick(r, table);
  return id ? { y: top + 1, id } : null;
}

// ---------------------------------------------------------------------------
// Árvores e estruturas (posições determinísticas numa grade)
// ---------------------------------------------------------------------------
function cellPoint(cx, cz, size, salt) {
  const jx = Math.floor(hash2(cx * 31 + salt + SEED_X, cz * 17 - salt) * (size - 4)) + 2;
  const jz = Math.floor(hash2(cx * 13 - salt, cz * 29 + salt + SEED_Z) * (size - 4)) + 2;
  return { x: cx * size + jx, z: cz * size + jz, r: hash2(cx + salt * 3, cz - salt * 7 + SEED_X) };
}

function treeAt(x, z, biome) {
  let size;
  let chance;
  if (biome === BIOMES.overgrown_forest) { size = 9; chance = 0.8; }
  else if (biome === BIOMES.overgrown_forest_slopes) { size = 11; chance = 0.6; }
  else if (biome === BIOMES.overgrown_clearing) { size = 22; chance = 0.35; }
  else if (biome === BIOMES.overgrown_slopes) { size = 24; chance = 0.25; }
  else return null;
  const cx = Math.floor(x / size);
  const cz = Math.floor(z / size);
  const p = cellPoint(cx, cz, size, 41);
  if (p.x !== x || p.z !== z || p.r > chance) return null;
  return p.r < chance * 0.45 ? "overgrown_willow_big_01" : "overgrown_willow_small_01";
}

/** Portal abandonado: no máximo um por região de 512x512. */
export function abandonedPortalIn(rx, rz) {
  const p = cellPoint(rx, rz, 512, 977);
  if (p.r > 0.55) return null;
  const t = terrainAt(p.x, p.z);
  if (t.lake || t.top > 150) return null;
  const overgrown = t.biome.id.startsWith("overgrown");
  const variant = 1 + Math.floor(hash2(rx * 7 + SEED_X, rz * 11) * 5);
  return { x: p.x, z: p.z, y: t.top, name: (overgrown ? "abandoned_portal_overgrown_" : "abandoned_portal_wastes_") + variant };
}
