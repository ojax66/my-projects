/* =========================================================================
 * O calor do Sol.
 *
 * O Sol não é um bloco que machuca quando encostado: ele tem um CAMPO de
 * calor que começa dezenas de blocos antes da superfície. Quanto mais perto,
 * mais tempo de fogo e, já colado nele, dano direto. A ideia é que dar a volta
 * pra admirar seja seguro, chegar perto seja assustador, e entrar seja quase
 * impossível.
 *
 * "Quase" porque existe uma saída: resistência a fogo. Com ela o campo não
 * queima, e as camadas atravessáveis (coroa → plasma → núcleo) viram um
 * destino de verdade em vez de um enfeite. Dá pra tirar essa brecha em
 * config.js (FIRE_RESISTANCE_PROTECTS).
 * ========================================================================= */

import * as mc from "@minecraft/server";
import { BODIES, SUN_HEAT_ENABLED, FIRE_RESISTANCE_PROTECTS } from "./config.js";
import { distanceTo } from "./bodies.js";

const system = mc.system;

// Corpos que têm campo de calor (hoje só o Sol, mas nada aqui presume isso).
const HOT_BODIES = BODIES.filter((b) => b.heat);

function isExempt(player) {
  let mode;
  try { mode = player.getGameMode(); } catch { }
  if (mode === "Creative" || mode === "Spectator" || mode === "creative" || mode === "spectator") {
    return true;
  }
  if (FIRE_RESISTANCE_PROTECTS) {
    try {
      if (player.getEffect("fire_resistance")) return true;
    } catch { }
  }
  return false;
}

/**
 * Quão fundo no campo de calor o jogador está.
 *
 *   0    na borda externa do campo
 *   1    encostando na superfície
 *   >1   dentro do Sol, chegando a 2 no centro
 *
 * Devolve null se estiver fora de qualquer campo.
 */
function heatAt(location) {
  for (let i = 0; i < HOT_BODIES.length; i++) {
    const body = HOT_BODIES[i];
    const d = distanceTo(location, body);
    const outer = body.radius + body.heat.zone;
    if (d > outer) continue;

    const t =
      d >= body.radius
        ? (outer - d) / body.heat.zone          // aproximando: 0 → 1
        : 1 + (body.radius - d) / body.radius;  // dentro: 1 → 2

    return { body, t, distance: d };
  }
  return null;
}

/**
 * Aplica o calor e devolve o aviso pra action bar (ou null).
 * Chamado uma vez por tick por jogador no espaço.
 */
export function applySunHeat(player) {
  if (!SUN_HEAT_ENABLED) return null;

  const heat = heatAt(player.location);
  if (!heat) return null;

  const { body, t } = heat;

  if (isExempt(player)) {
    return t >= 1
      ? `§6${body.name}§r §7— dentro do Sol, protegido do calor`
      : `§6${body.name}§r §7— calor intenso, mas você está protegido`;
  }

  // O fogo é o que mata na aproximação. A duração cresce com a proximidade, e
  // é reaplicada de meio em meio segundo pra não deixar apagar sozinho.
  if (system.currentTick % 10 === 0) {
    const seconds = Math.max(1, Math.round(body.heat.maxFireSeconds * Math.min(t, 1)));
    try { player.setOnFire(seconds, true); } catch { }
  }

  // Dentro do Sol o fogo já não dá conta: dano direto, escalando até o núcleo.
  if (t > 1 && system.currentTick % 20 === 0) {
    const dmg = Math.round(body.heat.insideDamage * (t - 1) + body.heat.insideDamage);
    try { player.applyDamage(dmg); } catch { }
  }

  if (t >= 1) return `§4§lVOCÊ ESTÁ DENTRO DO SOL`;
  if (t > 0.6) return `§c§lCALOR EXTREMO §r§7— afaste-se do Sol`;
  return `§6Calor do Sol §r§7— está ficando perigoso`;
}

/** Só a leitura, sem aplicar nada — usado pelos testes e pelo HUD. */
export function heatLevelAt(location) {
  const h = heatAt(location);
  return h ? h.t : 0;
}
