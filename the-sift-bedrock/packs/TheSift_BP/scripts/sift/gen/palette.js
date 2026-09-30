/* =========================================================================
 * Paleta de blocos do gerador.
 *
 * Os chunks são calculados em memória como Uint8Array: cada byte é um índice
 * desta paleta. Uma entrada é o id do bloco e, se houver, os estados do
 * Bedrock ("the_sift:ichor_snow|the_sift:layers=3").
 * ========================================================================= */

const keys = ["minecraft:air"];
const index = new Map([["minecraft:air", 0]]);
const parsed = [{ id: "minecraft:air", states: undefined }];

export const AIR = 0;

/** Índice de um bloco (cria a entrada na primeira vez). */
export function blockId(id, states) {
  let key = id;
  if (states) {
    const names = Object.keys(states).sort();
    if (names.length) key += "|" + names.map((n) => n + "=" + states[n]).join(",");
  }
  let i = index.get(key);
  if (i === undefined) {
    i = keys.length;
    if (i > 255) throw new Error("paleta do gerador cheia");
    keys.push(key);
    index.set(key, i);
    parsed.push({ id, states: states && Object.keys(states).length ? { ...states } : undefined });
  }
  return i;
}

/** { id, states } de um índice. */
export function blockOf(i) {
  return parsed[i];
}

export function blockKey(i) {
  return keys[i];
}

export function paletteSize() {
  return keys.length;
}
