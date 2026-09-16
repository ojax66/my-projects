/* =========================================================================
 * O terreno da Lua e de Marte.
 *
 * Uma regra guia tudo aqui: o RELEVO É UMA FUNÇÃO CONTÍNUA de (x, z), e o
 * bioma é só um rótulo dela.
 *
 * A tentação era a outra: escolher o bioma primeiro e cada bioma ter a sua
 * conta de altura. Isso dá um paredão de um bloco de largura em toda fronteira
 * — a "borda de bioma" que denuncia mundo gerado por script. Aqui cada bioma
 * tem um PESO contínuo (0..1) que sai dos mesmos ruídos, e tudo que varia por
 * bioma — força das crateras, espessura das camadas — é a média ponderada por
 * esses pesos. O nome do bioma é só qual peso é o maior naquele ponto. Como os
 * pesos variam suavemente, nada no terreno pode dar salto.
 *
 * `tools/tests/test_planets.mjs` confere isso medindo o degrau entre colunas
 * vizinhas ao longo de milhares de blocos, inclusive em cima das fronteiras.
 * ========================================================================= */

import { fbm, valueNoise, valueNoise3D, hash2, hash3 } from "./world_generator_API.js";
import { NOISE, POLE_Z, POLE_FADE, PLANET_BOUNDS } from "./planets.js";
import { takeBudget, BudgetExhausted, makeChunkCursor, writeRun } from "./budget.js";

// ---------------------------------------------------------------------------
// Ferramentas
// ---------------------------------------------------------------------------
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Degrau suave: 0 antes de e0, 1 depois de e1, e uma curva S no meio. */
function sstep(e0, e1, t) {
  const u = clamp((t - e0) / (e1 - e0), 0, 1);
  return u * u * (3 - 2 * u);
}

const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// Os campos de ruído
//
// São sempre os MESMOS quatro, e tudo — altura, bioma, espessura — sai deles.
// Os deslocamentos grandes (+4096, -2048...) existem pra os campos serem
// independentes: sem eles, hash2 devolveria o mesmo número pros quatro e o
// planeta inteiro teria uma listra só.
// ---------------------------------------------------------------------------
function fieldsAt(x, z) {
  return {
    region: fbm(x, z, 3, 0.5, NOISE.region),
    rough: fbm(x + 4096, z - 4096, 3, 0.5, NOISE.rough),
    elev: fbm(x - 2048, z + 2048, 4, 0.5, NOISE.elev),
    detail: fbm(x + 512, z + 512, 3, 0.5, NOISE.detail),
    grain: valueNoise(x * NOISE.grain, z * NOISE.grain),
    // Latitude: 0 no equador, 1 dentro da calota. Um mundo de Minecraft é
    // plano e infinito, então "polo" é uma faixa em |z|.
    polar: sstep(POLE_Z - POLE_FADE, POLE_Z, Math.abs(z)),
  };
}

/** Eixo de um vale de rift: 1 em cima da linha, 0 fora dela. */
function riftMask(x, z, wavelength, width) {
  const c = Math.abs(fbm(x + 7777, z - 7777, 2, 0.5, 1 / wavelength) - 0.5);
  return 1 - sstep(0, width, c);
}

// ---------------------------------------------------------------------------
// Crateras
//
// Uma grade de células; em cada uma, um sorteio decide se há cratera, onde
// dentro da célula e de que raio. Como o sorteio é hash puro das coordenadas da
// célula, o campo inteiro é determinístico e não precisa guardar nada.
//
// O perfil é o de uma cratera de impacto de verdade:
//   - dentro do raio, uma tigela parabólica (o fundo, que é o mais fundo);
//   - subindo pra borda, o anel levantado — material empurrado pra cima;
//   - fora do raio, o manto de ejeção, que cai até sumir.
//
// `depth` e `rim` são frações do RAIO. Uma cratera real tem profundidade em
// torno de 1/5 do diâmetro, ou seja 2/5 do raio — daí os ~0.3 da Lua. Marte
// usa menos porque lá o vento enche a cratera de poeira há bilhões de anos.
//
// Três células vizinhas em cada eixo bastam: uma cratera nunca alcança mais que
// 1,45 célula, porque rMax < cell/2.
// ---------------------------------------------------------------------------
const EJECTA = 0.45; // até onde o manto de ejeção vai, em frações do raio

