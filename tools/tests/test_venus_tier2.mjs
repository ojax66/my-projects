/* Vênus e a Nave Level 2.
 *
 * O que precisa valer:
 *   - SÓ o traje reforçado entra em Vênus. O básico não, e o básico é o que
 *     mais engana: ele resolve ar e frio, e nenhum dos dois é o problema lá.
 *   - a Level 1 NÃO sobrevive, e a Level 2 sobrevive
 *   - o traje básico aguenta o frio do espaço (o que ele pediu junto)
 *   - agachado o jogador guarda a nave, e não guarda com gente dentro
 *   - a Level 2 cabe na caixa que leva veículo entre dimensões
 *   - a geração de Vênus tem as proporções de Vênus
 */
import fs from 'node:fs';
import path from 'node:path';
import { world, system, __reset, __advance, ItemStack } from '@minecraft/server';
import { BODIES, BASIC_SUIT_PIECES, REINFORCED_SUIT_PIECES, STAR_ARMOR_PIECES,
         VENUS_CRUSH_SECONDS, TIER1_SHIP, TIER2_SHIP } from './gh/config.js';
import { applyVenus, applyVenusToShips, survivesVenus } from './gh/venus.js';
import { isWarm } from './gh/cold.js';
import { pickUp, eggFor, startShipPickup } from './gh/shipPickup.js';
import { PLANETS } from './gh/planets.js';
import { heightAt, biomeAt } from './gh/planetTerrain.js';
startShipPickup();

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};
const REPO = process.env.DH_REPO ?? '.';
const emVenus = (id) => world.__addPlayer({
  id, dimensionId: 'gh:venus', location: { x: 0, y: 80, z: 0 },
});

// --- 1. Quem entra em Vênus e quem não ------------------------------------
{
  __reset();
  const nu = emVenus('nu');
  const basico = emVenus('basico');
  const reforcado = emVenus('reforcado');
  const estrela = emVenus('estrela');
  for (const x of BASIC_SUIT_PIECES) basico.__wear(x.slot, x.item);
  for (const x of REINFORCED_SUIT_PIECES) reforcado.__wear(x.slot, x.item);
  for (const x of STAR_ARMOR_PIECES) estrela.__wear(x.slot, x.item);

  check('sem traje nenhum, Vênus mata', !survivesVenus(nu));
  // O caso que engana: o traje básico resolve ar e frio, e o que mata em Vênus
  // não é nenhum dos dois — são 92 atmosferas a 464 °C.
  check('  o traje BÁSICO não basta em Vênus', !survivesVenus(basico));
  check('  o reforçado basta', survivesVenus(reforcado));
  check('  e a armadura de estrela também', survivesVenus(estrela));

  // E o dano acontece de verdade, não é só a resposta de uma função.
  nu.__health = 20;
  let aviso = null;
  for (let i = 0; i < 60; i++) { aviso = applyVenus(nu) ?? aviso; __advance(1); }
  check('  quem está sem o traje certo perde vida', nu.__health < 20,
        `(${nu.__health} de 20)`);
  check('  e é avisado do que está acontecendo',
        typeof aviso === 'string' && /VENUS|VÊNUS/i.test(aviso), `(${aviso})`);

  reforcado.__health = 20;
  for (let i = 0; i < 60; i++) { applyVenus(reforcado); __advance(1); }
  check('  e quem está com o traje certo não perde nada',
        reforcado.__health === 20, `(${reforcado.__health} de 20)`);
}

// --- 2. O frio do espaço, que o traje básico agora aguenta -----------------
//
// Ele pediu as duas coisas juntas, e elas são opostas de propósito: o básico
// passou a segurar o FRIO e continua não segurando a PRESSÃO.
{
  __reset();
  const longe = { x: 5000, y: 100, z: 5000 };
  const basico = world.__addPlayer({ id: 'b3', dimensionId: 'gh:outer_space', location: longe });
  for (const x of BASIC_SUIT_PIECES) basico.__wear(x.slot, x.item);
  check('o traje básico aguenta o frio do espaço', isWarm(basico));
  check('  e mesmo assim não aguenta Vênus', !survivesVenus(basico));
}

