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
const { BODIES } = await import(url.pathToFileURL(path.join(STAGE, 'space_dim', 'config.js')));

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

// A face é amostrada em RES x RES. `pick(u, v)` devolve o ponto do mundo.
const RES = 16;
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
      // No material emissivo do Bedrock o canal alfa é a MÁSCARA de brilho:
      // alfa 0 quer dizer "acende sozinho", não "transparente". É assim que o
      // Sol brilha no escuro do espaço em vez de virar uma silhueta.
      px[d + 3] = body.glow ? 0 : 255;
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

function bpEntity(body) {
  return {
    format_version: '1.21.80',
    'minecraft:entity': {
      description: {
        identifier: `${NS}:sky_${body.id}`,
        is_spawnable: false,
        is_summonable: true,
        properties: {
          // Quanto o cubo é encolhido. O cliente lê isto numa animação, que é
          // como se muda escala em tempo de execução: `minecraft:scale` é fixo
          // na definição e não aceita um número novo por entidade.
          [`${NS}:size`]: {
            type: 'float', range: [0.02, 40], default: 1, client_sync: true,
          },
        },
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
    },
  };
}

function rpEntity(body) {
  return {
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: `${NS}:sky_${body.id}`,
        // emissivo pro Sol (alfa 0 = aceso), alphatest pros demais (alfa 0 = buraco)
        materials: { default: body.glow ? 'entity_emissive' : 'entity_alphatest' },
        textures: { default: `textures/${NS}/sky/${body.id}` },
        geometry: { default: `geometry.${NS}.sky_body` },
        animations: { size: `animation.${NS}.sky_body.size` },
        scripts: { animate: ['size'] },
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

// --- compartilhados ----------------------------------------------------------
write(path.join(RP, 'models', 'entity', 'sky_body.geo.json'), {
  format_version: '1.12.0',
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
      cubes: [{ origin: [-8, -8, -8], size: [16, 16, 16], uv: [0, 0] }],
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

fs.rmSync(STAGE, { recursive: true, force: true });
console.log(`${SKY.length} corpos vistos de longe: ${SKY.map((b) => b.id).join(', ')}`);
console.log(`  texturas ${RES * 4}x${RES * 3} tiradas do proprio columnRuns()`);
