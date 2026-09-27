import { CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus, system, world } from "@minecraft/server";
import { createTerrainGenerator } from "./world_generator_API.js";
import { canGenerateChunk, generateColumn } from "./rick01/overworld_copy.js";
import { placeAll, placeAround, resumeBuild } from "./rick01/build.js";

export const DIMENSION_ID = "rick:01";
const SPAWN = { x: 0.5, y: 107, z: 0.5 };
const RETURN_PROP = "rick01:return";

// Registra a dimensão rick:01; o terreno é copiado do overworld (mesma seed, mesmas coordenadas).
const terrain = createTerrainGenerator({ dimensionId: DIMENSION_ID, generateColumn, canGenerateChunk });
terrain.start();

async function goToRick(player) {
  const dim = world.getDimension(DIMENSION_ID);
  if (player.dimension.id !== DIMENSION_ID) {
    const l = player.location;
    player.setDynamicProperty(RETURN_PROP, JSON.stringify({ dim: player.dimension.id, x: l.x, y: l.y, z: l.z }));
  }
  player.onScreenDisplay.setActionBar("§aAbrindo portal para rick:01...");
  // o pedaço da construção em volta do ponto de chegada é colocado antes do teleporte
  await placeAround(dim, SPAWN.x, SPAWN.z, 32);
  player.teleport(SPAWN, { dimension: dim });
  placeAll(dim).catch((e) => console.warn("[rick:01] " + e));
}

function goBack(player) {
  let target;
  try {
    target = JSON.parse(player.getDynamicProperty(RETURN_PROP) ?? "null");
  } catch {
    target = null;
  }
  if (target) {
    player.teleport({ x: target.x, y: target.y, z: target.z }, { dimension: world.getDimension(target.dim) });
    return;
  }
  const spawn = world.getDefaultSpawnLocation();
  player.teleport({ x: spawn.x + 0.5, y: Math.min(spawn.y, 320), z: spawn.z + 0.5 }, { dimension: world.getDimension("minecraft:overworld") });
  player.addEffect("slow_falling", 20 * 30, { showParticles: false });
}

// Jogadores alvo: os do seletor (ex.: /rick:tp01 @p num bloco de comando) ou quem digitou.
function targets(origin, selected) {
  if (selected?.length) return selected;
  const self = origin.sourceEntity ?? origin.initiator;
  return self?.typeId === "minecraft:player" ? [self] : [];
}

function register(registry, name, description, action) {
  registry.registerCommand(
    {
      name,
      description,
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: false,
      optionalParameters: [{ type: CustomCommandParamType.PlayerSelector, name: "jogador" }],
    },
    (origin, selected) => {
      const players = targets(origin, selected);
      if (!players.length) return { status: CustomCommandStatus.Failure, message: "Nenhum jogador para teleportar." };
      system.run(() => {
        for (const p of players) Promise.resolve().then(() => action(p)).catch((e) => console.warn("[rick:01] " + name + ": " + e));
      });
      return { status: CustomCommandStatus.Success };
    },
  );
}

system.beforeEvents.startup.subscribe((event) => {
  register(event.customCommandRegistry, "rick:tp01", "Teleporta para a dimensão rick:01 (0 107 0)", goToRick);
  register(event.customCommandRegistry, "rick:voltar", "Volta da dimensão rick:01 para onde você estava", goBack);
});

world.afterEvents.worldLoad.subscribe(() => {
  resumeBuild(world.getDimension(DIMENSION_ID));
});
