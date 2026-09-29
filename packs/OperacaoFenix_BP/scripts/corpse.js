import { EquipmentSlot, world } from "@minecraft/server";
import { IDS } from "./config.js";
import { Bodies, Players } from "./store.js";
import { applySkin, bodyName } from "./skin.js";

// Slots 0..35 do corpo espelham o inventário; 36..40 guardam o equipamento.
const EQUIPMENT = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet, EquipmentSlot.Offhand];
const EQUIPMENT_BASE = 36;

/** O corpo não guarda mais nenhum item? */
export function isEmpty(corpse) {
  const store = corpse.getComponent("minecraft:inventory")?.container;
  return !store || store.emptySlotsCount === store.size;
}

/** Onde o corpo fica: no local da morte, ou em cima do chão se o jogador caiu no void. */
function restingPlace(dimension, loc) {
  const { min } = dimension.heightRange;
  if (loc.y > min + 1) return loc;
  const top = dimension.getTopmostBlock({ x: loc.x, z: loc.z });
  if (top && !top.isAir) return { x: loc.x, y: top.y + 1, z: loc.z };
  return world.getDefaultSpawnLocation();
}

/**
 * Deixa o corpo do jogador no chão com todos os itens dele.
 * O keepInventory fica ligado; aqui os itens saem do jogador e vão para o corpo.
 * @param {import("@minecraft/server").Player} player
 */
export function createCorpse(player, dimension, deathLocation) {
  const inventory = player.getComponent("minecraft:inventory")?.container;
  const equippable = player.getComponent("minecraft:equippable");
  const spot = restingPlace(dimension, deathLocation);

  let corpse;
  try {
    corpse = dimension.spawnEntity(IDS.corpse, spot);
  } catch (e) {
    console.warn(`[Fênix] não foi possível criar o corpo de ${player.name}: ${e}`);
    return;
  }
  corpse.setRotation({ x: 0, y: player.getRotation().y });
  corpse.nameTag = `§7Corpo de ${player.name}`;
  corpse.setDynamicProperty("fenix:owner", player.id);
  corpse.setDynamicProperty("fenix:ownerName", player.name);
  // No clone de outro jogador, o corpo que cai é o do dono do clone.
  applySkin(corpse, bodyName(Players.of(player)));

  const store = corpse.getComponent("minecraft:inventory")?.container;
  if (!store) return;
  if (inventory) {
    for (let i = 0; i < inventory.size && i < EQUIPMENT_BASE; i++) {
      const item = inventory.getItem(i);
      // A bússola de corpos fica com o jogador (keepInventory).
      if (!item || item.typeId === IDS.compass) continue;
      store.setItem(i, item);
      inventory.setItem(i);
    }
  }
  if (equippable) {
    EQUIPMENT.forEach((slot, n) => {
      const item = equippable.getEquipment(slot);
      if (!item) return;
      store.setItem(EQUIPMENT_BASE + n, item);
      equippable.setEquipment(slot);
    });
  }
  Bodies.save({
    id: corpse.id,
    owner: player.id,
    dim: dimension.id,
    x: spot.x,
    y: spot.y,
    z: spot.z,
    at: Date.now(),
    emptySince: isEmpty(corpse) ? Date.now() : null,
  });
}

/**
 * Dono interagiu com o corpo: devolve os itens.
 * @param {import("@minecraft/server").Player} player
 * @param {import("@minecraft/server").Entity} corpse
 */
export function lootCorpse(player, corpse) {
  const ownerId = corpse.getDynamicProperty("fenix:owner");
  const ownerName = corpse.getDynamicProperty("fenix:ownerName") ?? "outro jogador";
  if (ownerId !== player.id) {
    player.sendMessage(`§cEste é o corpo de ${ownerName}. §7Só o dono pode pegar os itens.`);
    return;
  }
  const p = Players.of(player);
  if (p.mode === "valhalla") {
    player.sendMessage("§cVocê está em Valhalla. §7Só quando alguém reviver seu corpo com DNA você volta a pegar seus itens.");
    return;
  }
  if (p.mode === "foreign") {
    const where = p.host ? `no clone de §f${p.host}§7` : "num corpo provisório";
    player.sendMessage(`§cVocê está ${where}. §7Reviva seu corpo original numa Operação Fênix para recuperar seus itens.`);
    return;
  }

  const store = corpse.getComponent("minecraft:inventory")?.container;
  const inventory = player.getComponent("minecraft:inventory")?.container;
  const equippable = player.getComponent("minecraft:equippable");
  if (!store || !inventory) return;

  let left = 0;
  for (let i = 0; i < store.size; i++) {
    const item = store.getItem(i);
    if (!item) continue;
    const equipIndex = i - EQUIPMENT_BASE;
    if (equipIndex >= 0 && equipIndex < EQUIPMENT.length && equippable && !equippable.getEquipment(EQUIPMENT[equipIndex])) {
      equippable.setEquipment(EQUIPMENT[equipIndex], item);
      store.setItem(i);
      continue;
    }
    if (i < inventory.size && !inventory.getItem(i)) {
      inventory.setItem(i, item);
      store.setItem(i);
      continue;
    }
    const rest = inventory.addItem(item);
    store.setItem(i, rest);
    if (rest) left++;
  }

  player.playSound("random.pop");
  if (left > 0) {
    player.sendMessage("§eInventário cheio. §7Ainda há itens no seu corpo.");
    return;
  }
  corpse.dimension.spawnParticle("minecraft:basic_smoke_particle", corpse.location);
  Bodies.remove(corpse.id);
  corpse.remove();
  player.sendMessage("§7Você recuperou tudo do seu corpo.");
}
