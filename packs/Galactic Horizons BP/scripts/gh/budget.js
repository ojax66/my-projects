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

// dimensão → quanto ela já gastou NESTE tick
const spent = new Map();
// dimensão → último tick em que ela pediu orçamento
const lastSeen = new Map();

// Por quanto tempo uma dimensão continua contando como "ativa" depois do último
// pedido. 2 s: tempo de uma chunk cara terminar sem a dimensão sumir da conta
// entre uma coluna e outra.
const ACTIVE_WINDOW = 40;

/**
 * Pede `n` blocos do orçamento deste tick, em nome de uma dimensão.
 *
 * O teto total é um só pro jogo inteiro, mas ele é REPARTIDO entre as dimensões
 * que estão gerando agora. Sem isso a primeira a pedir levava tudo: os três
 * geradores rodam no mesmo tick, na ordem em que foram criados, e o do espaço
 * sempre pedia primeiro. Em multijogador, um jogador no espaço fazia a Lua
 * parar de gerar pra quem estivesse nela — e nada no jogo diria por quê.
 *
 * Repartir custa velocidade a cada uma (metade, com duas ativas), e é o preço
 * certo: duas dimensões gerando devagar é melhor que uma gerando e a outra
 * parada.
 */
export function takeBudget(n, owner = "default") {
  const now = system.currentTick;
  if (now !== budgetTick) {
    budgetTick = now;
    spent.clear();
  }

  lastSeen.set(owner, now);

  let active = 0;
  for (const [k, t] of lastSeen) {
    if (now - t <= ACTIVE_WINDOW) active++;
    else lastSeen.delete(k);
  }

  const cap = BLOCK_BUDGET_PER_TICK / (active || 1);
  const used = spent.get(owner) ?? 0;
  if (used >= cap) return false;
  spent.set(owner, used + n);
  return true;
}

/**
 * Devolve o orçamento ao cheio. Existe pros TESTES: eles voltam o relógio pra
 * zero entre um caso e outro (__reset), e sem isto o tick 0 do caso seguinte
 * seria o mesmo tick 0 do anterior — com o orçamento já gasto.
 */
export function resetBudget() {
  budgetTick = -1;
  spent.clear();
  lastSeen.clear();
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
/** Quantos blocos já foram escritos, por dimensão. Só pra diagnóstico. */
const escritos = new Map();
export function blocosEscritos(owner) { return escritos.get(owner) ?? 0; }

export function writeRun(dim, x, z, y0, y1, id) {
  try {
    const k = dim?.id ?? "?";
    escritos.set(k, (escritos.get(k) ?? 0) + (y1 - y0 + 1));
  } catch { }
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
