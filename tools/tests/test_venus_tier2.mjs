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
         VENUS_CRUSH_SECONDS, TIER1_SHIP, TIER2_SHIP,
         VENUS_WALK_CAP, VENUS_JUMP_SPEED,
         ACID_BLOCK, ACID_BUCKET, TITANIUM_BUCKET,
         ACID_AIR_SECONDS, ACID_SINK, ACID_SWIM_CAP } from './gh/config.js';
import { columnRunsAt, terrainAt } from './gh/planetTerrain.js';
import { EARTH_G } from './gh/planetGravity.js';
import { inPressurizedVehicle } from './gh/lifeSupport.js';
import { applyVenus, applyVenusToShips, survivesVenus,
         applyVenusMovement } from './gh/venus.js';
import { isWarm } from './gh/cold.js';
import { canBreathe } from './gh/lifeSupport.js';
import { pickUp, eggFor, startShipPickup } from './gh/shipPickup.js';
import { encher, despejar, applyAcid, feetInAcid, headInAcid,
         acidFogOn, airOf, startAcid, acidReport } from './gh/acid.js';
import { PLANETS } from './gh/planets.js';
import { heightAt, biomeAt, terrainAt as terrenoEm } from './gh/planetTerrain.js';
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
  // TRÊS assentos, e o DO MEIO é o do piloto.
  //
  // O modelo novo tem três bancos desenhados (os ossos seat/seat2/seat3), e as
  // posições saem deles — o jogador senta em cima do banco que se vê na tela.
  check('  e leva três pessoas', rid.seat_count === 3, `(${rid.seat_count})`);
  const piloto = rid.seats[rid.controlling_seat ?? 0];
  check('    com o assento do meio pilotando', piloto.position[0] === 0,
        `(x ${piloto.position[0]}, índice ${rid.controlling_seat})`);
  // Quem monta primeiro cai no índice 0: se o do meio não for o 0, o primeiro
  // a entrar senta na lateral e não pilota nada.
  check('    e ele é o índice 0, que é onde o primeiro a entrar senta',
        (rid.controlling_seat ?? 0) === 0, `(${rid.controlling_seat})`);
  // Os três dentro do casco: meia largura do modelo é 5,75/2 = 2,88 blocos.
  check('    e os três dentro do casco',
        rid.seats.every((s) => Math.abs(s.position[0]) < 2.88
                            && Math.abs(s.position[2]) < 2.88),
        `(x: ${rid.seats.map((s) => s.position[0]).join(', ')})`);
  // Um de cada lado do piloto, e não dois empilhados no mesmo lugar.
  const xs = rid.seats.map((s) => s.position[0]).sort((a, b) => a - b);
  check('    um de cada lado do piloto', xs[0] < 0 && xs[1] === 0 && xs[2] > 0,
        `(${xs.join(', ')})`);
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

// --- 9. Em Vênus não se corre ---------------------------------------------
//
// O ar lá tem 65 kg/m³, 6,5% da densidade da água: andar na superfície de
// Vênus está mais perto de andar no fundo de uma piscina.
{
  __reset();
  const p = emVenus('corredor');
  p.isOnGround = true;

  // Correndo: 0,13 bloco por tick é a velocidade de corrida do Minecraft.
  p.__setVelocity({ x: 0.13, y: 0, z: 0 });
  const r = applyVenusMovement(p);
  check('correndo, Vênus freia', r.correu > 0, `(freou ${r.correu.toFixed(3)})`);
  const depois = Math.hypot(p.getVelocity().x, p.getVelocity().z);
  check('  e a velocidade cai pro teto de andar',
        Math.abs(depois - VENUS_WALK_CAP) < 0.002,
        `(${depois.toFixed(3)}, teto ${VENUS_WALK_CAP})`);

  // Andando: não é freado. Brigar com quem caminha seria travar o jogo.
  __reset();
  const q = emVenus('andarilho');
  q.isOnGround = true;
  q.__setVelocity({ x: 0.10, y: 0, z: 0 });
  const r2 = applyVenusMovement(q);
  check('  mas quem só anda não é freado', r2.correu === 0,
        `(freou ${r2.correu})`);

  // E fora de Vênus nada disso acontece.
  __reset();
  const t = world.__addPlayer({ id: 'terra', dimensionId: 'minecraft:overworld',
                                location: { x: 0, y: 64, z: 0 } });
  t.isOnGround = true;
  t.__setVelocity({ x: 0.13, y: 0, z: 0 });
  check('  e na Terra ninguém é freado', applyVenusMovement(t).correu === 0);
}

