/* =========================================================================
 * O ácido sulfúrico: encher, despejar, e ESTAR DENTRO DELE.
 *
 * O BLOCO é indestrutível de propósito (ver tools/make_acid.py). Isso não é
 * dificuldade — é o que faz a regra dele valer: se desse pra quebrar a poça
 * com uma picareta, ela sumiria sem soltar nada e "só com balde de titânio"
 * seria mentira. Sendo indestrutível, o único jeito de tirar ácido do mundo é
 * o balde, e é aqui que se decide QUAL balde serve.
 *
 * E é o de titânio porque ácido sulfúrico concentrado COME FERRO — dá sulfato
 * de ferro e gás hidrogênio — e não come titânio, que se protege com uma casca
 * de óxido. Quem tentar com o balde de ferro recebe a explicação, e não perde
 * o balde.
 *
 * ---------------------------------------------------------------------------
 * DENTRO DELE
 * ---------------------------------------------------------------------------
 * O Bedrock não deixa um pacote criar fluido de verdade: não há como declarar
 * escoamento, nível, empuxo, névoa de submersão nem barra de ar. Tudo que a
 * água faz sozinha, aqui é montado peça por peça — e cada peça existe por um
 * motivo que a água ensina:
 *
 *   NÉVOA     o jogo só põe névoa de submersão dentro de água. Aqui ela é
 *             empurrada quando a CABEÇA entra e tirada quando sai. Enquanto
 *             está dentro, ela tem prioridade sobre a névoa do bioma — duas
 *             névoas no mesmo rótulo brigariam a cada tique.
 *
 *   NADAR     o bloco não tem colisão, então sem controlador o jogador
 *             DESPENCARIA pela poça como se ela fosse ar. O controlador
 *             persegue uma velocidade de afundamento lenta e limita o
 *             horizontal: é o que faz o corpo parecer que está num líquido.
 *
 *   FÔLEGO    o mesmo contador da água: enche fora, esvazia dentro, e quando
 *             acaba vem o dano de afogamento. A barra de bolhas do jogo é da
 *             água de verdade e não dá pra mover, então o aviso vai pra barra
 *             de ação.
 *
 *   ITEM      o que cai lá dentro é destruído, com a MESMA partícula e o mesmo
 *             som da lixeira. É o mesmo gesto do addon: a coisa some e o mundo
 *             avisa que sumiu.
 *
 * O balde cheio NÃO é bebível, e isso é a ausência de um componente, não a
 * presença de um: ele não tem `minecraft:food` nem `minecraft:use_animation`.
 * Os baldes do addon que serviu de base tinham os dois — é o que faz aqueles
 * serem bebida e este ser carga. O validador tranca isso.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import {
  ACID_BLOCK, ACID_BUCKET, TITANIUM_BUCKET, VANILLA_BUCKETS,
  ACID_DAMAGE, ACID_DAMAGE_INTERVAL, ACID_BURN_SECONDS, ACID_ENABLED,
  ACID_FOG, ACID_SINK, ACID_SWIM_CAP, ACID_AIR_SECONDS, ACID_DROWN_DAMAGE,
  ACID_DESTROYS_ITEMS, ACID_ITEM_SCAN, ACID_PARTICLE, ACID_SOUND,
} from "./config.js";
import { protectionTier } from "./gear.js";
import { pushFog, popFog } from "./ambience.js";
import { t } from "./i18n.js";

const world = mc.world;
const system = mc.system;

// ---------------------------------------------------------------------------
// Ler o mundo
// ---------------------------------------------------------------------------

function ehAcido(dim, x, y, z) {
  try {
    return dim.getBlock({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) })
      ?.typeId === ACID_BLOCK;
  } catch {
    return false;
  }
}

/** O pé do jogador está no ácido? */
export function feetInAcid(player) {
  try {
    const l = player.location;
    return ehAcido(player.dimension, l.x, l.y, l.z);
  } catch {
    return false;
  }
}

/**
 * A CABEÇA está no ácido? É esta que manda na névoa e no fôlego.
 *
 * Pé e cabeça são perguntas diferentes e dão respostas diferentes: andando
 * numa poça rasa o pé está dentro e a cabeça fora — aí queima, mas respira.
 */
