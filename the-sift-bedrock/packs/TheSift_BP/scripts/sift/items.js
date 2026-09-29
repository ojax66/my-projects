/* =========================================================================
 * Itens com comportamento: balde e frasco de Ichor, o disco "Rift", a Fenda
 * do Sift (criativo) e a Bola de Neve de Ichor.
 * ========================================================================= */

import { world, system, GameMode, ItemStack } from "@minecraft/server";
import { SIFT_DIM } from "../config.js";
import { award } from "./advancements.js";
import { warn } from "./worldgen.js";

const ICHOR = "the_sift:ichor";
const isCreative = (p) => p.getGameMode() === GameMode.Creative;

/** Troca 1 item da mão por outro (balde cheio <-> vazio, frasco). */
function swapHeld(player, to) {
  if (isCreative(player)) return;
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return;
  const slot = player.selectedSlotIndex;
  const it = inv.getItem(slot);
  if (!it) return;
  if (it.amount > 1) {
    it.amount -= 1;
    inv.setItem(slot, it);
    const rest = inv.addItem(new ItemStack(to, 1));
    if (rest) player.dimension.spawnItem(rest, player.location);
  } else {
    inv.setItem(slot, new ItemStack(to, 1));
  }
}

function faceOffset(face) {
  switch (face) {
    case "Up": return { x: 0, y: 1, z: 0 };
    case "Down": return { x: 0, y: -1, z: 0 };
    case "North": return { x: 0, y: 0, z: -1 };
    case "South": return { x: 0, y: 0, z: 1 };
    case "East": return { x: 1, y: 0, z: 0 };
    case "West": return { x: -1, y: 0, z: 0 };
  }
  return { x: 0, y: 1, z: 0 };
}

// ---------------------------------------------------------------------------
// Jukebox + disco "Rift"
// ---------------------------------------------------------------------------
const DISC = "the_sift:music_disc_rift";
const discKey = (b) => `the_sift:disc:${b.dimension.id}:${b.x},${b.y},${b.z}`;
const DISC_SECONDS = 180;

function ejectDisc(block) {
  world.setDynamicProperty(discKey(block), undefined);
  const c = { x: block.x + 0.5, y: block.y + 1.1, z: block.z + 0.5 };
  try {
    block.dimension.spawnItem(new ItemStack(DISC, 1), c);
    block.dimension.runCommand(`stopsound @a[x=${block.x},y=${block.y},z=${block.z},r=80] the_sift.music_disc.rift`);
  } catch { }
}