// --- 10. O pulo em Vênus sobe UM bloco ------------------------------------
{
  __reset();
  const p = emVenus('saltador');
  p.isOnGround = true;
  applyVenusMovement(p);            // primeiro tick: ainda no chão

  // Pulou: o jogo dá 0,42 de velocidade vertical.
  p.isOnGround = false;
  p.__setVelocity({ x: 0, y: 0.42, z: 0 });
  const r = applyVenusMovement(p);
  check('o pulo em Vênus é freado na decolagem', r.pulou > 0,
        `(freou ${r.pulou.toFixed(3)})`);
  const vy = p.getVelocity().y;
  check('  até a velocidade que sobe um bloco',
        Math.abs(vy - VENUS_JUMP_SPEED) < 0.001,
        `(${vy.toFixed(3)}, alvo ${VENUS_JUMP_SPEED})`);

  // E a altura que isso dá, no modelo do próprio jogo.
  const venus = PLANETS.find((x) => x.id === 'venus');
  const g = EARTH_G * venus.gravity.factor;
  const apice = (v0) => { let v = v0, y = 0; while (v > 0) { y += v; v -= g; } return y; };
  const h = apice(VENUS_JUMP_SPEED);
  check('  que é um bloco: sobe em cima de um, não de dois',
        h >= 1.0 && h < 1.5, `(${h.toFixed(2)} blocos)`);
  check('  e sem o freio seria mais alto que na Terra',
        apice(0.42) > 1.32, `(${apice(0.42).toFixed(2)} vs 1.32 da Terra)`);

  // Já no ar, o freio não age de novo: clampar tick a tick daria velocidade
  // constante pra cima, ou seja, um pulo MAIOR.
  p.__setVelocity({ x: 0, y: 0.42, z: 0 });
  check('  e o freio é só na decolagem, não o voo todo',
        applyVenusMovement(p).pulou === 0);
}

// --- 11. A Level 2 protege no espaço igual à Level 1 ----------------------
{
  __reset();
  const p = world.__addPlayer({ id: 'piloto2', dimensionId: 'gh:outer_space',
                                location: { x: 5000, y: 100, z: 5000 } });
  const t1 = world.__spawn('gh:outer_space', TIER1_SHIP, p.location);
  p.__mountOn(t1);
  check('dentro da Level 1 a cabine é pressurizada', inPressurizedVehicle(p));

  __reset();
  const q = world.__addPlayer({ id: 'piloto3', dimensionId: 'gh:outer_space',
                                location: { x: 5000, y: 100, z: 5000 } });
  const t2 = world.__spawn('gh:outer_space', TIER2_SHIP, q.location);
  q.__mountOn(t2);
  check('  e dentro da Level 2 também', inPressurizedVehicle(q));
  // O que seria absurdo: a nave que aguenta 92 atmosferas de Vênus não
  // pressurizar a cabine no vácuo.
  check('  logo ela respira no espaço igual', canBreathe(q));
}

