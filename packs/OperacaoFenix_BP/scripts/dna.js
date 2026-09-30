/* =========================================================================
 * Seringa e DNA: a saída de Valhalla.
 *
 * Outro jogador usa uma seringa vazia num corpo e fica com uma amostra de sangue.
 * Levando a amostra a qualquer painel ou cápsula da Operação Fênix, o DNA é
 * isolado numa cápsula de DNA (e a seringa volta vazia). Usando a cápsula de DNA
 * na própria Operação Fênix, a cápsula para de gerar o clone do dono e
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

function tagged(typeId, ownerId, ownerName, name, lore) {
  const item = new ItemStack(typeId);
  item.nameTag = name;
  item.setLore(lore);
  item.setDynamicProperty("fenix:owner", ownerId);
  item.setDynamicProperty("fenix:ownerName", ownerName);
  return item;
}

/** Troca o item segurado por `result` (se era uma pilha, o resto fica e `result` vai para o inventário). */
function replaceHeld(player, result) {
  const { inventory, slot, item } = heldSlot(player);
  if (!inventory || !item) return;
  if (item.amount > 1) {
    item.amount -= 1;
    inventory.setItem(slot, item);
    const left = inventory.addItem(result);
    if (left) player.dimension.spawnItem(left, player.location);
  } else {
    inventory.setItem(slot, result);
  }
}

function giveOrDrop(player, item) {
  const left = player.getComponent("minecraft:inventory")?.container?.addItem(item);
  if (left) player.dimension.spawnItem(left, player.location);
}

/**
 * Seringa vazia num corpo: vira uma amostra de sangue do dono do corpo.
 * @param {Player} player
 * @param {import("@minecraft/server").Entity} corpse
 */
export function sampleDNA(player, corpse) {
  const ownerId = corpse.getDynamicProperty("fenix:owner");
  const ownerName = corpse.getDynamicProperty("fenix:ownerName");
  if (typeof ownerId !== "string" || typeof ownerName !== "string") return;
  if (heldSlot(player).item?.typeId !== IDS.syringe) return;
  replaceHeld(
    player,
    tagged(IDS.blood, ownerId, ownerName, `§cSangue de ${ownerName}`, [
      `§7Amostra do corpo de §f${ownerName}`,
      "§7Leve a um painel ou cápsula da",
      "§7Operação Fênix para isolar o DNA.",
    ]),
  );
  player.playSound("bottle.fill");
  player.sendMessage(`§cVocê coletou uma amostra de sangue de ${ownerName}. §7Leve a uma Operação Fênix para isolar o DNA.`);
}

/** Amostra de sangue ou cápsula de DNA segurada: de quem é. */
function heldSample(player, typeId) {
  const { item } = heldSlot(player);
  if (item?.typeId !== typeId) return undefined;
  const id = item.getDynamicProperty("fenix:owner");
  const name = item.getDynamicProperty("fenix:ownerName");
  return typeof id === "string" && typeof name === "string" ? { id, name } : undefined;
}

export const heldBlood = (player) => heldSample(player, IDS.blood);

/**
 * Amostra de sangue num painel ou cápsula da Operação Fênix: o DNA é isolado
 * numa cápsula de DNA e a seringa volta vazia.
 * @param {Player} player
 */
export function extractDNA(player) {
  const blood = heldBlood(player);
  if (!blood) return;
  replaceHeld(
    player,
    tagged(IDS.dna, blood.id, blood.name, `§bDNA de ${blood.name}`, [
      `§7DNA isolado de §f${blood.name}`,
      "§7Use na sua Operação Fênix para",
      "§7trazer essa pessoa de Valhalla.",
    ]),
  );
  giveOrDrop(player, new ItemStack(IDS.syringe));
  player.playSound("beacon.activate");
  player.sendMessage(`§bA Operação Fênix isolou o DNA de ${blood.name}. §7A seringa voltou vazia.`);
}

/** Cápsula de DNA que o jogador está segurando: de quem é. */
export function heldDNA(player) {
  return heldSample(player, IDS.dna);
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
