/* =========================================================================
 * Ardósia Sonora e o Portal do Sift.
 *
 * Como no mod:
 *   - um Bloco de Notas em cima de Ardósia Sonora (modo nota) toca um dos 8
 *     sons próprios em vez da nota do jogo;
 *   - bater nele (ou tocar com o botão de usar) registra a nota no console —
 *     o grupo de ardósias sonoras próximas;
 *   - a sequência 1-3-7-6-5-2-4-8 faz o console se tocar sozinho, soltar
 *     colunas de luz e abrir o portal na moldura de ardósia reforçada mais
 *     próxima; a sequência ao contrário fecha.
 *
 * Diferença do Bedrock: o tom do bloco de notas não é legível por script, então
 * o índice do som (1..8) fica guardado pelo add-on. Agachar + usar muda o som;
 * usar sem agachar toca.
 * ========================================================================= */

import { world, system, BlockPermutation, BlockVolume, MolangVariableMap } from "@minecraft/server";
import { OPEN_SEQUENCE } from "../config.js";
import { warn } from "./worldgen.js";

export const NOTE_ID = "the_sift:sonorous_deepslate_note";
export const HORN_ID = "the_sift:sonorous_deepslate";
export const PORTAL_ID = "the_sift:sift_portal";
const FRAME_ID = "minecraft:reinforced_deepslate";
const CLOSE_SEQUENCE = [...OPEN_SEQUENCE].reverse();

// Cores do mod (SonorousColors.BASE_RGB), índice 1..8
const COLORS = [0xb02e26, 0x3c44aa, 0xf9801d, 0x8932b8, 0x169c9c, 0x80c71f, 0xfed83d, 0xf38baa];

export function colorOf(index1to8) {
  const c = COLORS[(index1to8 - 1) & 7];
  return { red: ((c >> 16) & 255) / 255, green: ((c >> 8) & 255) / 255, blue: (c & 255) / 255 };
}

const posKey = (dim, p) => `${dim.id}|${p.x},${p.y},${p.z}`;

// ---------------------------------------------------------------------------
// Índice do som de cada bloco de notas sonoro (0..7)
// ---------------------------------------------------------------------------
function noteKey(block) {
  return `the_sift:note:${block.dimension.id}:${block.x},${block.y},${block.z}`;
}

export function getNoteIndex(block) {
  const v = world.getDynamicProperty(noteKey(block));
  return typeof v === "number" ? v & 7 : 0;
}

function setNoteIndex(block, i) {
  world.setDynamicProperty(noteKey(block), i & 7);
}

function belowId(block) {
  try {
    return block.below()?.typeId;
  } catch {
    return undefined;
  }
}

export function playSonorous(dim, loc, index0to7) {
  const center = { x: loc.x + 0.5, y: loc.y + 1.2, z: loc.z + 0.5 };
  try {
    dim.playSound(`the_sift.block.sonorous_deepslate.sound_${index0to7 + 1}`, center, { volume: 3 });
    const m = new MolangVariableMap();
    m.setColorRGB("variable.color", colorOf(index0to7 + 1));
    dim.spawnParticle("the_sift:sonorous_note", center, m);
  } catch (e) {
    warn("som sonoro", e);
  }
}

function playGlitch(dim, loc) {
  try {
    dim.playSound("the_sift.sonorous_autoplay_glitch", { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 }, { volume: 3 });
  } catch { }
}

function burst(dim, loc, index1to8) {
  try {
    const m = new MolangVariableMap();
    m.setColorRGB("variable.color", colorOf(index1to8));
    dim.spawnParticle("the_sift:sonorous_burst", { x: loc.x + 0.5, y: loc.y + 1.3, z: loc.z + 0.5 }, m);
  } catch { }
}

function beam(dim, loc, index1to8) {
  try {
    const m = new MolangVariableMap();
    m.setColorRGB("variable.color", colorOf(index1to8));
    dim.spawnParticle("the_sift:sonorous_beam", { x: loc.x + 0.5, y: loc.y + 1.1, z: loc.z + 0.5 }, m);
  } catch { }
}

// ---------------------------------------------------------------------------
// Consoles
// ---------------------------------------------------------------------------
const buffers = new Map();       // âncora -> [{pos, index}]
const running = new Map();       // âncora -> {cancelled}

