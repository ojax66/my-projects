/* =========================================================================
 * O que a armadura de estrela faz ALÉM de proteger de calor e pressão.
 *
 * A netherite tem três coisas que nenhuma outra armadura tem: a peça não
 * queima largada no chão, ela resiste a repulsão, e tem tenacidade (o dano
 * grande machuca menos do que o número de proteção sozinho explicaria). A de
 * estrela tem as três, melhores, mais duas que só ela tem:
 *
 *   NÃO QUEIMA           `minecraft:fire_resistant` na peça (já vinha assim).
 *   RESISTE A REPULSÃO   o empurrão do golpe é zerado no mesmo tick.
 *   TENACIDADE           Resistência I permanente — corta 20% de TODO dano,
 *                        inclusive o que armadura nenhuma segura.
 *   RESISTÊNCIA AO FOGO  o efeito de verdade, permanente. Melhor que a
 *                        netherite: ela protege a PEÇA do fogo; esta protege
 *                        o JOGADOR.
 *   QUEIMA QUEM ENCOSTA  o mob que ataca pega fogo. É a armadura feita do
 *                        núcleo de uma estrela — bater nela é bater em algo
 *                        que ainda está quente.
 *
 * Tudo aqui exige o CONJUNTO INTEIRO, como o resto da armadura: meia armadura
 * não segura pressão de estrela e também não queima ninguém.
 *
 * Por que em script e não em componente de item: `minecraft:fire_resistant`
 * existe e é usado; um componente de "resistência a repulsão" pra item eu não
 * consegui confirmar que existe nesta versão, e componente que o jogo não
 * reconhece faz o ITEM INTEIRO não carregar, em silêncio — o mesmo tipo de
 * armadilha que o format_version das receitas já custou uma rodada. Em script
 * o pior caso é o poder não aparecer; nunca é a armadura sumir.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import {
  STAR_ARMOR_FIRE_RESISTANCE,
  STAR_ARMOR_RESISTANCE,
  STAR_ARMOR_KNOCKBACK_RESISTANCE,
  STAR_ARMOR_BURN_SECONDS,
  STAR_ARMOR_BURNS_PLAYERS,
} from "./config.js";
import { hasStarArmor } from "./gear.js";

const world = mc.world;

// Os efeitos são repostos com folga: 60 ticks de duração pra um loop de 1 tick.
// Se um tick falhar, o efeito não pisca.
const DURACAO = 60;

/**
 * Um tick de armadura vestida. Devolve true se o jogador está com o conjunto.
 *
 * Chamado de qualquer dimensão — a armadura não deixa de ser o que é porque o
 * jogador voltou pro Overworld.
 */
export function applyStarArmorPowers(player) {
  if (!hasStarArmor(player)) return false;

  if (STAR_ARMOR_FIRE_RESISTANCE) {
    try {
      player.addEffect("fire_resistance", DURACAO, {
        amplifier: 0,
        showParticles: false,
      });
    } catch { }
  }
  if (STAR_ARMOR_RESISTANCE > 0) {
    try {
      player.addEffect("resistance", DURACAO, {
        amplifier: STAR_ARMOR_RESISTANCE - 1,
        showParticles: false,
      });
    } catch { }
  }
  return true;
}

/**
 * O golpe chegou: quem bateu pega fogo, e o empurrão não sai do lugar.
 *
 * Só vale pro DANO DE ENTIDADE. O dano da pressão, do frio e da queda não tem
 * `damagingEntity`, e sem ele não há em quem pôr fogo nem empurrão pra desfazer.
 */
export function onEntityHurt(event) {
  const player = event.hurtEntity;
  if (!player || player.typeId !== "minecraft:player") return;

  const atacante = event.damageSource?.damagingEntity;
  if (!atacante) return;
  if (!hasStarArmor(player)) return;

  // Repulsão: o jogo já empurrou neste tick. `applyKnockback` com força zero
  // reescreve a velocidade do empurrão em vez de somar a ela, então o que
  // sobra é o jogador parado onde estava.
  if (STAR_ARMOR_KNOCKBACK_RESISTANCE) {
    try { player.applyKnockback({ x: 0, z: 0 }, 0); } catch { }
  }

  // Fogo em quem bateu. Outro JOGADOR fica de fora por padrão: numa briga
  // entre dois, quem tem a armadura já ganhou; incendiar o amigo que deu um
  // soco é o tipo de coisa que estraga a brincadeira.
  if (STAR_ARMOR_BURN_SECONDS <= 0) return;
  if (!STAR_ARMOR_BURNS_PLAYERS && atacante.typeId === "minecraft:player") return;

  try { atacante.setOnFire(STAR_ARMOR_BURN_SECONDS, true); } catch { }
  try {
    player.dimension.spawnParticle("minecraft:basic_flame_particle", {
      x: atacante.location.x,
      y: atacante.location.y + 1,
      z: atacante.location.z,
    });
  } catch { }
}

/** Liga o fogo e a resistência a repulsão. Chamado uma vez, do main.js. */
export function startStarArmor() {
  world.afterEvents.entityHurt.subscribe((event) => {
    try { onEntityHurt(event); } catch { }
  });
}
