/* =========================================================================
 * O calor do Sol.
 *
 * O Sol não é um bloco que machuca quando encostado: ele tem um CAMPO de
 * calor que começa dezenas de blocos antes da superfície. Quanto mais perto,
 * mais tempo de fogo e, já colado nele, dano direto. A ideia é que dar a volta
 * pra admirar seja seguro, chegar perto seja assustador, e entrar seja quase
 * impossível.
 *
 * "Quase" porque existe uma saída: resistência a fogo. Com ela o campo não
 * queima, e as camadas atravessáveis (coroa → plasma → núcleo) viram um
 * destino de verdade em vez de um enfeite. Dá pra tirar essa brecha em
 * config.js (FIRE_RESISTANCE_PROTECTS).
 * ========================================================================= */

import * as mc from "@minecraft/server";
import {
  SOLAR_SYSTEM_RADIUS,
  BODIES,
  SUN_HEAT_ENABLED,
  FIRE_RESISTANCE_PROTECTS,
  REINFORCED_SUIT_BLOCKS_APPROACH_HEAT,
} from "./config.js";
// Cubo: o que vale é a distância de Chebyshev, senão o campo de calor seria
// uma esfera em volta de um cubo — quente no ar em frente às faces e frio
// encostado nas quinas.
import { chebyshevTo } from "./bodies.js";
import { hasStarArmor, starArmorBlocksHeat, protectionTier, pressureMultiplier } from "./gear.js";

const system = mc.system;

// Corpos que têm campo de calor (hoje só o Sol, mas nada aqui presume isso).
// O brilho alcança um pouco além do campo de calor: dá pra ver o Sol acender o
// espaço antes de estar perto o bastante pra pegar fogo.
const SUN_GLOW_MARGIN = 60;

const HOT_BODIES = BODIES.filter((b) => b.heat);

function isExempt(player, heatLevel = 0) {
  let mode;
  try { mode = player.getGameMode(); } catch { }
  if (mode === "Creative" || mode === "Spectator" || mode === "creative" || mode === "spectator") {
    return true;
  }
  if (FIRE_RESISTANCE_PROTECTS) {
    try {
      if (player.getEffect("fire_resistance")) return true;
    } catch { }
  }
  // A armadura de estrela é a proteção permanente contra o calor — a poção é
  // só a forma de chegar lá a primeira vez.
  if (starArmorBlocksHeat(player)) return true;
  // O traje reforçado segura o calor da aproximação, mas não o de dentro do
  // Sol: dá pra encostar na superfície com ele, não dá pra atravessar.
  if (
    REINFORCED_SUIT_BLOCKS_APPROACH_HEAT &&
    heatLevel < 1 &&
    protectionTier(player) === "suit"
  ) {
    return true;
  }
  return false;
}

/**
 * Em que faixa de luz do Sol este ponto está.
 *
 *   "blaze"   dentro do campo de calor: o Sol domina tudo
 *   "sunlit"  dentro do sistema: iluminado por ele, mesmo lá de Marte
 *   "deep"    fora do sistema: o azul do espaço profundo
 *
 * A luz de bloco não serve pra isto: ela ilumina superfícies, e no vácuo não há
 * superfície nenhuma pra iluminar — um enxame de blocos de luz no espaço vazio
 * não mudaria um pixel. Quem acende o sistema é a névoa, e é esta faixa que
 * decide qual delas vale.
 *
 * A versão anterior só tinha "perto do Sol" e "longe", com o corte a 230
 * blocos. A Terra está a 520 e Marte a 1040: ninguém nunca via luz do Sol.
 */
export function sunLightTier(location) {
  for (let i = 0; i < HOT_BODIES.length; i++) {
    const body = HOT_BODIES[i];
    const d = chebyshevTo(location, body);
    if (d <= body.radius + body.heat.zone + SUN_GLOW_MARGIN) return "blaze";
    if (d <= SOLAR_SYSTEM_RADIUS) return "sunlit";
  }
  return "deep";
}

/**
 * Quão fundo no campo de calor o jogador está.
 *
 *   0    na borda externa do campo
 *   1    encostando na superfície
 *   >1   dentro do Sol, chegando a 2 no centro
 *
 * Devolve null se estiver fora de qualquer campo.
 */