function sonorousNotesAround(dim, loc, r = 16) {
  const hr = dim.heightRange;
  const vol = new BlockVolume({ x: loc.x - r, y: Math.max(hr.min, loc.y - r), z: loc.z - r },
                              { x: loc.x + r, y: Math.min(hr.max - 1, loc.y + r), z: loc.z + r });
  const out = [];
  try {
    for (const p of dim.getBlocks(vol, { includeTypes: [NOTE_ID] }, true).getBlockLocationIterator()) out.push({ x: p.x, y: p.y, z: p.z });
  } catch (e) {
    warn("console", e);
  }
  return out;
}

function anchorOf(dim, sonorousPos) {
  const group = sonorousNotesAround(dim, sonorousPos);
  if (!group.length) return null;
  group.sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);
  return posKey(dim, group[0]);
}

function matches(buf, seq) {
  if (buf.length !== seq.length) return false;
  for (let i = 0; i < seq.length; i++) if (buf[i].index !== seq[i]) return false;
  return true;
}

function interrupt(dim, anchor, loc) {
  const run = running.get(anchor);
  if (run && !run.cancelled) {
    run.cancelled = true;
    running.delete(anchor);
    playGlitch(dim, loc);
  }
}

/** Uma nota tocada num bloco de notas sonoro. */
function registerNote(noteBlock) {
  const dim = noteBlock.dimension;
  const base = { x: noteBlock.x, y: noteBlock.y - 1, z: noteBlock.z };
  const anchor = anchorOf(dim, base);
  if (!anchor) return;
  interrupt(dim, anchor, noteBlock.location);
  const idx = getNoteIndex(noteBlock);
  playSonorous(dim, noteBlock.location, idx);

  let buf = buffers.get(anchor);
  if (!buf) buffers.set(anchor, (buf = []));
  buf.push({ pos: { x: noteBlock.x, y: noteBlock.y, z: noteBlock.z }, index: idx + 1 });
  while (buf.length > OPEN_SEQUENCE.length) buf.shift();

  const opening = matches(buf, OPEN_SEQUENCE);
  const closing = !opening && matches(buf, CLOSE_SEQUENCE);
  if (!opening && !closing) return;
  buffers.delete(anchor);
  startIgnition(dim, anchor, buf.slice(), closing);
}

function stillIntact(dim, notes) {
  for (const n of notes) {
    const b = dim.getBlock(n.pos);
    if (!b || b.typeId !== "minecraft:noteblock" || belowId(b) !== NOTE_ID) return false;
  }
  return true;
}

/** 10 ticks -> explosão de cor; +20 -> autoplay de 15 em 15 ticks; fim -> portal. */
function startIgnition(dim, anchor, notes, closing) {
  const run = { cancelled: false };
  running.set(anchor, run);
  system.runTimeout(() => {
    if (run.cancelled || !stillIntact(dim, notes)) return;
    for (const n of notes) burst(dim, n.pos, n.index);
    let i = 0;
    const step = () => {
      if (run.cancelled) return;
      if (!stillIntact(dim, notes)) {
        playGlitch(dim, notes[Math.min(i, notes.length - 1)].pos);
        running.delete(anchor);
        return;
      }
      if (i >= notes.length) {
        running.delete(anchor);
        const ok = closing ? closeNear(dim, notes) : openNear(dim, notes);
        if (!ok) playGlitch(dim, notes[0].pos);
        return;
      }
      const n = notes[i++];
      playSonorous(dim, n.pos, n.index - 1);
      burst(dim, n.pos, n.index);
      beam(dim, n.pos, n.index);
      system.runTimeout(step, 15);
    };
    system.runTimeout(step, 20);
  }, 10);
}

// ---------------------------------------------------------------------------
// Moldura de ardósia reforçada
// ---------------------------------------------------------------------------
const MAX_SCAN = 23;

function isFrame(dim, p) {
  try {
    return dim.getBlock(p)?.typeId === FRAME_ID;
  } catch {
    return false;
  }
}

function isAirLike(dim, p, closing) {
  const b = dim.getBlock(p);
  if (!b) return false;
  const t = b.typeId;
  if (b.isAir || t === "minecraft:sculk_vein" || t === "minecraft:glow_lichen") return true;
  return closing && t === PORTAL_ID;
}

/** Mesmo algoritmo do PortalFrameScanner do mod. */
export function scanFrame(dim, start, closing = false) {
  for (const axis of ["x", "z"]) {
    const f = scanAxis(dim, start, axis, closing);
    if (f) return f;
  }
  return null;
}

