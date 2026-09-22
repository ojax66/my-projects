/* =========================================================================
 * O ácido sulfúrico: encher, despejar e queimar.
 *
 * O BLOCO é indestrutível de propósito (ver tools/make_acid.py). Isso não é
 * dificuldade — é o que faz a regra dele valer: se desse pra quebrar a poça
 * com uma picareta, ela sumiria sem soltar nada e "só com balde de titânio"
 * seria mentira. Sendo indestrutível, o único jeito de tirar ácido do mundo é
 * o balde, e é aqui que se decide QUAL balde serve.
 *
 * E é o de titânio porque ácido sulfúrico concentrado COME FERRO — dá sulfato
 * de ferro e gás hidrogênio — e não come titânio, que se protege com uma casca
 * de óxido. O balde de ferro do jogo seria comido. Quem tentar com ele recebe
 * a explicação em vez de um "não" seco.
 *
 * POR QUE ISTO É SCRIPT e não componente: Bedrock não deixa um pacote declarar
 * um item como balde de verdade. `minecraft:bucket` não existe pra pacote —
 * encher e despejar são comportamento do jogo, fechados. Então o gesto é
 * interceptado aqui, no evento de interação, e o item é trocado na mão.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import {
  ACID_BLOCK, ACID_BUCKET, TITANIUM_BUCKET, VANILLA_BUCKETS,
  ACID_DAMAGE, ACID_DAMAGE_INTERVAL, ACID_BURN_SECONDS, ACID_ENABLED,
} from "./config.js";
import { protectionTier } from "./gear.js";
import { t } from "./i18n.js";

const world = mc.world;
const system = mc.system;

/** O item na mão do jogador. */
function naMao(player) {
  try {
    const inv = player.getComponent("inventory")?.container;
    return inv?.getItem(player.selectedSlotIndex) ?? null;
  } catch {
    return null;
  }
}

/** Troca o item da mão por outro. */
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

  const item = naMao(player);
  const id = item?.typeId;
  if (VANILLA_BUCKETS.includes(id)) return "errado";
  if (id !== TITANIUM_BUCKET) return "nao";

  // O item entra ANTES de o bloco sair. Se a troca falhar, a poça continua
  // lá — muito melhor que o ácido evaporar sem virar item.
  if (!trocarMao(player, ACID_BUCKET)) return "nao";
  try {
    bloco.setType("minecraft:air");
  } catch {
    // não deu pra tirar o bloco: desfaz a troca, senão o ácido duplica
    trocarMao(player, TITANIUM_BUCKET);
    return "nao";
  }
  return "ok";
}

/**
 * Despeja o balde cheio no espaço vazio que o jogador está mirando.
 * @returns true se despejou
 */
export function despejar(player, bloco, face) {
  if (!ACID_ENABLED) return false;
  if (naMao(player)?.typeId !== ACID_BUCKET) return false;
  if (!bloco) return false;

  // O bloco do lado da face clicada, que é onde o líquido cabe.
  let alvo;
  try {
    alvo = bloco[String(face).toLowerCase()]?.();
  } catch { }
  if (!alvo) {
    try { alvo = bloco.above(); } catch { }
  }
  if (!alvo) return false;
  try {
    if (!alvo.isAir) return false;
  } catch {
    return false;
  }

  try {
    alvo.setType(ACID_BLOCK);
  } catch {
    return false;
  }
  trocarMao(player, TITANIUM_BUCKET);
  return true;
}

/**
 * Um tick de ácido sobre um jogador que está dentro da poça.
 *
 * O traje ajuda e NÃO salva. Em Vênus só entra quem tem o reforçado, então um
 * traje que anulasse o ácido faria a poça deixar de ser perigo pra todo mundo
 * que consegue chegar perto dela — ou seja, pra todo mundo.
 *
 * @returns o aviso pra barra de ação, ou null
 */
export function applyAcid(player) {
  if (!ACID_ENABLED) return null;

  let dentro = false;
  try {
    const l = player.location;
    const pe = player.dimension.getBlock({
      x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z),
    });
    dentro = pe?.typeId === ACID_BLOCK;
  } catch {
    return null;
  }
  if (!dentro) return null;

  try {
    const modo = player.getGameMode?.();
    if (modo === "Creative" || modo === "Spectator"
        || modo === "creative" || modo === "spectator") return null;
  } catch { }

  if (system.currentTick % ACID_DAMAGE_INTERVAL === 0) {
    // O quanto o traje segura. Nenhum zera.
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
  }
  return t(player, "hud.acido");
}

/** Liga os dois gestos. Chamado uma vez, do main.js. */
export function startAcid() {
  if (!ACID_ENABLED) return;

  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    try {
      const player = event.player;
      const bloco = event.block;
      if (!player) return;

      const id = naMao(player)?.typeId;
      const naPoca = bloco?.typeId === ACID_BLOCK;

      // Encher: mirando a poça.
      if (naPoca && (id === TITANIUM_BUCKET || VANILLA_BUCKETS.includes(id))) {
        event.cancel = true;
        system.run(() => {
          if (!player?.isValid) return;
          const r = encher(player, bloco);
          if (r === "errado") {
            try { player.sendMessage(t(player, "acido.balde_errado")); } catch { }
          }
        });
        return;
      }

      // Despejar: mirando qualquer bloco, com o balde cheio.
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
