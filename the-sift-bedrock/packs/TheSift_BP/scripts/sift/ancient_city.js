/* =========================================================================
 * Ardósias Sonoras no centro da Cidade Ancestral.
 *
 * No mod, o centro da Cidade Ancestral (city_center_1) é trocado por uma
 * versão com oito Ardósias Sonoras em modo buzina na frente da moldura de
 * ardósia reforçada. O Bedrock não deixa um add-on trocar a estrutura, então
 * este módulo faz o mesmo depois que a cidade existe: quando um jogador anda
 * no subsolo, procura a moldura grande de ardósia reforçada perto dele e põe
 * as oito ardósias exatamente onde o molde do mod as põe:
 *
 *   moldura no plano x = 13, base em y = 13, de z = 10 a 31 (22 x 12);
 *   ardósias em (8, 10, z) para z = 13, 15, ..., 27
 *   => 5 blocos à frente do plano, 3 abaixo da base, a partir do 4º bloco
 *      da moldura, de dois em dois.
 *
 * Cada cidade é marcada no mundo e só recebe as ardósias uma vez.
 * ========================================================================= */

import { world, system, BlockVolume } from "@minecraft/server";
import { framesNear, HORN_ID, NOTE_ID } from "./portal.js";
import { warn } from "./worldgen.js";

const DONE_KEY = "the_sift:ancient_cities";
const SCAN_EVERY = 100;   // ticks
const RADIUS = 40;        // blocos em volta do jogador
const MAX_Y = 0;          // cidades ancestrais ficam bem fundo

let done = null;
function loadDone() {
  if (done) return done;
  done = new Set();
  try {
    const raw = world.getDynamicProperty(DONE_KEY);
    if (typeof raw === "string") for (const k of JSON.parse(raw)) done.add(k);
  } catch { }
  return done;
}
function saveDone() {
  try { world.setDynamicProperty(DONE_KEY, JSON.stringify([...done].slice(-200))); } catch { }
}

function solid(b) {
  return !!b && !b.isAir && !b.isLiquid;
}

/** Posições das oito ardósias de um lado da moldura (side = +1 ou -1). */
function hornSpots(frame, side) {
  const a = frame.anchor;
  const along = frame.axis === "x" ? { x: 1, z: 0 } : { x: 0, z: 1 };
  const normal = frame.axis === "x" ? { x: 0, z: 1 } : { x: 1, z: 0 };
  const out = [];
  for (let i = 0; i < 8; i++) {
    const off = 3 + i * 2;
    out.push({ x: a.x + along.x * off + normal.x * 5 * side, y: a.y - 3, z: a.z + along.z * off + normal.z * 5 * side });
  }
  return out;
}

/** O lado "da praça": onde há chão com espaço livre em cima. */
function frontSide(dim, frame) {
  let best = 1;
  let bestScore = -1;
  for (const side of [1, -1]) {
    let score = 0;
    for (const p of hornSpots(frame, side)) {
      try {
        if (solid(dim.getBlock(p))) score++;
        const up = dim.getBlock({ x: p.x, y: p.y + 1, z: p.z });
        const up2 = dim.getBlock({ x: p.x, y: p.y + 2, z: p.z });
        if (up && !solid(up)) score++;
        if (up2 && !solid(up2)) score++;
      } catch { }
    }
    if (score > bestScore) {
      bestScore = score;
      best = side;
    }
  }
  return best;
}

function hasSonorousNear(dim, c) {
  const hr = dim.heightRange;
  const vol = new BlockVolume(
    { x: Math.floor(c.x) - 20, y: Math.max(hr.min, Math.floor(c.y) - 8), z: Math.floor(c.z) - 20 },
    { x: Math.floor(c.x) + 20, y: Math.min(hr.max - 1, Math.floor(c.y) + 4), z: Math.floor(c.z) + 20 });
  try {
    for (const _ of dim.getBlocks(vol, { includeTypes: [HORN_ID, NOTE_ID] }, true).getBlockLocationIterator()) return true;
  } catch (e) {
    warn("cidade ancestral: sonoras", e);
  }
  return false;
}

function prepareCity(dim, frame) {
  const key = frame.anchor.x + "," + frame.anchor.y + "," + frame.anchor.z;
  const set = loadDone();
  if (set.has(key)) return;
  set.add(key);
  saveDone();
  const side = frontSide(dim, frame);
  const spots = hornSpots(frame, side);
  let placed = 0;
  for (const p of spots) {
    try {
      const b = dim.getBlock(p);
      if (!b) continue;
      b.setType(HORN_ID);
      // espaço para o bloco de notas que vai em cima
      const up = dim.getBlock({ x: p.x, y: p.y + 1, z: p.z });
      if (up && up.typeId === "minecraft:sculk_vein") up.setType("minecraft:air");
      placed++;
    } catch (e) {
      warn("cidade ancestral", e);
    }
  }
  if (placed) console.warn(`[the_sift] ardósias sonoras colocadas na cidade ancestral em ${key}`);
}

let turn = 0;
system.runInterval(() => {
  let dim;
  try { dim = world.getDimension("minecraft:overworld"); } catch { return; }
  const players = dim.getPlayers().filter((p) => p.location.y < MAX_Y);
  if (!players.length) return;
  // um jogador por vez, pra espalhar o custo
  const p = players[turn++ % players.length];
  const c = { x: Math.floor(p.location.x), y: Math.floor(p.location.y), z: Math.floor(p.location.z) };
  let frames;
  try {
    frames = framesNear(dim, [c], RADIUS, false);
  } catch (e) {
    warn("cidade ancestral: procura", e);
    return;
  }
  for (const f of frames) {
    // a moldura do centro da cidade é a grande (22 x 12 no molde)
    if (Math.max(f.width, f.height) < 16 || Math.min(f.width, f.height) < 8) continue;
    const key = f.anchor.x + "," + f.anchor.y + "," + f.anchor.z;
    if (loadDone().has(key)) continue;
    if (hasSonorousNear(dim, f.bottomCenter)) {
      done.add(key);
      saveDone();
      continue;
    }
    prepareCity(dim, f);
  }
}, SCAN_EVERY);
