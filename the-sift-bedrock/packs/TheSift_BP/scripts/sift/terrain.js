/* =========================================================================
 * O terreno do Sift visto pelo resto do add-on.
 *
 * A geração de verdade mora em gen/: é a do mod Java (density functions,
 * biomas multi-noise, regras de superfície, carvers e as features), rodando
 * em segundo plano. Aqui ficam só as consultas que o portal, o spawner e a
 * névoa precisam.
 * ========================================================================= */

import { world } from "@minecraft/server";
import { ChunkService } from "./gen/service.js";

const SEED_KEY = "the_sift:seed";
let service = null;
let pendingZone = null;
let errorSink = (ctx, e) => console.warn("[the_sift] " + ctx + ": " + e);

export function onGenError(fn) {
  errorSink = fn;
}

/** O serviço de chunks (criado com a semente do mundo na primeira vez). */
export function getService() {
  if (!service) {
    let seed = world.getDynamicProperty(SEED_KEY);
    if (typeof seed !== "number") {
      seed = Math.floor(Math.random() * 2147483647);
      world.setDynamicProperty(SEED_KEY, seed);
    }
    service = new ChunkService(seed, { onError: (ctx, e) => errorSink(ctx, e) });
    if (pendingZone) service.setZone(pendingZone.origin, pendingZone.ground);
    if (service.missing.length) errorSink("features sem implementação", service.missing.join("; "));
  }
  return service;
}

export const BIOMES = {
  sift_wastes: { id: "sift_wastes", fog: "the_sift:fog_sift" },
  overgrown_clearing: { id: "overgrown_clearing", fog: "the_sift:fog_sift_overgrown" },
  overgrown_forest: { id: "overgrown_forest", fog: "the_sift:fog_sift_overgrown" },
  overgrown_slopes: { id: "overgrown_slopes", fog: "the_sift:fog_sift_overgrown" },
  overgrown_forest_slopes: { id: "overgrown_forest_slopes", fog: "the_sift:fog_sift_overgrown" },
  overgrown_peaks: { id: "overgrown_peaks", fog: "the_sift:fog_sift_overgrown" },
  siftslate_slopes: { id: "siftslate_slopes", fog: "the_sift:fog_sift" },
  siftslate_peaks: { id: "siftslate_peaks", fog: "the_sift:fog_sift" },
  ichor_snowy_peaks: { id: "ichor_snowy_peaks", fog: "the_sift:fog_sift_snowy" },
  sift_deep_dark: { id: "sift_deep_dark", fog: "the_sift:fog_sift_deep" },
};

export const ALL_SURFACE_BIOMES = Object.keys(BIOMES).filter((b) => b !== "sift_deep_dark");

/** origin = canto da estrutura do portal principal (9 x 40), ground = y da base. */
export function setPortalZone(origin, ground) {
  pendingZone = origin ? { origin, ground } : null;
  if (service) service.setZone(origin, ground);
}

/** Altura natural (sem a zona do portal): y do bloco do topo. */
export function naturalHeightAt(x, z) {
  return { h: getService().gen.surfaceY(x, z) - 1, lake: false };
}

/** y do bloco do topo (o chão onde se pisa). */
export function heightAt(x, z) {
  return getService().topAt(x, z);
}

/** Bioma "visível" para o jogador; subsolo fundo usa a névoa escura. */
export function biomeForPlayer(x, y, z) {
  const s = getService();
  const id = s.gen.biomeAt(x, y, z);
  if (id === "sift_deep_dark") return BIOMES.sift_deep_dark;
  if (y < 48 && y < s.topAt(x, z) - 18) return { id, fog: BIOMES.sift_deep_dark.fog };
  return BIOMES[id] ?? BIOMES.sift_wastes;
}
