/* =========================================================================
 * Respiração — as mesmas regras do Spacecraft, aplicadas aqui.
 *
 * O Spacecraft só machuca por falta de oxigênio quando o jogador está na Lua,
 * em Marte, em Andrella ou na estação (racoTriggers.js). A dimensão do espaço
 * não existe pra ele, então o dano aqui é nosso — mas a condição é copiada da
 * dele, pra o traje e a mochila valerem igual nos dois lugares:
 *
 *     traje completo + mochila de oxigênio com carga  →  respira
 *
 * O que NÃO se repete aqui é o consumo da mochila: o loop do Spacecraft já
 * gasta durabilidade e atualiza o HUD dela em todo tick, em qualquer dimensão.
 * Duplicar isso gastaria oxigênio em dobro no espaço.
 *
 * Dentro do OVNI o jogador respira normal — a cabine é pressurizada.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import {
  BREATHING_ENABLED,
  SPACESUIT_PIECES,
  OXYGEN_BACKPACK,
  PRESSURIZED_VEHICLES,
  PRESSURIZED_VEHICLE_MATCHES,
} from "./config.js";

const system = mc.system;

/** O veículo em que o jogador está tem cabine pressurizada? */
export function inPressurizedVehicle(player) {
  let mount;
  try { mount = player.getComponent("riding")?.entityRidingOn; } catch { return false; }
  if (!mount) return false;

  const id = mount.typeId ?? "";
  if (PRESSURIZED_VEHICLES.includes(id)) return true;
  for (const frag of PRESSURIZED_VEHICLE_MATCHES) {
    if (id.includes(frag)) return true;
  }
  return false;
}

function hasWorkingSpacesuit(player) {
  let equip;
  try { equip = player.getComponent("equippable"); } catch { return false; }
  if (!equip) return false;

  const backpack = equip.getEquipment("Offhand");
  if (backpack?.typeId !== OXYGEN_BACKPACK) return false;

  // damage === 100 é mochila vazia (o Spacecraft conta a carga como
  // 100 - damage).
  const durability = backpack.getComponent("minecraft:durability");
  if (!durability || durability.damage >= 100) return false;

  for (const piece of SPACESUIT_PIECES) {
    if (equip.getEquipment(piece.slot)?.typeId !== piece.item) return false;
  }
  return true;
}

/** Distribuidor de oxigênio do Spacecraft ligado por perto. */
function nearOxygenDistributor(player) {
  try {
    const distributor = player.dimension.getEntities({
      type: "nv_sc:oxygen_distributor_entity",
      location: player.location,
      maxDistance: 15,
      closest: 1,
    })[0];
    return (
      distributor?.getProperty("nv_sc:fuel") > 0 &&
      distributor?.getProperty("nv_sc:oxygen") > 0
    );
  } catch {
    return false;
  }
}

/** O jogador está respirando? */
export function canBreathe(player) {
  let mode;
  try { mode = player.getGameMode(); } catch { }
  if (mode === "Creative" || mode === "Spectator" || mode === "creative" || mode === "spectator") {
    return true;
  }

  if (player.hasTag("nv_sc:cant_hurt")) return true;
  if (inPressurizedVehicle(player)) return true;
  if (hasWorkingSpacesuit(player)) return true;
  if (nearOxygenDistributor(player)) return true;

  return false;
}

/**
 * Aplica o dano de vácuo. Chamado uma vez por tick, como no Spacecraft — os
 * frames de invulnerabilidade do próprio jogo espaçam o dano real.
 */
export function applyLifeSupport(player) {
  if (!BREATHING_ENABLED) return true;

  if (canBreathe(player)) return true;

  try { player.applyDamage(1); } catch { }

  // Aviso sonoro a cada 2 s, no mesmo som que o Spacecraft usa pra oxigênio
  // baixo (se o pack dele não estiver no mundo, o som só não toca).
  if (system.currentTick % 40 === 0) {
    try { player.playSound("nv_sc:low_oxygen", { volume: 1, pitch: 1 }); } catch { }
  }
  return false;
}
