/* =========================================================================
 * Levar o veículo junto na troca de dimensão.
 *
 * A primeira versão simplesmente teleportava a entidade com
 * `entity.teleport(loc, { dimension })` antes do jogador — e o OVNI sumia.
 * O motivo: no destino a chunk ainda não estava carregada (nenhum jogador
 * tinha chegado lá), e entidade teleportada pra chunk descarregada em outra
 * dimensão se perde. Teleportar depois do jogador também não salva: o
 * handle da entidade não sobrevive de forma confiável à troca.
 *
 * O caminho que funciona é o que o próprio Spacecraft usa pra levar mobs
 * dentro do foguete (launch.js / racoTriggers.js): salvar a entidade numa
 * ESTRUTURA, apagar a original, e recolocar a estrutura no destino depois
 * que o jogador chegou e a chunk está carregada. A estrutura leva a entidade
 * inteira — cor, variante, vida, nome, propriedades — não uma cópia pela
 * metade.
 *
 * Um detalhe que morde: o jogador entra no espaço a Y 800, muito acima do
 * teto do Overworld (320), e não dá pra salvar estrutura fora dos limites da
 * dimensão. Por isso o veículo desce pra um Y válido ANTES de ser salvo —
 * teleporte dentro da mesma dimensão, que é confiável.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import { MOUNT_BLOCKLIST_MATCHES, VEHICLE_KEEP_ALIVE_TAGS } from "./config.js";

const world = mc.world;
const system = mc.system;

// Ticks entre o começo da viagem e a cápsula ficar pronta. Precisa ser >= 2
// pro teleporte do veículo pra um Y válido propagar antes do salvamento, e o
// fade de tela de quem chama é dimensionado por este número.
const CAPTURE_TICKS = 4;

export function getMount(player) {
  try {
    return player.getComponent("riding")?.entityRidingOn;
  } catch {
    return undefined;
  }
}

// O OVNI vai junto; o foguete do Spacecraft não — ele tem coreografia própria
// de lançamento e pouso, e interromper no meio quebra a viagem dele.
export function mountTravels(mount) {
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

function structureNameFor(player) {
  return "space_dim:veh_" + String(player.id).replace(/[^a-zA-Z0-9]/g, "_");
}

function dropStructure(name) {
  try { world.structureManager.delete(name); } catch { }
}

/**
 * Impede o veículo de sumir enquanto ninguém está montado.
 *
 * O OVNI do Vehicles tem `minecraft:despawn` com filtro
 * "é dia E não tem a tag dlb_van_ufo_captured E o jogador mais próximo está a
 * 6+ blocos". O addon dele põe essa tag sozinho assim que alguém monta, então
 * um OVNI já pilotado não some — mas marcar de novo não custa nada e cobre
 * o caso de a entidade ter acabado de ser recriada pela estrutura.
 */
function keepAlive(entity) {
  if (!entity?.isValid) return;
  for (const tag of VEHICLE_KEEP_ALIVE_TAGS) {
    try { entity.addTag(tag); } catch { }
  }
}

/**
 * Tira o jogador do veículo, guarda o veículo numa estrutura e remove o
 * original do mundo.
 *
 * @returns {{name: string, typeId: string} | null} o que `restore` precisa,
 *          ou null se não havia veículo pra levar.
 */
export function capture(player, onReady) {
  const mount = getMount(player);
  if (!mountTravels(mount) || !mount?.isValid) {
    // Mesmo atraso do caminho com veículo: quem chama conta com um tempo fixo
    // até o teleporte pra o fade de tela cobrir a troca nos dois casos.
    system.runTimeout(() => onReady(null), CAPTURE_TICKS);
    return;
  }

  const typeId = mount.typeId;
  const name = structureNameFor(player);
  const dim = mount.dimension;

  ejectFrom(mount, player);
  keepAlive(mount);

  // Y válido pra dimensão: a Y 800 (entrada no espaço) o salvamento falharia,
  // porque está acima do teto do Overworld.
  let saveLoc;
  try {
    const hr = dim.heightRange;
    const y = Math.min(Math.max(Math.floor(mount.location.y), hr.min + 2), hr.max - 4);
    saveLoc = { x: Math.floor(mount.location.x), y, z: Math.floor(mount.location.z) };
    if (y !== Math.floor(mount.location.y)) mount.teleport(saveLoc);
  } catch {
    system.runTimeout(() => onReady(null), CAPTURE_TICKS);
    return;
  }

  // Alguns ticks pro teleporte propagar antes de a estrutura capturar a
  // entidade na caixa — sem isso ela ainda está na posição antiga e não entra.
  system.runTimeout(() => {
    if (!mount?.isValid) {
      onReady(null);
      return;
    }
    dropStructure(name);
    let saved = false;
    try {
      world.structureManager.createFromWorld(name, dim, saveLoc, saveLoc, {
        includeBlocks: false,
        includeEntities: true,
        saveMode: "World",
      });
      saved = true;
    } catch (e) {
      console.warn("[space_dim] não deu pra salvar o veículo: " + e);
    }

    try { mount.remove(); } catch { }
    onReady(saved ? { name, typeId } : { name: null, typeId });
  }, CAPTURE_TICKS);
}

/**
 * Recoloca o veículo no destino e monta o jogador de volta.
 *
 * Se a estrutura falhar, cria um veículo novo do mesmo tipo: perde a cor e a
 * vida, mas é muito melhor que deixar o jogador a pé no meio do espaço.
 */
export function restore(player, dimension, loc, capsule) {
  if (!capsule) return;

  const place = () => {
    if (!player?.isValid) return;
    let vehicle = null;

    if (capsule.name) {
      try {
        world.structureManager.place(capsule.name, dimension, {
          x: Math.floor(loc.x),
          y: Math.floor(loc.y),
          z: Math.floor(loc.z),
        });
      } catch (e) {
        console.warn("[space_dim] não deu pra recolocar o veículo: " + e);
      }
      dropStructure(capsule.name);

      try {
        vehicle = dimension.getEntities({
          type: capsule.typeId,
          location: loc,
          maxDistance: 12,
          closest: 1,
        })[0] ?? null;
      } catch { }
    }

    // Rede de segurança: sem a estrutura, ao menos devolve um veículo do tipo
    // certo — ninguém fica a pé no vácuo por causa de um erro de estrutura.
    if (!vehicle) {
      try {
        vehicle = dimension.spawnEntity(capsule.typeId, loc);
      } catch (e) {
        console.warn("[space_dim] não deu pra recriar o veículo: " + e);
        return;
      }
    }

    keepAlive(vehicle);

    // Monta depois de a entidade assentar. Duas tentativas: a primeira pega
    // quase sempre, a segunda cobre o cliente ainda trocando de dimensão.
    const mount = () => {
      try {
        if (!vehicle?.isValid || !player?.isValid) return false;
        return vehicle.getComponent("rideable")?.addRider?.(player) ?? false;
      } catch {
        return false;
      }
    };
    system.runTimeout(() => {
      if (!mount()) system.runTimeout(mount, 6);
    }, 4);
  };

  // Alguns ticks depois do teleporte do jogador: aí a chunk do destino já
  // está carregada e a estrutura tem onde ser colocada.
  system.runTimeout(place, 6);
}

/** Limpa a estrutura de um jogador que saiu no meio da viagem. */
export function forgetPlayer(player) {
  dropStructure(structureNameFor(player));
}
