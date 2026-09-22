/* =========================================================================
 * Agachar e clicar na nave guarda ela no inventário.
 *
 * Sem isto uma nave só se perde. Ela fica onde pousou, e se o jogador voltar
 * pro Overworld por outro caminho — morrendo, ou pelo portal de outro corpo —
 * a nave continua lá, num planeta que ele agora precisa de nave pra alcançar.
 * Isso não é dificuldade, é um beco sem saída.
 *
 * O gesto é agachar porque ele já estava livre: o `minecraft:rideable` das
 * naves tem `crouching_skip_interact: true`, ou seja, agachado o clique não
 * monta. Era um gesto que não fazia nada.
 *
 * O que volta pro inventário é o OVO da nave, que é exatamente o que o craft
 * dela produz — então guardar e soltar é simétrico, e uma Level 2 guardada
 * volta Level 2.
 *
 * Duas recusas, e as duas por motivo:
 *
 *   com gente dentro   guardar uma nave com passageiro é fazer os passageiros
 *                      sumirem junto. O jogo não tem pra onde mandá-los.
 *
 *   inventário cheio   a nave NÃO é removida se o ovo não couber. O contrário
 *                      seria apagar a nave do jogador pra não guardar nada.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import { SHIP_PICKUP_ON_SNEAK, SHIP_EGGS } from "./config.js";
import { t } from "./i18n.js";

const world = mc.world;
const system = mc.system;

/** O ovo que corresponde a esta nave, ou null se a entidade não é nave nossa. */
export function eggFor(typeId) {
  if (typeof typeId !== "string") return null;
  // A Nave Level 1 era `nave:level_1_spaceship` antes do addon inteiro passar
  // pra `gh:`. Quem tem uma dessas no mundo guarda ela igual.
  const hoje = typeId.startsWith("nave:")
    ? "gh:" + typeId.slice("nave:".length)
    : typeId;
  return SHIP_EGGS[hoje] ?? null;
}

/** Quem está montado nela agora. */
function riders(nave) {
  try {
    return (nave.getComponent("rideable")?.getRiders?.() ?? []).filter((r) => r?.isValid);
  } catch {
    return [];
  }
}

/**
 * Tenta guardar esta nave no inventário deste jogador.
 * @returns "ok" | "ocupada" | "cheio" | "nao_e_nave"
 */
export function pickUp(player, nave) {
  const ovo = eggFor(nave?.typeId);
  if (!ovo) return "nao_e_nave";
  if (riders(nave).length) return "ocupada";

  let inv;
  try { inv = player.getComponent("inventory")?.container; } catch { }
  if (!inv) return "cheio";
  if (inv.emptySlotsCount === 0) return "cheio";

  // O item ENTRA ANTES de a nave sair. Se addItem estourar (inventário cheio
  // entre a checagem e agora, outro jogador mexendo), a nave continua lá —
  // que é muito melhor que ela sumir sem virar item.
  try {
    inv.addItem(new mc.ItemStack(ovo, 1));
  } catch {
    return "cheio";
  }
  try { nave.remove(); } catch { }
  return "ok";
}

/** Liga o gesto. Chamado uma vez, do main.js. */
export function startShipPickup() {
  if (!SHIP_PICKUP_ON_SNEAK) return;

  world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    try {
      const player = event.player;
      const nave = event.target;
      if (!player?.isSneaking) return;
      if (!eggFor(nave?.typeId)) return;

      // Cancelado pra o clique agachado não virar nenhuma outra interação da
      // nave (a de desmontar com tesoura, por exemplo).
      event.cancel = true;

      // Fora do evento: mexer em inventário e remover entidade de dentro de um
      // beforeEvent é o tipo de coisa que o jogo recusa sem avisar.
      system.run(() => {
        if (!player?.isValid || !nave?.isValid) return;
        const r = pickUp(player, nave);
        if (r === "ok") return;
        try {
          player.sendMessage(t(player, r === "ocupada"
            ? "nave.guardar_ocupada" : "nave.guardar_cheio"));
        } catch { }
      });
    } catch { }
  });
}
