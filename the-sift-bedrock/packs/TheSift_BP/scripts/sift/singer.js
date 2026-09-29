/* =========================================================================
 * A Cantora (Singer).
 *
 * No mod, o centro da Cidade Ancestral traz oito blocos de Ardósia Sonora em
 * modo "buzina" na frente da moldura. Tocar a Buzina de Cabra ali chama a
 * Cantora: ela surge, canta e cada onda sonora dela transforma uma buzina em
 * nota — o console que abre o portal.
 *
 * O Bedrock não deixa um add-on mexer na estrutura da Cidade Ancestral. Então,
 * se a moldura não tiver ardósias sonoras por perto, a própria Cantora as
 * ergue do chão na frente da moldura, na mesma disposição do mod (oito, a
 * cinco blocos do plano da moldura, de dois em dois).
 * ========================================================================= */

import { world, system, BlockVolume, MolangVariableMap } from "@minecraft/server";
import { nearestFrame, HORN_ID, NOTE_ID } from "./portal.js";
import { warn } from "./worldgen.js";
import { award } from "./advancements.js";

const APPEAR = 148;   // 7.375 s
const SING = 161;     // 8.04 s
const DISAPPEAR = 100;
const WAVES = [3, 25, 42, 57, 75, 92, 98, 117]; // SOUND_WAVE_TICKS do mod

const active = new Map(); // entity id -> estado

function sonorousAround(dim, c, r, types) {
  const hr = dim.heightRange;
  const vol = new BlockVolume({ x: Math.floor(c.x) - r, y: Math.max(hr.min, Math.floor(c.y) - r), z: Math.floor(c.z) - r },
                              { x: Math.floor(c.x) + r, y: Math.min(hr.max - 1, Math.floor(c.y) + r), z: Math.floor(c.z) + r });
  const out = [];
  try {
    for (const p of dim.getBlocks(vol, { includeTypes: types }, true).getBlockLocationIterator()) out.push({ x: p.x, y: p.y, z: p.z });
  } catch (e) {
    warn("singer: sonoras", e);
  }
  return out;
}

/** Ergue as oito buzinas na frente da moldura, do lado do jogador. */
function raiseHorns(dim, frame, playerLoc) {
  const along = frame.axis === "x" ? { x: 1, z: 0 } : { x: 0, z: 1 };
  const normal = frame.axis === "x" ? { x: 0, z: 1 } : { x: 1, z: 0 };
  const c = frame.bottomCenter;
  const side = ((playerLoc.x - c.x) * normal.x + (playerLoc.z - c.z) * normal.z) >= 0 ? 1 : -1;
  const out = [];
  for (let i = 0; i < 8; i++) {
    const off = -7 + i * 2;
    const x = Math.floor(c.x + along.x * off + normal.x * 5 * side);
    const z = Math.floor(c.z + along.z * off + normal.z * 5 * side);
    // o chão: primeiro bloco sólido com ar em cima, descendo da base da moldura
    for (let y = Math.floor(c.y) + 2; y > Math.floor(c.y) - 8; y--) {
      const b = dim.getBlock({ x, y, z });
      const above = dim.getBlock({ x, y: y + 1, z });
      if (b && above && !b.isAir && !b.isLiquid && (above.isAir || above.typeId === "minecraft:sculk_vein")) {
        b.setType(HORN_ID);
        dim.spawnParticle("minecraft:sculk_soul_particle", { x: x + 0.5, y: y + 1.2, z: z + 0.5 });
        out.push({ x, y, z });
        break;
      }
    }
  }
  try { dim.playSound("block.sculk_shrieker.shriek", c, { volume: 2 }); } catch { }
  return out;
}

/** Ordena as buzinas como o mod: da direita pra esquerda, metade de fora pra dentro. */
function orderTargets(horns, origin, yawDeg) {
  const yaw = (yawDeg * Math.PI) / 180;
  const fwd = { x: -Math.sin(yaw), z: Math.cos(yaw) };
  const right = { x: -fwd.z, z: fwd.x };
  const list = horns.slice().sort((a, b) =>
    ((b.x + 0.5 - origin.x) * right.x + (b.z + 0.5 - origin.z) * right.z) -
    ((a.x + 0.5 - origin.x) * right.x + (a.z + 0.5 - origin.z) * right.z)).slice(0, 8);
  const split = (list.length + 1) >> 1;
  const d = (p) => (p.x + 0.5 - origin.x) ** 2 + (p.z + 0.5 - origin.z) ** 2;
  const first = list.slice(0, split).sort((a, b) => d(b) - d(a));
  const second = list.slice(split).sort((a, b) => d(a) - d(b));
  return first.concat(second);
}

