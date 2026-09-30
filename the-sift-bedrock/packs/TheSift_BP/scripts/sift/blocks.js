/* =========================================================================
 * Comportamento dos blocos do Sift: componentes custom (JSON -> script) e as
 * interações que o Bedrock não dá de graça para blocos novos (lajes duplas,
 * camadas de neve, descascar tronco, folhas que caem, cercas que se ligam).
 * ========================================================================= */

import { world, system, BlockPermutation, BlockVolume, GameMode, ItemStack } from "@minecraft/server";
import { STRUCTURES } from "../generated.js";
import { award } from "./advancements.js";
import { warn } from "./worldgen.js";

const W = "the_sift:overgrown_willow";
const LOGS = new Set([W + "_log", W + "_wood", "the_sift:stripped_overgrown_willow_log", "the_sift:stripped_overgrown_willow_wood"]);
const STRIP = { [W + "_log"]: "the_sift:stripped_overgrown_willow_log", [W + "_wood"]: "the_sift:stripped_overgrown_willow_wood" };
const FOLIAGE = W + "_foliage";
const VINES = W + "_vines";

const isCreative = (p) => p.getGameMode() === GameMode.Creative;

function consumeHeld(player, n = 1) {
  if (isCreative(player)) return;
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return;
  const slot = player.selectedSlotIndex;
  const it = inv.getItem(slot);
  if (!it) return;
  if (it.amount > n) {
    it.amount -= n;
    inv.setItem(slot, it);
  } else inv.setItem(slot, undefined);
}

function bonemealFx(block) {
  try {
    block.dimension.spawnParticle("minecraft:crop_growth_emitter", { x: block.x + 0.5, y: block.y + 0.5, z: block.z + 0.5 });
    block.dimension.playSound("item.bone_meal.use", block.location);
  } catch { }
}

