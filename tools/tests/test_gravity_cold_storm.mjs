/* Gravidade dos planetas, frio do espaço e tempestade de areia.
 *
 * Os três são sistemas novos que o jogador sente mas não vê: uma queda que
 * desacelera, uma barra que escorre, uma névoa que fecha. Sem teste, o jeito de
 * descobrir que um deles parou seria morrer sem entender por quê.
 */
import { world, system, __reset, __advance } from '@minecraft/server';
import {
  applyPlanetGravity, fallDamageRefund, gravityOf, EARTH_G,
  forgetPlayer as forgetGravity,
} from './space_dim/planetGravity.js';
import { applyCold, isWarm, heatReserveOf, forgetPlayer as forgetCold } from './space_dim/cold.js';
import { stormIntensity, stormFog, stormNotice, spawnStormDust } from './space_dim/marsStorm.js';
import { PLANETS } from './space_dim/planets.js';
import {
  BODIES, DIMENSION_ID, COLD_SECONDS, COLD_WARN_AT,
  REINFORCED_SUIT_PIECES, STAR_ARMOR_PIECES, SPACESUIT_PIECES, OXYGEN_BACKPACK,
  MARS_STORM_FOG_AT, MARS_STORM_HEAVY_AT,
  FOG_MARS_STORM_ID, FOG_MARS_STORM_HEAVY_ID,
         COLD_RECOVER_FACTOR,
         COLD_DAMAGE_INTERVAL} from './space_dim/config.js';
import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

const moon = PLANETS.find((p) => p.id === 'moon');
const mars = PLANETS.find((p) => p.id === 'mars');

// ===========================================================================
// GRAVIDADE
// ===========================================================================
console.log('\n--- gravidade dos planetas ---');

function jogadorCaindo(dimId, vy) {
  const p = world.__addPlayer({ id: 'g1', dimensionId: dimId, location: { x: 0, y: 80, z: 0 } });
  p.isOnGround = false;
  p.__setVelocity({ y: vy });
  return p;
}

// --- 1. Caindo, o controlador devolve o que faltou --------------------------
//
// O primeiro tick só MEDE (ele não sabe a velocidade anterior). Do segundo em
// diante ele corrige — e é a aceleração resultante que tem que bater com o g do
// planeta, não a velocidade.
{
  __reset();
  forgetGravity('g1');
  const p = jogadorCaindo(moon.dimensionId, 0);

  // simula a queda: o motor tira EARTH_G por tick, o controlador devolve
  let vy = 0;
  const acels = [];
  for (let i = 0; i < 12; i++) {
    vy -= EARTH_G;                 // o que o motor faz
    p.__setVelocity({ y: vy });
    const antes = vy;
    applyPlanetGravity(p, moon);   // pode empurrar pra cima
    vy = p.getVelocity().y;        // o stub soma o empurrão na velocidade
    if (i > 1) acels.push(vy - (antes + EARTH_G));
    __advance(1);
  }
  const alvo = -gravityOf(moon);
  const pior = Math.max(...acels.map((a) => Math.abs(a - alvo)));
  check('caindo na Lua, a aceleração resultante vira o g da Lua',
        pior < 0.001, `(alvo ${alvo.toFixed(4)}, pior erro ${pior.toFixed(4)})`);
  check('  e o g da Lua é 0,165 do da Terra',
        Math.abs(gravityOf(moon) - EARTH_G * 0.165) < 1e-9,
        `(${gravityOf(moon).toFixed(4)} bloco/tick²)`);
  check('  o de Marte é maior que o da Lua', gravityOf(mars) > gravityOf(moon),
        `(${gravityOf(mars).toFixed(4)} vs ${gravityOf(moon).toFixed(4)})`);
}

// --- 2. No chão, nada de empurrão -------------------------------------------
//
// Empurrar quem está no chão é catapultá-lo. Este é o teste que impede isso de
// voltar.
{
  __reset();
  forgetGravity('g1');
  const p = jogadorCaindo(moon.dimensionId, -0.5);
  p.isOnGround = true;
  const c = applyPlanetGravity(p, moon);
  check('no chão o controlador não empurra', c === 0, `(${c})`);
  check('  e não sobra empurrão nenhum registrado',
        (p.__knockbacks ?? []).length === 0);
}

