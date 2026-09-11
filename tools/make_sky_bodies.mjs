/* Corpos celestes vistos de longe.
 *
 * Um corpo feito de blocos some quando passa da distância de renderização, e no
 * espaço quase tudo está sempre além dela: sem isto o jogador flutua no vazio
 * sem nada pra ver nem pra mirar.
 *
 * A solução é a mesma que o Spacecraft usa pra Terra dele: uma ENTIDADE sem
 * colisão, sem gravidade e sem hitbox, mantida por script perto do jogador e
 * encolhida pelo tanto certo pra parecer estar longe. Como ela está sempre a
 * poucos blocos, nunca sai do alcance de renderização.
 *
 * Este script gera, pra cada corpo, tudo o que essa entidade precisa:
 *
 *   BP/entities/sky_<id>.json          a entidade (com a propriedade de tamanho)
 *   RP/entity/sky_<id>.entity.json     o lado do cliente
 *   RP/models/entity/sky_body.geo.json um cubo só, compartilhado
 *   RP/animations/sky_body.animation.json  escala o cubo pela propriedade
 *   RP/render_controllers/...          um só, compartilhado
 *   RP/textures/space_dim/sky/<id>.png a planificação das seis faces
 *
 * A textura NÃO é desenhada à mão: as faces saem do mesmo columnRuns() que
 * constrói o corpo de blocos, com as mesmas cores dos mesmos blocos. O que se
 * vê de longe é o que está lá.
 *
 * Uso: node tools/make_sky_bodies.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const BP = path.join(ROOT, 'packs', 'Distant Horizons BP');
const RP = path.join(ROOT, 'packs', 'Distant Horizons RP');
const NS = 'space_dim';

// Os scripts do addon importam '@minecraft/server'; o stub dos testes serve,
// porque nada aqui usa o motor — só geometria e paleta.
const STAGE = path.join(ROOT, 'tools', '.sky_stage');
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(path.join(STAGE, 'node_modules'), { recursive: true });
fs.cpSync(path.join(BP, 'scripts', 'space_dim'), path.join(STAGE, 'space_dim'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'tests', 'stub', '@minecraft'),
          path.join(STAGE, 'node_modules', '@minecraft'), { recursive: true });
fs.writeFileSync(path.join(STAGE, 'package.json'), '{ "type": "module" }');

const { columnRuns } = await import(url.pathToFileURL(path.join(STAGE, 'space_dim', 'bodies.js')));
const { BODIES } =
  await import(url.pathToFileURL(path.join(STAGE, 'space_dim', 'config.js')));

const COLORS = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tools', 'assets', 'block_colors.json'), 'utf8'));

// --- PNG ---------------------------------------------------------------------
function writePng(file, w, h, px) {
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = y * (1 + w * 4) + 1 + x * 4;
      raw[d] = px[s]; raw[d + 1] = px[s + 1]; raw[d + 2] = px[s + 2]; raw[d + 3] = px[s + 3];
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16),
                      parseInt(hex.slice(5, 7), 16)];

// --- Amostragem das faces ----------------------------------------------------
//
// Uma coluna do corpo pode ter vários trechos (as duas tampas do cubo oco). Pra
// saber a cor de um ponto da casca a gente pega o bloco daquela coluna com o Y
// mais próximo do ponto pedido.
function blockAt(x, y, z) {
  let best = null, bestD = Infinity;
  for (const r of columnRuns(x, z)) {
    for (const yy of [r.y0, r.y1, Math.round(y)]) {
      if (yy < r.y0 || yy > r.y1) continue;
      const d = Math.abs(yy - y);
      if (d < bestD) { bestD = d; best = r.id; }
    }
  }
  return bestD <= 2 ? best : null;
}

// --- O disco do Sol, suave ----------------------------------------------------
//
// O Sol é o único corpo cuja face NÃO é amostrada bloco a bloco.
//
// A construção faz o degradê trocando de bloco, e com seis tons isso é o mais
// perto que se chega com blocos. Mas o modelo visto de longe não tem essa
// limitação: ele é uma textura, e pode ter a passagem contínua da referência —
// branco no miolo, vermelho na borda, sem degrau visível.
//
// As cores são as MESMAS dos seis blocos, interpoladas. Então os dois não
// divergem: é o mesmo degradê, um em blocos e outro em pixels.
const SUN_RAMP = [
  [0.00, '#FFFDF1'],
  [0.30, '#FFFDF1'],
  [0.45, '#FEEC9A'],
  [0.58, '#FFDF64'],
  [0.72, '#FFA123'],
  [0.86, '#F05914'],
  [1.00, '#AA300B'],
];

function sunColorAt(t) {
  const stops = SUN_RAMP.map(([at, hex]) => [at, rgb(hex)]);
  for (let i = 1; i < stops.length; i++) {
    if (t > stops[i][0] && i < stops.length - 1) continue;
    const [a, ca] = stops[i - 1];
    const [b, cb] = stops[i];
    const k = b === a ? 0 : Math.min(1, Math.max(0, (t - a) / (b - a)));
    return [0, 1, 2].map((c) => Math.round(ca[c] + (cb[c] - ca[c]) * k));
  }
  return stops[stops.length - 1][1];
}

/** Distância do MEIO da face, de 0 a 1 — a mesma medida que bodies.js usa. */
function faceOffset(u, v) {
  const a = Math.abs((u + 0.5) / RES * 2 - 1);
  const b = Math.abs((v + 0.5) / RES * 2 - 1);
  return Math.min(1, Math.max(a, b));
}

