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
  SKY_MODEL_REAL_BELOW,
  SKY_GLOBAL_BELOW,
  SKY_MODEL_INTERVAL,
  SKY_SHARE_RADIUS,
  SOLAR_SYSTEM_RADIUS,
  STAR_ENTITY,
} from "./config.js";
import { trackedBodies } from "./tracker.js";
import { SKY_SIZE_STEPS } from "./skySteps.js";
import { alwaysModel, builtRadius, chebyshevTo } from "./bodies.js";

const world = mc.world;
const system = mc.system;

const SKY_PREFIX = "gh:sky_";

// playerId → (bodyId → entidade)
const models = new Map();

export { SWEEP_INTERVAL };

export function isSkyModel(entity) {
  return typeof entity?.typeId === "string" && entity.typeId.startsWith(SKY_PREFIX);
}

function dropModel(entity) {
  try { if (entity?.isValid) entity.remove(); } catch { }
}

// De quantos em quantos ticks as órfãs são varridas.
//
// Era 600 (meio minuto). Uma entidade de céu que sai da distância de simulação
// fica INVÁLIDA; a gente troca ela por uma nova, mas a velha não pôde ser
// removida — entidade inválida não aceita remove() — e volta ao mundo quando a
// chunk recarrega. Daí os dois corpos: o novo, certo, e o velho parado com a
// escala e a posição de antes.
//
// Quem mais sofria era o corpo do degrau mais longe, que é o que chega mais
// perto do limite: no relato dele, sempre Marte. Meio minuto pra limpar é tempo
// demais pra quem está olhando.
const SWEEP_INTERVAL = 40;

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
  // O conjunto do que TEM dono é montado entidade por entidade, cada uma no seu
  // try.
  //
  // Antes era um try só em volta de tudo: bastava uma entidade descarregada
  // (ler `.id` de uma entidade inválida lança) pra abortar a varredura inteira,
  // e aí nada era limpo. Como o aborto acontecia justamente quando havia órfã,
  // a varredura falhava exatamente quando era necessária.
  const known = new Set();
  for (const mine of models.values()) {
    for (const entity of mine.values()) {
      try { known.add(entity.id); } catch { }
    }
  }
  for (const entity of globals.values()) {
    try { known.add(entity.id); } catch { }
  }

  let todas;
  try {
    todas = dimension.getEntities({ families: ["gh_sky"] });
  } catch {
    return;
  }
  for (const entity of todas) {
    try {
      if (!known.has(entity.id)) dropModel(entity);
    } catch { }
  }
}

/**
 * A entidade de um SLOT deste jogador, criando se preciso.
 *
 * Slot e não corpo porque um corpo pode ter mais de uma: a Terra tem o modelo
 * dela e, se tivesse, qualquer casca por cima. Slot e não corpo porque material
 * é por entidade, não por parte do modelo.
 */
function ensureModel(player, slot, wanted) {
  let mine = models.get(player.id);
  if (!mine) models.set(player.id, (mine = new Map()));

  const entity = mine.get(slot);
  // O nível mudou (o corpo virou estrela, ou deixou de ser): troca a entidade.
  if (entity?.isValid && entity.typeId === wanted) return entity;
  if (entity) dropModel(entity);

  let created;
  try {
    created = player.dimension.spawnEntity(wanted, player.location);
  } catch (e) {
    warnOnce("não deu pra criar " + wanted, e);
    mine.delete(slot);
    return null;
  }
  mine.set(slot, created);
  return created;
}


