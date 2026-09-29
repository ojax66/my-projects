/* =========================================================================
 * Mielon's The Sift — port para Bedrock. Ponto de entrada.
 *
 * Só importa os módulos; cada um se registra nos eventos que precisa.
 * A ordem importa num ponto só: worldgen.js registra a dimensão no evento de
 * startup, então precisa ser carregado no início (antes do startup disparar),
 * e é.
 * ========================================================================= */

import "./sift/worldgen.js";
import "./sift/advancements.js";
import "./sift/portal.js";
import "./sift/teleport.js";
import "./sift/singer.js";
import "./sift/blocks.js";
import "./sift/items.js";
import "./sift/mobs.js";
