/* =========================================================================
 * Ambiente do espaço: estrelas, névoa e a bússola da action bar.
 *
 * As estrelas são partículas numa casca esférica ao redor do jogador, então
 * ficam em volta inteiro, não só por cima. O campo é reemitido antes do
 * anterior vencer, pra nunca haver um piscar sem estrelas.
 *
 * A bússola existe porque o Sol e Marte ficam muito além da distância de
 * renderização: sem ela, achar os dois seria vagar no escuro.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import {
  BODIES,
  STARFIELD_PARTICLE,
  SPACE_DUST_PARTICLE,
  STARFIELD_INTERVAL_TICKS,
  SPACE_DUST_INTERVAL_TICKS,
  FOG_ID,
  FOG_LABEL,
  HUD_ENABLED,
  HUD_INTERVAL_TICKS,
  HUD_OBJECTIVE,
  PORTAL_MARGIN,
} from "./config.js";
import { chebyshevTo } from "./bodies.js";
import { trackedBodies, hudChannel } from "./tracker.js";
import { t, nome } from "./i18n.js";

// O título do placar é do MUNDO, não de um jogador: o objetivo é um só e
// todo mundo vê o mesmo. Fica em português, que é o idioma padrão do addon.
const HUD_TITULO = "§lRASTREADOR";

const world = mc.world;
const system = mc.system;

// playerId → tick do último campo de estrelas / poeira
const lastStars = new Map();
const lastDust = new Map();
// playerId → qual névoa está empilhada agora
const fogged = new Map();

export function spawnAmbience(player) {
  const now = system.currentTick;

  const stars = lastStars.get(player.id);
  if (stars === undefined || now - stars >= STARFIELD_INTERVAL_TICKS) {
    lastStars.set(player.id, now);
    try {
      player.dimension.spawnParticle(STARFIELD_PARTICLE, player.location);
    } catch { }
  }

  const dust = lastDust.get(player.id);
  if (dust === undefined || now - dust >= SPACE_DUST_INTERVAL_TICKS) {
    lastDust.set(player.id, now);
    try {
      player.dimension.spawnParticle(SPACE_DUST_PARTICLE, player.location);
    } catch { }
  }
}

// O bioma custom já traz a névoa do espaço; este push é o cinto de segurança
// pra o caso de o bioma não aplicar na versão do jogo, e é também como a névoa
// dourada do Sol entra.
//
// Só troca quando a névoa DESEJADA muda. Empilhar todo tick é a armadilha que
// o Spacecraft documenta: estoura o limite de identificadores de neblina.
// O bioma custom já traz a névoa do espaço; este push é o cinto de segurança
// pra o caso de o bioma não aplicar na versão do jogo.
//
// Uma versão anterior trocava a névoa por faixas douradas perto do Sol, pra
// "iluminar o sistema". Estava mexendo no lugar errado: quem tem que parecer
// iluminado é o corpo celeste, não o vácuo entre eles. O espaço voltou a ser
// uma névoa só.
//
// Empilha UMA vez por jogador — a armadilha que o Spacecraft documenta:
// empilhar todo tick estoura o limite de identificadores de neblina.
export function pushFog(player, fogId = FOG_ID) {
  if (fogged.get(player.id) === fogId) return;
  fogged.set(player.id, fogId);
  try {
    player.runCommand(`fog @s remove ${FOG_LABEL}`);
    player.runCommand(`fog @s push ${fogId} ${FOG_LABEL}`);
  } catch { }
}

export function popFog(player) {
  if (!fogged.delete(player.id)) return;
  try { player.runCommand(`fog @s remove ${FOG_LABEL}`); } catch { }
}

export function forgetPlayer(playerId) {
  lastStars.delete(playerId);
  lastDust.delete(playerId);
  fogged.delete(playerId);
}

// ---------------------------------------------------------------------------
// Bússola
// ---------------------------------------------------------------------------

/**
 * Diferença, em graus (-180..180), entre pra onde o jogador olha e onde o
 * corpo está. No Bedrock o yaw 0 aponta pro +Z e cresce no sentido do -X.
 */