// Um aviso por mensagem, não um por tick: isto roda a cada dois ticks por
// jogador e por corpo, e um erro repetido encheria o console em segundos.
const warned = new Set();
function warnOnce(context, err) {
  const key = context + "|" + err;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn("[gh] " + context + ": " + err);
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

function applyScale(player, slot, entity, scale) {
  applyScaleKey(player.id + "|" + slot, entity, scale);
}

function applyScaleKey(key, entity, scale) {
  const step = stepFor(scale);
  if (appliedStep.get(key) === step) return;
  try {
    entity.triggerEvent("gh:set_size_" + step);
    appliedStep.set(key, step);
  } catch (e) {
    warnOnce("não deu pra escalar " + key, e);
  }
}

function hideModel(player, slot) {
  appliedStep.delete(player.id + "|" + slot);
  const mine = models.get(player.id);
  if (!mine) return;
  const entity = mine.get(slot);
  if (!entity) return;
  dropModel(entity);
  mine.delete(slot);
}

/**
 * O céu de TODOS os jogadores do espaço, de uma vez.
 *
 * Por que não um por um: o modelo é um truque de ponto de vista — fica perto de
 * quem olha e é encolhido pra dar o mesmo ângulo do corpo lá longe. Isso só está
 * certo pra UM observador, e no Bedrock não dá pra esconder uma entidade de um
 * jogador só. Com um conjunto por jogador, cada um via os cubos dos outros
 * flutuando no lugar errado — era o que estava bugado em multijogador.
 *
 * Então quem está junto divide um conjunto só. O erro de paralaxe dentro do
 * grupo é o ângulo entre cada um e o modelo: a dois blocos de distância num
 * degrau de 24, menos de cinco graus. Quem está longe ganha o seu, e os
 * conjuntos ficam longe o bastante um do outro pra não se atrapalharem.
 */
// ---------------------------------------------------------------------------
// Corpos GLOBAIS: um por mundo
// ---------------------------------------------------------------------------
//
// O modelo perto do jogador é um truque de ponto de vista, e truque de ponto de
// vista é por jogador — foi daí que saíram os dois planetas na tela dele.
//
// Perto não precisa de truque nenhum: o corpo cabe na distância em que o cliente
// desenha entidade, então dá pra pôr UMA entidade no lugar de verdade, no tamanho
// de verdade. Todo mundo olha a mesma, cada um do ângulo dele, com paralaxe real.
// É o "um planeta por mundo".
//
// Longe o truque continua, e não faz mal: o modelo do outro jogador está a
// centenas de blocos e ninguém enxerga duplicado.

/** bodyId → a entidade única daquele corpo no mundo. */
const globals = new Map();
/** Quais corpos estão globais neste tick — quem é global não ganha modelo por jogador. */
const globalNow = new Set();

function dropGlobal(bodyId) {
  const entity = globals.get(bodyId);
  if (entity) dropModel(entity);
  globals.delete(bodyId);
  appliedStep.delete("global|" + bodyId);
}

/** Tira todos os corpos globais — dimensão vazia, ou desligando o sistema. */
export function clearGlobals() {
  for (const bodyId of [...globals.keys()]) dropGlobal(bodyId);
  globalNow.clear();
}

function updateGlobals(dimension, players) {
  globalNow.clear();
  if (!dimension) { clearGlobals(); return; }

  // Quem tem alguém perto o bastante pra ser desenhado no lugar real.
  const perto = new Map();
  for (const player of players) {
    let lista;
    try { lista = trackedBodies(player); } catch { continue; }
    let eye;
    try { eye = player.getHeadLocation(); } catch { eye = player.location; }
    for (const body of lista) {
      // Dentro do corpo o céu é outra coisa (ver updateSky): lá o modelo é
      // centrado no jogador, e centrado no jogador ele não pode ser global.
      if (chebyshevTo(eye, body) < body.radius) continue;
      // Distância até o CENTRO, que é onde a entidade global fica. Medir da
      // superfície punha a Terra global com a entidade a 86 blocos do jogador —
      // longe demais pro cliente desenhar, e ela sumia de perto.
      const dx = body.center.x - eye.x;
      const dy = body.center.y - eye.y;
      const dz = body.center.z - eye.z;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= SKY_GLOBAL_BELOW) {
        perto.set(body.id, body);
      }
    }
  }

  for (const bodyId of [...globals.keys()]) {
    if (!perto.has(bodyId)) dropGlobal(bodyId);
  }

  for (const [bodyId, body] of perto) {
    let entity = globals.get(bodyId);
    const wanted = SKY_PREFIX + bodyId;
    if (!entity?.isValid || entity.typeId !== wanted) {
      if (entity) dropModel(entity);
      try {
        entity = dimension.spawnEntity(wanted, body.center);
      } catch (e) {
        warnOnce("não deu pra criar o corpo global " + bodyId, e);
        globals.delete(bodyId);
        continue;
      }
      globals.set(bodyId, entity);
    }
    try {
      entity.teleport(body.center);
      // Tamanho de VERDADE: a aresta do corpo em blocos. Sem projeção nenhuma,
      // porque não há truque pra compensar.
      applyScaleKey("global|" + bodyId, entity, 2 * body.radius);
      globalNow.add(bodyId);
    } catch {
      dropGlobal(bodyId);
    }
  }
}