function craterField(x, z, spec) {
  let dh = 0;
  const cx0 = Math.floor(x / spec.cell);
  const cz0 = Math.floor(z / spec.cell);

  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const cx = cx0 + i;
      const cz = cz0 + j;
      if (hash2(cx * 7919 + 13, cz * 6047 - 29) > spec.chance) continue;

      const ox = hash2(cx * 131 + 7, cz * 977 + 3);
      const oz = hash2(cx * 313 - 11, cz * 523 + 91);
      const px = (cx + ox) * spec.cell;
      const pz = (cz + oz) * spec.cell;

      const R = lerp(spec.rMin, spec.rMax, hash2(cx * 61 + 5, cz * 89 + 17));
      const d = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
      if (d > R * (1 + EJECTA)) continue;

      if (d < R) {
        const t = d / R;
        // A tigela, e a borda subindo no último pedaço (t^6 só levanta perto
        // de t = 1, que é onde o anel fica).
        dh -= spec.depth * R * (1 - t * t);
        dh += spec.rim * R * Math.pow(t, 6);
      } else {
        const t = (d - R) / (R * EJECTA);
        const f = 1 - t;
        dh += spec.rim * R * f * f;
      }
    }
  }
  return dh;
}

/** Quanto a coluna afundou por cratera, sem contar borda nem ejeção. */
function craterDepthOnly(x, z, specs, scale) {
  let deep = 0;
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const cx0 = Math.floor(x / spec.cell);
    const cz0 = Math.floor(z / spec.cell);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const cx = cx0 + a;
        const cz = cz0 + b;
        if (hash2(cx * 7919 + 13, cz * 6047 - 29) > spec.chance) continue;
        const ox = hash2(cx * 131 + 7, cz * 977 + 3);
        const oz = hash2(cx * 313 - 11, cz * 523 + 91);
        const px = (cx + ox) * spec.cell;
        const pz = (cz + oz) * spec.cell;
        const R = lerp(spec.rMin, spec.rMax, hash2(cx * 61 + 5, cz * 89 + 17));
        const d = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
        if (d >= R) continue;
        const t = d / R;
        deep += spec.depth * R * (1 - t * t);
      }
    }
  }
  return deep * scale;
}

// ---------------------------------------------------------------------------
// Vulcões-escudo (Marte)
//
// O Olympus Mons tem 22 km de altura e 600 km de base: a encosta média é de 5
// graus, uma rampa que dá pra subir andando.
//
// O perfil é (1 - t²)^1.7, e não (1 - t)^1.7 como era antes. A diferença está
// nas duas pontas, e ela é o que separa um escudo de um cone: com (1 - t) a
// encosta é MAIS ÍNGREME no cume, que é o contrário de um vulcão-escudo. Com
// (1 - t²) a derivada é zero no centro (cume achatado, como o Olympus) e zero
// na borda (a base funde com a planície em vez de terminar num degrau), e o
// máximo fica no meio da encosta — que é onde ele fica de verdade.
//
// E no alto, a caldeira: um buraco no cume, que é o que faz um vulcão parecer
// um vulcão e não um morro.
// ---------------------------------------------------------------------------
const CALDERA_R = 0.11; // fração do raio ocupada pela caldeira
const CALDERA_DEPTH = 0.10; // fração da altura

function volcanoField(x, z, spec) {
  let up = 0;
  const cx0 = Math.floor(x / spec.cell);
  const cz0 = Math.floor(z / spec.cell);

  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const cx = cx0 + i;
      const cz = cz0 + j;
      if (hash2(cx * 4231 + 91, cz * 3319 + 7) > spec.chance) continue;

      const ox = hash2(cx * 197 + 23, cz * 601 + 5);
      const oz = hash2(cx * 449 - 17, cz * 271 + 43);
      const px = (cx + ox) * spec.cell;
      const pz = (cz + oz) * spec.cell;

      const R = lerp(spec.rMin, spec.rMax, hash2(cx * 73 + 11, cz * 97 + 29));
      const H = lerp(spec.hMin, spec.hMax, hash2(cx * 151 + 3, cz * 199 + 61));
      const d = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
      if (d >= R) continue;

      const t = d / R;
      up += H * Math.pow(1 - t * t, 1.7);
      if (d < R * CALDERA_R) {
        up -= H * CALDERA_DEPTH * (1 - d / (R * CALDERA_R));
      }
    }
  }
  return up;
}

