import { columnRuns } from './space_dim/bodies.js';
const generateColumn = (dim, x, z) => {
  const runs = columnRuns(x, z);
  let top = -64;
  for (const r of runs)
    for (let y = r.y0; y <= r.y1; y++) { dim.setBlockType({ x, y, z }, r.id); if (y > top) top = y; }
  return runs.length ? top : -64;
};

import { BODIES, CHUNKS_PER_TICK } from './space_dim/config.js';


for (const body of BODIES) {
  const R = body.radius;
  // Custo por chunk 16x16, varrendo todos os chunks que tocam o corpo.
  const c0x = Math.floor((body.center.x - R) / 16), c1x = Math.floor((body.center.x + R) / 16);
  const c0z = Math.floor((body.center.z - R) / 16), c1z = Math.floor((body.center.z + R) / 16);
  let total = 0, worst = 0, chunks = 0, nonEmpty = 0;
  for (let cx = c0x; cx <= c1x; cx++) {
    for (let cz = c0z; cz <= c1z; cz++) {
      chunks++;
      let n = 0;
      const sink = { setBlockType: () => { n++; } };
      for (let x = cx * 16; x < cx * 16 + 16; x++)
        for (let z = cz * 16; z < cz * 16 + 16; z++)
          generateColumn(sink, x, z);
      total += n;
      if (n > worst) worst = n;
      if (n) nonEmpty++;
    }
  }
  console.log(
    `${body.id.padEnd(6)} raio ${String(R).padStart(3)}  ` +
    `total ${String(total).padStart(7)} blocos  ` +
    `${String(nonEmpty).padStart(4)} chunks  ` +
    `pior chunk ${String(worst).padStart(5)}  ` +
    `→ pior tick (${CHUNKS_PER_TICK}/tick) ${String(worst * CHUNKS_PER_TICK).padStart(5)} escritas`
  );
}
