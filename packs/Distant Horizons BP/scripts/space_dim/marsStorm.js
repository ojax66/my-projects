/* =========================================================================
 * Tempestades de areia de Marte.
 *
 * Marte tem tempestades de poeira de verdade, e elas são o fenômeno mais
 * marcante do planeta: começam regionais, às vezes crescem até cobrir o globo
 * inteiro, e duram semanas. A poeira é fina o bastante pra ficar suspensa
 * meses na atmosfera rarefeita.
 *
 * Aqui elas não cegam e não dão efeito nenhum — ele foi explícito sobre isso. O
 * que elas fazem é ATRAPALHAR A VISTA, com duas coisas somadas:
 *
 *   - partículas de poeira de ferrita passando na frente da câmera;
 *   - uma névoa curta e ocre, que é o que de fato encurta o horizonte.
 *
 * A névoa é a parte que funciona: partícula sozinha vira confete, porque o
 * Bedrock não deixa emitir o bastante pra fechar a vista sem derrubar o
 * desempenho. A partícula é o que faz a névoa parecer AREIA VOANDO em vez de
 * neblina parada.
 *
 * ---------------------------------------------------------------------------
 * Por que a conta é determinística
 * ---------------------------------------------------------------------------
 * A intensidade sai de (dia do mundo, posição) por hash — não há estado
 * guardado, não há sorteio por jogador, não há nada pra sincronizar. Dois
 * jogadores no mesmo lugar no mesmo dia veem exatamente a mesma tempestade, e
 * quem sair e voltar pro mundo pega ela no mesmo ponto.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import {
  MARS_STORM_ENABLED,
  MARS_STORM_CHANCE,
  MARS_STORM_PARTICLES,
  MARS_STORM_INTERVAL,
  MARS_STORM_PARTICLE,
  FOG_MARS_STORM_ID,
  FOG_MARS_STORM_HEAVY_ID,
  MARS_STORM_FOG_AT,
  MARS_STORM_HEAVY_AT,
} from "./config.js";
import { hash2, fbm } from "./world_generator_API.js";

const world = mc.world;
const system = mc.system;

const DIA = 24000;   // ticks de um dia do Minecraft

/** O relógio do mundo, em ticks. Cai no tick do sistema se o mundo não disser. */
export function worldTime() {
  try {
    const t = world.getAbsoluteTime?.();
    if (typeof t === "number") return t;
  } catch { }
  return system.currentTick;
}

/**
 * A força da tempestade em (x, z) naquele instante, de 0 a 1.
 *
 * Três fatores multiplicados:
 *   1. o DIA tem tempestade? (sorteio por dia)
 *   2. a curva do dia — ela nasce, aperta e passa, em vez de ligar e desligar
 *   3. a REGIÃO — no auge ela cobre tudo, mas nas pontas só alguns lugares
 *
 * Pura: os testes chamam direto, sem jogo nenhum.
 */
export function stormIntensity(tempo, x, z) {
  if (!MARS_STORM_ENABLED) return 0;

  const dia = Math.floor(tempo / DIA);
  if (hash2(dia * 7919 + 13, 4242) > MARS_STORM_CHANCE) return 0;

  // A curva do dia: zero nas pontas, cheia no meio.
  const fase = (tempo % DIA) / DIA;
  const envelope = Math.sin(Math.PI * fase);
  if (envelope <= 0) return 0;

  // A região: o mesmo dia é mais pesado num canto do planeta que no outro.
  const regiao = 0.55 + 0.45 * fbm(x + dia * 977, z - dia * 613, 2, 0.5, 1 / 1400);

  const i = envelope * regiao;
  return i < 0 ? 0 : i > 1 ? 1 : i;
}

/** Qual névoa essa intensidade pede, ou null se não há tempestade. */
export function stormFog(intensidade) {
  if (intensidade >= MARS_STORM_HEAVY_AT) return FOG_MARS_STORM_HEAVY_ID;
  if (intensidade >= MARS_STORM_FOG_AT) return FOG_MARS_STORM_ID;
  return null;
}

/**
 * A poeira voando em volta do jogador.
 *
 * Emitida perto dele e um pouco na direção do vento, que é só o tempo andando —
 * o suficiente pra a areia parecer estar passando, e não caindo.
 */
export function spawnStormDust(player, intensidade) {
  if (intensidade <= 0) return 0;
  if (system.currentTick % MARS_STORM_INTERVAL !== 0) return 0;

  const quantas = Math.max(1, Math.round(MARS_STORM_PARTICLES * intensidade));
  const loc = player.location;
  let saiu = 0;
  for (let i = 0; i < quantas; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 2 + Math.random() * 7;
    try {
      player.dimension.spawnParticle(MARS_STORM_PARTICLE, {
        x: loc.x + Math.cos(a) * r,
        y: loc.y + 0.5 + Math.random() * 3,
        z: loc.z + Math.sin(a) * r,
      });
      saiu++;
    } catch { }
  }
  return saiu;
}

/** Texto pra barra de ação enquanto a tempestade está forte, ou null. */
export function stormNotice(intensidade) {
  if (intensidade >= MARS_STORM_HEAVY_AT) {
    return "§6§lTEMPESTADE DE AREIA §r§7— visibilidade quase nula";
  }
  if (intensidade >= MARS_STORM_FOG_AT) {
    return "§6Poeira em suspensão §7— a vista fecha";
  }
  return null;
}
