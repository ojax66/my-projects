import { columnRuns, builtRadius } from './space_dim/bodies.js';
const generateColumn = (dim, x, z) => {
  const runs = columnRuns(x, z);
  let top = -64;
  for (const r of runs)
    for (let y = r.y0; y <= r.y1; y++) { dim.setBlockType({ x, y, z }, r.id); if (y > top) top = y; }
  return runs.length ? top : -64;
};
// Vista de fora. Os corpos sao CUBOS, entao duas vistas ortogonais chapadas
// contam tudo: a face da frente (a mistura da superficie) e a face de cima
// (a calota polar, que nao aparece de frente).
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
  'space_dim:sun_edge':'e', 'space_dim:sun_corona':'c', 'space_dim:sun_ember':'m',
  'space_dim:sun_plasma':'p', 'space_dim:sun_flare':'f', 'space_dim:sun_blaze':'B',
  'space_dim:sun_core':'O',
};

function render(body, face) {
  // A casca CONSTRUÍDA: a coroa do Sol é só modelo e não tem bloco nenhum.
  const R = builtRadius(body), cols = 62, rows = 31;
  const counts = {};
  console.log(`\n=== ${body.id.toUpperCase()} — face ${face} (cubo de meia-aresta ${R}) ===`);
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      // -R..R em cada eixo da tela
      const a = -R + (c + 0.5) * (2 * R / cols);
      const b = R - (r + 0.5) * (2 * R / rows);
      let x, y, z;
      if (face === 'frente') {
        // olhando pelo +Z: a face da frente e o plano z = cz + R
        x = Math.round(body.center.x + a);
        y = Math.round(body.center.y + b);
        z = Math.round(body.center.z + R);
      } else {
        // olhando de cima: a tampa e o plano y = cy + R
        x = Math.round(body.center.x + a);
        y = Math.round(body.center.y + R);
        z = Math.round(body.center.z + b);
      }
      const id = blockAt(body, x, y, z);
      const ch = id ? (CH[id] ?? '#') : '?';
      counts[ch] = (counts[ch] || 0) + 1;
      line += ch;
    }
    console.log(line);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log('  ' + Object.entries(counts).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${(100 * v / total).toFixed(0)}%`).join('  '));
}

for (const body of BODIES) {
  render(body, 'frente');
  render(body, 'topo');
}
