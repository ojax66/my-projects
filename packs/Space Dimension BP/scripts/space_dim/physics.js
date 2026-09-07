/* =========================================================================
 * Gravidade zero.
 *
 * O jogador não flutua subindo nem descendo sozinho: ele simplesmente para de
 * cair. Anda pros lados normalmente, e é isso que dá a sensação de estar solto
 * no espaço. Pular sobe, agachar desce — como manobrar de propulsor.
 *
 * Como funciona: cada jogador tem um Y-alvo. A cada tick o controlador compara
 * o Y real com o alvo e liga/desliga levitação pra corrigir a diferença. O
 * slow_falling fica sempre ligado, então a queda entre uma correção e outra é
 * lenta e simétrica — o resultado é uma flutuação de poucos centésimos de
 * bloco, que lê como estar boiando, e nunca dano de queda.
 *
 * Encostou num bloco (pousou na Terra, na Lua...), o alvo passa a acompanhar o
 * jogador e ele anda normal, sem ser puxado pra cima.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import {
  ZERO_G_ENABLED,
  ZERO_G_RISE_PER_TICK,
  ZERO_G_SINK_PER_TICK,
  SAFE_MIN_Y,
  SAFE_MAX_Y,
  DIM_MIN_Y,
} from "./config.js";

const system = mc.system;

// playerId → { targetY, levitating }
const state = new Map();

const EPS = 0.04;
const EFFECT_TICKS = 8; // reaplicado bem antes de vencer

function clampY(y) {
  return Math.min(SAFE_MAX_Y, Math.max(SAFE_MIN_Y, y));
}

function setLevitation(player, on, st) {
  if (on) {
    // Reaplica de tempos em tempos pra o efeito não vencer no meio.
    try {
      player.addEffect("levitation", EFFECT_TICKS, { amplifier: 0, showParticles: false });
    } catch { }
    st.levitating = true;
    return;
  }
  if (st.levitating) {
    try { player.removeEffect("levitation"); } catch { }
    st.levitating = false;
  }
}

export function applyZeroGravity(player) {
  if (!ZERO_G_ENABLED) return;

  let st = state.get(player.id);
  if (!st) {
    st = { targetY: player.location.y, levitating: false };
    state.set(player.id, st);
  }

  let riding;
  try { riding = player.getComponent("riding")?.entityRidingOn; } catch { }

  const y = player.location.y;

  // Rede de segurança contra o void: vale montado ou a pé. Se o jogador
  // afundou abaixo do fundo da dimensão (comando, glitch, ou dirigindo o OVNI
  // pra baixo), sobe de volta antes de o dano de void encostar nele. Montado,
  // quem se teleporta é o VEÍCULO — teleportar o passageiro sozinho o
  // desmontaria no meio do nada.
  if (y < DIM_MIN_Y + 2) {
    const safeY = SAFE_MIN_Y + 4;
    try {
      if (riding?.isValid) {
        riding.teleport({ x: riding.location.x, y: safeY, z: riding.location.z });
      } else {
        player.teleport({ x: player.location.x, y: safeY, z: player.location.z });
      }
    } catch { }
    st.targetY = safeY;
    return;
  }

  // Montado (no OVNI, por exemplo): o veículo já voa sem gravidade e tem
  // controle de altitude próprio. Mexer aqui só brigaria com ele.
  if (riding) {
    setLevitation(player, false, st);
    st.targetY = y;
    return;
  }

  // Slow falling permanente: a descida entre correções fica lenta e nunca há
  // dano de queda — inclusive ao pousar num planeta.
  try {
    player.addEffect("slow_falling", EFFECT_TICKS, { amplifier: 0, showParticles: false });
  } catch { }

  // Pousou em cima de algum bloco: deixa andar normal.
  if (player.isOnGround) {
    setLevitation(player, false, st);
    st.targetY = y;
    return;
  }

  if (player.isJumping) {
    st.targetY = clampY(st.targetY + ZERO_G_RISE_PER_TICK);
  } else if (player.isSneaking) {
    st.targetY = clampY(st.targetY - ZERO_G_SINK_PER_TICK);
  }

  // Se o jogador saiu muito do alvo por fora do controlador (teleporte,
  // empurrão, saiu de um veículo), reancora em vez de tentar puxar de volta.
  if (Math.abs(y - st.targetY) > 6) st.targetY = clampY(y);

  if (y < st.targetY - EPS) {
    setLevitation(player, true, st);
  } else if (y > st.targetY + EPS) {
    setLevitation(player, false, st);
  }
}

/**
 * Chamado quando o jogador sai do espaço — solta o que o controlador segurava.
 *
 * Tira SÓ a levitação. O slow_falling fica: quem acabou de sair do espaço está
 * caindo de propósito (reentrada na Terra a Y 300, pouso na Lua a Y 254) e o
 * slow_falling é justamente o que evita que a chegada mate. Este release roda
 * DEPOIS do onArrive da viagem — o playerDimensionChange chega atrasado —,
 * então remover aqui apagaria a proteção recém-dada. O que o controlador
 * aplica dura 8 ticks e vence sozinho de qualquer jeito.
 */
export function releaseZeroGravity(player) {
  const st = state.get(player.id);
  if (!st) return;
  if (st.levitating) {
    try { player.removeEffect("levitation"); } catch { }
  }
  state.delete(player.id);
}

export function forgetPlayer(playerId) {
  state.delete(playerId);
}

/** Reancora o alvo no Y atual — usado logo depois de uma chegada. */
export function anchorAt(player, y) {
  const st = state.get(player.id);
  const target = clampY(y ?? player.location.y);
  if (st) st.targetY = target;
  else state.set(player.id, { targetY: target, levitating: false });
}

system.afterEvents.scriptEventReceive.subscribe((data) => {
  if (data.id !== "space_dim:reanchor") return;
  const p = data.sourceEntity;
  if (p?.typeId === "minecraft:player") anchorAt(p);
});
