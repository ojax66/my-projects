/* =========================================================================
 * Decoração: as "placed features" do mod, na ordem e nas etapas do Java.
 *
 * Os modificadores de posição (count, in_square, heightmap, rarity_filter,
 * height_range, environment_scan, surface_relative_threshold_filter, biome,
 * offset, block_predicate_filter) e as features vanilla usadas pelo mod
 * (ore, simple_block, lake) são interpretados a partir do JSON do jar. As
 * features próprias do mod estão em sift_features.js.
 * ========================================================================= */

import { BIOMES, PLACED, TAGS } from "./data.js";
import { Rng, hashInts } from "./rng.js";
import { AIR, blockId } from "./palette.js";
import { HEIGHT } from "./chunkgen.js";
import { B, Level, isFluid, isSolid, nameOf } from "./level.js";
import { CUSTOM } from "./sift_features.js";

const short = (id) => id.replace("the_sift:", "").replace("minecraft:", "");

// ---------------------------------------------------------------------------
// Ordem global das features por etapa (como o FeatureSorter do Java)
// ---------------------------------------------------------------------------
const BIOME_LIST = Object.keys(BIOMES).sort();
const STEPS = [];
const BIOME_FEATURES = {};
for (const b of BIOME_LIST) {
  const set = new Set();
  BIOMES[b].features.forEach((list, step) => {
    STEPS[step] ??= [];
    for (const f of list) {
      const n = short(f);
      set.add(n);
      if (!STEPS[step].includes(n)) STEPS[step].push(n);
    }
  });
  BIOME_FEATURES[b] = set;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------
function anchorY(a) {
  if (typeof a === "number") return a;
  if ("absolute" in a) return a.absolute;
  if ("above_bottom" in a) return a.above_bottom;
  return HEIGHT - 1 - a.below_top;
}

function intProvider(rng, p) {
  if (typeof p === "number") return p;
  const t = short(p.type);
  if (t === "constant") return p.value;
  if (t === "uniform") return rng.between(p.min_inclusive, p.max_inclusive);
  if (t === "trapezoid") return rng.trapezoid(p.min, p.max, p.plateau ?? 0);
  if (t === "biased_to_bottom") return p.min_inclusive + rng.nextInt(rng.nextInt(p.max_inclusive - p.min_inclusive + 1) + 1);
  throw new Error("int provider não suportado: " + p.type);
}

function heightProvider(rng, p) {
  const t = short(p.type);
  const lo = anchorY(p.min_inclusive);
  const hi = anchorY(p.max_inclusive);
  if (t === "uniform") return rng.between(lo, hi);
  if (t === "trapezoid") return rng.trapezoid(lo, hi, p.plateau ?? 0);
  throw new Error("height provider não suportado: " + p.type);
}

// ---------------------------------------------------------------------------
// Predicados de bloco
// ---------------------------------------------------------------------------
const tagCache = new Map();
function tagHas(tag, i) {
  tag = tag.replace("#", "");
  if (tag === "minecraft:air") return i === AIR;
  if (tag === "minecraft:features_cannot_replace" || tag === "minecraft:lava_pool_stone_cannot_replace") {
    return i === B.BEDROCK || i === B.CHEST || i === B.REINFORCED || nameOf(i).includes("willow");
  }
  let set = tagCache.get(tag);
  if (!set) {
    set = new Set((TAGS[tag] ?? []).map(short));
    tagCache.set(tag, set);
  }
  return set.has(nameOf(i));
}

function compilePredicate(p) {
  const t = short(p.type);
  const off = p.offset ?? [0, 0, 0];
  switch (t) {
    case "true":
      return () => true;
    case "matching_blocks": {
      const names = new Set((Array.isArray(p.blocks) ? p.blocks : [p.blocks]).map(short));
      return (lv, x, y, z) => names.has(nameOf(lv.getBlockState(x + off[0], y + off[1], z + off[2])));
    }
    case "matching_block_tag":
      return (lv, x, y, z) => tagHas(p.tag, lv.getBlockState(x + off[0], y + off[1], z + off[2]));
    case "solid":
      return (lv, x, y, z) => isSolid(lv.getBlockState(x + off[0], y + off[1], z + off[2]));
    case "inside_world_bounds":
      return (lv, x, y, z) => y + off[1] >= 0 && y + off[1] < HEIGHT;
    case "all_of": {
      const list = p.predicates.map(compilePredicate);
      return (lv, x, y, z) => list.every((f) => f(lv, x, y, z));
    }
    case "any_of": {
      const list = p.predicates.map(compilePredicate);
      return (lv, x, y, z) => list.some((f) => f(lv, x, y, z));
    }
    case "not": {
      const inner = compilePredicate(p.predicate);
      return (lv, x, y, z) => !inner(lv, x, y, z);
    }
    default:
      throw new Error("predicado não suportado: " + p.type);
  }
}

// ---------------------------------------------------------------------------
// Modificadores de posição
// ---------------------------------------------------------------------------
function compileModifier(m, featureName) {
  const t = short(m.type);
  switch (t) {
    case "count":
      return (ctx, pos, rng, emit) => {
        const n = intProvider(rng, m.count);
        for (let i = 0; i < n; i++) emit(pos);
      };
    case "in_square":
      return (ctx, pos, rng, emit) => emit([pos[0] + rng.nextInt(16), pos[1], pos[2] + rng.nextInt(16)]);
    case "rarity_filter":
      return (ctx, pos, rng, emit) => {
        if (rng.nextFloat() < 1 / m.chance) emit(pos);
      };
    case "heightmap":
      return (ctx, pos, rng, emit) => {
        const y = ctx.level.getHeight(pos[0], pos[2]);
        if (y > 0) emit([pos[0], y, pos[2]]);
      };
    case "height_range":
      return (ctx, pos, rng, emit) => emit([pos[0], heightProvider(rng, m.height), pos[2]]);
    case "surface_relative_threshold_filter": {
      const lo = m.min_inclusive ?? -Infinity;
      const hi = m.max_inclusive ?? Infinity;
      return (ctx, pos, rng, emit) => {
        const h = ctx.level.getHeight(pos[0], pos[2]);
        if (pos[1] >= h + lo && pos[1] <= h + hi) emit(pos);
      };
    }
    case "biome":
      return (ctx, pos, rng, emit) => {
        const b = ctx.level.getBiome(pos[0], pos[1], pos[2]);
        if (BIOME_FEATURES[b]?.has(featureName)) emit(pos);
      };
    case "offset":
      return (ctx, pos, rng, emit) => {
        const dx = intProvider(rng, m.x ?? 0);
        const dy = intProvider(rng, m.y ?? 0);
        const dz = intProvider(rng, m.z ?? 0);
        emit([pos[0] + dx, pos[1] + dy, pos[2] + dz]);
      };
    case "block_predicate_filter": {
      const pred = compilePredicate(m.predicate);
      return (ctx, pos, rng, emit) => {
        if (pred(ctx.level, pos[0], pos[1], pos[2])) emit(pos);
      };
    }
    case "environment_scan": {
      const target = compilePredicate(m.target_condition);
      const allowed = m.allowed_search_condition ? compilePredicate(m.allowed_search_condition) : () => true;
      const dir = m.direction_of_search === "up" ? 1 : -1;
      const steps = m.max_steps;
      return (ctx, pos, rng, emit) => {
        const lv = ctx.level;
        const x = pos[0];
        const z = pos[2];
        let y = pos[1];
        if (!allowed(lv, x, y, z)) return;
        for (let i = 0; i < steps; i++) {
          if (target(lv, x, y, z)) {
            emit([x, y, z]);
            return;
          }
          y += dir;
          if (y < 0 || y >= HEIGHT) return;
          if (!allowed(lv, x, y, z)) break;
        }
        if (target(lv, x, y, z)) emit([x, y, z]);
      };
    }
    default:
      throw new Error("modificador não suportado: " + m.type);
  }
}

// ---------------------------------------------------------------------------
// Features vanilla usadas pelo mod
// ---------------------------------------------------------------------------
function stateOf(s) {
  const st = s.state ?? s;
  const props = { ...(st.Properties ?? st.properties ?? {}) };
  delete props.waterlogged;
  delete props.level;
  return blockId(st.id ?? st.Name, Object.keys(props).length ? props : undefined);
}

function oreFeature(conf) {
  const targets = conf.targets.map((t) => ({ tag: t.target.tag, state: stateOf(t.state) }));
  const size = conf.size;
  const discard = conf.discard_chance_on_air_exposure ?? 0;
  return (lv, rng, x0, y0, z0) => {
    const f = rng.nextFloat() * Math.PI;
    const g = size / 8;
    const i = Math.ceil((size / 16 * 2 + 1) / 2);
    const minX = x0 + Math.sin(f) * g;
    const maxX = x0 - Math.sin(f) * g;
    const minZ = z0 + Math.cos(f) * g;
    const maxZ = z0 - Math.cos(f) * g;
    const minY = y0 + rng.nextInt(3) - 2;
    const maxY = y0 + rng.nextInt(3) - 2;
    const bx = x0 - Math.ceil(g) - i;
    const by = y0 - 2 - i;
    const bz = z0 - Math.ceil(g) - i;
    const w = 2 * (Math.ceil(g) + i);
    const h = 2 * (2 + i);
    let ok = false;
    for (let s = bx; s <= bx + w && !ok; s++) {
      for (let t = bz; t <= bz + w; t++) {
        if (by <= lv.getHeight(s, t)) {
          ok = true;
          break;
        }
      }
    }
    if (!ok) return false;
    const ds = new Float64Array(size * 4);
    for (let k = 0; k < size; k++) {
      const p = k / size;
      const d = minX + p * (maxX - minX);
      const e = minY + p * (maxY - minY);
      const gg = minZ + p * (maxZ - minZ);
      const hh = (rng.nextDouble() * size) / 16;
      const l = ((Math.sin(Math.PI * p) + 1) * hh + 1) / 2;
      ds[k * 4] = d;
      ds[k * 4 + 1] = e;
      ds[k * 4 + 2] = gg;
      ds[k * 4 + 3] = l;
    }
    for (let k = 0; k < size - 1; k++) {
      if (ds[k * 4 + 3] <= 0) continue;
      for (let m = k + 1; m < size; m++) {
        if (ds[m * 4 + 3] <= 0) continue;
        const dx = ds[k * 4] - ds[m * 4];
        const dy = ds[k * 4 + 1] - ds[m * 4 + 1];
        const dz = ds[k * 4 + 2] - ds[m * 4 + 2];
        const dr = ds[k * 4 + 3] - ds[m * 4 + 3];
        if (dr * dr > dx * dx + dy * dy + dz * dz) {
          if (dr > 0) ds[m * 4 + 3] = -1;
          else ds[k * 4 + 3] = -1;
        }
      }
    }
    const seen = new Set();
    let placed = 0;
    for (let k = 0; k < size; k++) {
      const u = ds[k * 4 + 3];
      if (u < 0) continue;
      const v = ds[k * 4];
      const wv = ds[k * 4 + 1];
      const aa = ds[k * 4 + 2];
      const ab = Math.max(Math.floor(v - u), bx);
      const ac = Math.max(Math.floor(wv - u), by);
      const ad = Math.max(Math.floor(aa - u), bz);
      const ae = Math.max(Math.floor(v + u), ab);
      const af = Math.max(Math.floor(wv + u), ac);
      const ag = Math.max(Math.floor(aa + u), ad);
      for (let ah = ab; ah <= ae; ah++) {
        const ai = (ah + 0.5 - v) / u;
        if (ai * ai >= 1) continue;
        for (let aj = ac; aj <= af; aj++) {
          const ak = (aj + 0.5 - wv) / u;
          if (ai * ai + ak * ak >= 1) continue;
          for (let al = ad; al <= ag; al++) {
            const am = (al + 0.5 - aa) / u;
            if (ai * ai + ak * ak + am * am >= 1 || aj < 0 || aj >= HEIGHT) continue;
            const key = (ah - bx) + (aj - by) * w * 4 + (al - bz) * w * h * 16;
            if (seen.has(key)) continue;
            seen.add(key);
            if (!lv.ensureCanWrite(ah, aj, al)) continue;
            const cur = lv.getBlockState(ah, aj, al);
            for (const tg of targets) {
              if (!tagHas(tg.tag, cur)) continue;
              if (!(discard <= 0 || (discard < 1 && rng.nextFloat() >= discard)) && touchesAir(lv, ah, aj, al)) continue;
              lv.setBlock(ah, aj, al, tg.state);
              placed++;
              break;
            }
          }
        }
      }
    }
    return placed > 0;
  };
}

function touchesAir(lv, x, y, z) {
  return lv.getBlockState(x + 1, y, z) === AIR || lv.getBlockState(x - 1, y, z) === AIR ||
    lv.getBlockState(x, y + 1, z) === AIR || lv.getBlockState(x, y - 1, z) === AIR ||
    lv.getBlockState(x, y, z + 1) === AIR || lv.getBlockState(x, y, z - 1) === AIR;
}

function simpleBlockFeature(conf) {
  const st = stateOf(conf.to_place);
  return (lv, rng, x, y, z) => {
    if (!lv.ensureCanWrite(x, y, z)) return false;
    lv.setBlock(x, y, z, st);
    return true;
  };
}

function lakeFeature(conf) {
  const fluid = stateOf(conf.fluid);
  const barrier = stateOf(conf.barrier);
  const canAir = compilePredicate(conf.can_replace_with_air_or_fluid);
  const canBarrier = compilePredicate(conf.can_replace_with_barrier);
  return (lv, rng, x0, y0, z0) => {
    if (y0 <= 4) return false;
    y0 -= 4;
    const bls = new Uint8Array(2048);
    const n = rng.nextInt(4) + 4;
    for (let j = 0; j < n; j++) {
      const d = rng.nextDouble() * 6 + 3;
      const e = rng.nextDouble() * 4 + 2;
      const f = rng.nextDouble() * 6 + 3;
      const g = rng.nextDouble() * (16 - d - 2) + 1 + d / 2;
      const h = rng.nextDouble() * (8 - e - 4) + 2 + e / 2;
      const k = rng.nextDouble() * (16 - f - 2) + 1 + f / 2;
      for (let l = 1; l < 15; l++) {
        for (let m = 1; m < 15; m++) {
          for (let o = 1; o < 7; o++) {
            const a = (l - g) / (d / 2);
            const b = (o - h) / (e / 2);
            const c = (m - k) / (f / 2);
            if (a * a + b * b + c * c < 1) bls[(l * 16 + m) * 8 + o] = 1;
          }
        }
      }
    }
    const at = (l, m, o) => bls[(l * 16 + m) * 8 + o];
    const edge = (l, m, o) => !at(l, m, o) && (
      (l < 15 && at(l + 1, m, o)) || (l > 0 && at(l - 1, m, o)) || (m < 15 && at(l, m + 1, o)) ||
      (m > 0 && at(l, m - 1, o)) || (o < 7 && at(l, m, o + 1)) || (o > 0 && at(l, m, o - 1)));
    for (let l = 0; l < 16; l++) {
      for (let m = 0; m < 16; m++) {
        for (let o = 0; o < 8; o++) {
          if (!edge(l, m, o)) continue;
          const s = lv.getBlockState(x0 + l, y0 + o, z0 + m);
          if (o >= 4 && isFluid(s)) return false;
          if (o < 4 && !isSolid(s) && s !== fluid) return false;
        }
      }
    }
    for (let l = 0; l < 16; l++) {
      for (let m = 0; m < 16; m++) {
        for (let o = 0; o < 8; o++) {
          if (!at(l, m, o)) continue;
          const x = x0 + l;
          const y = y0 + o;
          const z = z0 + m;
          if (canAir(lv, x, y, z)) lv.setBlock(x, y, z, o >= 4 ? AIR : fluid);
        }
      }
    }
    for (let l = 0; l < 16; l++) {
      for (let m = 0; m < 16; m++) {
        for (let o = 0; o < 8; o++) {
          if (!edge(l, m, o) || !(o < 4 || rng.nextInt(2) !== 0)) continue;
          const x = x0 + l;
          const y = y0 + o;
          const z = z0 + m;
          if (isSolid(lv.getBlockState(x, y, z)) && canBarrier(lv, x, y, z)) lv.setBlock(x, y, z, barrier);
        }
      }
    }
    return true;
  };
}

// sculk do escuro profundo (features vanilla do bioma; versão simplificada)
function sculkPatchDeepDark(lv, rng, ox, oz) {
  for (let n = 0; n < 3; n++) {
    const x = ox + rng.nextInt(16);
    const z = oz + rng.nextInt(16);
    let y = 44;
    while (y > 8 && !(lv.getBlockState(x, y, z) === AIR && isSolid(lv.getBlockState(x, y - 1, z)))) y--;
    if (y <= 8 || lv.getBiome(x, y, z) !== "sift_deep_dark") continue;
    const r = 3 + rng.nextInt(4);
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (dx * dx + dz * dz > r * r || rng.nextFloat() < 0.25) continue;
        for (let dy = 3; dy >= -3; dy--) {
          const bx = x + dx;
          const by = y + dy;
          const bz = z + dz;
          if (lv.getBlockState(bx, by, bz) === AIR && isSolid(lv.getBlockState(bx, by - 1, bz))) {
            if (!lv.ensureCanWrite(bx, by - 1, bz)) break;
            lv.setBlock(bx, by - 1, bz, B.SCULK);
            const roll = rng.nextFloat();
            if (roll < 0.03) lv.setBlock(bx, by, bz, B.SCULK_SENSOR);
            else if (roll < 0.045) lv.setBlock(bx, by, bz, B.SCULK_SHRIEKER);
            else if (roll < 0.05) lv.setBlock(bx, by - 1, bz, B.SCULK_CATALYST);
            break;
          }
        }
      }
    }
  }
}

