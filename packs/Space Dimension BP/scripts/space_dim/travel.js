/* =========================================================================
 * Viagens de e pra dimensão do espaço.
 *
 *   Overworld, subindo até Y 800  →  espaço  (com a montaria junto)
 *   entrar na Terra               →  Overworld
 *   entrar na Lua                 →  Lua do Spacecraft
 *   entrar em Marte               →  Marte do Spacecraft
 *
 * Trocar de dimensão com um jogador montado é a parte frágil disso tudo: o
 * Bedrock desmonta na troca e o cliente às vezes desenha a montaria parada no
 * ponto antigo. O caminho aqui é sempre o mesmo — desmonta de propósito,
 * teleporta os dois separados, remonta alguns ticks depois, quando a dimensão
 * já assentou.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import {
  DIMENSION_ID,
  BODIES,
  PORTAL_MARGIN,
  SPACE_ARRIVAL,
  ARRIVAL_JITTER,
  SPACE_ENTRY_Y,
  OVERWORLD_REENTRY_Y,
  ARRIVAL_GRACE_TICKS,
  MOUNT_BLOCKLIST_MATCHES,
  SPACECRAFT_LEGACY_ORIGINS,
  SPACECRAFT_LANDING_Y,
  LANDING_JITTER,
  SUN_BURNS,
  SUN_BURN_MARGIN,
} from "./config.js";
import { distanceTo } from "./bodies.js";
import { anchorAt } from "./physics.js";

const world = mc.world;
const system = mc.system;

// Jogadores no meio de uma viagem — trava tudo (gravidade zero, respiração,
// outro portal) até a chegada.
export const travelling = new Set();

// Tick em que cada jogador chegou ao espaço, pra carência do portal.
const arrivedAt = new Map();

export function isTravelling(player) {
  return travelling.has(player.id);
}

export function inSpace(player) {
  return player?.dimension?.id === DIMENSION_ID;
}

// ---------------------------------------------------------------------------
// Montarias
// ---------------------------------------------------------------------------

function getMount(player) {
  try {
    return player.getComponent("riding")?.entityRidingOn;
  } catch {
    return undefined;
  }
}

// O OVNI vai junto; o foguete do Spacecraft não — ele tem coreografia própria
// de lançamento e pouso, e interromper no meio quebra a viagem dele.
function mountTravels(mount) {
  if (!mount) return false;
  const id = mount.typeId ?? "";
  for (const frag of MOUNT_BLOCKLIST_MATCHES) {
    if (id.includes(frag)) return false;
  }
  return true;
}

function ejectFrom(mount, player) {
  try {
    mount?.getComponent("rideable")?.ejectRider?.(player);
  } catch { }
}

function remount(mount, player) {
  try {
    if (!mount?.isValid || !player?.isValid) return false;
    return mount.getComponent("rideable")?.addRider?.(player) ?? false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Destino da Lua e de Marte no Spacecraft
//
// O Spacecraft manda cada planeta pra uma dimensão custom (`nv_sc:moon`) em
// mundos novos, ou pro the_end em coordenadas distantes em mundos criados
// antes da v2. A escolha dele está em planetDimensions.js; aqui a gente lê as
// mesmas properties e, na dúvida, cai no mesmo default que ele usa ("new").
// ---------------------------------------------------------------------------
function spacecraftTarget(planetId) {
  let legacy = false;
  try {
    const enabled = world.getDynamicProperty("nv_sg:custom_dims_enabled") !== false;
    const kind = world.getDynamicProperty("nv_sg:world_kind");
    legacy = !enabled || kind === "legacy";
  } catch { }

  const jitter = () => Math.floor((Math.random() * 2 - 1) * LANDING_JITTER);

  if (legacy) {
    const o = SPACECRAFT_LEGACY_ORIGINS[planetId];
    if (!o) return null;
    return {
      dimensionId: "minecraft:the_end",
      loc: { x: o.x + jitter(), y: SPACECRAFT_LANDING_Y, z: o.z + jitter() },
    };
  }

  return {
    dimensionId: planetId,
    loc: { x: jitter(), y: SPACECRAFT_LANDING_Y, z: jitter() },
  };
}

function resolveDimension(dimensionId) {
  try {
    return world.getDimension(dimensionId);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Teleporte
// ---------------------------------------------------------------------------

/**
 * Leva o jogador (e a montaria, quando ela viaja) pra outra dimensão.
 * `onArrive(player)` roda depois do teleporte, já na dimensão nova.
 */
