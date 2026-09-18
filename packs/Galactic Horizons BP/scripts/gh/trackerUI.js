/* =========================================================================
 * O menu do rastreador.
 *
 * A bússola de antes era uma linha de texto montada por comando; não dava pra
 * escolher nada. Aqui o jogador abre um menu de verdade (@minecraft/server-ui),
 * vê os sistemas que conhece, e liga ou desliga o que quiser — um sistema
 * inteiro ou um corpo de cada vez.
 *
 * Sistema trancado aparece na lista, mas cinza e sem entrar: saber que existe
 * algo pra achar é parte do jogo. O que ele não mostra é ONDE está.
 * ========================================================================= */

import { ActionFormData } from "@minecraft/server-ui";
import { trackerState, toggleSystem, toggleBody, hudChannel, cycleHudChannel } from "./tracker.js";

// A barra de ação some quando outro addon roda `hud @s hide all` — o Spacecraft
// faz isso nas cinemáticas dele. O placar lateral não é um `hud_element` e
// sobrevive a isso, então é o padrão.
const CHANNEL_LABEL = {
  sidebar: "mostrar no placar lateral",
  actionbar: "mostrar na barra de ação",
  off: "§8não mostrar",
};

const ON = "§a●";
const OFF = "§8○";
const LOCKED = "§8🔒";

/** Menu principal: um botão por sistema. */
export async function openTracker(player) {
  const state = trackerState(player);

  const form = new ActionFormData()
    .title("§lRastreador Estelar")
    .body(
      "§7Sistemas que você conhece. Desligar não apaga o que já foi\n" +
      "§7descoberto — só tira da tela."
    );

  // Primeiro botão: onde o rastreador escreve. Fica no topo de propósito —
  // quem chega aqui porque não está vendo nada precisa achar isto de cara.
  form.button(`§f${CHANNEL_LABEL[hudChannel(player)]}\n§7toque pra trocar`);

  for (const system of state) {
    if (!system.unlocked) {
      form.button(`${LOCKED} §8${stripColor(system.name)}\n§8sem coordenadas`);
      continue;
    }
    const mark = system.on ? ON : OFF;
    const count = system.bodies.filter((b) => b.on).length;
    form.button(`${mark} ${system.name}\n§7${count} de ${system.bodies.length} corpos`);
  }

  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;

  if (res.selection === 0) {
    const next = cycleHudChannel(player);
    say(player, `Rastreador: §f${CHANNEL_LABEL[next]}`);
    await openTracker(player);
    return;
  }

  const chosen = state[res.selection - 1];
  if (!chosen) return;
  if (!chosen.unlocked) {
    say(player, "§7Você ainda não tem as coordenadas desse sistema.");
    return;
  }
  await openSystem(player, chosen.id);
}

/** Menu de um sistema: liga/desliga o sistema todo ou cada corpo. */
async function openSystem(player, systemId) {
  const system = trackerState(player).find((s) => s.id === systemId);
  if (!system) return;

  const form = new ActionFormData()
    .title(system.name)
    .body("§7Toque pra ligar ou desligar.")
    .button(
      `${system.on ? ON : OFF} §fSistema inteiro\n§7${system.on ? "ligado" : "desligado"}`
    );

  for (const body of system.bodies) {
    const mark = body.on ? ON : OFF;
    const note = body.generated ? "§7visitável" : "§8só rastreio";
    form.button(`${mark} ${body.name}\n${note}`);
  }
  form.button("§8‹ voltar");

  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;

  if (res.selection === 0) {
    const on = toggleSystem(player, system.id);
    say(player, `${stripColor(system.name)}: ${on ? "§aligado" : "§8desligado"}`);
    await openSystem(player, systemId);
    return;
  }

  const bodyIndex = res.selection - 1;
  if (bodyIndex >= system.bodies.length) {
    await openTracker(player);      // botão "voltar"
    return;
  }

  const body = system.bodies[bodyIndex];
  const on = toggleBody(player, body.id);
  say(player, `${stripColor(body.name)}: ${on ? "§aligado" : "§8desligado"}`);
  await openSystem(player, systemId);
}

function stripColor(s) {
  return String(s).replace(/§./g, "");
}

function say(player, msg) {
  try { player.sendMessage(msg); } catch { }
}
