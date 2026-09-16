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
} from './space_dim/config.js';
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
  const dir = path.join(process.env.DH_REPO ?? '.', 'packs', 'Distant Horizons BP',
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

// --- 9. Reaquecer é rápido --------------------------------------------------
{
  __reset();
  const p = jogadorNoVacuo('c_volta');
  for (let i = 0; i < COLD_SECONDS * 20 * 0.8; i++) { applyCold(p); __advance(1); }
  const gelado = heatReserveOf(p.id);
  check('esfriou de verdade', gelado < 0.3, `(${gelado.toFixed(2)})`);

  for (const peca of REINFORCED_SUIT_PIECES) p.__wear(peca.slot, peca.item);
  let ticks = 0;
  while (heatReserveOf(p.id) < 1 && ticks < 20000) { applyCold(p); __advance(1); ticks++; }
  check('  e reaquece muito mais rápido do que esfriou',
        ticks < COLD_SECONDS * 20 * 0.8 / 3,
        `(${ticks} ticks pra encher, contra ${Math.round(COLD_SECONDS * 20 * 0.8)} pra esvaziar)`);
}

// ===========================================================================
// TEMPESTADE DE AREIA
// ===========================================================================
console.log('\n--- tempestade de areia de Marte ---');

const DIA = 24000;

// --- 10. Determinística -----------------------------------------------------
{
  let iguais = true;
  for (let i = 0; i < 200; i++) {
    const t = i * 971, x = i * 37 - 3000, z = i * 53 - 2000;
    if (stormIntensity(t, x, z) !== stormIntensity(t, x, z)) { iguais = false; break; }
  }
  check('a mesma hora e o mesmo lugar dão sempre a mesma tempestade', iguais);
}

// --- 11. Nem todo dia tem, e os que têm crescem e passam --------------------
{
  let diasComTempestade = 0;
  const DIAS = 400;
  for (let d = 0; d < DIAS; d++) {
    if (stormIntensity(d * DIA + DIA / 2, 0, 0) > 0) diasComTempestade++;
  }
  const frac = diasComTempestade / DIAS;
  check('uma parte dos dias tem tempestade, não todos nem nenhum',
        frac > 0.1 && frac < 0.5, `(${(100 * frac).toFixed(0)}% dos dias)`);

  // um dia de tempestade, hora a hora
  let dia = -1;
  for (let d = 0; d < DIAS; d++) if (stormIntensity(d * DIA + DIA / 2, 0, 0) > 0) { dia = d; break; }
  const curva = [];
  for (let f = 0; f <= 20; f++) curva.push(stormIntensity(dia * DIA + f * DIA / 20, 0, 0));
  const meio = curva[10], inicio = curva[0], fim = curva[20];
  check('  ela nasce fraca, aperta no meio e passa',
        meio > inicio && meio > fim && inicio < 0.05 && fim < 0.05,
        `(início ${inicio.toFixed(2)}, meio ${meio.toFixed(2)}, fim ${fim.toFixed(2)})`);
  check('  e nunca passa de 1', Math.max(...curva) <= 1);
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

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