function yawTowards(from, to) {
  if (!to) return 0;
  return (Math.atan2(-(to.x + 0.5 - from.x), to.z + 0.5 - from.z) * 180) / Math.PI;
}

function summon(player) {
  const dim = player.dimension;
  const frame = nearestFrame(dim, player.location, 32);
  if (!frame) return;
  award(player, "story.fallen_civilization");
  award(player, "story.song_of_the_past");
  const c = frame.bottomCenter;
  for (const e of dim.getEntities({ type: "the_sift:singer", location: c, maxDistance: 3 })) {
    if (active.has(e.id)) return; // já tem uma cantando aqui
  }
  let horns = sonorousAround(dim, c, 20, [HORN_ID]);
  if (!horns.length && !sonorousAround(dim, c, 20, [NOTE_ID]).length) horns = raiseHorns(dim, frame, player.location);
  const yaw = yawTowards(c, horns[0]);
  let singer;
  try {
    singer = dim.spawnEntity("the_sift:singer", c);
    singer.setRotation({ x: 0, y: yaw });
    singer.setProperty("the_sift:phase", 1);
  } catch (e) {
    warn("singer: spawn", e);
    return;
  }
  player.sendMessage({ translate: "message.the_sift.singer_arrives" });
  try { dim.playSound("mob.warden.emerge", c, { volume: 2 }); } catch { }
  active.set(singer.id, { tick: 0, targets: orderTargets(horns, c, yaw), pending: [] });
}

function launchWave(singer, st, target) {
  const dim = singer.dimension;
  const b = dim.getBlock(target);
  if (b?.typeId !== HORN_ID) return;
  const start = { x: singer.location.x, y: singer.location.y + 3, z: singer.location.z };
  const end = { x: target.x + 0.5, y: target.y + 0.5, z: target.z + 0.5 };
  const dist = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  const travel = Math.max(1, Math.ceil(dist / 0.6));
  try {
    const m = new MolangVariableMap();
    m.setVector3("variable.dir", { x: (end.x - start.x) / dist, y: (end.y - start.y) / dist, z: (end.z - start.z) / dist });
    m.setFloat("variable.life", dist / 12);
    dim.spawnParticle("the_sift:sound_wave", start, m);
  } catch { }
  st.pending.push({ pos: target, left: travel });
}

function tickSinger(singer, st) {
  st.tick++;
  const dim = singer.dimension;
  if (st.tick === APPEAR) {
    singer.setProperty("the_sift:phase", 2);
    try { dim.playSound("the_sift.entity.singer.sing", singer.location, { volume: 3 }); } catch { }
  }
  const rel = st.tick - APPEAR;
  for (let i = 0; i < WAVES.length && i < st.targets.length; i++) {
    if (rel === WAVES[i]) launchWave(singer, st, st.targets[i]);
  }
  for (const p of st.pending) {
    if (--p.left === 0) {
      const b = dim.getBlock(p.pos);
      if (b?.typeId === HORN_ID) {
        b.setType(NOTE_ID);
        dim.spawnParticle("minecraft:sculk_charge_pop_particle", { x: p.pos.x + 0.5, y: p.pos.y + 1, z: p.pos.z + 0.5 });
        dim.playSound("block.sculk.spread", { x: p.pos.x + 0.5, y: p.pos.y + 0.5, z: p.pos.z + 0.5 });
      }
    }
  }
  st.pending = st.pending.filter((p) => p.left > 0);
  if (st.tick === APPEAR + SING) {
    singer.setProperty("the_sift:phase", 3);
    try { dim.playSound("mob.warden.dig", singer.location, { volume: 2 }); } catch { }
  }
  if (st.tick >= APPEAR + SING + DISAPPEAR - 1) {
    active.delete(singer.id);
    singer.remove();
  }
}

system.runInterval(() => {
  for (const [id, st] of active) {
    const e = world.getEntity(id);
    if (!e?.isValid) {
      active.delete(id);
      continue;
    }
    try {
      tickSinger(e, st);
    } catch (err) {
      warn("singer", err);
      active.delete(id);
    }
  }
}, 1);

// Uma Cantora que sobrou de uma sessão anterior (sem estado) some.
world.afterEvents.entityLoad.subscribe((e) => {
  try {
    if (e.entity.typeId === "the_sift:singer" && !active.has(e.entity.id) && e.entity.getProperty("the_sift:phase") !== 0) {
      e.entity.remove();
    }
  } catch { }
});

world.afterEvents.itemUse.subscribe((e) => {
  if (e.itemStack.typeId !== "minecraft:goat_horn") return;
  const player = e.source;
  // o mod espera a buzina terminar (3 s)
  system.runTimeout(() => {
    try {
      if (player.isValid) summon(player);
    } catch (err) {
      warn("singer: buzina", err);
    }
  }, 60);
});
