/* =========================================================================
 * A armadura de núcleo de estrela.
 *
 * É o equipamento de fim de linha do addon: feita do núcleo do Sol, é o único
 * jeito permanente de aguentar o que tem lá dentro — o calor e, principalmente,
 * a PRESSÃO, que resistência a fogo não resolve.
 *
 * Isso fecha um ciclo de propósito: a primeira ida ao núcleo é com poção de
 * resistência a fogo, correndo, só pra arrancar alguns blocos e sair antes do
 * esmagamento. Com o que se traz de lá sai a armadura, e aí o Sol vira um
 * lugar onde dá pra ficar.
 *
 * O conjunto vale INTEIRO. Meia armadura não segura pressão de estrela.
 * ========================================================================= */

import { STAR_ARMOR_PIECES, STAR_ARMOR_PROTECTS_FROM_HEAT } from "./config.js";

/** O jogador está com as quatro peças da armadura de estrela? */
export function hasStarArmor(player) {
  let equip;
  try { equip = player.getComponent("equippable"); } catch { return false; }
  if (!equip) return false;

  for (const piece of STAR_ARMOR_PIECES) {
    let worn;
    try { worn = equip.getEquipment(piece.slot); } catch { return false; }
    if (worn?.typeId !== piece.item) return false;
  }
  return true;
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
