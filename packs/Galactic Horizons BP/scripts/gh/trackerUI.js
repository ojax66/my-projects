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
import { t, nome } from "./i18n.js";

// A barra de ação some quando outro addon roda `hud @s hide all` — o Spacecraft
// faz isso nas cinemáticas dele. O placar lateral não é um `hud_element` e
// sobrevive a isso, então é o padrão.
// O nome de cada canal, no idioma do jogador.
function canal(player, id) {
  return t(player, `tracker.canal_${id}`);
}

const ON = "§a●";
const OFF = "§8○";
const LOCKED = "§8🔒";

/** Menu principal: um botão por sistema. */
export async function openTracker(player) {
  const state = trackerState(player);

  const form = new ActionFormData()
    .title(t(player, "tracker.titulo"))
    .body(
      t(player, "tracker.corpo")
    );

  // Primeiro botão: onde o rastreador escreve. Fica no topo de propósito —
  // quem chega aqui porque não está vendo nada precisa achar isto de cara.
  form.button(`§f${canal(player, hudChannel(player))}\n${t(player, "tracker.trocar")}`);

  for (const system of state) {
    if (!system.unlocked) {
      form.button(`${LOCKED} §8${stripColor(nome(player, system.id, system.name))}\n`
                  + t(player, "tracker.sem_coordenadas"));
      continue;
    }
    const mark = system.on ? ON : OFF;
    const count = system.bodies.filter((b) => b.on).length;
    form.button(`${mark} ${nome(player, system.id, system.name)}\n`
                + t(player, "tracker.corpos_de", { n: count, total: system.bodies.length }));
  }

  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;

  if (res.selection === 0) {
    const next = cycleHudChannel(player);
    say(player, t(player, "tracker.agora", { canal: canal(player, next) }));
    await openTracker(player);
    return;
  }

  const chosen = state[res.selection - 1];
  if (!chosen) return;
  if (!chosen.unlocked) {
    say(player, t(player, "tracker.falta_coordenada"));
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
    .body(t(player, "tracker.liga_desliga"))
    .button(
      `${system.on ? ON : OFF} ${t(player, "tracker.sistema_inteiro")}\n§7`
      + t(player, system.on ? "tracker.ligado" : "tracker.desligado")
    );

  for (const body of system.bodies) {
    const mark = body.on ? ON : OFF;
    const note = t(player, body.generated ? "tracker.visitavel" : "tracker.so_rastreio");
    form.button(`${mark} ${body.name}\n${note}`);
  }
  form.button(t(player, "tracker.voltar"));

  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;

  if (res.selection === 0) {
    const on = toggleSystem(player, system.id);
    say(player, `${stripColor(nome(player, system.id, system.name))}: `
                + t(player, on ? "tracker.ligado_cor" : "tracker.desligado_cor"));
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
  say(player, `${stripColor(nome(player, body.id, body.name))}: `
              + t(player, on ? "tracker.ligado_cor" : "tracker.desligado_cor"));
  await openSystem(player, systemId);
}

function stripColor(s) {
  return String(s).replace(/§./g, "");
}

function say(player, msg) {
  try { player.sendMessage(msg); } catch { }
}