// ---------------------------------------------------------------------------
// Pesos dos biomas
//
// Cada planeta reparte 1,0 entre os seus biomas, e a repartição é contínua.
// O padrão é "quem chega primeiro leva": o polo cobre tudo, o que sobra o
// cânion divide, o que sobra do cânion o vulcanismo divide, e assim por diante.
// Isso garante soma 1 sem normalizar nada — normalizar dividiria por um número
// que pode passar perto de zero, e aí o peso daria salto.
// ---------------------------------------------------------------------------
function moonWeights(f) {
  const p = f.polar;
  const rest = 1 - p;
  // Mar de basalto: as regiões baixas do campo `region`.
  const mare = 1 - sstep(0.40, 0.52, f.region);
  // Bacia de impacto: onde o terreno é mais áspero, e nunca dentro do mar.
  const basin = sstep(0.60, 0.74, f.rough) * (1 - mare);
  return [
    mare * rest,              // mar_de_basalto
    (1 - mare - basin) * rest, // terras_altas
    basin * rest,             // bacia_de_impacto
    p,                        // polo_sombrio
  ];
}

function marsWeights(f, canyon, volcW) {
  let rest = 1;
  const wPolar = f.polar; rest -= wPolar;
  const wValles = canyon * rest; rest -= wValles;
  // Tharsis é o ruído de vulcanismo OU um vulcão de verdade embaixo dos pés.
  //
  // O `ou` importa: o vulcão passou a ter raio de até 340, mais do que meio
  // comprimento de onda do campo de aspereza. Cortá-lo por esse campo deixaria
  // metade do vulcão rotulada como outro bioma — e, pior, se a altura também
  // fosse cortada por ele, o vulcão sairia torto. Agora o vulcão é desenhado
  // inteiro e o bioma vem atrás dele. `max` de duas funções contínuas continua
  // contínua, então a soma dos pesos não escorrega.
  const wTharsis = Math.max(sstep(0.64, 0.78, f.rough), volcW) * rest; rest -= wTharsis;
  const wDunes = sstep(0.56, 0.68, f.region) * rest; rest -= wDunes;
  // Dicotomia: o norte é a planície boreal, o sul são as terras altas.
  const north = 1 - sstep(-1400, -200, f.z);
  const wBoreal = north * rest; rest -= wBoreal;
  return [wBoreal, rest, wValles, wTharsis, wDunes, wPolar];
}

// ---------------------------------------------------------------------------
// A coluna
// ---------------------------------------------------------------------------
/**
 * Tudo que se sabe sobre (x, z): altura, pesos dos biomas, bioma dominante e
 * as camadas de cima pra baixo. É uma função pura — os testes a chamam direto.
 */
