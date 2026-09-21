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
 *
 * POR QUE ELA NÃO ABRIA. Duas coisas, e as duas dependiam de como se toca:
 *
 *   1. `itemUse` só dispara quando o item é usado NO AR. Mirando um bloco —
 *      que no celular é quase sempre, porque o dedo cai no chão — quem dispara
 *      é a interação com o bloco, e a engrenagem não ouvia esse evento. Quem
 *      jogava olhando pro céu dizia que funcionava; todo mundo dizia que não.
 *
 *   2. formulário aberto enquanto o jogador ainda está com o dedo na tela volta
 *      recusado, com `UserBusy`. O código pedia uma vez e desistia calado — que
 *      é exatamente a cara de um botão que não faz nada. Agora insiste.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import { ActionFormData, FormCancelationReason } from "@minecraft/server-ui";
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

  mostrar(player, form);
}

// Quantas vezes insistir com um formulário recusado, e de quanto em quanto.
// Dez tentativas de meio segundo dão cinco segundos — tempo de sobra pro
// jogador tirar o dedo da tela, e pouco pra ele achar que travou.
const ABRIR_TENTATIVAS = 10;
const ABRIR_ESPERA = 10;

/**
 * Mostra o formulário, insistindo enquanto o jogo disser que ele está ocupado.
 *
 * `UserBusy` é o jogo dizendo "este jogador está com uma tela na mão agora" —
 * e é o que acontece quando o formulário é pedido no mesmo toque que o abriu.
 * Desistir na primeira recusa é o que fazia a engrenagem parecer quebrada.
 * `UserClosed` é diferente: aí ele fechou porque quis, e insistir seria prendê-lo
 * numa tela que ele acabou de dispensar.
 */
function mostrar(player, form, tentativas = ABRIR_TENTATIVAS) {
  form.show(player).then((res) => {
    if (res.canceled) {
      if (res.cancelationReason === FormCancelationReason.UserBusy && tentativas > 0) {
        system.runTimeout(() => mostrar(player, form, tentativas - 1), ABRIR_ESPERA);
      }
      return;
    }
    if (res.selection === undefined) return;
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
  // Usada no ar.
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

  // Usada MIRANDO UM BLOCO, que no celular é o caso normal: o dedo cai no
  // chão, o jogo trata como interação com o bloco, e `itemUse` nem chega a
  // disparar. Sem isto a engrenagem só abria pra quem tocasse olhando pro céu.
  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    try {
      if (event.itemStack?.typeId !== SETTINGS_ITEM) return;
      const player = event.player;
      if (!player) return;
      // Agachado o jogo faz o de sempre — é o que deixa abrir um baú ou uma
      // porta sem precisar guardar a engrenagem. Mesma convenção da lixeira.
      if (player.isSneaking) return;

      event.cancel = true;
      system.run(() => abrirIdioma(player));
    } catch { }
  });

  // Usada MIRANDO UMA ENTIDADE. Mesmo caso do bloco: quem dispara é a interação
  // com a entidade, e `itemUse` fica de fora.
  try {
    world.beforeEvents.playerInteractWithEntity?.subscribe?.((event) => {
      try {
        if (event.itemStack?.typeId !== SETTINGS_ITEM) return;
        const player = event.player;
        if (!player || player.isSneaking) return;
        event.cancel = true;
        system.run(() => abrirIdioma(player));
      } catch { }
    });
  } catch { }

  world.afterEvents.playerSpawn.subscribe((event) => {
    try {
      if (!event.initialSpawn || !event.player) return;
      system.run(() => darEngrenagem(event.player));
    } catch { }
  });
}