function travel(player, dimension, loc, onArrive) {
  if (!player?.isValid || travelling.has(player.id)) return;
  travelling.add(player.id);

  const mount = getMount(player);
  const carry = mountTravels(mount) ? mount : null;

  try {
    player.runCommand("camera @s fade time 0.35 0.5 0.6 color 0 0 0");
  } catch { }

  system.runTimeout(() => {
    if (!player?.isValid) {
      travelling.delete(player.id);
      return;
    }

    try {
      // Desmonta antes de trocar de dimensão: montado, o cliente costuma
      // renderizar a montaria presa na posição antiga.
      if (carry?.isValid) ejectFrom(carry, player);

      if (carry?.isValid) {
        carry.teleport({ x: loc.x, y: loc.y, z: loc.z }, { dimension });
      }
      player.teleport({ x: loc.x, y: loc.y, z: loc.z }, { dimension });

      try { onArrive?.(player); } catch { }
    } catch (e) {
      console.warn("[space_dim] falha ao teleportar: " + e);
    }

    // Remonta só depois da dimensão assentar. Duas tentativas: a primeira
    // costuma pegar, a segunda cobre o caso de o cliente ainda estar trocando.
    if (carry) {
      system.runTimeout(() => {
        if (!remount(carry, player)) {
          system.runTimeout(() => remount(carry, player), 6);
        }
      }, 6);
    }

    system.runTimeout(() => travelling.delete(player.id), 12);
  }, 8);
}

function markArrival(player) {
  arrivedAt.set(player.id, system.currentTick);
}

function inGrace(player) {
  const t = arrivedAt.get(player.id);
  return t !== undefined && system.currentTick - t < ARRIVAL_GRACE_TICKS;
}

// ---------------------------------------------------------------------------
// Overworld → espaço
// ---------------------------------------------------------------------------

export function checkSpaceEntry(player) {
  if (player.dimension.id !== "minecraft:overworld") return;
  if (player.location.y < SPACE_ENTRY_Y) return;
  if (travelling.has(player.id)) return;

  // Foguete do Spacecraft em pleno lançamento: é a viagem dele, não a nossa.
  const mount = getMount(player);
  if (mount && !mountTravels(mount)) return;

  // Guarda de onde ele saiu, pra reentrada cair no mesmo lugar.
  try {
    player.setDynamicProperty("space_dim:return_x", Math.floor(player.location.x));
    player.setDynamicProperty("space_dim:return_z", Math.floor(player.location.z));
  } catch { }

  const dim = resolveDimension(DIMENSION_ID);
  if (!dim) {
    try {
      player.sendMessage("§cA dimensão do espaço não pôde ser aberta.");
    } catch { }
    return;
  }

  const spot = {
    x: SPACE_ARRIVAL.x + Math.floor((Math.random() * 2 - 1) * ARRIVAL_JITTER),
    y: SPACE_ARRIVAL.y,
    z: SPACE_ARRIVAL.z + Math.floor((Math.random() * 2 - 1) * ARRIVAL_JITTER),
  };

  travel(player, dim, spot, (p) => {
    markArrival(p);
    // Ancora o controlador de gravidade zero no Y de chegada, senão o primeiro
    // tick lê o alvo antigo (lá do Overworld, a 800 de altura) e corrige.
    anchorAt(p, spot.y);
    try {
      p.onScreenDisplay.setTitle("§f§lESPAÇO SIDERAL", {
        subtitle: "§7Sem gravidade — pule pra subir, agache pra descer",
        fadeInDuration: 10,
        stayDuration: 60,
        fadeOutDuration: 20,
      });
      p.playSound("beacon.activate", { volume: 0.6, pitch: 0.7 });
    } catch { }
  });
}

// ---------------------------------------------------------------------------
// Espaço → corpos celestes
// ---------------------------------------------------------------------------

