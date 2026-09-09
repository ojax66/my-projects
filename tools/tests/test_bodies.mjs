import { columnRuns } from './space_dim/bodies.js';
const generateColumn = (dim, x, z) => {
  const runs = columnRuns(x, z);
  let top = -64;
  for (const r of runs)
    for (let y = r.y0; y <= r.y1; y++) { dim.setBlockType({ x, y, z }, r.id); if (y > top) top = y; }
  return runs.length ? top : -64;
};
import { getHeight, distanceTo } from './space_dim/bodies.js';
import { BODIES, DIM_MIN_Y } from './space_dim/config.js';


// Dimensão falsa que só anota o que foi escrito.
function mockDim() {
  const blocks = new Map();
  return {
    blocks,
    setBlockType(loc, id) { blocks.set(`${loc.x},${loc.y},${loc.z}`, id); },
  };
}

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

// --- 1. Vácuo continua vácuo -------------------------------------------------
{
  const dim = mockDim();
  const h = generateColumn(dim, 12345, -9876);
  check('coluna longe de tudo fica vazia', dim.blocks.size === 0 && h === DIM_MIN_Y);
}

// --- 2. Cada corpo gera, e só na própria área --------------------------------
for (const body of BODIES) {
  const dim = mockDim();
  // Coluna passando exatamente pelo centro: deve dar duas calotas.
  generateColumn(dim, body.center.x, body.center.z);
  const ys = [...dim.blocks.keys()].map(k => Number(k.split(',')[1])).sort((a, b) => a - b);
  // Faixa inclusiva: de cy-R a cy-(R-shell) sao shell+1 blocos por calota.
  // Camada macica (shell >= radius) e um bloco so, de -R a +R.
  let expected = 0;
  for (const L of body.layers) {
    expected += L.shell >= L.radius ? 2 * L.radius + 1 : 2 * (L.shell + 1);
  }
  check(`${body.id}: coluna central bate com as camadas`, ys.length === expected,
        `(${ys.length} blocos, esperado ${expected} de ${body.layers.length} camada(s))`);

  // O topo devolvido bate com o topo real da esfera.
  const top = getHeight(body.center.x, body.center.z);
  check(`${body.id}: getHeight = topo da camada externa`,
        top === Math.floor(body.center.y + body.radius),
        `(${top} vs ${body.center.y + body.radius})`);
}

// --- 3. A casca não tem buraco ----------------------------------------------
// Para uma amostra de colunas dentro do raio, toda coluna que cruza a esfera
// precisa ter pelo menos 1 bloco - senão daria pra "vazar" pra dentro.
for (const body of BODIES) {
  const dim = mockDim();
  let emptyColumns = 0, testedColumns = 0;
  const R = body.radius;
  const step = Math.max(1, Math.floor(R / 22));
  for (let dx = -R; dx <= R; dx += step) {
    for (let dz = -R; dz <= R; dz += step) {
      if (dx * dx + dz * dz > (R - 0.5) * (R - 0.5)) continue;
      testedColumns++;
      const before = dim.blocks.size;
      generateColumn(dim, body.center.x + dx, body.center.z + dz);
      if (dim.blocks.size === before) emptyColumns++;
    }
  }
  check(`${body.id}: nenhuma coluna interna vazia`, emptyColumns === 0,
        `(${testedColumns} colunas testadas, ${emptyColumns} vazias)`);
}

// --- 4. Espessura radial mínima (não dá pra atravessar a casca) --------------
// Anda um raio do centro pra fora e conta blocos sólidos atravessados.
for (const body of BODIES) {
  const dim = mockDim();
  const R = body.radius;
  // Gera um bloco de colunas ao redor de uma direção diagonal.
  const dirs = [[1,0],[0,1],[1,1],[-1,2],[3,1]];
  let worst = Infinity;
  for (const [ux, uz] of dirs) {
    const len = Math.hypot(ux, uz);
    const nx = ux / len, nz = uz / len;
    // Coluna na superfície nessa direção, à meia altura.
    const cx = Math.round(body.center.x + nx * R * 0.5);
    const cz = Math.round(body.center.z + nz * R * 0.5);
    generateColumn(dim, cx, cz);
    const ys = [...dim.blocks.keys()]
      .filter(k => { const [x,,z] = k.split(',').map(Number); return x === cx && z === cz; })
      .map(k => Number(k.split(',')[1])).sort((a,b) => a-b);
    if (!ys.length) { worst = 0; break; }
    // Conta o maior trecho contínuo.
    let run = 1, best = 1;
    for (let i = 1; i < ys.length; i++) {
      run = ys[i] === ys[i-1] + 1 ? run + 1 : 1;
      if (run > best) best = run;
    }
    worst = Math.min(worst, best);
  }
  check(`${body.id}: casca externa contínua de >= 3 blocos`, worst >= 3, `(menor trecho: ${worst})`);
}

