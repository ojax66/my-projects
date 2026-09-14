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
  // `true`: amostra TAMBÉM os corpos `built: false`. Os planetas não viram
  // bloco no mundo, mas a superfície deles é justamente o que esta textura
  // desenha — sem isto a Lua e Marte saem pretos.
  for (const r of columnRuns(x, z, true)) {
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
// A rampa NÃO tem preto. O preto da referência é o espaço ATRÁS do Sol, não o
// Sol: a face do corpo é o disco inteiro, então ela vai do branco do miolo até
// o vermelho da borda e para aí. Tentar desvanecer pro fundo só pintava um anel
// escuro em volta de cada face, que é o contrário do que a referência mostra.
//
// Cada parada é a cor real de um dos seis blocos do Sol (block_colors.json), na
// posição do MEIO da camada que aquele bloco ocupa em SUN_DISC. Assim o modelo
// visto de longe é o mesmo degradê da construção vista de perto, só que contínuo.
// As paradas são as cores reais dos seis blocos do Sol; o que mudou foram as
// POSIÇÕES. Na referência o miolo branco ocupa quase metade do disco e o
// vermelho é uma faixa fina na borda — o meu tinha o branco em 20% e sobrava
// laranja demais.
const SUN_RAMP = [
  [0.00, '#FFFFFF'],   // miolo, mais claro que o próprio bloco
  [0.50, '#FFFBEA'],   // sun_blaze
  [0.68, '#FBEA9F'],   // sun_flare
  [0.80, '#FCDE67'],   // sun_plasma
  [0.89, '#F9A128'],   // sun_ember
  [0.95, '#EC5A14'],   // sun_corona
  [1.00, '#AA300B'],   // sun_edge
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

/**
 * Afastamento do meio da face, de 0 a 1, em anéis de SUPERELIPSE — a mesma
 * medida que bodies.js usa, com a mesma norma-p de expoente 3.
 *
 * Redondo por dentro (Chebyshev dava anéis quadrados, que é o que destoava da
 * referência) e saturado na borda inteira da face (distância redonda pura
 * deixava o último tom só nas quinas e apagava o contorno do corpo).
 */
function faceOffset(u, v) {
  const P = 3;
  const a = Math.abs((u + 0.5) / RES * 2 - 1);
  const b = Math.abs((v + 0.5) / RES * 2 - 1);
  return Math.min(1, Math.pow(Math.pow(a, P) + Math.pow(b, P), 1 / P));
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

// --- Nada de preto na folha ---------------------------------------------------
//
// A textura é uma planificação 4x3: doze células, das quais só SEIS carregam
// face. As outras seis nasciam do Buffer.alloc, ou seja (0,0,0) — preto puro.
//
// Isso não é inofensivo. Quando o corpo está longe o modelo fica pequeno na
// tela e a GPU desce de mipmap: cada nível é a média de quatro texels do nível
// acima, e a média ATRAVESSA a borda das células. Então a borda de cada face
// vai se misturando com o preto vizinho — é a moldura escura em volta do Sol,
// e ela piora exatamente quando o corpo fica mais distante, que é justo quando
// o modelo é o que se vê.
//
// A correção é a de sempre em atlas de textura: não deixar buraco. Cada texel
// não pintado recebe a cor do texel pintado mais próximo (dilatação em ondas a
// partir das faces), então a média do mipmap só pode cair em cor do corpo.
// Vale pros outros corpos também: a Terra tinha a mesma moldura preta.
function fillGaps(px, W, H, painted) {
  let front = [];
  for (let i = 0; i < W * H; i++) if (painted[i]) front.push(i);
  while (front.length) {
    const next = [];
    for (const i of front) {
      const x = i % W, y = (i / W) | 0, d = i * 4;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (painted[j]) continue;
        painted[j] = 1;
        const e = j * 4;
        px[e] = px[d]; px[e + 1] = px[d + 1]; px[e + 2] = px[d + 2];
        // O ALFA vem junto com a cor, não é forçado a 0.
        //
        // Numa folha com alfas diferentes (superfície em 254, anéis em 0) forçar
        // o entorno a 0 deixa cada face cercada de vizinhos de alfa oposto. O
        // mipmap mistura os dois na borda, o pixel cai num alfa que não é nem um
        // nem outro, e a borda da face fica suja de longe. Herdando o alfa de
        // quem preencheu, cada região fica cercada do MESMO alfa dela.
        px[e + 3] = px[d + 3];
        next.push(j);
      }
    }
    front = next;
  }
}

// --- O Sol como VOLUME: cascas concêntricas ----------------------------------
//
// Medi a referência: numa varredura horizontal atravessando a aresta interna do
// cubo dele, o brilho NÃO cai. Sobe do contorno até o meio e desce do outro
// lado, liso, como se as duas faces fossem uma coisa só. E os anéis seguem a
// SILHUETA — hexagonais visto de quina, quadrados visto de frente.
//
// Isso não é uma textura. Nenhuma textura por face consegue: a silhueta muda
// com o ângulo da câmera, e a mesma aresta que está no contorno de um ângulo
// está no meio do corpo de outro. Qualquer desenho fixo que escureça a borda da
// face escurece as arestas internas junto — foi exatamente o que ele apontou.
//
// O que produz aquilo é VOLUME: luz somada ao longo do caminho que o raio
// percorre dentro do corpo. No meio da silhueta o raio atravessa o cubo
// inteiro; encostado no contorno, quase nada. Daí o miolo estourado e a queda
// até o vermelho na borda, sem aresta nenhuma aparecer.
//
// Dá pra fazer isso com geometria: cascas concêntricas, uma por degrau do
// degradê, desenhadas de fora pra dentro. Cada casca tapa o miolo da anterior,
// então o que sobra visível de cada uma é o ANEL da silhueta dela — e silhueta
// acompanha o ângulo da câmera de graça. Hexágonos de quina, quadrados de
// frente, e nenhuma aresta escura, porque não há borda de face desenhada.
//
// ATENÇÃO, e isto custou caro pra descobrir: o material `entity_emissive_alpha`
// NÃO mistura. O alfa dele controla só o brilho — a superfície sai opaca de
// qualquer jeito. Medi na foto do autor: a atmosfera da Terra, que era uma
// casca com alfa 6, saiu como um quadrado sólido da cor exata da textura dela,
// tapando o planeta.
//
// Então cascas só funcionam quando as de dentro DEVEM tapar as de fora, que é o
// caso aqui. Pra qualquer coisa que precise ser vista através — atmosfera,
// interior — casca não serve, e a solução tem que ser outra.
// 16 cascas: com 8 as faixas ficavam visíveis como degraus. Cada casca é um
// passo do degradê, então o número delas é a resolução dele.
const GLOW_SHELLS = 16;
const GLOW_CELL = 4;
const GLOW_ALPHA = 128;

/** Uma célula chapada por casca: do miolo branco à borda vermelha. */
function glowTexture(body) {
  const W = GLOW_SHELLS * GLOW_CELL;
  const H = GLOW_CELL;
  const px = Buffer.alloc(W * H * 4);
  for (let i = 0; i < GLOW_SHELLS; i++) {
    const col = sunColorAt(i / (GLOW_SHELLS - 1));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < GLOW_CELL; x++) {
        const d = (y * W + i * GLOW_CELL + x) * 4;
        px[d] = col[0]; px[d + 1] = col[1]; px[d + 2] = col[2]; px[d + 3] = GLOW_ALPHA;
      }
    }
  }
  const dir = path.join(RP, 'textures', NS, 'sky');
  fs.mkdirSync(dir, { recursive: true });
  writePng(path.join(dir, `glow_${body.id}.png`), W, H, px);
}