// --- 12. As quatro camadas de atmosfera de Vênus --------------------------
//
// Elas são cubos concêntricos NO MESMO modelo do corpo, com o cubo do corpo
// POR ÚLTIMO — casca em entidade separada vira um quadrado tapando o planeta.
{
  const venus = BODIES.find((b) => b.id === 'venus');
  check('Vênus tem atmosfera desenhada', !!venus.atmosphere);
  check('  com quatro camadas, como a de verdade',
        venus.atmosphere.rings.length === 4,
        `(${venus.atmosphere.rings.length})`);
  check('  e alcance maior que o corpo',
        venus.atmosphere.reach > 1, `(${venus.atmosphere.reach})`);

  const geo = JSON.parse(fs.readFileSync(path.join(REPO,
    'packs/Galactic Horizons RP/models/entity/sky_venus.geo.json'), 'utf8'));
  const cubos = geo['minecraft:geometry'][0].bones[0].cubes;
  check('  o modelo tem as quatro mais o corpo',
        cubos.length === venus.atmosphere.rings.length + 1, `(${cubos.length})`);

  // De fora pra dentro, e o corpo por último: é essa ordem que faz o planeta
  // tapar o miolo dos anéis em vez de o contrário.
  const tamanhos = cubos.map((c) => c.size[0]);
  const decrescente = tamanhos.every((t, i) => i === 0 || t < tamanhos[i - 1]);
  check('    em ordem, de fora pra dentro', decrescente,
        `(${tamanhos.join(' > ')})`);
  check('    e o corpo por último, no tamanho do corpo',
        tamanhos[tamanhos.length - 1] === 16, `(${tamanhos[tamanhos.length - 1]})`);

  const ent = JSON.parse(fs.readFileSync(path.join(REPO,
    'packs/Galactic Horizons RP/entity/sky_venus.entity.json'), 'utf8'));
  const d = ent['minecraft:client_entity'].description;
  check('  com o material que deixa o corpo aparecer atrás dos anéis',
        d.materials.default === 'gh_halo', `(${d.materials.default})`);
  check('    e a geometria própria dela',
        d.geometry.default === 'geometry.gh.sky_venus', `(${d.geometry.default})`);
}

// --- 13. O ácido sulfúrico: só o balde de titânio -------------------------
//
// O bloco é indestrutível de propósito, então o balde é o ÚNICO jeito de tirar
// ácido do mundo. Se um balde de ferro funcionasse, a regra não existiria.
{
  __reset();
  const p = emVenus('quimico');
  const dim = world.getDimension('gh:venus');
  const poca = { x: 3, y: 70, z: 3 };
  const inv = p.getComponent('inventory').container;

  // (a) com o balde de titânio: enche e a poça some.
  dim.setBlockType(poca, ACID_BLOCK);
  inv.setItem(0, new ItemStack(TITANIUM_BUCKET, 1));
  p.selectedSlotIndex = 0;
  const r = encher(p, dim.getBlock(poca));
  check('o balde de titânio enche na poça', r === 'ok', `(${r})`);
  check('  e sai com ácido na mão', inv.getItem(0)?.typeId === ACID_BUCKET,
        `(${inv.getItem(0)?.typeId})`);
  check('  e a poça some', dim.getBlock(poca)?.typeId === 'minecraft:air',
        `(${dim.getBlock(poca)?.typeId})`);

  // (b) com balde de ferro: recusa, e diz por quê.
  dim.setBlockType(poca, ACID_BLOCK);
  inv.setItem(0, new ItemStack('minecraft:bucket', 1));
  const r2 = encher(p, dim.getBlock(poca));
  check('o balde de ferro NÃO enche', r2 === 'errado', `(${r2})`);
  check('  e a poça continua lá', dim.getBlock(poca)?.typeId === ACID_BLOCK);
  check('  e o balde de ferro continua na mão',
        inv.getItem(0)?.typeId === 'minecraft:bucket');

  // (c) de mão vazia também não.
  inv.setItem(0, undefined);
  check('de mão vazia não enche', encher(p, dim.getBlock(poca)) === 'nao');

  // (d) despejar devolve o balde vazio.
  const chao = { x: 9, y: 70, z: 9 };
  dim.setBlockType(chao, 'gh:venus_rock');
  dim.setBlockType({ x: 9, y: 71, z: 9 }, 'minecraft:air');
  inv.setItem(0, new ItemStack(ACID_BUCKET, 1));
  const ok = despejar(p, dim.getBlock(chao), 'Up');
  check('despejar põe ácido em cima do bloco mirado', ok
        && dim.getBlock({ x: 9, y: 71, z: 9 })?.typeId === ACID_BLOCK,
        `(${dim.getBlock({ x: 9, y: 71, z: 9 })?.typeId})`);
  check('  e devolve o balde vazio',
        inv.getItem(0)?.typeId === TITANIUM_BUCKET, `(${inv.getItem(0)?.typeId})`);
}

