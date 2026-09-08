/* =========================================================================
 * Mapas estelares e o aparelho de rastreio.
 *
 * O mapa estelar é o "papel com as coordenadas": o jogador acha um, usa, o
 * papel some da mão e o sistema daquele mapa entra no rastreador pra sempre.
 * Um mapa repetido avisa que já foi lido e NÃO é consumido — perder um item
 * por engano é pior que carregar um a mais.
 *
 * O mesmo caminho serve pra upgrade de nave: quem quiser abrir um sistema por
 * outro meio chama `unlockSystem` (tracker.js) ou dispara
 * `/scriptevent space_dim:unlock <sistema>`. O mapa é só a primeira forma.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import { unlockSystem } from "./tracker.js";
import { systemById } from "./catalog.js";
import { openTracker } from "./trackerUI.js";

const world = mc.world;
const system = mc.system;

// Prefixo dos itens de mapa: o que vem depois é o id do sistema, então um
// sistema novo não precisa de código novo — só do item e da receita/loot.
const CHART_PREFIX = "space_dim:star_chart_";
const TRACKER_ITEM = "space_dim:tracker";

/** Tira um do item que o jogador acabou de usar. */
function consumeHeld(player, typeId) {
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return false;
    const slot = player.selectedSlotIndex;
    const item = inv.getItem(slot);
    if (!item || item.typeId !== typeId) return false;
    if (item.amount > 1) {
      item.amount -= 1;
      inv.setItem(slot, item);
    } else {
      inv.setItem(slot, undefined);
    }
    return true;
  } catch {
    return false;
  }
}

function useChart(player, typeId) {
  const systemId = typeId.slice(CHART_PREFIX.length);
  const target = systemById(systemId);
  if (!target) {
    try { player.sendMessage("§cEste mapa não aponta pra lugar nenhum."); } catch { }
    return;
  }

  if (!unlockSystem(player, systemId)) {
    // Já conhecido: avisa e devolve o item. Consumir aqui seria cobrar de novo
    // por algo que o jogador já pagou.
    try {
      player.sendMessage(`§7Você já tem as coordenadas de ${strip(target.name)}.`);
    } catch { }
    return;
  }

  consumeHeld(player, typeId);
  try {
    player.sendMessage(
      `§b§lCOORDENADAS REGISTRADAS\n§r§7${strip(target.name)} entrou no rastreador.`
    );
    player.playSound("random.levelup", { volume: 0.6, pitch: 1.2 });
  } catch { }
}

function strip(s) {
  return String(s).replace(/§./g, "");
}

// ---------------------------------------------------------------------------
// Ligações
// ---------------------------------------------------------------------------

world.afterEvents.itemUse.subscribe((event) => {
  const player = event.source;
  const typeId = event.itemStack?.typeId;
  if (!player || !typeId) return;

  if (typeId === TRACKER_ITEM) {
    // O menu precisa rodar fora do handler do evento: mostrar um formulário
    // direto de dentro de um evento do jogo é recusado pelo motor.
    system.run(() => { openTracker(player).catch(() => { }); });
    return;
  }

  if (typeId.startsWith(CHART_PREFIX)) {
    system.run(() => useChart(player, typeId));
  }
});

// Porta pra upgrades de nave e pra testes:
//   /scriptevent space_dim:unlock <id do sistema>
system.afterEvents.scriptEventReceive.subscribe((data) => {
  if (data.id !== "space_dim:unlock") return;
  const player = data.sourceEntity;
  if (player?.typeId !== "minecraft:player") return;
  const systemId = String(data.message ?? "").trim();
  if (!systemId) return;
  if (unlockSystem(player, systemId)) {
    try { player.sendMessage(`§b${systemId} entrou no rastreador.`); } catch { }
  } else {
    try { player.sendMessage(`§7${systemId}: já conhecido, ou não existe.`); } catch { }
  }
});
