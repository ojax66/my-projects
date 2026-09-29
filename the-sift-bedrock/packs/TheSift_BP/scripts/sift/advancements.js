/* =========================================================================
 * Conquistas do Sift.
 *
 * O Bedrock não tem árvore de conquistas custom. As do mod viram um aviso no
 * chat (com o título traduzido) mais um som, e ficam guardadas no jogador pra
 * não repetir. /scriptevent the_sift:advancements lista as que ele já tem.
 * ========================================================================= */

import { system, world, EquipmentSlot } from "@minecraft/server";

const KEY = "the_sift:advancements";

export const ADVANCEMENTS = [
  "root", "story.brave_the_unknown", "story.fallen_civilization", "story.song_of_the_past",
  "blood_of_the_gods", "blub", "certified_sifter", "cover_me_in_siftite", "false_alarm", "food_chain",
  "friend_of_the_sift", "keep_inventory", "kinda_purpleish", "like_father_and_son", "planting_the_dark",
  "rift_resonance", "rifter", "sifted_nugget", "smells_creepy", "spicewood",
];

function owned(player) {
  try {
    const raw = player.getDynamicProperty(KEY);
    return typeof raw === "string" ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function hasAdvancement(player, key) {
  return owned(player).includes(key);
}

/** Concede a conquista uma vez só. `key` sem o prefixo "the_sift.". */
export function award(player, key) {
  if (!player?.isValid) return;
  const list = owned(player);
  if (list.includes(key)) return;
  list.push(key);
  if (key !== "root" && !list.includes("root")) list.push("root");
  try {
    player.setDynamicProperty(KEY, JSON.stringify(list));
  } catch { }
  try {
    player.sendMessage({
      rawtext: [
        { text: "§a" },
        { translate: "message.the_sift.advancement", with: { rawtext: [{ text: "§e[" }, { translate: `advancement.the_sift.${key}.title` }, { text: "]§r" }] } },
        { text: "\n§7" },
        { translate: `advancement.the_sift.${key}.description` },
      ],
    });
    player.playSound("random.levelup", { pitch: 1.4, volume: 0.6 });
  } catch { }
}

system.afterEvents.scriptEventReceive.subscribe((e) => {
  if (e.id !== "the_sift:advancements") return;
  const player = /** @type {import("@minecraft/server").Player} */ (e.sourceEntity);
  if (!player || player.typeId !== "minecraft:player") return;
  const list = owned(player);
  /** @type {any[]} */
  const lines = [{ text: `§6The Sift: ${list.length}/${ADVANCEMENTS.length}\n` }];
  for (const k of ADVANCEMENTS) {
    lines.push({ text: list.includes(k) ? "§a✔ " : "§8✘ " });
    lines.push({ translate: `advancement.the_sift.${k}.title` });
    lines.push({ text: "\n" });
  }
  try { player.sendMessage({ rawtext: lines }); } catch { }
});

// Algumas conquistas são só "ter o item": checadas de vez em quando.
const ITEM_ADVANCEMENTS = {
  "the_sift:sculkflower_seeds": "smells_creepy",
};

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    try {
      const inv = player.getComponent("minecraft:inventory")?.container;
      if (inv) {
        for (let i = 0; i < inv.size; i++) {
          const it = inv.getItem(i);
          const adv = it && ITEM_ADVANCEMENTS[it.typeId];
          if (adv) award(player, adv);
        }
      }
      const eq = player.getComponent("minecraft:equippable");
      if (eq) {
        const slots = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet];
        if (slots.every((s) => eq.getEquipment(s)?.typeId?.startsWith("the_sift:siftite_"))) {
          award(player, "cover_me_in_siftite");
        }
      }
    } catch { }
  }
}, 100);
