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
const mod = await import('./space_dim/bodies.js');

// Reimplementa so a escolha de bloco chamando generateColumn num ponto e
// pegando o bloco daquele Y exato.
// Pega o bloco da coluna (x,z) cujo Y esta mais perto do alvo: arredondar
// x, y e z de forma independente cai fora da casca com frequencia, mas a
// coluna real sempre tem blocos (garantido pelos testes de geometria).
function blockAt(body, x, y, z) {
  const found = new Map();
  mod.generateColumn({ setBlockType: (l, id) => found.set(l.y, id) }, x, z);
  if (!found.size) return null;
  let best = null, bestD = Infinity;
  for (const [by, id] of found) {
    const d = Math.abs(by - y);
    if (d < bestD) { bestD = d; best = id; }
  }
  return bestD <= 3 ? best : null;
}

const CH = {
  'minecraft:blue_concrete':'~', 'minecraft:light_blue_concrete':'-',
  'minecraft:green_concrete':'#', 'minecraft:brown_concrete':'A',
  'minecraft:white_concrete':'*', 'minecraft:gray_concrete':'@',
  'minecraft:light_gray_concrete':':', 'minecraft:smooth_stone':'.',
  'minecraft:red_terracotta':'R', 'minecraft:orange_terracotta':'o',
  'minecraft:terracotta':',', 'minecraft:shroomlight':'S',
  'minecraft:ochre_froglight':'Y', 'minecraft:glowstone':'G',
  'minecraft:blackstone':'X',
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
