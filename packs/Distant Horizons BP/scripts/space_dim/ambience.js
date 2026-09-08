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
  SUN_FOG_ID,
  SUNLIT_FOG_ID,
  FOG_LABEL,
  SPACE_ALWAYS_LIT,
  HUD_ENABLED,
  HUD_INTERVAL_TICKS,
  PORTAL_MARGIN,
} from "./config.js";
import { chebyshevTo } from "./bodies.js";
import { sunLightTier } from "./hazards.js";
import { trackedBodies } from "./tracker.js";

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
const FOG_BY_TIER = {
  blaze: SUN_FOG_ID,
  sunlit: SUNLIT_FOG_ID,
  deep: FOG_ID,
};

export function pushFog(player) {
  const wanted = FOG_BY_TIER[sunLightTier(player.location)] ?? FOG_ID;
  if (fogged.get(player.id) === wanted) return;
  fogged.set(player.id, wanted);
  try {
    player.runCommand(`fog @s remove ${FOG_LABEL}`);
    player.runCommand(`fog @s push ${wanted} ${FOG_LABEL}`);
  } catch { }
}

export function popFog(player) {
  if (!fogged.delete(player.id)) return;
  try { player.runCommand(`fog @s remove ${FOG_LABEL}`); } catch { }
}

/**
 * Mantém o jogador enxergando no espaço.
 *
 * Não existe luz de céu aqui, então sem isto o lado escuro de um planeta é
 * preto puro, e o Sol "não ilumina" nada mesmo estando ali. Bedrock não expõe
 * luz ambiente por dimensão (`minecraft:dimension` só aceita bounds, gerador e
 * bioma), e o único jeito de verdade — travar a hora do mundo — é global e
 * congelaria o dia no Overworld também.
 *
 * A duração é longa e reposta bem antes de vencer: efeito que expira dá aquele
 * pisca na tela.
 */
export function keepLit(player) {
  if (!SPACE_ALWAYS_LIT) return;
  if (system.currentTick % 100 !== 0) return;
  try {
    player.addEffect("night_vision", 30 * 20, { amplifier: 0, showParticles: false });
  } catch { }
}

export function releaseLight(player) {
  if (!SPACE_ALWAYS_LIT) return;
  try { player.removeEffect("night_vision"); } catch { }
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

export function showCompass(player, warning) {
  if (!HUD_ENABLED) return;
  if (system.currentTick % HUD_INTERVAL_TICKS !== 0) return;

  if (warning) {
    try { player.onScreenDisplay.setActionBar(warning); } catch { }
    return;
  }

  // A lista vem do rastreador, não de BODIES: o que o jogador desligou no
  // menu some daqui também, e um sistema desbloqueado depois entra sozinho.
  let tracked;
  try { tracked = trackedBodies(player); } catch { tracked = []; }
  if (!tracked.length) {
    try { player.onScreenDisplay.setActionBar("§8rastreador sem nada ligado"); } catch { }
    return;
  }

  const entries = tracked.map((body) => {
    const dist = chebyshevTo(player.location, body);
    return { body, dist, surface: Math.max(0, dist - body.radius) };
  }).sort((a, b) => a.dist - b.dist);

  // Encostando em algum corpo: a dica do que ele faz vale mais que a bússola.
  const touching = entries[0];
  if (touching && touching.dist <= touching.body.radius + PORTAL_MARGIN + 6) {
    const hint = hintFor(touching.body);
    if (hint) {
      try { player.onScreenDisplay.setActionBar(hint); } catch { }
      return;
    }
  }

  const line = entries
    .map((e) => `${marker(bearingDelta(player, e.body))} ${e.body.name} §f${Math.round(e.surface)}m`)
    .join(" §8· ");

  try { player.onScreenDisplay.setActionBar(line); } catch { }
}

function hintFor(body) {
  // O corpo do rastreador é uma vista simplificada; o portal está no BODIES.
  const full = BODIES.find((b) => b.id === body.id);
  // O Sol tem aviso próprio, vindo do campo de calor — não sobrescreve aqui.
  if (!full?.portal) return null;
  body = full;
  if (body.portal.kind === "overworld") return `${body.name} §7— encoste pra voltar ao Overworld`;
  if (body.portal.kind === "spacecraft") return `${body.name} §7— encoste pra pousar`;
  return null;
}
