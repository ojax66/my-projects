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
 *     o ponto de renascimento de um jogador NUNCA fica numa dimensão deste
 *     addon — nem no espaço, nem na Lua, nem em Marte.
 *
 * Antes de cada viagem pra cá o spawn é anotado (numa property, então
 * sobrevive a sair e voltar do mundo). Sempre que ele aparecer apontando pra
 * uma dimensão nossa, é devolvido ao que era. Quem não tinha spawn definido volta a não
 * ter — ou seja, ao spawn do mundo, que é o certo.
 *
 * A regra é segura porque não há jeito legítimo de querer renascer aqui: cama
 * não funciona em dimensão custom e âncora de renascimento só vale no Nether.
 *
 * DOIS BURACOS que faziam a regra falhar na prática — e é deles que vinha o
 * "todo mundo renasce no espaço":
 *
 *   1. a conferência só rodava pra quem estava NUMA DAS NOSSAS dimensões. Quem
 *      subia ao espaço e voltava pra Terra saía do alcance dela com o
 *      renascimento ainda apontando pra cá: morria no Overworld, dias depois,
 *      e acordava no espaço. Numa partida em grupo todos sobem, então todos
 *      ficavam assim. Agora a conferência é de TODO jogador, em toda dimensão.
 *
 *   2. mesmo conferindo, a conferência é periódica, e morrer dentro da janela
 *      entre duas delas ainda levava o jogador pra cá. Consertar o ponto de
 *      renascimento depois não desfaz o renascimento que já aconteceu. Por isso
 *      existe agora a volta pra casa: quem RENASCE dentro de uma dimensão
 *      nossa é mandado de volta na hora.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import { DIMENSION_ID, SPAWN_GUARD_ENABLED, SPAWN_GUARD_INTERVAL } from "./config.js";
import { PLANETS } from "./planets.js";

const world = mc.world;
const system = mc.system;

const SAVED_SPAWN = "gh:saved_spawn";

// Todas as dimensões do addon, não só o espaço. A Lua e Marte são dimensões
// custom pelo mesmo motivo, e o jogo reatribui o renascimento nelas do mesmo
// jeito — quem morresse depois de visitar a Lua acordaria na Lua.
const OURS = new Set([DIMENSION_ID, ...PLANETS.map((p) => p.dimensionId)]);

/** Uma dimensão deste addon? Nenhuma delas pode ser ponto de renascimento. */
export function isOurDimension(dimensionId) {
  return OURS.has(dimensionId);
}

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
 * Anota o renascimento atual do jogador, se ele já não estiver numa das nossas.
 * Chamado antes de cada viagem pra cá.
 */
export function rememberSpawn(player) {
  if (!SPAWN_GUARD_ENABLED) return;
  const spawn = readSpawn(player);

  // Já apontando pra uma dimensão nossa: não sobrescreve o que foi guardado
  // antes, senão a lembrança boa seria trocada pela ruim.
  if (OURS.has(spawn?.dimensionId)) return;

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
 * Devolve o renascimento pro lugar certo se ele tiver ido parar numa das nossas.
 * @returns true se precisou corrigir
 */
export function enforceSpawn(player) {
  if (!SPAWN_GUARD_ENABLED) return false;

  const current = readSpawn(player);
  if (!OURS.has(current?.dimensionId)) return false;   // já está certo

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
    console.warn("[gh] não deu pra devolver o ponto de renascimento: " + e);
    return false;
  }
}

/**
 * Roda barato: só de vez em quando, mas pra TODO jogador.
 *
 * Rodar só pra quem estava numa dimensão nossa era o buraco 1 do cabeçalho: o
 * renascimento quebrado só existe DEPOIS que o jogador entrou aqui, e ele
 * continua quebrado depois que o jogador vai embora. É lá fora, no Overworld,
 * que ele morre e descobre.
 */
export function guardSpawnTick(player) {
  if (!SPAWN_GUARD_ENABLED) return;
  if (system.currentTick % SPAWN_GUARD_INTERVAL !== 0) return;
  enforceSpawn(player);
}

// O "usa o bloco mais alto" do jogo, não uma altura de verdade.
const TOPMOST = 32767;

/**
 * Onde é a casa deste jogador: a cama dele, ou o spawn do mundo.
 * @returns {{dimensionId: string, x: number, y: number, z: number} | null}
 */
function casaDe(player) {
  const saved = loadSaved(player);
  if (saved && !OURS.has(saved.dimensionId)) {
    return {
      dimensionId: saved.dimensionId ?? "minecraft:overworld",
      x: saved.x, y: saved.y, z: saved.z,
    };
  }

  // Sem cama: o spawn do mundo, que é sempre do Overworld.
  let loc;
  try { loc = world.getDefaultSpawnLocation?.(); } catch { return null; }
  if (!loc || !Number.isFinite(loc.x) || !Number.isFinite(loc.z)) return null;

  let y = loc.y;
  if (!Number.isFinite(y) || y >= TOPMOST) {
    y = undefined;
    try {
      const topo = world.getDimension("minecraft:overworld")
        .getTopmostBlock({ x: loc.x, z: loc.z });
      if (topo) y = topo.y + 1;
    } catch { }
    if (y === undefined) return null;
  }
  return { dimensionId: "minecraft:overworld", x: loc.x, y, z: loc.z };
}

/**
 * Tira daqui quem RENASCEU aqui.
 *
 * Devolver o ponto de renascimento ao lugar certo não desfaz um renascimento
 * que já aconteceu — e é justamente morrer no intervalo entre duas conferências
 * que ainda jogava o jogador no espaço. Esta é a última linha: acordou numa
 * dimensão nossa sem ter viajado pra cá, volta pra casa na hora.
 *
 * @returns true se precisou trazer alguém de volta
 */
export function sendHomeIfHere(player) {
  if (!SPAWN_GUARD_ENABLED) return false;
  let aqui;
  try { aqui = player.dimension?.id; } catch { return false; }
  if (!OURS.has(aqui)) return false;

  const casa = casaDe(player);
  if (!casa) return false;

  try {
    player.teleport({ x: casa.x, y: casa.y, z: casa.z }, {
      dimension: world.getDimension(casa.dimensionId),
    });
    return true;
  } catch (e) {
    console.warn("[gh] não deu pra trazer o jogador de volta: " + e);
    return false;
  }
}

// Ao entrar no mundo o jogo pode ter reatribuído o renascimento enquanto
// ninguém olhava — então confere já no primeiro spawn.
//
// E `playerSpawn` é também o evento de RENASCER depois de morrer
// (`initialSpawn` false). Se o renascimento levou o jogador pra uma dimensão
// nossa, consertar o ponto pra próxima vez não resolve nada pra esta: ele está
// no espaço agora. Então vem junto a volta pra casa.
world.afterEvents.playerSpawn.subscribe((event) => {
  try { enforceSpawn(event.player); } catch { }
  try {
    if (event.initialSpawn === false) sendHomeIfHere(event.player);
  } catch { }
});

// E na hora exata em que a dimensão muda, que é quando o jogo reatribui.
//
// Nos DOIS sentidos: entrando, porque é aí que o jogo mexe; e saindo, porque o
// que ele deixou mexido acompanha o jogador pra fora — e lá fora era onde
// ninguém mais conferia.
world.afterEvents.playerDimensionChange.subscribe((event) => {
  try {
    if (OURS.has(event.toDimension?.id) || OURS.has(event.fromDimension?.id)) {
      enforceSpawn(event.player);
    }
  } catch { }
});