// --- 3. Montado, o veículo manda --------------------------------------------
{
  __reset();
  forgetGravity('g1');
  const p = jogadorCaindo(moon.dimensionId, -0.5);
  const veiculo = world.__spawn(moon.dimensionId, 'dlb_van:ufo', p.location);
  p.__mountOn(veiculo);
  check('montado, o controlador não mexe', applyPlanetGravity(p, moon) === 0);
}

// --- 4. Subindo também é mais leve ------------------------------------------
//
// É isto que faz o pulo alto sair sem jump_boost: subindo, o motor desacelera
// 0,08 por tick e o controlador devolve a diferença.
{
  __reset();
  forgetGravity('g1');
  const p = jogadorCaindo(moon.dimensionId, 0.42);   // velocidade de um pulo
  let vy = 0.42;
  let alturaLua = 0;
  for (let i = 0; i < 60 && vy > -0.01; i++) {
    vy -= EARTH_G;
    p.__setVelocity({ y: vy });
    applyPlanetGravity(p, moon);
    vy = p.getVelocity().y;
    if (vy > 0) alturaLua += vy;
    __advance(1);
  }
  // o mesmo pulo, sem controlador nenhum (a Terra)
  let v = 0.42, alturaTerra = 0;
  for (let i = 0; i < 60 && v > -0.01; i++) { v -= EARTH_G; if (v > 0) alturaTerra += v; }
  check('o mesmo pulo sobe muito mais na Lua', alturaLua > alturaTerra * 3,
        `(${alturaLua.toFixed(1)} contra ${alturaTerra.toFixed(1)} blocos)`);
}

// --- 5. Dano de queda proporcional, não anulado -----------------------------
{
  check('a Lua devolve 83,5% do dano de queda',
        Math.abs(fallDamageRefund(10, moon) - 8.35) < 1e-9,
        `(${fallDamageRefund(10, moon).toFixed(2)} de 10)`);
  check('  Marte devolve 62%',
        Math.abs(fallDamageRefund(10, mars) - 6.2) < 1e-9,
        `(${fallDamageRefund(10, mars).toFixed(2)} de 10)`);
  check('  mas nunca devolve tudo: cair de 100 ainda machuca',
        fallDamageRefund(10, moon) < 10 && fallDamageRefund(10, mars) < 10);
}

// --- 6. Nenhum efeito de poção no caminho dos planetas ----------------------
//
// Foi o pedido dele, e é o tipo de coisa que volta sem querer na primeira vez
// que alguém quiser "só um slow_falling rapidinho".
{
  const dir = path.join(process.env.DH_REPO ?? '.', 'packs', 'Galactic Horizons BP',
                        'scripts', 'space_dim');
  const arquivos = ['planetGravity.js', 'planetWorlds.js', 'marsStorm.js'];
  const achados = [];
  for (const f of arquivos) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/addEffect\(\s*"([a-z_]+)"/g)) achados.push(`${f}: ${m[1]}`);
  }
  check('gravidade e tempestade não usam efeito de poção nenhum',
        achados.length === 0, `(${achados.join(', ')})`);
}

// ===========================================================================
// FRIO
// ===========================================================================
console.log('\n--- frio do espaço ---');

// Longe do Sol, pra o campo de calor dele não interferir.
const sol = BODIES.find((b) => b.id === 'sun');
const LONGE = { x: sol.center.x + 4000, y: 128, z: sol.center.z + 4000 };

function jogadorNoVacuo(id = 'c1') {
  const p = world.__addPlayer({ id, dimensionId: DIMENSION_ID, location: { ...LONGE } });
  forgetCold(id);
  return p;
}

// --- 7. A reserva escorre, e o dano só vem no fim ---------------------------
{
  __reset();
  const p = jogadorNoVacuo();
  check('sem proteção, o vácuo é frio', !isWarm(p));

  const total = COLD_SECONDS * 20;
  let primeiroAviso = null;
  for (let i = 0; i < total; i++) {
    const aviso = applyCold(p);
    if (aviso && primeiroAviso === null) primeiroAviso = i;
    __advance(1);
  }
  check('  a reserva zera depois de COLD_SECONDS', heatReserveOf(p.id) < 1e-6,
        `(${heatReserveOf(p.id).toFixed(3)} depois de ${COLD_SECONDS}s)`);
  check('  e o aviso aparece ANTES de zerar, não junto com o dano',
        primeiroAviso !== null && primeiroAviso < total * 0.9,
        `(no tick ${primeiroAviso} de ${total})`);
  check('  o aviso começa perto de COLD_WARN_AT',
        Math.abs((1 - primeiroAviso / total) - COLD_WARN_AT) < 0.05,
        `(reserva ${(1 - primeiroAviso / total).toFixed(2)}, esperado ${COLD_WARN_AT})`);

  const vida = p.getComponent('health').currentValue;
  for (let i = 0; i < 100; i++) { applyCold(p); __advance(1); }
  check('  com a reserva zerada ele perde vida',
        p.getComponent('health').currentValue < vida,
        `(${vida} → ${p.getComponent('health').currentValue})`);
}