export function headInAcid(player) {
  try {
    let olho;
    try { olho = player.getHeadLocation(); } catch { olho = null; }
    const l = olho ?? { ...player.location, y: player.location.y + 1.6 };
    return ehAcido(player.dimension, l.x, l.y, l.z);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Encher e despejar
// ---------------------------------------------------------------------------

function naMao(player) {
  try {
    const inv = player.getComponent("inventory")?.container;
    return inv?.getItem(player.selectedSlotIndex) ?? null;
  } catch {
    return null;
  }
}

function trocarMao(player, typeId) {
  try {
    const inv = player.getComponent("inventory")?.container;
    if (!inv) return false;
    inv.setItem(player.selectedSlotIndex, new mc.ItemStack(typeId, 1));
    return true;
  } catch {
    return false;
  }
}

/**
 * Enche o balde de titânio na poça.
 * @returns "ok" | "errado" | "nao" — `errado` é balde que o ácido comeria
 */
export function encher(player, bloco) {
  if (!ACID_ENABLED) return "nao";
  if (bloco?.typeId !== ACID_BLOCK) return "nao";

  const id = naMao(player)?.typeId;
  if (VANILLA_BUCKETS.includes(id)) return "errado";
  if (id !== TITANIUM_BUCKET) return "nao";

  // O item entra ANTES de o bloco sair. Se a troca falhar, a poça continua
  // lá — muito melhor que o ácido evaporar sem virar item.
  if (!trocarMao(player, ACID_BUCKET)) return "nao";
  try {
    bloco.setType("minecraft:air");
  } catch {
    trocarMao(player, TITANIUM_BUCKET);   // senão o ácido duplica
    return "nao";
  }
  return "ok";
}

/** Despeja o balde cheio no espaço vazio que o jogador está mirando. */
export function despejar(player, bloco, face) {
  if (!ACID_ENABLED) return false;
  if (naMao(player)?.typeId !== ACID_BUCKET) return false;
  if (!bloco) return false;

  let alvo;
  try { alvo = bloco[String(face).toLowerCase()]?.(); } catch { }
  if (!alvo) {
    try { alvo = bloco.above(); } catch { }
  }
  if (!alvo) return false;
  try {
    if (!alvo.isAir) return false;
  } catch {
    return false;
  }

  try { alvo.setType(ACID_BLOCK); } catch { return false; }
  trocarMao(player, TITANIUM_BUCKET);
  return true;
}

// ---------------------------------------------------------------------------
// Estar dentro
// ---------------------------------------------------------------------------
/** playerId → segundos de ar restantes. */
const folego = new Map();
/** Quem está com a névoa do ácido na tela, por nossa conta. */
const comNevoa = new Set();

/** A névoa do ácido está ligada pra este jogador? */
export function acidFogOn(playerId) {
  return comNevoa.has(playerId);
}

export function airOf(playerId) {
  return folego.get(playerId) ?? ACID_AIR_SECONDS;
}

export function forgetPlayer(playerId) {
  folego.delete(playerId);
  comNevoa.delete(playerId);
}

function borbulha(player, forte) {
  try {
    const l = player.location;
    player.dimension.spawnParticle(ACID_PARTICLE, {
      x: l.x, y: l.y + (forte ? 1.0 : 0.4), z: l.z,
    });
  } catch { }
  if (forte) {
    try { player.playSound(ACID_SOUND, { volume: 0.4, pitch: 1.1 }); } catch { }
  }
}

/**
 * Nadar: o controlador que impede a queda livre.
 *
 * Sem ele o bloco não tem colisão e o jogador atravessa a poça como se ela
 * fosse ar. Aqui a velocidade vertical persegue um afundamento LENTO, e a
 * horizontal ganha teto — as duas coisas juntas são o que o corpo lê como
 * "estou num líquido".
 *
 * Mesma ideia do planetGravity e pelo mesmo motivo: nada de efeito de poção.
 */
function nadar(player) {
  let v;
  try { v = player.getVelocity(); } catch { return; }

  // Vertical: persegue o afundamento lento.
  const erro = ACID_SINK - v.y;
  if (Math.abs(erro) > 0.005) {
    try {
      player.applyKnockback({ x: 0, z: 0 }, Math.max(-0.35, Math.min(0.35, erro)));
    } catch { }
  }

  // Horizontal: nadar é mais lento que andar.
  const horiz = Math.hypot(v.x, v.z);
  if (horiz > ACID_SWIM_CAP) {
    const fracao = (horiz - ACID_SWIM_CAP) / horiz;
    try {
      player.applyKnockback({ x: -v.x * fracao, z: -v.z * fracao }, 0);
    } catch { }
  }
}

/**
 * Um tick de ácido sobre um jogador.
 *
 * O traje ajuda no DANO e não salva: em Vênus só entra quem tem o reforçado,
 * então um traje que anulasse o ácido faria a poça deixar de ser perigo pra
 * todo mundo que consegue chegar perto dela. E ele não ajuda NADA no fôlego —
 * afogar não é queimadura.
 *
 * @returns o aviso pra barra de ação, ou null
 */
export function applyAcid(player) {
  if (!ACID_ENABLED) return null;

  const pe = feetInAcid(player);
  const cabeca = pe && headInAcid(player);

  // --- a névoa, que segue a CABEÇA ---------------------------------------
  if (cabeca) {
    if (!comNevoa.has(player.id)) {
      comNevoa.add(player.id);
      pushFog(player, ACID_FOG);
    }
  } else if (comNevoa.delete(player.id)) {
    // Tirar a nossa devolve a vez pra névoa do bioma, que volta no tique
    // seguinte por conta própria.
    popFog(player);
  }

  if (!pe) {
    // Fora: o fôlego enche de volta, como na água.
    if (folego.has(player.id)) {
      const r = Math.min(ACID_AIR_SECONDS, (folego.get(player.id) ?? 0) + 0.25);
      if (r >= ACID_AIR_SECONDS) folego.delete(player.id);
      else folego.set(player.id, r);
    }
    return null;
  }

  let criativo = false;
  try {
    const modo = player.getGameMode?.();
    criativo = modo === "Creative" || modo === "Spectator"
      || modo === "creative" || modo === "spectator";
  } catch { }
  if (criativo) return null;

  nadar(player);
  if (ACID_DESTROYS_ITEMS) destruirItens(player);

  const tick = system.currentTick;

  // --- dissolver: a queimadura ------------------------------------------
  if (tick % ACID_DAMAGE_INTERVAL === 0) {
    const tier = protectionTier(player);
    const fator = tier === "star" ? 0.25 : tier === "suit" ? 0.5 : 1;
    const dano = Math.max(1, Math.round(ACID_DAMAGE * fator));
    try {
      player.applyDamage(dano, { cause: mc.EntityDamageCause.contact });
    } catch {
      try { player.applyDamage(dano); } catch { }
    }
    if (ACID_BURN_SECONDS > 0 && tier !== "star") {
      try { player.setOnFire(ACID_BURN_SECONDS, true); } catch { }
    }
    borbulha(player, true);
  } else if (tick % 4 === 0) {
    borbulha(player, false);
  }

  // --- afogar: o fôlego --------------------------------------------------
  if (!cabeca) return t(player, "hud.acido");

  let ar = folego.get(player.id) ?? ACID_AIR_SECONDS;
  ar -= 0.05;                        // um tique
  if (ar > 0) {
    folego.set(player.id, ar);
    return t(player, "hud.acido_folego", { s: Math.ceil(ar) });
  }

  folego.set(player.id, 0);
  if (tick % 20 === 0) {
    try {
      player.applyDamage(ACID_DROWN_DAMAGE, { cause: mc.EntityDamageCause.drowning });
    } catch {
      try { player.applyDamage(ACID_DROWN_DAMAGE); } catch { }
    }
  }
  return t(player, "hud.acido_afogando");
}

/**
 * Item que cai no ácido é destruído.
 *
 * A varredura é em volta do JOGADOR e não do mundo inteiro: item em chunk que
 * ninguém carregou não está caindo em poça nenhuma, e varrer tudo custaria o
 * tique. A partícula e o som são os MESMOS da lixeira — é o mesmo gesto.
 */
function destruirItens(player) {
  if (system.currentTick % 10 !== 0) return;
  let itens = [];
  try {
    itens = player.dimension.getEntities({
      type: "minecraft:item", location: player.location, maxDistance: ACID_ITEM_SCAN,
    });
  } catch {
    return;
  }
  for (const it of itens) {
    if (!it?.isValid) continue;
    try {
      const l = it.location;
      if (!ehAcido(it.dimension, l.x, l.y, l.z)) continue;
      it.dimension.spawnParticle(ACID_PARTICLE, { x: l.x, y: l.y + 0.3, z: l.z });
      it.dimension.playSound?.(ACID_SOUND, l, { volume: 0.5, pitch: 1.4 });
      it.remove();
    } catch { }
  }
}

// ---------------------------------------------------------------------------
// Os gestos
// ---------------------------------------------------------------------------
export function startAcid() {
  if (!ACID_ENABLED) return;

  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    try {
      const player = event.player;
      const bloco = event.block;
      if (!player) return;

      const id = naMao(player)?.typeId;
      const naPoca = bloco?.typeId === ACID_BLOCK;

      if (naPoca && (id === TITANIUM_BUCKET || VANILLA_BUCKETS.includes(id))) {
        event.cancel = true;
        system.run(() => {
          if (!player?.isValid) return;
          if (encher(player, bloco) === "errado") {
            try { player.sendMessage(t(player, "acido.balde_errado")); } catch { }
          }
        });
        return;
      }

      if (id === ACID_BUCKET) {
        event.cancel = true;
        const face = event.blockFace;
        system.run(() => {
          if (!player?.isValid) return;
          despejar(player, bloco, face);
        });
      }
    } catch { }
  });
}
