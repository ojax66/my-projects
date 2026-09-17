/* Testa as rotas de viagem e o transporte do veículo.
 *
 * Roda contra um Bedrock falso: dimensões, entidades, structureManager e uma
 * fila de runTimeout que a gente avança tick a tick. Não prova que o jogo real
 * se comporta assim, mas prova o que quebrou antes — que o veículo saía de
 * cena e não voltava, e que só o Overworld tinha porta pro espaço.
 */
import { world, system, __reset, __advance, __state } from '@minecraft/server';
import { BODIES, SPACE_ENTRY_Y, DIMENSION_ID } from './space_dim/config.js';
import { PLANET_EXIT_Y } from './space_dim/planets.js';

// O pouso num planeta nosso passa por findValidSpot, que é assíncrono: ele
// gera as chunks em volta do alvo antes de dizer onde dá pra pisar. __advance
// roda a fila de runTimeout, mas não as microtarefas de uma Promise — então a
// espera tem que ser de verdade, senão o teste mede o estado de antes.
const settle = () => new Promise((r) => setTimeout(r, 0));

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
  // O orçamento de blocos é um só pro jogo inteiro e não é recarregado aqui.
  // __reset volta o relógio pra zero, então sem isto o tick 0 deste caso seria
  // o mesmo tick 0 do anterior — com o orçamento já gasto.
  const { resetBudget } = await import('./space_dim/budget.js');
  resetBudget();
  return import(`./space_dim/travel.js?v=${Math.random()}`);
}

const UFO = 'dlb_van:ufo';

function makePlayer(dimensionId, loc) {
  return world.__addPlayer({ id: 'p1', dimensionId, location: loc });
}

