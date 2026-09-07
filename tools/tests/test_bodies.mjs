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
  // Faixa inclusiva: de cy-R a cy-(R-shell) sao shell+1 blocos.
  const expectedPerCap = body.shell + 1;
  const ok = ys.length === expectedPerCap * 2;
  check(`${body.id}: coluna central = 2 calotas de ${expectedPerCap}`, ok, `(${ys.length} blocos)`);

  // O topo devolvido bate com o topo real da esfera.
  const top = getHeight(body.center.x, body.center.z);
  check(`${body.id}: getHeight = topo da esfera`, top === body.center.y + body.radius - 1 || top === Math.floor(body.center.y + body.radius),
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
  check(`${body.id}: casca contínua de >= 3 blocos`, worst >= 3, `(menor trecho: ${worst})`);
}

// --- 5. Paletas: so blocos proprios do addon --------------------------------
// A lista vem de tools/make_blocks.py; validate.py confere que cada um desses
// tem JSON no BP, entrada no blocks.json do RP, terrain_texture e textura.
{
  const OWN_BLOCKS = new Set([
    'space_dim:sun_plasma','space_dim:sun_flare','space_dim:sun_spot',
    'space_dim:earth_ocean','space_dim:earth_shallow','space_dim:earth_land',
    'space_dim:earth_desert','space_dim:earth_ice',
    'space_dim:moon_regolith','space_dim:moon_highland','space_dim:moon_mare',
    'space_dim:mars_dust','space_dim:mars_rock','space_dim:mars_ice',
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
  check(`${body.id}: superfície variada`, distinct.size >= 3, `(${distinct.size} blocos distintos)`);
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
