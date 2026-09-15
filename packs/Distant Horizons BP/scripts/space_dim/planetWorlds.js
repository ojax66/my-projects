/* =========================================================================
 * A vida nas dimensões de superfície: gerador, ar, gravidade e bioma.
 *
 * Cada planeta tem o seu gerador de terreno (planetTerrain.js) rodando pelo
 * mesmo world_generator_API que o espaço usa, e um laço por jogador que cuida
 * do que muda quando se está pisando lá:
 *
 *   - a NÉVOA do bioma onde ele está;
 *   - o NOME do bioma, quando ele muda — é assim que os biomas aparecem pro
 *     jogador, já que o Bedrock não mostra bioma de dimensão custom em canto
 *     nenhum;
 *   - o AR: vácuo nos dois, mesma regra do espaço;
 *   - a GRAVIDADE baixa, que o motor não deixa mudar de verdade — o que dá pra
 *     fazer é o efeito dela.
 *
 * E guarda onde o jogador estava: voltar pro planeta devolve ele ao lugar de
 * onde saiu, não a um (0,0) que ele nunca viu.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import { createTerrainGenerator } from "./world_generator_API.js";
import {
  PLANETS,
  PLANET_VACUUM,
  PLANET_LOW_GRAVITY,
  PLANET_EFFECT_INTERVAL,
  PLANET_EFFECT_SECONDS,
  PLANET_LANDING_JITTER,
  PLANET_SPOT_SEARCH_CHUNKS,
  PLANET_BOUNDS,
  planetOfDimension,
} from "./planets.js";
import { GEN_RADIUS_CHUNKS, CHUNKS_PER_TICK } from "./config.js";
import { makePlanetGenerator, terrainAt, heightAt } from "./planetTerrain.js";
import { isBudgetError } from "./budget.js";
import { applyLifeSupport } from "./lifeSupport.js";
import { pushFog, popFog } from "./ambience.js";
import { guardSpawnTick } from "./spawnGuard.js";

const world = mc.world;
const system = mc.system;

// De quantos em quantos ticks o bioma debaixo do jogador é recalculado. Não
// precisa ser todo tick: ninguém atravessa um bioma em meio segundo, e a conta
// envolve meia dúzia de oitavas de ruído.
const BIOME_INTERVAL = 10;

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------
const lastWarn = new Map();
function onError(context, err) {
  if (isBudgetError(err)) return;   // fluxo normal: a coluna volta no próximo tick
  const key = context + "|" + err;
  const now = system.currentTick;
  const prev = lastWarn.get(key);
  if (prev !== undefined && now - prev < 200) return;
  lastWarn.set(key, now);
  console.warn("[space_dim] " + context + ": " + err);
}

// ---------------------------------------------------------------------------
// Os geradores
// ---------------------------------------------------------------------------
const generators = new Map();   // dimensionId → o que createTerrainGenerator devolve

/**
 * O gerador daquele planeta, criado na primeira vez que alguém precisa dele.
 *
 * Sob demanda, e não numa rotina de arranque, porque quem primeiro precisa dele
 * pode ser o POUSO: `findPlanetSpot` gera as chunks do destino antes de o
 * jogador chegar. Se o gerador só existisse depois de `startPlanetWorlds()`,
 * a ordem de carga dos módulos viraria uma dependência escondida — e o pouso
 * falharia calado, mandando o jogador de volta pro espaço.
 *
 * Criar é barato e não liga nada: quem assina os eventos e o laço por tick é o
 * `start()`, que só `startPlanetWorlds` chama, uma vez.
 */
function generatorFor(planet) {
  let gen = generators.get(planet.dimensionId);
  if (gen) return gen;

  const { generateColumn, getHeight } = makePlanetGenerator(planet);
  gen = createTerrainGenerator({
    dimensionId: planet.dimensionId,
    generateColumn,
    getHeight,
    genRadiusChunks: GEN_RADIUS_CHUNKS,
    chunksPerTick: CHUNKS_PER_TICK,
    registerDimension: true,
    // Os limites DO PLANETA, não os do espaço: são dimensões diferentes, e o
    // planeta tem teto e piso próprios (PLANET_BOUNDS).
    heightRangeFallback: { min: PLANET_BOUNDS.min, max: PLANET_BOUNDS.max },
    onError: (ctx, err) => onError(planet.id + "/" + ctx, err),
  });
  generators.set(planet.dimensionId, gen);
  return gen;
}

export function startPlanetWorlds() {
  for (let i = 0; i < PLANETS.length; i++) generatorFor(PLANETS[i]).start();
}

// ---------------------------------------------------------------------------
// Onde pousar
// ---------------------------------------------------------------------------
const LAST_X = (planet) => "space_dim:" + planet.id + "_x";
const LAST_Z = (planet) => "space_dim:" + planet.id + "_z";

const jitter = () => Math.floor((Math.random() * 2 - 1) * PLANET_LANDING_JITTER);

/** Onde o jogador estava da última vez neste planeta, mais um espalhamento. */
function landingTarget(player, planet) {
  let x = 0;
  let z = 0;
  try {
    x = player.getDynamicProperty(LAST_X(planet)) ?? 0;
    z = player.getDynamicProperty(LAST_Z(planet)) ?? 0;
  } catch { }
  return { x: Math.floor(x) + jitter(), z: Math.floor(z) + jitter() };
}

