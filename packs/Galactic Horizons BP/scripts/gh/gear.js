/* =========================================================================
 * O que o jogador está vestindo, e o quanto isso protege.
 *
 * São três degraus, e a diferença entre eles é o ponto:
 *
 *   TRAJE BÁSICO — o de entrada, feito na Terra. RESOLVE O AR: é selado, e as
 *     quatro peças bastam pra respirar. Não isola do frio e não segura nada da
 *     pressão do Sol. Com ele o espaço é atravessável, não habitável.
 *
 *   TRAJE REFORÇADO — o básico reforçado com os minérios dos planetas. Isola do
 *     frio, segura o calor da APROXIMAÇÃO do Sol e ANULA a pressão lá dentro.
 *     O que ainda falta nele é o calor de DENTRO do Sol: dá pra entrar sem ser
 *     esmagado, mas o jogador pega fogo.
 *
 *   ARMADURA DE NÚCLEO DE ESTRELA — feita do próprio núcleo. ANULA calor e
 *     pressão. É o fim da linha, e é o que permite ficar dentro do Sol.
 *
 * Os três valem INTEIROS. Meia armadura não segura pressão de estrela, e meio
 * traje não segura nada.
 *
 * O ciclo que isso desenha: o básico pra subir e chegar à Lua e a Marte; com o
 * minério de lá sai o reforçado, que aguenta o frio e a pressão; e a primeira ida ao
 * núcleo é com ele mais poção de resistência a fogo, correndo, só pra arrancar
 * alguns blocos antes de a poção acabar. Com o que se traz sai a armadura, e
 * aí o Sol vira um lugar onde dá pra ficar.
 * ========================================================================= */

import {
  STAR_ARMOR_PIECES,
  STAR_ARMOR_PROTECTS_FROM_HEAT,
  BASIC_SUIT_PIECES,
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
// Os trajes daqui
// ---------------------------------------------------------------------------

/** O jogador está com as quatro peças do traje básico? */
export function hasBasicSuit(player) {
  return wearsAll(player, BASIC_SUIT_PIECES);
}

/** Qualquer um dos dois trajes DESTE addon, inteiro. Os dois são selados. */
export function hasSealedSuit(player) {
  return hasBasicSuit(player) || hasReinforcedSuit(player);
}

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
  if (hasBasicSuit(player)) return "basic";
  return "none";
}

/**
 * Quanto da pressão do Sol passa: 0 nada, 1 tudo.
 *
 * O traje básico não entra: ele resolve o ar, não o esmagamento — quem
 * entra no Sol só com ele sente a pressão inteira, como quem está sem nada.
 */
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
 * procurando as QUATRO PEÇAS DELE no corpo. Os trajes daqui ocupam os mesmos
 * espaços com outros ids, então, pra ele, quem está com um traje daqui está
 * sem traje — e sufocaria na Lua deles justamente por ter equipamento melhor.
 * Uma armadilha feia de cair.
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
 * nas dimensões DELES valem as regras deles, e traje melhor não é fonte de ar.
 * (Nas dimensões daqui os dois trajes são selados e dispensam a mochila — ver
 * canBreathe em lifeSupport.js.)
 */
export function sustainInSpacecraftWorlds(player) {
  let dimId;
  try { dimId = player.dimension?.id; } catch { return false; }
  if (!dimId || !SPACECRAFT_DIMENSIONS.includes(dimId)) return false;

  if (!hasSealedSuit(player) || !hasChargedBackpack(player)) return false;

  try { player.addTag(SPACECRAFT_SAFE_TAG); } catch { }
  return true;
}
