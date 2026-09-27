import { CommandPermissionLevel, CustomCommandStatus, system, world } from "@minecraft/server";
import { createTerrainGenerator } from "./world_generator_API.js";
import { canGenerateChunk, ensureBaseY, generateColumn, GEN_RADIUS_CHUNKS, preloadChunks, spawnPoint } from "./rick01/overworld_copy.js";
import { startSpawner } from "./rick01/spawner.js";

export const DIMENSION_ID = "rick:01";
// marcador de chunk gerado da API (trocado do barrier para os chunks das
// versões antigas do addon serem gerados de novo)
const MARKER_BLOCK = "minecraft:structure_void";

// Erros vão só para o log de conteúdo (nada no chat); tudo que falha é tentado de novo.
function reportError(ctx, err) {
  console.warn("[rick:01] " + ctx + ": " + err);
}

// Repete uma etapa até dar certo (ex.: ticking area que falhou por falta de espaço).
async function retry(fn) {
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      reportError("tentando de novo", e);
      await system.waitTicks(20);
    }
  }
}

// A world_generator_API só cuida do terreno (copiado do overworld: mesma seed,
// mesmas coordenadas, com a construção junto). A dimensão é criada no startup abaixo.
const terrain = createTerrainGenerator({
  dimensionId: DIMENSION_ID,
  generateColumn,
  canGenerateChunk,
  markerBlockId: MARKER_BLOCK,
  registerDimension: false,
  // raio em volta do jogador (primeiro o que ele está vendo); no máximo 3
  // chunks por tick, e menos se o orçamento de tempo de overworld_copy.js acabar
  genRadiusChunks: GEN_RADIUS_CHUNKS,
  chunksPerTick: 3,
  // ticking area do tamanho mínimo que a API aceita. Fica ligada enquanto o
  // jogador está na dimensão: soltar e recriar fazia os chunks descarregarem
  // e recarregarem (geração parando e blocos sem aparecer).
  tickingRecenterMargin: 16,
  tickingRadius: 16 + (GEN_RADIUS_CHUNKS + 1) * 16,
  // nunca desiste de um chunk
  maxChunkAttempts: Infinity,
  onError: reportError,
});
terrain.start();
startSpawner((x, z) => terrain.isChunkReady(x, z));

// Gera na hora o chunk onde o jogador vai chegar, para ele não cair no vazio.
async function generateSpawnChunk(dim) {
  const hr = dim.heightRange;
  const marker = { x: 0, y: hr.min, z: 0 };
  const id = "rick01_spawn";
  await world.tickingAreaManager.createTickingArea(id, {
    dimension: dim,
    from: { x: 0, y: hr.min, z: 0 },
    to: { x: 15, y: hr.max - 1, z: 15 },
  });
  try {
    if (dim.getBlock(marker)?.typeId === MARKER_BLOCK) return;
    generateColumn(dim, 0, 0);
    dim.getBlock(marker)?.setType(MARKER_BLOCK);
  } finally {
    if (world.tickingAreaManager.hasTickingArea(id)) world.tickingAreaManager.removeTickingArea(id);
  }
}

async function goToRick(player) {
  const dim = world.getDimension(DIMENSION_ID);
  player.onScreenDisplay.setActionBar("§aAbrindo portal para rick:01...");
  await retry(() => ensureBaseY());
  await preloadChunks([[0, 0]]);
  await retry(() => generateSpawnChunk(dim));
  player.teleport(spawnPoint(), { dimension: dim });
}

system.beforeEvents.startup.subscribe((event) => {
  // Cria a dimensão rick:01 (Custom Dimension API do @minecraft/server,
  // como no exemplo oficial microsoft/minecraft-samples/custom_dimensions).
  try {
    event.dimensionRegistry.registerCustomDimension(DIMENSION_ID);
  } catch (e) {
    reportError("criação da dimensão", e);
  }

  try {
    event.customCommandRegistry.registerCommand(
      {
        name: "rick:rick01",
        description: "Teleporta para a construção na dimensão rick:01",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin) => {
        const player = origin.sourceEntity ?? origin.initiator;
        if (player?.typeId !== "minecraft:player") return { status: CustomCommandStatus.Failure, message: "Use o comando como jogador." };
        system.run(() => goToRick(player).catch((e) => reportError("/rick:rick01", e)));
        return { status: CustomCommandStatus.Success };
      },
    );
  } catch (e) {
    reportError("registro do comando /rick:rick01", e);
  }
});
