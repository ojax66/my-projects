/* =========================================================================
 * A lixeira.
 *
 * Um bloco em que o jogador clica com um item na mão e o item SOME. Não é um
 * baú: nada fica guardado, não há inventário pra abrir, não há como tirar de
 * volta. É o vaso decorado do jogo com a parte de guardar removida.
 *
 * Um clique = um item, como o vaso. Agachado o jogo faz o de sempre (colocar
 * bloco), e é de propósito: se a lixeira engolisse o clique agachado também,
 * não daria pra encostar bloco nenhum nela.
 *
 * O evento é o BEFORE, porque é o único que dá pra cancelar — sem cancelar, o
 * jogo ainda tentaria usar o item (comer, colocar bloco) além de jogá-lo fora.
 * E como evento "before" não pode mexer no mundo, o que apaga o item é um
 * `system.run` logo depois.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import { TRASH_CAN_BLOCK } from "./config.js";

const world = mc.world;
const system = mc.system;

/** Apaga um do que o jogador tem na mão. Roda fora do evento. */
export function swallowHeld(player) {
  let inv;
  try { inv = player.getComponent("inventory")?.container; } catch { return false; }
  if (!inv) return false;

  const slot = player.selectedSlotIndex ?? 0;
  let item;
  try { item = inv.getItem(slot); } catch { return false; }
  if (!item) return false;

  try {
    if (item.amount > 1) {
      item.amount -= 1;
      inv.setItem(slot, item);
    } else {
      inv.setItem(slot, undefined);
    }
  } catch { return false; }
  return true;
}

/** O barulho e a fumacinha de "engoliu". */
function feedback(player, block) {
  try {
    player.playSound("random.fizz", { volume: 0.5, pitch: 1.4 });
  } catch { }
  try {
    block.dimension.spawnParticle("minecraft:basic_smoke_particle", {
      x: block.location.x + 0.5,
      y: block.location.y + 0.9,
      z: block.location.z + 0.5,
    });
  } catch { }
}

export function startTrashCan() {
  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    try {
      if (event.block?.typeId !== TRASH_CAN_BLOCK) return;
      // Agachado: o jogo faz o de sempre. É o que deixa colocar bloco nela.
      if (event.player?.isSneaking) return;
      if (!event.itemStack) return;

      event.cancel = true;
      const player = event.player;
      const block = event.block;
      system.run(() => {
        if (swallowHeld(player)) feedback(player, block);
      });
    } catch { }
  });
}
