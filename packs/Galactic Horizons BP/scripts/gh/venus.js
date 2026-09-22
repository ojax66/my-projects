/* =========================================================================
 * Vênus: o que mata lá, e o que não aguenta chegar.
 *
 * Nos outros dois mundos do addon o perigo é FALTA — falta de ar na Lua, falta
 * de ar e calor em Marte. Vênus é o contrário, e é por isso que ela tem
 * arquivo próprio em vez de virar mais um `if` no lifeSupport:
 *
 *   92 ATMOSFERAS de gás carbônico. Mais pressão que a 900 metros de
 *   profundidade no oceano. Não falta nada; sobra.
 *
 *   464 °C na superfície inteira, do equador ao polo, de dia e de noite. É
 *   quente o bastante pra derreter chumbo, e é assim em todo lugar porque a
 *   atmosfera é densa demais pra deixar qualquer diferença de temperatura
 *   existir.
 *
 * As sondas Venera duraram entre 23 minutos e 2 horas lá embaixo — e foram as
 * que duraram MAIS. As primeiras foram esmagadas antes de tocar o chão.
 *
 * Daí as duas regras deste arquivo:
 *
 *   1. SÓ O TRAJE REFORÇADO entra. O básico resolve ar e frio, e nenhum dos
 *      dois é o problema aqui — quem descer com ele cozinha. A armadura de
 *      estrela também serve, porque ela é melhor que o reforçado em tudo.
 *
 *   2. A NAVE LEVEL 1 NÃO SOBREVIVE. Ela é vidro e ferro: aguenta vácuo, que é
 *      ausência de pressão, e cede a 92 atmosferas empurrando pra dentro. Ela
 *      não some no ar — ela range por alguns segundos e implode, com tempo de
 *      sair de dentro. A Level 2 aguenta; é pra isso que ela existe.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import {
  VENUS_ENABLED, VENUS_DAMAGE, VENUS_DAMAGE_INTERVAL, VENUS_BURN_SECONDS,
  VENUS_CRUSHES_TIER1, VENUS_CRUSH_SECONDS, TIER1_SHIP,
} from "./config.js";
import { protectionTier } from "./gear.js";
import { inPressurizedVehicle } from "./lifeSupport.js";
import { t } from "./i18n.js";

const system = mc.system;

export const VENUS_DIMENSION = "gh:venus";

/** Está pisando em Vênus? */
export function inVenus(player) {
  try {
    return player.dimension?.id === VENUS_DIMENSION;
  } catch {
    return false;
  }
}

/**
 * O traje deste jogador segura Vênus?
 *
 * Reforçado ou armadura de estrela. Estar DENTRO de um veículo pressurizado
 * também vale — é o que a Level 2 é, e é o que faz descer até lá valer a pena.
 */
export function survivesVenus(player) {
  try {
    const modo = player.getGameMode?.();
    if (modo === "Creative" || modo === "Spectator"
        || modo === "creative" || modo === "spectator") return true;
  } catch { }
  if (inPressurizedVehicle(player)) return true;
  const tier = protectionTier(player);
  return tier === "star" || tier === "suit";
}

/**
 * Um tick de Vênus para um jogador.
 * @returns o aviso pra barra de ação, ou null
 */
export function applyVenus(player) {
  if (!VENUS_ENABLED) return null;
  if (!inVenus(player)) return null;
  if (survivesVenus(player)) return null;

  // O aviso sai todo tick; o dano, só no intervalo. Assim o jogador entende
  // o que está acontecendo no primeiro instante, e não depois do primeiro
  // coração perdido.
  if (system.currentTick % VENUS_DAMAGE_INTERVAL === 0) {
    try {
      player.applyDamage(VENUS_DAMAGE, {
        cause: mc.EntityDamageCause.temperature,
      });
    } catch {
      // Algumas versões não aceitam essa causa; o dano importa mais que o
      // nome dele na tela de morte.
      try { player.applyDamage(VENUS_DAMAGE); } catch { }
    }
    if (VENUS_BURN_SECONDS > 0) {
      try { player.setOnFire(VENUS_BURN_SECONDS, true); } catch { }
    }
  }
  return t(player, "hud.venus_esmagando");
}