export function terrainAt(planet, x, z) {
  const f = fieldsAt(x, z);
  f.z = z;

  const canyon = planet.canyon ? riftMask(x, z, 1400, planet.canyon.width) : 0;

  // O vulcão é calculado ANTES dos pesos, porque é ele que decide Tharsis.
  const volc = planet.volcanoes ? volcanoField(x, z, planet.volcanoes) : 0;
  const volcW = volc > 0 ? sstep(0, 12, volc) : 0;

  const w = planet.id === "moon" ? moonWeights(f) : marsWeights(f, canyon, volcW);

  // --- a altura ------------------------------------------------------------
  let h = planet.baseY
    + (f.elev - 0.5) * planet.elevAmp
    + (f.detail - 0.5) * planet.detailAmp
    + (f.grain - 0.5) * planet.grainAmp;

  // A dicotomia de Marte: 3 km de degrau entre o norte baixo e o sul alto.
  // tanh porque ela é um degrau, mas um degrau macio, com centenas de km de
  // transição — não uma falha.
  if (planet.dichotomy) {
    h += planet.dichotomy.amp * Math.tanh(z / planet.dichotomy.fade);
  }

  // Crateras, com a força média ponderada pelos pesos: no mar de basalto elas
  // quase não existem (a lava as cobriu), na bacia de ejeção elas se empilham.
  let craterScale = 0;
  for (let i = 0; i < w.length; i++) craterScale += w[i] * planet.biomes[i].craterScale;

  let crater = 0;
  for (let i = 0; i < planet.craters.length; i++) {
    crater += craterField(x, z, planet.craters[i]);
  }
  h += crater * craterScale;

  // O vulcão inteiro, sem gate nenhum: quem o corta é que teria que virar
  // degrau. Ele não segue Tharsis — ele DEFINE Tharsis (ver marsWeights).
  h += volc;

  // O cânion: parede íngreme, fundo chato. A potência 0.35 é o que faz a parede
  // — a queda quase toda acontece nos primeiros metros a partir da borda.
  if (planet.canyon && canyon > 0) {
    h -= planet.canyon.depth * Math.pow(canyon, 0.35);
  }

  // Rilles: canais de lava colapsada, só nos mares da Lua.
  const mareIdx = 0;
  if (planet.biomes[mareIdx].rille && w[mareIdx] > 0) {
    const rille = planet.biomes[mareIdx].rille;
    const m = riftMask(x + 3000, z + 3000, 700, rille.width);
    h -= rille.depth * m * w[mareIdx];
  }

  // Dunas: cristas paralelas, com o eixo torto de propósito.
  if (planet.dunes) {
    const duneW = w[4] ?? 0;
    if (duneW > 0) {
      const d = planet.dunes;
      const u = x * Math.cos(d.angle) + z * Math.sin(d.angle)
        + 24 * (fbm(x - 9000, z + 9000, 2, 0.5, 1 / 260) - 0.5);
      h += d.amp * (0.5 + 0.5 * Math.sin((u * 2 * Math.PI) / d.period)) * duneW;
    }
  }

  // Os limites da dimensão, com folga pra a crosta caber embaixo da superfície
  // e pra sobrar céu em cima.
  h = Math.round(clamp(h, PLANET_BOUNDS.min + planet.crust + 2, PLANET_BOUNDS.max - 8));

  // --- o bioma dominante ---------------------------------------------------
  let best = 0;
  for (let i = 1; i < w.length; i++) if (w[i] > w[best]) best = i;
  const biome = planet.biomes[best];

  // --- as camadas ----------------------------------------------------------
  // Espessura por média ponderada, com um ruído próprio pra variar de lugar pra
  // lugar. Como os pesos são contínuos, a espessura também é.
  const tNoise = valueNoise(x / 23, z / 23);
  const sNoise = valueNoise(x / 31 + 100, z / 31 - 100);
  let dustT = 0;
  let stoneT = 0;
  for (let i = 0; i < w.length; i++) {
    const b = planet.biomes[i];
    dustT += w[i] * lerp(b.dust[0], b.dust[1], tNoise);
    stoneT += w[i] * lerp(b.stone[0], b.stone[1], sNoise);
  }
  dustT = clamp(Math.round(dustT), 1, planet.crust - 4);
  stoneT = clamp(Math.round(stoneT), 1, planet.crust - 2 - dustT);

  // A profundidade de tigela desta coluna — quanto ela afundou por cratera,
  // sem contar borda nem ejeção. Serve pra duas coisas: a pedra que aflora no
  // fundo das crateras grandes, e o gelo do fundo das polares. Calculada uma
  // vez porque não é barata: são 9 células por escala de cratera.
  const precisaFundo = planet.craterFloor
    || planet.biomes.some((b) => b.ice && b.ice.below !== undefined);
  const fundo = precisaFundo
    ? craterDepthOnly(x, z, planet.craters, craterScale)
    : 0;

  // A pedra aflorando no fundo das crateras grandes, com o degradê subindo
  // pela parede. Ela SUBSTITUI a poeira; a ordem das camadas não muda, o que
  // muda é qual bloco está por cima naquela coluna.
  let topoDePedra = false;
  if (planet.craterFloor && fundo > planet.craterFloor.from) {
    const cf = planet.craterFloor;
    const chance = sstep(cf.from, cf.to, fundo);
    topoDePedra = valueNoise(x / cf.blob, z / cf.blob) < chance;
  }

  // Gelo. Dois jeitos diferentes, e os dois são o que existe de verdade:
  //  - calota (Marte): uma capa por cima de tudo, na latitude polar;
  //  - fundo de cratera (Lua): só onde o Sol nunca bate.
  let iceT = 0;
  const ice = biome.ice;
  if (ice) {
    const thick = Math.round(lerp(ice.thickness[0], ice.thickness[1], tNoise));
    if (ice.cap) {
      iceT = Math.round(thick * w[best]);
    } else if (ice.below !== undefined) {
      if (fundo >= ice.below) iceT = thick;
    }
  }
  iceT = clamp(iceT, 0, planet.crust - 3 - dustT - stoneT < 0 ? 0 : 4);

  const layers = [];
  if (iceT > 0) layers.push({ id: planet.blocks.ice, t: iceT });
  if (topoDePedra) {
    // A poeira vira pedra e se junta à camada de pedra: um trecho contínuo só,
    // em vez de dois trechos do mesmo bloco colados.
    layers.push({ id: planet.blocks.stone, t: dustT + stoneT });
  } else {
    layers.push({ id: planet.blocks.dust, t: dustT });
    layers.push({ id: planet.blocks.stone, t: stoneT });
  }

  return { height: h, weights: w, biome, layers, craterScale, fundo, topoDePedra };
}