// --- 14. Dentro da poça, o ácido queima ----------------------------------
//
// O traje ajuda e NÃO salva: em Vênus só entra quem tem o reforçado, então um
// traje que anulasse o ácido faria a poça não ser perigo pra ninguém que
// consegue chegar lá.
{
  __reset();
  const dim = world.getDimension('gh:venus');
  const medir = (equipar) => {
    const q = world.__addPlayer({ id: 'a' + Math.random(), dimensionId: 'gh:venus',
                                  location: { x: 0.5, y: 70.5, z: 0.5 } });
    if (equipar) for (const x of equipar) q.__wear(x.slot, x.item);
    dim.setBlockType({ x: 0, y: 70, z: 0 }, ACID_BLOCK);
    q.__health = 20;
    let av = null;
    for (let i = 0; i < 40; i++) { av = applyAcid(q) ?? av; __advance(1); }
    return { perdeu: 20 - q.__health, aviso: av };
  };
  const nu = medir(null);
  const suit = medir(REINFORCED_SUIT_PIECES);
  const star = medir(STAR_ARMOR_PIECES);

  check('dentro da poça o ácido queima', nu.perdeu > 0, `(${nu.perdeu} de vida)`);
  check('  e avisa o que é', /ÁCIDO|ACID/i.test(nu.aviso ?? ''), `(${nu.aviso})`);
  check('  o traje reforçado ajuda', suit.perdeu < nu.perdeu,
        `(${suit.perdeu} contra ${nu.perdeu})`);
  check('  a armadura de estrela ajuda mais', star.perdeu < suit.perdeu,
        `(${star.perdeu})`);
  check('  mas NENHUM dos dois zera', star.perdeu > 0, `(${star.perdeu})`);

  // Fora da poça, nada.
  const fora = world.__addPlayer({ id: 'seco', dimensionId: 'gh:venus',
                                   location: { x: 40.5, y: 70.5, z: 40.5 } });
  fora.__health = 20;
  for (let i = 0; i < 40; i++) { applyAcid(fora); __advance(1); }
  check('  e fora da poça ninguém se queima', fora.__health === 20,
        `(${fora.__health} de 20)`);
}

