/* A gravidade segue a forma do corpo, e para na superfície.
 *
 * Dois bugs de verdade estão trancados aqui.
 *
 * 1. O jogador ficava PRESO no núcleo do Sol. A gravidade puxava pro centro
 *    sempre, então quem chegava ao núcleo continuava sendo empurrado pra
 *    dentro do bloco maciço e não saía mais.
 * 2. A direção apontava pro centro, que num cubo empurra na diagonal perto das
 *    quinas. Seguindo o eixo dominante, a gravidade fica perpendicular à face —
 *    e cada uma das seis faces vira chão, inclusive a de baixo, onde se anda
 *    de cabeça pra baixo.
 */
import { BODIES } from './space_dim/config.js';
import { gravityAt } from './space_dim/gravity.js';

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

const sun = BODIES.find((b) => b.id === 'sun');
const earth = BODIES.find((b) => b.id === 'earth');
const at = (body, dx, dy, dz) => ({
  x: body.center.x + dx, y: body.center.y + dy, z: body.center.z + dz,
});

// --- 1. Nunca empurra pra dentro do maciço ----------------------------------
{
  const core = sun.layers[sun.layers.length - 1].radius;   // núcleo, 22

  // Bem no centro: o pior caso do bug. Antes, aqui a gravidade apontava pro
  // centro e o jogador não conseguia mais sair.
  const g = gravityAt(at(sun, 0, 0, 0));
  const puxaPraDentro = g && (g.x * 0 + g.y * 0 + g.z * 0) < 0;
  check('no centro do Sol a gravidade não prende o jogador',
        !g || !puxaPraDentro, g ? `(${g.x.toFixed(3)}, ${g.y.toFixed(3)}, ${g.z.toFixed(3)})` : '(nenhuma)');

  // Enfiado dentro do núcleo, fora do centro: tem que ser empurrado pra FORA.
  const dentro = at(sun, 0, 8, 0);
  const gd = gravityAt(dentro);
  check('dentro do núcleo o empurrão é pra fora',
        gd !== null && gd.y > 0, gd ? `(y = ${gd.y.toFixed(4)})` : '(nenhuma)');

  // Pousado na superfície do núcleo: parado.
  const pousado = at(sun, 0, core, 0);
  check('pousado na casca do núcleo, sem puxão', gravityAt(pousado) === null);

  // Logo acima do núcleo, no vácuo do Sol: cai pra baixo, rumo à casca.
  const acima = at(sun, 0, core + 20, 0);
  const ga = gravityAt(acima);
  check('acima do núcleo, cai na direção dele', ga !== null && ga.y < 0,
        ga ? `(y = ${ga.y.toFixed(4)})` : '(nenhuma)');
}

// --- 2. As seis faces são chão ----------------------------------------------
{
  const R = earth.radius;
  const fora = R + 6;
  const casos = [
    ['topo',     [0, fora, 0],  'y', -1],
    ['fundo',    [0, -fora, 0], 'y', +1],   // de cabeça pra baixo
    ['leste',    [fora, 0, 0],  'x', -1],
    ['oeste',    [-fora, 0, 0], 'x', +1],
    ['norte',    [0, 0, -fora], 'z', +1],
    ['sul',      [0, 0, fora],  'z', -1],
  ];
  for (const [nome, [dx, dy, dz], eixo, sentido] of casos) {
    const g = gravityAt(at(earth, dx, dy, dz));
    const ok = g && Math.sign(g[eixo]) === sentido &&
      // e só nesse eixo: perpendicular à face, sem componente de lado
      ['x', 'y', 'z'].every((k) => k === eixo || Math.abs(g[k]) < 1e-9);
    check(`face ${nome}: a gravidade aponta pra ela e só pra ela`, ok,
          g ? `(${g.x.toFixed(4)}, ${g.y.toFixed(4)}, ${g.z.toFixed(4)})` : '(nenhuma)');
  }
}

// --- 3. Pousado na superfície de um planeta, sem puxão -----------------------
{
  const g = gravityAt(at(earth, 0, earth.radius, 0));
  check('pousado na Terra, sem puxão', g === null);
}

// --- 4. Fora do alcance, nada -----------------------------------------------
{
  const longe = earth.radius + earth.gravity.reach + 10;
  check('fora do alcance não há gravidade', gravityAt(at(earth, 0, longe, 0)) === null);
}

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
