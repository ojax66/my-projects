/* =========================================================================
 * Carvers: cavernas e cânions do Java (CaveWorldCarver / CanyonWorldCarver).
 *
 * O algoritmo é o do jogo: cada chunk "de origem" sorteia túneis que andam em
 * passos, e cada passo é um elipsoide escavado. Um túnel começa até 8 chunks
 * longe e atravessa vários chunks, então os elipsoides de cada origem são
 * calculados uma vez e guardados; escavar um chunk é só percorrer os
 * elipsoides que tocam nele.
 * ========================================================================= */

import { Rng, hashInts } from "./rng.js";

const RANGE = 8;               // chunks de alcance (igual ao Java)
const MAX_DIST = (4 * 2 - 1) * 16; // 112 passos
const GEN_DEPTH = 256;
const TOP_LIMIT = GEN_DEPTH - 1 - 7;

function uniformFloat(rng, p) {
  if (typeof p === "number") return p;
  const t = p.type.replace("minecraft:", "");
  if (t === "uniform") return p.min_inclusive + rng.nextFloat() * (p.max_exclusive - p.min_inclusive);
  if (t === "trapezoid") {
    const d = p.max - p.min;
    const plateau = (d - p.plateau) / 2;
    const f = d - plateau;
    return p.min + rng.nextFloat() * f + rng.nextFloat() * plateau;
  }
  if (t === "constant") return p.value;
  throw new Error("float provider não suportado: " + p.type);
}

function anchorY(a) {
  if ("absolute" in a) return a.absolute;
  if ("above_bottom" in a) return a.above_bottom;
  return GEN_DEPTH - 1 - a.below_top;
}

function heightSample(rng, p) {
  const t = p.type.replace("minecraft:", "");
  const lo = anchorY(p.min_inclusive);
  const hi = anchorY(p.max_inclusive);
  if (t === "uniform") return rng.between(lo, hi);
  if (t === "trapezoid") return rng.trapezoid(lo, hi, p.plateau ?? 0);
  if (t === "biased_to_bottom") return lo + rng.nextInt(rng.nextInt(hi - lo + 1) + 1);
  if (t === "very_biased_to_bottom") return lo + rng.nextInt(rng.nextInt(rng.nextInt(hi - lo + 1) + 1) + 1);
  throw new Error("height provider não suportado: " + p.type);
}

function countSample(rng, p) {
  if (p === undefined) return rng.nextInt(rng.nextInt(rng.nextInt(15) + 1) + 1);
  if (typeof p === "number") return p;
  const t = p.type.replace("minecraft:", "");
  const lo = p.min_inclusive;
  const hi = p.max_inclusive;
  if (t === "very_biased_to_bottom") return lo + rng.nextInt(rng.nextInt(rng.nextInt(hi - lo + 1) + 1) + 1);
  if (t === "biased_to_bottom") return lo + rng.nextInt(rng.nextInt(hi - lo + 1) + 1);
  if (t === "uniform") return rng.between(lo, hi);
  throw new Error("int provider não suportado: " + p.type);
}

/**
 * Elipsoide: { x, y, z, hr, vr, kind, floor?, widths? }
 *   kind 0 = caverna/sala (pula relY <= floor), 1 = cânion (larguras por y)
 */
function caveOrigin(conf, rng, cx, cz, out) {
  const count = countSample(rng, conf.count);
  for (let k = 0; k < count; k++) {
    const x = cx * 16 + rng.nextInt(16);
    const y = heightSample(rng, conf.y);
    const z = cz * 16 + rng.nextInt(16);
    const hrm = uniformFloat(rng, conf.horizontal_radius_multiplier);
    const vrm = uniformFloat(rng, conf.vertical_radius_multiplier);
    const floor = uniformFloat(rng, conf.floor_level);
    let tunnels = 1;
    if (rng.nextInt(4) === 0) {
      const yScale = uniformFloat(rng, conf.room_vertical_radius_multiplier ?? conf.y_scale);
      const radius = 1 + rng.nextFloat() * 6;
      const d = 1.5 + radius;
      out.push({ x: x + 1, y, z, hr: d, vr: d * yScale, kind: 0, floor });
      tunnels += rng.nextInt(4);
    }
    for (let p = 0; p < tunnels; p++) {
      const yaw = rng.nextFloat() * Math.PI * 2;
      const pitch = (rng.nextFloat() - 0.5) / 4;
      const thickness = conf.thickness ? caveThickness(rng, conf) : vanillaThickness(rng);
      const steps = MAX_DIST - rng.nextInt(MAX_DIST / 4);
      tunnel(rng.nextLong(), x, y, z, hrm, vrm, thickness, yaw, pitch, 0, steps, 1, floor, out);
    }
  }
}

