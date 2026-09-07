/* =========================================================================
 * Viagens de e pra dimensão do espaço.
 *
 *   Overworld / Lua / Marte, subindo até Y 800  →  espaço
 *   entrar na Terra                             →  Overworld
 *   entrar na Lua                               →  Lua do Spacecraft
 *   entrar em Marte                             →  Marte do Spacecraft
 *
 * A subida a Y 800 vale nos três mundos que têm corpo correspondente lá em
 * cima, e o jogador chega ao lado do corpo de onde saiu.
 *
 * Levar o veículo junto é a parte frágil: teleportar a entidade pra outra
 * dimensão a perde. Quem cuida disso é vehicle.js, guardando o veículo numa
 * estrutura antes e recolocando depois que o jogador chegou.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import {
  DIMENSION_ID,
  BODIES,
  PORTAL_MARGIN,
  ARRIVAL_JITTER,
  SPACE_ENTRY_Y,
  OVERWORLD_REENTRY_Y,
  ARRIVAL_GRACE_TICKS,
  SPACECRAFT_LEGACY_ORIGINS,
  SPACECRAFT_LEGACY_RADIUS,
  SPACECRAFT_LANDING_Y,
  LANDING_JITTER,
} from "./config.js";
import { distanceTo } from "./bodies.js";
import { anchorAt } from "./physics.js";
import * as vehicle from "./vehicle.js";

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
 *
 * A ordem importa: o veículo é guardado numa estrutura ANTES do teleporte e
 * recolocado DEPOIS, quando a chunk do destino já está carregada. Teleportar a
 * entidade junto com o jogador é o que fazia o OVNI sumir.
 */
function travel(player, dimension, loc, onArrive) {
  if (!player?.isValid || travelling.has(player.id)) return;
  travelling.add(player.id);

  try {
    // O fade escurece em 0.2 s (4 ticks) e segura escuro por 0.6 s — cobre a
    // captura do veículo e o teleporte, que acontecem dentro dessa janela.
    player.runCommand("camera @s fade time 0.2 0.6 0.5 color 0 0 0");
  } catch { }

  // Seguro: entre desmontar e teleportar o jogador fica alguns ticks solto, e
  // a entrada no espaço acontece a Y 800. Se o teleporte falhar, ele desce
  // devagar em vez de virar cratera.
  try {
    player.addEffect("slow_falling", 8 * mc.TicksPerSecond, { amplifier: 0, showParticles: false });
  } catch { }

  // capture() desmonta, guarda e remove o veículo; devolve a cápsula (ou null
  // se não havia veículo) alguns ticks depois, com a tela já escurecida.
  vehicle.capture(player, (capsule) => {
    if (!player?.isValid) {
      travelling.delete(player.id);
      return;
    }

    try {
      player.teleport({ x: loc.x, y: loc.y, z: loc.z }, { dimension });
      try { onArrive?.(player); } catch { }
    } catch (e) {
      console.warn("[space_dim] falha ao teleportar: " + e);
      travelling.delete(player.id);
      return;
    }

    vehicle.restore(player, dimension, loc, capsule);

    // Solta a trava depois de a recolocação e a remontagem terminarem.
    system.runTimeout(() => travelling.delete(player.id), capsule ? 24 : 12);
  });
}

function markArrival(player) {
  arrivedAt.set(player.id, system.currentTick);
}

function inGrace(player) {
  const t = arrivedAt.get(player.id);
  return t !== undefined && system.currentTick - t < ARRIVAL_GRACE_TICKS;
}

// ---------------------------------------------------------------------------
// Mundo de um corpo → espaço
//
// Subir até SPACE_ENTRY_Y leva pro espaço a partir de QUALQUER mundo que tenha
// um corpo correspondente lá em cima: o Overworld (Terra), a Lua e Marte do
// Spacecraft. É a mesma altitude nos três — a mesma que o foguete do
// Spacecraft usa pra trocar de dimensão no lançamento, de onde quer que ele
// decole. E o jogador chega no espaço ao lado do corpo de onde saiu.
// ---------------------------------------------------------------------------

/** O corpo celeste cujo mundo o jogador está pisando agora, ou null. */
function bodyOfCurrentWorld(player) {
  const dimId = player.dimension?.id;
  if (!dimId) return null;

  for (let i = 0; i < BODIES.length; i++) {
    const body = BODIES[i];
    const portal = body.portal;
    if (!portal) continue;

    if (portal.kind === "overworld") {
      if (dimId === "minecraft:overworld") return body;
      continue;
    }

    if (portal.kind === "spacecraft") {
      // Mundo novo: o planeta tem dimensão própria.
      if (dimId === portal.planet) return body;

      // Mundo legado: os planetas vivem em áreas distantes do the_end. Só
      // conta se o jogador estiver dentro da área daquele planeta, senão
      // subir a 800 em qualquer canto do End viraria portal.
      if (dimId === "minecraft:the_end") {
        const o = SPACECRAFT_LEGACY_ORIGINS[portal.planet];
        if (!o) continue;
        const loc = player.location;
        if (
          Math.abs(loc.x - o.x) <= SPACECRAFT_LEGACY_RADIUS &&
          Math.abs(loc.z - o.z) <= SPACECRAFT_LEGACY_RADIUS
        ) {
          return body;
        }
      }
    }
  }
  return null;
}

export function checkSpaceEntry(player) {
  // Checagem mais barata primeiro: isso roda pra todo jogador, todo tick.
  if (player.location.y < SPACE_ENTRY_Y) return;
  if (travelling.has(player.id)) return;
  if (player.dimension?.id === DIMENSION_ID) return;

  const body = bodyOfCurrentWorld(player);
  if (!body) return;

  // Foguete do Spacecraft em pleno lançamento: é a viagem dele, não a nossa.
  const mount = vehicle.getMount(player);
  if (mount && !vehicle.mountTravels(mount)) return;

  // Guarda de onde ele saiu, pra reentrada na Terra cair no mesmo lugar.
  if (body.portal.kind === "overworld") {
    try {
      player.setDynamicProperty("space_dim:return_x", Math.floor(player.location.x));
      player.setDynamicProperty("space_dim:return_z", Math.floor(player.location.z));
    } catch { }
  }

  const dim = resolveDimension(DIMENSION_ID);
  if (!dim) {
    try {
      player.sendMessage("§cA dimensão do espaço não pôde ser aberta.");
    } catch { }
    // Sem carência, a mensagem se repetiria a cada tick lá em cima.
    markArrival(player);
    return;
  }

  const arrival = body.arrival;
  const spot = {
    x: arrival.x + Math.floor((Math.random() * 2 - 1) * ARRIVAL_JITTER),
    y: arrival.y,
    z: arrival.z + Math.floor((Math.random() * 2 - 1) * ARRIVAL_JITTER),
  };

  travel(player, dim, spot, (p) => {
    markArrival(p);
    // Ancora o controlador de gravidade zero no Y de chegada, senão o primeiro
    // tick lê o alvo antigo (lá de 800 de altura) e tenta corrigir.
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

  // Corpo sem portal (o Sol) não teleporta ninguém: ele é atravessável, e o
  // que acontece perto dele é o campo de calor, em hazards.js.
  if (!body.portal) return;

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