// A face é amostrada em RES x RES. `pick(u, v)` devolve o ponto do mundo.
// Um pixel por bloco da face, até o teto.
//
// Com 16 px a face da Terra (53 blocos de lado) virava 1 pixel a cada 3,3
// blocos e a do Sol 1 a cada 12,6: os continentes viravam manchas e o corpo
// visto de longe não parecia o mesmo corpo visto de perto. Com 64 a Terra fica
// abaixo de 1 bloco por pixel — o desenho é o mesmo.
//
// O teto existe porque a textura é 4x3 vezes isto: 64 dá 256x192, que é
// barato. Sem teto o Sol pediria 201 e a textura passaria de 800 px de lado.
const RES = 64;
function faceColors(body, pick) {
  const out = [];
  for (let v = 0; v < RES; v++) {
    for (let u = 0; u < RES; u++) {
      const R = body.radius;
      const a = -R + ((u + 0.5) / RES) * 2 * R;
      const b = R - ((v + 0.5) / RES) * 2 * R;
      const p = pick(a, b, R);
      const id = blockAt(Math.round(p.x), Math.round(p.y), Math.round(p.z));
      out.push(id && COLORS[id] ? rgb(COLORS[id]) : null);
    }
  }
  return out;
}

function skyTexture(body) {
  const c = body.center, R = body.radius;

  // O Sol: degradê contínuo, igual em todas as seis faces.
  if (body.heat) {
    const face = [];
    for (let v = 0; v < RES; v++) {
      for (let u = 0; u < RES; u++) face.push(sunColorAt(faceOffset(u, v)));
    }
    const W0 = RES * 4, H0 = RES * 3;
    const px0 = Buffer.alloc(W0 * H0 * 4);
    const put = (ox, oy) => {
      for (let v = 0; v < RES; v++) for (let u = 0; u < RES; u++) {
        const col = face[v * RES + u];
        const d = ((oy + v) * W0 + ox + u) * 4;
        px0[d] = col[0]; px0[d + 1] = col[1]; px0[d + 2] = col[2]; px0[d + 3] = 0;
      }
    };
    put(RES, 0); put(RES * 2, 0); put(0, RES);
    put(RES, RES); put(RES * 2, RES); put(RES * 3, RES);
    const dir0 = path.join(RP, 'textures', NS, 'sky');
    fs.mkdirSync(dir0, { recursive: true });
    writePng(path.join(dir0, `${body.id}.png`), W0, H0, px0);
    return;
  }

  const faces = {
    // ordem do box UV do Bedrock, com w = h = d = 16
    up:    faceColors(body, (a, b) => ({ x: c.x + a, y: c.y + R, z: c.z - b })),
    down:  faceColors(body, (a, b) => ({ x: c.x + a, y: c.y - R, z: c.z + b })),
    east:  faceColors(body, (a, b) => ({ x: c.x - R, y: c.y + b, z: c.z + a })),
    north: faceColors(body, (a, b) => ({ x: c.x + a, y: c.y + b, z: c.z - R })),
    west:  faceColors(body, (a, b) => ({ x: c.x + R, y: c.y + b, z: c.z - a })),
    south: faceColors(body, (a, b) => ({ x: c.x - a, y: c.y + b, z: c.z + R })),
  };

  const W = RES * 4, H = RES * 3;
  const px = Buffer.alloc(W * H * 4);          // tudo transparente por padrão
  const blit = (face, ox, oy) => {
    for (let v = 0; v < RES; v++) for (let u = 0; u < RES; u++) {
      const col = faces[face][v * RES + u];
      if (!col) continue;
      const d = ((oy + v) * W + ox + u) * 4;
      px[d] = col[0]; px[d + 1] = col[1]; px[d + 2] = col[2];
      // Alfa 0 = BRILHO MÁXIMO no material `space_dim_sky` (USE_EMISSIVE), e o
      // pixel continua opaco porque o material herda de `entity`.
      //
      // Efeito colateral que confunde: aberta num visualizador de imagens, a
      // textura parece vazia — o visualizador lê o alfa como transparência,
      // que é o significado normal dele. No jogo, com este material, não é.
      px[d + 3] = 0;
    }
  };
  blit('up', RES, 0);
  blit('down', RES * 2, 0);
  blit('east', 0, RES);
  blit('north', RES, RES);
  blit('west', RES * 2, RES);
  blit('south', RES * 3, RES);

  const dir = path.join(RP, 'textures', NS, 'sky');
  fs.mkdirSync(dir, { recursive: true });
  writePng(path.join(dir, `${body.id}.png`), W, H, px);
}

