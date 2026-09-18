/* =========================================================================
 * Viagens de e pra dimensão do espaço.
 *
 *   Overworld / Lua / Marte, subindo até Y 800  →  espaço
 *   entrar na Terra                             →  Overworld
 *   entrar na Lua                               →  dimensão gh:moon
 *   entrar em Marte                             →  dimensão gh:mars
 *
 * A subida vale nos três mundos que têm corpo correspondente lá em cima, e o
 * jogador chega ao lado do corpo de onde saiu. A altitude é a mesma nos três.
 *
 * Ela já foi 300 na Lua e em Marte, por um motivo que deixou de existir: o teto
 * de uma dimensão custom era 320, e 800 lá seria uma porta que nunca abre. O
 * Minecraft passou a deixar o addon escolher os limites verticais, então os
 * planetas ganharam teto de 1024 e a regra voltou a ser uma só.
 *
 * EXIT_Y_BY_DIM continua: ela responde "este mundo tem porta pro espaço?" com
 * uma busca em Map, que é o que essa pergunta pode custar rodando pra todo
 * jogador, todo tick.
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
} from "./config.js";
import { PLANET_EXIT_Y, planetOfDimension } from "./planets.js";
import { findPlanetSpot } from "./planetWorlds.js";
import { chebyshevTo } from "./bodies.js";
import { anchorAt } from "./physics.js";
import * as vehicle from "./vehicle.js";
import { rememberSpawn } from "./spawnGuard.js";
import { markArrival, inArrivalGrace, forgetArrival } from "./arrival.js";

const world = mc.world;
const system = mc.system;

// Jogadores no meio de uma viagem — trava tudo (gravidade zero, respiração,
// outro portal) até a chegada.
export const travelling = new Set();

export function isTravelling(player) {
  return travelling.has(player.id);
}

export function inSpace(player) {
  return player?.dimension?.id === DIMENSION_ID;
}

// ---------------------------------------------------------------------------
// Que mundos têm porta pro espaço, e a que altitude
//
// 800 nos três, que é a altitude em que o foguete do Spacecraft troca de
// dimensão no lançamento. O mapa guarda a altitude em vez de um simples "tem
// porta" porque ela é por dimensão no formato, mesmo estando igual nos três
// hoje: a hora que um corpo novo entrar com outra altitude, nada aqui muda.
//
// Montado uma vez, na carga. O laço por tick consulta ele pra TODO jogador,
// TODO tick, e uma busca em Map é o que isso pode custar.
// ---------------------------------------------------------------------------
const EXIT_Y_BY_DIM = new Map();
for (let i = 0; i < BODIES.length; i++) {
  const portal = BODIES[i].portal;
  if (!portal) continue;
  if (portal.kind === "overworld") EXIT_Y_BY_DIM.set("minecraft:overworld", SPACE_ENTRY_Y);
  else if (portal.kind === "planet") EXIT_Y_BY_DIM.set(portal.dimension, PLANET_EXIT_Y);
}

export function exitAltitudeOf(dimensionId) {
  return EXIT_Y_BY_DIM.get(dimensionId);
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
function travel(player, dimension, loc, onArrive, opcoes) {
  if (!player?.isValid || travelling.has(player.id)) return;
  travelling.add(player.id);

  // Viagem em que a nave NÃO vai junto (a Lua e Marte). Ela fica onde está,
  // marcada pra não sumir, e o jogador desce a pé.
  const levaVeiculo = opcoes?.levaVeiculo !== false;

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

  if (!levaVeiculo) {
    const ficou = vehicle.leaveBehind(player);
    // Um tick de folga: descer do veículo e teleportar no MESMO tick às vezes
    // leva o jogador de volta pro assento no destino.
    system.runTimeout(() => {
      if (!player?.isValid) { travelling.delete(player.id); return; }
      try {
        player.teleport({ x: loc.x, y: loc.y, z: loc.z }, { dimension });
        try { onArrive?.(player); } catch { }
      } catch (e) {
        console.warn("[gh] falha ao teleportar: " + e);
      }
      if (ficou?.isValid) {
        try {
          player.sendMessage("§7A nave ficou no espaço — ela não desce à superfície.");
        } catch { }
      }
      system.runTimeout(() => travelling.delete(player.id), 12);
    }, 6);
    return;
  }

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
      console.warn("[gh] falha ao teleportar: " + e);
      travelling.delete(player.id);
      return;
    }

    vehicle.restore(player, dimension, loc, capsule);
    // Fecha o voo do grupo depois que todo mundo já sentou; senão o próximo voo
    // daquele veículo entraria na carona de um grupo que já pousou.
    if (capsule?.primary) vehicle.endFlight(capsule);

    // Solta a trava depois de a recolocação e a remontagem terminarem. Com
    // carona é mais: o caroneiro espera o portador pôr o veículo antes de
    // sentar.
    system.runTimeout(() => travelling.delete(player.id),
                      capsule ? (capsule.primary === false ? 48 : 40) : 12);
  });
}

// ---------------------------------------------------------------------------
// Mundo de um corpo → espaço
//
// Subir até a altitude de saída leva pro espaço a partir de QUALQUER mundo que
// tenha um corpo correspondente lá em cima: o Overworld (Terra), a Lua e Marte.
// O jogador chega no espaço ao lado do corpo de onde saiu.
// ---------------------------------------------------------------------------

/** O corpo celeste cujo mundo o jogador está pisando agora, ou null. */
function bodyOfCurrentWorld(dimId) {
  if (!dimId) return null;

  for (let i = 0; i < BODIES.length; i++) {
    const body = BODIES[i];
    const portal = body.portal;
    if (!portal) continue;

    if (portal.kind === "overworld") {
      if (dimId === "minecraft:overworld") return body;
    } else if (portal.kind === "planet") {
      if (dimId === portal.dimension) return body;
    }
  }
  return null;
}