// --- 15. As poças estão no mundo, e só na planície -----------------------
{
  const venus = PLANETS.find((x) => x.id === 'venus');
  check('Vênus tem poças de ácido', !!venus.acidPools);
  check('  e um bloco de ácido declarado',
        venus.blocks.acid === ACID_BLOCK, `(${venus.blocks.acid})`);

  let colunas = 0, comAcido = 0, maisFundo = 0;
  const biomas = new Set();
  const semente = [];
  for (let x = -900; x <= 900; x += 2) {
    for (let z = -900; z <= 900; z += 2) {
      colunas++;
      const t = terrainAt(venus, x, z);
      if (t.acido === null || t.acido <= t.height) continue;
      comAcido++;
      biomas.add(t.biome.id);
      const fundo = t.acido - t.height;
      if (fundo > maisFundo) maisFundo = fundo;
      if (semente.length < 12) semente.push([x, z]);
    }
  }
  check('  e elas existem de verdade no terreno', comAcido > 0,
        `(${comAcido} colunas de ${colunas})`);
  // PEQUENAS: uma fração mínima da superfície, como ele pediu.
  const frac = (100 * comAcido) / colunas;
  check('  pequenas: menos de 1% da superfície', frac < 1,
        `(${frac.toFixed(3)}%)`);
  check('  mas fundas o bastante pra entrar nelas', maisFundo >= 2,
        `(${maisFundo} blocos)`);
  // SÓ NA PLANÍCIE: poça em encosta não existe, o líquido escorre.
  check('  e só na planície de lava',
        biomas.size === 1 && biomas.has('planicies_de_lava'),
        `(${[...biomas].join(', ')})`);

  // O ESPELHO É PLANO — medido por POÇA, achada por alastramento.
  //
  // A primeira versão deste teste agrupava por célula da grade de sorteio, e
  // reprovava um terreno certo: uma célula de 90 blocos pode conter mais de
  // uma poça, e cada uma tem o espelho dela. Poça é o conjunto CONECTADO de
  // colunas com ácido, e é isso que tem que ter um nível só.
  const pocaDe = (sx, sz) => {
    const vistos = new Set();
    const niveis = new Set();
    const fila = [[sx, sz]];
    while (fila.length && vistos.size < 4000) {
      const [x, z] = fila.pop();
      const k = x + ',' + z;
      if (vistos.has(k)) continue;
      vistos.add(k);
      const t = terrainAt(venus, x, z);
      if (t.acido === null || t.acido <= t.height) continue;
      niveis.add(t.acido);
      fila.push([x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]);
    }
    return niveis;
  };
  const tortas = [];
  let medidas = 0;
  for (const [sx, sz] of semente) {
    const niveis = pocaDe(sx, sz);
    if (!niveis.size) continue;
    medidas++;
    if (niveis.size !== 1) tortas.push(`${sx},${sz}: ${[...niveis].join('/')}`);
  }
  check('  com o espelho plano, um nível por poça',
        medidas > 0 && tortas.length === 0,
        `(${medidas} poça(s) medida(s)${tortas.length ? ', tortas: ' + tortas.join(' | ') : ''})`);

  // E o ácido entra na coluna como bloco, por cima do chão.
  let achou = null;
  for (let x = -900; x <= 900 && !achou; x++) {
    for (let z = -900; z <= 900; z++) {
      const t = terrainAt(venus, x, z);
      if (t.acido !== null && t.acido - t.height >= 2) { achou = [x, z]; break; }
    }
  }
  if (achou) {
    const runs = columnRunsAt(venus, achou[0], achou[1]);
    const topo = runs[runs.length - 1];
    check('  e o bloco de ácido fica por cima do chão, no topo da coluna',
          topo.id === ACID_BLOCK, `(${topo.id})`);
  }
}

// --- 16. Dentro do ácido: névoa, nado, fôlego e itens --------------------
//
// Bedrock não deixa um pacote fazer fluido de verdade, então cada coisa que a
// água faz sozinha é montada à mão aqui. Estes testes são o contrato de cada
// uma delas.
{
  __reset();
  const dim = world.getDimension('gh:venus');
  // Uma poça de 3 de fundo: o jogador cabe inteiro dentro.
  for (let y = 68; y <= 71; y++) dim.setBlockType({ x: 0, y, z: 0 }, ACID_BLOCK);

  const dentro = (y) => {
    const q = world.__addPlayer({ id: 'm' + Math.random(), dimensionId: 'gh:venus',
                                  location: { x: 0.5, y, z: 0.5 } });
    return q;
  };

  // --- a névoa segue a CABEÇA, não o pé ---------------------------------
  const afundado = dentro(69.0);      // cabeça a ~70.6, dentro
  const raso = dentro(71.0);          // pé em 71 (ácido), cabeça a 72.6 (ar)
  check('afundado, o pé e a cabeça estão no ácido',
        feetInAcid(afundado) && headInAcid(afundado));
  check('  na parte rasa o pé está dentro e a cabeça fora',
        feetInAcid(raso) && !headInAcid(raso));

  applyAcid(afundado);
  applyAcid(raso);
  check('a névoa do ácido liga pra quem afundou', acidFogOn(afundado.id));
  check('  e NÃO liga pra quem só molhou o pé', !acidFogOn(raso.id));

  // Saindo, a névoa sai junto — senão a tela fica amarela pra sempre.
  afundado.location = { x: 40.5, y: 80, z: 40.5 };
  applyAcid(afundado);
  check('  e desliga ao sair', !acidFogOn(afundado.id));
}

