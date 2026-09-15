/* A fila de chunks do gerador.
 *
 * Este arquivo existe por causa de uma foto: a superfície da Lua aparecendo em
 * pedaços salteados, com buracos que só fechavam quando o jogador andava.
 *
 * A causa estava aqui. `drainQueue` tirava a chunk da fila ANTES de tentar
 * gerá-la, e quando `generateColumn` parava no meio por falta de orçamento de
 * blocos a chunk sumia: nem marcada como pronta, nem de volta pra fila. Com
 * chunksPerTick 4 e uma chunk de terreno custando mais de um tick de orçamento,
 * três de cada quatro eram descartadas assim.
 *
 * Os testes abaixo são os três comportamentos que a foto pedia, escritos como
 * afirmação: nada de buraco, uma chunk de cada vez, e as da frente primeiro.
 */
import { world, system, __reset, __tickIntervals } from '@minecraft/server';
import { createTerrainGenerator } from './space_dim/world_generator_API.js';

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

const DIM = 'test:planeta';
const RAIO = 2;                  // 5x5 = 25 chunks
const CUSTO = 40;                // blocos por coluna
const ORCAMENTO = 3000;          // por tick — ~75 colunas, menos de meia chunk

/**
 * Um gerador de terreno de mentira com a MESMA regra de custo do de verdade:
 * um teto de blocos por tick, e uma coluna que não cabe joga o erro de
 * orçamento. Ele anota a ordem em que as colunas foram escritas, que é o que os
 * testes leem.
 */
function fakeTerreno({ falhaSempre = null } = {}) {
  const colunas = [];            // { cx, cz } na ordem em que foram geradas
  const prontas = new Map();     // "cx,cz" -> quantas colunas já saíram
  let tick = -1;
  let gasto = 0;

  const generateColumn = (dim, x, z) => {
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    const k = `${cx},${cz}`;

    if (falhaSempre && k === falhaSempre) {
      const e = new Error('coluna quebrada de propósito');
      throw e;
    }

    // Coluna já escrita numa passada anterior desta chunk: sai de graça, como
    // no gerador de verdade (o cursor de coluna).
    const feitas = prontas.get(k) ?? 0;
    const indice = (((x % 16) + 16) % 16) * 16 + (((z % 16) + 16) % 16);
    if (indice < feitas) return 64;
    if (indice > feitas) { const e = new Error('orçamento'); e.isBudgetExhausted = true; throw e; }

    if (system.currentTick !== tick) { tick = system.currentTick; gasto = 0; }
    if (gasto + CUSTO > ORCAMENTO) {
      const e = new Error('orçamento');
      e.isBudgetExhausted = true;
      throw e;
    }
    gasto += CUSTO;

    prontas.set(k, indice + 1);
    colunas.push({ cx, cz, tick: system.currentTick });
    return 64;
  };

  return { generateColumn, colunas, prontas };
}

function monta(opts = {}) {
  __reset();
  const t = fakeTerreno(opts);
  const gen = createTerrainGenerator({
    dimensionId: DIM,
    generateColumn: t.generateColumn,
    getHeight: () => 64,
    genRadiusChunks: RAIO,
    chunksPerTick: 4,
    registerDimension: false,
    maxChunkAttempts: opts.maxChunkAttempts ?? 600,
    onError: () => { },
  });
  gen.start();
  const p = world.__addPlayer({ id: 'p1', dimensionId: DIM, location: { x: 8, y: 64, z: 8 } });
  return { gen, t, p };
}

const ordemDasChunks = (colunas) => {
  const vistas = [];
  const seen = new Set();
  for (const c of colunas) {
    const k = `${c.cx},${c.cz}`;
    if (seen.has(k)) continue;
    seen.add(k);
    vistas.push(c);
  }
  return vistas;
};

// --- 1. Nenhum buraco, mesmo com o jogador parado ---------------------------
//
// Este é o teste da foto. Antes, as chunks que não coubessem no orçamento eram
// descartadas e só voltavam se o jogador atravessasse outra chunk.
{
  const { t, p } = monta();
  __tickIntervals(600);

  const esperadas = (2 * RAIO + 1) ** 2;
  let completas = 0;
  const faltando = [];
  for (let dx = -RAIO; dx <= RAIO; dx++) {
    for (let dz = -RAIO; dz <= RAIO; dz++) {
      const k = `${dx},${dz}`;
      if ((t.prontas.get(k) ?? 0) === 256) completas++;
      else faltando.push(`${k}(${t.prontas.get(k) ?? 0})`);
    }
  }
  check('com o jogador PARADO, todas as chunks do raio ficam prontas',
        completas === esperadas,
        `(${completas}/${esperadas}${faltando.length ? ', faltou ' + faltando.slice(0, 6).join(' ') : ''})`);
  check('  e nenhuma ficou pela metade', faltando.length === 0);
  void p;
}

