/* Testa as rotas de viagem e o transporte do veículo.
 *
 * Roda contra um Bedrock falso: dimensões, entidades, structureManager e uma
 * fila de runTimeout que a gente avança tick a tick. Não prova que o jogo real
 * se comporta assim, mas prova o que quebrou antes — que o veículo saía de
 * cena e não voltava, e que só o Overworld tinha porta pro espaço.
 */
import { world, system, __reset, __advance, __state } from '@minecraft/server';
import { BODIES, SPACE_ENTRY_Y, DIMENSION_ID, SPACECRAFT_LEGACY_ORIGINS } from './space_dim/config.js';

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

// travel.js liga handlers no import; recarrega por teste via cache-buster.
//
// arrival.js NÃO é recarregado junto: travel.js importa './arrival.js' sem
// buster, então é sempre o mesmo módulo, e a carência de chegada de um teste
// vazaria pro seguinte (o __reset volta o tick pra zero, e uma marca antiga
// fica valendo pra sempre). Por isso a marca do jogador de teste é apagada na
// mão a cada carga — é a mesma função que o playerLeave usa.
async function loadTravel() {
  const { forgetArrival } = await import('./space_dim/arrival.js');
  forgetArrival('p1');
  return import(`./space_dim/travel.js?v=${Math.random()}`);
}

const UFO = 'dlb_van:ufo';

function makePlayer(dimensionId, loc) {
  return world.__addPlayer({ id: 'p1', dimensionId, location: loc });
}

// --- 1. Subir a Y 800 leva pro espaço, de cada mundo que tem corpo lá -------
{
  const cases = [
    ['minecraft:overworld', 'earth'],
    ['nv_sc:moon', 'moon'],
    ['nv_sc:mars', 'mars'],
  ];
  for (const [fromDim, bodyId] of cases) {
    __reset();
    const travel = await loadTravel();
    const p = makePlayer(fromDim, { x: 10, y: SPACE_ENTRY_Y + 1, z: 10 });
    travel.checkSpaceEntry(p);
    __advance(40);

    const body = BODIES.find(b => b.id === bodyId);
    const arrived = p.dimension.id === DIMENSION_ID;
    const near = arrived &&
      Math.hypot(p.location.x - body.arrival.x, p.location.z - body.arrival.z) <= 8;
    check(`${fromDim} a Y ${SPACE_ENTRY_Y} leva pro espaço`, arrived, `(foi pra ${p.dimension.id})`);
    check(`  chega ao lado de ${bodyId}`, near,
          `(${Math.round(p.location.x)}, ${Math.round(p.location.z)} vs alvo ${body.arrival.x}, ${body.arrival.z})`);
  }
}

// --- 2. Abaixo da altitude, nada acontece -----------------------------------
{
  __reset();
  const travel = await loadTravel();
  const p = makePlayer('minecraft:overworld', { x: 0, y: SPACE_ENTRY_Y - 1, z: 0 });
  travel.checkSpaceEntry(p);
  __advance(40);
  check('abaixo da altitude não viaja', p.dimension.id === 'minecraft:overworld');
}

// --- 3. Mundo sem corpo correspondente não tem porta ------------------------
{
  __reset();
  const travel = await loadTravel();
  const p = makePlayer('minecraft:nether', { x: 0, y: SPACE_ENTRY_Y + 5, z: 0 });
  travel.checkSpaceEntry(p);
  __advance(40);
  check('Nether não tem porta pro espaço', p.dimension.id === 'minecraft:nether');
}

// --- 4. the_end legado: só sobre a área do planeta --------------------------
{
  __reset();
  let travel = await loadTravel();
  const o = SPACECRAFT_LEGACY_ORIGINS['nv_sc:moon'];
  const onMoon = makePlayer('minecraft:the_end', { x: o.x, y: SPACE_ENTRY_Y + 1, z: o.z });
  travel.checkSpaceEntry(onMoon);
  __advance(40);
  check('the_end sobre a área da Lua leva pro espaço', onMoon.dimension.id === DIMENSION_ID);

  __reset();
  travel = await loadTravel();
  const elsewhere = makePlayer('minecraft:the_end', { x: 0, y: SPACE_ENTRY_Y + 1, z: 0 });
  travel.checkSpaceEntry(elsewhere);
  __advance(40);
  check('the_end longe dos planetas não leva', elsewhere.dimension.id === 'minecraft:the_end');
}