function sculkVein(lv, rng, ox, oz) {
  for (let n = 0; n < 40; n++) {
    const x = ox + rng.nextInt(16);
    const z = oz + rng.nextInt(16);
    const y = 6 + rng.nextInt(40);
    if (lv.getBiome(x, y, z) !== "sift_deep_dark") continue;
    if (lv.getBlockState(x, y, z) === AIR && isSolid(lv.getBlockState(x, y - 1, z))) lv.setBlock(x, y, z, B.SCULK_VEIN);
  }
}

// ---------------------------------------------------------------------------
// Compilação das placed features
// ---------------------------------------------------------------------------
const COMPILED = new Map();

function compileFeature(name) {
  let c = COMPILED.get(name);
  if (c) return c;
  const pf = PLACED[name];
  if (!pf) throw new Error("placed feature desconhecida: " + name);
  const mods = pf.placement.map((m) => compileModifier(m, name));
  const conf = pf.feature;
  const type = short(conf.type);
  let place;
  if (type === "ore") place = oreFeature(conf);
  else if (type === "simple_block") place = simpleBlockFeature(conf);
  else if (type === "lake") place = lakeFeature(conf);
  else if (CUSTOM[type]) place = CUSTOM[type];
  else throw new Error("feature não suportada: " + conf.type);
  c = { mods, place, type };
  COMPILED.set(name, c);
  return c;
}