export function updateSkyAll(players) {
  if (!SKY_MODELS_ENABLED) return;
  if (system.currentTick % SKY_MODEL_INTERVAL !== 0) return;

  // Agrupamento guloso, na ordem do id: o primeiro de cada grupo é a âncora, e
  // a ordem do id é estável, então o grupo não fica trocando de dono a cada
  // tick (o que faria os modelos nascerem e morrerem sem parar).
  const vivos = players.filter((p) => p?.isValid);
  vivos.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const ancoras = [];
  const donoDe = new Map();
  for (const p of vivos) {
    let grupo = null;
    for (const a of ancoras) {
      const d = distXZY(p.location, a.location);
      if (d <= SKY_SHARE_RADIUS) { grupo = a; break; }
    }
    if (grupo) donoDe.set(p.id, grupo.id);
    else { ancoras.push(p); donoDe.set(p.id, p.id); }
  }

  // Quem deixou de ser âncora larga os modelos dele; senão eles ficariam
  // parados no mundo, sem ninguém pra mover.
  for (const p of vivos) {
    if (donoDe.get(p.id) !== p.id) clearModels(p.id);
  }

  // Os corpos perto o bastante viram um só no mundo, antes dos modelos por
  // jogador: assim quem é global já entra desligado no laço de cada âncora.
  try { updateGlobals(vivos[0]?.dimension, vivos); }
  catch (e) { warnOnce("corpos globais", e); }

  for (const a of ancoras) updateSky(a);
}

function distXZY(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
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
  //
  // Corpo SÓLIDO nunca entra aqui: não dá pra estar dentro de um. Pousar nele
  // deixa o jogador exatamente no raio, e com `<=` isso contava como "dentro" —
  // o céu sumia e o planeta virava uma caixa em volta da cabeça no instante em
  // que se encostava nele. Era o "some quando chega perto demais".
  let dentro = null;
  for (const body of wanted) {
    if (body.solid) continue;
    if (chebyshevTo(eye, body) < body.radius) { dentro = body; break; }
  }
  if (dentro) {
    const coroa = alwaysModel(dentro);
    clearModelsExcept(player.id, coroa ? dentro.id : null);
    if (!coroa) return;
    const entity = ensureModel(player, dentro.id, SKY_PREFIX + dentro.id);
    if (entity) {
      try {
        entity.teleport(eye);
        applyScale(player, dentro.id, entity, 2 * dentro.radius);
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
    if (d < 0.001) {
      hideModel(player, body.id);
      continue;
    }

    // Distância até a casca CONSTRUÍDA, não até o raio nominal.
    //
    // O Sol tem raio 100 mas só constrói até 62: a coroa é `modelOnly`. Medindo
    // pelo raio nominal, o modelo dele se desligava com a casca de blocos ainda
    // a 94 blocos de distância — nem coroa nem blocos, o Sol simplesmente não
    // estava lá. builtRadius() devolve a casca que existe de verdade.
    const gap = chebyshevTo(eye, body) - builtRadius(body);

    // Já é global: uma entidade só no mundo cuida dele, no lugar de verdade.
    // Um modelo por jogador aqui seria justamente o planeta duplicado.
    if (globalNow.has(body.id)) {
      hideModel(player, body.id);
      continue;
    }

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

    const entity = ensureModel(player, body.id,
                               star ? STAR_ENTITY : SKY_PREFIX + body.id);
    if (!entity) continue;
    shown.add(body.id);

    // Perto, a posição REAL; longe, o degrau.
    //
    // O degrau é um truque de ponto de vista, e ele quebra de perto: pousando
    // num planeta, a superfície do cubo encolhido fica mais perto do jogador do
    // que o chão em que ele está. Dentro de SKY_MODEL_REAL_BELOW o corpo já cabe
    // na distância de simulação, então o modelo vai pro lugar dele no tamanho
    // dele e não há truque nenhum pra quebrar.
    const at = d <= SKY_MODEL_REAL_BELOW
      ? d
      : Math.min(d, SKY_MODEL_NEAREST + passo * i);
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
      applyScale(player, body.id, entity, (2 * at * body.radius) / d);
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