// --- 17. Nadar: não se despenca pela poça --------------------------------
//
// O bloco não tem colisão. Sem controlador o jogador atravessaria a poça como
// se ela fosse ar, que é o contrário de líquido.
{
  __reset();
  const dim = world.getDimension('gh:venus');
  for (let y = 60; y <= 71; y++) dim.setBlockType({ x: 0, y, z: 0 }, ACID_BLOCK);
  const p = world.__addPlayer({ id: 'nada', dimensionId: 'gh:venus',
                               location: { x: 0.5, y: 69, z: 0.5 } });

  // Caindo rápido, como quem pulou dentro.
  p.__setVelocity({ x: 0, y: -0.8, z: 0 });
  applyAcid(p);
  const umTique = p.getVelocity().y;
  check('caindo no ácido, a queda é freada', umTique > -0.8,
        `(${umTique.toFixed(3)})`);

  // E o freio é LIMITADO POR TIQUE de propósito: devolver os 0,75 de uma vez
  // seria um empurrão que catapulta. Ele converge em alguns tiques, como o
  // controlador de gravidade dos planetas.
  for (let i = 0; i < 8; i++) { applyAcid(p); __advance(1); }
  const vy = p.getVelocity().y;
  check('  e em alguns tiques chega no afundamento lento',
        Math.abs(vy - ACID_SINK) < 0.02, `(${vy.toFixed(3)}, alvo ${ACID_SINK})`);

  // Nadar é mais lento que andar.
  p.__setVelocity({ x: 0.25, y: ACID_SINK, z: 0 });
  applyAcid(p);
  const h = Math.hypot(p.getVelocity().x, p.getVelocity().z);
  check('  e nadar é mais lento que andar',
        Math.abs(h - ACID_SWIM_CAP) < 0.002, `(${h.toFixed(3)})`);
}

// --- 18. O fôlego, igual ao da água --------------------------------------
{
  __reset();
  const dim = world.getDimension('gh:venus');
  for (let y = 68; y <= 71; y++) dim.setBlockType({ x: 0, y, z: 0 }, ACID_BLOCK);
  const p = world.__addPlayer({ id: 'folego', dimensionId: 'gh:venus',
                               location: { x: 0.5, y: 69, z: 0.5 } });

  check('começa com o fôlego cheio', airOf(p.id) === ACID_AIR_SECONDS,
        `(${airOf(p.id)})`);

  let aviso = null;
  for (let i = 0; i < 100; i++) { aviso = applyAcid(p) ?? aviso; __advance(1); }
  const depois = airOf(p.id);
  check('afundado, o fôlego cai', depois < ACID_AIR_SECONDS, `(${depois.toFixed(1)}s)`);
  check('  e o aviso diz quanto falta', /\d+s/.test(aviso ?? ''), `(${aviso})`);

  // Acaba o ar: dano de afogamento.
  p.__health = 20;
  for (let i = 0; i < ACID_AIR_SECONDS * 20 + 80; i++) { applyAcid(p); __advance(1); }
  check('  e quando acaba, afoga', p.__health < 20, `(${p.__health} de 20)`);
  check('    com o aviso de afogamento',
        /AFOGANDO|DROWNING|AHOGÁ/i.test(applyAcid(p) ?? ''),
        `(${applyAcid(p)})`);

  // Fora, o fôlego volta — como na água.
  p.location = { x: 40.5, y: 80, z: 40.5 };
  for (let i = 0; i < 400; i++) { applyAcid(p); __advance(1); }
  check('  e fora dele o fôlego enche de volta', airOf(p.id) === ACID_AIR_SECONDS,
        `(${airOf(p.id)})`);
}

