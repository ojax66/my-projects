/* =========================================================================
 * As features próprias do mod, portadas do código Java (mielon.thesift
 * .worldgen.*). Os nomes e a ordem dos passos seguem o original para
 * facilitar a comparação; as diferenças são só de linguagem:
 *   - posições são (x, y, z) soltos em vez de BlockPos;
 *   - estados de bloco são índices da paleta (level.js / palette.js);
 *   - os hashes de 64 bits do Java viraram hashes de 32 bits (fhash01).
 * ========================================================================= */

import { TEMPLATES } from "./data.js";
import { AIR, blockId, blockKey } from "./palette.js";
import { B, fhash01, fmix, is, isFluid, isSiftTerrain, isSolid, nameOf, plantCanSurvive, unit } from "./level.js";
import { hashInts, Rng } from "./rng.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (t, a, b) => a + t * (b - a);
const square = (v) => v * v;
const jround = (v) => Math.floor(v + 0.5); // Math.round do Java
const ichorSnow = (layers) => blockId("the_sift:ichor_snow", { "the_sift:layers": layers });

// ---------------------------------------------------------------------------
// Guarda do portal principal e reservas (SiftFeaturePlacementGuard)
// ---------------------------------------------------------------------------
let portalRect = null;
/** Retângulo protegido em volta do portal principal (origem + tamanho). */
export function reservePortal(x, z, sizeX, sizeZ) {
  portalRect = x === undefined ? null : { minX: x - 15, minZ: z - 15, maxX: x + sizeX - 1 + 15, maxZ: z + sizeZ - 1 + 15 };
}
function intersectsPortalRect(minX, minZ, maxX, maxZ) {
  const r = portalRect;
  return !!r && maxX >= r.minX && minX <= r.maxX && maxZ >= r.minZ && minZ <= r.maxZ;
}
function intersectsPortal(x, z, radius) {
  return intersectsPortalRect(x - radius, z - radius, x + radius, z + radius);
}

// Uma reserva lembra quem a fez: se a decoração do mesmo chunk for refeita
// (o cache esvaziou), ela não briga com a própria reserva.
const reservations = [];
function tryReserve(lv, owner, minX, minZ, maxX, maxZ) {
  if (intersectsPortalRect(minX, minZ, maxX, maxZ)) return false;
  const key = lv.ox + "," + lv.oz + ":" + owner;
  for (const r of reservations) {
    if (maxX >= r.minX && minX <= r.maxX && maxZ >= r.minZ && minZ <= r.maxZ) return r.key === key;
  }
  reservations.push({ key, minX, minZ, maxX, maxZ });
  if (reservations.length > 4096) reservations.shift();
  return true;
}

// ---------------------------------------------------------------------------
// SiftWorldgenBounds
// ---------------------------------------------------------------------------
function bounds(lv, margin) {
  const cx = lv.ox;
  const cz = lv.oz;
  const minX = ((cx - 1) << 4) + margin;
  const maxX = ((cx + 2) << 4) - 1 - margin;
  const minZ = ((cz - 1) << 4) + margin;
  const maxZ = ((cz + 2) << 4) - 1 - margin;
  return { contains: (x, z) => x >= minX && x <= maxX && z >= minZ && z <= maxZ };
}

