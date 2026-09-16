/* =========================================================================
 * Gravidade dos planetas, pela API — sem efeito de poção nenhum.
 *
 * Antes isto era `jump_boost` mais `slow_falling`, e os dois tinham o mesmo
 * defeito: são efeitos de poção. Aparecem na lista de efeitos do jogador,
 * brigam com poções de verdade, somem se alguém tomar leite, e dão sempre o
 * MESMO valor — não dá pra Marte puxar mais que a Lua com a mesma poção.
 *
 * ---------------------------------------------------------------------------
 * Como funciona: malha FECHADA sobre a aceleração medida
 * ---------------------------------------------------------------------------
 * O Bedrock não deixa um script escrever a velocidade de um jogador. O que ele
 * deixa é `applyKnockback`, que SOMA um empurrão. Então o controlador não tenta
 * impor uma velocidade; ele mede a aceleração que aconteceu e devolve o que
 * faltou:
 *
 *   dv    = velocidade de agora − velocidade do tick passado   (o que o motor fez)
 *   alvo  = −g do planeta                                      (o que queremos)
 *   se dv < alvo:  empurra pra cima (alvo − dv)
 *
 * É malha fechada, e isso importa mais do que parece: a conversão entre "força
 * de knockback" e "blocos por tick" não está documentada em lugar nenhum, e
 * eu não tenho como medir dentro do jogo. Num controlador de malha aberta um
 * ganho errado manda o jogador pro céu ou não faz nada. Aqui, um ganho errado
 * só muda em quantos ticks a correção converge — o alvo continua sendo o alvo.
 *
 * E vale nos DOIS sentidos, que é o que faz o pulo alto sair de graça: subindo,
 * o motor desacelera o jogador em 0,08 por tick; o controlador devolve a
 * diferença, então ele desacelera só pelo g do planeta e sobe muito mais. Não
 * precisa de jump_boost nenhum.
 *
 * ---------------------------------------------------------------------------
 * Dano de queda
 * ---------------------------------------------------------------------------
 * O Minecraft cobra dano pela DISTÂNCIA caída, não pela velocidade. Numa
 * gravidade de 1/6 o jogador cai devagar mas cai longe, e levaria o dano cheio
 * — que é justamente o que o slow_falling escondia.
 *
 * Aqui o dano é REDUZIDO na proporção da gravidade, não anulado: cair 20 blocos
 * na Lua machuca o mesmo que cair 3,3 na Terra, porque a energia da batida é
 * essa. Quem pular de 100 blocos ainda se machuca.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import { PLANETS, planetOfDimension, PLANET_LOW_GRAVITY } from "./planets.js";

const world = mc.world;

// A gravidade do Minecraft, em blocos por tick ao quadrado. É o número que o
// motor aplica por tick a uma entidade em queda livre.
export const EARTH_G = 0.08;

// Quantos "pontos de knockback" valem um bloco por tick.
//
// 1 — ou seja, nenhum ganho: o empurrão pedido é exatamente a diferença de
// velocidade que falta. Eu tinha posto 2,2 aqui, copiando a calibragem do puxão
// HORIZONTAL de gravity.js, e o teste pegou o estrago: com ganho 2,2 o
// controlador devolvia 0,147 por tick contra 0,08 que o motor tirava, e o saldo
// de +0,067 por tick não era gravidade baixa, era um foguete.
//
// O que torna 1 seguro mesmo sem eu saber a conversão de verdade do Bedrock
// está logo abaixo, em como `st.vy` é guardado.
const GANHO = 1;

// Teto do empurrão por tick. Sem ele, um pico de `dv` (um knockback de mob, um
// teleporte) viraria um lançamento.
const CORRECAO_MAX = 0.35;

// Abaixo disto não vale a pena mexer: é ruído de ponto flutuante.
const EPS = 0.002;

// Subir mais que isto acima do alvo é um PULO (ou um empurrão de fora), não
// erro de controle. Um pulo do Minecraft começa em 0,42 — bem acima.
const SALTO = 0.05;

// playerId → { alvo } — a velocidade vertical que o jogador deveria ter
const estado = new Map();

export function forgetPlayer(playerId) {
  estado.delete(playerId);
}

/** A gravidade daquele planeta em blocos por tick², ou null. */
export function gravityOf(planet) {
  if (!planet?.gravity) return null;
  return EARTH_G * planet.gravity.factor;
}