// --- 19. Item que cai no ácido é destruído -------------------------------
{
  __reset();
  const dim = world.getDimension('gh:venus');
  for (let y = 68; y <= 71; y++) dim.setBlockType({ x: 0, y, z: 0 }, ACID_BLOCK);
  const p = world.__addPlayer({ id: 'dono', dimensionId: 'gh:venus',
                               location: { x: 0.5, y: 69, z: 0.5 } });

  const naPoca = world.__spawn('gh:venus', 'minecraft:item', { x: 0.5, y: 70, z: 0.5 });
  const seco = world.__spawn('gh:venus', 'minecraft:item', { x: 8.5, y: 70, z: 8.5 });

  for (let i = 0; i < 40; i++) { applyAcid(p); __advance(1); }
  check('item que cai no ácido some', !naPoca.isValid);
  check('  e o que está no seco continua lá', seco.isValid);
}

// --- 20. E o balde NÃO é bebível -----------------------------------------
//
// Ele pediu com todas as letras. O addon que serviu de base tem cinco baldes e
// TODOS são bebida — `minecraft:food` mais `use_animation: drink`. A diferença
// entre carga e bebida é a AUSÊNCIA desses componentes, e ausência é o tipo de
// coisa que volta sem ninguém notar.
{
  const doc = JSON.parse(fs.readFileSync(path.join(REPO,
    'packs/Galactic Horizons BP/items/sulfuric_acid_bucket.json'), 'utf8'));
  const c = doc['minecraft:item'].components;
  check('o balde de ácido não é comida', !('minecraft:food' in c));
  check('  nem tem animação de beber', !('minecraft:use_animation' in c));
  check('  nem duração de uso', !('minecraft:use_duration' in c));
}

