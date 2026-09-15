/* =========================================================================
 * Orçamento de blocos por tick — compartilhado por TODAS as dimensões.
 *
 * O gerador do world_generator_API trabalha em chunks inteiras, mas uma chunk
 * sozinha passa fácil de 8 mil blocos — perto do Sol, ou numa coluna de crosta
 * de 30 blocos vezes 256 colunas. Escrever isso num frame trava o jogo. Então
 * o custo é limitado por BLOCO, não por chunk: estourou o teto do tick, a
 * coluna atual joga BudgetExhausted, o gerador não marca a chunk como pronta e
 * tenta de novo depois.
 *
 * O orçamento é UM só pro jogo inteiro, e não um por dimensão. O Bedrock roda
 * tudo na mesma thread: dois geradores com 6000 cada gastariam 12000 no mesmo
 * frame, que é exatamente o que o teto existe pra impedir. Como cada jogador
 * só está numa dimensão por vez, na prática quem gasta é um gerador só.
 *
 * Pra a retentativa não recomeçar do zero (e nunca terminar), cada chunk guarda
 * um cursor: o índice da próxima coluna a processar. O gerador percorre as
 * colunas sempre na mesma ordem (x por fora, z por dentro), então o índice é
 * reprodutível e a chunk retoma exatamente de onde parou.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import { BlockVolume } from "@minecraft/server";
import { BLOCK_BUDGET_PER_TICK } from "./config.js";

const system = mc.system;

// Erro de verdade, não Symbol: o gerador entrega o erro pro onError, que o
// concatena numa string — e interpolar um Symbol lança TypeError. Uma
// instância só, reaproveitada, porque isso é fluxo normal e acontece dezenas
// de vezes por tick.
class BudgetExhaustedError extends Error {
  constructor() {
    super("orçamento de blocos do tick esgotado");
    this.name = "BudgetExhausted";
    this.isBudgetExhausted = true;
  }
}

export const BudgetExhausted = new BudgetExhaustedError();

/** true se o erro veio do teto de blocos por tick (não é falha de verdade). */
export function isBudgetError(err) {
  return err?.isBudgetExhausted === true;
}

let budgetTick = -1;
let budgetLeft = 0;

export function takeBudget(n) {
  if (system.currentTick !== budgetTick) {
    budgetTick = system.currentTick;
    budgetLeft = BLOCK_BUDGET_PER_TICK;
  }
  if (budgetLeft <= 0) return false;
  budgetLeft -= n;
  return true;
}

/**
 * Devolve o orçamento ao cheio. Existe pros TESTES: eles voltam o relógio pra
 * zero entre um caso e outro (__reset), e sem isto o tick 0 do caso seguinte
 * seria o mesmo tick 0 do anterior — com o orçamento já gasto.
 */
export function resetBudget() {
  budgetTick = -1;
  budgetLeft = 0;
}

// ---------------------------------------------------------------------------
// Cursor por chunk
// ---------------------------------------------------------------------------
const COLUMNS_PER_CHUNK = 256;

/**
 * Cria um cursor de chunk independente. Cada dimensão tem o seu — duas
 * dimensões têm chunks com as MESMAS coordenadas, e um mapa só faria a chunk
 * (0,0) da Lua marcar como pronta a (0,0) de Marte.
 */
export function makeChunkCursor() {
  const cursors = new Map();

  const keyOf = (x, z) => Math.floor(x / 16) + "," + Math.floor(z / 16);

  // Mesmo laço do gerador: for x { for z { ... } }
  const indexOf = (x, z) => (((x % 16) + 16) % 16) * 16 + (((z % 16) + 16) % 16);

  return {
    /**
     * Onde esta coluna está na fila da chunk:
     *   "done"    — já resolvida numa passada anterior
     *   "ahead"   — alguma coluna ANTES dela falhou nesta passada
     *   "current" — é a vez dela
     */
    stateOf(x, z) {
      const index = indexOf(x, z);
      const cursor = cursors.get(keyOf(x, z)) ?? 0;
      if (index < cursor) return "done";
      if (index > cursor) return "ahead";
      return "current";
    },

    /** Marca a coluna atual como resolvida e anda o cursor. */
    advance(x, z) {
      const index = indexOf(x, z);
      const k = keyOf(x, z);
      // Chegar na última coluna com o cursor em dia significa que as 255
      // anteriores terminaram: a chunk acabou e o cursor sai da memória.
      if (index + 1 >= COLUMNS_PER_CHUNK) cursors.delete(k);
      else cursors.set(k, index + 1);
    },

    // só pros testes
    __size() { return cursors.size; },
  };
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------
/**
 * Escreve um trecho contínuo de blocos iguais. Um fillBlocks vale por vários
 * setBlockType: as colunas são feitas de camadas, então blocos vizinhos na
 * vertical repetem bastante e os trechos costumam ter vários blocos.
 *
 * Mora aqui, junto do orçamento, porque é exatamente isto que o orçamento
 * conta — e as três dimensões escrevem do mesmo jeito.
 */
export function writeRun(dim, x, z, y0, y1, id) {
  if (y1 === y0) {
    dim.setBlockType({ x, y: y0, z }, id);
    return;
  }
  try {
    dim.fillBlocks(new BlockVolume({ x, y: y0, z }, { x, y: y1, z }), id);
  } catch (e) {
    // fillBlocks indisponível ou recusado: cai no caminho bloco a bloco.
    for (let y = y0; y <= y1; y++) dim.setBlockType({ x, y, z }, id);
  }
}
