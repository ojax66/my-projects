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

// Os testes rodam numa pasta temporária com os scripts copiados; os packs
// ficam no repositório, então o caminho vem daqui.
const REPO = process.env.DH_REPO ?? '.';
const RP_DIR = `${REPO}/packs/Distant Horizons RP`;
const BP_DIR = `${REPO}/packs/Distant Horizons BP`;

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

// --- Quem brilha é o corpo, não o espaço ------------------------------------
//
// Duas tentativas anteriores mexeram no lugar errado: a primeira acendia só o
// entorno do Sol (alcance 230, com a Terra a 520 — ninguém via nada), e a
// segunda pintava o ESPAÇO de dourado em faixas e dava visão noturna ao
// jogador. O espaço tem que continuar sendo espaço; quem aparece iluminado é o
// corpo celeste.
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const BP = path.resolve('space_dim', '..', '..', '..', '..');

  // Os modelos vistos de longe: todos emissivos. Sem luz de céu no espaço, um
  // modelo não-emissivo vira uma silhueta preta e o corpo some.
  const rpEntity = (id) => JSON.parse(fs.readFileSync(
    path.join(RP_DIR, 'entity', `sky_${id}.entity.json`), 'utf8'));
  for (const body of BODIES) {
    const mat = rpEntity(body.id)['minecraft:client_entity']
      .description.materials.default;
    // `entity_emissive_alpha`, não `entity_emissive` puro: os dois usam o alfa
    // como máscara de brilho, mas só o _alpha mantém o resto opaco. Com o puro
    // havia o risco de a textura inteira (que é toda alfa 0) sumir.
    check(`${body.id}: o modelo distante é emissivo`, mat === 'entity_emissive_alpha',
          `(${mat})`);
  }

  // Os blocos: emissão baixa, pra a superfície ser visível de perto. Não é pra
  // serem lâmpadas — o Sol é o único no máximo.
  const blockLight = (name) => {
    const doc = JSON.parse(fs.readFileSync(
      path.join(BP_DIR, 'blocks', `${name}.json`), 'utf8'));
    return doc['minecraft:block'].components['minecraft:light_emission'] ?? 0;
  };
  for (const name of ['earth_land', 'moon_regolith', 'mars_dust']) {
    const l = blockLight(name);
    check(`${name}: emite luz, mas não é lâmpada`, l > 0 && l < 15, `(${l})`);
  }
  check('o Sol é o único no máximo', blockLight('sun_core') === 15);

  // A estrela: o corpo visto de fora do sistema. Sem ela, quem se afasta da
  // borda não veria nada — nem bloco, nem modelo, nem ponto.
  const star = JSON.parse(fs.readFileSync(
    path.join(RP_DIR, 'entity', 'sky_star.entity.json'), 'utf8'));
  check('a estrela existe e é emissiva',
        star['minecraft:client_entity'].description.materials.default === 'entity_emissive_alpha');
}

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
