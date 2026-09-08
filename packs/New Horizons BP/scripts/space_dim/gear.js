/* =========================================================================
 * O que o jogador está vestindo, e o quanto isso protege.
 *
 * São dois degraus, e a diferença entre eles é o ponto:
 *
 *   TRAJE ESPACIAL REFORÇADO — o traje do Spacecraft melhorado com materiais
 *     dos planetas deles. AJUDA: segura o calor na aproximação do Sol e corta
 *     boa parte da pressão lá dentro, mas não anula. Dá pra encostar no Sol e
 *     entrar correndo; não dá pra morar lá.
 *
 *   ARMADURA DE NÚCLEO DE ESTRELA — feita do próprio núcleo. ANULA calor e
 *     pressão. É o fim da linha.
 *
 * Os dois valem INTEIROS. Meia armadura não segura pressão de estrela, e meio
 * traje não segura nada.
 *
 * O ciclo que isso desenha: primeira ida ao núcleo com poção de resistência a
 * fogo e o traje reforçado, correndo, só pra arrancar alguns blocos e sair
 * antes do esmagamento. Com o que se traz sai a armadura, e aí o Sol vira um
 * lugar onde dá pra ficar.
 * ========================================================================= */

import {
  STAR_ARMOR_PIECES,
  STAR_ARMOR_PROTECTS_FROM_HEAT,
  REINFORCED_SUIT_PIECES,
  REINFORCED_SUIT_PRESSURE_FACTOR,
  OXYGEN_BACKPACK,
  SPACECRAFT_DIMENSIONS,
  SPACECRAFT_SAFE_TAG,
} from "./config.js";

/** O jogador está com TODAS as peças de um conjunto? */
function wearsAll(player, pieces) {
  let equip;
  try { equip = player.getComponent("equippable"); } catch { return false; }
  if (!equip) return false;

  for (const piece of pieces) {
    let worn;
    try { worn = equip.getEquipment(piece.slot); } catch { return false; }
    if (worn?.typeId !== piece.item) return false;
  }
  return true;
}

/** O jogador está com as quatro peças da armadura de estrela? */
export function hasStarArmor(player) {
  return wearsAll(player, STAR_ARMOR_PIECES);
}

/** Quantas peças o jogador está usando (0 a 4) — pro HUD. */
export function starArmorPieces(player) {
  let equip;
  try { equip = player.getComponent("equippable"); } catch { return 0; }
  if (!equip) return 0;

  let n = 0;
  for (const piece of STAR_ARMOR_PIECES) {
    try {
      if (equip.getEquipment(piece.slot)?.typeId === piece.item) n++;
    } catch { }
  }
  return n;
}

/** A armadura também poupa do calor do Sol? (config) */
export function starArmorBlocksHeat(player) {
  return STAR_ARMOR_PROTECTS_FROM_HEAT && hasStarArmor(player);
}


// ---------------------------------------------------------------------------
// Traje espacial reforçado
// ---------------------------------------------------------------------------

/** O jogador está com as quatro peças do traje reforçado? */
export function hasReinforcedSuit(player) {
  return wearsAll(player, REINFORCED_SUIT_PIECES);
}

/** Mochila de oxigênio com carga na mão secundária — a regra do Spacecraft. */
export function hasChargedBackpack(player) {
  let equip;
  try { equip = player.getComponent("equippable"); } catch { return false; }
  const backpack = equip?.getEquipment("Offhand");
  if (backpack?.typeId !== OXYGEN_BACKPACK) return false;
  // damage === 100 é mochila vazia (o Spacecraft conta a carga como 100-damage).
  const durability = backpack.getComponent("minecraft:durability");
  return !!durability && durability.damage < 100;
}

/**
 * O degrau de proteção do jogador: "star", "suit" ou "none".
 *
 * É por aqui que calor, pressão e respiração decidem o que fazer — um lugar só,
 * pra as três não divergirem.
 */
export function protectionTier(player) {
  if (hasStarArmor(player)) return "star";
  if (hasReinforcedSuit(player)) return "suit";
  return "none";
}

/** Quanto da pressão do Sol passa: 0 nada, 1 tudo. */
export function pressureMultiplier(player) {
  const tier = protectionTier(player);
  if (tier === "star") return 0;
  if (tier === "suit") return REINFORCED_SUIT_PRESSURE_FACTOR;
  return 1;
}


// ---------------------------------------------------------------------------
// Conviver com o sistema de oxigênio do Spacecraft
// ---------------------------------------------------------------------------
/*
 * Um problema real de addon com addon: o Spacecraft decide se o jogador respira
 * procurando as QUATRO PEÇAS DELE no corpo. O traje reforçado ocupa os mesmos
 * espaços com outros ids, então, pra ele, quem fez o upgrade está sem traje —
 * e sufocaria na Lua justamente por ter melhorado o equipamento. Uma armadilha
 * feia de cair.
 *
 * Não dá pra mudar o código deles. O que dá é usar a chave que eles mesmos
 * têm: a tag `nv_sc:cant_hurt`, que o loop deles consulta pra suspender o dano
 * de oxigênio (é a tag de carência de pouso). Enquanto o jogador estiver numa
 * dimensão deles, com o traje reforçado e a mochila com carga, a tag é
 * reposta.
 *
 * Por que repor todo tick: eles removem a tag sozinhos quando o jogador está no
 * chão. A ordem entre os dois loops não é garantida, mas não precisa ser — eles
 * CONSULTAM a tag antes de removê-la, dentro do mesmo tick, então repor uma vez
 * por tick basta nos dois casos.
 *
 * A tag só é reposta com a mochila carregada, exatamente como a regra deles:
 * traje melhor não é fonte de ar.
 */
export function sustainInSpacecraftWorlds(player) {
  let dimId;
  try { dimId = player.dimension?.id; } catch { return false; }
  if (!dimId || !SPACECRAFT_DIMENSIONS.includes(dimId)) return false;

  if (!hasReinforcedSuit(player) || !hasChargedBackpack(player)) return false;

  try { player.addTag(SPACECRAFT_SAFE_TAG); } catch { }
  return true;
}
