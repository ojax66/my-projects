/* =========================================================================
 * O frio do espaço.
 *
 * O vácuo não gela por contato: não há matéria pra conduzir calor nenhum. O que
 * ele faz é não devolver nada — o corpo irradia pro escuro e só recebe de volta
 * o que o Sol manda. Por isso o frio aqui não é um dano imediato, é uma RESERVA
 * que escorre: dá pra explorar um bom tempo, e voltar pro quente enche ela de
 * novo.
 *
 * É um eixo separado do oxigênio, de propósito. O traje comum do Spacecraft
 * resolve o ar mas não isola — ele deixa explorar, não morar. Quem quiser ficar
 * precisa do traje reforçado ou da armadura de estrela, e é isso que dá ao
 * reforçado um trabalho que antes ele não tinha: até agora ele só servia pra
 * aguentar um pouco da pressão do Sol, que quase ninguém vai enfrentar.
 *
 * O CONGELAMENTO EM SI É O DA NEVE FOFA, com os números do jogo: 7 segundos
 * até congelar, 1 de vida a cada 2 segundos depois disso, lentidão junto, e a
 * morte entra no placar como congelamento — não como "dano genérico". Armadura
 * de couro impede o congelamento lá; aqui quem impede é o traje.
 *
 * O que aquece:
 *   - estar dentro do campo de calor do Sol (lá o problema é o oposto);
 *   - estar dentro de um veículo pressurizado;
 *   - traje reforçado ou armadura de estrela;
 *   - modo criativo ou espectador.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import {
  COLD_ENABLED,
  COLD_SECONDS,
  COLD_DAMAGE,
  COLD_DAMAGE_INTERVAL,
  COLD_SLOWNESS,
  COLD_RECOVER_FACTOR,
  COLD_WARN_AT,
} from "./config.js";
import { protectionTier } from "./gear.js";
import { inPressurizedVehicle } from "./lifeSupport.js";
import { heatLevelAt } from "./hazards.js";
import { t } from "./i18n.js";

const system = mc.system;

// A reserva vai de 1 (aquecido) a 0 (congelando), e escorre em COLD_SECONDS.
const POR_TICK = 1 / (COLD_SECONDS * mc.TicksPerSecond);

// playerId → reserva de calor
const reserva = new Map();

export function forgetPlayer(playerId) {
  reserva.delete(playerId);
}

/** Quanto de calor este jogador ainda tem, de 0 a 1. */
export function heatReserveOf(playerId) {
  return reserva.get(playerId) ?? 1;
}

/**
 * Este jogador está protegido do frio agora?
 * Função pura o suficiente pros testes: só lê o jogador e a posição dele.
 */
export function isWarm(player) {
  let modo;
  try { modo = player.getGameMode(); } catch { }
  if (modo === "Creative" || modo === "Spectator"
      || modo === "creative" || modo === "spectator") return true;

  // Perto do Sol o problema é o contrário. heatLevelAt vai de 0 (longe) a 1
  // (dentro); qualquer calor já serve pra não congelar.
  try { if (heatLevelAt(player.location) > 0) return true; } catch { }

  if (inPressurizedVehicle(player)) return true;

  // O traje comum NÃO entra aqui: ele resolve o ar, não o isolamento.
  const tier = protectionTier(player);
  return tier === "star" || tier === "suit";
}

/**
 * Um tick de frio.
 * @returns o aviso pra barra de ação, ou null
 */
export function applyCold(player) {
  if (!COLD_ENABLED) return null;

  const quente = isWarm(player);
  let r = reserva.get(player.id) ?? 1;

  if (quente) {
    if (r >= 1) { reserva.set(player.id, 1); return null; }
    r = Math.min(1, r + POR_TICK * COLD_RECOVER_FACTOR);
    reserva.set(player.id, r);
    // Enquanto reaquece ele ainda vê que está reaquecendo.
    if (r < COLD_WARN_AT) return t(player, "frio.reaquecendo", { barra: barra(r) });
    return null;
  }

  r = Math.max(0, r - POR_TICK);
  reserva.set(player.id, r);

  if (r <= 0) {
    // Congelado: o mesmo que a neve fofa faz — 1 de vida a cada 2 segundos e
    // lentidão enquanto durar. A CAUSA do dano é `freezing`, que é o que põe
    // "congelou até morrer" no lugar de uma morte sem explicação.
    if (COLD_SLOWNESS > 0) {
      try {
        player.addEffect("slowness", 40, {
          amplifier: COLD_SLOWNESS - 1,
          showParticles: false,
        });
      } catch { }
    }
    if (system.currentTick % COLD_DAMAGE_INTERVAL === 0) {
      try {
        const causa = mc.EntityDamageCause?.freezing;
        if (causa) player.applyDamage(COLD_DAMAGE, { cause: causa });
        else player.applyDamage(COLD_DAMAGE);
      } catch { }
      try { player.playSound("mob.player.hurt_freeze", { volume: 0.5, pitch: 1.2 }); } catch { }
    }
    return t(player, "frio.congelando");
  }

  if (r < COLD_WARN_AT) return t(player, "frio.perdendo", { barra: barra(r) });
  return null;
}

/** Uma barrinha de dez casas, pra a reserva ser um número que dá pra ler. */
function barra(r) {
  const cheias = Math.max(0, Math.min(10, Math.round(r * 10)));
  return "§b" + "▮".repeat(cheias) + "§8" + "▯".repeat(10 - cheias);
}
