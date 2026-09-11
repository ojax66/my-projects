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
 * São três níveis:
 *
 *   perto           os BLOCOS. O gerador constrói dentro de GEN_RADIUS_CHUNKS
 *                   do jogador, ou seja 80 blocos.
 *   no sistema      o MODELO do corpo.
 *   fora do sistema uma ESTRELA: um ponto branco.
 *
 * O modelo fica SEMPRE a poucos blocos do jogador, na direção do corpo, e é
 * escalado pra dar exatamente o mesmo ângulo que o corpo daria lá longe. Não é
 * capricho: uma entidade parada no centro real, a centenas de blocos, não é
 * renderizada — a tentativa de colocá-la lá fez os corpos sumirem de novo. Preso
 * ao jogador ele nunca sai do alcance, que é a única forma de "não parar de ser
 * renderizado" que o Bedrock oferece.
 *
 *     ângulo do corpo real  =  raio / distância
 *     ângulo do modelo      =  (meia-aresta × escala) / SKY_MODEL_DISTANCE
 *
 * O cubo do geometry tem 16 unidades de aresta, que é UM bloco: meia-aresta de
 * 0,5. Igualando os dois:
 *
 *     escala = 2 × SKY_MODEL_DISTANCE × raio / distância
 *
 * A versão anterior usava `SKY_MODEL_DISTANCE × raio / (distância × 8)`, que
 * trata a meia-aresta como 8 BLOCOS em vez de meio — dezesseis vezes menor.
 *
 * O tamanho aparente fica idêntico ao da construção, então a troca de um pelo
 * outro não muda nada na tela. O que muda é paralaxe: o modelo acompanha o
 * jogador. A troca acontece a SKY_MODEL_HIDE_BELOW da casca, bem antes de a
 * diferença ficar perceptível.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import {
  DIMENSION_ID,
  SKY_MODELS_ENABLED,
  SKY_MODEL_DISTANCE,
  SKY_MODEL_HIDE_BELOW,
  SKY_MODEL_INTERVAL,
  SOLAR_SYSTEM_RADIUS,
  STAR_ENTITY,
} from "./config.js";
import { trackedBodies } from "./tracker.js";
import { SKY_SIZE_STEPS } from "./skySteps.js";
import { chebyshevTo } from "./bodies.js";

const world = mc.world;
const system = mc.system;

const SKY_PREFIX = "space_dim:sky_";

// playerId → (bodyId → entidade)
const models = new Map();

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
  for (const bodyId of mine.keys()) appliedStep.delete(playerId + "|" + bodyId);
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
    const kind = entity.typeId === STAR_ENTITY ? "estrela" : "corpo";
    let onde = "?";
    try {
      const l = entity.location;
      onde = `${Math.round(l.x)}, ${Math.round(l.y)}, ${Math.round(l.z)}`;
    } catch { }
    parts.push(`${bodyId}: ${kind} em ${onde}${entity.isValid ? "" : " §c(inválida)"}`);
  }
  return parts.join("\n");
}

// playerId|bodyId → degrau de escala já aplicado, pra não disparar o evento a
// cada tick.
const appliedStep = new Map();

/** O degrau mais próximo da escala pedida. */
function stepFor(scale) {
  let best = 0;
  let bestErr = Infinity;
  for (let i = 0; i < SKY_SIZE_STEPS.length; i++) {
    // Erro relativo: entre 0,01 e 0,014 a diferença absoluta é minúscula, mas a
    // visual é a mesma que entre 1 e 1,4.
    const err = Math.abs(Math.log(SKY_SIZE_STEPS[i] / scale));
    if (err < bestErr) { bestErr = err; best = i; }
  }
  return best;
}

function applyScale(player, body, entity, scale) {
  const step = stepFor(scale);
  const key = player.id + "|" + body.id;
  if (appliedStep.get(key) === step) return;
  try {
    entity.triggerEvent("space_dim:set_size_" + step);
    appliedStep.set(key, step);
  } catch (e) {
    warnOnce("não deu pra escalar " + body.id, e);
  }
}

function hideModel(player, bodyId) {
  appliedStep.delete(player.id + "|" + bodyId);
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

  // Dentro de um corpo, nada de céu.
  //
  // O modelo fica a poucos blocos do jogador, então lá dentro do Sol a Terra, a
  // Lua e Marte apareciam flutuando no meio do plasma — atravessando as camadas
  // que deviam escondê-los. Estando dentro de qualquer corpo, o céu some.
  for (const body of wanted) {
    if (chebyshevTo(eye, body) <= body.radius) {
      clearModels(player.id);
      return;
    }
  }

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

    // O CORPO fica no centro da construção, do tamanho dela — os dois ocupam o
    // mesmo espaço, então chegar perto só troca um pelo outro no mesmo lugar.
    //
    // A ESTRELA não: ela é o ponto de luz que sobra do corpo visto de muito
    // longe, e um ponto no lugar real estaria a milhares de blocos, fora de
    // qualquer alcance. Essa fica presa ao jogador, na direção certa.
    // Na direção do corpo, à distância REAL dele — mas nunca além do alcance em
    // que o jogo ainda desenha uma entidade.
    //
    // Perto, isso põe o modelo exatamente onde o corpo está: ele fica atrás do
    // que estiver na frente, entra em oclusão como qualquer coisa, e não
    // atravessa nada. Longe, ele encosta na borda do alcance e é encolhido pra
    // dar o mesmo ângulo — que é a única forma de continuar visível.
    const at = Math.min(d, SKY_MODEL_DISTANCE);
    const k = at / d;
    try {
      entity.teleport({ x: eye.x + dx * k, y: eye.y + dy * k, z: eye.z + dz * k });
    } catch {
      hideModel(player, body.id);
      continue;
    }

    // Escala pelo ângulo — ver a conta no cabeçalho. A estrela tem tamanho
    // fixo, declarado na entidade.
    if (!star) {
      applyScale(player, body, entity, (2 * at * body.radius) / d);
    }
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