// --- 8. O que aquece, e o que NÃO aquece ------------------------------------
{
  __reset();
  // O traje comum resolve o AR, não o isolamento. É o que dá ao reforçado um
  // trabalho que ele não tinha.
  const comum = jogadorNoVacuo('c_comum');
  for (const peca of SPACESUIT_PIECES) comum.__wear(peca.slot, peca.item);
  comum.__wear('Offhand', OXYGEN_BACKPACK);
  check('o traje COMUM não protege do frio', !isWarm(comum));

  const reforcado = jogadorNoVacuo('c_ref');
  for (const peca of REINFORCED_SUIT_PIECES) reforcado.__wear(peca.slot, peca.item);
  check('  o traje reforçado protege', isWarm(reforcado));

  const estrela = jogadorNoVacuo('c_estrela');
  for (const peca of STAR_ARMOR_PIECES) estrela.__wear(peca.slot, peca.item);
  check('  a armadura de estrela protege', isWarm(estrela));

  const naNave = jogadorNoVacuo('c_nave');
  const ufo = world.__spawn(DIMENSION_ID, 'dlb_van:ufo', naNave.location);
  naNave.__mountOn(ufo);
  check('  dentro do OVNI é quente', isWarm(naNave));

  const pertoDoSol = world.__addPlayer({
    id: 'c_sol', dimensionId: DIMENSION_ID,
    location: { x: sol.center.x + sol.radius + 10, y: sol.center.y, z: sol.center.z },
  });
  check('  e perto do Sol o problema é o contrário', isWarm(pertoDoSol));
}

// --- 9. Descongelar, na proporção da neve fofa ------------------------------
// Na neve fofa o contador de congelamento sobe 1 por tick dentro dela e desce
// COLD_RECOVER_FACTOR por tick fora: descongelar é mais rápido do que congelar,
// e é exatamente essa proporção que este teste trava.
{
  __reset();
  const p = jogadorNoVacuo('c_volta');
  const gastos = Math.round(COLD_SECONDS * 20 * 0.8);
  for (let i = 0; i < gastos; i++) { applyCold(p); __advance(1); }
  const gelado = heatReserveOf(p.id);
  check('esfriou de verdade', gelado < 0.3, `(${gelado.toFixed(2)})`);

  for (const peca of REINFORCED_SUIT_PIECES) p.__wear(peca.slot, peca.item);
  let ticks = 0;
  while (heatReserveOf(p.id) < 1 && ticks < 20000) { applyCold(p); __advance(1); ticks++; }
  const esperado = gastos / COLD_RECOVER_FACTOR;
  check('  e descongela COLD_RECOVER_FACTOR vezes mais rápido, como na neve fofa',
        Math.abs(ticks - esperado) <= 2,
        `(${ticks} ticks pra encher, contra ${gastos} pra esvaziar — esperado ~${Math.round(esperado)})`);
}

// --- 9b. O congelamento É o da neve fofa ------------------------------------
// Os três números do jogo: 7 segundos até congelar, 1 de vida a cada 2
// segundos depois disso, e lentidão junto. Mais a causa `freezing`, que é o
// que põe "congelou até morrer" no lugar de uma morte sem explicação.
{
  __reset();
  const p = jogadorNoVacuo('c_neve');
  for (let i = 0; i < COLD_SECONDS * 20 + 5; i++) { applyCold(p); __advance(1); }
  check('congela nos mesmos 7 segundos da neve fofa', COLD_SECONDS === 7,
        `(COLD_SECONDS = ${COLD_SECONDS})`);
  check('  congelado, o jogador fica lento', !!p.getEffect('slowness'));

  p.__damages = [];
  const de = 200;
  for (let i = 0; i < de; i++) { applyCold(p); __advance(1); }
  const golpes = p.__damages.length;
  check('  e perde 1 de vida a cada 2 segundos',
        golpes === de / COLD_DAMAGE_INTERVAL && p.__damages.every((d) => d.n === 1),
        `(${golpes} golpes em ${de} ticks)`);
  check('  com a causa de congelamento, não com dano genérico',
        p.__damages.every((d) => d.cause === 'freezing'),
        `(${p.__damages[0]?.cause})`);
}

