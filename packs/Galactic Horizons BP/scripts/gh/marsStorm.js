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
 * Uma MANCHA que caminha, não um interruptor
 * ---------------------------------------------------------------------------
 * A primeira versão ligava a tempestade no planeta inteiro durante um dia. Está
 * errado por dois motivos, e ele apontou os dois: uma tempestade de areia ocupa
 * um PEDAÇO do planeta, e ela ANDA.
 *
 * Agora cada tempestade é um disco: nasce numa célula da grade, tem um raio
 * próprio, anda em linha reta e morre. Quem está no miolo quase não enxerga;
 * quem está na borda vê a poeira passando; quem está fora vê o céu limpo. E dá
 * pra sair dela a pé — ela anda a 0,02 bloco por tick e o jogador anda vinte
 * vezes mais rápido.
 *
 * ---------------------------------------------------------------------------
 * Por que a conta é determinística
 * ---------------------------------------------------------------------------
 * Tudo sai de (época, célula) por hash — não há estado guardado, não há sorteio
 * por jogador, não há nada pra sincronizar. Dois jogadores no mesmo lugar veem
 * a mesma mancha, no mesmo lugar e do mesmo tamanho, e quem sair e voltar pro
 * mundo pega ela onde ela estava.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import {
  MARS_STORM_ENABLED,
  MARS_STORM_EPOCH,
  MARS_STORM_CELL,
  MARS_STORM_CHANCE,
  MARS_STORM_RADIUS_MIN,
  MARS_STORM_RADIUS_MAX,
  MARS_STORM_DRIFT,
  MARS_STORM_CORE,
  MARS_STORM_PARTICLES,
  MARS_STORM_INTERVAL,
  MARS_STORM_PARTICLE,
  FOG_MARS_STORM_ID,
  FOG_MARS_STORM_HEAVY_ID,
  MARS_STORM_FOG_AT,
  MARS_STORM_HEAVY_AT,
} from "./config.js";
import { hash2 } from "./world_generator_API.js";
import { t } from "./i18n.js";

const world = mc.world;
const system = mc.system;

/** O relógio do mundo, em ticks. Cai no tick do sistema se o mundo não disser. */
export function worldTime() {
  try {
    const t = world.getAbsoluteTime?.();
    if (typeof t === "number") return t;
  } catch { }
  return system.currentTick;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Degrau suave — a borda da mancha, e o nascer e morrer dela. */
function sstep(e0, e1, t) {
  const u = clamp01((t - e0) / (e1 - e0));
  return u * u * (3 - 2 * u);
}

/**
 * A tempestade daquela célula naquela época, vista de (x, z). 0 se não há.
 *
 * Tudo sobre ela — se existe, onde nasce, que raio tem, pra onde anda — sai de
 * hashes de (célula, época). Nada é guardado.
 */
function stormOfCell(ep, ci, cj, tempo, x, z) {
  if (hash2(ci * 7919 + ep * 13, cj * 6047 - ep * 29) > MARS_STORM_CHANCE) return 0;

  const dt = tempo - ep * MARS_STORM_EPOCH;
  if (dt < 0 || dt > MARS_STORM_EPOCH) return 0;

  // Onde ela nasceu, dentro da célula.
  const ox = hash2(ci * 131 + ep * 7, cj * 977 + 3);
  const oz = hash2(ci * 313 - ep * 11, cj * 523 + 91);
  // Pra onde ela anda, e o quanto já andou.
  const ang = hash2(ci * 61 + ep * 5, cj * 89 + 17) * Math.PI * 2;
  const cx = (ci + ox) * MARS_STORM_CELL + Math.cos(ang) * MARS_STORM_DRIFT * dt;
  const cz = (cj + oz) * MARS_STORM_CELL + Math.sin(ang) * MARS_STORM_DRIFT * dt;

  const raio = MARS_STORM_RADIUS_MIN
    + (MARS_STORM_RADIUS_MAX - MARS_STORM_RADIUS_MIN)
    * hash2(ci * 151 + ep * 3, cj * 199 + 61);

  const d = Math.sqrt((x - cx) * (x - cx) + (z - cz) * (z - cz));
  if (d >= raio) return 0;

  // Miolo cheio, borda desbotando: é isso que dá uma FRENTE a ela, em vez de
  // uma parede que liga de um bloco pro outro.
  const perfil = 1 - sstep(raio * MARS_STORM_CORE, raio, d);
  // E ela nasce e morre em vez de aparecer pronta.
  const envelope = Math.sin(Math.PI * (dt / MARS_STORM_EPOCH));

  return clamp01(perfil * envelope);
}

/**
 * A força da tempestade em (x, z) naquele instante, de 0 a 1.
 *
 * Varre as células vizinhas em duas épocas — a atual e a anterior, porque uma
 * tempestade que nasceu na época passada ainda pode estar por cima daqui. Duas
 * manchas sobrepostas não somam: vale a mais forte, senão o encontro de duas
 * viraria uma intensidade impossível.
 *
 * Pura: os testes chamam direto, sem jogo nenhum.
 */
export function stormIntensity(tempo, x, z) {
  if (!MARS_STORM_ENABLED) return 0;

  const ci0 = Math.floor(x / MARS_STORM_CELL);
  const cj0 = Math.floor(z / MARS_STORM_CELL);
  const ep0 = Math.floor(tempo / MARS_STORM_EPOCH);

  let melhor = 0;
  for (let e = ep0 - 1; e <= ep0; e++) {
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const v = stormOfCell(e, ci0 + i, cj0 + j, tempo, x, z);
        if (v > melhor) melhor = v;
      }
    }
  }
  return melhor;
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
export function stormNotice(intensidade, player) {
  if (intensidade >= MARS_STORM_HEAVY_AT) {
    return t(player, "tempestade.forte");
  }
  if (intensidade >= MARS_STORM_FOG_AT) {
    return t(player, "tempestade.fraca");
  }
  return null;
}
