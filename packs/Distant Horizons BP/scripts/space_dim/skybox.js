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
 * O modelo fica SEMPRE perto do jogador, na direção do corpo, e é escalado pra
 * dar exatamente o mesmo ângulo que o corpo daria lá longe. Não é capricho: o
 * Bedrock só mantém e desenha entidade dentro da DISTÂNCIA DE SIMULAÇÃO, que no
 * celular começa em 4 chunks (64 blocos). Pôr o modelo na posição real, a 112
 * blocos, descarregava a entidade — e foi o que fez os corpos sumirem de novo.
 *
 *     ângulo do corpo real  =  raio / distância
 *     ângulo do modelo      =  (meia-aresta × escala) / distância do modelo
 *
 * O cubo do geometry tem 16 unidades de aresta, que é UM bloco: meia-aresta de
 * 0,5. Igualando os dois:
 *
 *     escala = 2 × distância do modelo × raio / distância real
 *
 * A distância do modelo não é a mesma pra todos: cada corpo ganha um degrau
 * entre SKY_MODEL_NEAREST e SKY_MODEL_DISTANCE, na ordem da distância real. Na
 * versão de distância única dois cubos em direções parecidas se interpenetravam;
 * em degraus diferentes o da frente só tapa o de trás.
 *
 * O tamanho aparente fica idêntico ao da construção, então a troca de um pelo
 * outro não muda nada na tela. O que muda é paralaxe: o modelo acompanha o
 * jogador. A troca acontece a SKY_MODEL_HIDE_BELOW da casca CONSTRUÍDA, bem
 * antes de a diferença ficar perceptível — e não acontece nunca pra quem tem
 * camada `modelOnly`, porque desse não há bloco que assuma o lugar.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import {
  DIMENSION_ID,
  SKY_MODELS_ENABLED,
  SKY_MODEL_DISTANCE,
  SKY_MODEL_HIDE_BELOW,
  SKY_MODEL_NEAREST,
  SKY_MODEL_INTERVAL,
  SOLAR_SYSTEM_RADIUS,
  STAR_ENTITY,
} from "./config.js";
import { trackedBodies } from "./tracker.js";
import { SKY_SIZE_STEPS } from "./skySteps.js";
import { alwaysModel, builtRadius, chebyshevTo } from "./bodies.js";

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

/** Tira todos os modelos de um jogador menos um. */
function clearModelsExcept(playerId, keepId) {
  const mine = models.get(playerId);
  if (!mine) return;
  for (const [bodyId, entity] of [...mine]) {
    if (bodyId === keepId) continue;
    appliedStep.delete(playerId + "|" + bodyId);
    dropModel(entity);
    mine.delete(bodyId);
  }
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

  // Da CABEÇA, não dos pés.
  //
  // `player.location` são os pés. Enquanto o modelo ficava longe isso não
  // aparecia, mas no degrau de 16 blocos a diferença de 1,62 vira quase 6° de
  // erro — o modelo desce da posição do corpo e deixa de casar com a construção
  // que ele deveria estar substituindo.
  let eye;
  try { eye = player.getHeadLocation(); } catch { eye = player.location; }

  // Dentro de um corpo o céu some — MENOS a casca só-modelo do corpo em que se
  // está.
  //
  // Os outros corpos têm que sair: o modelo fica a poucos blocos do jogador, e
  // lá dentro do Sol a Terra, a Lua e Marte apareciam flutuando no meio do
  // plasma, atravessando as camadas que deviam escondê-los.
  //
  // A coroa do Sol é o contrário: ela É a camada em que o jogador está, e não
  // tem bloco nenhum: nada mais no jogo vai desenhá-la. Sumir aqui era o pulo
  // feio de antes — cruzava o raio 100 e a coroa evaporava.
  //
  // Lá dentro ela não pode mais ser desenhada como um corpo visto de fora: não
  // há ângulo pra projetar, o jogador está DENTRO. Então ela vira um céu — um
  // cubo do tamanho do corpo, centrado no próprio jogador, com a textura da
  // coroa. Tudo que estiver mais perto que isso (a bola de plasma, a nave)
  // desenha na frente, que é o que se veria de dentro de verdade. E centrado no
  // jogador ele está sempre à distância zero: nunca descarrega.
  let dentro = null;
  for (const body of wanted) {
    if (chebyshevTo(eye, body) <= body.radius) { dentro = body; break; }
  }
  if (dentro) {
    const coroa = alwaysModel(dentro);
    clearModelsExcept(player.id, coroa ? dentro.id : null);
    if (!coroa) return;
    const entity = ensureModel(player, dentro, false);
    if (entity) {
      try {
        entity.teleport(eye);
        applyScale(player, dentro, entity, 2 * dentro.radius);
      } catch { hideModel(player, dentro.id); }
    }
    return;
  }

  // Quem vai aparecer, e a que distância real está.
  const alvos = [];
  for (const body of wanted) {
    const dx = body.center.x - eye.x;
    const dy = body.center.y - eye.y;
    const dz = body.center.z - eye.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 0.001) { hideModel(player, body.id); continue; }

    // Distância até a casca CONSTRUÍDA, não até o raio nominal.
    //
    // O Sol tem raio 100 mas só constrói até 62: a coroa é `modelOnly`. Medindo
    // pelo raio nominal, o modelo dele se desligava com a casca de blocos ainda
    // a 94 blocos de distância — nem coroa nem blocos, o Sol simplesmente não
    // estava lá. builtRadius() devolve a casca que existe de verdade.
    const gap = chebyshevTo(eye, body) - builtRadius(body);

    // Perto o bastante pra os blocos estarem construídos: eles é que mandam.
    // Menos pra quem tem camada `modelOnly` — nenhum bloco vai desenhá-la, então
    // o modelo desse fica ligado em toda distância.
    if (gap <= SKY_MODEL_HIDE_BELOW && !alwaysModel(body)) {
      hideModel(player, body.id);
      continue;
    }
    alvos.push({ body, dx, dy, dz, d });
  }

  // Um degrau de profundidade por corpo, na ordem da distância REAL: o que está
  // mais perto de verdade fica no degrau mais perto do jogador. Dois cubos no
  // mesmo raio se interpenetram; em degraus diferentes o da frente só tapa o de
  // trás, que é o que a distância real manda.
  alvos.sort((a, b) => a.d - b.d);
  const passo = alvos.length > 1
    ? (SKY_MODEL_DISTANCE - SKY_MODEL_NEAREST) / (alvos.length - 1)
    : 0;

  for (let i = 0; i < alvos.length; i++) {
    const { body, dx, dy, dz, d } = alvos[i];

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

    // Na direção do corpo, no degrau dele — ou na posição real, se o corpo
    // estiver mais perto que o degrau (aí o modelo cai exatamente em cima da
    // construção e entra em oclusão como qualquer coisa).
    const at = Math.min(d, SKY_MODEL_NEAREST + passo * i);
    const k = at / d;
    try {
      entity.teleport({ x: eye.x + dx * k, y: eye.y + dy * k, z: eye.z + dz * k });
    } catch {
      hideModel(player, body.id);
      shown.delete(body.id);
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
