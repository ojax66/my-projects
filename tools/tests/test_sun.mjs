/* O Sol: camadas atravessáveis e campo de calor.
 *
 * O que precisa valer: dá pra chegar perto e admirar sem morrer, aproximar dói
 * cada vez mais, e entrar é quase impossível — "quase" porque resistência a
 * fogo é o caminho. E as camadas têm que ser casca-vácuo-casca-vácuo-núcleo,
 * senão não há o que atravessar.
 */
import { world, system, __reset, __advance } from '@minecraft/server';
import { columnRuns } from './space_dim/bodies.js';
import { BODIES } from './space_dim/config.js';
import { applySunHeat, heatLevelAt } from './space_dim/hazards.js';

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

const sun = BODIES.find(b => b.id === 'sun');
const R = sun.radius;

// --- 1. Estrutura em camadas ------------------------------------------------
{
  // Coluna passando pelo centro: de cima pra baixo tem que alternar
  // casca / vácuo / casca / vácuo / núcleo / vácuo / casca / vácuo / casca.
  const runs = columnRuns(sun.center.x, sun.center.z).sort((a, b) => a.y0 - b.y0);
  const blocks = runs.map(r => `${r.id.replace('space_dim:', '')}(${r.y0}..${r.y1})`);
  console.log('      coluna central:', blocks.join(' '));

  const kinds = runs.map(r => r.id);
  check('a coluna central atravessa coroa, plasma e núcleo',
        kinds.includes('space_dim:sun_corona') &&
        kinds.includes('space_dim:sun_plasma') &&
        kinds.includes('space_dim:sun_core'));

  // Tem que haver VÁCUO entre as camadas, senão não é atravessável — é maciço.
  let gaps = 0;
  for (let i = 1; i < runs.length; i++) {
    if (runs[i].y0 > runs[i - 1].y1 + 1) gaps++;
  }
  check('há vácuo entre as camadas (dá pra voar por dentro)', gaps >= 2,
        `(${gaps} vãos)`);
}

// --- 2. O campo de calor cresce ao se aproximar -----------------------------
{
  const at = (d) => heatLevelAt({ x: sun.center.x + d, y: sun.center.y, z: sun.center.z });
  const outer = R + sun.heat.zone;

  check('longe do Sol não há calor', at(outer + 40) === 0, `(${at(outer + 40)})`);
  check('na borda do campo o calor começa do zero', at(outer) <= 0.02, `(${at(outer).toFixed(2)})`);
  check('na metade do campo o calor é intermediário',
        at(R + sun.heat.zone / 2) > 0.4 && at(R + sun.heat.zone / 2) < 0.6,
        `(${at(R + sun.heat.zone / 2).toFixed(2)})`);
  check('encostando na superfície o calor é máximo do campo', Math.abs(at(R) - 1) < 0.02,
        `(${at(R).toFixed(2)})`);
  check('dentro do Sol passa de 1', at(R / 2) > 1.4, `(${at(R / 2).toFixed(2)})`);
  check('no centro chega a 2', Math.abs(at(0) - 2) < 0.02, `(${at(0).toFixed(2)})`);

  // Monotônico: nunca esfria ao chegar mais perto.
  let monotonic = true;
  let prev = -1;
  for (let d = outer; d >= 0; d -= 5) {
    const v = at(d);
    if (v < prev - 1e-9) monotonic = false;
    prev = v;
  }
  check('o calor nunca diminui ao se aproximar', monotonic);
}

// --- 3. Quem chega perto pega fogo, quem está longe não ---------------------
{
  __reset();
  const dim = world.getDimension('space_dim:outer_space');

  const makeAt = (d) => {
    const p = world.__addPlayer({
      id: 'p' + d, dimensionId: 'space_dim:outer_space',
      location: { x: sun.center.x + d, y: sun.center.y, z: sun.center.z },
    });
    p.__fire = 0;
    p.setOnFire = (s) => { p.__fire = Math.max(p.__fire, s); return true; };
    p.__damage = 0;
    p.applyDamage = (n) => { p.__damage += n; return true; };
    return p;
  };

  const far = makeAt(R + sun.heat.zone + 50);
  const edge = makeAt(R + sun.heat.zone - 5);
  const close = makeAt(R + 10);
  const inside = makeAt(R / 2);

  // Um segundo de exposição.
  for (let t = 0; t < 20; t++) {
    system.currentTick = t;
    for (const p of [far, edge, close, inside]) applySunHeat(p);
  }

  check('longe do Sol não pega fogo', far.__fire === 0);
  check('na borda do campo já pega fogo', edge.__fire > 0, `(${edge.__fire}s)`);
  check('perto da superfície pega MAIS fogo que na borda',
        close.__fire > edge.__fire, `(${close.__fire}s vs ${edge.__fire}s)`);
  check('só dentro do Sol há dano direto',
        inside.__damage > 0 && close.__damage === 0 && edge.__damage === 0,
        `(dentro ${inside.__damage}, perto ${close.__damage}, borda ${edge.__damage})`);
}

// --- 4. Resistência a fogo é o caminho pra entrar --------------------------
{
  __reset();
  const p = world.__addPlayer({
    id: 'fireproof', dimensionId: 'space_dim:outer_space',
    location: { x: sun.center.x, y: sun.center.y, z: sun.center.z },
  });
  p.__fire = 0; p.__damage = 0;
  p.setOnFire = (s) => { p.__fire += s; return true; };
  p.applyDamage = (n) => { p.__damage += n; return true; };
  p.getEffect = (id) => (id === 'fire_resistance' ? { amplifier: 0 } : undefined);

  for (let t = 0; t < 40; t++) { system.currentTick = t; applySunHeat(p); }
  check('com resistência a fogo dá pra ficar no núcleo',
        p.__fire === 0 && p.__damage === 0, `(fogo ${p.__fire}, dano ${p.__damage})`);
}

// --- 5. Criativo não é castigado -------------------------------------------
{
  __reset();
  const p = world.__addPlayer({
    id: 'creative', dimensionId: 'space_dim:outer_space',
    location: { x: sun.center.x, y: sun.center.y, z: sun.center.z },
  });
  p.__fire = 0; p.__damage = 0;
  p.setOnFire = (s) => { p.__fire += s; return true; };
  p.applyDamage = (n) => { p.__damage += n; return true; };
  p.getGameMode = () => 'Creative';

  for (let t = 0; t < 40; t++) { system.currentTick = t; applySunHeat(p); }
  check('no criativo o Sol não queima', p.__fire === 0 && p.__damage === 0);
}

// --- 6. O campo cobre folgado a distância de chegada dos planetas ----------
{
  // Nenhum ponto de chegada pode cair dentro do campo de calor do Sol, senão
  // o jogador aparece pegando fogo.
  for (const body of BODIES) {
    if (!body.arrival) continue;
    const h = heatLevelAt(body.arrival);
    check(`chegada de ${body.id} está fora do calor do Sol`, h === 0, `(calor ${h})`);
  }
}

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
