/* =========================================================================
 * Rastreador: o que cada jogador conhece e o que ele escolhe ver.
 *
 * Duas coisas separadas, e a diferença importa:
 *
 *   DESBLOQUEADO  o jogador descobriu aquele sistema. É progresso, não se
 *                 desfaz. Vem de um mapa estelar usado, ou de um upgrade de
 *                 nave chamando `unlockSystem`.
 *   LIGADO        o jogador quer aquilo na tela agora. É preferência, muda
 *                 quando ele quiser, e não desfaz o progresso.
 *
 * Por isso são duas listas e não uma. Desligar Marte não faz o jogador
 * esquecer Marte; e um sistema recém-descoberto entra ligado, porque foi ele
 * que acabou de procurar por isso.
 *
 * Tudo mora em dynamic properties do jogador, então sobrevive a sair e voltar
 * do mundo.
 * ========================================================================= */

import { allTrackable, bodiesOf, defaultSystems, systemById, SYSTEMS } from "./catalog.js";

const PROP_UNLOCKED = "space_dim:known_systems";
const PROP_HIDDEN = "space_dim:hidden_tracks";

// ---------------------------------------------------------------------------
// Leitura e escrita do estado
// ---------------------------------------------------------------------------

function readList(player, prop) {
  try {
    const raw = player.getDynamicProperty(prop);
    if (typeof raw !== "string") return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeList(player, prop, list) {
  try {
    player.setDynamicProperty(prop, JSON.stringify([...new Set(list)]));
  } catch { }
}

/** Sistemas que este jogador conhece. */
export function unlockedSystems(player) {
  const saved = readList(player, PROP_UNLOCKED);
  // Nunca mexeu no rastreador: começa com o sistema de casa.
  if (!saved) return defaultSystems();
  // Os padrões entram sempre, mesmo num save antigo que não os tinha.
  return [...new Set([...defaultSystems(), ...saved])];
}

export function isSystemUnlocked(player, systemId) {
  return unlockedSystems(player).includes(systemId);
}

/**
 * Abre um sistema pra este jogador.
 * @returns {boolean} true se era novidade — false se ele já conhecia
 */
export function unlockSystem(player, systemId) {
  if (!systemById(systemId)) return false;
  const known = unlockedSystems(player);
  if (known.includes(systemId)) return false;
  writeList(player, PROP_UNLOCKED, [...known, systemId]);
  return true;
}

// ---------------------------------------------------------------------------
// Ligado / desligado
// ---------------------------------------------------------------------------
//
// Guarda o que está DESLIGADO, não o que está ligado: assim um corpo novo
// aparece ligado sozinho quando for adicionado ao catálogo, sem precisar mexer
// no save de ninguém.

function hidden(player) {
  return readList(player, PROP_HIDDEN) ?? [];
}

export function isSystemOn(player, systemId) {
  return !hidden(player).includes("sys:" + systemId);
}

export function isBodyOn(player, bodyId) {
  return !hidden(player).includes("body:" + bodyId);
}

function toggle(player, key) {
  const list = hidden(player);
  const at = list.indexOf(key);
  if (at === -1) list.push(key);
  else list.splice(at, 1);
  writeList(player, PROP_HIDDEN, list);
  return at === -1 ? false : true;      // devolve o novo estado "ligado?"
}

export function toggleSystem(player, systemId) {
  return toggle(player, "sys:" + systemId);
}

export function toggleBody(player, bodyId) {
  return toggle(player, "body:" + bodyId);
}

// ---------------------------------------------------------------------------
// O que o rastreador mostra agora
// ---------------------------------------------------------------------------

/**
 * Corpos que este jogador vê no rastreador: sistema conhecido, sistema ligado
 * e corpo ligado. É a única fonte que o HUD e os modelos distantes consultam —
 * ligar um sistema novo acende as duas coisas de uma vez.
 */
export function trackedBodies(player) {
  const known = new Set(unlockedSystems(player));
  const off = new Set(hidden(player));
  return allTrackable().filter(
    (b) =>
      known.has(b.systemId) &&
      !off.has("sys:" + b.systemId) &&
      !off.has("body:" + b.id)
  );
}

/** Estado completo, pra montar o menu. */
export function trackerState(player) {
  const known = new Set(unlockedSystems(player));
  return SYSTEMS.map((system) => ({
    id: system.id,
    name: system.name,
    unlocked: known.has(system.id),
    on: isSystemOn(player, system.id),
    bodies: bodiesOf(system.id).map((b) => ({
      id: b.id,
      name: b.name,
      on: isBodyOn(player, b.id),
      generated: b.generated,
    })),
  }));
}