// --- JSONs -------------------------------------------------------------------
const write = (p, o) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n');
};

// --- O tamanho do modelo -----------------------------------------------------
//
// O modelo tem o TAMANHO DA CONSTRUÇÃO e fica no CENTRO dela. Não é mais uma
// projeção presa ao jogador.
//
// A versão anterior mantinha o modelo a 34 blocos de quem olha e o encolhia até
// dar o mesmo ângulo do corpo lá longe. Duas coisas davam errado nisso: a conta
// tratava o cubo do geometry como tendo meia-aresta de 8 BLOCOS, quando ela é
// de 8 unidades, ou seja meio bloco — dezesseis vezes menor —, e mesmo com a
// conta certa o modelo andava junto com o jogador enquanto a construção ficava
// parada, então os dois nunca casavam na transição.
//
// Com tamanho e posição reais não há conta nenhuma pra errar: o modelo ocupa
// exatamente o mesmo espaço que os blocos, e chegar perto só troca um pelo
// outro no mesmo lugar.
//
// O cubo do geometry tem 16 unidades de aresta, que é UM bloco. Então a escala
// é o número de blocos da aresta do corpo: 2*raio + 1.
// A escala do modelo, em degraus.
//
// O modelo fica preso ao jogador a SKY_MODEL_DISTANCE e é escalado pra dar o
// mesmo ângulo que o corpo daria lá longe:
//
//     escala = 2 × SKY_MODEL_DISTANCE × raio / distância
//
// (o cubo do geometry tem 16 unidades de aresta, que é um bloco: meia-aresta
// 0,5 — e não 8, que foi o erro de dezesseis vezes da versão anterior.)
//
// Como a distância varia continuamente, a escala também varia; e como
// `minecraft:scale` é fixo por component group, ela é discreta. Razão 1,25
// entre degraus: a diferença não se percebe num corpo distante.
//
// A faixa: o Sol (raio 100) visto do ponto de troca (156 do centro) pede
// 2×34×100/156 ≈ 43; a Lua (raio 12) vista da borda do sistema pede
// 2×34×12/1500 ≈ 0,54. Com folga nas duas pontas.
const SIZE_RATIO = 1.25;
const SIZE_MIN = 0.05;
const SIZE_MAX = 120;
const SIZE_STEPS = [];
for (let v = SIZE_MIN; v <= SIZE_MAX; v *= SIZE_RATIO) {
  SIZE_STEPS.push(Number(v.toPrecision(4)));
}

function sizeGroups() {
  const groups = {};
  const events = {};
  const all = SIZE_STEPS.map((_, j) => `${NS}:size_${j}`);
  SIZE_STEPS.forEach((value, i) => {
    groups[`${NS}:size_${i}`] = { 'minecraft:scale': { value } };
    events[`${NS}:set_size_${i}`] = {
      add: { component_groups: [`${NS}:size_${i}`] },
      remove: { component_groups: all.filter((g) => g !== `${NS}:size_${i}`) },
    };
  });
  return { groups, events };
}