// ---------------------------------------------------------------------------
// Uso em bloco
// ---------------------------------------------------------------------------
world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  const item = e.itemStack;
  const block = e.block;
  const player = e.player;

  // tirar o disco da jukebox (qualquer mão)
  if (block.typeId === "minecraft:jukebox" && world.getDynamicProperty(discKey(block))) {
    e.cancel = true;
    if (e.isFirstEvent) system.run(() => ejectDisc(block));
    return;
  }
  if (!item) return;

  // balde vazio -> balde de ichor
  if (item.typeId === "minecraft:bucket" && block.typeId === ICHOR) {
    e.cancel = true;
    if (!e.isFirstEvent) return;
    system.run(() => {
      block.setType("minecraft:air");
      block.dimension.playSound("bucket.fill_water", block.location);
      swapHeld(player, "the_sift:ichor_bucket");
      award(player, "blood_of_the_gods");
    });
    return;
  }

  // frasco vazio -> frasco de ichor
  if (item.typeId === "minecraft:glass_bottle" && block.typeId === ICHOR) {
    e.cancel = true;
    if (!e.isFirstEvent) return;
    system.run(() => {
      block.dimension.playSound("bottle.fill", block.location);
      swapHeld(player, "the_sift:ichor_bottle");
    });
    return;
  }

  // balde de ichor -> despeja
  if (item.typeId === "the_sift:ichor_bucket") {
    e.cancel = true;
    if (!e.isFirstEvent) return;
    system.run(() => {
      try {
        const o = faceOffset(e.blockFace);
        const target = block.typeId === ICHOR || block.isAir ? block : block.offset(o);
        if (!target || !(target.isAir || target.typeId === ICHOR || target.isLiquid)) return;
        target.setType(ICHOR);
        target.dimension.playSound("bucket.empty_water", target.location);
        swapHeld(player, "minecraft:bucket");
      } catch (err) {
        warn("balde de ichor", err);
      }
    });
    return;
  }

  // disco na jukebox
  if (item.typeId === DISC && block.typeId === "minecraft:jukebox") {
    e.cancel = true;
    if (!e.isFirstEvent) return;
    system.run(() => {
      world.setDynamicProperty(discKey(block), system.currentTick);
      const c = { x: block.x + 0.5, y: block.y + 0.5, z: block.z + 0.5 };
      block.dimension.playSound("the_sift.music_disc.rift", c, { volume: 4 });
      player.onScreenDisplay.setActionBar({ rawtext: [{ text: "§d♪ " }, { translate: "item.the_sift.music_disc_rift.desc" }, { text: " ♪" }] });
      if (!isCreative(player)) {
        const inv = player.getComponent("minecraft:inventory")?.container;
        const it = inv?.getItem(player.selectedSlotIndex);
        if (it?.typeId === DISC) inv.setItem(player.selectedSlotIndex, undefined);
      }
      try {
        if (block.dimension.getEntities({ type: "the_sift:rift", location: c, maxDistance: 16 }).length) award(player, "rift_resonance");
      } catch { }
      // partículas de nota enquanto toca
      const dim = block.dimension;
      const key = discKey(block);
      let t = 0;
      const id = system.runInterval(() => {
        t += 20;
        if (!world.getDynamicProperty(key) || t > DISC_SECONDS * 20) {
          system.clearRun(id);
          return;
        }
        try { dim.spawnParticle("minecraft:note_particle", { x: c.x, y: c.y + 0.8, z: c.z }); } catch { }
      }, 20);
    });
    return;
  }

  // Fenda do Sift (só no criativo, como no mod)
  if (item.typeId === "the_sift:sift_rift") {
    e.cancel = true;
    if (!e.isFirstEvent) return;
    system.run(() => {
      if (!isCreative(player)) return;
      const dimId = block.dimension.id;
      if (dimId !== "minecraft:overworld" && dimId !== SIFT_DIM) return;
      const o = faceOffset(e.blockFace);
      const at = { x: block.x + o.x + 0.5, y: block.y + o.y, z: block.z + o.z + 0.5 };
      for (let dy = 0; dy < 4; dy++) {
        const b = block.dimension.getBlock({ x: Math.floor(at.x), y: at.y + dy, z: Math.floor(at.z) });
        if (!b || !(b.isAir || b.isLiquid)) {
          player.onScreenDisplay.setActionBar({ translate: "message.the_sift.rift_no_space" });
          return;
        }
      }
      const rift = block.dimension.spawnEntity("the_sift:rift", at);
      rift.setProperty("the_sift:to_sift", dimId === "minecraft:overworld");
      const yaw = player.getRotation().y;
      rift.setRotation({ x: 0, y: Math.round(yaw / 90) * 90 });
      block.dimension.playSound("the_sift.entity.rift.appear", at, { volume: 2 });
    });
  }
});

// quebrar a jukebox devolve o disco
world.afterEvents.playerBreakBlock.subscribe((e) => {
  if (e.brokenBlockPermutation.type.id !== "minecraft:jukebox") return;
  if (world.getDynamicProperty(discKey(e.block))) ejectDisc(e.block);
});

// beber o frasco
world.afterEvents.itemCompleteUse.subscribe((e) => {
  if (e.itemStack.typeId !== "the_sift:ichor_bottle") return;
  try {
    e.source.addEffect("regeneration", 60, { amplifier: 0 });
  } catch { }
});

// Bola de neve de ichor perto de um Warden: "Alarme Falso"
world.afterEvents.projectileHitBlock.subscribe((e) => {
  if (e.projectile?.typeId !== "the_sift:ichor_snowball") return;
  const src = e.source;
  if (src?.typeId !== "minecraft:player") return;
  try {
    const hit = e.getBlockHit().block;
    if (e.dimension.getEntities({ type: "minecraft:warden", location: hit.location, maxDistance: 16 }).length) {
      award(/** @type {any} */ (src), "false_alarm");
    }
    e.dimension.spawnParticle("the_sift:ichor_bubble", { x: hit.x + 0.5, y: hit.y + 1, z: hit.z + 0.5 });
  } catch { }
});