// --- 1. Subir leva pro espaço, de cada mundo que tem corpo lá em cima -------
//
// A mesma altitude nos três. Ela já foi 300 na Lua e em Marte, porque o teto de
// uma dimensão custom era 320; o Minecraft passou a deixar o addon escolher os
// limites verticais, e a regra voltou a ser uma só.
{
  const cases = [
    ['minecraft:overworld', 'earth', SPACE_ENTRY_Y],
    ['space_dim:moon', 'moon', PLANET_EXIT_Y],
    ['space_dim:mars', 'mars', PLANET_EXIT_Y],
  ];
  for (const [fromDim, bodyId, altura] of cases) {
    __reset();
    const travel = await loadTravel();
    const p = makePlayer(fromDim, { x: 10, y: altura + 1, z: 10 });
    travel.checkSpaceEntry(p);
    __advance(40);

    const body = BODIES.find(b => b.id === bodyId);
    const arrived = p.dimension.id === DIMENSION_ID;
    const near = arrived &&
      Math.hypot(p.location.x - body.arrival.x, p.location.z - body.arrival.z) <= 8;
    check(`${fromDim} a Y ${altura} leva pro espaço`, arrived, `(foi pra ${p.dimension.id})`);
    check(`  chega ao lado de ${bodyId}`, near,
          `(${Math.round(p.location.x)}, ${Math.round(p.location.z)} vs alvo ${body.arrival.x}, ${body.arrival.z})`);
  }

  // E o contrário: um bloco abaixo da altitude não pode abrir a porta — senão
  // construir uma torre alta viraria viagem.
  __reset();
  const travel = await loadTravel();
  const p = makePlayer('space_dim:moon', { x: 0, y: PLANET_EXIT_Y - 1, z: 0 });
  travel.checkSpaceEntry(p);
  __advance(40);
  check(`abaixo de ${PLANET_EXIT_Y} na Lua não viaja`, p.dimension.id === 'space_dim:moon');
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

// --- 4. As dimensões do Spacecraft não são mais porta -----------------------
//
// A Lua e Marte viraram dimensões NOSSAS. Subir na Lua deles, ou no canto do
// the_end onde os mundos legados deles põem os planetas, não leva mais a lugar
// nenhum — e não pode levar, senão o addon continuaria dependendo do outro.
{
  for (const dim of ['nv_sc:moon', 'nv_sc:mars', 'minecraft:the_end']) {
    __reset();
    const travel = await loadTravel();
    const p = makePlayer(dim, { x: 0, y: SPACE_ENTRY_Y + 1, z: 0 });
    travel.checkSpaceEntry(p);
    __advance(40);
    check(`${dim} não tem porta pro espaço`, p.dimension.id === dim,
          `(foi pra ${p.dimension.id})`);
  }
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

// --- 6. A nave vai junto pra TODO lugar, e o jogador chega montado ---------
//
// Já foi o contrário: eu deixava a nave no espaço quando o destino era a Lua ou
// Marte, porque ela aparecia dentro do planeta. Mas a causa não era o
// transporte — era a gravidade. `keepOutOfSolids` teleportava o piloto pra fora
// do corpo sólido (teleportar passageiro é desmontá-lo) e o puxão arrastava a
// nave no meio da viagem. Com as duas desligadas pra quem pilota, o transporte
// normal funciona nos três destinos.
{
  const rotas = [
    ['earth', 'minecraft:overworld'],
    ['moon', 'space_dim:moon'],
    ['mars', 'space_dim:mars'],
  ];
  for (const [bodyId, expectDim] of rotas) {
    __reset();
    const travel = await loadTravel();
    const body = BODIES.find(b => b.id === bodyId);
    const p = makePlayer(DIMENSION_ID, {
      x: body.center.x, y: body.center.y + body.radius + 1, z: body.center.z,
    });
    const ufo = world.__spawn(DIMENSION_ID, UFO, p.location);
    p.__mountOn(ufo);

    travel.checkBodyPortals(p);
    // O pouso num planeta espera findValidSpot; a volta pra Terra, não.
    await settle();
    __advance(60);

    const dest = world.getDimension(expectDim);
    const espaco = world.getDimension(DIMENSION_ID);
    check(`entrar em ${bodyId} leva pra ${expectDim}`, p.dimension.id === expectDim,
          `(foi pra ${p.dimension.id})`);
    check(`  a nave vai junto`, dest.getEntities({ type: UFO }).length === 1,
          `(${dest.getEntities({ type: UFO }).length} no destino)`);
    check(`  e não fica uma pra trás`, espaco.getEntities({ type: UFO }).length === 0,
          `(${espaco.getEntities({ type: UFO }).length} no espaço)`);
    check(`  o jogador chega MONTADO nela`, p.__ridingOn?.typeId === UFO,
          `(montado em ${p.__ridingOn?.typeId ?? 'nada'})`);
    check(`  nenhuma estrutura de veículo ficou guardada`,
          __state().structures.size === 0,
          `(sobraram: ${[...__state().structures.keys()].join(', ') || 'nenhuma'})`);
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

// --- Nave de três lugares: um veículo, três passageiros ---------------------
//
// Era tudo por JOGADOR: cada um salvava a própria estrutura, removia o veículo e
// recolocava um. Com a nave de três lugares do autor, o resultado no destino era
// três naves e os três a pé do lado delas, tendo que clicar pra entrar.
//
// A janela é o ponto delicado: ao serem desmontados os passageiros caem juntos,
// então cada um dispara a própria entrada no espaço alguns ticks depois. Quem
// chegar atrasado tem que encontrar o grupo, não viajar sozinho e sem nave.
{
  __reset();
  const travel = await loadTravel();
  const { forgetArrival } = await import('./space_dim/arrival.js');

  const alto = { x: 0, y: SPACE_ENTRY_Y + 1, z: 0 };
  const nave = world.__spawn('minecraft:overworld', UFO, alto);
  const tripulacao = ['p1', 'p2', 'p3'].map((id) => {
    forgetArrival(id);
    const p = world.__addPlayer({ id, dimensionId: 'minecraft:overworld', location: alto });
    p.__mountOn(nave);
    return p;
  });
  check('os três estão na mesma nave',
        tripulacao.every((p) => p.getComponent('riding')?.entityRidingOn === nave));

  // O piloto dispara primeiro; os outros dois alguns ticks depois, que é o que
  // acontece de verdade — eles são desmontados e continuam subindo.
  travel.checkSpaceEntry(tripulacao[0]);
  __advance(3);
  travel.checkSpaceEntry(tripulacao[1]);
  __advance(4);
  travel.checkSpaceEntry(tripulacao[2]);
  __advance(120);

  const space = world.getDimension(DIMENSION_ID);
  const naves = space.getEntities({ type: UFO });
  check('chega UMA nave no espaço, não uma por passageiro', naves.length === 1,
        `(${naves.length})`);
  check('  e nenhuma fica pra trás no mundo de origem',
        world.getDimension('minecraft:overworld').getEntities({ type: UFO }).length === 0);

  const montados = tripulacao.filter(
    (p) => p.getComponent('riding')?.entityRidingOn?.typeId === UFO);
  check('  e os três chegam JÁ montados nela', montados.length === 3,
        `(${montados.length} de 3)`);
  check('    todos na mesma nave',
        new Set(montados.map((p) => p.getComponent('riding').entityRidingOn.id)).size === 1);
  check('  e os três estão no espaço',
        tripulacao.every((p) => p.dimension.id === DIMENSION_ID));

  const sobraram = [...__state().structures.keys()].filter((k) => k.startsWith('space_dim:veh_'));
  check('  sem estrutura de veículo sobrando', sobraram.length === 0,
        `(${sobraram.join(', ') || 'nenhuma'})`);
}

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