// --- 21. "Não está funcionando o balde e o ácido não existe" -------------
//
// Os dois eram o mesmo defeito, em três pedaços, e nenhum aparecia em log.
{
  // (a) O BLOCO PRECISA ESTAR NO MENU CRIATIVO.
  //
  // Sem `menu_category` o Bedrock registra o bloco e não o mostra em lugar
  // nenhum: ele só existiria nas poças que a geração faz, e chunk de Vênus já
  // visitada NUNCA é refeita — quem já tinha base lá nunca veria uma poça.
  // "O ácido não existe" era literalmente verdade pra ele.
  const bloco = JSON.parse(fs.readFileSync(path.join(REPO,
    'packs/Galactic Horizons BP/blocks/sulfuric_acid.json'), 'utf8'));
  const desc = bloco['minecraft:block'].description;
  check('o ácido está no menu criativo', !!desc.menu_category,
        `(${JSON.stringify(desc.menu_category)})`);

  // (b) ACHÁVEL ANDANDO.
  //
  // A primeira medida era 0,13% da superfície: a poça mais próxima a 77 blocos
  // em média e 192 no pior caso. A névoa de Vênus fecha a 46 e lá não se corre,
  // então ela nunca entrava no campo de visão. Este teste mede a DISTÂNCIA, que
  // é o que o jogador sente — a porcentagem sozinha não diz nada.
  const venus = PLANETS.find((x) => x.id === 'venus');
  const pocas = [];
  for (let x = -500; x <= 500; x += 2) {
    for (let z = -500; z <= 500; z += 2) {
      const t = terrenoEm(venus, x, z);
      if (t.acido !== null && t.acido !== undefined && t.acido > t.height) {
        pocas.push([x, z]);
      }
    }
  }
  let pior = 0;
  for (let x = -200; x <= 200; x += 40) {
    for (let z = -200; z <= 200; z += 40) {
      let d = Infinity;
      for (const [px, pz] of pocas) {
        const dd = Math.hypot(px - x, pz - z);
        if (dd < d) d = dd;
      }
      if (d > pior) pior = d;
    }
  }
  check('  e de qualquer ponto há uma poça a menos de 140 blocos', pior < 140,
        `(pior caso ${Math.round(pior)})`);

  // (c) O BALDE ENCHE DE DENTRO DA POÇA.
  //
  // Quem está nadando não tem como mirar a poça de fora, e o bloco não tem
  // colisão — o raio de visão passa reto por ele e entrega a rocha de baixo.
  // Era por isso que o balde "não funcionava": o gesto nunca chegava no ácido.
  // Aqui o caminho testado é o `itemUse`, que é o que sobra quando o jogo não
  // reconhece interação com bloco nenhum.
  __reset();
  startAcid();
  const mergulhador = world.__addPlayer({
    id: 'mergulhador', dimensionId: 'gh:venus',
    location: { x: 0.5, y: 70.5, z: 0.5 },
  });
  const dim = world.getDimension('gh:venus');
  dim.setBlockType({ x: 0, y: 70, z: 0 }, ACID_BLOCK);
  dim.setBlockType({ x: 0, y: 71, z: 0 }, ACID_BLOCK);
  const mochila = mergulhador.getComponent('inventory').container;
  mochila.setItem(0, new ItemStack(TITANIUM_BUCKET, 1));
  mergulhador.selectedSlotIndex = 0;

  world.afterEvents.itemUse.__fire({
    source: mergulhador, itemStack: new ItemStack(TITANIUM_BUCKET, 1),
  });
  __advance(2);
  check('  e o balde enche de dentro da poça, sem mirar em nada',
        mochila.getItem(0)?.typeId === ACID_BUCKET,
        `(${mochila.getItem(0)?.typeId})`);

  // (d) DESPEJAR PELA FACE DE BAIXO VAI PRA BAIXO.
  //
  // `Block` tem `above()` e `below()`, não `up()` e `down()`. O código lia a
  // face mirada e chamava `bloco[face.toLowerCase()]()`, que no jogo cai no
  // catch: mirar a face de BAIXO despejava o ácido ACIMA do bloco, do lado
  // oposto ao que o jogador apontou. O stub tinha `up`/`down` e escondia isso.
  const teto = { x: 20, y: 70, z: 20 };
  dim.setBlockType(teto, 'gh:venus_rock');
  dim.setBlockType({ x: 20, y: 69, z: 20 }, 'minecraft:air');
  dim.setBlockType({ x: 20, y: 71, z: 20 }, 'minecraft:air');
  mochila.setItem(0, new ItemStack(ACID_BUCKET, 1));
  despejar(mergulhador, dim.getBlock(teto), 'Down');
  check('  e despejar na face de baixo põe o ácido EMBAIXO',
        dim.getBlock({ x: 20, y: 69, z: 20 })?.typeId === ACID_BLOCK,
        `(${dim.getBlock({ x: 20, y: 69, z: 20 })?.typeId})`);
  check('    e não em cima',
        dim.getBlock({ x: 20, y: 71, z: 20 })?.typeId !== ACID_BLOCK);

  // (e) O RELATÓRIO responde "por que o ácido não existe".
  const relato = acidReport(mergulhador, venus, terrenoEm);
  check('  o /scriptevent gh:acido diz se o bloco foi registrado',
        /registrado/.test(relato));
  check('    e onde está a poça mais próxima',
        /poça mais próxima/.test(relato), `(${relato.split('\n').pop()})`);
}

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
