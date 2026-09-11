/* O Sol: camadas atravessáveis e campo de calor.
 *
 * O que precisa valer: dá pra chegar perto e admirar sem morrer, aproximar dói
 * cada vez mais, e entrar é quase impossível — "quase" porque resistência a
 * fogo é o caminho. E as camadas têm que ser casca-vácuo-casca-vácuo-núcleo,
 * senão não há o que atravessar.
 */
import { world, system, __reset, __advance } from '@minecraft/server';
import { columnRuns, builtRadius } from './space_dim/bodies.js';
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
  // O que importa aqui é a ESTRUTURA: cinco trechos de bloco na coluna, que são
  // as duas travessias de cada uma das duas cascas mais o núcleo no meio.
  //
  // Não dá pra checar isto pelo id do bloco: a coroa é pintada com o tom claro
  // no miolo da face, por causa do degradê do disco solar, então bem no eixo
  // central ela aparece como `sun_core`. Quem confere as três COREs é o teste
  // do degradê, mais abaixo, que olha a face inteira.
  // Tres trechos: as duas travessias da casca do plasma mais o nucleo no meio.
  // Eram cinco quando a coroa tambem era construida; ela virou `modelOnly` e
  // nao vira bloco nenhum.
  const construidas = sun.layers.filter((L) => !L.modelOnly);
  check('a coluna central atravessa as camadas construídas',
        runs.length === 2 * construidas.length - 1,
        `(${runs.length} trechos, ${construidas.length} camadas construídas)`);
  const meio = runs[Math.floor(runs.length / 2)];
  const nucleo = construidas[construidas.length - 1];
  check('  com o núcleo maciço no meio',
        meio && meio.y1 - meio.y0 + 1 >= nucleo.radius * 2,
        meio ? `(${meio.y1 - meio.y0 + 1} blocos)` : '(nenhum)');

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

// --- O disco do Sol tem variação visível ------------------------------------
//
// Branco no miolo da face, passando por amarelo e laranja até o vermelho da
// borda. São SEIS blocos: com três a passagem saía em faixas duras, e o que se
// quer é um degradê.
//
// A variação é feita trocando de BLOCO, não pintada dentro de uma textura — é a
// mesma regra dos mares da Lua, e pelo mesmo motivo: tom escuro dentro de uma
// textura vira um carimbo repetido em cada bloco.
{
  const sun = BODIES.find((b) => b.id === 'sun');
  // A casca CONSTRUIDA: a coroa e `modelOnly` e nao tem bloco nenhum. O degrade
  // ficou com a camada do plasma, que passou a ser a que se ve chegando perto.
  const R = builtRadius(sun);
  const blockAt = (dx, dy, dz) => {
    const runs = columnRuns(sun.center.x + dx, sun.center.z + dz);
    const y = sun.center.y + dy;
    for (const r of runs) if (y >= r.y0 && y <= r.y1) return r.id;
    return null;
  };

  // A rampa, do miolo da face pra borda.
  // `sun_blaze` e não `sun_core`: a casca externa tem que ser atravessável, e o
  // core é o chão maciço do meio do Sol.
  const RAMPA = ['sun_blaze', 'sun_flare', 'sun_plasma', 'sun_ember',
                 'sun_corona', 'sun_edge'];

  // Andando do centro da face pra quina, a ordem dos tons não pode voltar
  // atrás: é isso que faz um degradê em vez de uma manchа.
  const vistos = [];
  for (let i = 0; i <= 40; i++) {
    const off = Math.round((i / 40) * R * 0.99);
    const id = blockAt(off, 0, R);
    if (!id) continue;
    const nome = id.replace('space_dim:', '');
    if (vistos[vistos.length - 1] !== nome) vistos.push(nome);
  }
  const indices = vistos.map((n) => RAMPA.indexOf(n));
  check('do miolo da face pra borda o Sol percorre a rampa',
        indices.every((v, i) => v >= 0 && (i === 0 || v >= indices[i - 1])),
        `(${vistos.join(' → ')})`);
  check('  começando no tom mais claro', vistos[0] === 'sun_blaze', `(${vistos[0]})`);
  check('  e terminando no mais escuro',
        vistos[vistos.length - 1] === 'sun_edge', `(${vistos[vistos.length - 1]})`);

  // Os seis aparecem de verdade: um tom que ocupa 1% não faz degradê nenhum.
  const conta = {};
  for (let dx = -R; dx <= R; dx += 3) {
    for (let dy = -R; dy <= R; dy += 3) {
      const id = blockAt(dx, dy, R);
      if (id) conta[id] = (conta[id] || 0) + 1;
    }
  }
  const total = Object.values(conta).reduce((a, b) => a + b, 0);
  for (const nome of RAMPA) {
    const pct = 100 * (conta['space_dim:' + nome] || 0) / total;
    check(`  ${nome} ocupa uma fatia visível`, pct >= 4, `(${pct.toFixed(0)}%)`);
  }

  // A variação vale pra TODAS as faces: senão o Sol teria um lado bonito e
  // cinco chapados.
  const faces = [[0, 0, -R], [R, 0, 0], [-R, 0, 0], [0, R, 0], [0, -R, 0]];
  for (const [dx, dy, dz] of faces) {
    check(`  o miolo de (${dx},${dy},${dz}) também é claro`,
          blockAt(dx, dy, dz) === 'space_dim:sun_blaze', `(${blockAt(dx, dy, dz)})`);
  }
}

// --- A casca externa do Sol é atravessável de ponta a ponta ------------------
//
// O degradê pintava o miolo de cada face com `sun_core`, que é o chão maciço do
// núcleo: dava pra encostar no Sol, não pra entrar. E nada apontava pra isso —
// o bloco existe, tem textura, tem nome, e o config diz que a camada é
// atravessável.
{
  const sun = BODIES.find((b) => b.id === 'sun');
  const R = builtRadius(sun);
  const SOLIDOS = new Set(['space_dim:sun_core']);
  const blockAt2 = (dx, dy, dz) => {
    const runs = columnRuns(sun.center.x + dx, sun.center.z + dz);
    const y = sun.center.y + dy;
    for (const r of runs) if (y >= r.y0 && y <= r.y1) return r.id;
    return null;
  };

  const presos = [];
  for (let dx = -R; dx <= R; dx += 5) {
    for (let dy = -R; dy <= R; dy += 5) {
      const id = blockAt2(dx, dy, R);
      if (id && SOLIDOS.has(id)) presos.push(`${dx},${dy}`);
    }
  }
  check('nenhum bloco sólido na casca externa do Sol', presos.length === 0,
        `(${presos.length} pontos: ${presos.slice(0, 4).join(' ')}${presos.length > 4 ? '…' : ''})`);

  // E o núcleo continua sólido, senão não há onde pousar lá dentro.
  check('o núcleo continua sendo chão', blockAt2(0, 0, 0) === 'space_dim:sun_core',
        `(${blockAt2(0, 0, 0)})`);
}

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