function bearingDelta(player, body) {
  const dx = body.center.x - player.location.x;
  const dz = body.center.z - player.location.z;
  const target = (Math.atan2(-dx, dz) * 180) / Math.PI;

  let yaw = 0;
  try { yaw = player.getRotation().y; } catch { }

  let delta = target - yaw;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

function marker(delta) {
  if (Math.abs(delta) <= 22) return "§a|";
  return delta > 0 ? "§8>" : "§8<";
}

// ---------------------------------------------------------------------------
// Placar lateral
// ---------------------------------------------------------------------------
//
// O canal que sobrevive a `hud @s hide all`. O slot lateral é do MUNDO, não do
// jogador, então só é usado quando há um jogador só no espaço — com dois, cada
// um veria as distâncias do outro. Nesse caso o rastreador volta pra barra de
// ação sozinho.

let objectiveReady = false;

// O que está escrito agora, pra não reescrever linha por linha todo tick: cada
// escrita no placar é um pacote de rede pro cliente.
let sidebarShown = "";

function sidebarObjective() {
  try {
    let obj = world.scoreboard.getObjective(HUD_OBJECTIVE);
    if (!obj) obj = world.scoreboard.addObjective(HUD_OBJECTIVE, HUD_TITULO);
    if (!objectiveReady) {
      world.scoreboard.setObjectiveAtDisplaySlot("sidebar", { objective: obj });
      objectiveReady = true;
    }
    return obj;
  } catch {
    return null;
  }
}

export function clearSidebar() {
  // Zera o cache SEMPRE, mesmo sem placar montado: sem isso, quem sai do espaço
  // e volta com o rastreador no mesmo estado não vê nada — o cache diz "já está
  // escrito assim" e o placar, que foi removido, nunca é remontado.
  sidebarShown = "";
  if (!objectiveReady) return;
  objectiveReady = false;
  try { world.scoreboard.clearObjectiveAtDisplaySlot("sidebar"); } catch { }
  try { world.scoreboard.removeObjective(HUD_OBJECTIVE); } catch { }
}

function renderSidebar(lines) {
  const key = lines.join("\n");
  if (key === sidebarShown) return true;

  const obj = sidebarObjective();
  if (!obj) return false;

  try {
    for (const p of obj.getParticipants()) obj.removeParticipant(p);
    // O placar ordena por pontuação, de cima pra baixo. Contando ao contrário,
    // a primeira linha da lista fica no topo.
    let score = lines.length;
    for (const line of lines) obj.setScore(line, score--);
  } catch {
    return false;
  }
  sidebarShown = key;
  return true;
}

export function showCompass(player, warning) {
  if (!HUD_ENABLED) return;
  if (system.currentTick % HUD_INTERVAL_TICKS !== 0) return;

  const channel = hudChannel(player);
  if (channel === "off") return;

  if (warning) {
    write(player, channel, [warning]);
    return;
  }

  // A lista vem do rastreador, não de BODIES: o que o jogador desligou no
  // menu some daqui também, e um sistema desbloqueado depois entra sozinho.
  let tracked;
  try { tracked = trackedBodies(player); } catch { tracked = []; }
  if (!tracked.length) {
    write(player, channel, [t(player, "hud.nada_ligado")]);
    return;
  }

  const entries = tracked.map((body) => {
    const dist = chebyshevTo(player.location, body);
    return { body, dist, surface: Math.max(0, dist - body.radius) };
  }).sort((a, b) => a.dist - b.dist);

  // Encostando em algum corpo: a dica do que ele faz vale mais que a bússola.
  const touching = entries[0];
  if (touching && touching.dist <= touching.body.radius + PORTAL_MARGIN + 6) {
    const hint = compassHintFor(touching.body, player);
    if (hint) {
      write(player, channel, [hint]);
      return;
    }
  }

  const lines = entries.map(
    (e) => `${marker(bearingDelta(player, e.body))} `
           + `${nome(player, e.body.id, e.body.name)} §f${Math.round(e.surface)}m`
  );
  write(player, channel, lines);
}

/**
 * Escreve no canal pedido, com a barra de ação como reserva.
 *
 * O placar lateral é do mundo inteiro, então com mais de um jogador no espaço
 * ele mostraria as distâncias de um só. Nesse caso o rastreador cai pra barra
 * de ação sozinho, sem o jogador precisar mexer em nada.
 */
function write(player, channel, lines) {
  if (channel === "sidebar" && soloInSpace(player)) {
    if (renderSidebar(lines)) return;
  }
  try {
    player.onScreenDisplay.setActionBar(lines.join(" §8· "));
  } catch { }
}

function soloInSpace(player) {
  try {
    return player.dimension.getPlayers().length <= 1;
  } catch {
    return true;
  }
}

/**
 * A dica que a bússola dá quando o corpo está ao alcance. Exportada pros
 * testes: ela decidia por um `kind` de portal que deixou de existir quando a
 * Lua e Marte viraram dimensões nossas, e nada denunciava — a bússola só
 * ficava calada na hora de pousar.
 */
export function compassHintFor(body, player) {
  // O corpo do rastreador é uma vista simplificada; o portal está no BODIES.
  const full = BODIES.find((b) => b.id === body.id);
  // O Sol tem aviso próprio, vindo do campo de calor — não sobrescreve aqui.
  if (!full?.portal) return null;
  body = full;
  const corpo = nome(player, body.id, body.name);
  if (body.portal.kind === "overworld") return t(player, "portal.overworld", { corpo });
  if (body.portal.kind === "planet") return t(player, "portal.planeta", { corpo });
  return null;
}