function scanAxis(dim, start, axis, closing) {
  const pos = axis === "x" ? { x: 1, z: 0 } : { x: 0, z: 1 };
  let a = { x: start.x, y: start.y, z: start.z };
  let steps = 0;
  while (isFrame(dim, { x: a.x, y: a.y - 1, z: a.z })) {
    a = { x: a.x, y: a.y - 1, z: a.z };
    if (++steps > MAX_SCAN) return null;
  }
  steps = 0;
  while (isFrame(dim, { x: a.x - pos.x, y: a.y, z: a.z - pos.z })) {
    a = { x: a.x - pos.x, y: a.y, z: a.z - pos.z };
    if (++steps > MAX_SCAN) return null;
  }
  let width = 1;
  while (isFrame(dim, { x: a.x + pos.x * width, y: a.y, z: a.z + pos.z * width })) if (++width > MAX_SCAN) return null;
  let height = 1;
  while (isFrame(dim, { x: a.x, y: a.y + height, z: a.z })) if (++height > MAX_SCAN) return null;
  if (width < 3 || height < 3) return null;

  const interior = [];
  let hasPortal = false;
  for (let w = 0; w < width; w++) {
    for (let h = 0; h < height; h++) {
      const p = { x: a.x + pos.x * w, y: a.y + h, z: a.z + pos.z * w };
      const border = w === 0 || w === width - 1 || h === 0 || h === height - 1;
      if (border) {
        if (!isFrame(dim, p)) return null;
      } else {
        if (!isAirLike(dim, p, closing)) return null;
        interior.push(p);
        if (dim.getBlock(p)?.typeId === PORTAL_ID) hasPortal = true;
      }
    }
  }
  if (closing && !hasPortal) return null;
  const mid = (width - 1) / 2;
  return {
    axis,
    interior,
    anchor: a,
    width,
    height,
    bottomCenter: { x: a.x + 0.5 + pos.x * mid, y: a.y + 1, z: a.z + 0.5 + pos.z * mid },
  };
}

export function framesNear(dim, points, radius, closing) {
  let min = { x: Infinity, y: Infinity, z: Infinity };
  let max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of points) {
    min = { x: Math.min(min.x, p.x), y: Math.min(min.y, p.y), z: Math.min(min.z, p.z) };
    max = { x: Math.max(max.x, p.x), y: Math.max(max.y, p.y), z: Math.max(max.z, p.z) };
  }
  const hr = dim.heightRange;
  const vol = new BlockVolume(
    { x: min.x - radius, y: Math.max(hr.min, min.y - radius), z: min.z - radius },
    { x: max.x + radius, y: Math.min(hr.max - 1, max.y + radius), z: max.z + radius });
  const out = [];
  const seen = new Set();
  let candidates;
  try {
    candidates = dim.getBlocks(vol, { includeTypes: [FRAME_ID] }, true).getBlockLocationIterator();
  } catch (e) {
    warn("procura da moldura", e);
    return out;
  }
  for (const c of candidates) {
    // só o que pode ser canto de baixo: tem moldura em cima e não embaixo
    if (isFrame(dim, { x: c.x, y: c.y - 1, z: c.z })) continue;
    const f = scanFrame(dim, { x: c.x, y: c.y, z: c.z }, closing);
    if (!f) continue;
    const k = f.anchor.x + "," + f.anchor.y + "," + f.anchor.z + f.axis;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}