// ---------------------------------------------------------------------------
// SiftLandmarkPlacement
// ---------------------------------------------------------------------------
function candidateChunk(seed, cellX, cellZ, cellChunks, salt, index) {
  const a = hashInts(seed ^ salt, cellX, cellZ, index);
  const b = hashInts(seed ^ salt ^ 0x5bd1e995, cellZ, cellX, index);
  return [cellX * cellChunks + (a % cellChunks), cellZ * cellChunks + (b % cellChunks)];
}
function isSelectedChunk(lv, x, z, cellChunks, salt, count = 1) {
  const cx = Math.floor(x / 16);
  const cz = Math.floor(z / 16);
  const cellX = Math.floor(cx / cellChunks);
  const cellZ = Math.floor(cz / cellChunks);
  for (let i = 0; i < count; i++) {
    const c = candidateChunk(lv.getSeed(), cellX, cellZ, cellChunks, salt, i);
    if (c[0] === cx && c[1] === cz) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// SiftMonolithFeature (utilitários usados por várias features)
// ---------------------------------------------------------------------------
const MONO_REPLACEABLE_PLANTS = new Set(["overgrown_chard", "overgrown_stalks", "overgrown_fronds", "siftslate_stalks",
  "healthy_sculk_sprouts", "dry_healthy_sculk_sprouts"]);
function canReplace(b) {
  return b === AIR || isSiftTerrain(b) || MONO_REPLACEABLE_PLANTS.has(nameOf(b));
}
function findTerrainSurface(lv, x, z) {
  let y = lv.getHeight(x, z);
  for (let step = 0; step < 8 && y > 0; y--) {
    if (isSiftTerrain(lv.getBlockState(x, y - 1, z))) return y;
    step++;
  }
  return -1;
}
function isDrySupportedSurface(lv, x, surfaceY, z, depth) {
  if (isFluid(lv.getBlockState(x, surfaceY, z))) return false;
  for (let o = 1; o <= depth; o++) if (!isSiftTerrain(lv.getBlockState(x, surfaceY - o, z))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// SiftSurfaceDecorator
// ---------------------------------------------------------------------------
function decorate(lv, rng, x, y, z, densityScale) {
  const floor = lv.getBlockState(x, y, z);
  if (!lv.isEmptyBlock(x, y + 1, z) || !lv.ensureCanWrite(x, y + 1, z)) return false;
  const roll = rng.nextFloat();
  let chance;
  let plant;
  if (floor === B.GROWTH) {
    chance = 0.255;
    plant = roll < 0.43 ? B.FRONDS : roll < 0.68 ? B.STALKS : roll < 0.86 ? B.CHARD : B.SLATE_STALKS;
  } else if (floor === B.DRY_GROWTH) {
    chance = 0.235;
    plant = roll < 0.34 ? B.DRY_SPROUTS : roll < 0.59 ? B.FRONDS : roll < 0.8 ? B.STALKS : roll < 0.93 ? B.CHARD : B.SLATE_STALKS;
  } else if (floor === B.HEALTHY) {
    chance = 0.225;
    plant = roll < 0.76 ? B.SPROUTS : roll < 0.92 ? B.SLATE_STALKS : B.FRONDS;
  } else if (floor === B.DRY) {
    chance = 0.145;
    plant = roll < 0.74 ? B.DRY_SPROUTS : roll < 0.94 ? B.SLATE_STALKS : B.STALKS;
  } else if (floor === B.SIFTSLATE) {
    chance = 0.045;
    plant = roll < 0.72 ? B.SLATE_STALKS : B.FRONDS;
  } else return false;
  if (rng.nextFloat() >= chance * densityScale) return false;
  if (!plantCanSurvive(lv, x, y + 1, z)) return false;
  lv.setBlock(x, y + 1, z, plant);
  return true;
}

function decorateStructureSurface(lv, rng, x, y, z, densityScale) {
  const floor = lv.getBlockState(x, y, z);
  if (!lv.isEmptyBlock(x, y + 1, z) || !lv.ensureCanWrite(x, y + 1, z)) return false;
  const roll = rng.nextFloat();
  let chance;
  let plant;
  if (floor === B.GROWTH || floor === B.DRY_GROWTH) {
    chance = 0.72;
    plant = roll < 0.4 ? B.FRONDS : roll < 0.72 ? B.STALKS : B.CHARD;
  } else if (floor === B.SIFTSLATE) {
    chance = 0.36;
    plant = B.SLATE_STALKS;
  } else if (floor === B.HEALTHY) {
    chance = 0.42;
    plant = B.SPROUTS;
  } else if (floor === B.DRY) {
    chance = 0.3;
    plant = B.DRY_SPROUTS;
  } else return false;
  if (rng.nextFloat() >= chance * densityScale) return false;
  if (!plantCanSurvive(lv, x, y + 1, z)) return false;
  lv.setBlock(x, y + 1, z, plant);
  return true;
}

const isFlowerSoil = (b) => b === B.SIFTSLATE || b === B.GROWTH || b === B.DRY || b === B.HEALTHY;
const isLakeFlowerSoil = (b) => isFlowerSoil(b) || b === B.DRY_GROWTH;
const DIRS4 = ["north", "east", "south", "west"];
function wildflowers(rng) {
  const dir = ["south", "west", "north", "east"][rng.nextInt(4)];
  return blockId("minecraft:wildflowers", { "minecraft:cardinal_direction": dir, growth: rng.nextInt(4) });
}
function placePitcher(lv, x, y, z) {
  lv.setBlock(x, y, z, blockId("minecraft:pitcher_plant", { upper_block_bit: false }));
  lv.setBlock(x, y + 1, z, blockId("minecraft:pitcher_plant", { upper_block_bit: true }));
}

function decorateLakeShore(lv, rng, shore) {
  if (!shore.length) return;
  const floors = shore.filter((p) => isLakeFlowerSoil(lv.getBlockState(p[0], p[1], p[2])));
  const batches = Math.max(2, Math.min(12, 2 + Math.floor(floors.length / 30)));
  const first = rng.nextInt(6);
  const anchors = [];
  for (let batch = 0; batch < batches && floors.length; batch++) {
    let anchor = null;
    for (let a = 0; a < 32; a++) {
      const c = floors[rng.nextInt(floors.length)];
      if (anchors.every((u) => square(c[0] - u[0]) + square(c[2] - u[2]) >= 16)) {
        anchor = c;
        break;
      }
    }
    if (!anchor) break;
    anchors.push(anchor);
    const species = (first + batch) % 6;
    const target = 3 + rng.nextInt(2);
    const nearby = floors.filter((c) => Math.abs(c[0] - anchor[0]) <= 2 && Math.abs(c[2] - anchor[2]) <= 2 && Math.abs(c[1] - anchor[1]) <= 1);
    let placed = 0;
    while (placed < target && nearby.length) {
      const f = nearby.splice(rng.nextInt(nearby.length), 1)[0];
      if (placeOasisFlower(lv, rng, f[0], f[1] + 1, f[2], species)) placed++;
    }
  }
  for (const p of shore) {
    const floor = lv.getBlockState(p[0], p[1], p[2]);
    const growth = floor === B.GROWTH || floor === B.DRY_GROWTH;
    const chance = growth ? 0.68 : floor === B.HEALTHY ? 0.6 : floor === B.DRY ? 0.5 : floor === B.SIFTSLATE ? 0.45 : 0;
    if (rng.nextFloat() >= chance) continue;
    const y = p[1] + 1;
    if (!lv.isEmptyBlock(p[0], y, p[2]) || !lv.ensureCanWrite(p[0], y, p[2])) continue;
    const roll = rng.nextFloat();
    let plant;
    if (growth) plant = roll < 0.38 ? B.FRONDS : roll < 0.72 ? B.STALKS : B.CHARD;
    else if (floor === B.SIFTSLATE) plant = roll < 0.82 ? B.SLATE_STALKS : B.SPROUTS;
    else if (floor === B.HEALTHY) plant = roll < 0.82 ? B.SPROUTS : B.SLATE_STALKS;
    else if (floor === B.DRY) plant = B.DRY_SPROUTS;
    else continue;
    if (plantCanSurvive(lv, p[0], y, p[2])) lv.setBlock(p[0], y, p[2], plant);
  }
}

function placeOasisFlower(lv, rng, x, y, z, species) {
  if (!isLakeFlowerSoil(lv.getBlockState(x, y - 1, z)) || !lv.isEmptyBlock(x, y, z) || !lv.ensureCanWrite(x, y, z)) return false;
  if (species === 4) {
    if (!lv.isEmptyBlock(x, y + 1, z) || !lv.ensureCanWrite(x, y + 1, z)) return false;
    rng.nextInt(2);
    placePitcher(lv, x, y, z);
    return true;
  }
  if (species === 5) {
    lv.setBlock(x, y, z, wildflowers(rng));
    return true;
  }
  lv.setBlock(x, y, z, [B.LOTUS, B.SUNBURST, B.WHISPERBLOOM, B.TORCHFLOWER][species]);
  return true;
}

// ---------------------------------------------------------------------------
// Moldes (StructureTemplate com rotação e espelho)
// ---------------------------------------------------------------------------
const ROT = ["none", "cw90", "cw180", "ccw90"];
const CW = { north: "east", east: "south", south: "west", west: "north" };
function rotDir(d, rot, mirror) {
  if (mirror && (d === "north" || d === "south")) d = d === "north" ? "south" : "north";
  const n = rot === "cw90" ? 1 : rot === "cw180" ? 2 : rot === "ccw90" ? 3 : 0;
  for (let i = 0; i < n; i++) d = CW[d];
  return d;
}

/** Converte um estado do Java (já girado) para o índice do Bedrock. */
function javaToBedrock(name, props, rot, mirror) {
  const short = name.replace("the_sift:", "").replace("minecraft:", "");
  if (/overgrown_willow_(log|wood)$/.test(short)) {
    let axis = props.axis ?? "y";
    if (axis !== "y" && (rot === "cw90" || rot === "ccw90")) axis = axis === "x" ? "z" : "x";
    return blockId(name, { "minecraft:block_face": { y: "up", x: "east", z: "south" }[axis] });
  }
  if (short === "overgrown_willow_foliage") return B.FOLIAGE;
  if (short === "overgrown_willow_vines") {
    const faces = DIRS4.filter((d) => props[d] === "true").map((d) => rotDir(d, rot, mirror));
    const facing = DIRS4.find((d) => faces.includes(d)) ?? "north";
    return blockId(name, { "the_sift:facing": facing, "the_sift:tip": props.bottom === "true" });
  }
  if (short === "chest") return blockId("minecraft:chest", { "minecraft:cardinal_direction": rotDir(props.facing ?? "north", rot, mirror) });
  return blockId(name);
}

/**
 * Blocos do molde transformados (mirror, depois rotação em torno do pivô),
 * já em coordenadas do mundo. filter: nomes curtos aceitos (ou null = todos).
 */
function templateBlocks(tname, ox, oy, oz, rot, mirror, px, pz, filter) {
  const t = TEMPLATES[tname];
  const out = [];
  const b = t.blocks;
  for (let i = 0; i < b.length; i += 4) {
    const [name, props] = t.palette[b[i + 3]];
    const short = name.replace("the_sift:", "").replace("minecraft:", "");
    if (filter && !filter.includes(short)) continue;
    let x = b[i];
    const y = b[i + 1];
    let z = b[i + 2];
    if (mirror) z = -z;
    let nx = x;
    let nz = z;
    if (rot === "ccw90") { nx = px - pz + z; nz = px + pz - x; }
    else if (rot === "cw90") { nx = px + pz - z; nz = pz - px + x; }
    else if (rot === "cw180") { nx = px + px - x; nz = pz + pz - z; }
    out.push({ x: ox + nx, y: oy + y, z: oz + nz, short, state: javaToBedrock(name, props, rot, mirror) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// OvergrownWillowTreeFeature
// ---------------------------------------------------------------------------
const WILLOW = { small: { t: "overgrown_willow/small_01", px: 3, pz: 6 }, big: { t: "overgrown_willow/big_01", px: 7, pz: 6 } };
const isTreeGround = (b) => b === B.GROWTH || b === B.HEALTHY || b === B.DRY || b === B.DRY_GROWTH || b === B.SIFTSLATE;
const TREE_REPLACEABLE = new Set(["overgrown_willow_foliage", "overgrown_willow_vines", "overgrown_chard", "overgrown_stalks",
  "overgrown_fronds", "siftslate_stalks", "healthy_sculk_sprouts", "dry_healthy_sculk_sprouts"]);
const canReplaceTreeBlock = (b) => b === AIR || TREE_REPLACEABLE.has(nameOf(b));
const isWillowTrunk = (b) => /overgrown_willow_(log|wood)$/.test(nameOf(b));
const isVine = (b) => nameOf(b) === "overgrown_willow_vines";

function willowTree(lv, rng, x, y, z) {
  const bd = bounds(lv, 1);
  const minX = x & -16;
  const minZ = z & -16;
  const rx = minX + 4 + rng.nextInt(8);
  const rz = minZ + 4 + rng.nextInt(8);
  const ry = lv.getHeight(rx, rz);
  if (intersectsPortal(rx, rz, 12) || !isTreeGround(lv.getBlockState(rx, ry - 1, rz))) return false;
  const choice = rng.nextFloat() < 0.38 ? WILLOW.big : WILLOW.small;
  return placeWillow(lv, rng, rx, ry, rz, bd, choice);
}

function placeWillow(lv, rng, rx, ry, rz, bd, choice) {
  const rot = ROT[rng.nextInt(4)];
  const mirror = rng.nextBoolean();
  const ox = rx - choice.px;
  const oz = rz - choice.pz;
  const tb = (f) => templateBlocks(choice.t, ox, ry, oz, rot, mirror, choice.px, choice.pz, f);
  const logs = tb(["overgrown_willow_log"]);
  const wood = tb(["overgrown_willow_wood"]);
  const foliage = tb(["overgrown_willow_foliage"]);
  const vines = tb(["overgrown_willow_vines"]);
  const all = [logs, wood, foliage, vines];
  if (!all.every((l) => l.every((p) => bd.contains(p.x, p.z)))) return false;
  // base real: o tronco mais baixo e mais perto da raiz pedida
  let base = null;
  for (const p of logs) {
    const d = square(p.x - rx) + square(p.z - rz);
    if (!base || p.y < base.y || (p.y === base.y && d < base.d)) base = { x: p.x, y: p.y, z: p.z, d };
  }
  if (!base || !isTreeGround(lv.getBlockState(base.x, base.y - 1, base.z))) return false;
  for (let dx = -5; dx <= 5; dx++) {
    for (let dz = -5; dz <= 5; dz++) {
      for (let dy = -1; dy <= 10; dy++) {
        if (bd.contains(base.x + dx, base.z + dz) && isWillowTrunk(lv.getBlockState(base.x + dx, base.y + dy, base.z + dz))) return false;
      }
    }
  }
  const fits = (l) => l.every((p) => bd.contains(p.x, p.z) && lv.ensureCanWrite(p.x, p.y, p.z) && canReplaceTreeBlock(lv.getBlockState(p.x, p.y, p.z)));
  if (!fits(logs) || !fits(wood)) return false;
  let placed = 0;
  const put = (l) => {
    for (const p of l) {
      if (bd.contains(p.x, p.z) && lv.ensureCanWrite(p.x, p.y, p.z) && canReplaceTreeBlock(lv.getBlockState(p.x, p.y, p.z))) {
        lv.setBlock(p.x, p.y, p.z, p.state);
        placed++;
      }
    }
  };
  put(logs);
  put(wood);
  put(foliage);
  put([...vines].sort((a, b) => b.y - a.y));
  refreshVines(lv, bd, vines);
  addSurfaceRoots(lv, bd, rng, base.x, base.y, base.z);
  varyHangingVines(lv, bd, rng, vines);
  return placed > 0;
}

// videira sem apoio some; a última de cada corrente usa a ponta
function refreshVines(lv, bd, vines) {
  for (const p of [...vines].sort((a, b) => b.y - a.y)) {
    const s = lv.getBlockState(p.x, p.y, p.z);
    if (!isVine(s)) continue;
    // apoio: algo em cima (folha, tronco, videira) ou um bloco ao lado
    let supported = lv.getBlockState(p.x, p.y + 1, p.z) !== AIR;
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = lv.getBlockState(p.x + d[0], p.y, p.z + d[1]);
      if (n !== AIR && !isVine(n)) supported = true;
    }
    if (!supported) {
      lv.setBlock(p.x, p.y, p.z, AIR);
      continue;
    }
    setVineTip(lv, p.x, p.y, p.z, !isVine(lv.getBlockState(p.x, p.y - 1, p.z)));
  }
}

function vineFacing(b) {
  const m = /the_sift:facing=(\w+)/.exec(blockKey(b));
  return m ? m[1] : "north";
}
const vineState = (facing, tip) => blockId("the_sift:overgrown_willow_vines", { "the_sift:facing": facing, "the_sift:tip": tip });
function setVineTip(lv, x, y, z, tip) {
  const s = lv.getBlockState(x, y, z);
  if (isVine(s)) lv.setBlock(x, y, z, vineState(vineFacing(s), tip));
}

function addSurfaceRoots(lv, bd, rng, x, y, z) {
  const b = lv.getBlockState(x, y, z);
  if (!isWillowTrunk(b) || !isTreeGround(lv.getBlockState(x, y - 1, z))) return;
  const first = rng.nextInt(4);
  const count = 2 + rng.nextInt(3);
  const steps = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // norte, leste, sul, oeste
  for (let r = 0; r < count; r++) {
    const d = (first + r) % 4;
    const len = 1 + rng.nextInt(3);
    const state = d % 2 === 0 ? B.LOG_Z : B.LOG_X;
    for (let s = 1; s <= len; s++) {
      const px = x + steps[d][0] * s;
      const pz = z + steps[d][1] * s;
      if (!bd.contains(px, pz) || !lv.ensureCanWrite(px, y, pz) || !canReplaceTreeBlock(lv.getBlockState(px, y, pz)) ||
        !isTreeGround(lv.getBlockState(px, y - 1, pz))) break;
      lv.setBlock(px, y, pz, state);
    }
  }
}

function varyHangingVines(lv, bd, rng, vines) {
  for (const p of vines) {
    let s = lv.getBlockState(p.x, p.y, p.z);
    if (!isVine(s)) continue;
    const tip = !isVine(lv.getBlockState(p.x, p.y - 1, p.z));
    if (!tip || rng.nextFloat() >= 0.34) continue;
    const facing = vineFacing(s);
    let cy = p.y;
    const ext = 1 + rng.nextInt(3);
    for (let step = 0; step < ext; step++) {
      const by = cy - 1;
      if (!bd.contains(p.x, p.z) || !lv.ensureCanWrite(p.x, by, p.z) || lv.getBlockState(p.x, by, p.z) !== AIR) break;
      lv.setBlock(p.x, by, p.z, vineState(facing, true));
      setVineTip(lv, p.x, cy, p.z, false);
      cy = by;
    }
  }
}

// ---------------------------------------------------------------------------
// SiftMonolithFeature
// ---------------------------------------------------------------------------
function monolithStable(lv, x, y, z, radius, maxRelief) {
  let minY = Infinity;
  let maxY = -Infinity;
  let samples = 0;
  let valid = 0;
  const r = radius + 2;
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      if (dx * dx + dz * dz > r * r) continue;
      samples++;
      const sy = findTerrainSurface(lv, x + dx, z + dz);
      if (sy >= 0 && isDrySupportedSurface(lv, x + dx, sy, z + dz, 6)) {
        valid++;
        minY = Math.min(minY, sy);
        maxY = Math.max(maxY, sy);
      }
    }
  }
  return valid >= Math.ceil(samples * 0.84) && maxY - minY <= maxRelief;
}

function terraceBoost(p, main) {
  let b = 0;
  if (Math.abs(p - 0.28) < 0.035) b += main ? 1.35 : 0.75;
  if (Math.abs(p - 0.58) < 0.03) b += main ? 1.05 : 0.55;
  if (Math.abs(p - 0.81) < 0.025) b += main ? 0.75 : 0.35;
  return b;
}

function rootFlare(lv, x, y, z, baseRadius, salt, block, reach, rise, jitter) {
  let placed = 0;
  const rr = baseRadius + 2;
  for (let dx = -rr; dx <= rr; dx++) {
    for (let dz = -rr; dz <= rr; dz++) {
      const edge = rr + (fhash01(x + dx, y, z + dz, salt) - 0.5) * jitter;
      const d2 = dx * dx + dz * dz;
      if (d2 > edge * edge) continue;
      const px = x + dx;
      const pz = z + dz;
      const local = findTerrainSurface(lv, px, pz);
      if (local < 0 || Math.abs(local - y) > reach) continue;
      const strength = 1 - Math.min(1, Math.sqrt(d2) / rr);
      const top = y + jround(strength * rise);
      if (local > top + 1) continue;
      for (let py = local - 2; py <= top; py++) {
        if (lv.ensureCanWrite(px, py, pz) && canReplace(lv.getBlockState(px, py, pz))) {
          lv.setBlock(px, py, pz, block);
          placed++;
        }
      }
    }
  }
  return placed;
}

function placePillar(lv, rng, x, y, z, baseRadius, height, withGrowth, main) {
  let placed = 0;
  const leanX = rng.nextInt(5) - 2;
  const leanZ = rng.nextInt(5) - 2;
  const baseY = y - 2;
  const salt = rng.nextLong();
  placed += rootFlare(lv, x, y, z, baseRadius, salt ^ 0x1d3a, B.SIFTSLATE, 8, 2, 0.9);
  for (let dy = 0; dy <= height; dy++) {
    const p = dy / height;
    const cx = x + jround(leanX * p * p);
    const cz = z + jround(leanZ * p * p);
    const radius = baseRadius - (baseRadius - 2.25) * p + terraceBoost(p, main);
    const lim = Math.ceil(radius + 1);
    for (let dx = -lim; dx <= lim; dx++) {
      for (let dz = -lim; dz <= lim; dz++) {
        const er = radius + (fhash01(cx + dx, baseY + dy, cz + dz, salt) - 0.5) * 0.82;
        if (dx * dx + dz * dz > er * er) continue;
        if (canReplace(lv.getBlockState(cx + dx, baseY + dy, cz + dz)) && lv.ensureCanWrite(cx + dx, baseY + dy, cz + dz)) {
          lv.setBlock(cx + dx, baseY + dy, cz + dz, B.SIFTSLATE);
          placed++;
        }
      }
    }
  }
  const tx = x + leanX;
  const tz = z + leanZ;
  const ty = baseY + height;
  const tr = Math.max(2, baseRadius - 2) + (main ? 1 : 0);
  const cap = withGrowth ? B.GROWTH : B.SIFTSLATE;
  for (let dx = -tr; dx <= tr; dx++) {
    for (let dz = -tr; dz <= tr; dz++) {
      const er = tr + (fhash01(tx + dx, ty, tz + dz, salt ^ 0x6a09e667) - 0.5) * 0.7;
      if (dx * dx + dz * dz > er * er) continue;
      if (canReplace(lv.getBlockState(tx + dx, ty, tz + dz)) && lv.ensureCanWrite(tx + dx, ty, tz + dz)) {
        lv.setBlock(tx + dx, ty, tz + dz, cap);
        placed++;
      }
      if (withGrowth) decorate(lv, rng, tx + dx, ty, tz + dz, 1.08);
    }
  }
  return placed;
}

function monolith(lush) {
  return (lv, rng, ox, oy, oz) => {
    const x = (ox & -16) + 8 + rng.nextInt(5) - 2;
    const z = (oz & -16) + 8 + rng.nextInt(5) - 2;
    const y = findTerrainSurface(lv, x, z);
    if (y < 0 || !isDrySupportedSurface(lv, x, y, z, 6)) return false;
    const radius = lush ? 5 + rng.nextInt(3) : 4 + rng.nextInt(3);
    if (intersectsPortal(x, z, 22) || !monolithStable(lv, x, y, z, radius, lush ? 14 : 12)) return false;
    const req = lush ? 31 + rng.nextInt(25) : 24 + rng.nextInt(21);
    const height = Math.min(req, lv.getMaxY() - y - 3);
    if (height < 18) return false;
    if (!tryReserve(lv, "monolith", x - 22, z - 22, x + 22, z + 22)) return false;
    let placed = placePillar(lv, rng, x, y, z, radius, height, lush, true);
    const sats = lush ? 1 + rng.nextInt(3) : rng.nextInt(2);
    for (let i = 0; i < sats; i++) {
      const a = rng.nextDouble() * Math.PI * 2;
      const d = radius + 4 + rng.nextInt(4);
      const sx = x + jround(Math.cos(a) * d);
      const sz = z + jround(Math.sin(a) * d);
      const sy = findTerrainSurface(lv, sx, sz);
      if (sy < 0) continue;
      const sr = 2 + rng.nextInt(2);
      if (!isDrySupportedSurface(lv, sx, sy, sz, 6) || !monolithStable(lv, sx, sy, sz, sr, 10)) continue;
      const sh = Math.min(13 + rng.nextInt(Math.max(7, Math.floor(height / 2))), lv.getMaxY() - sy - 3);
      if (sh >= 10) placed += placePillar(lv, rng, sx, sy, sz, sr, sh, lush && rng.nextFloat() < 0.72, false);
    }
    return placed > 0;
  };
}

// ---------------------------------------------------------------------------
// SiftDrySpikeFeature
// ---------------------------------------------------------------------------
function spikeStable(lv, x, y, z, radius) {
  let minY = Infinity;
  let maxY = -Infinity;
  let samples = 0;
  let valid = 0;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      if (dx * dx + dz * dz > radius * radius) continue;
      samples++;
      const sy = findTerrainSurface(lv, x + dx, z + dz);
      if (sy >= 0 && isDrySupportedSurface(lv, x + dx, sy, z + dz, 6)) {
        valid++;
        minY = Math.min(minY, sy);
        maxY = Math.max(maxY, sy);
      }
    }
  }
  return valid >= Math.ceil(samples * 0.82) && maxY - minY <= 12;
}

function placeSpike(lv, rng, x, y, z, baseRadius, req) {
  if (!spikeStable(lv, x, y, z, baseRadius + 2)) return 0;
  const height = Math.min(req, lv.getMaxY() - y - 2);
  if (height < 8) return 0;
  const leanX = rng.nextInt(7) - 3;
  const leanZ = rng.nextInt(7) - 3;
  const salt = rng.nextLong();
  let placed = rootFlare(lv, x, y, z, baseRadius, salt ^ 0x2f1b, B.DRY, 6, 1.5, 0.8);
  for (let dy = 0; dy <= height; dy++) {
    const p = Math.max(0, dy / height);
    const cx = x + jround(leanX * p * p);
    const cz = z + jround(leanZ * p * p);
    const radius = Math.max(0.32, baseRadius * Math.pow(1 - p, 0.72));
    const lim = Math.max(1, Math.ceil(radius));
    for (let dx = -lim; dx <= lim; dx++) {
      for (let dz = -lim; dz <= lim; dz++) {
        const er = radius + (fhash01(cx + dx, y + dy, cz + dz, salt) - 0.5) * 0.45;
        if (dx * dx + dz * dz > er * er) continue;
        if (lv.ensureCanWrite(cx + dx, y + dy, cz + dz) && canReplace(lv.getBlockState(cx + dx, y + dy, cz + dz))) {
          lv.setBlock(cx + dx, y + dy, cz + dz, B.DRY);
          placed++;
        }
      }
    }
  }
  return placed;
}

function drySpikes(lv, rng, ox, oy, oz) {
  const x = (ox & -16) + 8 + rng.nextInt(5) - 2;
  const z = (oz & -16) + 8 + rng.nextInt(5) - 2;
  const y = findTerrainSurface(lv, x, z);
  if (y < 0 || intersectsPortal(x, z, 18) || !isDrySupportedSurface(lv, x, y, z, 6)) return false;
  const main = 3 + rng.nextInt(2);
  if (!spikeStable(lv, x, y, z, main + 2) || !tryReserve(lv, "spikes", x - 18, z - 18, x + 18, z + 18)) return false;
  let placed = placeSpike(lv, rng, x, y, z, main, 19 + rng.nextInt(13));
  const sats = 2 + rng.nextInt(3);
  for (let i = 0; i < sats; i++) {
    const a = rng.nextDouble() * Math.PI * 2;
    const d = 4 + rng.nextInt(6);
    const sx = x + jround(Math.cos(a) * d);
    const sz = z + jround(Math.sin(a) * d);
    const sy = findTerrainSurface(lv, sx, sz);
    if (sy >= 0) placed += placeSpike(lv, rng, sx, sy, sz, 2 + rng.nextInt(2), 10 + rng.nextInt(13));
  }
  return placed > 0;
}

// ---------------------------------------------------------------------------
// SiftArchFeature
// ---------------------------------------------------------------------------
const AXES = [[1, 0], [0, 1], [1, 1], [1, -1]];
const phase = (salt, shift) => ((fmix(salt ^ Math.imul(shift, 0x9e3779b1)) & 65535) / 65535) * Math.PI * 2;
const smootherstep = (v) => {
  const t = clamp(v, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

function archCurve(c, cx, cz, t, rise, salt) {
  const signed = (t * 2 - 1) * c.halfSpan;
  const mask = Math.sin(Math.PI * t);
  const lat = (Math.sin(t * Math.PI * 2 + phase(salt, 7)) * 0.68 + Math.sin(t * Math.PI * 5 + phase(salt, 23)) * 0.32) * 1.45 * mask;
  const ver = (Math.sin(t * Math.PI * 3 + phase(salt, 17)) * 0.72 + Math.sin(t * Math.PI * 7 + phase(salt, 37)) * 0.28) * 1.05 * mask;
  const perpX = -c.axisZ;
  const perpZ = c.axisX;
  const baseY = c.leftY + (c.rightY - c.leftY) * t;
  return { x: cx + c.axisX * signed + perpX * lat, y: baseY + rise * 4 * t * (1 - t) + ver, z: cz + c.axisZ * signed + perpZ * lat };
}

function organicSphere(lv, bd, p, radius, main, healthy, stripe, salt, placedSet) {
  let placed = 0;
  const lim = Math.ceil(radius + 0.5);
  const rx = jround(p.x);
  const ry = jround(p.y);
  const rz = jround(p.z);
  for (let dx = -lim; dx <= lim; dx++) {
    for (let dy = -lim; dy <= lim; dy++) {
      for (let dz = -lim; dz <= lim; dz++) {
        const er = radius + (fhash01(rx + dx, ry + dy, rz + dz, salt) - 0.5) * 0.62;
        if (dx * dx + dy * dy + dz * dz > er * er) continue;
        const x = rx + dx;
        const y = ry + dy;
        const z = rz + dz;
        if (!bd.contains(x, z) || !lv.ensureCanWrite(x, y, z) || !canReplace(lv.getBlockState(x, y, z))) continue;
        const vein = healthy && dy < 0 && Math.trunc(stripe / 8) % 7 === 3 && fhash01(x, y, z, salt ^ 0x3c6ef372) < 0.58;
        lv.setBlock(x, y, z, vein ? B.DRY : main);
        placedSet.add(x + "," + y + "," + z);
        placed++;
      }
    }
  }
  return placed;
}

function cliffArch(lv, rng, ox, oy, oz) {
  const bd = bounds(lv, 1);
  const cx = (ox & -16) + 8 + rng.nextInt(3) - 1;
  const cz = (oz & -16) + 8 + rng.nextInt(3) - 1;
  if (intersectsPortal(cx, cz, 23)) return false;
  const cy = findTerrainSurface(lv, cx, cz);
  if (cy < 0) return false;
  const halfSpan = 13 + rng.nextInt(3);
  let best = null;
  let bestScore = -Infinity;
  for (const d of AXES) {
    const norm = d[0] !== 0 && d[1] !== 0 ? 0.70710678118 : 1;
    const ax = d[0] * norm;
    const az = d[1] * norm;
    const lx = cx - jround(ax * halfSpan);
    const lz = cz - jround(az * halfSpan);
    const rxp = cx + jround(ax * halfSpan);
    const rzp = cz + jround(az * halfSpan);
    if (!bd.contains(lx, lz) || !bd.contains(rxp, rzp)) continue;
    const ly = findTerrainSurface(lv, lx, lz);
    const ry = findTerrainSurface(lv, rxp, rzp);
    if (ly < 0 || ry < 0) continue;
    const inner = Math.max(7, Math.floor(halfSpan / 2));
    const lix = cx - jround(ax * (halfSpan - inner));
    const liz = cz - jround(az * (halfSpan - inner));
    const rix = cx + jround(ax * (halfSpan - inner));
    const riz = cz + jround(az * (halfSpan - inner));
    if (!bd.contains(lix, liz) || !bd.contains(rix, riz)) continue;
    const liy = findTerrainSurface(lv, lix, liz);
    const riy = findTerrainSurface(lv, rix, riz);
    if (liy < 0 || riy < 0) continue;
    const diff = Math.abs(ly - ry);
    const valley = Math.min(ly, ry) - cy;
    const ld = ly - liy;
    const rd = ry - riy;
    if (diff <= 20 && valley >= 6 && ld >= 3 && rd >= 3 && ld + rd >= 8) {
      const score = valley * 5.5 + (ld + rd) * 2.2 - diff * 0.75 + rng.nextDouble();
      if (score > bestScore) {
        bestScore = score;
        best = { axisX: ax, axisZ: az, halfSpan, leftY: ly, rightY: ry, valley };
      }
    }
  }
  if (!best) return false;
  const baseMid = Math.trunc((best.leftY + best.rightY) / 2);
  let rise = 7 + rng.nextInt(6) + Math.min(5, Math.trunc(best.valley / 5));
  const top = baseMid + rise + 5;
  if (top >= lv.getMaxY()) rise -= top - lv.getMaxY() + 1;
  if (rise < 6) return false;
  const lf = lv.getBlockState(cx - jround(best.axisX * halfSpan), best.leftY - 1, cz - jround(best.axisZ * halfSpan));
  const rf = lv.getBlockState(cx + jround(best.axisX * halfSpan), best.rightY - 1, cz + jround(best.axisZ * halfSpan));
  const healthyGround = lf === B.HEALTHY || lf === B.DRY || rf === B.HEALTHY || rf === B.DRY;
  const growthGround = lf === B.GROWTH || rf === B.GROWTH;
  const healthy = rng.nextFloat() < (healthyGround ? 0.78 : growthGround ? 0.22 : 0.43);
  const body = healthy ? B.HEALTHY : B.SIFTSLATE;
  const growthVariant = !healthy && growthGround;
  const thick = 2.45 + rng.nextDouble() * 0.9;
  const steps = best.halfSpan * 4;
  const salt = rng.nextLong();
  const placedSet = new Set();
  const crown = [];
  let placed = 0;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const p = archCurve(best, cx, cz, t, rise, salt);
    const endS = Math.pow(Math.abs(t * 2 - 1), 4);
    const wave = 0.93 + 0.09 * Math.sin(t * Math.PI * 5 + phase(salt, 11)) + 0.045 * Math.sin(t * Math.PI * 9 + phase(salt, 29));
    const lt = thick * wave + endS * 1.15;
    placed += organicSphere(lv, bd, p, lt, body, healthy, s, salt, placedSet);
    if (s % 5 === 0) crown.push([jround(p.x), jround(p.y + lt), jround(p.z)]);
  }
  for (const left of [true, false]) {
    const salt2 = salt ^ (left ? 0x4c45 : 0x5249);
    const ep = archCurve(best, cx, cz, left ? 0 : 1, 0, salt2);
    const outward = left ? -1 : 1;
    const perpX = -best.axisZ;
    const perpZ = best.axisX;
    let prev = left ? best.leftY : best.rightY;
    for (let s = 0; s < 5; s++) {
      const prog = (s + 1) / 5;
      const dist = 0.85 + s * 0.78;
      const side = Math.sin(prog * Math.PI * 2.4 + phase(salt2, 13)) * 0.42 * (1 - prog);
      const x = ep.x + best.axisX * outward * dist + perpX * side;
      const z = ep.z + best.axisZ * outward * dist + perpZ * side;
      const sx = jround(x);
      const sz = jround(z);
      if (!bd.contains(sx, sz)) break;
      const surf = findTerrainSurface(lv, sx, sz);
      if (surf < 0 || Math.abs(surf - prev) > 9) break;
      prev = surf;
      const cyy = ep.y + (surf - 0.35 - ep.y) * smootherstep(prog);
      const r = thick + 0.9 - prog * (thick - 0.55) + Math.sin(prog * Math.PI * 3 + phase(salt2, 31)) * 0.16;
      placed += organicSphere(lv, bd, { x, y: cyy, z }, Math.max(1.25, r), body, healthy, left ? -s : s, salt2, placedSet);
    }
  }
  // sulcos
  const gouges = 3 + rng.nextInt(5);
  const perpX = -best.axisZ;
  const perpZ = best.axisX;
  for (let i = 0; i < gouges; i++) {
    const t = 0.16 + rng.nextDouble() * 0.68;
    const c = archCurve(best, cx, cz, t, rise, salt);
    const ang = -1.0995574287564276 + rng.nextDouble() * Math.PI * 1.7;
    const off = thick * (0.68 + rng.nextDouble() * 0.22);
    const gx = jround(c.x + perpX * Math.cos(ang) * off);
    const gy = jround(c.y + Math.sin(ang) * off);
    const gz = jround(c.z + perpZ * Math.cos(ang) * off);
    const r = 0.82 + rng.nextDouble() * 0.78;
    const lim = Math.ceil(r);
    for (let dx = -lim; dx <= lim; dx++) {
      for (let dy = -lim; dy <= lim; dy++) {
        for (let dz = -lim; dz <= lim; dz++) {
          if (dx * dx + dy * dy + dz * dz > r * r) continue;
          const k = (gx + dx) + "," + (gy + dy) + "," + (gz + dz);
          if (placedSet.delete(k) && lv.ensureCanWrite(gx + dx, gy + dy, gz + dz)) lv.setBlock(gx + dx, gy + dy, gz + dz, AIR);
        }
      }
    }
  }
  if (growthVariant) {
    for (const k of placedSet) {
      const [x, y, z] = k.split(",").map(Number);
      const above = lv.getBlockState(x, y + 1, z);
      if (bd.contains(x, z) && !placedSet.has(x + "," + (y + 1) + "," + z) && (above === AIR || MONO_REPLACEABLE_PLANTS.has(nameOf(above))) &&
        lv.getBlockState(x, y, z) === B.SIFTSLATE) lv.setBlock(x, y, z, B.GROWTH);
    }
  }
  for (const c of crown) decorate(lv, rng, c[0], c[1], c[2], healthy ? 0.82 : 0.72);
  return placed > 0;
}

// ---------------------------------------------------------------------------
// Pequenas: lava no fundo, limpeza, flores, plantas, nascente
// ---------------------------------------------------------------------------
function lavaFloor(lv, rng, ox, oy, oz) {
  const x0 = ox & -16;
  const z0 = oz & -16;
  let placed = 0;
  for (let x = x0; x < x0 + 16; x++) {
    for (let z = z0; z < z0 + 16; z++) {
      for (let y = 0; y <= 11; y++) {
        if (lv.getBlockState(x, y, z) === AIR) {
          lv.setBlock(x, y, z, B.LAVA);
          placed++;
        }
      }
    }
  }
  return placed > 0;
}

const LAKE_PLANTS = new Set(["overgrown_chard", "overgrown_stalks", "overgrown_fronds", "overgrown_lotus", "sunburst_plant",
  "whisperbloom", "siftslate_stalks", "healthy_sculk_sprouts", "dry_healthy_sculk_sprouts", "wildflowers", "torchflower",
  "pitcher_plant", "pitcher_crop"]);
function coveredGrowthCleanup(lv, rng, ox, oy, oz) {
  const x0 = ox & -16;
  const z0 = oz & -16;
  let changed = false;
  for (let x = x0; x < x0 + 16; x++) {
    for (let z = z0; z < z0 + 16; z++) {
      const surface = lv.getHeight(x, z);
      for (let y = Math.max(0, surface - 56); y <= Math.min(255, surface); y++) {
        const s = lv.getBlockState(x, y, z);
        if (LAKE_PLANTS.has(nameOf(s))) {
          let ichor = false;
          for (let o = 1; o <= 6; o++) {
            const b = lv.getBlockState(x, y - o, z);
            if (isFluid(b)) {
              ichor = b === B.ICHOR;
              break;
            }
            if (b !== AIR) break;
          }
          if (ichor) {
            lv.setBlock(x, y, z, AIR);
            changed = true;
          }
        } else if (s === B.GROWTH || s === B.DRY_GROWTH) {
          const cover = lv.getBlockState(x, y + 1, z);
          const dry = s === B.DRY_GROWTH || lv.getBlockState(x, y - 1, z) === B.DRY;
          const snowCover = nameOf(cover).startsWith("ichor_snow");
          if (isSolid(cover) && !snowCover && !isFoliageName(cover)) {
            lv.setBlock(x, y, z, dry ? B.DRY : B.SIFTSLATE);
            changed = true;
          } else if (dry && s === B.GROWTH) {
            lv.setBlock(x, y, z, B.DRY_GROWTH);
            changed = true;
          }
        }
      }
    }
  }
  return changed;
}
const isFoliageName = (b) => nameOf(b) === "overgrown_willow_foliage";

function siftFlowerPatch(lv, rng, ox, oy, oz) {
  const cx = (ox & -16) + 8;
  const cz = (oz & -16) + 8;
  const target = 3 + rng.nextInt(2);
  let placed = 0;
  const sy = lv.getHeight(cx, cz);
  const over = lv.isOvergrownBiome(cx, sy, cz);
  const sel = rng.nextInt(over ? 6 : 24);
  const wild = sel < 3;
  const flower = [B.LOTUS, B.SUNBURST, B.WHISPERBLOOM][sel % 3];
  for (let a = 0; a < 24 && placed < target; a++) {
    const x = cx + rng.nextInt(7) - 3;
    const z = cz + rng.nextInt(7) - 3;
    const y = lv.getHeight(x, z);
    if (isFlowerSoil(lv.getBlockState(x, y - 1, z)) && lv.isEmptyBlock(x, y, z) && lv.ensureCanWrite(x, y, z)) {
      lv.setBlock(x, y, z, wild ? wildflowers(rng) : flower);
      placed++;
    }
  }
  return placed > 0;
}

function siftslatePlantPatch(lv, rng, ox, oy, oz) {
  const cx = (ox & -16) + 8;
  const cz = (oz & -16) + 8;
  const target = 4 + rng.nextInt(4);
  let placed = 0;
  const plant = [B.FRONDS, B.STALKS, B.CHARD, B.SLATE_STALKS, B.SPROUTS, B.DRY_SPROUTS][rng.nextInt(6)];
  for (let a = 0; a < 32 && placed < target; a++) {
    const x = cx + rng.nextInt(9) - 4;
    const z = cz + rng.nextInt(9) - 4;
    const y = lv.getHeight(x, z);
    if (lv.getBlockState(x, y - 1, z) === B.SIFTSLATE && lv.isEmptyBlock(x, y, z) && lv.ensureCanWrite(x, y, z)) {
      lv.setBlock(x, y, z, plant);
      placed++;
    }
  }
  return placed > 0;
}

function snifferPlant(lv, rng, x, y, z, torch) {
  if (!lv.isEmptyBlock(x, y, z) || !lv.ensureCanWrite(x, y, z)) return false;
  if (torch) {
    lv.setBlock(x, y, z, B.TORCHFLOWER);
    return true;
  }
  if (!lv.isEmptyBlock(x, y + 1, z) || !lv.ensureCanWrite(x, y + 1, z)) return false;
  rng.nextInt(2);
  placePitcher(lv, x, y, z);
  return true;
}

function snifferPlantPatch(lv, rng, ox, oy, oz) {
  const cx = (ox & -16) + 8;
  const cz = (oz & -16) + 8;
  const target = 5 + rng.nextInt(5);
  let placed = 0;
  const torch = rng.nextFloat() < 0.58;
  for (let a = 0; a < 28 && placed < target; a++) {
    const x = cx + rng.nextInt(13) - 6;
    const z = cz + rng.nextInt(13) - 6;
    const y = lv.getHeight(x, z);
    const f = lv.getBlockState(x, y - 1, z);
    if ((f === B.HEALTHY || f === B.DRY || f === B.GROWTH) && snifferPlant(lv, rng, x, y, z, torch)) placed++;
  }
  return placed > 0;
}

const SPRING_OPENINGS = [[0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0], [0, -1, 0]];
function ichorSpring(lv, rng, x, y, z) {
  for (const d of SPRING_OPENINGS) {
    if (lv.isEmptyBlock(x + d[0], y + d[1], z + d[2]) && y + d[1] >= lv.getHeight(x + d[0], z + d[2]) - 1) return false;
  }
  if (!isSiftTerrain(lv.getBlockState(x, y + 1, z)) || !isSiftTerrain(lv.getBlockState(x, y - 1, z))) return false;
  const cur = lv.getBlockState(x, y, z);
  if (cur !== AIR && !isSiftTerrain(cur)) return false;
  let rock = 0;
  let hole = 0;
  for (const d of SPRING_OPENINGS) {
    const b = lv.getBlockState(x + d[0], y + d[1], z + d[2]);
    if (isSiftTerrain(b)) rock++;
    if (b === AIR) hole++;
  }
  if (rock !== 4 || hole !== 1) return false;
  lv.setBlock(x, y, z, B.ICHOR);
  return true;
}

// ---------------------------------------------------------------------------
// SiftIchorSnowFeature
// ---------------------------------------------------------------------------
function valueNoise(seed, x, z, scale) {
  const cx = Math.floor(x / scale);
  const cz = Math.floor(z / scale);
  const lx = (((x % scale) + scale) % scale) / scale;
  const lz = (((z % scale) + scale) % scale) / scale;
  const sx = lx * lx * (3 - 2 * lx);
  const sz = lz * lz * (3 - 2 * lz);
  const u = (a, b) => hashInts(seed, a, b, 0x5eed) / 4294967296;
  return lerp(sz, lerp(sx, u(cx, cz), u(cx + 1, cz)), lerp(sx, u(cx, cz + 1), u(cx + 1, cz + 1)));
}
const PEAK_VEG = new Set([...LAKE_PLANTS, "sculk_vein"]);
function ichorSnowFeature(lv, rng, ox, oy, oz) {
  const x0 = ox & -16;
  const z0 = oz & -16;
  const seed = lv.getSeed();
  let changed = false;
  const layer = (sx, sy, sz, salt, replaceVeg) => {
    const above = lv.getBlockState(sx, sy + 1, sz);
    if (!(above === AIR || (replaceVeg && PEAK_VEG.has(nameOf(above)))) || !lv.ensureCanWrite(sx, sy + 1, sz)) return false;
    const field = valueNoise(seed ^ salt, sx, sz, 26);
    const detail = valueNoise(seed ^ 0x53b1 ^ salt, sx, sz, 9);
    if (nameOf(above) === "pitcher_plant") lv.setBlock(sx, sy + 2, sz, AIR);
    lv.setBlock(sx, sy + 1, sz, ichorSnow(field + detail * 0.35 > 0.88 ? 2 : 1));
    return true;
  };
  for (let x = x0; x < x0 + 16; x++) {
    for (let z = z0; z < z0 + 16; z++) {
      const gy = lv.getMotionHeight(x, z, true) - 1;
      if (gy < 0 || gy >= 253 || lv.getBiome(x, gy, z) !== "ichor_snowy_peaks") continue;
      const g = lv.getBlockState(x, gy, z);
      if (isSiftTerrain(g) || g === B.SCULK) changed = layer(x, gy, z, 0x2a31, true) || changed;
      const cy = lv.getMotionHeight(x, z, false) - 1;
      if (cy >= 0 && cy < 254 && lv.getBiome(x, cy, z) === "ichor_snowy_peaks") {
        const c = lv.getBlockState(x, cy, z);
        if (isFoliageName(c) || isWillowTrunk(c)) changed = layer(x, cy, z, 0x1e0b, false) || changed;
      }
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// SiftSurfaceSculkRegionFeature
// ---------------------------------------------------------------------------
const regionCache = new Map();
function sculkRegion(seed, cellX, cellZ) {
  const key = cellX + "," + cellZ;
  let r = regionCache.get(key);
  if (r) return r;
  const rseed = hashInts(seed ^ 0x53434b52, cellX, cellZ, 0);
  const rng = new Rng(rseed);
  const cx = cellX * 512 + 76 + rng.nextInt(361);
  const cz = cellZ * 512 + 76 + rng.nextInt(361);
  const diameter = 50 + rng.nextInt(71);
  const major = diameter * 0.5;
  const minor = major * (0.72 + rng.nextDouble() * 0.23);
  const angle = rng.nextDouble() * Math.PI;
  const count = 6 + rng.nextInt(6);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const blobs = [];
  for (let i = 0; i < count; i++) {
    const dir = rng.nextDouble() * Math.PI * 2;
    const dist = i === 0 ? 0 : Math.sqrt(rng.nextDouble()) * major * 0.68;
    const lx = Math.cos(dir) * dist;
    const lz = Math.sin(dir) * dist * (minor / major);
    const bx = cx + lx * cos - lz * sin;
    const bz = cz + lx * sin + lz * cos;
    const br = major * (0.18 + rng.nextDouble() * 0.18);
    const aspect = 0.62 + rng.nextDouble() * 0.36;
    const ba = rng.nextDouble() * Math.PI;
    blobs.push({ x: bx, z: bz, rx: br, rz: br * aspect, cos: Math.cos(ba), sin: Math.sin(ba), seed: rng.nextLong() });
  }
  const blobContains = (b, x, z) => {
    const dx = x + 0.5 - b.x;
    const dz = z + 0.5 - b.z;
    const lx = dx * b.cos + dz * b.sin;
    const lz = -dx * b.sin + dz * b.cos;
    const e = (lx * lx) / (b.rx * b.rx) + (lz * lz) / (b.rz * b.rz);
    return e <= 1 + (unit(hashInts(b.seed, x, z, 1)) - 0.5) * 0.22;
  };
  const envelope = (x, z) => {
    const dx = x + 0.5 - cx;
    const dz = z + 0.5 - cz;
    const lx = dx * cos + dz * sin;
    const lz = -dx * sin + dz * cos;
    return (lx * lx) / (major * major) + (lz * lz) / (minor * minor) <= 1;
  };
  const contains = (x, z) => envelope(x, z) && blobs.some((b) => blobContains(b, x, z));
  r = {
    seed: rseed, blobs, blobContains,
    intersects: (a, b, c, d) => cx + major >= a && cx - major <= c && cz + major >= b && cz - major <= d,
    contains,
    fringe: (x, z) => envelope(x, z) && (contains(x + 1, z) || contains(x - 1, z) || contains(x, z + 1) || contains(x, z - 1) ||
      contains(x + 2, z) || contains(x - 2, z) || contains(x, z + 2) || contains(x, z - 2)),
    touchesEdge: (x, z) => !contains(x + 1, z) || !contains(x - 1, z) || !contains(x, z + 1) || !contains(x, z - 1),
  };
  if (regionCache.size > 64) regionCache.delete(regionCache.keys().next().value);
  regionCache.set(key, r);
  return r;
}

function surfaceSculkRegion(lv, rng, ox, oy, oz) {
  const x0 = ox & -16;
  const z0 = oz & -16;
  const x1 = x0 + 15;
  const z1 = z0 + 15;
  let changed = false;
  const natural = (b) => isSiftTerrain(b) || b === B.SCULK;
  for (let cellX = Math.floor((x0 - 60) / 512); cellX <= Math.floor((x1 + 60) / 512); cellX++) {
    for (let cellZ = Math.floor((z0 - 60) / 512); cellZ <= Math.floor((z1 + 60) / 512); cellZ++) {
      const reg = sculkRegion(lv.getSeed(), cellX, cellZ);
      if (!reg.intersects(x0, z0, x1, z1)) continue;
      const nb = reg.blobs.length;
      const darkCount = 1 + (fmix(reg.seed ^ 0x44524b) & 1);
      const first = fmix(reg.seed ^ 0x1a2b) % nb;
      let second = fmix(reg.seed ^ 0x3c4d) % (nb - 1);
      if (second >= first) second++;
      const plans = [];
      reg.blobs.forEach((b, i) => {
        const owner = Math.floor(Math.floor(b.x) / 16) === Math.floor(x0 / 16) && Math.floor(Math.floor(b.z) / 16) === Math.floor(z0 / 16);
        if (owner && (i === first || (darkCount === 2 && i === second))) plans.push({ blob: b, sites: [] });
      });
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const core = reg.contains(x, z);
          const fringe = !core && reg.fringe(x, z);
          if (!core && !fringe) continue;
          const sy = lv.getMotionHeight(x, z, true) - 1;
          if (sy < 0 || sy >= 253) continue;
          if (!natural(lv.getBlockState(x, sy, z))) continue;
          let above = lv.getBlockState(x, sy + 1, z);
          if (LAKE_PLANTS.has(nameOf(above))) {
            if (nameOf(above) === "pitcher_plant") lv.setBlock(x, sy + 2, z, AIR);
            lv.setBlock(x, sy + 1, z, AIR);
            above = AIR;
          }
          if (core) {
            const depth = 6 + (hashInts(reg.seed, x, z, 7) % 4);
            let replaced = false;
            for (let o = 0; o < depth; o++) {
              if (!lv.ensureCanWrite(x, sy - o, z) || !natural(lv.getBlockState(x, sy - o, z))) break;
              lv.setBlock(x, sy - o, z, B.SCULK);
              replaced = true;
            }
            changed = changed || replaced;
            if (above === AIR) {
              const roll = unit(hashInts(reg.seed, x, z, 0x44454f));
              let deco = -1;
              if (roll < 0.0015) deco = B.SCULK_CATALYST;
              else if (roll < 0.0055) deco = B.SCULK_SHRIEKER;
              else if (roll < 0.021) deco = B.SCULK_SENSOR;
              else if (roll < 0.115 && reg.touchesEdge(x, z)) deco = B.SCULK_VEIN;
              if (deco >= 0 && lv.ensureCanWrite(x, sy + 1, z)) {
                lv.setBlock(x, sy + 1, z, deco);
                changed = true;
              } else if (replaced && x > x0 && x < x1 && z > z0 && z < z1) {
                for (const p of plans) if (p.sites.length < 64 && reg.blobContains(p.blob, x, z)) p.sites.push([x, sy, z]);
              }
            }
          } else if (above === AIR && lv.ensureCanWrite(x, sy + 1, z)) {
            lv.setBlock(x, sy + 1, z, B.SCULK_VEIN);
            changed = true;
          }
        }
      }
      for (const p of plans) {
        if (!p.sites.length) continue;
        const s = p.sites[fmix(p.blob.seed) % p.sites.length];
        lv.spawnLater("the_sift:dark_sniffer", s[0] + 0.5, s[1] + 1, s[2] + 0.5);
      }
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// IchorLakeFeature
// ---------------------------------------------------------------------------
const VARIANTS = {
  SMALL: { min: 4, max: 7, minBeach: 1, maxBeach: 2, depth: 3, relief: 4, area: 28, rocks: false },
  MEDIUM: { min: 8, max: 12, minBeach: 2, maxBeach: 3, depth: 4, relief: 4, area: 90, rocks: false },
  LARGE: { min: 12, max: 15, minBeach: 4, maxBeach: 5, depth: 5, relief: 5, area: 300, rocks: true },
  MEGA: { min: 14, max: 14, minBeach: 6, maxBeach: 6, depth: 6, relief: 4, area: 450, rocks: true, mega: true },
};
const xz = (x, z) => x + "," + z;
const isIchorSnow = (b) => nameOf(b).startsWith("ichor_snow");
function hasNaturalSupport(lv, x, y, z, depth) {
  for (let o = 0; o < depth; o++) if (!isSiftTerrain(lv.getBlockState(x, y - o, z))) return false;
  return true;
}

function sampleRelief(lv, bd, cx, cz, radius) {
  let mn = Infinity;
  let mx = -Infinity;
  for (let dx = -radius; dx <= radius; dx += 4) {
    for (let dz = -radius; dz <= radius; dz += 4) {
      if (dx * dx + dz * dz > radius * radius) continue;
      if (!bd.contains(cx + dx, cz + dz)) return -1;
      const y = findTerrainSurface(lv, cx + dx, cz + dz);
      if (y < 0) return -1;
      mn = Math.min(mn, y);
      mx = Math.max(mx, y);
    }
  }
  return mx - mn;
}

function buildWaterMask(lv, bd, cx, cz, rX, rZ, angle, cos, sin, salt) {
  const water = new Map();
  const lim = Math.ceil(Math.max(rX, rZ) * 1.14);
  for (let dx = -lim; dx <= lim; dx++) {
    for (let dz = -lim; dz <= lim; dz++) {
      const x = cx + dx;
      const z = cz + dz;
      if (!bd.contains(x, z)) continue;
      const lx = (dx * cos - dz * sin) / rX;
      const lz = (dx * sin + dz * cos) / rZ;
      const wx = lx + Math.sin(lz * 2.7 + angle * 1.9) * 0.045;
      const wz = lz + Math.sin(lx * 2.2 - angle * 1.3) * 0.04;
      const dist = Math.sqrt(wx * wx + wz * wz);
      const polar = Math.atan2(lz, lx);
      const shore = 0.95 + Math.sin(polar * 3 + angle * 1.7) * 0.09 + Math.sin(polar * 5 - angle * 0.8) * 0.055 +
        Math.cos(polar * 7 + angle * 0.37) * 0.028 + (fhash01(x >> 2, 0, z >> 2, salt) - 0.5) * 0.028;
      if (dist > shore) continue;
      const sy = findTerrainSurface(lv, x, z);
      if (sy < 0 || !isSiftTerrain(lv.getBlockState(x, sy - 1, z))) return new Map();
      water.set(xz(x, z), { x, z, surfaceY: sy, nd: dist / Math.max(0.01, shore) });
    }
  }
  return water;
}

function buildBeachMask(water, width) {
  const beach = new Map();
  for (const c of water.values()) {
    for (let dx = -width; dx <= width; dx++) {
      for (let dz = -width; dz <= width; dz++) {
        const layer = Math.ceil(Math.sqrt(dx * dx + dz * dz));
        if (layer === 0 || layer > width) continue;
        const k = xz(c.x + dx, c.z + dz);
        if (water.has(k)) continue;
        const prev = beach.get(k);
        if (!prev || layer < prev.layer) beach.set(k, { x: c.x + dx, z: c.z + dz, layer });
      }
    }
  }
  return beach;
}

function choosePalette(lv, x, y, z, rng) {
  const over = lv.isOvergrownBiome(x, y, z);
  const br = rng.nextInt(100);
  const basin = br < 70 ? B.DRY : br < 91 ? B.HEALTHY : B.SIFTSLATE;
  const sr = rng.nextInt(100);
  let shore;
  if (over && sr < 58) shore = B.GROWTH;
  else if (sr < (over ? 79 : 72)) shore = B.DRY;
  else if (sr < 93) shore = B.HEALTHY;
  else shore = B.SIFTSLATE;
  return { basin, shore };
}

function targetShoreTop(naturalTop, waterY, layer, width) {
  if (layer > 1 && width > 1) {
    const o = clamp((layer - 1) / (width - 1), 0, 1);
    const s = o * o * (3 - 2 * o);
    return Math.floor(lerp(s, waterY, naturalTop) + 0.5);
  }
  return waterY;
}

function validateBeach(lv, bd, beach, width, waterY, maxRelief) {
  const cols = new Map();
  for (const [k, c] of beach) {
    if (!bd.contains(c.x, c.z)) return null;
    const sy = findTerrainSurface(lv, c.x, c.z);
    if (sy < 0 || !isSiftTerrain(lv.getBlockState(c.x, sy - 1, c.z))) return null;
    const nt = sy - 1;
    const tt = targetShoreTop(nt, waterY, c.layer, width);
    if (nt >= waterY - width && nt <= waterY + maxRelief + width && Math.abs(tt - nt) <= width && hasNaturalSupport(lv, c.x, nt, c.z, 3)) {
      cols.set(k, { x: c.x, z: c.z, surfaceY: sy, nd: 1 + c.layer / width });
    } else return null;
  }
  return cols;
}

const STEPS4 = [[-1, 0], [0, 1], [1, 0], [0, -1]];
function buildShoreTargets(lv, water, beach, beachCols, waterY, width) {
  let targets = new Map();
  for (const [k, c] of beachCols) {
    const layer = beach.get(k).layer;
    targets.set(k, layer === width ? c.surfaceY - 1 : targetShoreTop(c.surfaceY - 1, waterY, layer, width));
  }
  for (let pass = 0; pass < width * 6; pass++) {
    const next = new Map();
    for (const [k, c] of beachCols) {
      const layer = beach.get(k).layer;
      if (layer === 1) next.set(k, waterY);
      else if (layer === width) next.set(k, c.surfaceY - 1);
      else {
        const desired = targetShoreTop(c.surfaceY - 1, waterY, layer, width);
        let sum = desired * 3;
        let w = 3;
        for (const s of STEPS4) {
          const nk = xz(c.x + s[0], c.z + s[1]);
          if (water.has(nk)) {
            sum += waterY * 3;
            w += 3;
          } else if (targets.has(nk)) {
            sum += targets.get(nk);
            w++;
          }
        }
        next.set(k, clamp(Math.floor(sum / w + 0.5), waterY - layer, waterY + layer));
      }
    }
    targets = next;
  }
  for (const [k, t] of targets) {
    const c = beachCols.get(k);
    const layer = beach.get(k).layer;
    for (const s of STEPS4) {
      const nx = c.x + s[0];
      const nz = c.z + s[1];
      const nk = xz(nx, nz);
      let nt;
      if (water.has(nk)) nt = waterY;
      else if (targets.has(nk)) nt = targets.get(nk);
      else {
        if (layer !== width) continue;
        const sy = findTerrainSurface(lv, nx, nz);
        if (sy < 0) return null;
        nt = sy - 1;
      }
      if (Math.abs(t - nt) > 1) return null;
    }
  }
  return targets;
}

function shapeBeach(lv, col, targetTop, pal, bd) {
  const naturalTop = col.surfaceY - 1;
  let placed = 0;
  for (let y = targetTop + 1; y <= Math.max(col.surfaceY + 3, targetTop + 3); y++) {
    if (!bd.contains(col.x, col.z) || !lv.ensureCanWrite(col.x, y, col.z)) continue;
    const s = lv.getBlockState(col.x, y, col.z);
    if (canReplace(s) || s === B.ICHOR || isIchorSnow(s)) lv.setBlock(col.x, y, col.z, AIR);
  }
  for (let y = Math.min(naturalTop, targetTop) - 2; y < targetTop; y++) {
    if (bd.contains(col.x, col.z) && lv.ensureCanWrite(col.x, y, col.z)) {
      lv.setBlock(col.x, y, col.z, y >= targetTop - 2 ? pal.basin : B.SIFTSLATE);
      placed++;
    }
  }
  const below = lv.getBlockState(col.x, targetTop - 1, col.z);
  const top = pal.shore !== B.GROWTH ? pal.shore : below === B.DRY ? B.DRY_GROWTH : B.GROWTH;
  if (bd.contains(col.x, col.z) && lv.ensureCanWrite(col.x, targetTop, col.z)) {
    lv.setBlock(col.x, targetTop, col.z, top);
    placed++;
  }
  return placed;
}

function carveAndFill(lv, col, waterY, lining, salt, maxDepth, bd) {
  const cs = 1 - clamp(col.nd, 0, 1);
  const depth = clamp(1 + Math.floor(cs * (maxDepth - 0.55) + fhash01(col.x, waterY, col.z, salt ^ 0x1234) * 0.7), 1, maxDepth);
  const floorY = waterY - depth;
  if (!bd.contains(col.x, col.z)) return 0;
  for (let y = floorY + 1; y <= Math.max(col.surfaceY + 2, waterY + 1); y++) {
    const s = lv.getBlockState(col.x, y, col.z);
    if (lv.ensureCanWrite(col.x, y, col.z) && (canReplace(s) || s === B.ICHOR || isIchorSnow(s))) lv.setBlock(col.x, y, col.z, AIR);
  }
  for (let y = floorY - 1; y <= floorY; y++) if (lv.ensureCanWrite(col.x, y, col.z)) lv.setBlock(col.x, y, col.z, lining);
  let placed = 0;
  for (let y = floorY + 1; y <= waterY; y++) {
    if (lv.ensureCanWrite(col.x, y, col.z)) {
      lv.setBlock(col.x, y, col.z, B.ICHOR);
      placed++;
    }
  }
  return placed;
}

function islandSurface(requested, below) {
  return requested === B.GROWTH && below === B.DRY ? B.DRY_GROWTH : requested;
}

function placeRockFormations(lv, rng, water, waterY, pal, salt, bd) {
  const cands = [...water.values()].filter((c) => c.nd > 0.2 && c.nd < 0.72);
  if (!cands.length) return 0;
  const island = water.size > 400;
  const s0 = cands[0];
  const over = lv.isOvergrownBiome(s0.x, waterY, s0.z);
  if (island && over && rng.nextFloat() < 0.27) {
    let best = null;
    let bd2 = Infinity;
    for (let a = 0; a < 36; a++) {
      const c = cands[rng.nextInt(cands.length)];
      if (c.nd < 0.2 || c.nd > 0.46) continue;
      const t = Math.abs(c.nd - 0.32);
      if (t < bd2) {
        best = c;
        bd2 = t;
      }
    }
    if (best) return placeWillowIsland(lv, rng, water, waterY, pal, salt, bd, best);
  }
  const formations = island ? 3 + rng.nextInt(2) : 1 + rng.nextInt(3);
  const used = [];
  let placed = 0;
  for (let f = 0; f < formations; f++) {
    let center = null;
    for (let a = 0; a < 24 && !center; a++) {
      const c = cands[rng.nextInt(cands.length)];
      if (used.every((u) => square(c.x - u[0]) + square(c.z - u[1]) >= (island ? 49 : 16))) center = c;
    }
    if (!center) continue;
    used.push([center.x, center.z]);
    const radius = island ? 2 + rng.nextInt(3) : 1 + rng.nextInt(2);
    const peak = island ? 2 + rng.nextInt(4) : 1 + rng.nextInt(4);
    const fs = salt ^ Math.imul(f + 1, 0x9e3779b1);
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const x = center.x + dx;
        const z = center.z + dz;
        const d = Math.sqrt(dx * dx + dz * dz);
        const ir = radius + (fhash01(x, waterY, z, fs) - 0.5) * 0.85;
        if (d > ir || !water.has(xz(x, z))) continue;
        let h = Math.max(0, peak - Math.floor(d * 1.35));
        h += fhash01(x, waterY, z, fs) > 0.78 ? 1 : 0;
        let bottom = waterY;
        while (bottom > waterY - 7 && !isSiftTerrain(lv.getBlockState(x, bottom, z))) bottom--;
        for (let y = bottom; y <= waterY + h; y++) {
          if (!bd.contains(x, z) || !lv.ensureCanWrite(x, y, z)) continue;
          const belowTop = y >= waterY - 1 ? pal.basin : B.SIFTSLATE;
          lv.setBlock(x, y, z, y === waterY + h ? islandSurface(pal.shore, lv.getBlockState(x, y - 1, z)) : belowTop);
          placed++;
        }
      }
    }
  }
  return placed;
}

function placeWillowIsland(lv, rng, water, waterY, pal, salt, bd, center) {
  const rX = 6.7 + rng.nextDouble() * 0.9;
  const rZ = 5.5 + rng.nextDouble() * 0.9;
  const rot = rng.nextDouble() * Math.PI;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const ph = rng.nextDouble() * Math.PI * 2;
  const isalt = salt ^ 0x57494c;
  const lim = Math.ceil(Math.max(rX, rZ) + 1);
  const surface = new Map();
  for (let dx = -lim; dx <= lim; dx++) {
    for (let dz = -lim; dz <= lim; dz++) {
      const x = center.x + dx;
      const z = center.z + dz;
      if (!water.has(xz(x, z)) || !bd.contains(x, z)) continue;
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      const n = Math.sqrt((lx * lx) / (rX * rX) + (lz * lz) / (rZ * rZ));
      const th = Math.atan2(lz, lx);
      const edge = 1 + Math.sin(th * 3 + ph) * 0.075 + Math.sin(th * 5 - ph * 0.63) * 0.045;
      if (n > edge) continue;
      surface.set(xz(x, z), { x, z, top: waterY + clamp(Math.floor((1 - n / edge) * 3.15), 0, 3) });
    }
  }
  if (surface.size < 70) return 0;
  let placed = 0;
  for (const c of surface.values()) {
    let bottom = waterY;
    while (bottom > waterY - 7 && !isSiftTerrain(lv.getBlockState(c.x, bottom, c.z))) bottom--;
    const patch = fhash01(c.x >> 1, c.top, c.z >> 1, isalt);
    const surf = patch < 0.13 ? B.DRY : patch < 0.38 ? B.HEALTHY : B.GROWTH;
    for (let y = bottom; y <= c.top; y++) {
      if (!lv.ensureCanWrite(c.x, y, c.z)) continue;
      let st;
      if (y === c.top) st = islandSurface(surf, lv.getBlockState(c.x, y - 1, c.z));
      else if (y >= waterY && patch < 0.38) st = patch < 0.13 ? B.DRY : B.HEALTHY;
      else st = y >= c.top - 2 ? pal.basin : B.SIFTSLATE;
      lv.setBlock(c.x, y, c.z, st);
      placed++;
    }
    const above = lv.getBlockState(c.x, c.top + 1, c.z);
    if (lv.ensureCanWrite(c.x, c.top + 1, c.z) && (above === B.ICHOR || canReplace(above) || isIchorSnow(above))) lv.setBlock(c.x, c.top + 1, c.z, AIR);
  }
  let root = surface.get(xz(center.x, center.z));
  if (!root) {
    let bd2 = Infinity;
    for (const c of surface.values()) {
      const d = square(c.x - center.x) + square(c.z - center.z);
      if (d < bd2) {
        bd2 = d;
        root = c;
      }
    }
  }
  if (root && !intersectsPortal(root.x, root.z, 12) && isTreeGround(lv.getBlockState(root.x, root.top, root.z))) {
    placeWillow(lv, rng, root.x, root.top + 1, root.z, bd, WILLOW.small);
  }
  for (const c of surface.values()) decorate(lv, rng, c.x, c.top, c.z, 2.85);
  return placed;
}

function decorateShore(lv, rng, water, shoreTargets, bd) {
  const band = buildBeachMask(water, 4);
  const shore = [];
  for (const [k, c] of band) {
    if (!bd.contains(c.x, c.z)) continue;
    const t = shoreTargets.get(k);
    const fy = t !== undefined ? t : findTerrainSurface(lv, c.x, c.z) - 1;
    if (fy >= 0) shore.push([c.x, fy, c.z]);
  }
  decorateLakeShore(lv, rng, shore);
}

function hasNearbyIchor(lv, bd, cx, cz, radius) {
  for (let dx = -radius; dx <= radius; dx += 5) {
    for (let dz = -radius; dz <= radius; dz += 5) {
      if (dx * dx + dz * dz > radius * radius || !bd.contains(cx + dx, cz + dz)) continue;
      const s = findTerrainSurface(lv, cx + dx, cz + dz);
      if (s < 0) continue;
      for (let dy = -6; dy <= 1; dy++) if (lv.getBlockState(cx + dx, s + dy, cz + dz) === B.ICHOR) return true;
    }
  }
  return false;
}

function findCascadeSite(lv, bd, cx, cz) {
  let best = null;
  let bestScore = -Infinity;
  for (let d = 0; d < 16; d++) {
    const a = (d * Math.PI * 2) / 16;
    const fx = Math.cos(a);
    const fz = Math.sin(a);
    const ux = cx - jround(fx * 7);
    const uz = cz - jround(fz * 7);
    const lx = cx + jround(fx * 9);
    const lz = cz + jround(fz * 9);
    if (!bd.contains(ux, uz) || !bd.contains(lx, lz)) continue;
    const us = findTerrainSurface(lv, ux, uz);
    const ls = findTerrainSurface(lv, lx, lz);
    if (us < 0 || ls < 0) continue;
    const drop = us - ls;
    if (drop < 10 || drop > 34) continue;
    const ur = sampleRelief(lv, bd, ux, uz, 4);
    const lr = sampleRelief(lv, bd, lx, lz, 7);
    if (ur < 0 || lr < 0 || ur > 4 || lr > 5) continue;
    const minX = Math.min(ux - 8, lx - 12);
    const maxX = Math.max(ux + 8, lx + 12);
    const minZ = Math.min(uz - 8, lz - 12);
    const maxZ = Math.max(uz + 8, lz + 12);
    if (!bd.contains(minX, minZ) || !bd.contains(maxX, maxZ) || intersectsPortalRect(minX, minZ, maxX, maxZ)) continue;
    const score = drop * 8 - ur * 3 - lr * 2;
    if (score > bestScore) {
      bestScore = score;
      best = { ux, uy: us - 1, uz, lx, ly: ls - 1, lz, fx, fz };
    }
  }
  return best;
}

function placeCascade(lv, rng, bd, site, pal) {
  const salt = rng.nextLong();
  const rX = 10 + rng.nextInt(2);
  const rZ = 9 + rng.nextInt(2);
  const width = 4;
  const angle = Math.atan2(site.fz, site.fx);
  const lower = buildWaterMask(lv, bd, site.lx, site.lz, rX, rZ, angle, Math.cos(angle), Math.sin(angle), salt);
  if (lower.size < 135) return 0;
  const surf = [...lower.values()].map((c) => c.surfaceY).sort((a, b) => a - b);
  const lowerY = surf[surf.length >> 1] - 1;
  if (surf[surf.length - 1] - surf[0] > 5) return 0;
  const beach = buildBeachMask(lower, width);
  const beachCols = validateBeach(lv, bd, beach, width, lowerY, 5);
  if (!beachCols || !beachCols.size) return 0;
  const targets = buildShoreTargets(lv, lower, beach, beachCols, lowerY, width);
  if (!targets || !targets.size) return 0;
  // plataforma de cima
  const shelf = new Map();
  const topY = site.uy;
  for (let dx = -10; dx <= 10; dx++) {
    for (let dz = -10; dz <= 10; dz++) {
      const fwd = dx * site.fx + dz * site.fz;
      const side = -dx * site.fz + dz * site.fx;
      const fr = fwd >= 0 ? 8.5 : 8.8;
      const dist = Math.sqrt((fwd * fwd) / (fr * fr) + (side * side) / 77.44);
      const edge = 1 + (fhash01((site.ux + dx) >> 1, topY, (site.uz + dz) >> 1, salt) - 0.5) * 0.13;
      if (dist > edge) continue;
      const x = site.ux + dx;
      const z = site.uz + dz;
      if (!bd.contains(x, z)) return 0;
      const sy = findTerrainSurface(lv, x, z);
      if (sy < 0 || !hasNaturalSupport(lv, x, sy - 1, z, 3)) return 0;
      const nt = sy - 1;
      if (nt > topY + 5 || topY - nt > 26) return 0;
      shelf.set(xz(x, z), { x, z, nt, nd: dist, fwd, side });
    }
  }
  if (shelf.size < 155) return 0;
  const pond = new Map();
  const pcx = site.ux - site.fx * 1.8;
  const pcz = site.uz - site.fz * 1.8;
  for (const c of shelf.values()) {
    const dx = c.x - pcx;
    const dz = c.z - pcz;
    const fwd = dx * site.fx + dz * site.fz;
    const side = -dx * site.fz + dz * site.fx;
    const dist = Math.sqrt((fwd * fwd) / 32.49 + (side * side) / 27.04);
    const edge = 1 + (fhash01(c.x, topY, c.z, salt ^ 0x706f6e64) - 0.5) * 0.12;
    if (dist <= edge) pond.set(xz(c.x, c.z), { x: c.x, z: c.z, nd: dist / edge });
  }
  if (pond.size < 52) return 0;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const c of [...beach.values(), ...shelf.values()]) {
    minX = Math.min(minX, c.x);
    minZ = Math.min(minZ, c.z);
    maxX = Math.max(maxX, c.x);
    maxZ = Math.max(maxZ, c.z);
  }
  if (!tryReserve(lv, "ichor_lake", minX, minZ, maxX, maxZ)) return 0;
  let placed = 0;
  for (const [k, c] of beachCols) placed += shapeBeach(lv, c, targets.get(k), pal, bd);
  for (const c of lower.values()) placed += carveAndFill(lv, c, lowerY, pal.basin, salt ^ 0x4c4f57, 5, bd);
  // molda a plataforma
  for (const c of shelf.values()) {
    const t = clamp((c.nd - 1) / (0.7 - 1), 0, 1);
    const edgeS = t * t * (3 - 2 * t);
    const core = c.fwd >= -3 && c.fwd <= 7.6 && Math.abs(c.side) <= 3.8;
    const tt = Math.floor(lerp(core ? 1 : edgeS, c.nt, topY) + 0.5);
    for (let y = tt + 1; y <= Math.max(c.nt + 3, tt + 3); y++) {
      const s = lv.getBlockState(c.x, y, c.z);
      if (lv.ensureCanWrite(c.x, y, c.z) && (canReplace(s) || isIchorSnow(s))) lv.setBlock(c.x, y, c.z, AIR);
    }
    for (let y = Math.min(c.nt, tt) - 2; y <= tt; y++) {
      if (!lv.ensureCanWrite(c.x, y, c.z)) continue;
      lv.setBlock(c.x, y, c.z, y === tt ? pal.shore : y <= tt - 2 ? B.SIFTSLATE : pal.basin);
      placed++;
    }
  }
  for (const c of pond.values()) {
    const cs = 1 - clamp(c.nd, 0, 1);
    const depth = clamp(1 + Math.floor(cs * 2.8 + fhash01(c.x, topY, c.z, salt) * 0.55), 1, 4);
    const fy = topY - depth;
    for (let y = fy - 1; y <= fy; y++) if (lv.ensureCanWrite(c.x, y, c.z)) lv.setBlock(c.x, y, c.z, pal.basin);
    for (let y = fy + 1; y <= topY; y++) if (lv.ensureCanWrite(c.x, y, c.z)) lv.setBlock(c.x, y, c.z, B.ICHOR);
    if (lv.ensureCanWrite(c.x, topY + 1, c.z)) lv.setBlock(c.x, topY + 1, c.z, AIR);
  }
  // canal e queda
  const sideX = -site.fz;
  const sideZ = site.fx;
  const cell = (x, y, z) => {
    if (!bd.contains(x, z) || !lv.ensureCanWrite(x, y, z)) return;
    lv.setBlock(x, y - 1, z, pal.basin);
    lv.setBlock(x, y, z, B.ICHOR);
    lv.setBlock(x, y + 1, z, AIR);
  };
  for (let s = 1; s <= 7; s++) {
    const ccx = site.ux + jround(site.fx * s);
    const ccz = site.uz + jround(site.fz * s);
    const hw = s < 3 ? 2 : 3;
    for (let l = -hw; l <= hw; l++) cell(ccx + jround(sideX * l), topY, ccz + jround(sideZ * l));
  }
  const lipX = site.ux + jround(site.fx * 7);
  const lipZ = site.uz + jround(site.fz * 7);
  for (let l = -3; l <= 3; l++) {
    const x = lipX + jround(sideX * l);
    const z = lipZ + jround(sideZ * l);
    for (let y = lowerY; y <= topY; y++) if (bd.contains(x, z) && lv.ensureCanWrite(x, y, z)) lv.setBlock(x, y, z, B.ICHOR);
  }
  const len = Math.max(1, Math.ceil(Math.hypot(site.lx - lipX, site.lz - lipZ)));
  for (let s = 0; s <= len; s++) {
    const p = s / len;
    cell(Math.floor(lerp(p, lipX, site.lx) + 0.5), lowerY, Math.floor(lerp(p, lipZ, site.lz) + 0.5));
  }
  if (rng.nextFloat() < 0.88) placed += placeRockFormations(lv, rng, lower, lowerY, pal, salt ^ 0x524f434b, bd);
  decorateShore(lv, rng, lower, targets, bd);
  return placed;
}

function ichorLake(lv, rng, ox, oy, oz) {
  const bd = bounds(lv, 1);
  const cx = (ox & -16) + 9;
  const cz = (oz & -16) + 9;
  if (findTerrainSurface(lv, cx, cz) < 0) return false;
  const relief = sampleRelief(lv, bd, cx, cz, 16);
  if (relief < 0) return false;
  const cascade = relief >= 9 ? findCascadeSite(lv, bd, cx, cz) : null;
  if (cascade && rng.nextFloat() < 0.82) {
    const pal = choosePalette(lv, cascade.lx, cascade.ly, cascade.lz, rng);
    return placeCascade(lv, rng, bd, cascade, pal) > 0;
  }
  let v;
  if (relief <= 3) v = VARIANTS.MEGA;
  else {
    const roll = rng.nextInt(100);
    v = relief <= 5 && roll < 72 ? VARIANTS.LARGE : relief <= 7 && roll < 82 ? VARIANTS.MEDIUM : VARIANTS.SMALL;
  }
  if (hasNearbyIchor(lv, bd, cx, cz, v.mega ? 20 : 15)) return false;
  const expanded = v.mega && rng.nextFloat() < 0.68;
  const rX = expanded ? 15 + rng.nextInt(2) : v.min + rng.nextInt(v.max - v.min + 1);
  const rZ = expanded ? clamp(rX + rng.nextInt(5) - 2, 14, 16) : clamp(rX + rng.nextInt(7) - 3, v.min, v.max);
  const width = expanded ? 5 : v.minBeach + rng.nextInt(v.maxBeach - v.minBeach + 1);
  const extent = Math.ceil(Math.max(rX, rZ) * 1.14) + width;
  if (extent > 24 || intersectsPortalRect(cx - extent, cz - extent, cx + extent, cz + extent)) return false;
  const angle = rng.nextDouble() * Math.PI;
  const salt = rng.nextLong();
  const water = buildWaterMask(lv, bd, cx, cz, rX, rZ, angle, Math.cos(angle), Math.sin(angle), salt);
  if (water.size < v.area) return false;
  const beach = buildBeachMask(water, width);
  const surfaces = [...water.values()].map((c) => c.surfaceY).sort((a, b) => a - b);
  if (surfaces[surfaces.length - 1] - surfaces[0] > v.relief) return false;
  const waterY = surfaces[Math.floor((surfaces.length - 1) * 0.36)] - 1;
  if (waterY < 6 || waterY > lv.getMaxY() - 7) return false;
  const beachCols = validateBeach(lv, bd, beach, width, waterY, v.relief);
  if (!beachCols) return false;
  const targets = buildShoreTargets(lv, water, beach, beachCols, waterY, width);
  if (!targets || !targets.size) return false;
  const pal = choosePalette(lv, cx, waterY, cz, rng);
  if (!tryReserve(lv, "ichor_lake", cx - extent, cz - extent, cx + extent, cz + extent)) return false;
  let placed = 0;
  for (const [k, c] of beachCols) placed += shapeBeach(lv, c, targets.get(k), pal, bd);
  for (const c of water.values()) placed += carveAndFill(lv, c, waterY, pal.basin, salt, v.depth, bd);
  if (v.mega || (v.rocks && rng.nextFloat() < 0.82)) placed += placeRockFormations(lv, rng, water, waterY, pal, salt, bd);
  decorateShore(lv, rng, water, targets, bd);
  return placed >= v.area;
}

// ---------------------------------------------------------------------------
// SoulCanyonFeature
// ---------------------------------------------------------------------------
const SOUL_TERRAIN = (b) => isSiftTerrain(b) || b === B.SCULK || b === B.SOUL || /siftslate_\w+_ore$/.test(nameOf(b));
const CARVABLE_EXTRA = new Set(["ichor_snow", "ichor_snow_block", "sculk_vein", "sculk_sensor", "sculk_shrieker", "sculk_catalyst",
  "overgrown_fronds", "overgrown_chard", "overgrown_stalks", "siftslate_stalks", "healthy_sculk_sprouts",
  "dry_healthy_sculk_sprouts", "siftslate_hanging_roots", "overgrown_hanging_roots"]);
const soulCarvable = (b) => b === AIR || SOUL_TERRAIN(b) || CARVABLE_EXTRA.has(nameOf(b));
const hashUnit = (x, z, salt) => hashInts(x, z, salt, 0x534f554c) / 4294967296;

function soulSurface(lv, x, z) {
  const top = lv.getHeight(x, z) - 1;
  for (let y = top; y >= Math.max(1, top - 64); y--) if (SOUL_TERRAIN(lv.getBlockState(x, y, z))) return y;
  return -1;
}

function soulPlan(lv, bd, cx, cz, length, baseRadius, maxDepth, ph, orientation) {
  const dX = (orientation & 1) === 0 ? 0.7071067811865476 : -0.7071067811865476;
  const dZ = (orientation & 2) === 0 ? 0.7071067811865476 : -0.7071067811865476;
  const sX = -dZ;
  const sZ = dX;
  const half = Math.floor(length / 2);
  const cols = new Map();
  let entrance = null;
  let midpoint = null;
  let prevFloor = null;
  let prevSurf = null;
  for (let step = 0; step < length; step++) {
    const off = step - half;
    const meander = Math.sin(ph + step * 0.22) * 1.65 + Math.sin(ph * 1.73 + step * 0.071) * 0.7;
    const radius = Math.max(3, baseRadius + jround(Math.sin(ph * 0.63 + step * 0.39)));
    const ex = cx + dX * off + sX * meander;
    const ez = cz + dZ * off + sZ * meander;
    const sx = jround(ex);
    const sz = jround(ez);
    const cs = soulSurface(lv, sx, sz);
    if (cs < 0) return null;
    if (prevSurf !== null && Math.abs(cs - prevSurf) > 6) return null;
    prevSurf = cs;
    const prog = step / Math.max(1, length - 1);
    const ramp = Math.min(maxDepth, 1 + jround(step * 0.67));
    const far = smootherstep(clamp((1 - prog) / 0.34, 0, 1));
    const cfd = 1 + jround((ramp - 1) * far);
    const desired = cs - cfd;
    const floor = prevFloor === null ? desired : Math.max(prevFloor - 1, Math.min(prevFloor + 1, desired));
    if (cs <= floor || cs - floor > maxDepth + 14) return null;
    prevFloor = floor;
    if (step === 0) entrance = [sx, floor + 1, sz];
    if (step === jround((length - 1) * 0.38)) midpoint = [sx, floor + 1, sz];
    const rr = radius + 2;
    for (let x = Math.floor(ex) - rr; x <= Math.ceil(ex) + rr; x++) {
      for (let z = Math.floor(ez) - rr; z <= Math.ceil(ez) + rr; z++) {
        const rx = x - ex;
        const rz = z - ez;
        const along = Math.abs(rx * dX + rz * dZ);
        const signed = rx * sX + rz * sZ;
        const sd = Math.abs(signed);
        if (along > 0.82 || sd > radius + 0.35) continue;
        if (!bd.contains(x, z)) return null;
        const ratio = sd / (radius + 0.35);
        const arch = Math.sqrt(Math.max(0, 1 - ratio * ratio));
        const sy = soulSurface(lv, x, z);
        if (sy < 0) return null;
        const corridor = sd <= 1.55;
        if (corridor && (sy < floor || Math.abs(sy - cs) > 7)) return null;
        const depth = Math.max(1, jround((sy - floor) * arch));
        if (sd > radius - 0.35 && hashUnit(x, z, maxDepth) < 0.18) continue;
        const fy = corridor ? floor : sy - depth;
        if (fy <= 3) return null;
        const k = xz(x, z);
        const prev = cols.get(k);
        if (!prev || fy < prev.floorY) {
          cols.set(k, { x, z, surfaceY: sy, floorY: fy, depth: sy - fy, progress: prog, along: step, side: jround(sd), signed });
        }
      }
    }
  }
  const verify = (m) => {
    if (!m) return null;
    const c = cols.get(xz(m[0], m[2]));
    return c ? [m[0], c.floorY + 1, m[2]] : null;
  };
  const e = verify(entrance);
  const m = verify(midpoint);
  return e && m ? { cols, entrance: e, midpoint: m, length, baseRadius } : null;
}

function soulVeins(plan, ph, maxDepth) {
  const out = [];
  const reach = new Set();
  const start = plan.cols.get(xz(plan.midpoint[0], plan.midpoint[2]));
  if (start) {
    const q = [start];
    reach.add(xz(start.x, start.z));
    while (q.length) {
      const c = q.shift();
      for (const s of STEPS4) {
        const k = xz(c.x + s[0], c.z + s[1]);
        const n = plan.cols.get(k);
        if (n && !reach.has(k) && Math.abs(n.floorY - c.floorY) <= 1) {
          reach.add(k);
          q.push(n);
        }
      }
    }
  }
  const golem = (t) => {
    for (const sx of [t.x - 1, t.x]) {
      for (const sz of [t.z - 1, t.z]) {
        let ok = true;
        let step = false;
        for (let dx = 0; dx <= 1 && ok; dx++) {
          for (let dz = 0; dz <= 1; dz++) {
            const c = plan.cols.get(xz(sx + dx, sz + dz));
            if (!c || c.floorY > t.floorY || c.floorY < t.floorY - 1) {
              ok = false;
              break;
            }
            if (c.x !== t.x || c.z !== t.z) step = true;
          }
        }
        if (ok && step) return true;
      }
    }
    return false;
  };
  for (const c of plan.cols.values()) {
    if (c.depth < maxDepth * 0.5 || c.progress < 0.53 || c.progress > 0.86 || c.side > plan.baseRadius) continue;
    if (!reach.has(xz(c.x, c.z)) || !golem(c)) continue;
    const a = c.along;
    const vc = Math.sin(ph + a * 0.31) * 1.15 + Math.sin(ph * 0.71 + a * 0.13) * 0.48;
    const w = 0.82 + (Math.sin(ph * 1.37 + a * 0.43) + 1) * 0.24;
    const er = Math.abs(c.signed - vc) / w;
    const grain = hashUnit(c.x, c.z, maxDepth * 31);
    const winding = er <= 1 && (er < 0.48 || grain > 0.2 + er * 0.42);
    const p1 = square((c.progress - 0.63) / 0.055) + square((c.signed + 1.65 + Math.sin(ph) * 0.55) / 1.55);
    const p2 = square((c.progress - 0.77) / 0.048) + square((c.signed - 1.35 - Math.cos(ph) * 0.45) / 1.35);
    const pocket = Math.min(p1, p2) <= 1 && grain > 0.16;
    if (winding || pocket) out.push([c.x, c.floorY, c.z]);
  }
  return out;
}

function soulCanyon(lv, rng, ox, oy, oz) {
  if (!isSelectedChunk(lv, ox, oz, 12, 0x534f5543)) return false;
  const cx = (ox & -16) + 8;
  const cz = (oz & -16) + 8;
  if (intersectsPortal(cx, cz, 34)) return false;
  const bd = bounds(lv, 0);
  const length = 49 + rng.nextInt(3);
  const baseRadius = 4 + rng.nextInt(2);
  const maxDepth = 22 + rng.nextInt(5);
  const ph0 = rng.nextDouble() * Math.PI * 2;
  const first = rng.nextInt(4);
  let plan = null;
  let souls = null;
  for (let a = 0; a < 8 && !plan; a++) {
    const orient = (first + a) & 3;
    const ph = ph0 + Math.floor(a / 4) * 1.941611038725466;
    const c = soulPlan(lv, bd, cx, cz, length, baseRadius, maxDepth, ph, orient);
    if (!c) continue;
    let ok = true;
    for (const col of c.cols.values()) {
      if (!SOUL_TERRAIN(lv.getBlockState(col.x, col.floorY, col.z))) { ok = false; break; }
      for (let y = col.floorY + 1; y <= col.surfaceY + 2 && ok; y++) {
        if (!soulCarvable(lv.getBlockState(col.x, y, col.z)) || !lv.ensureCanWrite(col.x, y, col.z)) ok = false;
      }
      if (!ok) break;
    }
    if (!ok) continue;
    const s = soulVeins(c, ph, maxDepth);
    if (s.length >= 8) {
      plan = c;
      souls = s;
    }
  }
  if (!plan) return false;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const c of plan.cols.values()) {
    minX = Math.min(minX, c.x);
    minZ = Math.min(minZ, c.z);
    maxX = Math.max(maxX, c.x);
    maxZ = Math.max(maxZ, c.z);
  }
  if (!tryReserve(lv, "soul_canyon", minX - 2, minZ - 2, maxX + 2, maxZ + 2)) return false;
  for (const c of plan.cols.values()) for (let y = c.floorY + 1; y <= c.surfaceY + 2; y++) lv.setBlock(c.x, y, c.z, AIR);
  for (const s of souls) lv.setBlock(s[0], s[1], s[2], B.SOUL);
  return true;
}

// ---------------------------------------------------------------------------
// SnifferCaveFeature
// ---------------------------------------------------------------------------
const H4 = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N, L, S, O
const cwOf = (d) => (d + 1) % 4;
const pk = (x, y, z) => x + "," + y + "," + z;
const unpk = (k) => k.split(",").map(Number);
const NEST_PLANTS = () => [B.FRONDS, B.CHARD, B.STALKS, B.SLATE_STALKS, B.SPROUTS, B.DRY_SPROUTS];

function addEllipsoid(cx, cy, cz, rX, rY, rZ, interior, shell) {
  const mx = Math.ceil(rX + 1);
  const my = Math.ceil(rY + 1);
  const mz = Math.ceil(rZ + 1);
  for (let dx = -mx; dx <= mx; dx++) {
    for (let dy = -my; dy <= my; dy++) {
      for (let dz = -mz; dz <= mz; dz++) {
        const k = pk(cx + dx, cy + dy, cz + dz);
        if (square(dx / rX) + square(dy / rY) + square(dz / rZ) <= 1) interior.add(k);
        else if (square(dx / (rX + 1)) + square(dy / (rY + 1)) + square(dz / (rZ + 1)) <= 1) shell.add(k);
      }
    }
  }
}

function snifferCave(cellChunks, salt, candidates) {
  const terrain = (b) => b === B.SIFTSLATE || b === B.GROWTH || b === B.DRY_GROWTH || b === B.HEALTHY || b === B.DRY;
  const findFloor = (lv, x, z, around) => {
    for (let y = around + 3; y >= around - 7; y--) {
      if (lv.getBlockState(x, y, z) === AIR && terrain(lv.getBlockState(x, y - 1, z))) return [x, y - 1, z];
    }
    return null;
  };
  return (lv, rng, ox, oy, oz) => {
    if (!isSelectedChunk(lv, ox, oz, cellChunks, salt, candidates)) return false;
    const bd = bounds(lv, 1);
    const inb = (x, y, z) => bd.contains(x, z);
    const length = 14 + rng.nextInt(3);
    const ex = (ox & -16) + 8;
    const ez = (oz & -16) + 8;
    const ey = lv.getHeight(ex, ez);
    if (!(ey > 18 && terrain(lv.getBlockState(ex, ey - 1, ez)))) return false;
    // direção
    const start = rng.nextInt(4);
    let dir = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < 4; i++) {
      const d = (start + i) % 4;
      const endX = ex + H4[d][0] * (length + 1);
      const endZ = ez + H4[d][1] * (length + 1);
      const endY = ey - 8;
      if (!bd.contains(endX + 6, endZ + 6) || !bd.contains(endX - 6, endZ - 6)) continue;
      const cover = lv.getHeight(endX, endZ) - endY;
      if (cover >= 5) {
        const score = cover + rng.nextInt(4);
        if (score > bestScore) {
          bestScore = score;
          dir = d;
        }
      }
    }
    if (dir < 0) return false;
    const side = cwOf(dir);
    const interior = new Set();
    const shell = new Set();
    const ph = rng.nextDouble() * Math.PI * 2;
    let last = [ex, ey, ez];
    for (let dist = 0; dist <= length; dist += 2) {
      const p = dist / length;
      const lat = jround(Math.sin(ph + p * Math.PI * 1.7) * (0.6 + p * 1.35));
      const lift = jround(Math.sin(p * Math.PI) * 0.9) - jround(p * 9);
      const c = [ex + H4[dir][0] * dist + H4[side][0] * lat, ey + lift, ez + H4[dir][1] * dist + H4[side][1] * lat];
      const swell = Math.sin(p * Math.PI);
      const rxz = 2.1 + swell * 1.65 + rng.nextDouble() * 0.35;
      const ry = 1.9 + swell * 1.15 + rng.nextDouble() * 0.25;
      addEllipsoid(c[0], c[1], c[2], rxz, ry, rxz * 0.92, interior, shell);
      last = c;
    }
    const nest = [last[0] + H4[dir][0], last[1] + 1, last[2] + H4[dir][1]];
    addEllipsoid(nest[0], nest[1], nest[2], 5.2, 3.7, 5.0, interior, shell);
    // poça de ichor
    const variant = rng.nextInt(4);
    const outward = rng.nextBoolean() ? side : (side + 2) % 4;
    const chO = [4.0, 4.4, 3.8, 4.1][variant];
    const chC = [3.0, 2.7, 3.5, 3.1][variant];
    const chV = variant === 3 ? 3.0 : 2.7;
    const pc = [nest[0] + H4[outward][0] * 5, nest[1] - 1, nest[2] + H4[outward][1] * 5];
    const alongX = outward % 2 === 1;
    addEllipsoid(pc[0], pc[1], pc[2], alongX ? chO : chC, chV, alongX ? chC : chO, interior, shell);
    for (const k of interior) shell.delete(k);
    const oR = [2, 3, 2, 3][variant];
    const cR = [2, 2, 3, 2][variant];
    const cross = cwOf(outward);
    const surface = new Set();
    const fluid = new Set();
    const lining = new Set();
    const clearance = new Set();
    for (let a = -oR; a <= oR; a++) {
      for (let c = -cR; c <= cR; c++) {
        const n = square(a / (oR + 0.35)) + square(c / (cR + 0.35));
        const wob = Math.sin(a * 2.17 + c * 1.41 + variant * 0.83) * 0.11;
        if (n > 1 + wob) continue;
        const t = [pc[0] + H4[outward][0] * a + H4[cross][0] * c, pc[1] - 3, pc[2] + H4[outward][1] * a + H4[cross][1] * c];
        surface.add(pk(...t));
        fluid.add(pk(...t));
        if (variant === 3 && n < 0.55) fluid.add(pk(t[0], t[1] - 1, t[2]));
      }
    }
    for (const k of fluid) {
      const [x, y, z] = unpk(k);
      lining.add(pk(x, y - 1, z));
      for (const s of H4) lining.add(pk(x + s[0], y, z + s[1]));
    }
    for (const k of fluid) lining.delete(k);
    for (const k of surface) {
      const [x, y, z] = unpk(k);
      for (let dy = 1; dy <= 3; dy++) clearance.add(pk(x, y + dy, z));
      for (const s of H4) {
        const bx = x + s[0];
        const bz = z + s[1];
        if (surface.has(pk(bx, y, bz))) continue;
        lining.add(pk(bx, y - 1, bz));
        lining.add(pk(bx, y - 2, bz));
        clearance.add(pk(bx, y + 1, bz));
        clearance.add(pk(bx, y + 2, bz));
      }
    }
    for (const k of fluid) lining.delete(k);
    const writes = new Set([...interior, ...shell, ...fluid, ...lining, ...clearance]);
    if (intersectsPortal(nest[0], nest[2], 12)) return false;
    // massa sólida em volta do ninho
    let solid = 0;
    let total = 0;
    for (let dx = -5; dx <= 5; dx += 2) {
      for (let dy = -3; dy <= 3; dy += 2) {
        for (let dz = -5; dz <= 5; dz += 2) {
          total++;
          if (!bd.contains(nest[0] + dx, nest[2] + dz)) return false;
          if (terrain(lv.getBlockState(nest[0] + dx, nest[1] + dy, nest[2] + dz))) solid++;
        }
      }
    }
    if (solid < total * 0.56) return false;
    let mass = 0;
    for (const k of writes) {
      const [x, y, z] = unpk(k);
      if (!inb(x, y, z) || !lv.ensureCanWrite(x, y, z)) return false;
      const s = lv.getBlockState(x, y, z);
      if (s === B.REINFORCED || isWillowTrunk(s) || nameOf(s) === "sift_portal" || nameOf(s).startsWith("sonorous")) return false;
      if (terrain(s)) mass++;
      else if (s !== AIR && !CARVABLE_EXTRA.has(nameOf(s))) return false;
    }
    if (mass < writes.size * 0.4) return false;
    for (const k of shell) {
      const [x, y, z] = unpk(k);
      if (!inb(x, y, z)) return false;
      if (terrain(lv.getBlockState(x, y, z)) && lv.ensureCanWrite(x, y, z)) {
        const hc = 0.18 + (square(x - nest[0]) + square(y - nest[1]) + square(z - nest[2]) < 90 ? 0.13 : 0);
        lv.setBlock(x, y, z, rng.nextFloat() < hc ? B.HEALTHY : B.DRY);
      }
    }
    for (const k of interior) {
      const [x, y, z] = unpk(k);
      if (inb(x, y, z) && lv.ensureCanWrite(x, y, z)) lv.setBlock(x, y, z, AIR);
    }
    for (const k of clearance) lv.setBlock(...unpk(k), AIR);
    for (const k of lining) lv.setBlock(...unpk(k), rng.nextFloat() < 0.55 ? B.HEALTHY : B.DRY);
    for (const k of fluid) lv.setBlock(...unpk(k), B.ICHOR);
    // plantas do farejador
    const sample = [...interior];
    let placed = 0;
    const torch = rng.nextFloat() < 0.6;
    for (let a = 0; a < 72 && placed < 14; a++) {
      const [x, , z] = unpk(sample[rng.nextInt(sample.length)]);
      const f = findFloor(lv, x, z, nest[1]);
      if (!f || !lv.isEmptyBlock(f[0], f[1] + 1, f[2])) continue;
      const fs = lv.getBlockState(f[0], f[1], f[2]);
      if ((fs === B.HEALTHY || fs === B.DRY) && snifferPlant(lv, rng, f[0], f[1] + 1, f[2], torch)) placed++;
    }
    // ninho
    const nestBlocks = [];
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        const d = square(dx / 3.25) + square(dz / 3.25);
        if (d > 1 || (d > 0.68 && rng.nextFloat() < 0.34)) continue;
        const f = findFloor(lv, nest[0] + dx, nest[2] + dz, nest[1]);
        if (!f || !lv.isEmptyBlock(f[0], f[1] + 1, f[2])) continue;
        const cur = lv.getBlockState(f[0], f[1], f[2]);
        if (cur === B.HEALTHY || cur === B.DRY) {
          lv.setBlock(f[0], f[1], f[2], B.FOLIAGE);
          nestBlocks.push(f);
        }
      }
    }
    if (!nestBlocks.length) return true;
    const onNest = (st) => {
      for (let a = 0; a < 18; a++) {
        const n = nestBlocks[rng.nextInt(nestBlocks.length)];
        if (lv.isEmptyBlock(n[0], n[1] + 1, n[2])) {
          lv.setBlock(n[0], n[1] + 1, n[2], st);
          return;
        }
      }
    };
    let eggs = rng.nextFloat() < 0.5 ? 1 : 0;
    if (eggs === 1 && rng.nextFloat() < 0.1) eggs++;
    for (let i = 0; i < eggs; i++) onNest(B.SNIFFER_EGG);
    const plants = 4 + rng.nextInt(5);
    const np = NEST_PLANTS();
    for (let i = 0; i < plants; i++) onNest(np[rng.nextInt(np.length)]);
    // a família de farejadores
    const spot = (i) => nestBlocks[i % nestBlocks.length];
    const s0 = spot(0);
    const s1 = spot(Math.floor(nestBlocks.length / 2));
    lv.spawnLater("minecraft:sniffer", s0[0] + 0.5, s0[1] + 1, s0[2] + 0.5);
    lv.spawnLater("minecraft:sniffer", s1[0] + 0.5, s1[1] + 1, s1[2] + 0.5);
    if (rng.nextFloat() < 0.33) {
      const s2 = spot(nestBlocks.length - 1);
      lv.spawnLater("minecraft:sniffer", s2[0] + 0.5, s2[1] + 1, s2[2] + 0.5, { baby: true });
    }
    return true;
  };
}

// ---------------------------------------------------------------------------
// AbandonedMainPortalFeature
// ---------------------------------------------------------------------------
const PORTAL_PIVOT = [4, 19];
const NATURAL = ["siftslate", "siftslate_growth", "healthy_sculk", "dry_healthy_sculk", "dry_healthy_sculk_growth"];
const portalCanReplace = (b) => canReplace(b) || b === B.SLATE_ROOTS || b === B.OVERGROWN_ROOTS;

function blendNoise(x, z, salt) {
  const ph = (salt & 65535) * 1.91e-4;
  return Math.sin(x * 0.087 + z * 0.039 + ph) * 0.5 + Math.cos(x * 0.043 - z * 0.074 - ph * 0.71) * 0.33 +
    Math.sin((x + z) * 0.023 + ph * 1.83) * 0.17;
}

function abandonedPortal(lv, rng, ox, oy, oz) {
  if (!isSelectedChunk(lv, ox, oz, 32, 0x41424e44)) return false;
  const bd = bounds(lv, 1);
  const cx = (ox & -16) + 8;
  const cz = (oz & -16) + 8;
  const sy = lv.getHeight(cx, cz) - 1;
  if (sy <= 4 || intersectsPortal(cx, cz, 28) || !isSiftTerrain(lv.getBlockState(cx, sy, cz))) return false;
  const b = lv.getBiome(cx, sy, cz);
  const over = b.startsWith("overgrown_") || b === "ichor_snowy_peaks";
  const tname = (over ? "abandoned_portal_overgrown_" : "abandoned_portal_wastes_") + (rng.nextInt(5) + 1);
  const rot = ROT[rng.nextInt(4)];
  const mirror = rng.nextBoolean();
  const orx = cx - PORTAL_PIVOT[0];
  const orz = cz - PORTAL_PIVOT[1];
  // relevo sob o molde
  let mn = Infinity;
  let mx = -Infinity;
  for (let lat = -4; lat <= 4; lat += 4) {
    for (let lw = -16; lw <= 16; lw += 8) {
      let dx = lat;
      let dz = lw;
      if (rot === "cw90") { dx = -lw; dz = lat; }
      else if (rot === "cw180") { dx = -lat; dz = -lw; }
      else if (rot === "ccw90") { dx = lw; dz = -lat; }
      const h = lv.getHeight(cx + dx, cz + dz) - 1;
      mn = Math.min(mn, h);
      mx = Math.max(mx, h);
      if (mx - mn > 20) return false;
    }
  }
  const natural = templateBlocks(tname, orx, sy, orz, rot, mirror, PORTAL_PIVOT[0], PORTAL_PIVOT[1], NATURAL).sort((a, c) => a.y - c.y);
  const chests = templateBlocks(tname, orx, sy, orz, rot, mirror, PORTAL_PIVOT[0], PORTAL_PIVOT[1], ["chest"]);
  if (!natural.length) return false;
  for (const p of [...natural, ...chests]) {
    if (!bd.contains(p.x, p.z) || !lv.ensureCanWrite(p.x, p.y, p.z) || !portalCanReplace(lv.getBlockState(p.x, p.y, p.z))) return false;
  }
  const baseY = natural[0].y;
  // fundação: o terreno sobe até a base do portal, com borda erodida
  const baseCols = new Map();
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const p of natural) {
    if (p.y !== baseY) continue;
    baseCols.set(xz(p.x, p.z), [p.x, p.z]);
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, p.z);
    z1 = Math.max(z1, p.z);
  }
  const blended = [];
  if (baseCols.size) {
    const nsalt = rng.nextLong();
    const bases = [...baseCols.values()];
    for (let x = x0 - 15; x <= x1 + 15; x++) {
      for (let z = z0 - 15; z <= z1 + 15; z++) {
        if (!bd.contains(x, z)) continue;
        let best = Infinity;
        for (const c of bases) {
          best = Math.min(best, square(x - c[0]) + square(z - c[1]));
          if (best === 0) break;
        }
        const dist = Math.sqrt(best);
        if (dist > 15 + blendNoise(x, z, nsalt) * 1.35) continue;
        const core = baseCols.has(xz(x, z));
        const fine = blendNoise(x * 3 + 17, z * 3 - 29, nsalt ^ 0x3a5);
        const erosion = dist * (0.62 + fine * 0.075) + dist * dist * 0.021;
        const target = core ? baseY - 1 : baseY - 1 - Math.max(1, Math.floor(erosion));
        const surf = findTerrainSurface(lv, x, z);
        if (surf < 0) continue;
        const nt = surf - 1;
        if (nt >= target) continue;
        const orig = lv.getBlockState(x, nt, z);
        if (!isSiftTerrain(orig)) continue;
        let complete = true;
        for (let y = nt + 1; y <= target; y++) {
          if (!lv.ensureCanWrite(x, y, z) || !portalCanReplace(lv.getBlockState(x, y, z))) {
            complete = false;
            break;
          }
          lv.setBlock(x, y, z, B.SIFTSLATE);
        }
        if (!complete) continue;
        const top = core || dist < 2.5 ? B.SIFTSLATE : [B.GROWTH, B.DRY_GROWTH, B.HEALTHY, B.DRY].includes(orig) ? orig : B.SIFTSLATE;
        lv.setBlock(x, target, z, top);
        if (!core && dist > 2.5) blended.push([x, target, z]);
      }
    }
  }
  // o molde (sem o ar, como o BlockIgnoreProcessor.STRUCTURE_AND_AIR)
  for (const p of templateBlocks(tname, orx, sy, orz, rot, mirror, PORTAL_PIVOT[0], PORTAL_PIVOT[1], null)) {
    lv.setBlock(p.x, p.y, p.z, p.state);
    if (p.short === "chest") lv.chests.push([p.x, p.y, p.z]);
  }
  for (const p of natural) decorateStructureSurface(lv, rng, p.x, p.y, p.z, 0.96);
  for (const s of blended) decorate(lv, rng, s[0], s[1], s[2], 0.72);
  return true;
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------
export const CUSTOM = {
  abandoned_main_portal: abandonedPortal,
  bare_monolith: monolith(false),
  lush_monolith: monolith(true),
  cliff_arch: cliffArch,
  covered_growth_cleanup: coveredGrowthCleanup,
  dry_sculk_spikes: drySpikes,
  ichor_lake: ichorLake,
  ichor_snow: ichorSnowFeature,
  ichor_cave_spring: ichorSpring,
  lava_floor: lavaFloor,
  overgrown_willow_tree: willowTree,
  sift_flower_patch: siftFlowerPatch,
  siftslate_plant_patch: siftslatePlantPatch,
  sniffer_cave_overgrown: snifferCave(16, 0x534e4f56, 4),
  sniffer_cave_wastes: snifferCave(28, 0x534e5753, 3),
  sniffer_plant_patch: snifferPlantPatch,
  soul_canyon: soulCanyon,
  surface_sculk_region: surfaceSculkRegion,
};

/** Salgueiro a partir de uma muda (usado pelo bloco de muda). */
export { placeWillow, WILLOW };
