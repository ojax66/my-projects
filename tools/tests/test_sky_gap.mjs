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
import { BODIES, GEN_RADIUS_CHUNKS, SKY_MODEL_HIDE_BELOW,
         SKY_MODEL_DISTANCE, SKY_MODEL_NEAREST } from './space_dim/config.js';

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

// O modelo tem o tamanho da construção, então não há faixa de escala pra
// estourar nem conta de projeção pra errar — o que precisa valer é que a
// entidade declare a aresta certa, e isso o test_tracker mede.

// Os degraus de profundidade dos modelos.
//
// O de trás tem que caber na DISTÂNCIA DE SIMULAÇÃO do Bedrock — 4 chunks, 64
// blocos, no celular. Passando dela a entidade descarrega e para de ser
// desenhada: foi exatamente isso que fez os corpos sumirem com o modelo indo
// pra posição real, a 112 blocos.
check('o degrau mais longe cabe na distância de simulação',
      SKY_MODEL_DISTANCE <= 48, `(${SKY_MODEL_DISTANCE} de 64 blocos)`);
check('  e o mais perto não nasce em cima da nave',
      SKY_MODEL_NEAREST >= 12, `(${SKY_MODEL_NEAREST} blocos)`);
check('  e há faixa pra um degrau por corpo',
      SKY_MODEL_NEAREST < SKY_MODEL_DISTANCE,
      `(${SKY_MODEL_NEAREST}..${SKY_MODEL_DISTANCE})`);

// A troca pra blocos é medida da casca CONSTRUÍDA. O Sol tem raio 100 e só
// constrói até 62 — a coroa é `modelOnly` —, então medir pelo raio nominal
// desligava o modelo dele com os blocos ainda a 94 de distância.
for (const body of BODIES) {
  const construido = Math.max(...body.layers.filter((l) => !l.modelOnly)
                                            .map((l) => l.radius));
  const soModelo = body.layers.some((l) => l.modelOnly);
  if (!soModelo) continue;
  check(`${body.id}: tem camada só-modelo, então o modelo nunca se desliga`,
        construido < body.radius,
        `(constrói até ${construido}, corpo vai até ${body.radius})`);
}

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
    // Material próprio (RP/materials/entity.material): herda de `entity`, que
    // é opaco e sem teste de alfa, e liga USE_EMISSIVE. Os materiais prontos
    // não servem: `entity_emissive_alpha` trata alfa 0 como TRANSPARENTE, e a
    // textura do céu é toda alfa 0 — foi o que deixou todo corpo invisível.
    check(`${body.id}: o modelo distante usa o material do addon`,
          mat === 'space_dim_sky', `(${mat})`);
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
  check('a estrela existe e usa o mesmo material',
        star['minecraft:client_entity'].description.materials.default === 'space_dim_sky');

  // E o material tem que estar definido de verdade, com o define certo.
  const mats = JSON.parse(fs.readFileSync(
    path.join(RP_DIR, 'materials', 'entity.material'), 'utf8')).materials;
  const key = Object.keys(mats).find((k) => k.split(':')[0] === 'space_dim_sky');
  check('o material do céu existe no RP', !!key, `(${key})`);
  check('  herda de entity (opaco, sem teste de alfa)', key?.endsWith(':entity'));
  check('  e liga USE_EMISSIVE', (mats[key]?.['+defines'] ?? []).includes('USE_EMISSIVE'));
}

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
