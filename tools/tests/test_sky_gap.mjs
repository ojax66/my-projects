/* Nunca pode haver uma distância em que o corpo não apareça de jeito nenhum.
 *
 * O jogador vê um corpo de duas formas: os BLOCOS, que só existem perto (o
 * gerador constrói dentro de GEN_RADIUS_CHUNKS), e o MODELO, que aparece de
 * longe. Entre as duas não pode sobrar buraco.
 *
 * Sobrava. O modelo sumia comparando a distância até o CENTRO com um número
 * fixo, então o ponto de troca dependia do tamanho do corpo: com 190, o modelo
 * da Lua sumia com a casca ainda a 178 blocos, e os blocos dela só começam a
 * existir a 80. Quase cem blocos em que a Lua não estava em lugar nenhum.
 */
import { BODIES, GEN_RADIUS_CHUNKS, SKY_MODEL_HIDE_BELOW, SKY_MODEL_DISTANCE,
         SKY_MODEL_MIN_SCALE, SKY_MODEL_MAX_SCALE } from './space_dim/config.js';

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

// Até onde o gerador garante blocos construídos, a partir do jogador.
const GERADO = GEN_RADIUS_CHUNKS * 16;

check(`o modelo só sai dentro do alcance do gerador (${GERADO} blocos)`,
      SKY_MODEL_HIDE_BELOW < GERADO,
      `(sai a ${SKY_MODEL_HIDE_BELOW} da casca)`);

check('  com folga de pelo menos uma chunk',
      GERADO - SKY_MODEL_HIDE_BELOW >= 16,
      `(folga de ${GERADO - SKY_MODEL_HIDE_BELOW} blocos)`);

// A troca acontece na mesma distância DA CASCA pra todo corpo — grande ou
// pequeno. É isso que medir do centro quebrava.
for (const body of BODIES) {
  const centroNaTroca = SKY_MODEL_HIDE_BELOW + body.radius;
  check(`${body.id}: a casca troca sempre a ${SKY_MODEL_HIDE_BELOW} blocos`,
        centroNaTroca - body.radius === SKY_MODEL_HIDE_BELOW,
        `(centro a ${centroNaTroca}, raio ${body.radius})`);
}

// O modelo tem que caber na faixa de escala declarada nas entidades em toda a
// distância em que ele é usado: do ponto de troca até o outro lado do sistema.
const LONGE = 4000;
for (const body of BODIES) {
  const perto = SKY_MODEL_HIDE_BELOW + body.radius;          // mais próximo em que aparece
  const escalaPerto = (SKY_MODEL_DISTANCE * body.radius) / (perto * 8);
  const escalaLonge = (SKY_MODEL_DISTANCE * body.radius) / (LONGE * 8);
  check(`${body.id}: a escala cabe na faixa declarada`,
        escalaPerto <= SKY_MODEL_MAX_SCALE && escalaLonge >= SKY_MODEL_MIN_SCALE,
        `(${escalaLonge.toFixed(3)} a ${escalaPerto.toFixed(2)}, faixa ${SKY_MODEL_MIN_SCALE}–${SKY_MODEL_MAX_SCALE})`);
}

// O modelo fica a SKY_MODEL_DISTANCE do jogador; ele não pode nascer dentro da
// cabeça dele nem tão longe que saia de cena.
check('a distância do modelo é confortável', SKY_MODEL_DISTANCE >= 16 && SKY_MODEL_DISTANCE <= 64,
      `(${SKY_MODEL_DISTANCE} blocos)`);

// --- A luz do Sol tem que alcançar o sistema inteiro -------------------------
//
// A primeira versão acendia só o entorno do Sol: alcance 230, com a Terra a 520
// e Marte a 1040. Na prática o jogador passava a vida fora da faixa e nunca via
// luz nenhuma — "o sol não está iluminando" era literalmente verdade.
{
  const { sunLightTier } = await import('./space_dim/hazards.js');
  const sun = BODIES.find((b) => b.id === 'sun');

  for (const body of BODIES) {
    const tier = sunLightTier(body.center);
    check(`${body.id} está dentro da luz do Sol`, tier !== 'deep',
          `(faixa: ${tier})`);
  }

  // Encostado no Sol é a faixa mais forte, e ela não pode vazar pro sistema
  // todo — senão não haveria diferença nenhuma entre chegar perto e não chegar.
  check('encostado no Sol a faixa é a mais forte',
        sunLightTier({ x: sun.center.x, y: sun.center.y, z: sun.center.z }) === 'blaze');
  const terra = BODIES.find((b) => b.id === 'earth');
  check('  e na Terra já não é', sunLightTier(terra.center) === 'sunlit');

  // Fora do sistema volta a ser espaço profundo.
  check('longe do sistema volta o espaço profundo',
        sunLightTier({ x: sun.center.x + 9000, y: 128, z: sun.center.z }) === 'deep');
}

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