const isVolumetric = (body) => !!body.volumetric;

// --- A atmosfera: anéis opacos em volta da silhueta --------------------------
//
// O material não mistura — está medido: a casca translúcida da primeira
// tentativa saiu como um quadrado sólido da cor exata da textura dela. Mas
// opaco funciona, e é como o Sol já faz: cubos concêntricos desenhados de fora
// pra dentro, cada um tapando o miolo do anterior, de modo que o que sobra
// visível de cada um é o ANEL da silhueta dele. Silhueta acompanha o ângulo da
// câmera de graça — é por isso que o halo fica certo de qualquer lado.
//
// Aqui os anéis ficam FORA do corpo e o cubo do corpo é o último: ele tapa o
// miolo de todos, e sobra só a borda azul em volta.
//
// Os anéis moram nas células VAZIAS da planificação. A folha 4x3 tem doze e o
// cubo usa seis; cada anel é uma célula chapada de uma cor.
// Os anéis moram numa LINHA SÓ DELES, embaixo da planificação.
//
// Antes eles ocupavam as células vazias da própria planificação — e as células
// vazias da planificação fazem fronteira com FACES. Ele reportou a face de cima
// e a virada pra Lua sem textura, e são exatamente duas das quatro que encostam
// numa célula de anel: up e east tocam a primeira, down e south tocam a segunda.
// Das quatro, as duas que dava pra ver da posição dele eram up e south.
//
// Cor chapada e alfa diferente colados na borda de uma face vazam pra dentro
// dela. É o mesmo tipo de erro do atlas meio preto de muitas rodadas atrás: o
// que está DO LADO na folha acaba aparecendo na face.
//
// Com uma linha só pra eles, nenhum anel toca face nenhuma: entre os dois fica a
// linha de folga, que o fillGaps preenche com a cor das próprias faces.
const ATMO_ROW = 3;
const ATMO_CELLS = [[0, ATMO_ROW], [1, ATMO_ROW], [2, ATMO_ROW], [3, ATMO_ROW]];