function vanillaThickness(rng) {
  let f = rng.nextFloat() * 2 + rng.nextFloat();
  if (rng.nextInt(10) === 0) f *= rng.nextFloat() * rng.nextFloat() * 3 + 1;
  return f;
}

function caveThickness(rng, conf) {
  let f = uniformFloat(rng, conf.thickness);
  if (conf.weird_thickness_bias && rng.nextInt(10) === 0) f *= rng.nextFloat() * rng.nextFloat() * 3 + 1;
  return f;
}

function tunnel(seed, x, y, z, hrm, vrm, thickness, yaw, pitch, from, to, yScale, floor, out) {
  const rng = new Rng(seed);
  const split = rng.nextInt(Math.max(1, Math.floor(to / 2))) + Math.floor(to / 4);
  const steep = rng.nextInt(6) === 0;
  let f = 0;
  let g = 0;
  for (let j = from; j < to; j++) {
    const d = 1.5 + Math.sin((Math.PI * j) / to) * thickness;
    const e = d * yScale;
    const h = Math.cos(pitch);
    x += Math.cos(yaw) * h;
    y += Math.sin(pitch);
    z += Math.sin(yaw) * h;
    pitch *= steep ? 0.92 : 0.7;
    pitch += g * 0.1;
    yaw += f * 0.1;
    g *= 0.9;
    f *= 0.75;
    g += (rng.nextFloat() - rng.nextFloat()) * rng.nextFloat() * 2;
    f += (rng.nextFloat() - rng.nextFloat()) * rng.nextFloat() * 4;
    if (j === split && thickness > 1) {
      tunnel(rng.nextLong(), x, y, z, hrm, vrm, rng.nextFloat() * 0.5 + 0.5, yaw - Math.PI / 2, pitch / 3, j, to, 1, floor, out);
      tunnel(rng.nextLong(), x, y, z, hrm, vrm, rng.nextFloat() * 0.5 + 0.5, yaw + Math.PI / 2, pitch / 3, j, to, 1, floor, out);
      return;
    }
    if (rng.nextInt(4) !== 0) out.push({ x, y, z, hr: d * hrm, vr: e * vrm, kind: 0, floor });
  }
}

function canyonOrigin(conf, rng, cx, cz, out) {
  const shape = conf.shape;
  const x = cx * 16 + rng.nextInt(16);
  let y = heightSample(rng, conf.y);
  const z = cz * 16 + rng.nextInt(16);
  let yaw = rng.nextFloat() * Math.PI * 2;
  let pitch = uniformFloat(rng, conf.vertical_rotation);
  const yScale = uniformFloat(rng, conf.y_scale ?? shape.y_scale);
  const thickness = uniformFloat(rng, shape.thickness);
  const steps = Math.floor(MAX_DIST * uniformFloat(rng, shape.distance_factor));

  const r = new Rng(rng.nextLong());
  const widths = new Float32Array(GEN_DEPTH);
  let w = 1;
  for (let j = 0; j < GEN_DEPTH; j++) {
    if (j === 0 || r.nextInt(shape.width_smoothness) === 0) w = 1 + r.nextFloat() * r.nextFloat();
    widths[j] = w * w;
  }
  let f = 0;
  let g = 0;
  let px = x;
  let pz = z;
  for (let i = 0; i < steps; i++) {
    let d = 1.5 + Math.sin((i * Math.PI) / steps) * thickness;
    let e = d * yScale;
    d *= uniformFloat(r, shape.horizontal_radius_factor);
    const mid = 1 - Math.abs(0.5 - i / steps) * 2;
    const factor = shape.vertical_radius_default_factor + shape.vertical_radius_center_factor * mid;
    e = factor * e * (0.75 + r.nextFloat() * 0.25);
    const h = Math.cos(pitch);
    px += Math.cos(yaw) * h;
    y += Math.sin(pitch);
    pz += Math.sin(yaw) * h;
    pitch *= 0.7;
    pitch += g * 0.05;
    yaw += f * 0.05;
    g *= 0.8;
    f *= 0.5;
    g += (r.nextFloat() - r.nextFloat()) * r.nextFloat() * 2;
    f += (r.nextFloat() - r.nextFloat()) * r.nextFloat() * 4;
    if (r.nextInt(4) !== 0) out.push({ x: px, y, z: pz, hr: d, vr: e, kind: 1, widths });
  }
}

