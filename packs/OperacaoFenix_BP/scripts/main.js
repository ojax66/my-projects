import { GameMode, ItemStack, system, world } from "@minecraft/server";
import { IDS, VALHALLA } from "./config.js";
import { Capsules, Players } from "./store.js";
import { createCorpse, lootCorpse } from "./corpse.js";
import { handleRespawn, onCapsuleDestroyed, registerCapsule, resolvePanelCapsule, tick } from "./fenix.js";
import { openPanel } from "./ui.js";
import { applyDisguise } from "./skin.js";
import { bodiesTick, compassTick, giveCompass } from "./compass.js";
import { extractDNA, heldBlood, heldDNA, sampleDNA, useDNA } from "./dna.js";

const FACE_OFFSET = {
  Up: { x: 0, y: 1, z: 0 },
  Down: { x: 0, y: -1, z: 0 },
  North: { x: 0, y: 0, z: -1 },
  South: { x: 0, y: 0, z: 1 },
  East: { x: 1, y: 0, z: 0 },
  West: { x: -1, y: 0, z: 0 },
};
const KIT_HEIGHT = { [IDS.capsuleKit]: 3, [IDS.panelKit]: 2 };

world.afterEvents.worldLoad.subscribe(() => {
  // Os itens não caem no chão: vão para o corpo (ver corpse.js).
  world.gameRules.keepInventory = true;
  system.runInterval(tick, 20);
  system.runInterval(bodiesTick, 20);
  let frame = 0;
  system.runInterval(() => compassTick(frame++), 4);
});

// ---- Colocar cápsula e painel -------------------------------------------------

world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const { player, block, itemStack } = ev;
  if (block.typeId === "minecraft:bed") {
    const before = player.getSpawnPoint();
    system.run(() => guardBedSpawn(player, before));
    return;
  }
  if (!itemStack || !(itemStack.typeId in KIT_HEIGHT)) return;
  ev.cancel = true;
  if (!ev.isFirstEvent) return;
  const kit = itemStack.typeId;
  const face = ev.blockFace;
  system.run(() => placeKit(player, block, face, kit));
});

function placeKit(player, clicked, face, kit) {
  if (player.dimension.id === VALHALLA) {
    player.onScreenDisplay.setActionBar("§6A Operação Fênix não funciona em Valhalla.");
    return;
  }
  const target = clicked.offset(FACE_OFFSET[face]);
  if (!target) return;
  for (let h = 0; h < KIT_HEIGHT[kit]; h++) {
    const b = target.offset({ x: 0, y: h, z: 0 });
    if (!b || !(b.isAir || b.isLiquid)) {
      player.onScreenDisplay.setActionBar("§cSem espaço para montar aqui.");
      return;
    }
  }
  const entity = player.dimension.spawnEntity(kit === IDS.capsuleKit ? IDS.capsule : IDS.panel, target.bottomCenter());
  entity.setRotation({ x: 0, y: player.getRotation().y + 180 });
  entity.setDynamicProperty("fenix:placer", player.id);

  if (kit === IDS.capsuleKit) {
    registerCapsule(entity, player);
    player.sendMessage("§bOperação Fênix montada. §7Use o painel (ou a própria cápsula) para vincular seu clone.");
  } else {
    const c = resolvePanelCapsule(entity, player.id);
    player.sendMessage(c ? `§bPainel conectado à cápsula de ${c.ownerName}.` : "§ePainel montado. §7Coloque uma cápsula por perto.");
  }
  player.playSound("random.anvil_use", { pitch: 1.4 });

  if (player.getGameMode() === GameMode.Creative) return;
  const inventory = player.getComponent("minecraft:inventory")?.container;
  const held = inventory?.getItem(player.selectedSlotIndex);
  if (!inventory || held?.typeId !== kit) return;
  if (held.amount > 1) {
    held.amount -= 1;
    inventory.setItem(player.selectedSlotIndex, held);
  } else {
    inventory.setItem(player.selectedSlotIndex);
  }
}

// ---- Cama: só passa a noite, não define mais o renascimento --------------------

