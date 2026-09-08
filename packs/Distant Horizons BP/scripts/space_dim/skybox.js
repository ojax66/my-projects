/* =========================================================================
 * Os corpos vistos de longe.
 *
 * Um corpo de blocos some assim que passa da distância de renderização, e no
 * espaço quase tudo está sempre além dela: o Sol fica a 500 blocos, Marte a
 * 500 do outro lado. Sem isto o jogador flutua num vazio sem referência
 * nenhuma — foi por isso que existia uma bússola de texto.
 *
 * O truque é o mesmo que o Spacecraft usa pra Terra dele: uma entidade sem
 * colisão e sem hitbox, mantida a POUCOS blocos do jogador, encolhida até dar
 * exatamente o mesmo ângulo que o corpo de verdade daria lá longe. Como ela
 * nunca está longe, nunca deixa de ser desenhada.
 *
 *     tamanho aparente = raio / distância real
 *     escala do modelo = (distância do modelo x raio) / (distância real x 8)
 *
 * (8 porque o cubo do geometry tem meia-aresta 8 na escala 1.)
 *
 * Chegando perto o modelo sai de cena e o corpo de blocos assume — senão o
 * jogador veria um cubinho pairando na frente do planeta de verdade.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import {
  DIMENSION_ID,
  SKY_MODELS_ENABLED,
  SKY_MODEL_DISTANCE,
  SKY_MODEL_HIDE_BELOW,
  SKY_MODEL_INTERVAL,
  SKY_MODEL_MIN_SCALE,
  SKY_MODEL_MAX_SCALE,
} from "./config.js";
import { trackedBodies } from "./tracker.js";
import { chebyshevTo } from "./bodies.js";

const world = mc.world;
const system = mc.system;

const SKY_PREFIX = "space_dim:sky_";
const SIZE_PROPERTY = "space_dim:size";

// playerId → (bodyId → entidade)
const models = new Map();

/** É um modelo de céu? Usado aqui e pela gravidade, que não deve puxá-los. */
export function isSkyModel(entity) {
  return typeof entity?.typeId === "string" && entity.typeId.startsWith(SKY_PREFIX);
}

function dropModel(entity) {
  try { if (entity?.isValid) entity.remove(); } catch { }
}

/** Tira todos os modelos de um jogador. */
export function clearModels(playerId) {
  const mine = models.get(playerId);
  if (!mine) return;
  for (const entity of mine.values()) dropModel(entity);
  models.delete(playerId);
}

/**
 * Modelos órfãos: se o jogo fechou no meio de uma sessão, os modelos daquela
 * sessão ficaram no mundo sem dono. Ninguém mais vai movê-los, então saem.
 */
export function sweepOrphans(dimension) {
  let known = null;
  try {
    known = new Set();
    for (const mine of models.values()) {
      for (const entity of mine.values()) known.add(entity.id);
    }
    for (const entity of dimension.getEntities({ families: ["space_dim_sky"] })) {
      if (!known.has(entity.id)) dropModel(entity);
    }
  } catch { }
}

function ensureModel(player, body) {
  let mine = models.get(player.id);
  if (!mine) models.set(player.id, (mine = new Map()));

  let entity = mine.get(body.id);
  if (entity?.isValid) return entity;

  try {
    entity = player.dimension.spawnEntity(SKY_PREFIX + body.id, player.location);
  } catch {
    return null;
  }
  mine.set(body.id, entity);
  return entity;
}

function hideModel(player, bodyId) {
  const mine = models.get(player.id);
  if (!mine) return;
  const entity = mine.get(bodyId);
  if (!entity) return;
  dropModel(entity);
  mine.delete(bodyId);
}

export function updateSky(player) {
  if (!SKY_MODELS_ENABLED) return;
  if (system.currentTick % SKY_MODEL_INTERVAL !== 0) return;

  let wanted;
  try { wanted = trackedBodies(player); } catch { return; }

  const shown = new Set();
  const eye = player.location;

  for (const body of wanted) {
    const dx = body.center.x - eye.x;
    const dy = body.center.y - eye.y;
    const dz = body.center.z - eye.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Distância até a CASCA, não até o centro: é a casca que o jogador vê, e
    // é ela que o gerador constrói. Medir do centro fazia o Sol (raio 100) e a
    // Lua (raio 12) trocarem de modelo pra bloco em momentos completamente
    // diferentes — ver SKY_MODEL_HIDE_BELOW no config.
    const gap = chebyshevTo(eye, body) - body.radius;

    // Perto o bastante pra os blocos estarem construídos: eles é que mandam.
    if (gap <= SKY_MODEL_HIDE_BELOW || d < 0.001) {
      hideModel(player, body.id);
      continue;
    }

    const entity = ensureModel(player, body);
    if (!entity) continue;
    shown.add(body.id);

    const k = SKY_MODEL_DISTANCE / d;
    try {
      entity.teleport({ x: eye.x + dx * k, y: eye.y + dy * k, z: eye.z + dz * k });
    } catch {
      hideModel(player, body.id);
      continue;
    }

    const scale = Math.min(
      SKY_MODEL_MAX_SCALE,
      Math.max(SKY_MODEL_MIN_SCALE, (SKY_MODEL_DISTANCE * body.radius) / (d * 8))
    );
    try { entity.setProperty(SIZE_PROPERTY, scale); } catch { }
  }

  // Corpo que saiu do rastreador (desligado no menu) perde o modelo.
  const mine = models.get(player.id);
  if (mine) {
    for (const bodyId of [...mine.keys()]) {
      if (!shown.has(bodyId)) hideModel(player, bodyId);
    }
  }
}

world.beforeEvents.playerLeave.subscribe((event) => {
  clearModels(event.player.id);
});

world.afterEvents.playerDimensionChange.subscribe((event) => {
  if (event.fromDimension?.id === DIMENSION_ID) clearModels(event.player.id);
});