// ---------------------------------------------------------------------------
// Árvores
// ---------------------------------------------------------------------------
function growTree(block) {
  const big = Math.random() < 0.35;
  const name = big ? "overgrown_willow_big_01" : "overgrown_willow_small_01";
  const s = STRUCTURES[name];
  const dim = block.dimension;
  // espaço livre pro tronco
  for (let dy = 1; dy <= Math.min(6, s.size[1] - 1); dy++) {
    const b = dim.getBlock({ x: block.x, y: block.y + dy, z: block.z });
    if (!b || !(b.isAir || b.typeId === FOLIAGE || b.typeId === VINES)) return false;
  }
  block.setType("minecraft:air");
  try {
    world.structureManager.place("the_sift:" + name, dim,
      { x: block.x - s.trunk[0], y: block.y - s.trunk[1], z: block.z - s.trunk[2] }, { includeEntities: false });
    return true;
  } catch (e) {
    block.setType(W + "_sapling");
    warn("muda", e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Cercas
// ---------------------------------------------------------------------------
const FENCE = W + "_fence";
const DIRS = [["n", 0, -1], ["e", 1, 0], ["s", 0, 1], ["w", -1, 0]];

function connects(b) {
  if (!b || b.isAir || b.isLiquid) return false;
  const t = b.typeId;
  if (t === FENCE || t === W + "_fence_gate") return true;
  if (t.endsWith("_fence") || t.endsWith("fence_gate")) return true;
  if (t.startsWith("the_sift:") && (t.includes("sapling") || t.includes("vines") || t.includes("stalks") ||
      t.includes("sprouts") || t.includes("roots") || t.includes("button") || t.includes("pressure_plate") ||
      t.includes("door") || t.includes("_slab") || t.includes("_stairs"))) return false;
  try {
    return b.isSolid;
  } catch {
    return false;
  }
}

function refreshFence(block) {
  if (block?.typeId !== FENCE) return;
  let p = block.permutation;
  for (const [s, dx, dz] of DIRS) {
    const n = block.dimension.getBlock({ x: block.x + dx, y: block.y, z: block.z + dz });
    p = p.withState("the_sift:" + s, connects(n));
  }
  block.setPermutation(p);
}

function refreshAround(dim, loc) {
  for (const [, dx, dz] of DIRS) {
    try { refreshFence(dim.getBlock({ x: loc.x + dx, y: loc.y, z: loc.z + dz })); } catch { }
  }
}

// ---------------------------------------------------------------------------
// Folhas: sem tronco num raio de 4 elas caem (só as naturais)
// ---------------------------------------------------------------------------
function decayAround(dim, loc) {
  const hr = dim.heightRange;
  const r = 5;
  const vol = new BlockVolume({ x: loc.x - r, y: Math.max(hr.min, loc.y - r), z: loc.z - r },
                              { x: loc.x + r, y: Math.min(hr.max - 1, loc.y + r), z: loc.z + r });
  const logVol = new BlockVolume({ x: loc.x - 9, y: Math.max(hr.min, loc.y - 9), z: loc.z - 9 },
                                 { x: loc.x + 9, y: Math.min(hr.max - 1, loc.y + 9), z: loc.z + 9 });
  const logs = [];
  const leaves = [];
  try {
    for (const p of dim.getBlocks(logVol, { includeTypes: [...LOGS] }, true).getBlockLocationIterator()) logs.push({ x: p.x, y: p.y, z: p.z });
    for (const p of dim.getBlocks(vol, { includeTypes: [FOLIAGE] }, true).getBlockLocationIterator()) leaves.push({ x: p.x, y: p.y, z: p.z });
  } catch (e) {
    warn("folhas", e);
    return;
  }
  const doomed = leaves.filter((l) => {
    const b = dim.getBlock(l);
    if (!b || b.permutation.getState("the_sift:persistent")) return false;
    return !logs.some((g) => Math.abs(g.x - l.x) + Math.abs(g.y - l.y) + Math.abs(g.z - l.z) <= 5);
  });
  // cai aos poucos, como no jogo
  doomed.sort(() => Math.random() - 0.5);
  let i = 0;
  const id = system.runInterval(() => {
    for (let n = 0; n < 3 && i < doomed.length; n++, i++) {
      const l = doomed[i];
      try {
        if (dim.getBlock(l)?.typeId === FOLIAGE) {
          dim.runCommand(`setblock ${l.x} ${l.y} ${l.z} air destroy`);
          if (Math.random() < 0.05) dim.spawnItem(new ItemStack(W + "_sapling", 1), { x: l.x + 0.5, y: l.y + 0.5, z: l.z + 0.5 });
        }
      } catch { }
    }
    if (i >= doomed.length) system.clearRun(id);
  }, 2);
}

// ---------------------------------------------------------------------------
// Componentes custom
// ---------------------------------------------------------------------------
system.beforeEvents.startup.subscribe((ev) => {
  const reg = ev.blockComponentRegistry;

  reg.registerCustomComponent("the_sift:crop", {
    onRandomTick(e, p) {
      const params = /** @type {any} */ (p.params) ?? {};
      const age = e.block.permutation.getState("the_sift:age");
      if (typeof age !== "number" || age >= (params.max_age ?? 2)) return;
      if (Math.random() < (params.chance ?? 0.2)) e.block.setPermutation(e.block.permutation.withState("the_sift:age", age + 1));
    },
  });

  reg.registerCustomComponent("the_sift:sapling", {
    onRandomTick(e) {
      if (Math.random() < 1 / 7) growTree(e.block);
    },
  });

  reg.registerCustomComponent("the_sift:leaves", {
    beforeOnPlayerPlace(e) {
      e.permutationToPlace = e.permutationToPlace.withState("the_sift:persistent", true);
    },
  });

  reg.registerCustomComponent("the_sift:vines", {
    beforeOnPlayerPlace(e) {
      const face = e.permutationToPlace.getState("minecraft:block_face");
      let facing = { south: "north", north: "south", east: "west", west: "east" }[String(face)] ?? "north";
      const above = e.block.above();
      if (face === "down" && above?.typeId === VINES) facing = String(above.permutation.getState("the_sift:facing") ?? "north");
      const below = e.block.below();
      e.permutationToPlace = e.permutationToPlace.withState("the_sift:facing", facing)
        .withState("the_sift:tip", below?.typeId !== VINES);
    },
    onPlace(e) {
      const above = e.block.above();
      if (above?.typeId === VINES && above.permutation.getState("the_sift:tip")) {
        above.setPermutation(above.permutation.withState("the_sift:tip", false));
      }
    },
    onPlayerBreak(e) {
      const above = e.block.above();
      if (above?.typeId === VINES) above.setPermutation(above.permutation.withState("the_sift:tip", true));
    },
    onRandomTick(e) {
      if (Math.random() > 0.12) return;
      const below = e.block.below();
      if (!below?.isAir) return;
      // corrente de no máximo 8
      let len = 1;
      let b = e.block.above();
      while (b?.typeId === VINES && len < 9) { len++; b = b.above(); }
      if (len >= 8) return;
      below.setPermutation(e.block.permutation.withState("minecraft:block_face", "down").withState("the_sift:tip", true));
      e.block.setPermutation(e.block.permutation.withState("the_sift:tip", false));
    },
  });

  reg.registerCustomComponent("the_sift:fence", {
    onPlace(e) {
      system.run(() => {
        try {
          refreshFence(e.block);
          refreshAround(e.dimension, e.block.location);
        } catch { }
      });
    },
    onPlayerBreak(e) {
      refreshAround(e.dimension, e.block.location);
    },
  });

  reg.registerCustomComponent("the_sift:toggle", {
    onPlayerInteract(e, p) {
      const params = /** @type {any} */ (p.params) ?? {};
      const state = params.state ?? "the_sift:open";
      const open = !e.block.permutation.getState(state);
      e.block.setPermutation(e.block.permutation.withState(state, open));
      try { e.dimension.playSound(open ? params.sound_open : params.sound_close, e.block.location); } catch { }
    },
  });

  // Porta: a metade de baixo é a colocada pelo item; a de cima é posta aqui.
  reg.registerCustomComponent("the_sift:door", {
    beforeOnPlayerPlace(e) {
      const above = e.block.above();
      if (!above || !(above.isAir || above.isLiquid)) e.cancel = true;
    },
    onPlace(e) {
      const b = e.block;
      if (b.permutation.getState("the_sift:upper")) return;
      const above = b.above();
      if (above && (above.isAir || above.isLiquid)) {
        above.setPermutation(b.permutation.withState("the_sift:upper", true));
      }
    },
    onPlayerBreak(e) {
      const upper = !!e.brokenBlockPermutation.getState("the_sift:upper");
      const other = upper ? e.block.below() : e.block.above();
      if (other?.typeId === e.brokenBlockPermutation.type.id) {
        // a metade de baixo é a que dá o item; quebrar a de cima derruba a de baixo
        if (upper) e.dimension.runCommand(`setblock ${other.x} ${other.y} ${other.z} air destroy`);
        else other.setType("minecraft:air");
      }
    },
    onPlayerInteract(e) {
      const b = e.block;
      const upper = b.permutation.getState("the_sift:upper");
      const other = upper ? b.below() : b.above();
      const open = !b.permutation.getState("the_sift:open");
      b.setPermutation(b.permutation.withState("the_sift:open", open));
      if (other?.typeId === b.typeId) other.setPermutation(other.permutation.withState("the_sift:open", open));
      try { e.dimension.playSound(open ? "open.wooden_door" : "close.wooden_door", b.location); } catch { }
    },
  });

  reg.registerCustomComponent("the_sift:button", {
    onPlayerInteract(e, p) {
      const b = e.block;
      if (b.permutation.getState("the_sift:pressed")) return;
      b.setPermutation(b.permutation.withState("the_sift:pressed", true));
      try { e.dimension.playSound("click_on.wooden_button", b.location); } catch { }
      const ticks = /** @type {any} */ (p.params)?.ticks ?? 30;
      const loc = b.location;
      const dim = e.dimension;
      system.runTimeout(() => {
        try {
          const now = dim.getBlock(loc);
          if (now?.typeId === b.typeId && now.permutation.getState("the_sift:pressed")) {
            now.setPermutation(now.permutation.withState("the_sift:pressed", false));
            dim.playSound("click_off.wooden_button", loc);
          }
        } catch { }
      }, ticks);
    },
  });

  reg.registerCustomComponent("the_sift:pressure_plate", {
    onTick(e) {
      const b = e.block;
      const c = { x: b.x + 0.5, y: b.y + 0.2, z: b.z + 0.5 };
      let pressed = false;
      try {
        pressed = e.dimension.getEntities({ location: c, maxDistance: 0.75 })
          .some((en) => Math.abs(en.location.y - b.y) < 0.6);
      } catch { }
      const was = !!b.permutation.getState("the_sift:pressed");
      if (pressed !== was) {
        b.setPermutation(b.permutation.withState("the_sift:pressed", pressed));
        try { e.dimension.playSound(pressed ? "click_on.wooden_pressure_plate" : "click_off.wooden_pressure_plate", b.location); } catch { }
      }
    },
  });
});

// ---------------------------------------------------------------------------
// Interações com item na mão
// ---------------------------------------------------------------------------
world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  const item = e.itemStack;
  if (!item) return;
  const block = e.block;
  const t = block.typeId;
  const player = e.player;

  // laje dupla
  if (item.typeId === W + "_slab" && t === W + "_slab" && !block.permutation.getState("the_sift:double")) {
    const half = block.permutation.getState("minecraft:vertical_half");
    if ((half === "bottom" && e.blockFace === "Up") || (half === "top" && e.blockFace === "Down")) {
      e.cancel = true;
      if (!e.isFirstEvent) return;
      system.run(() => {
        block.setPermutation(block.permutation.withState("the_sift:double", true));
        block.dimension.playSound("use.wood", block.location);
        consumeHeld(player);
      });
    }
    return;
  }

  // camadas de neve de ichor
  if (item.typeId === "the_sift:ichor_snow" && t === "the_sift:ichor_snow" && e.blockFace === "Up") {
    e.cancel = true;
    if (!e.isFirstEvent) return;
    system.run(() => {
      const n = Number(block.permutation.getState("the_sift:layers") ?? 1);
      if (n >= 7) block.setType("the_sift:ichor_snow_block");
      else block.setPermutation(block.permutation.withState("the_sift:layers", n + 1));
      block.dimension.playSound("use.snow", block.location);
      consumeHeld(player);
    });
    return;
  }

  // descascar tronco com machado
  if (STRIP[t] && item.hasTag("minecraft:is_axe")) {
    e.cancel = true;
    if (!e.isFirstEvent) return;
    system.run(() => {
      const face = block.permutation.getState("minecraft:block_face");
      block.setPermutation(BlockPermutation.resolve(STRIP[t], { "minecraft:block_face": face }));
      block.dimension.playSound("use.wood", block.location);
    });
    return;
  }

  // farinha de osso
  if (item.typeId === "minecraft:bone_meal") {
    if (t === "the_sift:sculkflower_crop") {
      const age = Number(block.permutation.getState("the_sift:age") ?? 0);
      if (age >= 2) return;
      e.cancel = true;
      if (!e.isFirstEvent) return;
      system.run(() => {
        block.setPermutation(block.permutation.withState("the_sift:age", Math.min(2, age + 1 + (Math.random() < 0.3 ? 1 : 0))));
        bonemealFx(block);
        consumeHeld(player);
      });
    } else if (t === W + "_sapling") {
      e.cancel = true;
      if (!e.isFirstEvent) return;
      system.run(() => {
        bonemealFx(block);
        consumeHeld(player);
        if (Math.random() < 0.45) growTree(block);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Quebrar / colocar
// ---------------------------------------------------------------------------
const ORES = {
  "the_sift:siftslate_coal_ore": { xp: [0, 2], drop: "minecraft:coal" },
  "the_sift:siftslate_diamond_ore": { xp: [3, 7], drop: "minecraft:diamond" },
  "the_sift:siftslate_emerald_ore": { xp: [3, 7], drop: "minecraft:emerald" },
  "the_sift:siftslate_charoite_ore": { xp: [2, 5], drop: "the_sift:charoite", adv: "kinda_purpleish" },
  "the_sift:siftslate_siftite_ore": { xp: [3, 7], drop: "the_sift:siftite_nugget", adv: "sifted_nugget" },
};

function toolLevel(item, name) {
  try {
    return item?.getComponent("minecraft:enchantable")?.getEnchantment(name)?.level ?? 0;
  } catch {
    return 0;
  }
}

world.afterEvents.playerBreakBlock.subscribe((e) => {
  const id = e.brokenBlockPermutation.type.id;
  const dim = e.dimension;
  const loc = e.block.location;
  try {
    if (LOGS.has(id)) system.runTimeout(() => decayAround(dim, loc), 5);
    refreshAround(dim, loc);

    const ore = ORES[id];
    if (ore && !isCreative(e.player)) {
      const tool = e.itemStackBeforeBreak;
      if (!tool?.hasTag("minecraft:is_pickaxe")) return;
      if (ore.adv) award(e.player, ore.adv);
      if (toolLevel(tool, "silk_touch") > 0) return;
      const c = { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 };
      const xp = ore.xp[0] + Math.floor(Math.random() * (ore.xp[1] - ore.xp[0] + 1));
      for (let i = 0; i < xp; i++) dim.spawnEntity("minecraft:xp_orb", c);
      // Fortuna: como nos minérios do jogo, multiplicador 0..nível extra
      const fortune = toolLevel(tool, "fortune");
      if (fortune > 0) {
        const extra = Math.max(0, Math.floor(Math.random() * (fortune + 2)) - 1);
        for (let i = 0; i < extra; i++) dim.spawnItem(new ItemStack(ore.drop, 1), c);
      }
    }
  } catch (err) {
    warn("quebrar bloco", err);
  }
});

world.afterEvents.playerPlaceBlock.subscribe((e) => {
  try {
    const b = e.block;
    refreshAround(b.dimension, b.location);
    if (b.typeId === "the_sift:sculkflower_crop" || b.typeId === "the_sift:sculkflower") {
      if (b.below()?.typeId === "minecraft:sculk") award(e.player, "planting_the_dark");
    }
  } catch { }
});
