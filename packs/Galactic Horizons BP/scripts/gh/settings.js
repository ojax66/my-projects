/* =========================================================================
 * A engrenagem: o item que abre a escolha de idioma.
 *
 * Todo jogador ganha uma na primeira vez que entra no mundo, e só na primeira
 * — a marca fica numa propriedade dele. Perdeu? Tem receita (um lingote de
 * ferro e um redstone): um item de configuração que dá pra perder pra sempre
 * não é um item de configuração.
 *
 * O que ela troca é o idioma do que o SCRIPT escreve. Os NOMES de item e
 * bloco vêm dos .lang do pack de recurso e nenhum script os alcança — por isso
 * a tela diz, em três linhas, onde é que se troca aquilo (a engrenagem do
 * pack, nas configurações do mundo).
 * ========================================================================= */

import * as mc from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { SETTINGS_ITEM, SETTINGS_GIVEN_PROP } from "./config.js";
import { IDIOMAS, NOME_DO_IDIOMA, idiomaDe, definirIdioma, t } from "./i18n.js";

const world = mc.world;
const system = mc.system;

/** A tela de idioma. */
export function abrirIdioma(player) {
  const atual = idiomaDe(player);
  const form = new ActionFormData()
    .title(t(player, "idioma.titulo"))
    .body(t(player, "idioma.corpo"));

  for (const lang of IDIOMAS) {
    form.button(lang === atual
      ? `§a● §f${NOME_DO_IDIOMA[lang]}`
      : `§8○ §7${NOME_DO_IDIOMA[lang]}`);
  }

  form.show(player).then((res) => {
    if (res.canceled || res.selection === undefined) return;
    const escolhido = definirIdioma(player, IDIOMAS[res.selection]);
    try {
      player.sendMessage(t(player, "idioma.trocado",
                           { idioma: NOME_DO_IDIOMA[escolhido] }));
    } catch { }
  }).catch(() => { });
}

/** Dá a engrenagem, se este jogador ainda não tiver ganhado a dele. */
export function darEngrenagem(player) {
  let jaGanhou;
  try { jaGanhou = player.getDynamicProperty(SETTINGS_GIVEN_PROP); } catch { }
  if (jaGanhou) return false;

  try {
    const inv = player.getComponent("inventory")?.container;
    if (!inv) return false;
    inv.addItem(new mc.ItemStack(SETTINGS_ITEM, 1));
  } catch {
    return false;                 // inventário cheio: tenta de novo na próxima
  }
  try { player.setDynamicProperty(SETTINGS_GIVEN_PROP, true); } catch { }
  try { player.sendMessage(t(player, "idioma.boas_vindas")); } catch { }
  return true;
}

/** Liga o item e a entrega de boas-vindas. Chamado uma vez, do main.js. */
export function startSettings() {
  world.afterEvents.itemUse.subscribe((event) => {
    try {
      if (event.itemStack?.typeId !== SETTINGS_ITEM) return;
      const player = event.source;
      if (player?.typeId !== "minecraft:player") return;
      // A tela não abre de dentro do evento: o jogo recusa formulário aberto
      // no mesmo tick de um evento de item.
      system.run(() => abrirIdioma(player));
    } catch { }
  });

  world.afterEvents.playerSpawn.subscribe((event) => {
    try {
      if (!event.initialSpawn || !event.player) return;
      system.run(() => darEngrenagem(event.player));
    } catch { }
  });
}
