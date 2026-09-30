/* =========================================================================
 * Viagem pelo Portal do Sift e pelas Fendas.
 *
 * Overworld -> Sift: guarda de onde o jogador saiu e o leva ao portal
 * principal do Sift (uma estrutura única, criada na primeira viagem perto da
 * origem do mundo, num lugar plano).
 * Sift -> Overworld: devolve ao ponto guardado. Se o portal de lá foi fechado
 * no meio da exploração, avisa (como no mod).
 *
 * Quem acabou de chegar fica "esperando sair" do portal, senão voltaria na
 * hora — é o PortalTransitGuard do mod.
 * ========================================================================= */

import { world, system } from "@minecraft/server";
import { SIFT_DIM, MAIN_PORTAL_SEARCH } from "../config.js";
import { heightAt, naturalHeightAt, setPortalZone } from "./terrain.js";
import { siftGen, warn } from "./worldgen.js";
import { PORTAL_ID } from "./portal.js";
import { award } from "./advancements.js";

const RETURN = "the_sift:return";
const MAIN = "the_sift:main_portal";
const OVERWORLD = "minecraft:overworld";

const waiting = new Set();
const busy = new Set();
const seen = new Set();

// ---------------------------------------------------------------------------
// Portal principal
// ---------------------------------------------------------------------------
function loadMain() {
  try {
    const raw = world.getDynamicProperty(MAIN);
    return typeof raw === "string" ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveMain(m) {
  world.setDynamicProperty(MAIN, JSON.stringify(m));
}

world.afterEvents.worldLoad.subscribe(() => {
  const m = loadMain();
  if (m) setPortalZone({ x: m.x, z: m.z }, m.y);
});

/**
 * Escolhe o lugar mais plano perto da origem para a estrutura de 9 x 40.
 * É um gerador (roda em system.runJob): cada amostra calcula o relevo do mod.
 */
function* chooseMainSpot() {
  let best = null;
  for (let r = 0; r <= MAIN_PORTAL_SEARCH; r += 16) {
    for (let ox = -r; ox <= r; ox += 16) {
      for (let oz = -r; oz <= r; oz += 16) {
        if (Math.max(Math.abs(ox), Math.abs(oz)) !== r) continue;
        // não pisar em chão já gerado
        if (siftGen.isChunkReady(ox, oz) || siftGen.isChunkReady(ox + 8, oz + 39)) continue;
        const hs = [];
        for (let dx = 0; dx <= 8; dx += 8) {
          for (let dz = 0; dz <= 39; dz += 13) {
            hs.push(naturalHeightAt(ox + dx, oz + dz).h);
            yield;
          }
        }
        hs.sort((a, b) => a - b);
        const relief = hs[hs.length - 1] - hs[0];
        const median = hs[hs.length >> 1];
        const score = relief + Math.hypot(ox, oz) / 40 + (median > 140 ? 30 : 0);
        if (!best || score < best.score) best = { x: ox - 4, z: oz - 19, y: median + 1, score };
      }
    }
    if (best && best.score < 8) break;
  }
  return best ?? { x: -4, z: -19, y: heightAt(0, 0) + 1 };
}

function runJobAsync(gen) {
  return new Promise((resolve, reject) => {
    system.runJob((function* () {
      try {
        resolve(yield* gen);
      } catch (e) {
        reject(e);
      }
    })());
  });
}

let ensuring = null;

/** Garante que o portal principal existe e devolve onde o jogador chega. */
function ensureMainPortal() {
  if (ensuring) return ensuring;
  ensuring = (async () => {
    let m = loadMain();
    if (!m) {
      const spot = await runJobAsync(chooseMainSpot());
      m = { x: spot.x, y: spot.y, z: spot.z, placed: false };
      setPortalZone({ x: m.x, z: m.z }, m.y);
      saveMain(m);
    }
    if (!m.placed) {
      const dim = world.getDimension(SIFT_DIM);
      const id = "the_sift_main_portal";
      try {
        await world.tickingAreaManager.createTickingArea(id, {
          dimension: dim,
          from: { x: m.x - 2, y: 0, z: m.z - 2 },
          to: { x: m.x + 10, y: 255, z: m.z + 41 },
        });
        world.structureManager.place("the_sift:main_portal", dim, { x: m.x, y: m.y, z: m.z }, { includeEntities: false });
        m.placed = true;
        saveMain(m);
      } catch (e) {
        warn("portal principal", e);
      } finally {
        try {
          if (world.tickingAreaManager.hasTickingArea(id)) world.tickingAreaManager.removeTickingArea(id);
        } catch { }
      }
    }
    return { x: m.x + 3.5, y: m.y + 5, z: m.z + 19.5 };
  })();
  ensuring.finally(() => { ensuring = null; });
  return ensuring;
}

// ---------------------------------------------------------------------------
// Pouso seguro
// ---------------------------------------------------------------------------
function protect(player, seconds) {
  try {
    player.addEffect("resistance", seconds * 20, { amplifier: 4, showParticles: false });
    player.addEffect("slow_falling", seconds * 20, { amplifier: 0, showParticles: false });
  } catch { }
}

/** Leva ao Overworld e acha o chão depois que a chunk carrega. */
export function landInOverworld(player, x, z, yHint) {
  const ow = world.getDimension(OVERWORLD);
  protect(player, 8);
  player.teleport({ x, y: yHint ?? 200, z }, { dimension: ow });
  if (yHint !== undefined) return;
  let tries = 0;
  const id = system.runInterval(() => {
    if (!player.isValid || ++tries > 40) { system.clearRun(id); return; }
    try {
      const top = ow.getTopmostBlock({ x, z });
      if (top) {
        player.teleport({ x, y: top.y + 1, z }, { dimension: ow });
        system.clearRun(id);
      }
    } catch { }
  }, 5);
}

/** Leva ao Sift numa (x, z) qualquer, sobre a superfície calculada. */
export function landInSift(player, x, z) {
  const dim = world.getDimension(SIFT_DIM);
  protect(player, 10);
  player.teleport({ x: x + 0.5, y: heightAt(Math.floor(x), Math.floor(z)) + 2, z: z + 0.5 }, { dimension: dim });
}

// ---------------------------------------------------------------------------
// Travessia
// ---------------------------------------------------------------------------
function touchingPortal(player) {
  const l = player.location;
  const dim = player.dimension;
  for (const dy of [0.1, 1.2]) {
    try {
      if (dim.getBlock({ x: Math.floor(l.x), y: Math.floor(l.y + dy), z: Math.floor(l.z) })?.typeId === PORTAL_ID) return true;
    } catch { }
  }
  return false;
}

export function holdUntilExit(player) {
  waiting.add(player.id);
}

async function enterSift(player) {
  busy.add(player.id);
  try {
    const l = player.location;
    const r = player.getRotation();
    player.setDynamicProperty(RETURN, JSON.stringify({
      x: l.x, y: l.y, z: l.z, rx: r.x, ry: r.y,
      portal: { x: Math.floor(l.x), y: Math.floor(l.y + 0.1), z: Math.floor(l.z) },
    }));
    player.onScreenDisplay.setActionBar({ translate: "message.the_sift.sift_generating" });
    const arrive = await ensureMainPortal();
    if (!player.isValid) return;
    protect(player, 6);
    player.teleport(arrive, { dimension: world.getDimension(SIFT_DIM), rotation: { x: 0, y: -90 } });
    waiting.add(player.id);
    award(player, "story.brave_the_unknown");
  } catch (e) {
    warn("entrar no Sift", e);
  } finally {
    busy.delete(player.id);
  }
}

function leaveSift(player) {
  busy.add(player.id);
  try {
    let ret = null;
    try {
      const raw = player.getDynamicProperty(RETURN);
      ret = typeof raw === "string" ? JSON.parse(raw) : null;
    } catch { }
    const ow = world.getDimension(OVERWORLD);
    if (ret) {
      player.teleport({ x: ret.x, y: ret.y, z: ret.z }, { dimension: ow, rotation: { x: ret.rx ?? 0, y: ret.ry ?? 0 } });
      waiting.add(player.id);
      player.setDynamicProperty(RETURN, undefined);
      // o portal de lá ainda existe?
      system.runTimeout(() => {
        try {
          const b = ow.getBlock(ret.portal);
          if (b && b.typeId !== PORTAL_ID) player.sendMessage({ translate: "message.the_sift.portal_closed" });
        } catch { }
      }, 20);
    } else {
      const sp = player.getSpawnPoint();
      if (sp && sp.dimension.id !== SIFT_DIM) {
        protect(player, 5);
        player.teleport({ x: sp.x + 0.5, y: sp.y, z: sp.z + 0.5 }, { dimension: sp.dimension });
      } else {
        const d = world.getDefaultSpawnLocation();
        landInOverworld(player, d.x + 0.5, d.z + 0.5, d.y < 32000 ? d.y : undefined);
      }
      player.sendMessage({ translate: "message.the_sift.back_to_spawn" });
      waiting.add(player.id);
    }
  } catch (e) {
    warn("sair do Sift", e);
  } finally {
    busy.delete(player.id);
  }
}

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    try {
      const id = player.id;
      if (busy.has(id)) continue;
      const t = touchingPortal(player);
      if (!seen.has(id)) {
        seen.add(id);
        if (t) waiting.add(id);
        continue;
      }
      if (waiting.has(id)) {
        if (!t) waiting.delete(id);
        continue;
      }
      if (!t) continue;
      if (player.getGameMode() === "Spectator") continue;
      const dimId = player.dimension.id;
      if (dimId === OVERWORLD) enterSift(player);
      else if (dimId === SIFT_DIM) leaveSift(player);
    } catch (e) {
      warn("portal", e);
    }
  }
}, 2);

world.beforeEvents.playerLeave.subscribe((e) => {
  seen.delete(e.player.id);
  waiting.delete(e.player.id);
  busy.delete(e.player.id);
});

// partículas e zumbido perto de portais (só em volta dos jogadores)
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    try {
      const dim = player.dimension;
      const l = player.location;
      for (let i = 0; i < 6; i++) {
        const p = { x: Math.floor(l.x + (Math.random() - 0.5) * 16), y: Math.floor(l.y + (Math.random() - 0.5) * 8), z: Math.floor(l.z + (Math.random() - 0.5) * 16) };
        const b = dim.getBlock(p);
        if (b?.typeId === PORTAL_ID) {
          dim.spawnParticle("the_sift:portal_mist", { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 });
          if (Math.random() < 0.15) dim.playSound("portal.portal", { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 }, { volume: 0.3, pitch: 1.2 });
        }
      }
    } catch { }
  }
}, 10);

