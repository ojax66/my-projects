/* =========================================================================
 * O céu do Sift: a cúpula de aurora (entidade the_sift:sky) acompanha cada
 * jogador que está no Sift, e a textura dela vai do dia para a noite com a
 * hora do mundo (como as camadas DAY/NIGHT do SiftProceduralSkyRenderer).
 *
 * A entidade fica sempre em cima do jogador: o Bedrock só desenha entidades
 * dentro da distância de simulação (a mesma ideia do céu do Galactic
 * Horizons).
 * ========================================================================= */

import { world, system } from "@minecraft/server";
import { SIFT_DIM } from "../config.js";
import { warn } from "./worldgen.js";

const SKY_ID = "the_sift:sky";
const domes = new Map(); // player id -> entidade

/** 0 = dia ... 4 = noite, com transição ao entardecer e ao amanhecer. */
export function nightStep() {
  const t = world.getTimeOfDay();
  let n;
  if (t < 11500) n = 0;
  else if (t < 13500) n = (t - 11500) / 2000;
  else if (t < 22300) n = 1;
  else n = 1 - (t - 22300) / 1700;
  return Math.max(0, Math.min(4, Math.round(n * 4)));
}

function eyeOf(p) {
  const l = p.location;
  return { x: l.x, y: l.y + 1.62, z: l.z };
}

let cleaned = false;
system.runInterval(() => {
  let dim;
  try { dim = world.getDimension(SIFT_DIM); } catch { return; }
  // cúpulas que sobraram de outra sessão
  if (!cleaned) {
    cleaned = true;
    try { for (const e of dim.getEntities({ type: SKY_ID })) e.remove(); } catch { }
  }
  const players = dim.getPlayers();
  const here = new Set(players.map((p) => p.id));
  for (const [id, e] of domes) {
    if (!here.has(id) || !e.isValid) {
      try { if (e.isValid) e.remove(); } catch { }
      domes.delete(id);
    }
  }
  const step = nightStep();
  for (const p of players) {
    try {
      let e = domes.get(p.id);
      if (!e || !e.isValid) {
        e = dim.spawnEntity(SKY_ID, eyeOf(p));
        domes.set(p.id, e);
      } else {
        e.teleport(eyeOf(p));
      }
      if (e.getProperty("the_sift:night") !== step) e.setProperty("the_sift:night", step);
    } catch (err) {
      warn("céu", err);
    }
  }
}, 1);

world.beforeEvents.playerLeave.subscribe((ev) => {
  const e = domes.get(ev.player.id);
  domes.delete(ev.player.id);
  if (e) system.run(() => { try { if (e.isValid) e.remove(); } catch { } });
});