/** Altura da folha: quem tem anel ganha a linha extra. */
const sheetRows = (body) => (body.atmosphere ? ATMO_ROW + 1 : 3);

// O alfa da SUPERFÍCIE de um corpo com atmosfera.
//
// 255 o jogo trata como opaco; 254 manda o pixel pra passada transparente sem
// mudar nada a olho nu. Os anéis ficam em alfa 0 (passada opaca, desenhados
// primeiro) e a superfície em 254 (transparente, desenhada depois): o corpo tapa
// o miolo dos anéis por ordem de passada, não só por ordem de cubo.
const SURFACE_ALPHA = 254;

function atmoRings(body) {
  const a = body.atmosphere;
  if (!a) return [];
  return a.rings.map((hex, i) => ({
    // de dentro pra fora: o primeiro anel encosta no corpo.
    size: 16 * (1 + ((a.reach - 1) * (i + 1)) / a.rings.length),
    color: rgb(hex),
    cell: ATMO_CELLS[i],
  }));
}

/**
 * O véu da atmosfera sobre a superfície do próprio corpo.
 *
 * Visto de longe não se olha o chão direto: olha-se através do ar. Na imagem
 * que ele aprovou o oceano saía (33,166,255) e a terra (31,191,138), contra
 * (5,117,156) e (3,144,1) da superfície crua — e a conta abaixo reproduz os
 * dois valores exatos no pixel.
 */
function hazed(body, col) {
  const h = body.atmosphere?.haze;
  if (!h || !col) return col;
  const a = h.alpha / 255;
  const c = rgb(h.color);
  let out = [col[0], col[1], col[2]];
  for (let i = 0; i < h.passes; i++) {
    out = [0, 1, 2].map((k) => Math.min(255, (1 - a) * (out[k] + c[k])));
  }
  return out.map((v) => Math.round(v));
}