/**
 * @param {number} seed
 * @param {Record<string, any>} carvers  CARVERS do data.js
 * @param {string[]} order  nomes na ordem do bioma
 */
export function makeCarvers(seed, carvers, order) {
  const cache = new Map();
  const list = order.map((name, i) => ({ name, i, conf: carvers[name], type: carvers[name].type.replace("minecraft:", "") }));

  function originOf(cx, cz) {
    const key = cx + "," + cz;
    let v = cache.get(key);
    if (v) return v;
    v = [];
    for (const c of list) {
      const rng = new Rng(hashInts(seed, cx, cz, 0x6361 + c.i));
      if (rng.nextFloat() > c.conf.probability) continue;
      if (c.type === "cave") caveOrigin(c.conf, rng, cx, cz, v);
      else if (c.type === "canyon") canyonOrigin(c.conf, rng, cx, cz, v);
    }
    if (cache.size > 4000) cache.delete(cache.keys().next().value);
    cache.set(key, v);
    return v;
  }

  /**
   * Escava o chunk. blocks: Uint8Array coluna-major ((lx*16+lz)*256+y).
   * canCarve(índice) diz se o bloco pode virar ar.
   */
  function carve(cx, cz, blocks, canCarve) {
    const minX = cx * 16;
    const minZ = cz * 16;
    const midX = minX + 8;
    const midZ = minZ + 8;
    for (let ox = cx - RANGE; ox <= cx + RANGE; ox++) {
      for (let oz = cz - RANGE; oz <= cz + RANGE; oz++) {
        const ells = originOf(ox, oz);
        for (let n = 0; n < ells.length; n++) {
          const el = ells[n];
          const reach = 16 + el.hr * 2;
          if (Math.abs(el.x - midX) > reach || Math.abs(el.z - midZ) > reach) continue;
          const x0 = Math.max(Math.floor(el.x - el.hr) - minX - 1, 0);
          const x1 = Math.min(Math.floor(el.x + el.hr) - minX, 15);
          const z0 = Math.max(Math.floor(el.z - el.hr) - minZ - 1, 0);
          const z1 = Math.min(Math.floor(el.z + el.hr) - minZ, 15);
          if (x0 > x1 || z0 > z1) continue;
          const yLow = Math.max(Math.floor(el.y - el.vr) - 1, 1);
          const yHigh = Math.min(Math.floor(el.y + el.vr) + 1, TOP_LIMIT);
          for (let lx = x0; lx <= x1; lx++) {
            const rx = (minX + lx + 0.5 - el.x) / el.hr;
            for (let lz = z0; lz <= z1; lz++) {
              const rz = (minZ + lz + 0.5 - el.z) / el.hr;
              const h2 = rx * rx + rz * rz;
              if (h2 >= 1) continue;
              const base = (lx * 16 + lz) * 256;
              for (let y = yHigh; y > yLow; y--) {
                const ry = (y - 0.5 - el.y) / el.vr;
                if (el.kind === 0) {
                  if (ry <= el.floor || h2 + ry * ry >= 1) continue;
                } else if (h2 * el.widths[y - 1] + (ry * ry) / 6 >= 1) continue;
                const i = base + y;
                if (blocks[i] !== 0 && canCarve(blocks[i])) blocks[i] = 0;
              }
            }
          }
        }
      }
    }
  }

  return { carve };
}
