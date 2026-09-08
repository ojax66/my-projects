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
 *
 * E aí vem a parte que o OVNI do Vehicles impõe. O `minecraft:entity_spawned`
 * dele (entities/ufo.json) tem duas regras que disparam quando o jogador mais
 * próximo está a MAIS de 6 blocos:
 *
 *   1. `tp @s ~ ~19 ~` — o OVNI se joga 19 blocos pra cima;
 *   2. adiciona um timer de 0,1 s que aplica `minecraft:instant_despawn`.
 *
 * A regra 2 só vale sem a tag `dlb_van_ufo_captured`, que a gente põe. A regra
 * 1 dispara de qualquer jeito: o teste de tag dela compara com o literal
 * "add dlb_van_ufo_captured", que entidade nenhuma tem — então a condição é
 * sempre verdadeira. Ou seja: não existe tag que proteja o OVNI de ser
 * arremessado 19 blocos se ele estiver longe do jogador na hora em que nasce.
 *
 * Daí as duas regras aqui:
 *
 *   - o jogador nunca se separa do veículo. Descer o OVNI de Y 800 pro teto do
 *     mundo e deixar o jogador lá em cima abria 480 blocos de distância; agora
 *     os dois descem juntos, com a tela já escura.
 *   - a captura lê a posição do veículo NA HORA de salvar e salva uma caixa
 *     3x3x3 em volta dele, não um ponto anotado ticks antes. Ponto fixo erra
 *     se a entidade se mexeu um bloco que seja — e a estrutura sai vazia sem
 *     erro nenhum, que é o jeito mais silencioso de perder o OVNI.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import { MOUNT_BLOCKLIST_MATCHES, VEHICLE_KEEP_ALIVE_TAGS } from "./config.js";

const world = mc.world;
const system = mc.system;

// Ticks entre o começo da viagem e a cápsula ficar pronta. Precisa ser >= 2
// pro teleporte do veículo pra um Y válido propagar antes do salvamento, e o
// fade de tela de quem chama é dimensionado por este número.
const CAPTURE_TICKS = 4;

// Ticks entre salvar a estrutura e apagar a entidade original. O Spacecraft usa
// 5 no mesmo lugar (launch.js / racoTriggers.js) e é a ordem que funciona no
// jogo dele: apagar no mesmo tick do createFromWorld arrisca a estrutura sair
// sem a entidade.
const REMOVE_TICKS = 5;

// Meia-aresta da caixa salva, em blocos. 1 = caixa 3x3x3 em volta do veículo.
const SAVE_HALF = 1;