/**
 * Um tick de gravidade pra um jogador que está num planeta nosso.
 * @returns a correção aplicada (pros testes), ou 0
 */
export function applyPlanetGravity(player, planet) {
  if (!PLANET_LOW_GRAVITY) return 0;
  const g = gravityOf(planet);
  if (g === null) return 0;

  let st = estado.get(player.id);
  if (!st) {
    st = { alvo: 0 };
    estado.set(player.id, st);
  }

  // Pilotando alguma coisa: o veículo tem a física dele. (Hoje nenhuma nave
  // chega aqui — elas ficam no espaço —, mas um cavalo de outro addon pode.)
  let montaria;
  try { montaria = player.getComponent("riding")?.entityRidingOn; } catch { }
  if (montaria?.isValid) {
    st.alvo = 0;
    return 0;
  }

  let vy = 0;
  try { vy = player.getVelocity().y; } catch { return 0; }

  // No chão não há o que corrigir, e empurrar quem está no chão é catapultá-lo.
  let noChao = false;
  try { noChao = player.isOnGround; } catch { }
  if (noChao) {
    st.alvo = 0;
    return 0;
  }

  // O alvo é uma velocidade INTEGRADA por nós, não uma aceleração medida.
  //
  // Medir a aceleração entre dois ticks foi a primeira tentativa e não funciona:
  // o `dv` de um tick mistura o que o MOTOR fez com o que EU empurrei no tick
  // anterior, e não há como separar os dois olhando só pra velocidade. O
  // resultado, medido no teste, foi uma oscilação — empurra, não empurra,
  // empurra — com a aceleração média saindo no meio do caminho entre o g da
  // Terra e o do planeta.
  //
  // Aqui o controlador guarda qual velocidade o jogador DEVERIA ter e persegue
  // ela. Isso é auto-corretivo sem precisar saber a conversão do Bedrock entre
  // "força de knockback" e "blocos por tick": se o empurrão chegou fraco, a
  // velocidade fica abaixo do alvo e o erro do tick seguinte é maior; se chegou
  // forte, ela fica acima e ele não empurra até o alvo alcançá-la.
  st.alvo -= g;

  // Subiu MUITO mais que o alvo: isso é um pulo, ou um empurrão de outra coisa.
  // Não é papel da gravidade frear um pulo além do g do planeta — o alvo passa
  // a acompanhar o jogador, e a partir daí ele desacelera pelo g daqui. É isso
  // que faz o pulo alto existir sem jump_boost nenhum.
  if (vy > st.alvo + SALTO) st.alvo = vy;

  const erro = st.alvo - vy;
  if (erro <= EPS) return 0;

  const correcao = Math.min(CORRECAO_MAX, erro) * GANHO;
  try {
    // Só vertical: o horizontal é do jogador, e mexer nele tiraria o controle
    // dele de andar.
    player.applyKnockback({ x: 0, z: 0 }, correcao);
  } catch { }
  return correcao;
}

// ---------------------------------------------------------------------------
// Dano de queda proporcional à gravidade
// ---------------------------------------------------------------------------
/**
 * Quanto de um dano de queda deve ser devolvido num planeta.
 * Fator 1/6 → devolve 5/6. Função pura, pros testes.
 */
export function fallDamageRefund(dano, planet) {
  const f = planet?.gravity?.factor;
  if (!(f > 0) || !(f < 1)) return 0;
  return dano * (1 - f);
}

const DIMENSOES = new Set(PLANETS.map((p) => p.dimensionId));

world.afterEvents.entityHurt.subscribe((ev) => {
  try {
    const alvo = ev.hurtEntity;
    if (alvo?.typeId !== "minecraft:player") return;
    if (ev.damageSource?.cause !== "fall") return;
    if (!DIMENSOES.has(alvo.dimension?.id)) return;

    const planet = planetOfDimension(alvo.dimension.id);
    const devolver = fallDamageRefund(ev.damage, planet);
    if (devolver <= 0) return;

    const vida = alvo.getComponent("health");
    if (!vida) return;
    const teto = vida.effectiveMax ?? 20;
    vida.setCurrentValue(Math.min(teto, vida.currentValue + devolver));
  } catch { }
});
