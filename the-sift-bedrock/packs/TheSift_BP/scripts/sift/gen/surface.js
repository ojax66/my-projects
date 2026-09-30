/* =========================================================================
 * Regras de superfície (material_rule do noise_settings do mod).
 *
 * Mesma semântica do SurfaceSystem do Java: a coluna é percorrida de cima
 * para baixo; "stoneDepthAbove" conta os blocos sólidos desde o último ar,
 * "stoneDepthBelow" até o próximo ar abaixo; só blocos iguais ao bloco padrão
 * (siftslate) são trocados.
 * ========================================================================= */

import { hash01 } from "./rng.js";
import { blockId } from "./palette.js";

const TOP_Y = 255;

function resolveY(anchor) {
  if ("absolute" in anchor) return anchor.absolute;
  if ("above_bottom" in anchor) return anchor.above_bottom;
  if ("below_top" in anchor) return TOP_Y - anchor.below_top;
  throw new Error("âncora de altura desconhecida");
}

function strHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

const short = (id) => id.replace("the_sift:", "").replace("minecraft:", "");

/**
 * Compila a regra. O contexto (ctx) é mantido pelo gerador:
 *   x, y, z, above (stoneDepthAbove), below (stoneDepthBelow),
 *   surfaceDepth, secondary(), noise(nome), biome() -> nome do bioma.
 * Devolve (ctx) => índice da paleta, ou -1 se nenhuma regra se aplica.
 */
export function compileSurfaceRule(rule) {
  let maxDepth = 0;

  function cond(c) {
    const t = c.type.replace("minecraft:", "");
    switch (t) {
      case "vertical_gradient": {
        const lo = resolveY(c.true_at_and_below);
        const hi = resolveY(c.false_at_and_above);
        const salt = strHash(c.random_name);
        return (ctx) => {
          if (ctx.y <= lo) return true;
          if (ctx.y >= hi) return false;
          return hash01(ctx.x, ctx.y, ctx.z, salt) < 1 - (ctx.y - lo) / (hi - lo);
        };
      }
      case "noise_threshold": {
        const name = short(c.noise);
        const lo = c.min_threshold;
        const hi = c.max_threshold;
        return (ctx) => {
          const v = ctx.noise(name);
          return v >= lo && v <= hi;
        };
      }
      case "stone_depth": {
        const ceiling = c.surface_type === "ceiling";
        const off = c.offset;
        const add = !!c.add_surface_depth;
        const sec = c.secondary_depth_range;
        // pior caso: surfaceDepth até 6 (ruído 1 * 2,75 + 3 + 0,25)
        maxDepth = Math.max(maxDepth, 1 + off + (add ? 7 : 0) + sec);
        return (ctx) => {
          const d = ceiling ? ctx.below : ctx.above;
          let limit = 1 + off;
          if (add) limit += ctx.surfaceDepth;
          if (sec) limit += Math.trunc(((ctx.secondary() + 1) / 2) * sec);
          return d <= limit;
        };
      }
      case "biome": {
        const set = new Set(c.biome_is.map(short));
        return (ctx) => set.has(ctx.biome());
      }
      case "not": {
        const inner = cond(c.invert);
        return (ctx) => !inner(ctx);
      }
      case "y_above": {
        const y = resolveY(c.anchor);
        return (ctx) => ctx.y >= y;
      }
      default:
        throw new Error("condição de superfície não suportada: " + c.type);
    }
  }

  function compile(r) {
    const t = r.type.replace("minecraft:", "");
    switch (t) {
      case "sequence": {
        const list = r.sequence.map(compile);
        return (ctx) => {
          for (let i = 0; i < list.length; i++) {
            const v = list[i](ctx);
            if (v >= 0) return v;
          }
          return -1;
        };
      }
      case "condition": {
        const c = cond(r.if_true);
        const then = compile(r.then_run);
        return (ctx) => (c(ctx) ? then(ctx) : -1);
      }
      case "block": {
        const s = r.result_state;
        const i = blockId(s.id, s.Properties);
        return () => i;
      }
      default:
        throw new Error("regra de superfície não suportada: " + r.type);
    }
  }

  const fn = compile(rule);
  return { fn, maxDepth };
}