// --- 5. O OVNI vai junto — o bug relatado -----------------------------------
{
  __reset();
  const travel = await loadTravel();
  const p = makePlayer('minecraft:overworld', { x: 0, y: SPACE_ENTRY_Y + 1, z: 0 });
  const ufo = world.__spawn('minecraft:overworld', UFO, { x: 0, y: SPACE_ENTRY_Y + 1, z: 0 });
  p.__mountOn(ufo);

  travel.checkSpaceEntry(p);
  __advance(60);

  const space = world.getDimension(DIMENSION_ID);
  const ufos = space.getEntities({ type: UFO });
  check('o OVNI chega no espaço junto', ufos.length === 1,
        `(${ufos.length} no espaço, ${world.getDimension('minecraft:overworld').getEntities({ type: UFO }).length} deixados pra trás)`);
  check('o jogador volta montado nele', p.__ridingOn?.typeId === UFO,
        `(montado em ${p.__ridingOn?.typeId ?? 'nada'})`);
  check('nenhuma estrutura de veículo ficou guardada',
        __state().structures.size === 0,
        `(sobraram: ${[...__state().structures.keys()].join(', ') || 'nenhuma'})`);
}

// --- 5b. O veículo é salvo onde ele ESTÁ, não onde estava -------------------
//
// A captura anotava a posição no começo da viagem e, ticks depois, salvava uma
// caixa de 1 bloco naquele ponto. Se a entidade tivesse andado um bloco que
// fosse, a estrutura saía VAZIA — sem erro nenhum — e o que chegava no destino
// era um OVNI novo em folha, sem cor, sem vida, sem nada.
//
// A marca no OVNI original é o que separa os dois casos: estrutura preserva
// tag, `spawnEntity` do zero não.
{
  __reset();
  const travel = await loadTravel();
  const p = makePlayer('minecraft:overworld', { x: 0, y: SPACE_ENTRY_Y + 1, z: 0 });
  const ufo = world.__spawn('minecraft:overworld', UFO, { x: 0, y: SPACE_ENTRY_Y + 1, z: 0 });
  ufo.addTag('marca_do_original');
  p.__mountOn(ufo);

  travel.checkSpaceEntry(p);

  // Dois ticks depois de começar, o OVNI anda um bloco — como qualquer
  // entidade solta faz enquanto ninguém a está pilotando.
  __advance(2);
  ufo.teleport({ x: ufo.location.x + 1, y: ufo.location.y, z: ufo.location.z - 1 });
  __advance(80);

  const space = world.getDimension(DIMENSION_ID);
  const arrived = space.getEntities({ type: UFO });
  check('o OVNI que andou um bloco ainda é capturado', arrived.length === 1,
        `(${arrived.length} no espaço)`);
  check('  e é o mesmo OVNI, não um recriado do zero',
        arrived[0]?.hasTag('marca_do_original') === true,
        arrived[0] ? (arrived[0].hasTag('marca_do_original') ? '(marca preservada)' : '(marca perdida)') : '(nenhum)');
}

// --- 5c. Jogador e veículo nunca se separam ---------------------------------
//
// O `minecraft:entity_spawned` do OVNI do Vehicles arremessa a entidade 19
// blocos pra cima e liga um timer de despawn quando o jogador mais próximo
// está a mais de 6 blocos. A captura descia o OVNI pro teto do mundo e deixava
// o jogador a Y 800: 480 blocos de separação, exatamente o que aquela regra
// pune. Agora os dois descem juntos.
{
  __reset();
  const travel = await loadTravel();
  const p = makePlayer('minecraft:overworld', { x: 0, y: SPACE_ENTRY_Y + 1, z: 0 });
  const ufo = world.__spawn('minecraft:overworld', UFO, { x: 0, y: SPACE_ENTRY_Y + 1, z: 0 });
  p.__mountOn(ufo);

  travel.checkSpaceEntry(p);

  let pior = 0;
  for (let i = 0; i < 20; i++) {
    __advance(1);
    if (!ufo.isValid) break;               // já foi salvo e apagado
    if (p.dimension.id !== ufo.dimension.id) break;
    pior = Math.max(pior, Math.hypot(
      p.location.x - ufo.location.x,
      p.location.y - ufo.location.y,
      p.location.z - ufo.location.z));
  }
  __advance(80);

  check('jogador e OVNI ficam a menos de 6 blocos durante a captura', pior < 6,
        `(pior distância: ${pior.toFixed(1)} blocos)`);
}

