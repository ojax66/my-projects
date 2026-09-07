import { columnRuns } from './space_dim/bodies.js';
const generateColumn = (dim, x, z) => {
  const runs = columnRuns(x, z);
  let top = -64;
  for (const r of runs)
    for (let y = r.y0; y <= r.y1; y++) { dim.setBlockType({ x, y, z }, r.id); if (y > top) top = y; }
  return runs.length ? top : -64;
};
// Vista de fora, na altura do equador: pra cada pixel da tela pega o ponto da
// superficie mais proximo do observador. E o que o jogador ve chegando.
import { BODIES } from './space_dim/config.js';
// Pega o bloco da coluna (x,z) cujo Y esta mais perto do alvo: arredondar
// x, y e z de forma independente cai fora da casca com frequencia, mas a
// coluna real sempre tem blocos (garantido pelos testes de geometria).
// Usa columnRuns (nucleo puro) — generateColumn tem orcamento por tick e
// aqui a gente varre a esfera inteira de uma vez.
function blockAt(body, x, y, z) {
  const found = new Map();
  for (const r of columnRuns(x, z))
    for (let yy = r.y0; yy <= r.y1; yy++) found.set(yy, r.id);
  if (!found.size) return null;
  let best = null, bestD = Infinity;
  for (const [by, id] of found) {
    const d = Math.abs(by - y);
    if (d < bestD) { bestD = d; best = id; }
  }
  return bestD <= 3 ? best : null;
}

const CH = {
  'space_dim:earth_ocean':'~', 'space_dim:earth_shallow':'-',
  'space_dim:earth_land':'#', 'space_dim:earth_forest':'@',
  'space_dim:earth_ice':'*',
  'space_dim:moon_regolith_light':'.', 'space_dim:moon_regolith':':',
  'space_dim:moon_regolith_dark':'@',
  'space_dim:mars_dust':'o', 'space_dim:mars_rock':'R',
  'space_dim:mars_rock_dark':'X', 'space_dim:mars_ice':'*',
  'space_dim:sun_corona':'c', 'space_dim:sun_plasma':'p', 'space_dim:sun_core':'O',
};

for (const body of BODIES) {
  const R = body.radius, cols = 72, rows = 34;
  console.log(`\n=== ${body.id.toUpperCase()} — visto de fora (raio ${R}) ===`);
  const counts = {};
  for (let r = 0; r < rows; r++) {
    let line = '';
    // sy: +R no topo (polo norte) ate -R embaixo
    const sy = R - (r + 0.5) * (2 * R / rows);
    for (let c = 0; c < cols; c++) {
      const sx = -R + (c + 0.5) * (2 * R / cols);
      const rem = R * R - sx * sx - sy * sy;
      if (rem < 0) { line += ' '; continue; }
      const x = Math.round(body.center.x + sx);
      const y = Math.round(body.center.y + sy);
      const z = Math.round(body.center.z + Math.sqrt(rem));
      const id = blockAt(body, x, y, z);
      const ch = id ? (CH[id] ?? '#') : '?';
      counts[ch] = (counts[ch] || 0) + 1;
      line += ch;
    }
    console.log(line);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log('  ' + Object.entries(counts).sort((a,b)=>b[1]-a[1])
    .map(([k,v]) => `${k}:${(100*v/total).toFixed(0)}%`).join('  '));
}
