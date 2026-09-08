/* =========================================================================
 * Dimensão do Espaço — ponto de entrada.
 *
 * Liga o gerador dos corpos celestes e roda um loop por tick que cuida dos
 * jogadores: quem está no Overworld é observado pra ver se chegou na altitude
 * de saída; quem está no espaço recebe gravidade zero, respiração, estrelas e
 * a checagem dos portais.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import { createTerrainGenerator } from "./world_generator_API.js";
import {
  DIMENSION_ID,
  GEN_RADIUS_CHUNKS,
  CHUNKS_PER_TICK,
  DIM_MIN_Y,
  DIM_MAX_Y,
  SPACE_ENTRY_Y,
} from "./config.js";
import { generateColumn, getHeight, isBudgetError } from "./bodies.js";
import {
  checkSpaceEntry,
  checkBodyPortals,
  isTravelling,
  inSpace,
} from "./travel.js";
import { applyZeroGravity, releaseZeroGravity, forgetPlayer as forgetPhysics } from "./physics.js";
import { applyLifeSupport, canBreathe } from "./lifeSupport.js";
import { applySunHeat, applySunPressure } from "./hazards.js";
import { forgetPlayer as forgetVehicle } from "./vehicle.js";
import { applyEntityGravity } from "./gravity.js";
import { sustainInSpacecraftWorlds } from "./gear.js";
import { guardSpawnTick } from "./spawnGuard.js";
import { maybeDropWreck } from "./wreck.js";
import { updateSky, clearModels, sweepOrphans } from "./skybox.js";
// Só de importar já liga o item do rastreador e os mapas estelares.
import "./starCharts.js";
import { openTracker } from "./trackerUI.js";
import {
  spawnAmbience,
  pushFog,
  popFog,
  showCompass,
  forgetPlayer as forgetAmbience,
} from "./ambience.js";

const world = mc.world;
const system = mc.system;

// ---------------------------------------------------------------------------
// Erros: um aviso por mensagem distinta a cada 10 s. O loop do gerador roda
// todo tick, então sem isso um único problema recorrente enche o console.
// ---------------------------------------------------------------------------
const lastWarn = new Map();
function onError(context, err) {
  // Orçamento do tick esgotado é fluxo normal, não falha: a coluna volta no
  // próximo tick. Sai antes de montar qualquer string — perto do Sol isso
  // acontece com mais de cem colunas por tick, e cada uma traz uma chave
  // diferente ("generateColumn x,z"), que encheria o mapa de throttle.
  if (isBudgetError(err)) return;

  const key = context + "|" + err;
  const now = system.currentTick;
  const prev = lastWarn.get(key);
  if (prev !== undefined && now - prev < 200) return;
  lastWarn.set(key, now);
  console.warn("[space_dim] " + context + ": " + err);
}

// ---------------------------------------------------------------------------
// Geração
// ---------------------------------------------------------------------------
const generator = createTerrainGenerator({
  dimensionId: DIMENSION_ID,
  generateColumn,
  getHeight,
  genRadiusChunks: GEN_RADIUS_CHUNKS,
  chunksPerTick: CHUNKS_PER_TICK,
  registerDimension: true,
  heightRangeFallback: { min: DIM_MIN_Y, max: DIM_MAX_Y },
  onError,
});

generator.start();

// ---------------------------------------------------------------------------
// Loop por jogador
// ---------------------------------------------------------------------------
// Quem estava no espaço no tick anterior, pra saber quando alguém saiu e
// desfazer névoa e efeitos.
const wasInSpace = new Set();

system.runInterval(() => {
  let players;
  try { players = world.getAllPlayers(); } catch { return; }

  // Gravidade nas entidades soltas do espaço (itens largados, mobs, um OVNI
  // sem piloto): elas caem nos corpos como o jogador cai.
  const inSpacePlayers = players.filter((p) => {
    try { return p.dimension?.id === DIMENSION_ID; } catch { return false; }
  });
  if (inSpacePlayers.length) {
    try {
      applyEntityGravity(world.getDimension(DIMENSION_ID), inSpacePlayers);
    } catch (e) {
      onError("gravidade das entidades", e);
    }
    // Modelos de céu sem dono (o jogo fechou no meio de uma sessão) ficariam
    // parados no mundo pra sempre: ninguém mais vai movê-los.
    if (system.currentTick % 600 === 0) {
      try { sweepOrphans(world.getDimension(DIMENSION_ID)); }
      catch (e) { onError("varredura do céu", e); }
    }
  }

  for (const player of players) {
    try {
      const here = inSpace(player);

      if (!here) {
        if (wasInSpace.delete(player.id)) {
          popFog(player);
          releaseZeroGravity(player);
          clearModels(player.id);
        }
        // Traje reforçado nas dimensões do Spacecraft: sem isto, quem troca o
        // traje deles pelo melhorado sufoca na Lua (eles procuram as peças
        // deles pra decidir se o jogador respira).
        sustainInSpacecraftWorlds(player);

        // A porta pro espaço existe no Overworld, na Lua e em Marte —
        // checkSpaceEntry decide, e sai barato onde não existe.
        checkSpaceEntry(player);
        // Queda rara de destroços de OVNI, onde o molde é achado.
        maybeDropWreck(player);
        continue;
      }

      wasInSpace.add(player.id);
      pushFog(player);
      spawnAmbience(player);
      // Os corpos que o rastreador mostra, sempre visíveis por mais longe que
      // estejam de verdade.
      updateSky(player);
      // O renascimento nunca fica aqui: se o jogo mexeu, é devolvido.
      guardSpawnTick(player);

      // No meio de uma viagem: nada de física nem de dano até assentar.
      if (isTravelling(player)) continue;

      applyZeroGravity(player);
      const breathing = applyLifeSupport(player);
      const heatWarning = applySunHeat(player);
      const pressureWarning = applySunPressure(player);
      checkBodyPortals(player);

      // Prioridade dos avisos: pegar fogo mata mais rápido que ficar sem ar,
      // e sem ar mata mais rápido que se perder — a bússola é a última.
      // Prioridade dos avisos: a pressão esmaga mais rápido que o fogo, o fogo
      // mais rápido que a falta de ar, e a bússola é a última da fila.
      showCompass(
        player,
        pressureWarning ??
        heatWarning ??
        (breathing ? null : "§4§lSEM OXIGÊNIO §r§7— traje completo + mochila, ou entre no OVNI")
      );
    } catch (e) {
      onError("loop do jogador", e);
    }
  }
}, 1);

// ---------------------------------------------------------------------------
// Limpeza
// ---------------------------------------------------------------------------
world.afterEvents.playerDimensionChange.subscribe((event) => {
  try {
    if (event.fromDimension?.id !== DIMENSION_ID) return;
    wasInSpace.delete(event.player.id);
    popFog(event.player);
    releaseZeroGravity(event.player);
  } catch (e) {
    onError("playerDimensionChange", e);
  }
});

world.beforeEvents.playerLeave.subscribe((event) => {
  const id = event.player.id;
  wasInSpace.delete(id);
  forgetPhysics(id);
  forgetAmbience(id);
  clearModels(id);
  // Saiu no meio de uma viagem: apaga a estrutura do veículo, senão ela fica
  // guardada no mundo pra sempre.
  try { forgetVehicle(event.player); } catch { }
});

// ---------------------------------------------------------------------------
// Comandos de apoio
// ---------------------------------------------------------------------------
system.afterEvents.scriptEventReceive.subscribe((data) => {
  const player = data.sourceEntity;

  // /scriptevent space_dim:go — atalho pra chegar ao espaço sem subir voando.
  if (data.id === "space_dim:go") {
    if (player?.typeId !== "minecraft:player") return;
    try {
      player.teleport({ x: player.location.x, y: SPACE_ENTRY_Y + 2, z: player.location.z });
      player.sendMessage("§7Subindo até a altitude de saída...");
    } catch { }
    return;
  }

  // /scriptevent space_dim:tracker — abre o menu sem precisar do item.
  if (data.id === "space_dim:tracker") {
    if (player?.typeId !== "minecraft:player") return;
    system.run(() => { openTracker(player).catch(() => { }); });
    return;
  }

  // /scriptevent space_dim:info — estado da dimensão e do jogador.
  if (data.id === "space_dim:info") {
    if (player?.typeId !== "minecraft:player") return;
    let dimOk = false;
    try { dimOk = !!world.getDimension(DIMENSION_ID); } catch { }
    try {
      player.sendMessage(
        `§7dimensão: §f${dimOk ? "ok" : "§cnão registrada"}\n` +
        `§7aqui: §f${player.dimension.id}\n` +
        `§7respirando: §f${canBreathe(player) ? "sim" : "não"}\n` +
        `§7altitude de saída (Overworld): §f${SPACE_ENTRY_Y}`
      );
    } catch { }
  }
});