// --- 3. A Level 1 é esmagada; a Level 2 não -------------------------------
{
  __reset();
  const p = emVenus('piloto');
  for (const x of REINFORCED_SUIT_PIECES) p.__wear(x.slot, x.item);
  const venus = world.getDimension('gh:venus');
  const t1 = world.__spawn('gh:venus', TIER1_SHIP, p.location);
  const t2 = world.__spawn('gh:venus', TIER2_SHIP, p.location);

  let ultimoAviso = null;
  for (let i = 0; i < VENUS_CRUSH_SECONDS * 20 + 40; i++) {
    ultimoAviso = applyVenusToShips(p) ?? ultimoAviso;
    __advance(1);
  }
  check('a Level 1 não sobrevive a Vênus',
        venus.getEntities({ type: TIER1_SHIP }).length === 0,
        `(${venus.getEntities({ type: TIER1_SHIP }).length} sobrou/sobraram)`);
  check('  e a Level 2 sobrevive',
        venus.getEntities({ type: TIER2_SHIP }).length === 1,
        `(${venus.getEntities({ type: TIER2_SHIP }).length})`);
}

// --- 4. Guardar a nave agachado -------------------------------------------
{
  __reset();
  const p = emVenus('guarda');
  p.dimension = world.getDimension('minecraft:overworld');
  const dim = world.getDimension('minecraft:overworld');
  const nave = world.__spawn('minecraft:overworld', TIER2_SHIP, { x: 0, y: 64, z: 0 });

  check('a Level 2 tem ovo pra guardar', eggFor(TIER2_SHIP) !== null,
        `(${eggFor(TIER2_SHIP)})`);
  check('  e a Level 1 também', eggFor(TIER1_SHIP) !== null);
  // A nave de id antigo é a mesma nave: quem jogava antes da troca de
  // namespace guarda a dele igual.
  check('  inclusive a de id antigo', eggFor('nave:level_1_spaceship') !== null);
  check('  e um mob qualquer não vira ovo de nave',
        eggFor('minecraft:cow') === null);

  const r = pickUp(p, nave);
  check('agachado, a nave vai pro inventário', r === 'ok', `(${r})`);
  check('  e some do mundo', dim.getEntities({ type: TIER2_SHIP }).length === 0);
  const inv = p.getComponent('inventory').container;
  let achou = 0;
  for (let i = 0; i < 36; i++) {
    if (inv.getItem(i)?.typeId === 'gh:level_2_spaceship_spawn_egg') achou++;
  }
  check('  como o ovo dela', achou === 1, `(${achou})`);
}

// --- 5. Com gente dentro, não guarda --------------------------------------
//
// Guardar uma nave com passageiro é fazer os passageiros sumirem junto: o jogo
// não tem pra onde mandá-los.
{
  __reset();
  const dono = world.__addPlayer({ id: 'd', dimensionId: 'minecraft:overworld',
                                   location: { x: 0, y: 64, z: 0 } });
  const carona = world.__addPlayer({ id: 'c', dimensionId: 'minecraft:overworld',
                                     location: { x: 0, y: 64, z: 0 } });
  const nave = world.__spawn('minecraft:overworld', TIER2_SHIP, { x: 0, y: 64, z: 0 });
  carona.__mountOn(nave);

  const r = pickUp(dono, nave);
  check('com gente dentro a nave não é guardada', r === 'ocupada', `(${r})`);
  check('  e ela continua no mundo',
        world.getDimension('minecraft:overworld')
             .getEntities({ type: TIER2_SHIP }).length === 1);
}

// --- 6. A Level 2 cabe na caixa que leva veículo entre dimensões ----------
//
// Veículo que não cabe não entra na estrutura, e a estrutura sai VAZIA sem
// erro nenhum — foi exatamente assim que a Level 1 sumia.
{
  const bp = path.join(REPO, 'packs/Galactic Horizons BP');
  const doc = JSON.parse(fs.readFileSync(
    path.join(bp, 'entities/level_2_spaceship.json'), 'utf8'));
  const cb = doc['minecraft:entity'].components['minecraft:collision_box'];
  const veh = fs.readFileSync(path.join(bp, 'scripts/gh/vehicle.js'), 'utf8');
  const half = Number(/const SAVE_HALF = (\d+)/.exec(veh)[1]);
  const abaixo = Number(/const SAVE_BELOW = (\d+)/.exec(veh)[1]);
  const acima = Number(/const SAVE_ABOVE = (\d+)/.exec(veh)[1]);
  check('a Level 2 cabe na caixa de captura na largura',
        half * 2 + 1 >= cb.width, `(caixa ${half * 2 + 1}, nave ${cb.width})`);
  check('  e na altura', abaixo + acima + 1 >= cb.height,
        `(caixa ${abaixo + acima + 1}, nave ${cb.height})`);

  const rid = doc['minecraft:entity'].components['minecraft:rideable'];
  check('  e leva três pessoas', rid.seat_count === 3, `(${rid.seat_count})`);
  check('  com os assentos atrás', rid.seats.every((s) => s.position[2] > 0),
        `(z: ${rid.seats.map((s) => s.position[2]).join(', ')})`);
}