// A estrela é outra coisa: não é o corpo, é o ponto de luz que sobra dele visto
// de muito longe. Essa continua presa ao jogador, pequena e fixa.
const STAR_SCALE_FIXED = 0.35;

function bpEntity(body) {
  const { groups, events } = sizeGroups();
  return {
    format_version: '1.21.80',
    'minecraft:entity': {
      description: {
        identifier: `${NS}:sky_${body.id}`,
        is_spawnable: false,
        is_summonable: true,
      },
      components: {
        // Nunca some, nunca colide, nunca é acertado, nunca é empurrado: é
        // cenário, não bicho.
        'minecraft:tick_world': { never_despawn: true, radius: 2 },
        'minecraft:physics': { has_collision: false, has_gravity: false },
        'minecraft:collision_box': { width: 0, height: 0 },
        'minecraft:custom_hit_test': { hitboxes: [{ width: 0, height: 0, pivot: [0, 999, 0] }] },
        'minecraft:damage_sensor': { triggers: [{ cause: 'all', deals_damage: 'no' }] },
        'minecraft:pushable': { is_pushable: false, is_pushable_by_piston: false },
        'minecraft:knockback_resistance': { value: 1000 },
        'minecraft:health': { value: 1, max: 1 },
        'minecraft:fire_immune': true,
        'minecraft:conditional_bandwidth_optimization': {},
        'minecraft:type_family': { family: ['space_dim_sky'] },
      },
      component_groups: groups,
      events,
    },
  };
}

function rpEntity(body) {
  return {
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: `${NS}:sky_${body.id}`,
        // Material próprio, copiado do que o Spacecraft usa pra Terra distante
        // dele (RP/materials/entity.material). Herda de `entity` — que é
        // OPACO, sem teste de alfa — e liga `USE_EMISSIVE`, o define que
        // transforma o canal alfa em máscara de brilho.
        //
        // Foi essa a lição cara: com `entity_emissive_alpha`, alfa 0 quer
        // dizer TRANSPARENTE, e como a textura inteira é alfa 0, todo corpo
        // ficou invisível. Herdando de `entity` nenhum pixel é descartado, e o
        // alfa só decide o brilho.
        materials: { default: 'space_dim_sky' },
        textures: { default: `textures/${NS}/sky/${body.id}` },
        geometry: { default: `geometry.${NS}.sky_body` },
        // Sem animação de escala: ela vem de `minecraft:scale`, no servidor.
        scripts: { should_update_bones_and_effects_offscreen: true },
        render_controllers: [`controller.render.${NS}.sky_body`],
      },
    },
  };
}

const SKY = BODIES.filter((b) => b.center && b.radius);

for (const body of SKY) {
  skyTexture(body);
  write(path.join(BP, 'entities', `sky_${body.id}.json`), bpEntity(body));
  write(path.join(RP, 'entity', `sky_${body.id}.entity.json`), rpEntity(body));
}

// --- A estrela ---------------------------------------------------------------
//
// O terceiro nível. Além da borda do sistema solar o corpo não é mais um mundo
// que dá pra visitar: é um ponto de luz, como qualquer estrela vista da Terra.
// Um cubo branco minúsculo e emissivo serve — a essa distância nada além de um
// pontinho chegaria ao olho de qualquer jeito.
{
  const px = Buffer.alloc(RES * 4 * RES * 3 * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = 0;  // alfa 0 = aceso
  }
  const dir = path.join(RP, 'textures', NS, 'sky');
  fs.mkdirSync(dir, { recursive: true });
  writePng(path.join(dir, 'star.png'), RES * 4, RES * 3, px);

  write(path.join(BP, 'entities', 'sky_star.json'), {
    format_version: '1.21.80',
    'minecraft:entity': {
      description: {
        identifier: `${NS}:sky_star`,
        is_spawnable: false,
        is_summonable: true,
      },
      components: {
        'minecraft:physics': { has_collision: false, has_gravity: false },
        'minecraft:collision_box': { width: 0, height: 0 },
        'minecraft:custom_hit_test': { hitboxes: [{ width: 0, height: 0, pivot: [0, 999, 0] }] },
        'minecraft:damage_sensor': { triggers: [{ cause: 'all', deals_damage: 'no' }] },
        'minecraft:pushable': { is_pushable: false, is_pushable_by_piston: false },
        'minecraft:knockback_resistance': { value: 1000 },
        'minecraft:health': { value: 1, max: 1 },
        'minecraft:fire_immune': true,
        'minecraft:conditional_bandwidth_optimization': {},
        'minecraft:type_family': { family: ['space_dim_sky'] },
        'minecraft:scale': { value: STAR_SCALE_FIXED },
      },
    },
  });

  write(path.join(RP, 'entity', 'sky_star.entity.json'), {
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: `${NS}:sky_star`,
        materials: { default: 'space_dim_sky' },
        textures: { default: `textures/${NS}/sky/star` },
        geometry: { default: `geometry.${NS}.sky_body` },
        // Sem animação de escala: ela vem de `minecraft:scale`, no servidor.
        scripts: { should_update_bones_and_effects_offscreen: true },
        render_controllers: [`controller.render.${NS}.sky_body`],
      },
    },
  });
}