function enterOverworld(player) {
  const dim = resolveDimension("minecraft:overworld");
  if (!dim) return;

  let x = 0;
  let z = 0;
  try {
    x = player.getDynamicProperty("space_dim:return_x") ?? null;
    z = player.getDynamicProperty("space_dim:return_z") ?? null;
    if (x === null || z === null) {
      const spawn = player.getSpawnPoint?.() ?? world.getDefaultSpawnLocation?.();
      x = Math.floor(spawn?.x ?? 0);
      z = Math.floor(spawn?.z ?? 0);
    }
  } catch {
    x = 0;
    z = 0;
  }

  const maxY = dim.heightRange?.max ?? 320;
  const y = Math.min(OVERWORLD_REENTRY_Y, maxY - 4);

  travel(player, dim, { x, y, z }, (p) => {
    try {
      // Reentrada: desce devagar em vez de virar cratera.
      p.addEffect("slow_falling", 60 * mc.TicksPerSecond, { amplifier: 0, showParticles: false });
      p.onScreenDisplay.setTitle("§a§lTERRA", {
        subtitle: "§7Reentrada na atmosfera",
        fadeInDuration: 10,
        stayDuration: 50,
        fadeOutDuration: 20,
      });
    } catch { }
  });
}

function enterSpacecraftPlanet(player, planetId, label) {
  const target = spacecraftTarget(planetId);
  if (!target) return;

  const dim = resolveDimension(target.dimensionId);
  if (!dim) {
    try {
      player.sendMessage(
        "§cNão deu pra chegar em " + label + "§c: o addon Spacecraft não está ativo neste mundo."
      );
    } catch { }
    // Sem destino, a carência evita ficar repetindo a mensagem a cada tick.
    markArrival(player);
    return;
  }

  travel(player, dim, target.loc, (p) => {
    try {
      // Compatibilidade com o Spacecraft: é por esta property que o addon
      // sabe em que planeta o jogador está fora da detecção por posição.
      p.setDynamicProperty("nv:is_in_planet", planetId);
    } catch { }
    try {
      // Descida suave até a superfície, que o gerador do Spacecraft constrói
      // embaixo do jogador conforme ele cai. `cant_hurt` é a tag que o próprio
      // addon usa pra suspender o dano de oxigênio durante o pouso; ela se
      // remove sozinha lá quando o jogador toca o chão, e aqui também.
      p.addEffect("slow_falling", 30 * mc.TicksPerSecond, { amplifier: 0, showParticles: false });
      p.addTag("nv_sc:cant_hurt");
      system.runTimeout(() => {
        try { p.removeTag("nv_sc:cant_hurt"); } catch { }
      }, 8 * mc.TicksPerSecond);

      p.onScreenDisplay.setTitle(label, {
        subtitle: "§7Entrando na atmosfera",
        fadeInDuration: 10,
        stayDuration: 50,
        fadeOutDuration: 20,
      });
    } catch { }
  });
}

/** Corpo celeste em que o jogador está encostando, se houver. */
export function bodyTouchedBy(player) {
  const loc = player.location;
  for (let i = 0; i < BODIES.length; i++) {
    const body = BODIES[i];
    if (distanceTo(loc, body) <= body.radius + PORTAL_MARGIN) return body;
  }
  return null;
}

export function checkBodyPortals(player) {
  if (travelling.has(player.id)) return;
  if (inGrace(player)) return;

  const body = bodyTouchedBy(player);
  if (!body) return;

  if (!body.portal) {
    // O Sol é só cenário — a não ser que o queimar esteja ligado no config.
    if (SUN_BURNS && body.id === "sun") {
      if (distanceTo(player.location, body) <= body.radius + SUN_BURN_MARGIN) {
        try { player.setOnFire(4, true); } catch { }
      }
    }
    return;
  }

  if (body.portal.kind === "overworld") {
    enterOverworld(player);
    return;
  }

  if (body.portal.kind === "spacecraft") {
    enterSpacecraftPlanet(player, body.portal.planet, body.name);
  }
}

// ---------------------------------------------------------------------------
// Limpeza
// ---------------------------------------------------------------------------

world.afterEvents.playerDimensionChange.subscribe((event) => {
  // Chegou no espaço por qualquer outro caminho (comando, outro addon): dá a
  // mesma carência, senão um portal pode disparar no tick da chegada.
  if (event.toDimension?.id === DIMENSION_ID) markArrival(event.player);
});

world.beforeEvents.playerLeave.subscribe((event) => {
  travelling.delete(event.player.id);
  arrivedAt.delete(event.player.id);
});