/** Garante na carga que todas as features do mod têm implementação. */
export function checkFeatures() {
  const missing = [];
  for (const steps of STEPS) {
    for (const name of steps ?? []) {
      if (name === "sculk_vein" || name === "sculk_patch_deep_dark") continue;
      try {
        compileFeature(name);
      } catch (e) {
        missing.push(name + ": " + e.message);
      }
    }
  }
  return missing;
}

/**
 * Decora o chunk de origem (ox, oz). base(cx, cz) devolve chunks base prontos
 * (os 3 x 3 em volta). Devolve o que foi escrito, por chunk alvo.
 */
export function* decorateJob(seed, ox, oz, base, hooks = {}) {
  const level = new Level(seed, ox, oz, base);
  const ctx = { level };
  const x0 = ox * 16;
  const z0 = oz * 16;
  // biomas presentes no chunk de origem
  const present = new Set();
  const center = base(ox, oz).biomes;
  for (let i = 0; i < center.length; i++) present.add(BIOME_LIST[center[i]]);
  const wanted = new Set();
  for (const b of present) for (const f of BIOME_FEATURES[b]) wanted.add(f);

  for (let step = 0; step < STEPS.length; step++) {
    const list = STEPS[step];
    if (!list) continue;
    for (let index = 0; index < list.length; index++) {
      const name = list[index];
      if (!wanted.has(name)) continue;
      const rng = new Rng(hashInts(seed ^ 0x51f7a1, ox, oz, step * 256 + index));
      try {
        if (name === "sculk_vein") sculkVein(level, rng, x0, z0);
        else if (name === "sculk_patch_deep_dark") sculkPatchDeepDark(level, rng, x0, z0);
        else {
          const f = compileFeature(name);
          if (hooks.skip?.(name, x0, z0)) continue;
          // como o Stream do Java: cada posição vai até o fim antes da próxima
          const mods = f.mods;
          const run = (i, p) => {
            if (i === mods.length) f.place(level, rng, p[0], p[1], p[2], name);
            else mods[i](ctx, p, rng, (q) => run(i + 1, q));
          };
          run(0, [x0, 0, z0]);
        }
      } catch (e) {
        hooks.onError?.(name, e);
      }
      yield;
    }
  }
  return level.export();
}
