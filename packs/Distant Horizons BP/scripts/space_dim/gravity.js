/* =========================================================================
 * A gravidade dos corpos.
 *
 * Longe de tudo, o espaço é sem gravidade — o jogador flutua e vai pros lados,
 * que é o comportamento de physics.js. Perto de um corpo, ele PUXA: quanto
 * mais perto, mais forte, com queda quadrática como a gravidade de verdade.
 * O Sol puxa de 150 blocos e puxa forte; a Lua puxa pouco e só de perto.
 *
 * Como aplicar isso é diferente pra jogador e pra entidade:
 *
 *   - Entidade solta (item largado, mob, o OVNI vazio) aceita `applyImpulse`,
 *     que é exatamente um empurrão vetorial. Simples.
 *
 *   - JOGADOR não aceita applyImpulse no Bedrock. A parte horizontal vai por
 *     `applyKnockback`; a vertical entra no controlador de gravidade zero, que
 *     já mantém um Y-alvo por jogador — a gravidade só arrasta esse alvo na
 *     direção do corpo. Sai contínuo e sem brigar com o controlador.
 *
 *   - Jogador PILOTANDO um veículo: quem é puxado é o veículo, senão o passageiro
 *     ia sozinho. É o que faz o Sol arrastar o OVNI junto.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import {
  BODIES,
  BODY_GRAVITY_ENABLED,
  ENTITY_GRAVITY_INTERVAL,
  ENTITY_GRAVITY_SCAN,
  DIMENSION_ID,
} from "./config.js";
import { inArrivalGrace } from "./arrival.js";
import { isSkyModel } from "./skybox.js";

const system = mc.system;

const GRAVITY_BODIES = BODIES.filter((b) => b.gravity);

/**
 * Onde este ponto pousaria neste corpo: o raio da superfície sólida logo
 * abaixo dele. `null` quando não há chão nenhum abaixo — ou seja, quando ele
 * já está dentro do bloco maciço.
 *
 * Camadas `passable` (a coroa e o plasma do Sol) não contam: passa-se direto
 * por elas, então cair "até a coroa" seria cair em lugar nenhum.
 */
function landingRadius(body, d) {
  let best = null;
  for (let i = 0; i < body.layers.length; i++) {
    const layer = body.layers[i];
    if (layer.passable) continue;
    if (layer.radius <= d && (best === null || layer.radius > best)) {
      best = layer.radius;
    }
  }
  return best;
}

/**
 * Puxão que os corpos fazem num ponto: vetor já com a intensidade.
 * Devolve null quando o ponto está fora do alcance de todos.
 *
 * Duas coisas aqui não são óbvias, e as duas vieram de bugs.
 *
 * A DIREÇÃO segue o eixo dominante, não o centro. Num cubo, puxar na direção
 * do centro te empurra na diagonal quando você está perto de uma quina, e o
 * "chão" muda de inclinação conforme você anda pela face. Com o eixo dominante
 * a gravidade fica sempre perpendicular à face em que você está — e como cada
 * face tem a sua, dá pra andar nas seis, inclusive de cabeça pra baixo na de
 * baixo.
 *
 * O ALVO é a superfície, não o centro. A versão anterior puxava pro centro
 * sempre, então quem chegava ao núcleo do Sol continuava sendo empurrado pra
 * dentro e ficava preso dentro do bloco central, sem conseguir sair. Agora o
 * puxão para na casca; e quem já estiver enfiado dentro do maciço é empurrado
 * pra FORA, até a superfície, em vez de ser prensado mais fundo.
 */
export function gravityAt(location) {
  let gx = 0;
  let gy = 0;
  let gz = 0;
  let pulled = false;

  for (let i = 0; i < GRAVITY_BODIES.length; i++) {
    const body = GRAVITY_BODIES[i];
    const dx = location.x - body.center.x;
    const dy = location.y - body.center.y;
    const dz = location.z - body.center.z;

    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const az = Math.abs(dz);
    const d = Math.max(ax, ay, az);          // distância de Chebyshev: cubo

    const outer = body.radius + body.gravity.reach;
    if (d > outer || d < 0.001) continue;

    const landing = landingRadius(body, d);

    // Já pousado na casca: nada de continuar empurrando pra dentro.
    const SETTLED = 0.6;
    if (landing !== null && d - landing <= SETTLED) continue;

    // Sem chão abaixo quer dizer que ele está DENTRO do maciço. Empurra pra
    // fora, senão fica preso — foi o que travava quem entrava no núcleo.
    const outward = landing === null;

    // Eixo dominante: define em qual das seis faces ele está.
    let ux = 0;
    let uy = 0;
    let uz = 0;
    if (ax >= ay && ax >= az) ux = dx >= 0 ? 1 : -1;
    else if (ay >= az) uy = dy >= 0 ? 1 : -1;
    else uz = dz >= 0 ? 1 : -1;

    // Pra dentro (rumo à casca) ou pra fora (destravando de dentro do maciço).
    const sign = outward ? 1 : -1;

    // Intensidade: cai com o quadrado da distância, valendo `strength` na
    // superfície e sumindo suave na borda do alcance, pra não ligar de repente.
    const surface = Math.max(d, body.radius);
    const falloff = (body.radius / surface) ** 2;
    const fade = Math.min(1, (outer - d) / body.gravity.reach);
    const g = body.gravity.strength * falloff * fade;
    if (g <= 0) continue;

    gx += ux * sign * g;
    gy += uy * sign * g;
    gz += uz * sign * g;
    pulled = true;
  }

  return pulled ? { x: gx, y: gy, z: gz } : null;
}