// ===========================================================================
// TEMPESTADE DE AREIA
// ===========================================================================
console.log('\n--- tempestade de areia de Marte ---');

import { gravityAt, inNoPullZone } from './space_dim/gravity.js';
import { MARS_STORM_EPOCH, PORTAL_MARGIN, GRAVITY_OFF_MARGIN } from './space_dim/config.js';

// --- 10. Determinística -----------------------------------------------------
{
  let iguais = true;
  for (let i = 0; i < 200; i++) {
    const t = i * 971, x = i * 37 - 3000, z = i * 53 - 2000;
    if (stormIntensity(t, x, z) !== stormIntensity(t, x, z)) { iguais = false; break; }
  }
  check('a mesma hora e o mesmo lugar dão sempre a mesma tempestade', iguais);
}

// --- 11. É uma MANCHA, não o planeta inteiro --------------------------------
//
// Foi a reclamação dele sobre a primeira versão: "não é na dimensão inteira,
// apenas em um pedaço". Este teste é o que impede a tempestade global de
// voltar.
{
  const t = MARS_STORM_EPOCH * 7 + 3000;
  let comNevoa = 0, n = 0, pico = 0;
  for (let x = -2500; x <= 2500; x += 25) {
    for (let z = -2500; z <= 2500; z += 25) {
      const i = stormIntensity(t, x, z);
      n++;
      if (i >= MARS_STORM_FOG_AT) comNevoa++;
      if (i > pico) pico = i;
    }
  }
  const cobertura = comNevoa / n;
  check('num instante, a tempestade cobre um PEDAÇO do planeta',
        cobertura > 0.01 && cobertura < 0.40,
        `(${(100 * cobertura).toFixed(1)}% da área)`);
  check('  e em algum lugar ela está forte', pico > MARS_STORM_HEAVY_AT,
        `(pico ${pico.toFixed(2)})`);
}

// --- 11b. E ela ANDA --------------------------------------------------------
//
// A outra metade do pedido. Uma mancha parada seria uma região do mapa, não
// uma tempestade.
{
  const t0 = MARS_STORM_EPOCH * 7 + 2000;
  const centro = (t) => {
    let melhorX = null, melhor = 0;
    for (let x = -3000; x <= 3000; x += 10) {
      const i = stormIntensity(t, x, 0);
      if (i > melhor) { melhor = i; melhorX = x; }
    }
    return { x: melhorX, i: melhor };
  };
  // acompanha UMA tempestade: mede o deslocamento do pico perto dele mesmo
  const a = centro(t0);
  let andou = 0;
  if (a.x !== null) {
    let melhorX = a.x, melhor = 0;
    for (let x = a.x - 400; x <= a.x + 400; x += 5) {
      const i = stormIntensity(t0 + 3000, x, 0);
      if (i > melhor) { melhor = i; melhorX = x; }
    }
    andou = Math.abs(melhorX - a.x);
  }
  check('a mancha se desloca com o tempo', andou > 20,
        `(o pico andou ${andou} blocos em 3000 ticks)`);
}

// --- 11c. Um jogador parado às vezes pega, às vezes não ---------------------
{
  for (const [nome, x, z] of [['no spawn', 0, 0], ['longe', 5200, -3100]]) {
    let dentro = 0, n = 0;
    for (let t = 0; t < MARS_STORM_EPOCH * 40; t += 60) {
      if (stormIntensity(t, x, z) >= MARS_STORM_FOG_AT) dentro++;
      n++;
    }
    const frac = dentro / n;
    check(`  ${nome}: pega tempestade às vezes, não sempre nem nunca`,
          frac > 0.02 && frac < 0.45, `(${(100 * frac).toFixed(1)}% do tempo)`);
  }
}

