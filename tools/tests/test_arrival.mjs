/* Onde o jogador cai ao chegar no espaço.
 *
 * O bug que isto tranca: as três chegadas ficavam DENTRO do campo de gravidade
 * do próprio corpo de onde o jogador tinha vindo. A Terra, a mais forte das
 * três, o arrastava nos ticks em que ele está parado esperando o OVNI ser
 * recolocado — ele montava no vazio, ou era levado até a superfície e caía de
 * volta no Overworld achando que a nave tinha sumido.
 *
 * O comentário no config dizia "fora do alcance da gravidade dela". Estava a 58
 * do centro, e a borda do campo em 72.
 */
import { world, system, __reset, __advance } from '@minecraft/server';
import {
  BODIES, ARRIVAL_JITTER, ARRIVAL_CLEARANCE, DIMENSION_ID, SPACE_ENTRY_Y,
} from './space_dim/config.js';
import { gravityStrengthAt } from './space_dim/gravity.js';
import { markArrival } from './space_dim/arrival.js';

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// O jitter é sorteado em x e em z, então o pior caso aproxima o ponto do centro
// pela diagonal.
const WORST_JITTER = ARRIVAL_JITTER * Math.SQRT2;

const arriving = BODIES.filter((b) => b.arrival);

// --- 1. A chegada fica fora do campo do próprio corpo -----------------------
for (const body of arriving) {
  const edge = body.radius + body.gravity.reach;
  const d = dist(body.arrival, body.center) - WORST_JITTER;
  check(`chegada de ${body.id} fica fora do campo de gravidade dele`,
        d >= edge + ARRIVAL_CLEARANCE,
        `(${d.toFixed(1)} do centro, campo acaba em ${edge}, folga exigida ${ARRIVAL_CLEARANCE})`);
}

// --- 2. E fora do campo de qualquer outro corpo -----------------------------
for (const body of arriving) {
  for (const other of BODIES) {
    if (other === body || !other.gravity) continue;
    const edge = other.radius + other.gravity.reach;
    const d = dist(body.arrival, other.center) - WORST_JITTER;
    check(`  e fora do campo de ${other.id}`, d >= edge,
          `(${Math.round(d)} do centro de ${other.id}, campo acaba em ${edge})`);
  }
}

// --- 3. Nenhuma gravidade sentida no ponto de chegada -----------------------
for (const body of arriving) {
  const g = gravityStrengthAt(body.arrival);
  check(`  gravidade sentida na chegada de ${body.id} é zero`, g === 0,
        `(${g})`);
}

// --- 4. Durante a carência, corpo nenhum puxa -------------------------------
//
// Segunda linha de defesa: mesmo que uma chegada futura seja mal colocada, o
// jogador não pode ser arrastado enquanto espera o veículo.
{
  __reset();
  // Sem cache-buster nos dois: gravity.js importa './arrival.js' pelo caminho
  // normal, e um buster aqui daria ao teste um módulo DIFERENTE do que ele
  // consulta — a marca de chegada iria pro Map errado e o teste passaria a
  // medir nada.
  const { applyPlayerGravity, applyEntityGravity } = await import('./space_dim/gravity.js');
  const arrival = await import('./space_dim/arrival.js');
  arrival.forgetArrival('p1');

  const earth = BODIES.find((b) => b.id === 'earth');
  // De propósito colado na Terra: bem dentro do campo dela.
  const spot = { x: earth.center.x, y: earth.center.y, z: earth.center.z + earth.radius + 6 };

  const p = world.__addPlayer({ id: 'p1', dimensionId: DIMENSION_ID, location: spot });
  const ufo = world.__spawn(DIMENSION_ID, 'dlb_van:ufo', spot);

  arrival.markArrival(p);
  const dim = world.getDimension(DIMENSION_ID);
  let puxoes = 0;
  for (let i = 0; i < 40; i++) {
    __advance(1);
    if (applyPlayerGravity(p) !== 0) puxoes++;
    if ((p.__knockbacks ?? []).length) puxoes++;
    applyEntityGravity(dim, [p]);
  }
  check('durante a carência a Terra não puxa o jogador', puxoes === 0,
        `(${puxoes} puxões em 40 ticks, colado na superfície)`);
  check('  nem o OVNI parado do lado dele',
        (ufo.__impulses ?? []).length === 0,
        `(${(ufo.__impulses ?? []).length} impulsos)`);

  // Passada a carência, a gravidade volta — senão isto viraria um buraco
  // permanente em vez de uma janela.
  __advance(200);
  const depois = applyPlayerGravity(p) !== 0 || (p.__knockbacks ?? []).length > 0;
  check('  e volta a puxar depois que a carência acaba', depois);
}

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