/** Só a altura — é o que `findValidSpot` do gerador precisa. */
export function heightAt(planet, x, z) {
  return terrainAt(planet, x, z).height;
}

/** O bioma dominante em (x, z). */
export function biomeAt(planet, x, z) {
  return terrainAt(planet, x, z).biome;
}

// ---------------------------------------------------------------------------
// O que tem DENTRO da crosta: cavernas e minérios
// ---------------------------------------------------------------------------
/**
 * Este bloco é vazio de caverna?
 *
 * Ruído 3D com um corte: acima do limiar, é ar. A casca de cima nunca é furada
 * (`fromSurface`) — sem ela a caverna abriria buraco no chão e o jogador cairia
 * num vão andando na planície. E a bedrock também ganha uma folga por baixo,
 * senão dá pra ver o fundo do mundo de dentro da caverna.
 *
 * As duas bordas são SUAVIZADAS em vez de cortadas: perto da superfície o
 * limiar sobe, então a caverna afina até sumir em vez de terminar num teto reto.
 */
function isCave(planet, x, y, z, prof, acimaDoFundo) {
  const c = planet.caves;
  if (!c) return false;
  if (prof <= c.fromSurface) return false;
  if (acimaDoFundo <= c.aboveFloor) return false;

  // Quanto mais perto do teto ou do fundo, mais difícil abrir.
  const folgaTopo = sstep(c.fromSurface, c.fromSurface + 5, prof);
  const folgaFundo = sstep(c.aboveFloor, c.aboveFloor + 3, acimaDoFundo);
  const limiar = c.threshold + (1 - Math.min(folgaTopo, folgaFundo)) * 0.25;

  return valueNoise3D(x / c.scale, y / (c.scale * 0.6), z / c.scale) > limiar;
}

/**
 * Qual minério tem neste bloco, ou null.
 *
 * São três decisões separadas, e separá-las é o que torna isto ajustável:
 *
 *   `rarity`     — QUANTOS veios existem. Um sorteio por célula da grade.
 *   `threshold`  — QUE FORMATO cada veio tem. O ruído 3D dentro da célula.
 *   `weight`     — QUAL minério é. Um hash da célula, pra o veio inteiro sair
 *                  do mesmo metal em vez de salpicado.
 *
 * Misturar as duas primeiras num número só foi a primeira tentativa, e ela não
 * dava pra ajustar: subir o limiar pra ter menos minério também deixava cada
 * veio menor e mais picado, até virar pedrinha solta. Agora a quantidade e o
 * tamanho andam separados.
 *
 * A profundidade filtra a lista: ferro raso, diamante fundo.
 */