// ---------------------------------------------------------------------------
// A Level 1 cedendo
// ---------------------------------------------------------------------------
// entityId → em que tick ela começou a ranger. A conta é por NAVE e não por
// jogador: uma nave abandonada em Vênus também implode, e duas pessoas na
// mesma nave não a fazem implodir duas vezes mais rápido.
const rangendo = new Map();

function implodir(nave) {
  try {
    const dim = nave.dimension;
    const l = nave.location;
    dim.spawnParticle?.("minecraft:huge_explosion_emitter", l);
  } catch { }
  try {
    nave.dimension.playSound?.("random.explode", nave.location, { volume: 1.1 });
  } catch { }
  // `gh:crash_explosion` é o evento que a própria nave já tem pra bater e
  // morrer: reaproveitá-lo faz a implosão largar o mesmo loot que uma queda,
  // em vez de a nave evaporar e o jogador perder tudo que gastou nela.
  let pediu = false;
  try {
    nave.triggerEvent("gh:crash_explosion");
    pediu = true;
  } catch { }

  // E CONFERE. O evento zera a vida por componente, o que é o jeito certo de
  // pedir, mas não é uma garantia: disparar um evento é pedir ao jogo, e a
  // nave continuar viva aqui seria ela ficar em Vênus pra sempre, imune,
  // exatamente o contrário do que este arquivo existe pra fazer.
  const alvo = nave;
  system.runTimeout(() => {
    try {
      if (alvo?.isValid) alvo.remove();
    } catch { }
  }, pediu ? 10 : 1);
}

/**
 * Um tick da pressão sobre as naves que estão em Vênus.
 *
 * Roda uma vez por jogador que está lá, e varre as naves em volta dele — é
 * barato e não precisa de lista global: nave em chunk descarregada não está
 * sendo esmagada por ninguém que veja.
 *
 * @returns o aviso pra quem está DENTRO de uma nave condenada, ou null
 */
export function applyVenusToShips(player) {
  if (!VENUS_ENABLED || !VENUS_CRUSHES_TIER1) return null;
  if (!inVenus(player)) return null;

  const agora = system.currentTick;
  const limite = VENUS_CRUSH_SECONDS * 20;
  let avisoPraMim = null;

  let naves = [];
  try {
    naves = player.dimension.getEntities({
      type: TIER1_SHIP, location: player.location, maxDistance: 48,
    });
  } catch {
    return null;
  }

  for (const nave of naves) {
    if (!nave?.isValid) continue;
    const desde = rangendo.get(nave.id);
    if (desde === undefined) {
      rangendo.set(nave.id, agora);
      continue;
    }
    const restam = Math.ceil((limite - (agora - desde)) / 20);
    if (agora - desde >= limite) {
      rangendo.delete(nave.id);
      implodir(nave);
      continue;
    }
    // O ranger, uma vez por segundo: é o aviso de que ela vai ceder.
    if ((agora - desde) % 20 === 0) {
      try {
        nave.dimension.playSound?.("random.anvil_land", nave.location,
                                   { volume: 0.5, pitch: 0.6 });
      } catch { }
    }
    // Quem está a bordo é quem precisa ler a contagem.
    try {
      const meu = player.getComponent("riding")?.entityRidingOn;
      if (meu?.id === nave.id) {
        avisoPraMim = t(player, "hud.venus_nave_cedendo", { s: Math.max(1, restam) });
      }
    } catch { }
  }
  return avisoPraMim;
}

/** Esquece uma nave que já não interessa (saiu de Vênus, ou morreu). */
export function forgetShip(entityId) {
  rangendo.delete(entityId);
}