export function checkSpaceEntry(player) {
  // Checagem mais barata primeiro: isso roda pra todo jogador, todo tick, e a
  // esmagadora maioria dos jogadores está no Overworld a 70 de altura.
  const dimId = player.dimension?.id;
  const exitY = EXIT_Y_BY_DIM.get(dimId);
  if (exitY === undefined) return;          // mundo sem porta pro espaço
  if (player.location.y < exitY) return;
  if (travelling.has(player.id)) return;

  const body = bodyOfCurrentWorld(dimId);
  if (!body) return;

  // Foguete do Spacecraft em pleno lançamento: é a viagem dele, não a nossa.
  const mount = vehicle.getMount(player);
  if (mount && !vehicle.mountTravels(mount)) return;

  // Anota o ponto de renascimento antes de sair: o jogo reatribui isso ao
  // entrar numa dimensão custom, e é o que spawnGuard devolve depois.
  rememberSpawn(player);

  // Guarda de onde ele saiu, pra reentrada na Terra cair no mesmo lugar.
  if (body.portal.kind === "overworld") {
    try {
      player.setDynamicProperty("gh:return_x", Math.floor(player.location.x));
      player.setDynamicProperty("gh:return_z", Math.floor(player.location.z));
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
    x = player.getDynamicProperty("gh:return_x") ?? null;
    z = player.getDynamicProperty("gh:return_z") ?? null;
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

// ---------------------------------------------------------------------------
// Espaço → a superfície da Lua ou de Marte
//
// Aqui há um passo a mais que na volta pro Overworld: o mundo do planeta não
// existe ainda. `findPlanetSpot` gera as chunks em volta do alvo e devolve o
// topo de uma coluna de verdade — sem isso o jogador cairia dentro de um mundo
// que ainda não foi escrito, e o chão apareceria por baixo dele enquanto cai.
//
// Isso é assíncrono, e `checkBodyPortals` roda TODO tick: sem a trava abaixo,
// um jogador encostado no planeta dispararia uma busca por tick — dezenas de
// áreas de ticking e dezenas de viagens empilhadas.
// ---------------------------------------------------------------------------
const landing = new Set();

function enterPlanet(player, body, label) {
  const planet = planetOfDimension(body.portal.dimension);
  if (!planet) return;
  if (landing.has(player.id)) return;

  const dim = resolveDimension(planet.dimensionId);
  if (!dim) {
    try {
      player.sendMessage("§cNão deu pra chegar em " + label + "§c: a dimensão não abriu.");
    } catch { }
    // Sem destino, a carência evita repetir a mensagem a cada tick.
    markArrival(player);
    return;
  }

  landing.add(player.id);
  findPlanetSpot(player, planet)
    .then((spot) => {
      landing.delete(player.id);
      if (!player?.isValid) return;
      if (!spot) {
        // A busca não achou coluna pronta (orçamento de blocos do tick).
        // Tentar de novo no próximo toque é melhor que pousar no vazio.
        markArrival(player);
        return;
      }
      // A NAVE VAI JUNTO, e o jogador chega montado nela.
      //
      // Já foi o contrário: eu deixava a nave no espaço porque o corpo celeste
      // é atravessável pelo modelo e ela aparecia dentro do planeta. Mas a
      // causa não era o transporte — era a gravidade. `keepOutOfSolids`
      // teleportava o piloto pra fora do corpo sólido, e teleportar um
      // passageiro é desmontá-lo; e o puxão do corpo arrastava a nave no meio
      // da viagem. Com as duas coisas desligadas pra quem está pilotando (ver
      // applyPlayerGravity), o transporte normal funciona, e é ele que roda
      // aqui — o mesmo que já leva a nave pro Overworld.
      travel(player, dim, spot, (p) => {
        try {
          // Sem slow_falling: a gravidade do planeta já segura a descida, e ela
          // não é efeito de poção (ver planetGravity.js).
          p.onScreenDisplay.setTitle(label, {
            subtitle: "§7Superfície — sem ar, traje obrigatório",
            fadeInDuration: 10,
            stayDuration: 50,
            fadeOutDuration: 20,
          });
        } catch { }
      });
    })
    .catch((e) => {
      landing.delete(player.id);
      console.warn("[gh] falha ao procurar pouso em " + planet.id + ": " + e);
      markArrival(player);
    });
}

/** Corpo celeste em que o jogador está encostando, se houver. */
export function bodyTouchedBy(player) {
  const loc = player.location;
  for (let i = 0; i < BODIES.length; i++) {
    const body = BODIES[i];
    if (chebyshevTo(loc, body) <= body.radius + PORTAL_MARGIN) return body;
  }
  return null;
}

export function checkBodyPortals(player) {
  if (travelling.has(player.id)) return;
  if (inArrivalGrace(player)) return;

  const body = bodyTouchedBy(player);
  if (!body) return;

  // Corpo sem portal (o Sol) não teleporta ninguém: ele é atravessável, e o
  // que acontece perto dele é o campo de calor, em hazards.js.
  if (!body.portal) return;

  if (body.portal.kind === "overworld") {
    enterOverworld(player);
    return;
  }

  if (body.portal.kind === "planet") {
    enterPlanet(player, body, body.name);
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
  landing.delete(event.player.id);
  forgetArrival(event.player.id);
});