// --- 2. Uma chunk de cada vez ------------------------------------------------
//
// "chunk por chunk": quando a primeira coluna de uma chunk nova é escrita,
// todas as chunks começadas antes dela já têm que estar inteiras.
{
  const { t } = monta();
  __tickIntervals(600);

  const comecadas = new Map();
  let violacoes = 0, primeiraViolacao = null;
  for (const c of t.colunas) {
    const k = `${c.cx},${c.cz}`;
    if (!comecadas.has(k)) {
      for (const [outra, n] of comecadas) {
        if (n < 256) {
          violacoes++;
          primeiraViolacao ??= `${k} começou com ${outra} em ${n}/256`;
          break;
        }
      }
      comecadas.set(k, 0);
    }
    comecadas.set(k, comecadas.get(k) + 1);
  }
  check('nenhuma chunk nova começa com outra pela metade', violacoes === 0,
        `(${violacoes}${primeiraViolacao ? ': ' + primeiraViolacao : ''})`);
}

// --- 3. As da frente primeiro, e as de perto antes das de longe --------------
{
  const { t, p } = monta();
  p.__lookAt(1, 0);              // olhando pro +x
  __tickIntervals(600);

  const ordem = ordemDasChunks(t.colunas);
  check('a primeira chunk gerada é a do próprio jogador',
        ordem[0]?.cx === 0 && ordem[0]?.cz === 0,
        `(${ordem[0]?.cx},${ordem[0]?.cz})`);

  // As da frente (+x) têm que sair, em média, bem antes das de trás.
  const posicao = new Map(ordem.map((c, i) => [`${c.cx},${c.cz}`, i]));
  const media = (filtro) => {
    const v = ordem.filter(filtro).map((c) => posicao.get(`${c.cx},${c.cz}`));
    return v.reduce((a, b) => a + b, 0) / v.length;
  };
  const frente = media((c) => c.cx > 0);
  const tras = media((c) => c.cx < 0);
  check('  as chunks do campo de visão saem antes das das costas',
        frente < tras, `(frente ${frente.toFixed(1)} vs costas ${tras.toFixed(1)})`);

  // E olhando pro outro lado, inverte.
  const b = monta();
  b.p.__lookAt(-1, 0);
  __tickIntervals(600);
  const ordemB = ordemDasChunks(b.t.colunas);
  const posB = new Map(ordemB.map((c, i) => [`${c.cx},${c.cz}`, i]));
  const mediaB = (filtro) => {
    const v = ordemB.filter(filtro).map((c) => posB.get(`${c.cx},${c.cz}`));
    return v.reduce((a, x) => a + x, 0) / v.length;
  };
  check('  virando o rosto, a ordem vira junto',
        mediaB((c) => c.cx < 0) < mediaB((c) => c.cx > 0),
        `(-x ${mediaB((c) => c.cx < 0).toFixed(1)} vs +x ${mediaB((c) => c.cx > 0).toFixed(1)})`);
}

// --- 4. Uma chunk quebrada não trava o mundo atrás dela ----------------------
//
// A fila só anda quando a chunk termina — o que é o conserto. O risco que isso
// cria é o oposto: uma chunk que falhe por um motivo que NÃO é o orçamento
// ficaria na frente da fila pra sempre, e o mundo inteiro pararia atrás dela.
{
  const { t } = monta({ falhaSempre: '1,0', maxChunkAttempts: 5 });
  __tickIntervals(600);

  let completas = 0;
  for (let dx = -RAIO; dx <= RAIO; dx++) {
    for (let dz = -RAIO; dz <= RAIO; dz++) {
      if ((t.prontas.get(`${dx},${dz}`) ?? 0) === 256) completas++;
    }
  }
  const esperadas = (2 * RAIO + 1) ** 2 - 1;   // todas menos a quebrada
  check('uma chunk que sempre falha é abandonada, e o resto do mundo sai',
        completas === esperadas, `(${completas}/${esperadas})`);
}

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
