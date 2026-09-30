/* =========================================================================
 * Aleatoriedade determinística para a geração.
 *
 * O Java usa RandomSource (LCG de 48 bits) e mistura de 64 bits. Em JS os
 * inteiros de 64 bits exigem BigInt, que é lento no motor de script do
 * Bedrock; aqui tudo é feito em 32 bits com Math.imul. Os números não batem
 * com os do Java (a semente do mundo também é outra), mas o comportamento —
 * distribuição, API nextInt/nextFloat/nextDouble — é o mesmo.
 * ========================================================================= */

/** Mistura final do murmur3: espalha bem os bits de um inteiro de 32 bits. */
export function fmix(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash de vários inteiros num uint32. */
export function hashInts(a, b = 0, c = 0, d = 0) {
  let h = fmix((a | 0) ^ 0x9e3779b9);
  h = fmix(h ^ Math.imul(b | 0, 0x85ebca6b));
  h = fmix(h ^ Math.imul(c | 0, 0xc2b2ae35));
  h = fmix(h ^ Math.imul(d | 0, 0x27d4eb2f));
  return h;
}

/** Equivalente ao hash01(x, y, z, salt) das features do mod: [0, 1). */
export function hash01(x, y, z, salt) {
  return hashInts(x, y, z, salt) / 4294967296;
}

/** RandomSource com a mesma interface do Java (sfc32 por baixo). */
export class Rng {
  constructor(seed) {
    this.a = fmix(seed ^ 0x9e3779b9) | 0;
    this.b = fmix(seed + 0x7f4a7c15) | 0;
    this.c = fmix(seed ^ 0x2545f491) | 0;
    this.d = 1;
    for (let i = 0; i < 12; i++) this.next32();
  }

  next32() {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  nextInt(bound) {
    if (bound === undefined) return this.next32() | 0;
    if (bound <= 0) return 0;
    return Math.floor((this.next32() / 4294967296) * bound);
  }

  nextFloat() {
    return (this.next32() >>> 8) / 16777216;
  }

  nextDouble() {
    return (this.next32() * 2097152 + (this.next32() >>> 11)) / 9007199254740992;
  }

  nextBoolean() {
    return (this.next32() & 1) === 1;
  }

  /** "nextLong" do Java, usado como sal: aqui um uint32 é suficiente. */
  nextLong() {
    return this.next32();
  }

  /** nextIntBetweenInclusive do Java. */
  between(min, max) {
    return min + this.nextInt(max - min + 1);
  }

  /** TrapezoidInt / TrapezoidHeight do Java: soma de dois uniformes. */
  trapezoid(min, max, plateau = 0) {
    const i = max - min;
    const j = Math.floor((i - plateau) / 2);
    const k = i - j;
    return min + this.between(0, k) + this.between(0, j);
  }
}