function sameSpawn(a, b) {
  if (!a || !b) return a === b;
  return a.dimension.id === b.dimension.id && a.x === b.x && a.y === b.y && a.z === b.z;
}

function guardBedSpawn(player, before) {
  let runs = 0;
  const handle = system.runInterval(() => {
    runs++;
    if (!player.isValid || runs > 40) return system.clearRun(handle);
    if (sameSpawn(before, player.getSpawnPoint())) return;
    player.setSpawnPoint(before);
    player.onScreenDisplay.setActionBar("§7A cama só passa a noite. Seu renascimento é a §bOperação Fênix§7.");
  }, 5);
}

// ---- Interações com cápsula, painel e corpo -----------------------------------

world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  const { player, target } = ev;
  if (target.typeId !== IDS.capsule && target.typeId !== IDS.panel && target.typeId !== IDS.corpse) return;
  ev.cancel = true;
  const held = ev.itemStack?.typeId;
  system.run(() => {
    if (!target.isValid) return;
    if (target.typeId === IDS.corpse) return held === IDS.syringe ? sampleDNA(player, target) : lootCorpse(player, target);
    const id = target.typeId === IDS.capsule ? target.id : resolvePanelCapsule(target, player.id)?.id;
    if (!id) return player.sendMessage("§cNenhuma Operação Fênix perto deste painel.");
    if (held === IDS.blood && heldBlood(player)) return extractDNA(player);
    if (held === IDS.dna && heldDNA(player)) return useDNA(player, id);
    openPanel(player, id);
  });
});

// ---- Morte e renascimento ---------------------------------------------------

world.afterEvents.entityDie.subscribe(
  ({ deadEntity }) => {
    const player = /** @type {import("@minecraft/server").Player} */ (deadEntity);
    const p = Players.of(player);
    const location = { ...player.location };
    p.pendingRespawn = { dim: player.dimension.id, ...location };
    Players.save(p);
    const mode = player.getGameMode();
    if (mode !== GameMode.Creative && mode !== GameMode.Spectator) createCorpse(player, player.dimension, location);
  },
  { entityTypes: ["minecraft:player"] },
);

world.afterEvents.playerSpawn.subscribe(({ player }) => {
  // Também cobre quem morreu e saiu do jogo antes de renascer.
  system.runTimeout(() => {
    if (!player.isValid) return;
    const died = !!Players.of(player).pendingRespawn;
    handleRespawn(player);
    // Skin do clone em que o jogador está (também ao entrar no mundo).
    applyDisguise(player, Players.of(player));
    if (died) giveCompass(player);
  }, 2);
});

world.afterEvents.entityDie.subscribe(
  ({ deadEntity, damageSource }) => {
    const killer = damageSource.damagingEntity;
    const placer = deadEntity.getDynamicProperty("fenix:placer");
    const byPlacer = killer?.typeId === "minecraft:player" && killer.id === placer;
    if (deadEntity.typeId === IDS.capsule) onCapsuleDestroyed(deadEntity.id, killer);
    // Quem montou recupera o kit ao quebrar a própria peça.
    if (byPlacer) {
      const kit = deadEntity.typeId === IDS.capsule ? IDS.capsuleKit : IDS.panelKit;
      deadEntity.dimension.spawnItem(new ItemStack(kit), deadEntity.location);
    }
  },
  { entityTypes: [IDS.capsule, IDS.panel] },
);

// Aviso ao dono quando a cápsula está sendo atacada.
const lastWarning = new Map();
world.afterEvents.entityHurt.subscribe(
  ({ hurtEntity, damageSource }) => {
    const c = Capsules.get(hurtEntity.id);
    const attacker = damageSource.damagingEntity;
    if (!c || attacker?.id === c.owner) return;
    const now = Date.now();
    if (now - (lastWarning.get(c.id) ?? 0) < 15000) return;
    lastWarning.set(c.id, now);
    const owner = world.getAllPlayers().find((pl) => pl.id === c.owner);
    owner?.sendMessage(`§c⚠ Sua Operação Fênix está sendo atacada! §7(${Math.floor(c.x)} ${Math.floor(c.y)} ${Math.floor(c.z)})`);
  },
  { entityTypes: [IDS.capsule] },
);