// --- 6. O OVNI vai junto na volta pra Terra e no pouso na Lua/Marte ---------
{
  const routes = [
    ['earth', 'minecraft:overworld'],
    ['moon', 'nv_sc:moon'],
    ['mars', 'nv_sc:mars'],
  ];
  for (const [bodyId, expectDim] of routes) {
    __reset();
    const travel = await loadTravel();
    const body = BODIES.find(b => b.id === bodyId);
    // Encostando na superfície do corpo, dentro do espaço.
    const p = makePlayer(DIMENSION_ID, {
      x: body.center.x, y: body.center.y + body.radius + 1, z: body.center.z,
    });
    const ufo = world.__spawn(DIMENSION_ID, UFO, p.location);
    p.__mountOn(ufo);

    travel.checkBodyPortals(p);
    __advance(60);

    const dest = world.getDimension(expectDim);
    check(`entrar em ${bodyId} leva pra ${expectDim}`, p.dimension.id === expectDim,
          `(foi pra ${p.dimension.id})`);
    check(`  o OVNI vai junto`, dest.getEntities({ type: UFO }).length === 1,
          `(${dest.getEntities({ type: UFO }).length} no destino)`);
    check(`  e o jogador segue montado`, p.__ridingOn?.typeId === UFO);
  }
}

// --- 7. O foguete do Spacecraft NÃO é sequestrado --------------------------
{
  __reset();
  const travel = await loadTravel();
  const p = makePlayer('minecraft:overworld', { x: 0, y: SPACE_ENTRY_Y + 1, z: 0 });
  const rocket = world.__spawn('minecraft:overworld', 'nv_sc:small_rocket', p.location);
  p.__mountOn(rocket);

  travel.checkSpaceEntry(p);
  __advance(40);
  check('foguete do Spacecraft em lançamento é deixado em paz',
        p.dimension.id === 'minecraft:overworld');
}

// --- 8. Sem veículo continua funcionando ------------------------------------
{
  __reset();
  const travel = await loadTravel();
  const p = makePlayer('minecraft:overworld', { x: 0, y: SPACE_ENTRY_Y + 1, z: 0 });
  travel.checkSpaceEntry(p);
  __advance(40);
  check('a pé também viaja', p.dimension.id === DIMENSION_ID);
  // getEntities({}) inclui o proprio jogador — conta so o que nao e jogador.
  const spawned = world.getDimension(DIMENSION_ID)
    .getEntities({}).filter(e => e.typeId !== 'minecraft:player');
  check('sem veículo, nada é criado no destino', spawned.length === 0,
        `(criou: ${spawned.map(e => e.typeId).join(', ') || 'nada'})`);
}

// --- 9. Se a estrutura falhar, o jogador não fica a pé ----------------------
{
  __reset();
  const travel = await loadTravel();
  __state().breakStructures = true;   // createFromWorld/place lançam
  const p = makePlayer('minecraft:overworld', { x: 0, y: SPACE_ENTRY_Y + 1, z: 0 });
  const ufo = world.__spawn('minecraft:overworld', UFO, p.location);
  p.__mountOn(ufo);

  travel.checkSpaceEntry(p);
  __advance(60);

  const ufos = world.getDimension(DIMENSION_ID).getEntities({ type: UFO });
  check('com structureManager quebrado, ainda sai um veículo do tipo certo',
        ufos.length === 1, `(${ufos.length})`);
  check('  e o jogador monta nele', p.__ridingOn?.typeId === UFO);
}

// --- 10. Não dispara duas viagens ao mesmo tempo ----------------------------
{
  __reset();
  const travel = await loadTravel();
  const p = makePlayer('minecraft:overworld', { x: 0, y: SPACE_ENTRY_Y + 1, z: 0 });
  const ufo = world.__spawn('minecraft:overworld', UFO, p.location);
  p.__mountOn(ufo);

  travel.checkSpaceEntry(p);
  travel.checkSpaceEntry(p);   // segundo tick, ainda viajando
  __advance(3);
  travel.checkSpaceEntry(p);
  __advance(60);

  const ufos = world.getDimension(DIMENSION_ID).getEntities({ type: UFO });
  check('chamadas repetidas não duplicam o veículo', ufos.length === 1, `(${ufos.length})`);
}

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