function rememberWhere(player, planet) {
  try {
    player.setDynamicProperty(LAST_X(planet), Math.floor(player.location.x));
    player.setDynamicProperty(LAST_Z(planet), Math.floor(player.location.z));
  } catch { }
}

/**
 * Acha uma coluna de superfície e devolve o ponto de pouso, um bloco acima
 * dela. Gera as chunks em volta antes — é o que o `findValidSpot` do
 * world_generator_API faz, e é por isso que ele existe: sem essa garantia o
 * jogador cairia num buraco de mundo ainda não escrito.
 *
 * Nunca devolve null. `findValidSpot` pode não achar nada — ele só enxerga as
 * colunas que couberam no orçamento de blocos DAQUELE tick, e se o orçamento já
 * tinha acabado ele não enxerga nenhuma. Mas a altura do terreno é uma função
 * pura de (x, z): dá pra saber onde o chão VAI estar sem escrever bloco nenhum.
 * Então o fracasso da busca não vira um pouso frustrado — vira o mesmo pouso,
 * com o chão aparecendo embaixo do jogador enquanto ele desce devagar.
 */
export async function findPlanetSpot(player, planet) {
  const gen = generatorFor(planet);
  const target = landingTarget(player, planet);

  let spot = null;
  try {
    spot = await gen.findValidSpot(
      target.x,
      target.z,
      // Qualquer coluna de superfície serve: o gerador nunca deixa buraco.
      (_x, _z, h) => h > PLANET_BOUNDS.min,
      { searchRadiusChunks: PLANET_SPOT_SEARCH_CHUNKS },
    );
  } catch (e) {
    onError("pouso em " + planet.id, e);
  }

  if (spot) return spot;
  return { x: target.x, y: heightAt(planet, target.x, target.z) + 2, z: target.z };
}

// ---------------------------------------------------------------------------
// O laço por jogador
// ---------------------------------------------------------------------------
const lastBiome = new Map();    // playerId → id do bioma
const lastEffects = new Map();  // playerId → tick da última renovação

function actionBar(player, text) {
  try { player.onScreenDisplay.setActionBar(text); } catch { }
}

function lowGravity(player, planet) {
  if (!PLANET_LOW_GRAVITY || !planet.gravity) return;
  const now = system.currentTick;
  const prev = lastEffects.get(player.id);
  if (prev !== undefined && now - prev < PLANET_EFFECT_INTERVAL) return;
  lastEffects.set(player.id, now);

  const ticks = PLANET_EFFECT_SECONDS * mc.TicksPerSecond;
  try {
    player.addEffect("jump_boost", ticks, {
      amplifier: planet.gravity.jump,
      showParticles: false,
    });
  } catch { }
  if (planet.gravity.slowFall) {
    try {
      player.addEffect("slow_falling", ticks, { amplifier: 0, showParticles: false });
    } catch { }
  }
}

/**
 * Um tick de um jogador que está pisando num planeta nosso.
 * @returns true se ele está mesmo num planeta nosso (quem chama para por aí)
 */
export function applyPlanetTick(player) {
  let planet;
  try { planet = planetOfDimension(player.dimension?.id); } catch { return false; }
  if (!planet) return false;

  // Este planeta não pode virar o ponto de renascimento dele.
  guardSpawnTick(player);

  const now = system.currentTick;
  if (now % BIOME_INTERVAL === 0) {
    rememberWhere(player, planet);
    try {
      const loc = player.location;
      const t = terrainAt(planet, Math.floor(loc.x), Math.floor(loc.z));
      pushFog(player, t.biome.fog ?? planet.fog);
      if (lastBiome.get(player.id) !== t.biome.id) {
        lastBiome.set(player.id, t.biome.id);
        actionBar(player, planet.name + " §8· §r" + t.biome.name);
      }
    } catch (e) {
      onError("bioma", e);
    }
  }

  lowGravity(player, planet);

  if (PLANET_VACUUM) {
    const breathing = applyLifeSupport(player);
    if (!breathing && now % 20 === 0) {
      actionBar(player, "§4§lSEM OXIGÊNIO §r§7— traje completo + mochila, ou entre no OVNI");
    }
  }

  return true;
}

export function forgetPlayer(playerId) {
  lastBiome.delete(playerId);
  lastEffects.delete(playerId);
}

world.beforeEvents.playerLeave.subscribe((event) => {
  forgetPlayer(event.player.id);
});

// Saiu do planeta: tira a névoa dele.
//
// Sem isto a névoa ocre de Marte ia junto pro Overworld e ficava lá — o laço
// principal só desfaz a névoa de quem sai do ESPAÇO, e a partir daqui existem
// mais duas dimensões que empilham névoa. O rótulo de névoa é um só por
// jogador, então quem entra na próxima dimensão empilha a dele por cima sem
// problema; o caso que precisava de conserto é sair pra uma dimensão que não
// empilha nada.
world.afterEvents.playerDimensionChange.subscribe((event) => {
  try {
    if (!planetOfDimension(event.fromDimension?.id)) return;
    popFog(event.player);
    // Esquece o bioma: voltar pro planeta tem que anunciar de novo onde ele
    // pisou, senão o primeiro bioma da volta passa em silêncio.
    lastBiome.delete(event.player.id);
  } catch { }
});