function oreAt(planet, x, y, z, prof) {
  const o = planet.ores;
  if (!o) return null;

  const cx = Math.floor(x / o.vein);
  const cy = Math.floor(y / o.vein);
  const cz = Math.floor(z / o.vein);

  // Esta célula da grade tem veio?
  if (hash3(cx * 7919 + 5, cy * 6047 + 19, cz * 4231 - 7) > o.rarity) return null;

  // Tem: o ruído dá o formato dele dentro da célula.
  if (valueNoise3D(x / o.vein + 71, y / o.vein - 71, z / o.vein + 137) <= o.threshold) {
    return null;
  }

  let total = 0;
  for (let i = 0; i < o.list.length; i++) {
    const m = o.list[i];
    if (prof >= m.from && prof <= m.to) total += m.weight;
  }
  if (total <= 0) return null;

  let r = hash3(cx * 13 + 1, cy * 29 + 7, cz * 41 + 3) * total;
  for (let i = 0; i < o.list.length; i++) {
    const m = o.list[i];
    if (prof < m.from || prof > m.to) continue;
    r -= m.weight;
    if (r <= 0) return m.block;
  }
  return null;
}

/**
 * A coluna como trechos contínuos, de baixo pra cima. Mesmo formato que
 * bodies.js usa: { y0, y1, id }.
 *
 * A coluna é montada bloco a bloco e só depois comprimida em trechos, porque
 * caverna e minério trocam blocos no meio de uma camada — com as camadas
 * montadas direto como trechos não havia onde encaixá-los.
 */
export function columnRunsAt(planet, x, z) {
  const t = terrainAt(planet, x, z);
  const bedrockY = t.height - planet.crust;

  // A camada de cada profundidade. Profundidade 1 é o bloco da superfície.
  const ate = [];
  let acc = 0;
  for (let i = 0; i < t.layers.length; i++) {
    const l = t.layers[i];
    if (l.t <= 0) continue;
    acc += l.t;
    ate.push({ prof: acc, id: l.id });
  }
  const camadaEm = (prof) => {
    for (let i = 0; i < ate.length; i++) if (prof <= ate[i].prof) return ate[i].id;
    return planet.blocks.deep;
  };

  const runs = [];
  let atual = null;

  const empurra = (y, id) => {
    if (id === null) { atual = null; return; }
    if (atual && atual.id === id && atual.y1 === y - 1) { atual.y1 = y; return; }
    atual = { y0: y, y1: y, id };
    runs.push(atual);
  };

  empurra(bedrockY, planet.blocks.floor);

  for (let i = 1; i <= planet.crust; i++) {
    const y = bedrockY + i;
    const prof = t.height - y + 1;

    if (isCave(planet, x, y, z, prof, i)) { empurra(y, null); continue; }

    const base = camadaEm(prof);
    // Minério só na rocha: não aflora na poeira nem substitui gelo.
    let id = base;
    if (base === planet.blocks.stone || base === planet.blocks.deep) {
      id = oreAt(planet, x, y, z, prof) ?? base;
    }
    empurra(y, id);
  }

  return runs;
}

// ---------------------------------------------------------------------------
// O gerador que o world_generator_API consome
// ---------------------------------------------------------------------------
/**
 * Monta o par (generateColumn, getHeight) de um planeta, com orçamento de
 * blocos por tick e cursor de chunk próprios — as mesmas regras do gerador dos
 * corpos celestes, e pelo mesmo motivo: uma chunk aqui passa de 7 mil blocos.
 */
export function makePlanetGenerator(planet) {
  const cursor = makeChunkCursor();

  function generateColumn(dim, x, z) {
    const state = cursor.stateOf(x, z);
    if (state === "done") return PLANET_BOUNDS.min;
    // Alguma coluna ANTES desta falhou nesta passada: o cursor só anda em
    // ordem, senão a chunk nunca terminaria de verdade.
    if (state === "ahead") throw BudgetExhausted;

    const runs = columnRunsAt(planet, x, z);

    let blocks = 0;
    for (let i = 0; i < runs.length; i++) blocks += runs[i].y1 - runs[i].y0 + 1;
    if (!takeBudget(blocks, planet.dimensionId)) throw BudgetExhausted;

    let top = PLANET_BOUNDS.min;
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      writeRun(dim, x, z, r.y0, r.y1, r.id);
      if (r.y1 > top) top = r.y1;
    }

    cursor.advance(x, z);
    return top;
  }

  return {
    generateColumn,
    getHeight: (x, z) => heightAt(planet, x, z),
  };
}
