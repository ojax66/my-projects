// As 55 dimensões: rick:01 … rick:55, com os comandos /rick:rick01 … /rick:rick55.
// Todas fazem a mesma coisa: cópia do overworld nas mesmas coordenadas, com a
// construção no centro.

export const DIMENSION_COUNT = 55;

export const DIMENSIONS = Array.from({ length: DIMENSION_COUNT }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return { id: "rick:" + n, command: "rick:rick" + n, n };
});

const IDS = new Set(DIMENSIONS.map((d) => d.id));
export const isRickDimension = (id) => IDS.has(id);