// --- 11d. A travessia tem uma FRENTE, não uma parede ------------------------
{
  const t = MARS_STORM_EPOCH * 7 + 3000;
  let maiorSalto = 0;
  for (let x = -3000; x < 3000; x += 1) {
    const a = stormIntensity(t, x, 0);
    const b = stormIntensity(t, x + 1, 0);
    maiorSalto = Math.max(maiorSalto, Math.abs(a - b));
  }
  check('atravessar a borda é gradual, não um interruptor',
        maiorSalto < 0.05, `(maior salto entre blocos vizinhos: ${maiorSalto.toFixed(3)})`);
}

// --- 12. A névoa acompanha a força ------------------------------------------
{
  check('sem tempestade não há névoa de tempestade', stormFog(0) === null);
  check('  fraca, a névoa leve', stormFog(MARS_STORM_FOG_AT + 0.01) === FOG_MARS_STORM_ID);
  check('  forte, a pesada', stormFog(MARS_STORM_HEAVY_AT + 0.01) === FOG_MARS_STORM_HEAVY_ID);
  check('  e abaixo do limiar, nenhuma', stormFog(MARS_STORM_FOG_AT - 0.01) === null);
  check('o aviso só aparece quando ela já atrapalha',
        stormNotice(0) === null && stormNotice(MARS_STORM_HEAVY_AT + 0.01) !== null);
}

// --- 13. A poeira sai, e só de tempos em tempos -----------------------------
{
  __reset();
  const p = world.__addPlayer({
    id: 's1', dimensionId: mars.dimensionId, location: { x: 0, y: 80, z: 0 },
  });
  let emissoes = 0, particulas = 0;
  for (let i = 0; i < 60; i++) {
    const n = spawnStormDust(p, 1);
    if (n) { emissoes++; particulas += n; }
    __advance(1);
  }
  check('a poeira é emitida de tempos em tempos, não todo tick',
        emissoes > 0 && emissoes < 30, `(${emissoes} emissões em 60 ticks)`);
  check('  e sem tempestade não sai nada', spawnStormDust(p, 0) === 0);
}

// ===========================================================================
// O PUXÃO PARA QUANDO SE ENCOSTA NUM PLANETA
// ===========================================================================
console.log('\n--- gravidade dos corpos: perto do planeta o puxão para ---');

// A DESIGUALDADE é a regra, não a igualdade.
//
// Desligar o puxão cedo demais não machuca ninguém: sobra uma casca fina sem
// puxão e sem viagem, e o jogador só flutua nela. Desligar tarde é o bug —
// existiria uma casca em que a viagem já começou e o puxão continua, e é nela
// que a nave é arrancada no meio do teleporte.
check(`o puxão desliga ANTES de o portal disparar (${GRAVITY_OFF_MARGIN} >= ${PORTAL_MARGIN})`,
      GRAVITY_OFF_MARGIN >= PORTAL_MARGIN);

{
  for (const id of ['earth', 'moon', 'mars']) {
    const body = BODIES.find((b) => b.id === id);
    const emCima = (fora) => ({
      x: body.center.x, y: body.center.y + body.radius + fora, z: body.center.z,
    });

    // Exatamente na distância que ele pediu.
    const aTres = emCima(GRAVITY_OFF_MARGIN);
    check(`a ${GRAVITY_OFF_MARGIN} blocos de ${id}, o puxão já parou`,
          inNoPullZone(aTres) && gravityAt(aTres) === null);

    // E em toda a faixa até a superfície, inclusive onde o portal dispara.
    let puxouEmAlgum = false;
    for (let fora = 0; fora <= GRAVITY_OFF_MARGIN; fora += 0.25) {
      if (gravityAt(emCima(fora)) !== null) puxouEmAlgum = true;
    }
    check(`  e em nenhum ponto dos ${GRAVITY_OFF_MARGIN} blocos até a superfície`,
          !puxouEmAlgum);

    // Logo depois ele volta, senão a gravidade do corpo sumiria.
    const foraDaMargem = emCima(GRAVITY_OFF_MARGIN + 2);
    check(`  volta assim que passa da margem`,
          !inNoPullZone(foraDaMargem) && gravityAt(foraDaMargem) !== null);
  }

  // O Sol não tem portal: lá o puxão é o que faz cair dentro dele ter graça.
  const sol2 = BODIES.find((b) => b.id === 'sun');
  const naCoroa = { x: sol2.center.x, y: sol2.center.y + sol2.radius - 2, z: sol2.center.z };
  check('o Sol continua puxando: ele não tem portal',
        !inNoPullZone(naCoroa) && gravityAt(naCoroa) !== null);
}

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
