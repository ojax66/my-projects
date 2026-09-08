/* =========================================================================
 * Carência de chegada.
 *
 * Chegar no espaço não é instantâneo: o jogador é teleportado, a chunk do
 * destino carrega, o veículo é recolocado e só então ele volta a montar. São
 * uns bons ticks em que ele está parado no lugar onde caiu, sem controle
 * nenhum.
 *
 * Enquanto isso dura, nada pode arrastá-lo. Foi o que aconteceu: a chegada da
 * Terra ficava DENTRO do campo de gravidade dela, e o planeta puxava o jogador
 * pra longe do OVNI antes de ele conseguir montar — daí a impressão de chegar
 * ao espaço sem a nave.
 *
 * As coordenadas de chegada agora ficam fora do campo de cada corpo
 * (tools/tests/test_gravity_arrival.mjs não deixa isso regredir), e esta
 * carência é a segunda linha: durante ela nenhum corpo puxa o jogador nem as
 * entidades ao redor dele. Ela também segura o portal, senão encostar num
 * corpo no tick da chegada mandaria o jogador de volta na hora.
 *
 * Mora num arquivo só dela porque travel.js e gravity.js precisam dos dois
 * lados: se o estado ficasse em travel.js, gravity.js importaria travel.js,
 * que importa physics.js, que importa gravity.js.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import { ARRIVAL_GRACE_TICKS } from "./config.js";

const system = mc.system;

const arrivedAt = new Map();

/** Marca que o jogador acabou de chegar. */
export function markArrival(player) {
  arrivedAt.set(player.id, system.currentTick);
}

/** Ainda dentro da janela de chegada? */
export function inArrivalGrace(player) {
  const t = arrivedAt.get(player?.id);
  return t !== undefined && system.currentTick - t < ARRIVAL_GRACE_TICKS;
}

/** Jogador saiu do mundo. */
export function forgetArrival(id) {
  arrivedAt.delete(id);
}