// --- 5. Paletas: so blocos proprios do addon --------------------------------
// A lista vem de tools/make_blocks.py; validate.py confere que cada um desses
// tem JSON no BP, entrada no blocks.json do RP, terrain_texture e textura.
{
  const OWN_BLOCKS = new Set([
    // O Sol tem seis tons de superficie, nao tres: e com eles que o disco dele
    // faz o degrade do branco ao vermelho, trocando de bloco.
    'space_dim:sun_edge','space_dim:sun_corona','space_dim:sun_ember',
    'space_dim:sun_plasma','space_dim:sun_flare','space_dim:sun_core',
    'space_dim:earth_ocean','space_dim:earth_shallow','space_dim:earth_land',
    'space_dim:earth_forest','space_dim:earth_ice',
    'space_dim:moon_regolith_light','space_dim:moon_regolith','space_dim:moon_regolith_dark',
    'space_dim:mars_dust','space_dim:mars_rock','space_dim:mars_rock_dark','space_dim:mars_ice',
  ]);
  const used = new Set();
  for (const body of BODIES) {
    const dim = mockDim();
    const R = body.radius;
    const step = Math.max(1, Math.floor(R / 14));
    for (let dx = -R; dx <= R; dx += step)
      for (let dz = -R; dz <= R; dz += step)
        generateColumn(dim, body.center.x + dx, body.center.z + dz);
    for (const v of dim.blocks.values()) used.add(v);
  }
  const bad = [...used].filter(b => !OWN_BLOCKS.has(b));
  check('todas as paletas usam blocos proprios do addon', bad.length === 0, bad.join(', '));
  const unused = [...OWN_BLOCKS].filter(b => !used.has(b));
  check('nenhum bloco proprio ficou sem uso', unused.length === 0, unused.join(', '));
  console.log('      blocos usados:', [...used].sort().join(', '));
}

// --- 6. Variedade: cada corpo mostra mais de uma cor -------------------------
for (const body of BODIES) {
  const dim = mockDim();
  const R = body.radius;
  const step = Math.max(1, Math.floor(R / 16));
  for (let dx = -R; dx <= R; dx += step)
    for (let dz = -R; dz <= R; dz += step)
      generateColumn(dim, body.center.x + dx, body.center.z + dz);
  const distinct = new Set(dim.blocks.values());
  // O Sol tem um bloco por camada (coroa/plasma/nucleo), nao variacao dentro
  // da mesma casca; os planetas variam a superficie por ruido.
  const min = body.id === 'sun' ? body.layers.length : 3;
  check(`${body.id}: superfície variada`, distinct.size >= min,
        `(${distinct.size} blocos distintos, mínimo ${min})`);
}

// --- 6b. Proporcao dos blocos na superficie ---------------------------------
// As proporcoes sao o que faz cada corpo LER como ele mesmo: Terra com ~70%
// de agua, Lua clara com mares escuros minoritarios, Marte de poeira com
// afloramentos de rocha. Uma mudanca de limiar que zere uma faixa passa
// despercebida sem isto — foi o que aconteceu com earth_forest (1.5%).
{
  const share = (body) => {
    const counts = new Map();
    let total = 0;
    const R = body.radius;
    for (let dx = -R; dx <= R; dx++)
      for (let dz = -R; dz <= R; dz++) {
        const dim = mockDim();
        generateColumn(dim, body.center.x + dx, body.center.z + dz);
        for (const id of dim.blocks.values()) {
          counts.set(id, (counts.get(id) || 0) + 1);
          total++;
        }
      }
    const out = new Map();
    for (const [id, n] of counts) out.set(id, 100 * n / total);
    return out;
  };

  const expectations = {
    earth: [
      ['space_dim:earth_ocean', 45, 65],
      ['space_dim:earth_shallow', 8, 22],
      ['space_dim:earth_land', 10, 25],
      ['space_dim:earth_forest', 4, 16],
      ['space_dim:earth_ice', 1, 6],
    ],
    moon: [
      ['space_dim:moon_regolith_light', 30, 60],
      ['space_dim:moon_regolith', 30, 55],
      ['space_dim:moon_regolith_dark', 5, 25],
    ],
    mars: [
      ['space_dim:mars_dust', 45, 70],
      ['space_dim:mars_rock', 20, 45],
      ['space_dim:mars_rock_dark', 2, 15],
      ['space_dim:mars_ice', 0.5, 5],
    ],
  };

  for (const [bodyId, rows] of Object.entries(expectations)) {
    const body = BODIES.find(b => b.id === bodyId);
    const pct = share(body);
    for (const [id, lo, hi] of rows) {
      const v = pct.get(id) ?? 0;
      check(`${bodyId}: ${id.replace('space_dim:', '')} entre ${lo}% e ${hi}%`,
            v >= lo && v <= hi, `(${v.toFixed(1)}%)`);
    }
  }
}

// --- 7. Corpos não se sobrepõem ---------------------------------------------
for (let i = 0; i < BODIES.length; i++)
  for (let j = i + 1; j < BODIES.length; j++) {
    const a = BODIES[i], b = BODIES[j];
    const d = Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y, a.center.z - b.center.z);
    check(`${a.id} e ${b.id} não se tocam`, d > a.radius + b.radius + 16,
          `(distância ${Math.round(d)}, soma dos raios ${a.radius + b.radius})`);
  }

// --- 8. Cabem nos limites verticais da dimensão -----------------------------
for (const body of BODIES) {
  const lo = body.center.y - body.radius, hi = body.center.y + body.radius;
  check(`${body.id} cabe em [-64, 320]`, lo > -64 && hi < 320, `(${lo}..${hi})`);
}

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
