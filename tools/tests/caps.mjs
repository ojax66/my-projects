import { columnRuns } from './space_dim/bodies.js';
const generateColumn = (dim, x, z) => {
  const runs = columnRuns(x, z);
  let top = -64;
  for (const r of runs)
    for (let y = r.y0; y <= r.y1; y++) { dim.setBlockType({ x, y, z }, r.id); if (y > top) top = y; }
  return runs.length ? top : -64;
};

import { BODIES } from './space_dim/config.js';

// Confere o tamanho das calotas polares: pequenas demais somem, grandes
// demais viram touca. O bloco de gelo de cada corpo termina em _ice.
for (const body of BODIES) {
  if (!['earth','mars'].includes(body.id)) continue;
  const R = body.radius;
  const blocks = new Map();
  for (let dx = -R; dx <= R; dx++)
    for (let dz = -R; dz <= R; dz++)
      generateColumn({ setBlockType: (l, id) => blocks.set(`${l.x},${l.y},${l.z}`, id) },
                     body.center.x + dx, body.center.z + dz);
  let white = 0, total = 0, maxCapR = 0;
  for (const [k, id] of blocks) {
    total++;
    if (!id.endsWith('_ice')) continue;
    white++;
    const [x, , z] = k.split(',').map(Number);
    maxCapR = Math.max(maxCapR, Math.hypot(x - body.center.x, z - body.center.z));
  }
  console.log(`${body.id.padEnd(6)} raio ${String(R).padStart(3)}  gelo ${(100*white/total).toFixed(1)}%  ` +
              `raio do disco polar ~${maxCapR.toFixed(1)} blocos  (${white} de ${total})`);
}