/**
 * Gravidade no jogador.
 *
 * Devolve o componente vertical (blocos por tick) pra o controlador de
 * gravidade zero arrastar o Y-alvo. A parte horizontal é aplicada aqui mesmo.
 */
export function applyPlayerGravity(player) {
  if (!BODY_GRAVITY_ENABLED) return 0;

  // Acabou de chegar: está sem controle enquanto o veículo é recolocado e a
  // montaria refeita. Puxar agora é arrancá-lo de perto do OVNI.
  if (inArrivalGrace(player)) return 0;

  const g = gravityAt(player.location);
  if (!g) return 0;

  // Pilotando: quem é puxado é o veículo — o passageiro vai junto de carona.
  let mount;
  try { mount = player.getComponent("riding")?.entityRidingOn; } catch { }
  if (mount?.isValid) {
    try { mount.applyImpulse(g); } catch { }
    return 0;
  }

  const horizontal = Math.hypot(g.x, g.z);
  if (horizontal > 0.0005) {
    try {
      // applyKnockback empurra na direção dada; a força aqui é pequena de
      // propósito, porque ela entra TODO tick e acumula.
      player.applyKnockback({ x: g.x / horizontal, z: g.z / horizontal }, horizontal * 2.2);
    } catch { }
  }

  return g.y;
}

/**
 * Gravidade nas entidades soltas ao redor de cada jogador do espaço.
 *
 * Só as que estão perto de alguém — o resto nem está carregado. E só de vez em
 * quando: puxar toda entidade todo tick sairia caro à toa.
 */
export function applyEntityGravity(dimension, players) {
  if (!BODY_GRAVITY_ENABLED) return;
  if (system.currentTick % ENTITY_GRAVITY_INTERVAL !== 0) return;

  const seen = new Set();

  for (const player of players) {
    // Mesma carência do jogador: o OVNI recém-recolocado ao lado dele não pode
    // sair puxado antes de ele montar.
    if (inArrivalGrace(player)) continue;

    let nearby;
    try {
      nearby = dimension.getEntities({
        location: player.location,
        maxDistance: ENTITY_GRAVITY_SCAN,
      });
    } catch {
      continue;
    }

    for (const entity of nearby) {
      if (entity.typeId === "minecraft:player") continue;
      // Os corpos vistos de longe são cenário preso ao jogador: puxá-los seria
      // arrastar o próprio céu.
      if (isSkyModel(entity)) continue;
      if (seen.has(entity.id)) continue;      // dois jogadores perto do mesmo item
      seen.add(entity.id);

      // Quem está sendo pilotado é puxado pelo caminho do jogador, senão
      // levaria empurrão dobrado.
      try {
        if (entity.getComponent("rideable")?.getRiders?.()?.length) continue;
      } catch { }

      const g = gravityAt(entity.location);
      if (!g) continue;

      try {
        // O intervalo entre aplicações entra na conta, senão a entidade cairia
        // mais devagar que o jogador no mesmo lugar.
        entity.applyImpulse({
          x: g.x * ENTITY_GRAVITY_INTERVAL,
          y: g.y * ENTITY_GRAVITY_INTERVAL,
          z: g.z * ENTITY_GRAVITY_INTERVAL,
        });
      } catch { }
    }
  }
}

/** Só a leitura — pro HUD e pros testes. */
export function gravityStrengthAt(location) {
  const g = gravityAt(location);
  return g ? Math.hypot(g.x, g.y, g.z) : 0;
}

/** O corpo que mais puxa neste ponto, ou null. */
export function dominantBodyAt(location) {
  let best = null;
  let bestPull = 0;
  for (let i = 0; i < GRAVITY_BODIES.length; i++) {
    const body = GRAVITY_BODIES[i];
    const dx = body.center.x - location.x;
    const dy = body.center.y - location.y;
    const dz = body.center.z - location.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const outer = body.radius + body.gravity.reach;
    if (d > outer || d < 0.001) continue;
    const surface = Math.max(d, body.radius);
    const pull = body.gravity.strength * (body.radius / surface) ** 2 *
      Math.min(1, (outer - d) / body.gravity.reach);
    if (pull > bestPull) { bestPull = pull; best = body; }
  }
  return best;
}

export { DIMENSION_ID };