function heatAt(location) {
  for (let i = 0; i < HOT_BODIES.length; i++) {
    const body = HOT_BODIES[i];
    const d = chebyshevTo(location, body);
    const outer = body.radius + body.heat.zone;
    if (d > outer) continue;

    const t =
      d >= body.radius
        ? (outer - d) / body.heat.zone          // aproximando: 0 → 1
        : 1 + (body.radius - d) / body.radius;  // dentro: 1 → 2

    return { body, t, distance: d };
  }
  return null;
}

/**
 * Aplica o calor e devolve o aviso pra action bar (ou null).
 * Chamado uma vez por tick por jogador no espaço.
 */
export function applySunHeat(player) {
  if (!SUN_HEAT_ENABLED) return null;

  const heat = heatAt(player.location);
  if (!heat) return null;

  const { body, t } = heat;

  if (isExempt(player, t)) {
    return t >= 1
      ? `§6${body.name}§r §7— dentro do Sol, protegido do calor`
      : `§6${body.name}§r §7— calor intenso, mas você está protegido`;
  }

  // O fogo é o que mata na aproximação. A duração cresce com a proximidade, e
  // é reaplicada de meio em meio segundo pra não deixar apagar sozinho.
  if (system.currentTick % 10 === 0) {
    const seconds = Math.max(1, Math.round(body.heat.maxFireSeconds * Math.min(t, 1)));
    try { player.setOnFire(seconds, true); } catch { }
  }

  // Dentro do Sol o fogo já não dá conta: dano direto, escalando até o núcleo.
  if (t > 1 && system.currentTick % 20 === 0) {
    const dmg = Math.round(body.heat.insideDamage * (t - 1) + body.heat.insideDamage);
    try { player.applyDamage(dmg); } catch { }
  }

  if (t >= 1) return `§4§lVOCÊ ESTÁ DENTRO DO SOL`;
  if (t > 0.6) return `§c§lCALOR EXTREMO §r§7— afaste-se do Sol`;
  return `§6Calor do Sol §r§7— está ficando perigoso`;
}

/**
 * A pressão dentro do Sol.
 *
 * Separada do calor de propósito: resistência a fogo resolve o calor e é o que
 * permite ENTRAR, mas lá dentro o esmagamento continua. Só a armadura de
 * núcleo de estrela segura a pressão — e o núcleo de onde ela sai fica
 * justamente lá dentro. Quem entra a primeira vez, entra pra minerar e correr.
 */
export function applySunPressure(player) {
  if (!SUN_HEAT_ENABLED) return null;

  let inside = null;
  for (let i = 0; i < HOT_BODIES.length; i++) {
    const body = HOT_BODIES[i];
    if (!body.pressure) continue;
    if (chebyshevTo(player.location, body) < body.radius) { inside = body; break; }
  }
  if (!inside) return null;

  let mode;
  try { mode = player.getGameMode(); } catch { }
  if (mode === "Creative" || mode === "Spectator" || mode === "creative" || mode === "spectator") {
    return null;
  }

  const passes = pressureMultiplier(player);
  if (passes <= 0) {
    return `§e${inside.name}§r §7— a armadura de estrela aguenta a pressão`;
  }

  const damage = Math.max(1, Math.round(inside.pressure.damage * passes));
  if (system.currentTick % 20 === 0) {
    try { player.applyDamage(damage); } catch { }
    try { player.playSound("random.hurt", { volume: 1, pitch: 0.5 }); } catch { }
  }
  try {
    // Com o traje reforçado o aperto é bem menor — dá pra trabalhar um pouco.
    const amp = passes < 1 ? 0 : 2;
    player.addEffect("slowness", 40, { amplifier: amp, showParticles: false });
    if (passes >= 1) {
      player.addEffect("blindness", 40, { amplifier: 0, showParticles: false });
    }
  } catch { }

  return passes < 1
    ? `§6PRESSÃO §r§7— o traje segura em parte; a de estrela anula`
    : `§4§lPRESSÃO ESMAGADORA §r§7— sem proteção nenhuma`;
}

/** Só a leitura, sem aplicar nada — usado pelos testes e pelo HUD. */
export function heatLevelAt(location) {
  const h = heatAt(location);
  return h ? h.t : 0;
}
