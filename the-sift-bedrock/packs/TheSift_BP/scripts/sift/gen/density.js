/* =========================================================================
 * Interpretador das "density functions" do Java.
 *
 * O relevo do Sift é inteiramente descrito em JSON (worldgen/density_function
 * e noise_settings/the_sift.json). Em vez de imitar o formato do terreno com
 * outro ruído, este módulo compila esses mesmos arquivos para funções JS e as
 * avalia do mesmo jeito que o jogo Java.
 *
 * Tipos usados pelo mod: add, mul, noise, range_choice, clamp, gradient, abs,
 * square, interpolated, beardifier (e constantes / referências por nome).
 *
 * Quase tudo é 2D (y_scale 0). Cada nó sabe se depende de y; os que não
 * dependem guardam o último valor por coluna (x, z), então avaliar a mesma
 * coluna em 33 alturas custa o 2D uma vez só.
 * ========================================================================= */

/**
 * @param {Record<string, any>} library  density_function/*.json por nome
 * @param {Record<string, import("./noise.js").NormalNoise>} noises
 */
export function makeCompiler(library, noises) {
  const compiled = new Map();

  function ref(name) {
    const key = name.replace("the_sift:", "").replace("minecraft:", "");
    if (compiled.has(key)) return compiled.get(key);
    const def = library[key];
    if (def === undefined) throw new Error("density function desconhecida: " + name);
    const node = compile(def);
    compiled.set(key, node);
    return node;
  }

  /** Um nó: { f(x,y,z), y: depende de y? } */
  function constant(v) {
    return { f: () => v, y: false, c: v };
  }

  function cached2D(node) {
    if (node.y || node.c !== undefined) return node;
    let lx = NaN;
    let lz = NaN;
    let lv = 0;
    const inner = node.f;
    return {
      y: false,
      f(x, y, z) {
        if (x !== lx || z !== lz) {
          lx = x;
          lz = z;
          lv = inner(x, 0, z);
        }
        return lv;
      },
    };
  }

  function compile(def) {
    if (typeof def === "number") return constant(def);
    if (typeof def === "string") return ref(def);
    const t = def.type.replace("minecraft:", "");
    switch (t) {
      case "constant":
        return constant(def.argument);
      case "add":
      case "mul":
      case "min":
      case "max": {
        const a = compile(def.left ?? def.argument1);
        const b = compile(def.right ?? def.argument2);
        const af = a.f;
        const bf = b.f;
        const y = a.y || b.y;
        let f;
        if (t === "add") f = (x, yy, z) => af(x, yy, z) + bf(x, yy, z);
        else if (t === "mul") {
          f = (x, yy, z) => {
            const v = af(x, yy, z);
            return v === 0 ? 0 : v * bf(x, yy, z);
          };
        } else if (t === "min") f = (x, yy, z) => Math.min(af(x, yy, z), bf(x, yy, z));
        else f = (x, yy, z) => Math.max(af(x, yy, z), bf(x, yy, z));
        return cached2D({ f, y });
      }
      case "noise": {
        const n = noises[def.noise.replace("the_sift:", "").replace("minecraft:", "")];
        if (!n) throw new Error("ruído desconhecido: " + def.noise);
        const xz = def.xz_scale ?? 1;
        const ys = def.y_scale ?? 0;
        return cached2D({ f: (x, y, z) => n.getValue(x * xz, y * ys, z * xz), y: ys !== 0 });
      }
      case "range_choice": {
        const input = compile(def.input);
        const inside = compile(def.when_in_range);
        const outside = compile(def.when_out_of_range);
        const lo = def.min_inclusive;
        const hi = def.max_exclusive;
        const inf = input.f;
        const a = inside.f;
        const b = outside.f;
        return cached2D({
          y: input.y || inside.y || outside.y,
          f(x, y, z) {
            const v = inf(x, y, z);
            return v >= lo && v < hi ? a(x, y, z) : b(x, y, z);
          },
        });
      }
      case "clamp": {
        const input = compile(def.input);
        const lo = def.min;
        const hi = def.max;
        const inf = input.f;
        return cached2D({ y: input.y, f: (x, y, z) => Math.min(hi, Math.max(lo, inf(x, y, z))) });
      }
      case "abs": {
        const input = compile(def.argument ?? def.input);
        const inf = input.f;
        return cached2D({ y: input.y, f: (x, y, z) => Math.abs(inf(x, y, z)) });
      }
      case "square": {
        const input = compile(def.argument ?? def.input);
        const inf = input.f;
        return cached2D({
          y: input.y, f(x, y, z) {
            const v = inf(x, y, z);
            return v * v;
          },
        });
      }
      case "cube": {
        const input = compile(def.argument ?? def.input);
        const inf = input.f;
        return cached2D({
          y: input.y, f(x, y, z) {
            const v = inf(x, y, z);
            return v * v * v;
          },
        });
      }
      case "gradient":
      case "y_clamped_gradient": {
        // gradiente linear num eixo, preso nas pontas (tiling clamp_to_edge)
        const from = def.from_coordinate ?? def.from_y;
        const to = def.to_coordinate ?? def.to_y;
        const fv = def.from_value;
        const tv = def.to_value;
        const axis = def.axis ?? "y";
        const span = to - from;
        const g = (c) => {
          const t = Math.min(1, Math.max(0, (c - from) / span));
          return fv + (tv - fv) * t;
        };
        if (axis === "y") return { y: true, f: (x, y) => g(y) };
        if (axis === "x") return { y: false, f: (x) => g(x) };
        return { y: false, f: (x, y, z) => g(z) };
      }
      case "interpolated":
      case "flat_cache":
      case "cache_2d":
      case "cache_once":
      case "cache_all_in_cell":
        // a interpolação por célula é feita pelo gerador (terrain.js)
        return compile(def.argument ?? def.input);
      case "beardifier":
        return constant(0);
      default:
        throw new Error("tipo de density function não suportado: " + def.type);
    }
  }

  return { compile, ref };
}
