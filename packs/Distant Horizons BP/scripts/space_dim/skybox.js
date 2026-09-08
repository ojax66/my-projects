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
 * São três níveis, e o meio deles é o que faltava:
 *
 *   perto           os BLOCOS. O gerador constrói dentro de GEN_RADIUS_CHUNKS
 *                   do jogador, ou seja 80 blocos. Fora disso não existe bloco
 *                   nenhum pra ver.
 *   no sistema      o MODELO do corpo, encolhido pelo tanto certo. É assim que
 *                   dá pra ver a Terra estando perto do Sol.
 *   fora do sistema uma ESTRELA: um ponto branco. Além da borda o corpo não é
 *                   mais um mundo que dá pra visitar — é o que ele parece de
 *                   longe mesmo, e é o que fecha a ideia de que cada pontinho
 *                   no espaço é uma estrela de verdade.
 *
 * Chegando perto o modelo sai de cena e os blocos assumem, senão o jogador
 * veria um cubinho pairando na frente do planeta de verdade.
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
  SOLAR_SYSTEM_RADIUS,
  STAR_ENTITY,
  STAR_SCALE,
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

function ensureModel(player, body, star) {
  let mine = models.get(player.id);
  if (!mine) models.set(player.id, (mine = new Map()));

  const wanted = star ? STAR_ENTITY : SKY_PREFIX + body.id;

  const entity = mine.get(body.id);
  // O nível mudou (o corpo virou estrela, ou deixou de ser): troca a entidade.
  if (entity?.isValid && entity.typeId === wanted) return entity;
  if (entity) dropModel(entity);

  let created;
  try {
    created = player.dimension.spawnEntity(wanted, player.location);
  } catch (e) {
    warnOnce("não deu pra criar o modelo de " + body.id, e);
    mine.delete(body.id);
    return null;
  }
  mine.set(body.id, created);
  return created;
}

// Um aviso por mensagem, não um por tick: isto roda a cada dois ticks por
// jogador e por corpo, e um erro repetido encheria o console em segundos.
const warned = new Set();
function warnOnce(context, err) {
  const key = context + "|" + err;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn("[space_dim] " + context + ": " + err);
}

/** Estado dos modelos deste jogador, pro diagnóstico. */
export function describeSky(player) {
  const mine = models.get(player.id);
  if (!mine || !mine.size) return "nenhum modelo no céu";
  const parts = [];
  for (const [bodyId, entity] of mine) {
    let size = "?";
    try { size = Number(entity.getProperty(SIZE_PROPERTY)).toFixed(3); } catch { }
    const kind = entity.typeId === STAR_ENTITY ? "estrela" : "corpo";
    parts.push(`${bodyId}: ${kind} escala ${size}${entity.isValid ? "" : " §c(inválida)"}`);
  }
  return parts.join("\n");
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

    // Uma regra só: passou do raio do sistema, é estrela.
    //
    // Vale nos dois sentidos, e é por isso que ela basta. Dentro do sistema os
    // corpos ficam todos a menos que isso e aparecem inteiros; saindo dele,
    // eles ficam pra trás e viram pontinhos, um a um, conforme a distância
    // cresce. E um corpo de OUTRO sistema estelar, a milhares de blocos, já
    // nasce como estrela — que é o que ele é, até se chegar lá.
    const star = d > SOLAR_SYSTEM_RADIUS;

    const entity = ensureModel(player, body, star);
    if (!entity) continue;
    shown.add(body.id);

    const k = SKY_MODEL_DISTANCE / d;
    try {
      entity.teleport({ x: eye.x + dx * k, y: eye.y + dy * k, z: eye.z + dz * k });
    } catch {
      hideModel(player, body.id);
      continue;
    }

    const scale = star
      ? STAR_SCALE
      : Math.min(
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
