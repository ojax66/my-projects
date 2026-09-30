/* =========================================================================
 * O ruído do Minecraft Java, portado 1:1:
 *   ImprovedNoise  (Perlin melhorado de Ken Perlin, com o mesmo gradiente)
 *   PerlinNoise    (oitavas com amplitudes, fatores de entrada/valor do Java)
 *   NormalNoise    (dois Perlin somados, normalizado como "legacy")
 *
 * É com isso que o mod define o relevo do Sift (worldgen/noise/*.json). Usar o
 * mesmo algoritmo faz o terreno ter as mesmas formas e proporções do Java.
 * ========================================================================= */

import { Rng, fmix } from "./rng.js";

const GRADIENT = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
  [1, 1, 0], [0, -1, 1], [-1, 1, 0], [0, -1, -1],
];
const GX = new Float64Array(16);
const GY = new Float64Array(16);
const GZ = new Float64Array(16);
for (let i = 0; i < 16; i++) {
  GX[i] = GRADIENT[i][0];
  GY[i] = GRADIENT[i][1];
  GZ[i] = GRADIENT[i][2];
}

const smoothstep = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (t, a, b) => a + t * (b - a);

export class ImprovedNoise {
  /** @param {Rng} random */
  constructor(random) {
    this.xo = random.nextDouble() * 256;
    this.yo = random.nextDouble() * 256;
    this.zo = random.nextDouble() * 256;
    const p = new Uint8Array(512);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 0; i < 256; i++) {
      const j = random.nextInt(256 - i);
      const t = p[i];
      p[i] = p[i + j];
      p[i + j] = t;
    }
    for (let i = 0; i < 256; i++) p[i + 256] = p[i];
    this.p = p;
  }

  noise(x, y, z) {
    const x2 = x + this.xo;
    const y2 = y + this.yo;
    const z2 = z + this.zo;
    const xf = Math.floor(x2);
    const yf = Math.floor(y2);
    const zf = Math.floor(z2);
    const xr = x2 - xf;
    const yr = y2 - yf;
    const zr = z2 - zf;
    const p = this.p;
    const X = xf & 255;
    const Y = yf & 255;
    const Z = zf & 255;
    const x0 = p[X];
    const x1 = p[X + 1];
    const xy00 = p[x0 + Y];
    const xy01 = p[x0 + Y + 1];
    const xy10 = p[x1 + Y];
    const xy11 = p[x1 + Y + 1];
    const g = (h, a, b, c) => {
      const i = h & 15;
      return GX[i] * a + GY[i] * b + GZ[i] * c;
    };
    const d000 = g(p[xy00 + Z], xr, yr, zr);
    const d100 = g(p[xy10 + Z], xr - 1, yr, zr);
    const d010 = g(p[xy01 + Z], xr, yr - 1, zr);
    const d110 = g(p[xy11 + Z], xr - 1, yr - 1, zr);
    const d001 = g(p[xy00 + Z + 1], xr, yr, zr - 1);
    const d101 = g(p[xy10 + Z + 1], xr - 1, yr, zr - 1);
    const d011 = g(p[xy01 + Z + 1], xr, yr - 1, zr - 1);
    const d111 = g(p[xy11 + Z + 1], xr - 1, yr - 1, zr - 1);
    const u = smoothstep(xr);
    const v = smoothstep(yr);
    const w = smoothstep(zr);
    return lerp(w,
      lerp(v, lerp(u, d000, d100), lerp(u, d010, d110)),
      lerp(v, lerp(u, d001, d101), lerp(u, d011, d111)));
  }
}

const WRAP = 33554432;
const wrap = (v) => v - Math.floor(v / WRAP + 0.5) * WRAP;

export class PerlinNoise {
  /**
   * @param {Rng} random
   * @param {number} firstOctave
   * @param {number[]} amplitudes
   */
  constructor(random, firstOctave, amplitudes) {
    this.amplitudes = amplitudes;
    this.levels = amplitudes.map((a) => {
      const n = new ImprovedNoise(random);
      return a !== 0 ? n : null;
    });
    const size = amplitudes.length;
    this.lowestFreqInputFactor = Math.pow(2, firstOctave);
    this.lowestFreqValueFactor = Math.pow(2, size - 1) / (Math.pow(2, size) - 1);
  }

  getValue(x, y, z) {
    let value = 0;
    let inputFactor = this.lowestFreqInputFactor;
    let valueFactor = this.lowestFreqValueFactor;
    for (let i = 0; i < this.levels.length; i++) {
      const n = this.levels[i];
      if (n) value += this.amplitudes[i] * n.noise(wrap(x * inputFactor), wrap(y * inputFactor), wrap(z * inputFactor)) * valueFactor;
      inputFactor *= 2;
      valueFactor /= 2;
    }
    return value;
  }
}

const INPUT_FACTOR = 1.0181268882175227;

export class NormalNoise {
  /**
   * @param {number} seed
   * @param {{base_octave?: number, firstOctave?: number, octave_count?: number, amplitude_modifiers?: number[], amplitudes?: number[]}} params
   */
  constructor(seed, params) {
    const first = params.firstOctave ?? params.base_octave;
    const amps = params.amplitudes ?? params.amplitude_modifiers;
    const random = new Rng(seed);
    this.first = new PerlinNoise(random, first, amps);
    this.second = new PerlinNoise(random, first, amps);
    let minO = Infinity;
    let maxO = -Infinity;
    for (let i = 0; i < amps.length; i++) {
      if (amps[i] !== 0) {
        minO = Math.min(minO, i);
        maxO = Math.max(maxO, i);
      }
    }
    const octaves = maxO - minO;
    this.valueFactor = (1 / 6) / (0.1 * (1 + 1 / (octaves + 1)));
  }

  getValue(x, y, z) {
    return (this.first.getValue(x, y, z) +
      this.second.getValue(x * INPUT_FACTOR, y * INPUT_FACTOR, z * INPUT_FACTOR)) * this.valueFactor;
  }
}

/** Uma NormalNoise por nome, semeada a partir da semente do mundo. */
export function makeNoises(worldSeed, defs) {
  const out = {};
  for (const [name, params] of Object.entries(defs)) {
    let h = worldSeed | 0;
    for (let i = 0; i < name.length; i++) h = fmix(h ^ Math.imul(name.charCodeAt(i), 0x01000193));
    out[name] = new NormalNoise(h, params);
  }
  return out;
}
