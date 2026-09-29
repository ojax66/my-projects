/* =========================================================================
 * Criaturas e efeitos contínuos:
 *   - Golem do Eco: afeiçoado com um Fragmento de Eco, sai achando almas e
 *     entrega o Bloco de Alma ao dono;
 *   - Farejador comum que fica sobre sculk vira Farejador Sombrio (30 s);
 *   - Ichor: regeneração e queda lenta pra quem está dentro;
 *   - Siftita volta pro dono depois da morte ("Manter Inventário");
 *   - Fendas: atravessar leva à outra dimensão.
 * ========================================================================= */

import { world, system, ItemStack, MolangVariableMap } from "@minecraft/server";
import { award } from "./advancements.js";
import { warn } from "./worldgen.js";
import { holdUntilExit, landInOverworld, landInSift } from "./teleport.js";

function playersByDim() {
  const out = new Map();
  for (const p of world.getAllPlayers()) {
    const id = p.dimension.id;
    if (!out.has(id)) out.set(id, []);
    out.get(id).push(p);
  }
  return out;
}

/** Entidades de um tipo perto de algum jogador (sem varrer o mundo todo). */
function nearPlayers(type, radius) {
  const seen = new Set();
  const out = [];
  for (const [dimId, players] of playersByDim()) {
    const dim = world.getDimension(dimId);
    for (const p of players) {
      for (const e of dim.getEntities({ type, location: p.location, maxDistance: radius })) {
        if (!seen.has(e.id)) {
          seen.add(e.id);
          out.push(e);
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Golem do Eco
// ---------------------------------------------------------------------------
system.runInterval(() => {
  for (const golem of nearPlayers("the_sift:echo_golem", 96)) {
    try {
      const tame = golem.getComponent("minecraft:tameable");
      if (!tame?.isTamed) continue;
      const carrying = golem.getProperty("the_sift:carrying");
      if (carrying) {
        golem.dimension.spawnParticle("the_sift:soul", { x: golem.location.x, y: golem.location.y + 2.1, z: golem.location.z });
        continue;
      }
      if (Math.random() < 0.2) {
        golem.setProperty("the_sift:carrying", true);
        golem.dimension.playSound("mob.copper_golem.item_get", golem.location);
        tame.tamedToPlayer?.sendMessage({ translate: "message.the_sift.golem_soul" });
      }
    } catch (e) {
      warn("golem do eco", e);
    }
  }
}, 600);

world.beforeEvents.playerInteractWithEntity.subscribe((e) => {
  const g = e.target;
  if (g.typeId !== "the_sift:echo_golem") return;
  if (e.itemStack?.typeId === "minecraft:echo_shard") return; // afeiçoar é do JSON
  let carrying = false;
  let owner;
  try {
    carrying = !!g.getProperty("the_sift:carrying");
    owner = g.getComponent("minecraft:tameable")?.tamedToPlayerId;
  } catch { }
  if (!carrying || owner !== e.player.id) return;
  e.cancel = true;
  const player = e.player;
  system.run(() => {
    try {
      g.setProperty("the_sift:carrying", false);
      g.dimension.spawnItem(new ItemStack("the_sift:soul_block", 1), { x: g.location.x, y: g.location.y + 1, z: g.location.z });
      g.dimension.playSound("mob.copper_golem.item_drop", g.location);
      award(player, "friend_of_the_sift");
    } catch (err) {
      warn("golem do eco: entrega", err);
    }
  });
});

// ---------------------------------------------------------------------------
// Farejador sobre sculk -> Farejador Sombrio
// ---------------------------------------------------------------------------
const INFECT = "the_sift:infection";
system.runInterval(() => {
  for (const s of nearPlayers("minecraft:sniffer", 64)) {
    try {
      const below = s.dimension.getBlock({ x: Math.floor(s.location.x), y: Math.floor(s.location.y - 0.2), z: Math.floor(s.location.z) });
      let t = Number(s.getDynamicProperty(INFECT) ?? 0);
      if (below?.typeId === "minecraft:sculk" || t > 0) t += 40;
      if (t <= 0) continue;
      if (t >= 600) {
        const loc = s.location;
        const dim = s.dimension;
        const name = s.nameTag;
        s.remove();
        const dark = dim.spawnEntity("the_sift:dark_sniffer", loc);
        if (name) dark.nameTag = name;
        dim.playSound("block.sculk_catalyst.bloom", loc, { volume: 2 });
        dim.spawnParticle("minecraft:sculk_soul_particle", { x: loc.x, y: loc.y + 1, z: loc.z });
        continue;
      }
      s.setDynamicProperty(INFECT, t);
      s.dimension.spawnParticle("minecraft:sculk_charge_pop_particle", { x: s.location.x, y: s.location.y + 1.2, z: s.location.z });
    } catch (e) {
      warn("infecção", e);
    }
  }
}, 40);

// "Cadeia Alimentar": o Blub domesticado derrota o Farejador Sombrio
world.afterEvents.entityDie.subscribe((e) => {
  if (e.deadEntity.typeId !== "the_sift:dark_sniffer") return;
  const killer = e.damageSource.damagingEntity;
  if (killer?.typeId !== "the_sift:blub") return;
  try {
    const owner = killer.getComponent("minecraft:tameable")?.tamedToPlayer;
    if (owner) award(owner, "food_chain");
  } catch { }
});

// ---------------------------------------------------------------------------
// Ichor
// ---------------------------------------------------------------------------
system.runInterval(() => {
  for (const p of world.getAllPlayers()) {
    try {
      const l = p.location;
      const dim = p.dimension;
      const feet = dim.getBlock({ x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) });
      const head = dim.getBlock({ x: Math.floor(l.x), y: Math.floor(l.y + 1.5), z: Math.floor(l.z) });
      if (feet?.typeId !== "the_sift:ichor" && head?.typeId !== "the_sift:ichor") continue;
      p.addEffect("regeneration", 101, { amplifier: 0, showParticles: false });
      p.addEffect("slow_falling", 12, { amplifier: 0, showParticles: false });
      if (Math.random() < 0.4) dim.spawnParticle("the_sift:ichor_bubble", { x: l.x, y: l.y + 0.5, z: l.z });
    } catch { }
  }
}, 10);

// ---------------------------------------------------------------------------
// Siftita volta depois da morte
// ---------------------------------------------------------------------------
const recovered = new Map(); // playerId -> ItemStack[]

world.afterEvents.entityDie.subscribe((e) => {
  const p = e.deadEntity;
  if (p.typeId !== "minecraft:player") return;
  const dim = p.dimension;
  const loc = p.location;
  const id = p.id;
  system.runTimeout(() => {
    try {
      const items = dim.getEntities({ type: "minecraft:item", location: loc, maxDistance: 4 });
      const back = [];
      for (const it of items) {
        const stack = it.getComponent("minecraft:item")?.itemStack;
        if (stack && stack.hasTag("the_sift:siftite_item")) {
          back.push(stack.clone());
          dim.spawnParticle("the_sift:soul", it.location);
          it.remove();
        }
      }
      if (back.length) recovered.set(id, (recovered.get(id) ?? []).concat(back));
    } catch (err) {
      warn("siftita", err);
    }
  }, 2);
});

world.afterEvents.playerSpawn.subscribe((e) => {
  if (e.initialSpawn) return;
  const back = recovered.get(e.player.id);
  if (!back) return;
  recovered.delete(e.player.id);
  const player = e.player;
  system.runTimeout(() => {
    try {
      const inv = player.getComponent("minecraft:inventory")?.container;
      for (const s of back) {
        const rest = inv?.addItem(s) ?? s;
        if (rest) player.dimension.spawnItem(rest, player.location);
      }
      player.dimension.spawnParticle("the_sift:soul", { x: player.location.x, y: player.location.y + 1, z: player.location.z });
      player.playSound("item.armor.equip_netherite");
      award(player, "keep_inventory");
    } catch (err) {
      warn("siftita: devolver", err);
    }
  }, 10);
});

// ---------------------------------------------------------------------------
// Fendas
// ---------------------------------------------------------------------------
const riftCooldown = new Map();

system.runInterval(() => {
  const now = system.currentTick;
  for (const rift of nearPlayers("the_sift:rift", 24)) {
    try {
      const toSift = !!rift.getProperty("the_sift:to_sift");
      const dim = rift.dimension;
      if (Math.random() < 0.3) {
        const m = new MolangVariableMap();
        dim.spawnParticle("the_sift:portal_mist", { x: rift.location.x, y: rift.location.y + 1.5 + Math.random() * 2, z: rift.location.z }, m);
      }
      for (const p of dim.getPlayers({ location: rift.location, maxDistance: 1.6 })) {
        if ((riftCooldown.get(p.id) ?? 0) > now) continue;
        if (p.location.y < rift.location.y - 0.5 || p.location.y > rift.location.y + 4) continue;
        riftCooldown.set(p.id, now + 100);
        const x = Math.floor(p.location.x);
        const z = Math.floor(p.location.z);
        if (toSift) landInSift(p, x + 2, z);
        else landInOverworld(p, x + 2.5, z + 0.5);
        holdUntilExit(p);
        award(p, "rifter");
        // uma fenda de volta ao lado de onde ele chega
        system.runTimeout(() => {
          try {
            if (!p.isValid) return;
            if (p.dimension.getEntities({ type: "the_sift:rift", location: p.location, maxDistance: 8 }).length) return;
            const back = p.dimension.spawnEntity("the_sift:rift", { x: x + 0.5, y: p.location.y, z: z + 0.5 });
            back.setProperty("the_sift:to_sift", !toSift);
            p.dimension.playSound("the_sift.entity.rift.appear", back.location, { volume: 2 });
          } catch { }
        }, 20);
      }
    } catch (e) {
      warn("fenda", e);
    }
  }
}, 4);

