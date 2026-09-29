import { CommandPermissionLevel, CustomCommandStatus, system, world } from "@minecraft/server";
import { createTerrainGenerator } from "./world_generator_API.js";
import { canGenerateChunk, ensureBaseY, generateColumn, GEN_RADIUS_CHUNKS, HAS_BUILD, isBudgetError, preloadChunks, spawnPoint } from "./rick01/overworld_copy.js";
import { startSpawner } from "./rick01/spawner.js";
import { DIMENSIONS, isRickDimension } from "./rick01/dimensions.js";

// marcador de chunk gerado da API (trocado do barrier para os chunks das
// versões antigas do addon serem gerados de novo)
const MARKER_BLOCK = "minecraft:structure_void";

// Erros vão só para o log de conteúdo (nada no chat); tudo que falha é tentado de novo.
function reportError(ctx, err) {
  if (isBudgetError(err)) return; // orçamento do tick acabou: normal, continua no próximo
  console.warn("[rick] " + ctx + ": " + err);
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

// Um gerador da world_generator_API por dimensão (a API só cuida do terreno:
// cópia do overworld com a construção junto). O trabalho por tick é limitado
// em overworld_copy.js, num orçamento só para todas as dimensões juntas.
const generators = new Map();
for (const d of DIMENSIONS) {
  generators.set(
    d.id,
    createTerrainGenerator({
      dimensionId: d.id,
      generateColumn,
      canGenerateChunk,
      markerBlockId: MARKER_BLOCK,
      registerDimension: false,
      // raio em volta do jogador (primeiro o que ele está vendo); um chunk que
      // não terminou continua no próximo tick de onde parou
      genRadiusChunks: GEN_RADIUS_CHUNKS,
      chunksPerTick: 4,
      // "orçamento acabou" não é erro: não é repetido no mesmo tick
      isBudgetError,
      // ticking area do tamanho mínimo que a API aceita. Fica ligada enquanto
      // o jogador está na dimensão: soltar e recriar fazia os chunks
      // descarregarem e recarregarem (geração parando e blocos sem aparecer).
      tickingRecenterMargin: 16,
      tickingRadius: 16 + (GEN_RADIUS_CHUNKS + 1) * 16,
      // nunca desiste de um chunk
      maxChunkAttempts: Infinity,
      onError: reportError,
    }),
  );
}

// Cada gerador só é ligado quando alguém entra na dimensão dele: as que
// ninguém visitou não gastam nada (nem o loop por tick da API).
const started = new Set();
function ensureStarted(dimId) {
  if (started.has(dimId) || !generators.has(dimId)) return;
  started.add(dimId);
  generators.get(dimId).start();
}

startSpawner((dimId, x, z) => generators.get(dimId)?.isChunkReady(x, z) ?? false);

// Gera na hora o chunk onde o jogador vai chegar, para ele não cair no vazio.
// Devolve o Y do chão em X 0 / Z 0 (usado quando não tem a cidade).
async function generateSpawnChunk(dim, n) {
  const hr = dim.heightRange;
  const marker = { x: 0, y: hr.min, z: 0 };
  const id = "rick_spawn_" + n;
  await world.tickingAreaManager.createTickingArea(id, {
    dimension: dim,
    from: { x: 0, y: hr.min, z: 0 },
    to: { x: 15, y: hr.max - 1, z: 15 },
  });
  try {
    if (dim.getBlock(marker)?.typeId === MARKER_BLOCK) return dim.getTopmostBlock({ x: 0, z: 0 })?.y;
    // a cópia é em fatias: vai continuando a cada tick até terminar
    for (;;) {
      try {
        generateColumn(dim, 0, 0);
        break;
      } catch (e) {
        if (!isBudgetError(e)) throw e;
        await system.waitTicks(1);
      }
    }
    dim.getBlock(marker)?.setType(MARKER_BLOCK);
    return dim.getTopmostBlock({ x: 0, z: 0 })?.y;
  } finally {
    if (world.tickingAreaManager.hasTickingArea(id)) world.tickingAreaManager.removeTickingArea(id);
  }
}

async function goTo(player, d) {
  const dim = world.getDimension(d.id);
  player.onScreenDisplay.setActionBar("§aAbrindo portal para " + d.id + "...");
  ensureStarted(d.id);
  if (HAS_BUILD) await retry(() => ensureBaseY());
  await preloadChunks([[0, 0]]);
  const ground = await retry(() => generateSpawnChunk(dim, d.n));
  if (HAS_BUILD) {
    // no meio da cidade do Rick
    player.teleport(spawnPoint(), { dimension: dim });
  } else {
    // versão só overworld: em cima do chão copiado em X 0 / Z 0
    player.teleport({ x: 0.5, y: (ground ?? 100) + 1, z: 0.5 }, { dimension: dim });
    if (ground === undefined) player.addEffect("slow_falling", 20 * 10, { showParticles: false });
  }
}

// Quem chega numa rick:NN por outro caminho (/tp, entrou no mundo já lá dentro)
// também liga o gerador daquela dimensão.
function checkPlayer(player) {
  try {
    const id = player.dimension.id;
    if (isRickDimension(id)) ensureStarted(id);
  } catch {
    // jogador saindo
  }
}
world.afterEvents.playerDimensionChange.subscribe((e) => {
  if (isRickDimension(e.toDimension.id)) ensureStarted(e.toDimension.id);
});
world.afterEvents.playerSpawn.subscribe((e) => checkPlayer(e.player));
world.afterEvents.worldLoad.subscribe(() => {
  for (const p of world.getAllPlayers()) checkPlayer(p);
});

system.beforeEvents.startup.subscribe((event) => {
  for (const d of DIMENSIONS) {
    // Cria a dimensão (Custom Dimension API do @minecraft/server, como no
    // exemplo oficial microsoft/minecraft-samples/custom_dimensions).
    try {
      event.dimensionRegistry.registerCustomDimension(d.id);
    } catch (e) {
      reportError("criação da dimensão " + d.id, e);
    }

    try {
      event.customCommandRegistry.registerCommand(
        {
          name: d.command,
          description: "Teleporta para a construção na dimensão " + d.id,
          permissionLevel: CommandPermissionLevel.Any,
          cheatsRequired: false,
        },
        (origin) => {
          const player = origin.sourceEntity ?? origin.initiator;
          if (player?.typeId !== "minecraft:player") return { status: CustomCommandStatus.Failure, message: "Use o comando como jogador." };
          system.run(() => goTo(player, d).catch((e) => reportError("/" + d.command, e)));
          return { status: CustomCommandStatus.Success };
        },
      );
    } catch (e) {
      reportError("registro do comando /" + d.command, e);
    }
  }
});