export function nearestFrame(dim, origin, radius, closing = false) {
  const frames = framesNear(dim, [{ x: Math.floor(origin.x), y: Math.floor(origin.y), z: Math.floor(origin.z) }], radius, closing);
  let best = null;
  let bestD = Infinity;
  for (const f of frames) {
    const d = (f.bottomCenter.x - origin.x) ** 2 + (f.bottomCenter.y - origin.y) ** 2 + (f.bottomCenter.z - origin.z) ** 2;
    if (d < bestD) { bestD = d; best = f; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Crescimento do portal (das bordas pro centro) e fechamento (do centro pra fora)
// ---------------------------------------------------------------------------
function sortByCenter(list, axis) {
  let minW = Infinity, maxW = -Infinity, minH = Infinity, maxH = -Infinity;
  for (const p of list) {
    const w = axis === "x" ? p.x : p.z;
    minW = Math.min(minW, w); maxW = Math.max(maxW, w);
    minH = Math.min(minH, p.y); maxH = Math.max(maxH, p.y);
  }
  const cw = (minW + maxW) / 2;
  const ch = (minH + maxH) / 2;
  list.sort((a, b) => {
    const da = ((axis === "x" ? a.x : a.z) - cw) ** 2 + (a.y - ch) ** 2;
    const db = ((axis === "x" ? b.x : b.z) - cw) ** 2 + (b.y - ch) ** 2;
    return da - db;
  });
}

function animate(dim, blocks, perBlock, perTick, done) {
  let i = 0;
  const id = system.runInterval(() => {
    for (let n = 0; n < perTick && i < blocks.length; n++, i++) {
      try { perBlock(blocks[i]); } catch (e) { warn("portal", e); }
    }
    if (i >= blocks.length) {
      system.clearRun(id);
      done?.();
    }
  }, 1);
}

export function growPortal(dim, frame) {
  const queue = frame.interior.slice();
  sortByCenter(queue, frame.axis);
  queue.reverse();
  const perm = BlockPermutation.resolve(PORTAL_ID, { "the_sift:axis": frame.axis });
  const c = frame.bottomCenter;
  try {
    dim.playSound("the_sift.the_sift_portal_open", c, { volume: 4 });
    dim.playSound("block.end_portal.spawn", c, { volume: 0.6 });
  } catch { }
  animate(dim, queue, (p) => {
    const b = dim.getBlock(p);
    if (b && isAirLike(dim, p, false)) {
      b.setPermutation(perm);
      dim.spawnParticle("minecraft:endrod", { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 });
    }
  }, 3);
}

export function closePortal(dim, frame) {
  const queue = frame.interior.filter((p) => dim.getBlock(p)?.typeId === PORTAL_ID);
  sortByCenter(queue, frame.axis);
  try {
    dim.playSound("the_sift.the_sift_portal_close", frame.bottomCenter, { volume: 4 });
  } catch { }
  animate(dim, queue, (p) => {
    const b = dim.getBlock(p);
    if (b?.typeId === PORTAL_ID) {
      b.setType("minecraft:air");
      dim.spawnParticle("the_sift:portal_mist", { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 });
    }
  }, 3);
}

function openNear(dim, notes) {
  const frames = framesNear(dim, notes.map((n) => n.pos), 10, false);
  if (!frames.length) return false;
  growPortal(dim, frames[0]);
  return true;
}

function closeNear(dim, notes) {
  const frames = framesNear(dim, notes.map((n) => n.pos), 10, true);
  if (!frames.length) return false;
  closePortal(dim, frames[0]);
  return true;
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------
world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  const block = e.block;
  if (block.typeId !== "minecraft:noteblock") return;
  const under = belowId(block);
  if (under !== NOTE_ID && under !== HORN_ID) return;
  e.cancel = true;
  if (!e.isFirstEvent) return;
  const player = e.player;
  const sneaking = player.isSneaking;
  system.run(() => {
    try {
      if (!block.isValid) return;
      if (under === HORN_ID) {
        playGlitch(block.dimension, block.location);
        return;
      }
      if (sneaking) {
        const anchor = anchorOf(block.dimension, { x: block.x, y: block.y - 1, z: block.z });
        if (anchor) interrupt(block.dimension, anchor, block.location);
        const next = (getNoteIndex(block) + 1) & 7;
        setNoteIndex(block, next);
        playSonorous(block.dimension, block.location, next);
        return;
      }
      registerNote(block);
    } catch (err) {
      warn("bloco de notas sonoro", err);
    }
  });
});

world.afterEvents.entityHitBlock.subscribe((e) => {
  if (e.damagingEntity?.typeId !== "minecraft:player") return;
  const block = e.hitBlock;
  if (block.typeId !== "minecraft:noteblock") return;
  const under = belowId(block);
  try {
    if (under === NOTE_ID) registerNote(block);
    else if (under === HORN_ID) playGlitch(block.dimension, block.location);
  } catch (err) {
    warn("bloco de notas sonoro", err);
  }
});

// quebrar o bloco de notas esquece o índice guardado
world.afterEvents.playerBreakBlock.subscribe((e) => {
  if (e.brokenBlockPermutation.type.id !== "minecraft:noteblock") return;
  try {
    world.setDynamicProperty(noteKey(e.block), undefined);
  } catch { }
});
