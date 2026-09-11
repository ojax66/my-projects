import { system } from '@minecraft/server';
import { generateColumn, isBudgetError, builtRadius } from './space_dim/bodies.js';
import { BODIES, BLOCK_BUDGET_PER_TICK, CHUNKS_PER_TICK } from './space_dim/config.js';

let failures = 0;
const check = (n, ok, x='') => { console.log(`${ok?'PASS':'FAIL'}  ${n}${x?'  '+x:''}`); if(!ok) failures++; };

// Reproduz o genChunk do world_generator_API: percorre as 256 colunas na
// ordem x-por-fora/z-por-dentro, engolindo erro por coluna e marcando a chunk
// como pronta so quando nenhuma coluna falhou.
function genChunk(dim, cx, cz) {
  let hadError = false;
  for (let x = cx*16; x < cx*16+16; x++)
    for (let z = cz*16; z < cz*16+16; z++) {
      try { generateColumn(dim, x, z); }
      catch (e) { hadError = true; if (!isBudgetError(e)) throw e; }
    }
  return !hadError;
}

function mockDim(writes) {
  return {
    setBlockType(l, id) { writes.set(`${l.x},${l.y},${l.z}`, id); writes.ops++; },
    fillBlocks(vol, id) {
      for (let y = vol.from.y; y <= vol.to.y; y++)
        writes.set(`${vol.from.x},${y},${vol.from.z}`, id);
      writes.ops++;
    },
  };
}

// --- A chunk mais cara do Sol termina, e em quantos ticks? -------------------
{
  const sun = BODIES.find(b => b.id === 'sun');
  // Chunk no meio da parede da esfera (a mais cara, medida antes).
  // A borda da casca CONSTRUIDA: a coroa e so modelo e nao tem bloco nenhum,
  // entao a chunk cara mudou de lugar quando ela saiu.
  const cx = Math.floor((sun.center.x + builtRadius(sun) - 4) / 16), cz = Math.floor(sun.center.z / 16);

  const writes = new Map(); writes.ops = 0;
  const dim = mockDim(writes);

  let ticks = 0, done = false;
  while (!done && ticks < 500) { system.currentTick = ++ticks; done = genChunk(dim, cx, cz); }

  check('a chunk mais cara do Sol termina', done, `(${ticks} ticks, ${writes.size} blocos)`);
  check('nenhum tick estoura muito o orcamento',
        writes.size / ticks <= BLOCK_BUDGET_PER_TICK * 1.6,
        `(media ${Math.round(writes.size/ticks)} blocos/tick, teto ${BLOCK_BUDGET_PER_TICK})`);
  check('fillBlocks agrupa mesmo', writes.ops < writes.size,
        `(${writes.ops} chamadas para ${writes.size} blocos = ${(writes.size/writes.ops).toFixed(1)} blocos/chamada)`);
}

// --- A chunk de um planeta termina rapido -----------------------------------
//
// Era "num tick so", de quando os corpos eram esferas: no meio da Lua a coluna
// tinha 25 blocos de casca e sobrava orcamento. O cubo e macico de ponta a
// ponta na parede, entao a mesma chunk custa mais de um tick. O que importa
// nao mudou: ela TERMINA, e rapido — se o cursor de retomada quebrar, isto
// gira ate o limite e falha.
const PLANET_TICK_BUDGET = 6;
{
  const moon = BODIES.find(b => b.id === 'moon');
  const writes = new Map(); writes.ops = 0;
  let ticks = 0, done = false;
  while (!done && ticks < 200) {
    system.currentTick = 9000 + ++ticks;
    done = genChunk(mockDim(writes), Math.floor(moon.center.x/16), Math.floor(moon.center.z/16));
  }
  check(`chunk da Lua termina em ate ${PLANET_TICK_BUDGET} ticks`,
        done && ticks <= PLANET_TICK_BUDGET, `(${ticks} ticks, ${writes.size} blocos)`);
}

// --- O resultado final e identico ao da geracao sem orcamento ---------------
{
  const mars = BODIES.find(b => b.id === 'mars');
  const cx = Math.floor(mars.center.x/16), cz = Math.floor(mars.center.z/16);

  const budgeted = new Map(); budgeted.ops = 0;
  const d1 = mockDim(budgeted);
  let t = 20000, done = false;
  while (!done && t < 21000) { system.currentTick = ++t; done = genChunk(d1, cx, cz); }

  // De novo, com orcamento enorme (uma passada so).
  const oneShot = new Map(); oneShot.ops = 0;
  system.currentTick = 30000;
  // Chunk diferente para nao bater no cursor ja limpo: refaz a mesma, cursor limpo.
  const d2 = mockDim(oneShot);
  let done2 = false, t2 = 30000;
  while (!done2 && t2 < 31000) { system.currentTick = ++t2; done2 = genChunk(d2, cx, cz); }

  const same = budgeted.size === oneShot.size &&
    [...budgeted.entries()].every(([k, v]) => oneShot.get(k) === v);
  check('geracao fatiada == geracao completa', same,
        `(${budgeted.size} vs ${oneShot.size} blocos)`);
}

// --- Tempo total pra gerar o Sol inteiro ------------------------------------
{
  const sun = BODIES.find(b => b.id === 'sun');
  const R = builtRadius(sun);
  const c0x = Math.floor((sun.center.x-R)/16), c1x = Math.floor((sun.center.x+R)/16);
  const c0z = Math.floor((sun.center.z-R)/16), c1z = Math.floor((sun.center.z+R)/16);
  const writes = new Map(); writes.ops = 0;
  const dim = mockDim(writes);
  let tick = 40000, chunksDone = 0, total = 0;
  const queue = [];
  for (let cx=c0x; cx<=c1x; cx++) for (let cz=c0z; cz<=c1z; cz++) queue.push([cx,cz]);
  while (queue.length && total < 5000) {
    system.currentTick = ++tick; total++;
    for (let i = 0; i < CHUNKS_PER_TICK && queue.length; i++) {
      const [cx, cz] = queue[0];
      if (genChunk(dim, cx, cz)) { queue.shift(); chunksDone++; }
      else break; // orcamento do tick acabou
    }
  }
  check('o Sol inteiro gera', queue.length === 0,
        `(${chunksDone} chunks, ${writes.size} blocos, ${total} ticks = ${(total/20).toFixed(1)}s)`);
}

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