function skyTexture(body) {
  const c = body.center, R = body.radius;

  // O corpo volumétrico não tem planificação: ele é feito de cascas.
  if (isVolumetric(body)) { glowTexture(body); return; }

  // O Sol: degradê contínuo, igual em todas as seis faces.
  if (body.heat) {
    const face = [];
    for (let v = 0; v < RES; v++) {
      for (let u = 0; u < RES; u++) face.push(sunColorAt(faceOffset(u, v)));
    }
    const W0 = RES * 4, H0 = RES * 3;
    const px0 = Buffer.alloc(W0 * H0 * 4);
    const painted0 = new Uint8Array(W0 * H0);
    const put = (ox, oy) => {
      for (let v = 0; v < RES; v++) for (let u = 0; u < RES; u++) {
        const col = face[v * RES + u];
        const i = (oy + v) * W0 + ox + u, d = i * 4;
        px0[d] = col[0]; px0[d + 1] = col[1]; px0[d + 2] = col[2]; px0[d + 3] = 0;
        painted0[i] = 1;
      }
    };
    put(RES, 0); put(RES * 2, 0); put(0, RES);
    put(RES, RES); put(RES * 2, RES); put(RES * 3, RES);
    fillGaps(px0, W0, H0, painted0);
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

  const W = RES * 4, H = RES * sheetRows(body);
  const px = Buffer.alloc(W * H * 4);
  const painted = new Uint8Array(W * H);
  const blit = (face, ox, oy) => {
    for (let v = 0; v < RES; v++) for (let u = 0; u < RES; u++) {
      const col = hazed(body, faces[face][v * RES + u]);
      if (!col) continue;
      const i = (oy + v) * W + ox + u, d = i * 4;
      painted[i] = 1;
      px[d] = col[0]; px[d + 1] = col[1]; px[d + 2] = col[2];
      // Alfa 0 = BRILHO MÁXIMO no material `space_dim_sky` (USE_EMISSIVE), e o
      // pixel continua opaco porque o material herda de `entity`.
      //
      // Efeito colateral que confunde: aberta num visualizador de imagens, a
      // textura parece vazia — o visualizador lê o alfa como transparência,
      // que é o significado normal dele. No jogo, com este material, não é.
      //
      // SALVO no corpo com anel de atmosfera, onde a superfície vai a 254.
      //
      // Isto é dele: 255 o jogo trata como opaco, 254 já manda o pixel pra
      // passada TRANSPARENTE, e a olho nu não muda nada. É o que resolve a
      // ordem: os anéis ficam na passada opaca e são desenhados primeiro; o
      // corpo, na transparente, vem depois e tapa o miolo deles. Deixa de
      // depender só da ordem dos cubos dentro do modelo.
      px[d + 3] = body.atmosphere ? SURFACE_ALPHA : 0;
    }
  };
  blit('up', RES, 0);
  blit('down', RES * 2, 0);
  blit('east', 0, RES);
  blit('north', RES, RES);
  blit('west', RES * 2, RES);
  blit('south', RES * 3, RES);

  fillGaps(px, W, H, painted);

  // Os anéis entram DEPOIS do preenchimento, de propósito.
  //
  // Antes eles entravam antes e o preenchimento os tratava como origem: a cor
  // chapada deles se espalhava pelas células vazias e voltava a encostar nas
  // faces por baixo. Entrando depois, quem espalhou foram só as faces, e o que
  // faz fronteira com cada anel é cor de superfície.
  for (const ring of atmoRings(body)) {
    const [cx, cy] = ring.cell;
    for (let v = 0; v < RES; v++) for (let u = 0; u < RES; u++) {
      const d = ((cy * RES + v) * W + cx * RES + u) * 4;
      px[d] = ring.color[0]; px[d + 1] = ring.color[1]; px[d + 2] = ring.color[2];
      px[d + 3] = 0;
    }
  }

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
// A faixa vem da conta, com folga nas duas pontas. O `validate.py` confere que
// ela cobre o que os corpos do config realmente pedem — quando o modelo passou
// a ficar na posição real (até SKY_MODEL_DISTANCE), a faixa antiga deixou de
// servir e foi ele que apontou.
const SIZE_RATIO = 1.25;
const SIZE_MIN = 0.05;
const SIZE_MAX = 400;
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

function bpEntity(body, prefix = '') {
  const { groups, events } = sizeGroups();
  return {
    format_version: '1.21.80',
    'minecraft:entity': {
      description: {
        identifier: `${NS}:sky_${prefix}${body.id}`,
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
        //
        // O corpo VOLUMÉTRICO é outra coisa: ele é um empilhado de cascas
        // translúcidas, então precisa de um material que MISTURE. Aí
        // `entity_emissive_alpha` é o certo, e o alfa volta a querer dizer
        // transparência — por isso a textura dele não é alfa 0, é alfa 128.
        // O corpo com atmosfera precisa de `space_dim_halo`, que é o mesmo
        // `space_dim_sky` mais DisableDepthWrite: os anéis são cubos MAIORES
        // que o corpo e ficam na frente dele no buffer de profundidade. Sem
        // isso o cubo do corpo é recusado pelo teste e o planeta some atrás do
        // próprio halo.
        materials: {
          default: isVolumetric(body) ? 'space_dim_glow'
            : body.atmosphere ? 'space_dim_halo' : 'space_dim_sky',
        },
        textures: {
          default: isVolumetric(body)
            ? `textures/${NS}/sky/glow_${body.id}`
            : `textures/${NS}/sky/${body.id}`,
        },
        geometry: {
          default: isVolumetric(body)
            ? `geometry.${NS}.sky_glow`
            : body.atmosphere
              ? `geometry.${NS}.sky_${body.id}`
              : `geometry.${NS}.sky_body`,
        },
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

// As cascas do corpo volumétrico. A de fora tem 16 unidades — um bloco —, igual
// ao cubo do sky_body, pra a conta de escala continuar valendo sem mudança.
//
// Declaradas de FORA pra DENTRO: a parte emissiva soma e não depende da ordem,
// mas a parte opaca sim, e assim a casca clara do miolo fica por cima.
write(path.join(RP, 'models', 'entity', 'sky_glow.geo.json'), {
  format_version: '1.16.0',
  'minecraft:geometry': [{
    description: {
      identifier: `geometry.${NS}.sky_glow`,
      texture_width: GLOW_SHELLS * GLOW_CELL, texture_height: GLOW_CELL,
      visible_bounds_width: 64, visible_bounds_height: 64,
      visible_bounds_offset: [0, 0, 0],
    },
    bones: [{
      name: 'body',
      pivot: [0, 0, 0],
      cubes: Array.from({ length: GLOW_SHELLS }, (_, k) => {
        const i = GLOW_SHELLS - 1 - k;
        const size = (16 * (i + 1)) / GLOW_SHELLS;
        const cell = { uv: [i * GLOW_CELL, 0], uv_size: [GLOW_CELL, GLOW_CELL] };
        return {
          origin: [-size / 2, -size / 2, -size / 2],
          size: [size, size, size],
          uv: {
            up: { ...cell }, down: { ...cell }, east: { ...cell },
            north: { ...cell }, west: { ...cell }, south: { ...cell },
          },
        };
      }),
    }],
  }],
});


// O corpo COM atmosfera tem geometria própria: os anéis do halo, de fora pra
// dentro, e o cubo do corpo por último.
//
// A ordem é tudo. Desenhado por último, o cubo do corpo tapa o miolo de todos
// os anéis, e o que sobra de cada um é a silhueta dele — o halo. Invertida, os
// anéis tapariam o planeta.
//
// O cubo do corpo continua com 16 unidades: a conta de escala do skybox depende
// disso, e o halo não pode mexer no tamanho aparente do planeta.
const bodyCube = () => ({
  origin: [-8, -8, -8],
  size: [16, 16, 16],
  // UV por face, não box UV.
  //
  // Box UV mapeia o TAMANHO do cubo direto em pixels: um cubo de 16 unidades
  // usaria 16 px da textura, e com RES 64 sobrariam três quartos dela sem uso —
  // o corpo de longe voltaria a ser uma mancha. Por face, cada uma aponta pra
  // sua região inteira, e o cubo continua com 1 bloco de lado.
  uv: {
    up:    { uv: [RES,     0],   uv_size: [RES, RES] },
    down:  { uv: [RES * 2, 0],   uv_size: [RES, RES] },
    east:  { uv: [0,       RES], uv_size: [RES, RES] },
    north: { uv: [RES,     RES], uv_size: [RES, RES] },
    west:  { uv: [RES * 2, RES], uv_size: [RES, RES] },
    south: { uv: [RES * 3, RES], uv_size: [RES, RES] },
  },
});

for (const body of SKY.filter((b) => b.atmosphere)) {
  const aneis = atmoRings(body);
  const cubes = [];
  for (let i = aneis.length - 1; i >= 0; i--) {          // de fora pra dentro
    const { size, cell } = aneis[i];
    // Amostra só o MIOLO da célula, não a célula inteira.
    //
    // A célula é chapada, então qualquer pedaço dela serve — e ficando longe da
    // borda o mipmap nunca mistura o anel com a célula vizinha, que tem outra
    // cor e outro alfa. Sem isso o anel ganha franja suja de longe.
    const uv = {
      uv: [cell[0] * RES + RES / 4, cell[1] * RES + RES / 4],
      uv_size: [RES / 2, RES / 2],
    };
    cubes.push({
      origin: [-size / 2, -size / 2, -size / 2],
      size: [size, size, size],
      uv: {
        up: { ...uv }, down: { ...uv }, east: { ...uv },
        north: { ...uv }, west: { ...uv }, south: { ...uv },
      },
    });
  }
  cubes.push(bodyCube());                                 // o corpo por último

  write(path.join(RP, 'models', 'entity', `sky_${body.id}.geo.json`), {
    format_version: '1.16.0',
    'minecraft:geometry': [{
      description: {
        identifier: `geometry.${NS}.sky_${body.id}`,
        texture_width: RES * 4, texture_height: RES * sheetRows(body),
        visible_bounds_width: 64, visible_bounds_height: 64,
        visible_bounds_offset: [0, 0, 0],
      },
      bones: [{ name: 'body', pivot: [0, 0, 0], cubes }],
    }],
  });
}

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