// --- 7. Vênus é Vênus: as proporções do planeta de verdade ----------------
{
  const venus = PLANETS.find((p) => p.id === 'venus');
  check('Vênus está na lista de planetas', !!venus);
  check('  e não tem gelo nenhum', venus.blocks.ice === null,
        `(${venus.blocks.ice})`);
  // Cratera pequena não existe em Vênus: a atmosfera queima qualquer coisa
  // menor que ~1 km antes de chegar ao chão. É a assinatura do planeta.
  check('  e só tem UMA escala de cratera, grande e rara',
        venus.craters.length === 1 && venus.craters[0].chance < 0.25
        && venus.craters[0].rMin > 40,
        `(${venus.craters.length} escala(s), chance ${venus.craters[0].chance})`);

  const conta = new Map();
  for (let x = -6000; x <= 6000; x += 60) {
    for (let z = -3000; z <= 3000; z += 60) {
      const b = biomeAt(venus, x, z);
      conta.set(b.id, (conta.get(b.id) ?? 0) + 1);
    }
  }
  const total = [...conta.values()].reduce((a, b) => a + b, 0);
  const pct = (id) => (100 * (conta.get(id) ?? 0)) / total;
  // Mais de 80% de Vênus são planícies de lava; as tesserae são ~8%.
  check('  a maior parte do planeta é planície de lava',
        pct('planicies_de_lava') > 55,
        `(${pct('planicies_de_lava').toFixed(1)}%)`);
  check('  as tesserae são minoria, como na Vênus de verdade',
        pct('tesserae') > 2 && pct('tesserae') < 20,
        `(${pct('tesserae').toFixed(1)}%)`);
  check('  e os cinco biomas aparecem', conta.size === 5,
        `(${conta.size}: ${[...conta.keys()].join(', ')})`);

  // E o terreno não é uma placa lisa.
  //
  // Medido em MUITAS linhas, não numa: todo planeta tem trechos chapados, e a
  // primeira versão deste teste pegou justamente um deles em Vênus e reprovou
  // um planeta que estava certo. O que vale é a MEDIANA — e ela é comparada
  // com a da Lua, que é o relevo que ele já aprovou, pra a conta não virar um
  // número solto que qualquer ajuste futuro desafina.
  const desnivel = (planeta) => {
    const a = [];
    for (let cz = -3000; cz <= 3000; cz += 211) {
      for (let cx = -3000; cx <= 3000; cx += 211) {
        let lo = Infinity, hi = -Infinity;
        for (let x = cx; x < cx + 300; x += 3) {
          const h = heightAt(planeta, x, cz);
          if (h < lo) lo = h;
          if (h > hi) hi = h;
        }
        a.push(hi - lo);
      }
    }
    a.sort((x, y) => x - y);
    return a[Math.floor(a.length / 2)];
  };
  const lua = PLANETS.find((x) => x.id === 'moon');
  const dv = desnivel(venus), dl = desnivel(lua);
  check('  e o relevo andando não é menor que o da Lua', dv >= dl,
        `(Vênus ${dv}, Lua ${dl} blocos em 300)`);
}

// --- 8. O corpo de Vênus no espaço ----------------------------------------
{
  const venus = BODIES.find((b) => b.id === 'venus');
  check('Vênus existe como corpo no espaço', !!venus);
  check('  com portal pra dimensão dela',
        venus.portal?.dimension === 'gh:venus', `(${venus.portal?.dimension})`);
  // Vênus é a gêmea da Terra em tamanho: 95% do diâmetro dela.
  const terra = BODIES.find((b) => b.id === 'earth');
  check('  e do tamanho da Terra, que é o que ela é',
        Math.abs(venus.radius - terra.radius) <= 2,
        `(Vênus ${venus.radius}, Terra ${terra.radius})`);
  // Entre o Sol e a Terra, que é a órbita dela.
  const sol = BODIES.find((b) => b.id === 'sun');
  const d = (a, b) => Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z);
  check('  e entre o Sol e a Terra', d(venus, sol) < d(terra, sol),
        `(Vênus a ${d(venus, sol).toFixed(0)} do Sol, Terra a ${d(terra, sol).toFixed(0)})`);
}

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
