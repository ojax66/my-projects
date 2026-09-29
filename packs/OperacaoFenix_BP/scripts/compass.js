/* =========================================================================
 * Bússola de corpos: o jogador ganha uma ao renascer. Segurando ela, a barra de
 * ação mostra para onde ir: primeiro o corpo mais antigo, depois os mais novos.
 * Se o corpo está em outra dimensão, a seta fica girando e diz qual é.
 *
 * Corpo sem itens some depois de alguns minutos e sai da bússola.
 * ========================================================================= */

import { EquipmentSlot, ItemStack, world } from "@minecraft/server";
import { CONFIG, IDS, VALHALLA } from "./config.js";
import { Bodies } from "./store.js";
import { isEmpty } from "./corpse.js";

const ARROWS = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
const DIMENSIONS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end", VALHALLA];
const DIMENSION_NAMES = {
  "minecraft:overworld": "Superfície",
  "minecraft:nether": "Nether",
  "minecraft:the_end": "The End",
  [VALHALLA]: "Valhalla",
};

const dimName = (id) => DIMENSION_NAMES[id] ?? id.replace(/^.*:/, "");
const expired = (b) => b.emptySince !== null && Date.now() - b.emptySince >= CONFIG.emptyBodyDespawnSeconds * 1000;

/** Corpos que a bússola do jogador rastreia, do mais antigo ao mais novo. */
export function trackedBodies(playerId) {
  return Bodies.all()
    .filter((b) => b.owner === playerId && !expired(b))
    .sort((a, b) => a.at - b.at);
}

function holdsCompass(player) {
  const equippable = player.getComponent("minecraft:equippable");
  return (
    equippable?.getEquipment(EquipmentSlot.Mainhand)?.typeId === IDS.compass ||
    equippable?.getEquipment(EquipmentSlot.Offhand)?.typeId === IDS.compass
  );
}

/** Dá uma bússola de corpos se o jogador ainda não tiver uma. */
export function giveCompass(player) {
  const inventory = player.getComponent("minecraft:inventory")?.container;
  if (!inventory) return;
  for (let i = 0; i < inventory.size; i++) if (inventory.getItem(i)?.typeId === IDS.compass) return;
  if (player.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Offhand)?.typeId === IDS.compass) return;
  const left = inventory.addItem(new ItemStack(IDS.compass));
  if (left) player.dimension.spawnItem(left, player.location);
}

/** A cada 4 ticks: barra de ação de quem está segurando a bússola. */
export function compassTick(frame) {
  for (const player of world.getAllPlayers()) {
    if (!holdsCompass(player)) continue;
    const bodies = trackedBodies(player.id);
    const target = bodies[0];
    if (!target) {
      player.onScreenDisplay.setActionBar("§7Nenhum corpo seu para rastrear");
      continue;
    }
    const count = bodies.length > 1 ? ` §8· §7corpo mais antigo (1/${bodies.length})` : "";
    if (target.dim !== player.dimension.id) {
      const spin = ARROWS[frame % ARROWS.length];
      player.onScreenDisplay.setActionBar(`§e${spin} §fCorpo em: §e${dimName(target.dim)}${count}`);
      continue;
    }
    const dx = target.x - player.location.x;
    const dz = target.z - player.location.z;
    const dist = Math.round(Math.hypot(dx, dz));
    // Perto do corpo com a área carregada e nada ali: ele foi removido por fora
    // (ex.: /kill). Sai do registro para a bússola seguir para o próximo.
    if (dist < 24 && !world.getEntity(target.id)) {
      Bodies.remove(target.id);
      continue;
    }
    if (dist < 3) {
      player.onScreenDisplay.setActionBar(`§a● §fSeu corpo está aqui${count}`);
      continue;
    }
    // Ângulo do corpo em relação para onde o jogador olha (0 = em frente, 90 = à direita).
    const targetYaw = (-Math.atan2(dx, dz) * 180) / Math.PI;
    const relative = (((targetYaw - player.getRotation().y) % 360) + 540) % 360 - 180;
    const arrow = ARROWS[((Math.round(relative / 45) % 8) + 8) % 8];
    player.onScreenDisplay.setActionBar(`§b${arrow} §f${dist}m${count}`);
  }
}

/**
 * A cada segundo: marca corpos que ficaram vazios, remove os vazios há tempo
 * demais e registra corpos antigos que ainda não estão no registro.
 */
export function bodiesTick() {
  const now = Date.now();
  for (const id of DIMENSIONS) {
    let dimension;
    try {
      dimension = world.getDimension(id);
    } catch {
      continue; // Valhalla ainda não registrada
    }
    for (const corpse of dimension.getEntities({ type: IDS.corpse })) {
      let record = Bodies.get(corpse.id);
      const before = JSON.stringify(record);
      if (!record) {
        const owner = corpse.getDynamicProperty("fenix:owner");
        if (typeof owner !== "string") continue;
        record = { id: corpse.id, owner, dim: id, ...corpse.location, at: now, emptySince: null };
      }
      const empty = isEmpty(corpse);
      if (!empty) record.emptySince = null;
      else if (record.emptySince === null) record.emptySince = now;
      if (expired(record)) {
        dimension.spawnParticle("minecraft:basic_smoke_particle", corpse.location);
        corpse.remove();
        Bodies.remove(record.id);
        continue;
      }
      record.dim = id;
      record.x = corpse.location.x;
      record.y = corpse.location.y;
      record.z = corpse.location.z;
      if (JSON.stringify(record) !== before) Bodies.save(record);
    }
  }
}
