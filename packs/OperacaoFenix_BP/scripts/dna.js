/* =========================================================================
 * Seringa e DNA: a saída de Valhalla.
 *
 * Outro jogador usa uma seringa num corpo e recebe o DNA do dono dele. Usando
 * esse DNA na própria Operação Fênix, a cápsula para de gerar o clone do dono e
 * refaz o corpo original de quem está em Valhalla; quando fica pronto, essa
 * pessoa sai de Valhalla ali, no corpo original.
 * ========================================================================= */

import { ItemStack } from "@minecraft/server";
import { MessageFormData } from "@minecraft/server-ui";
import { CONFIG, IDS } from "./config.js";
import { Capsules } from "./store.js";
import { startDna } from "./fenix.js";

/** @typedef {import("@minecraft/server").Player} Player */

function heldSlot(player) {
  const inventory = player.getComponent("minecraft:inventory")?.container;
  const slot = player.selectedSlotIndex;
  return { inventory, slot, item: inventory?.getItem(slot) };
}

/**
 * Seringa num corpo: troca uma seringa pelo DNA do dono do corpo.
 * @param {Player} player
 * @param {import("@minecraft/server").Entity} corpse
 */
export function sampleDNA(player, corpse) {
  const ownerId = corpse.getDynamicProperty("fenix:owner");
  const ownerName = corpse.getDynamicProperty("fenix:ownerName");
  if (typeof ownerId !== "string" || typeof ownerName !== "string") return;
  const { inventory, slot, item } = heldSlot(player);
  if (!inventory || item?.typeId !== IDS.syringe) return;

  const dna = new ItemStack(IDS.dna);
  dna.nameTag = `§dDNA de ${ownerName}`;
  dna.setLore([`§7Amostra do corpo de §f${ownerName}`, "§7Use na sua Operação Fênix para", "§7trazer essa pessoa de Valhalla."]);
  dna.setDynamicProperty("fenix:owner", ownerId);
  dna.setDynamicProperty("fenix:ownerName", ownerName);

  if (item.amount > 1) {
    item.amount -= 1;
    inventory.setItem(slot, item);
    const left = inventory.addItem(dna);
    if (left) player.dimension.spawnItem(left, player.location);
  } else {
    inventory.setItem(slot, dna);
  }
  player.playSound("bottle.fill");
  player.sendMessage(`§dVocê coletou o DNA de ${ownerName}.`);
}

/** DNA que o jogador está segurando: de quem é. */
export function heldDNA(player) {
  const { item } = heldSlot(player);
  if (item?.typeId !== IDS.dna) return undefined;
  const id = item.getDynamicProperty("fenix:owner");
  const name = item.getDynamicProperty("fenix:ownerName");
  return typeof id === "string" && typeof name === "string" ? { id, name } : undefined;
}

/**
 * Usa o DNA segurado na Operação Fênix (cápsula ou painel dela).
 * @param {Player} player
 * @param {string} capsuleId
 */
export async function useDNA(player, capsuleId) {
  const dna = heldDNA(player);
  const c = Capsules.get(capsuleId);
  if (!dna || !c) return;
  const minutes = Math.round(CONFIG.dnaReviveSeconds / 60);
  const res = await new MessageFormData()
    .title("Usar DNA")
    .body(
      `Usar o DNA de §d${dna.name}§r nesta Operação Fênix?\n\n` +
        `A cápsula para de gerar o seu clone e refaz o corpo de ${dna.name} (~${minutes} min). ` +
        `Quando ficar pronto, ${dna.name} sai de Valhalla aqui.`,
    )
    .button1("Usar DNA")
    .button2("Cancelar")
    .show(player);
  if (res.selection !== 0) return;

  // Confere de novo: o jogador pode ter trocado de item com o formulário aberto.
  const again = heldDNA(player);
  const fresh = Capsules.get(capsuleId);
  if (!again || again.id !== dna.id || !fresh) return;
  const error = startDna(player, fresh, dna.id, dna.name);
  if (error) return player.sendMessage(error);
  const { inventory, slot } = heldSlot(player);
  inventory?.setItem(slot);
  player.playSound("beacon.power");
  player.sendMessage(`§dSua Operação Fênix está refazendo o corpo de ${dna.name}.`);
}