// --- compartilhados ----------------------------------------------------------
write(path.join(RP, 'models', 'entity', 'sky_body.geo.json'), {
  // 1.16.0 e não 1.12.0: UV por face só existe a partir daí. Em 1.12.0 o campo
  // `uv` como objeto não é entendido, e uma geometria que falha ao carregar não
  // desenha nada — sem erro em lugar nenhum.
  format_version: '1.16.0',
  'minecraft:geometry': [{
    description: {
      identifier: `geometry.${NS}.sky_body`,
      texture_width: RES * 4, texture_height: RES * 3,
      visible_bounds_width: 64, visible_bounds_height: 64,
      visible_bounds_offset: [0, 0, 0],
    },
    bones: [{
      name: 'body',
      pivot: [0, 0, 0],
      cubes: [{
        origin: [-8, -8, -8],
        size: [16, 16, 16],
        // UV por face, não box UV.
        //
        // Box UV mapeia o TAMANHO do cubo direto em pixels: um cubo de 16
        // unidades usaria 16 px da textura, e com RES 64 sobrariam três
        // quartos dela sem uso — o corpo de longe voltaria a ser uma mancha.
        // Por face, cada uma aponta pra sua região inteira, e o cubo continua
        // com 1 bloco de lado.
        uv: {
          up:    { uv: [RES,     0],   uv_size: [RES, RES] },
          down:  { uv: [RES * 2, 0],   uv_size: [RES, RES] },
          east:  { uv: [0,       RES], uv_size: [RES, RES] },
          north: { uv: [RES,     RES], uv_size: [RES, RES] },
          west:  { uv: [RES * 2, RES], uv_size: [RES, RES] },
          south: { uv: [RES * 3, RES], uv_size: [RES, RES] },
        },
      }],
    }],
  }],
});

// A escala vem da propriedade da entidade. É por aqui que o cubo "fica longe":
// o script põe a entidade a poucos blocos do jogador e escolhe o tamanho que
// dá o mesmo ângulo do corpo de verdade, lá longe.
write(path.join(RP, 'animations', 'sky_body.animation.json'), {
  format_version: '1.8.0',
  animations: {
    [`animation.${NS}.sky_body.size`]: {
      loop: true,
      bones: { body: { scale: `q.property('${NS}:size')` } },
    },
  },
});

write(path.join(RP, 'render_controllers', 'sky_body.render_controllers.json'), {
  format_version: '1.8.0',
  render_controllers: {
    [`controller.render.${NS}.sky_body`]: {
      geometry: 'Geometry.default',
      materials: [{ '*': 'Material.default' }],
      textures: ['Texture.default'],
    },
  },
});

// Os degraus vão pro lado do script: ele escolhe o mais próximo, e as duas
// listas não podem divergir.
fs.writeFileSync(
  path.join(BP, 'scripts', 'space_dim', 'skySteps.js'),
  '/* GERADO por tools/make_sky_bodies.mjs — não edite à mão.\n' +
  ' *\n' +
  ' * Os degraus de escala dos corpos vistos de longe. Cada um é um component\n' +
  ' * group com `minecraft:scale` na entidade; o script escolhe o mais próximo\n' +
  ' * e dispara o evento correspondente.\n' +
  ' */\n' +
  'export const SKY_SIZE_STEPS = ' + JSON.stringify(SIZE_STEPS) + ';\n'
);

fs.rmSync(STAGE, { recursive: true, force: true });
console.log(`${SKY.length} corpos + a estrela: ${SKY.map((b) => b.id).join(', ')}`);
console.log(`  texturas ${RES * 4}x${RES * 3} tiradas do proprio columnRuns()`);