// Folga até o teto da dimensão. O OVNI tem collision_box de 3 de altura, e o
// Spacecraft desce os passageiros dele pra `max - 30` pelo mesmo motivo.
const CEILING_MARGIN = 30;

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
    system.runTimeout(() => onReady(null), CAPTURE_TICKS + REMOVE_TICKS);
    return;
  }

  const typeId = mount.typeId;
  const name = structureNameFor(player);
  const dim = mount.dimension;

  ejectFrom(mount, player);
  keepAlive(mount);

  // Y válido pra dimensão: a Y 800 (entrada no espaço) o salvamento falharia,
  // porque está acima do teto do mundo.
  let safeY;
  try {
    const hr = dim.heightRange;
    safeY = Math.min(
      Math.max(Math.floor(mount.location.y), hr.min + 2),
      hr.max - CEILING_MARGIN
    );
  } catch {
    system.runTimeout(() => onReady(null), CAPTURE_TICKS + REMOVE_TICKS);
    return;
  }

  if (safeY !== Math.floor(mount.location.y)) {
    const x = mount.location.x;
    const z = mount.location.z;
    try { mount.teleport({ x, y: safeY, z }); } catch { }
    // O jogador desce junto. Deixá-lo a Y 800 abriria centenas de blocos de
    // distância, e é exatamente essa distância que faz o OVNI se arremessar
    // 19 blocos pra cima e ligar o timer de despawn (ver o cabeçalho).
    try { player.teleport({ x, y: safeY + 1, z }); } catch { }
  }

  // Alguns ticks pro teleporte propagar antes de a estrutura capturar a
  // entidade na caixa — sem isso ela ainda está na posição antiga e não entra.
  system.runTimeout(() => {
    if (!mount?.isValid) {
      onReady(null);
      return;
    }

    // Posição de AGORA, não a de quando a viagem começou: entre um tick e
    // outro a entidade pode ter andado, e uma caixa no lugar errado salva
    // vazio sem erro nenhum.
    let from;
    let to;
    try {
      const hr = dim.heightRange;
      const l = mount.location;
      const cy = Math.floor(l.y);
      from = {
        x: Math.floor(l.x) - SAVE_HALF,
        y: Math.max(hr.min, cy - SAVE_HALF),
        z: Math.floor(l.z) - SAVE_HALF,
      };
      to = {
        x: Math.floor(l.x) + SAVE_HALF,
        y: Math.min(hr.max, cy + SAVE_HALF),
        z: Math.floor(l.z) + SAVE_HALF,
      };
    } catch {
      onReady(null);
      return;
    }

    dropStructure(name);
    let saved = false;
    try {
      world.structureManager.createFromWorld(name, dim, from, to, {
        includeBlocks: false,
        includeEntities: true,
        saveMode: "World",
      });
      saved = true;
    } catch (e) {
      console.warn("[space_dim] não deu pra salvar o veículo: " + e);
    }

    // Apaga a original só alguns ticks depois do salvamento, que é a ordem
    // que funciona no Spacecraft. Só então a viagem continua.
    system.runTimeout(() => {
      try { mount.remove(); } catch { }
      onReady(saved ? { name, typeId } : { name: null, typeId });
    }, REMOVE_TICKS);
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

    // Onde o jogador está AGORA, não onde ele foi teleportado. Na gravidade
    // zero ele chega com inércia, e nos ticks até aqui já andou — colocar o
    // OVNI no ponto antigo é o que abre os 6 blocos que fazem o addon deles
    // arremessá-lo pra cima assim que ele nasce.
    let here = loc;
    try {
      if (player.dimension?.id === dimension.id) here = player.location;
    } catch { }

    let vehicle = null;

    if (capsule.name) {
      try {
        world.structureManager.place(capsule.name, dimension, {
          x: Math.floor(here.x) - SAVE_HALF,
          y: Math.floor(here.y) - SAVE_HALF,
          z: Math.floor(here.z) - SAVE_HALF,
        });
      } catch (e) {
        console.warn("[space_dim] não deu pra recolocar o veículo: " + e);
      }
      dropStructure(capsule.name);

      try {
        vehicle = dimension.getEntities({
          type: capsule.typeId,
          location: here,
          // 24 e não 12: se o OVNI já tiver levado o empurrão de 19 blocos
          // pra cima, ele ainda é achado — e reaproveitado em vez de virar um
          // segundo OVNI abandonado por perto.
          maxDistance: 24,
          closest: 1,
        })[0] ?? null;
      } catch { }
    }

    // Rede de segurança: sem a estrutura, ao menos devolve um veículo do tipo
    // certo — ninguém fica a pé no vácuo por causa de um erro de estrutura.
    if (!vehicle) {
      try {
        vehicle = dimension.spawnEntity(capsule.typeId, here);
      } catch (e) {
        console.warn("[space_dim] não deu pra recriar o veículo: " + e);
        try {
          player.sendMessage("§cO veículo não pôde ser trazido — /scriptevent space_dim:info");
        } catch { }
        return;
      }
      console.warn("[space_dim] veículo recriado do zero: a estrutura veio vazia");
    }

    keepAlive(vehicle);
    // Puxa pra junto do jogador se o addon dele já tiver arremessado a
    // entidade pra cima no tick em que ela nasceu.
    try {
      const d = Math.hypot(
        vehicle.location.x - here.x,
        vehicle.location.y - here.y,
        vehicle.location.z - here.z
      );
      if (d > 4) vehicle.teleport({ x: here.x, y: here.y, z: here.z });
    } catch { }

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
