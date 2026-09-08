/* =========================================================================
 * O ponto de renascimento não é do espaço.
 *
 * Entrar na dimensão do espaço estava mudando o spawn dos jogadores: quem
 * morresse depois acordava lá em cima, em vez de voltar pra cama ou pro spawn
 * do mundo.
 *
 * Não é o addon que faz isso. Não existe uma chamada de `setSpawnPoint` nem de
 * `setDefaultSpawnLocation` em nenhum arquivo daqui — é o próprio jogo que
 * reatribui o renascimento quando o jogador entra numa dimensão custom.
 *
 * Como a causa está fora do alcance do addon, o jeito é cuidar do sintoma, e
 * cuidar dele com uma regra clara:
 *
 *     o ponto de renascimento de um jogador NUNCA fica na dimensão do espaço.
 *
 * Antes de cada viagem pra cá o spawn é anotado (numa property, então
 * sobrevive a sair e voltar do mundo). Sempre que ele aparecer apontando pro
 * espaço, é devolvido ao que era. Quem não tinha spawn definido volta a não
 * ter — ou seja, ao spawn do mundo, que é o certo.
 *
 * A regra é segura porque não há jeito legítimo de querer renascer aqui: cama
 * não funciona em dimensão custom e âncora de renascimento só vale no Nether.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import { DIMENSION_ID, SPAWN_GUARD_ENABLED, SPAWN_GUARD_INTERVAL } from "./config.js";

const world = mc.world;
const system = mc.system;

const SAVED_SPAWN = "space_dim:saved_spawn";

/** Lê o ponto de renascimento do jogador como dado simples, ou null. */
function readSpawn(player) {
  let point;
  try { point = player.getSpawnPoint?.(); } catch { return null; }
  if (!point) return null;
  return {
    x: point.x,
    y: point.y,
    z: point.z,
    dimensionId: point.dimension?.id,
  };
}

/**
 * Anota o renascimento atual do jogador, se ele já não estiver no espaço.
 * Chamado antes de cada viagem pra cá.
 */
export function rememberSpawn(player) {
  if (!SPAWN_GUARD_ENABLED) return;
  const spawn = readSpawn(player);

  // Já apontando pro espaço: não sobrescreve o que foi guardado antes, senão
  // a lembrança boa seria trocada pela ruim.
  if (spawn?.dimensionId === DIMENSION_ID) return;

  try {
    player.setDynamicProperty(SAVED_SPAWN, JSON.stringify(spawn));
  } catch { }
}

/** O que foi anotado, ou undefined se nunca houve anotação. */
function loadSaved(player) {
  try {
    const raw = player.getDynamicProperty(SAVED_SPAWN);
    if (raw === undefined) return undefined;
    return JSON.parse(raw);   // pode ser null: "não tinha spawn"
  } catch {
    return undefined;
  }
}

/**
 * Devolve o renascimento pro lugar certo se ele tiver ido parar no espaço.
 * @returns true se precisou corrigir
 */
export function enforceSpawn(player) {
  if (!SPAWN_GUARD_ENABLED) return false;

  const current = readSpawn(player);
  if (current?.dimensionId !== DIMENSION_ID) return false;   // já está certo

  const saved = loadSaved(player);

  try {
    if (saved) {
      const dim = world.getDimension(saved.dimensionId ?? "minecraft:overworld");
      player.setSpawnPoint({ x: saved.x, y: saved.y, z: saved.z, dimension: dim });
    } else {
      // Não tinha spawn próprio: limpar devolve o jogador ao spawn do mundo,
      // que é exatamente onde ele nasceria antes de ter vindo pra cá.
      player.setSpawnPoint(undefined);
    }
    return true;
  } catch (e) {
    console.warn("[space_dim] não deu pra devolver o ponto de renascimento: " + e);
    return false;
  }
}

/** Roda barato: só de vez em quando, e só pra quem está no espaço. */
export function guardSpawnTick(player) {
  if (!SPAWN_GUARD_ENABLED) return;
  if (system.currentTick % SPAWN_GUARD_INTERVAL !== 0) return;
  enforceSpawn(player);
}

// Ao entrar no mundo o jogo pode ter reatribuído o renascimento enquanto
// ninguém olhava — então confere já no primeiro spawn.
world.afterEvents.playerSpawn.subscribe((event) => {
  try { enforceSpawn(event.player); } catch { }
});

// E na hora exata em que a dimensão muda, que é quando o jogo reatribui.
world.afterEvents.playerDimensionChange.subscribe((event) => {
  try {
    if (event.toDimension?.id === DIMENSION_ID) enforceSpawn(event.player);
  } catch { }
});
