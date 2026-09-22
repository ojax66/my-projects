/* Gravidade dos corpos, pressão do Sol, armadura de estrela e os destroços.
 *
 * O que precisa valer:
 *   - longe é sem gravidade, perto puxa, e puxa PRA DENTRO do corpo
 *   - pilotando, quem é puxado é o veículo, não o passageiro solto
 *   - a pressão do Sol mata sem a armadura e não mata com ela
 *   - meia armadura não conta
 *   - os destroços aparecem em terreno aberto, com o molde no baú, e nunca
 *     por cima de construção de alguém
 */
import fs from 'node:fs';
import path from 'node:path';
import { world, system, __reset, __advance, __state, ItemStack } from '@minecraft/server';
import { BODIES, DIMENSION_ID, STAR_ARMOR_PIECES, BASIC_SUIT_PIECES,
         REINFORCED_SUIT_PIECES, REINFORCED_SUIT_PRESSURE_FACTOR,
         SPACECRAFT_SAFE_TAG, OXYGEN_BACKPACK,
         WRECK_TEMPLATE_ITEM, TRASH_CAN_BLOCK } from './gh/config.js';
import { gravityAt, gravityStrengthAt, applyPlayerGravity, applyEntityGravity } from './gh/gravity.js';
import { canBreathe } from './gh/lifeSupport.js';
import { hasStarArmor, starArmorPieces, hasBasicSuit, hasReinforcedSuit,
         protectionTier, pressureMultiplier,
         sustainInSpacecraftWorlds } from './gh/gear.js';
import { isWarm } from './gh/cold.js';
import { applySunPressure, applySunHeat } from './gh/hazards.js';
import { applyStarArmorPowers, onEntityHurt } from './gh/starPowers.js';
import { startTrashCan } from './gh/trashCan.js';
startTrashCan();
import { buildWreckAt } from './gh/wreck.js';
import { rememberSpawn, enforceSpawn, sendHomeIfHere } from './gh/spawnGuard.js';

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

const sun = BODIES.find(b => b.id === 'sun');
const earth = BODIES.find(b => b.id === 'earth');
const moon = BODIES.find(b => b.id === 'moon');

const spaceLoc = (body, d, axis = 'x') => ({
  x: body.center.x + (axis === 'x' ? d : 0),
  y: body.center.y,
  z: body.center.z + (axis === 'z' ? d : 0),
});

// --- 1. O poço gravitacional -------------------------------------------------
{
  const far = gravityStrengthAt(spaceLoc(sun, sun.radius + sun.gravity.reach + 30));
  const edge = gravityStrengthAt(spaceLoc(sun, sun.radius + sun.gravity.reach - 2));
  const mid = gravityStrengthAt(spaceLoc(sun, sun.radius + sun.gravity.reach / 2));
  const near = gravityStrengthAt(spaceLoc(sun, sun.radius + 2));

  check('fora do alcance não há gravidade', far === 0, `(${far})`);
  check('na borda do alcance a gravidade é quase zero', edge > 0 && edge < 0.003,
        `(${edge.toFixed(5)})`);
  check('a gravidade cresce ao se aproximar', near > mid && mid > edge,
        `(borda ${edge.toFixed(4)} < meio ${mid.toFixed(4)} < perto ${near.toFixed(4)})`);

  // Monotônica: nunca afrouxa ao chegar mais perto.
  let mono = true, prev = -1;
  for (let d = sun.radius + sun.gravity.reach; d >= sun.radius; d -= 2) {
    const v = gravityStrengthAt(spaceLoc(sun, d));
    if (v < prev - 1e-12) mono = false;
    prev = v;
  }
  check('a gravidade nunca afrouxa ao se aproximar', mono);
}

// --- 2. O puxão aponta pro centro do corpo ----------------------------------
{
  for (const [body, axis, sign] of [[earth, 'x', 1], [earth, 'x', -1],
                                    [earth, 'z', 1], [moon, 'x', 1]]) {
    const at = spaceLoc(body, sign * (body.radius + 6), axis);
    const g = gravityAt(at);
    const comp = axis === 'x' ? g.x : g.z;
    check(`${body.id}: puxa de volta pro centro (${axis}${sign > 0 ? '+' : '-'})`,
          Math.sign(comp) === -sign, `(${comp.toFixed(4)})`);
  }

  // Acima do corpo o puxão é pra baixo — é o que faz "flutuar" virar "cair".
  const above = { x: earth.center.x, y: earth.center.y + earth.radius + 8, z: earth.center.z };
  check('acima da Terra a gravidade puxa pra baixo', gravityAt(above).y < 0,
        `(${gravityAt(above).y.toFixed(4)})`);
}

// --- 3. O Sol puxa mais longe e mais forte que os planetas ------------------
{
  const sunPull = gravityStrengthAt(spaceLoc(sun, sun.radius + 10));
  const earthPull = gravityStrengthAt(spaceLoc(earth, earth.radius + 10));
  const moonPull = gravityStrengthAt(spaceLoc(moon, moon.radius + 10));
  check('Sol puxa mais que a Terra, que puxa mais que a Lua',
        sunPull > earthPull && earthPull > moonPull,
        `(sol ${sunPull.toFixed(4)}, terra ${earthPull.toFixed(4)}, lua ${moonPull.toFixed(4)})`);
  check('o alcance do Sol é o maior',
        sun.gravity.reach > earth.gravity.reach && earth.gravity.reach > moon.gravity.reach);
}

// --- 3b. A Nave Level 1 é um veículo pressurizado ---------------------------
//
// Ela veio do addon dele e agora mora aqui. Se não entrar na lista, o piloto
// sufoca e congela dentro da própria nave — e o jogo não diz nada, só mata.
{
  __reset();
  const p = world.__addPlayer({
    id: 'naveiro', dimensionId: DIMENSION_ID, location: spaceLoc(earth, earth.radius + 40),
  });
  const nave = world.__spawn(DIMENSION_ID, 'gh:level_1_spaceship', p.location);
  p.__mountOn(nave);
  check('dentro da Nave Level 1 o jogador respira', canBreathe(p));
}

// --- 4. Pilotando, NADA encosta nele ----------------------------------------
//
// Nem puxão no jogador, nem impulso no veículo, nem empurrão pra fora de bloco
// sólido. Quem pilota dirige; o que cai é quem está a pé ou solto.
//
// Este teste é o conserto de um bug de verdade: `keepOutOfSolids` TELEPORTA o
// jogador pra fora do corpo sólido, e teleportar um passageiro é desmontá-lo.
// Era assim que a nave "saía sozinha" perto de um planeta.
{
  __reset();
  const p = world.__addPlayer({
    id: 'pilot', dimensionId: DIMENSION_ID, location: spaceLoc(earth, earth.radius + 8),
  });
  const ufo = world.__spawn(DIMENSION_ID, 'dlb_van:ufo', p.location);
  p.__mountOn(ufo);

  const antes = { ...p.location };
  check('pilotando, a gravidade devolve zero', applyPlayerGravity(p) === 0);
  check('  o veículo não leva impulso', (ufo.__impulses?.length ?? 0) === 0,
        `(${ufo.__impulses?.length ?? 0} impulso(s))`);
  check('  o jogador não leva empurrão', (p.__knockbacks?.length ?? 0) === 0);
  check('  e ele não é teleportado (isso o desmontaria)',
        p.location.x === antes.x && p.location.y === antes.y && p.location.z === antes.z);
  check('  continua montado', p.__ridingOn === ufo);

  // E DENTRO de um corpo sólido, que é onde keepOutOfSolids agia: mesmo assim
  // ninguém mexe nele.
  {
    __reset();
    const dentro = world.__addPlayer({
      id: 'dentro', dimensionId: DIMENSION_ID,
      location: { x: earth.center.x, y: earth.center.y, z: earth.center.z },
    });
    const nave = world.__spawn(DIMENSION_ID, 'dlb_van:ufo', dentro.location);
    dentro.__mountOn(nave);
    const pos = { ...dentro.location };
    applyPlayerGravity(dentro);
    check('  nem no meio de um planeta sólido', dentro.__ridingOn === nave
          && dentro.location.x === pos.x && dentro.location.y === pos.y);
  }

  // A pé, o jogador leva o empurrão horizontal.
  __reset();
  const walker = world.__addPlayer({
    id: 'walker', dimensionId: DIMENSION_ID,
    location: spaceLoc(earth, earth.radius + 8),
  });
  applyPlayerGravity(walker);
  check('a pé, o jogador leva o empurrão horizontal',
        (walker.__knockbacks?.length ?? 0) > 0);
}

// --- 5. Entidades soltas caem nos corpos ------------------------------------
{
  __reset();
  const dim = world.getDimension(DIMENSION_ID);
  const p = world.__addPlayer({
    id: 'obs', dimensionId: DIMENSION_ID, location: spaceLoc(earth, earth.radius + 10),
  });
  const item = world.__spawn(DIMENSION_ID, 'minecraft:item', spaceLoc(earth, earth.radius + 12));
  const farItem = world.__spawn(DIMENSION_ID, 'minecraft:item',
    { x: earth.center.x + 4000, y: earth.center.y, z: earth.center.z });

  system.currentTick = 0;               // multiplo do intervalo
  applyEntityGravity(dim, [p]);

  check('item perto da Terra é puxado', (item.__impulses?.length ?? 0) > 0);
  check('item do outro lado do mapa não é tocado', (farItem.__impulses?.length ?? 0) === 0);

  // Veículo com piloto não leva impulso dobrado (o piloto já cuida disso).
  __reset();
  const dim2 = world.getDimension(DIMENSION_ID);
  const p2 = world.__addPlayer({
    id: 'p2', dimensionId: DIMENSION_ID, location: spaceLoc(earth, earth.radius + 10),
  });
  const ridden = world.__spawn(DIMENSION_ID, 'dlb_van:ufo', p2.location);
  p2.__mountOn(ridden);
  system.currentTick = 0;
  applyEntityGravity(dim2, [p2]);
  check('veículo pilotado não leva impulso em dobro',
        (ridden.__impulses?.length ?? 0) === 0);
}

// --- 6. A armadura de estrela ----------------------------------------------
{
  __reset();
  const p = world.__addPlayer({ id: 'a', dimensionId: DIMENSION_ID, location: { x: 0, y: 128, z: 0 } });

  check('sem nada, nenhuma peça', starArmorPieces(p) === 0 && !hasStarArmor(p));

  for (let i = 0; i < STAR_ARMOR_PIECES.length - 1; i++) {
    p.__wear(STAR_ARMOR_PIECES[i].slot, STAR_ARMOR_PIECES[i].item);
  }
  check('faltando uma peça, o conjunto não conta',
        starArmorPieces(p) === 3 && !hasStarArmor(p), `(${starArmorPieces(p)} peças)`);

  const last = STAR_ARMOR_PIECES[STAR_ARMOR_PIECES.length - 1];
  p.__wear(last.slot, last.item);
  check('as quatro peças formam o conjunto', starArmorPieces(p) === 4 && hasStarArmor(p));

  // Netherite no lugar de uma peça não vale.
  p.__wear(last.slot, 'minecraft:netherite_boots');
  check('peça de netherite não substitui a de estrela', !hasStarArmor(p));
}

// --- 7. A pressão do Sol ----------------------------------------------------
{
  const makeInsideSun = (id) => {
    const p = world.__addPlayer({
      id, dimensionId: DIMENSION_ID,
      location: { x: sun.center.x, y: sun.center.y, z: sun.center.z },
    });
    p.__damage = 0;
    p.applyDamage = (n) => { p.__damage += n; return true; };
    return p;
  };

  __reset();
  const bare = makeInsideSun('bare');
  const armoured = makeInsideSun('armoured');
  for (const piece of STAR_ARMOR_PIECES) armoured.__wear(piece.slot, piece.item);

  for (let t = 0; t < 60; t++) {
    system.currentTick = t;
    applySunPressure(bare);
    applySunPressure(armoured);
  }
  check('sem armadura, a pressão do Sol machuca', bare.__damage > 0, `(${bare.__damage})`);
  check('com a armadura de estrela, não machuca', armoured.__damage === 0);

  // Fora do Sol não há pressão nenhuma.
  __reset();
  const outside = world.__addPlayer({
    id: 'out', dimensionId: DIMENSION_ID, location: spaceLoc(sun, sun.radius + 20),
  });
  outside.__damage = 0;
  outside.applyDamage = (n) => { outside.__damage += n; };
  for (let t = 0; t < 40; t++) { system.currentTick = t; applySunPressure(outside); }
  check('fora do Sol não há pressão', outside.__damage === 0);
}

// --- 7b. A escada de protecao: nada < traje reforcado < armadura de estrela --
{
  const wear = (p, pieces) => { for (const x of pieces) p.__wear(x.slot, x.item); };
  const insideSun = () => ({ x: sun.center.x, y: sun.center.y, z: sun.center.z });

  __reset();
  const bare = world.__addPlayer({ id: 'b', dimensionId: DIMENSION_ID, location: insideSun() });
  const suited = world.__addPlayer({ id: 's', dimensionId: DIMENSION_ID, location: insideSun() });
  const starred = world.__addPlayer({ id: 't', dimensionId: DIMENSION_ID, location: insideSun() });
  wear(suited, REINFORCED_SUIT_PIECES);
  wear(starred, STAR_ARMOR_PIECES);

  const basic = world.__addPlayer({ id: 'a', dimensionId: DIMENSION_ID, location: insideSun() });
  wear(basic, BASIC_SUIT_PIECES);

  check('o traje reforçado é reconhecido', hasReinforcedSuit(suited) && !hasStarArmor(suited));
  check('o traje básico é reconhecido, e não conta como reforçado',
        hasBasicSuit(basic) && !hasReinforcedSuit(basic) && !hasStarArmor(basic));
  check('os degraus são lidos certo',
        protectionTier(bare) === 'none' && protectionTier(basic) === 'basic'
        && protectionTier(suited) === 'suit' && protectionTier(starred) === 'star');

  // Meio traje nao conta.
  const half = world.__addPlayer({ id: 'h', dimensionId: DIMENSION_ID, location: insideSun() });
  for (let i = 0; i < 3; i++) half.__wear(REINFORCED_SUIT_PIECES[i].slot, REINFORCED_SUIT_PIECES[i].item);
  check('meio traje não conta', !hasReinforcedSuit(half) && protectionTier(half) === 'none');

  // Pressao dentro do Sol: o basico nao segura nada, o reforcado e a armadura de
  // estrela anulam. O fator vem do config — se ele deixar de ser 0, o teste
  // cobra o corte proporcional em vez da anulacao.
  for (const p of [bare, basic, suited, starred]) {
    p.__damage = 0;
    p.applyDamage = (n) => { p.__damage += n; };
  }
  for (let t = 0; t < 200; t++) {
    system.currentTick = t;
    applySunPressure(bare); applySunPressure(basic);
    applySunPressure(suited); applySunPressure(starred);
  }
  check('sem nada a pressão do Sol machuca', bare.__damage > 0, `(${bare.__damage})`);
  check('o traje básico não segura pressão nenhuma',
        basic.__damage === bare.__damage,
        `(básico ${basic.__damage}, nada ${bare.__damage})`);
  check('a armadura de estrela anula a pressão', starred.__damage === 0);

  if (REINFORCED_SUIT_PRESSURE_FACTOR <= 0) {
    check('o traje reforçado ANULA a pressão do Sol', suited.__damage === 0,
          `(traje ${suited.__damage})`);
  } else {
    check('sem nada a pressão machuca mais que com o traje',
          bare.__damage > suited.__damage && suited.__damage > 0,
          `(nada ${bare.__damage}, traje ${suited.__damage})`);
    check('o traje corta perto do fator configurado',
          Math.abs(suited.__damage / bare.__damage - REINFORCED_SUIT_PRESSURE_FACTOR) < 0.25,
          `(passou ${(suited.__damage / bare.__damage).toFixed(2)}, esperado ~${REINFORCED_SUIT_PRESSURE_FACTOR})`);
  }
}

// --- 7b-bis. O que cada traje resolve, e o que nao resolve ------------------
// A diferenca entre os dois e o que faz o reforcado valer a pena existir: o
// o basico resolve o AR, o reforcado resolve o FRIO e a PRESSAO.
{
  __reset();
  const longe = { x: 5000, y: 100, z: 5000 };       // longe de qualquer corpo
  const nu = world.__addPlayer({ id: 'n2', dimensionId: DIMENSION_ID, location: longe });
  const basico = world.__addPlayer({ id: 'a2', dimensionId: DIMENSION_ID, location: longe });
  const reforcado = world.__addPlayer({ id: 'x2', dimensionId: DIMENSION_ID, location: longe });
  for (const x of BASIC_SUIT_PIECES) basico.__wear(x.slot, x.item);
  for (const x of REINFORCED_SUIT_PIECES) reforcado.__wear(x.slot, x.item);

  check('sem traje o jogador não respira no espaço', !canBreathe(nu));
  check('o traje básico sozinho já deixa respirar', canBreathe(basico));
  check('o reforçado também, sem depender de mochila', canBreathe(reforcado));

  check('sem traje o jogador congela', !isWarm(nu));
  // O básico ISOLA. Um traje espacial de verdade não é uma roupa grossa: o
  // vácuo não conduz calor, e o serviço mais simples que um traje presta é
  // justamente o isolamento — quem não presta esse serviço não é traje.
  // O que separa o básico do reforçado é a PRESSÃO, não o frio.
  check('o traje básico isola do frio do espaço', isWarm(basico));
  check('o traje reforçado isola do frio', isWarm(reforcado));

  check('só o reforçado anula a pressão',
        pressureMultiplier(nu) === 1 && pressureMultiplier(basico) === 1
        && pressureMultiplier(reforcado) === REINFORCED_SUIT_PRESSURE_FACTOR);
}

// --- 7c. O traje segura o calor da aproximacao, nao o de dentro -------------
{
  const at = (d) => ({ x: sun.center.x + d, y: sun.center.y, z: sun.center.z });
  const makeSuited = (id, d) => {
    const p = world.__addPlayer({ id, dimensionId: DIMENSION_ID, location: at(d) });
    for (const x of REINFORCED_SUIT_PIECES) p.__wear(x.slot, x.item);
    p.__fire = 0;
    p.setOnFire = (s) => { p.__fire += s; return true; };
    p.applyDamage = () => {};
    return p;
  };

  __reset();
  const approaching = makeSuited('ap', sun.radius + 10);   // fora, chegando perto
  const within = makeSuited('in', sun.radius / 2);         // dentro do Sol
  for (let t = 0; t < 40; t++) {
    system.currentTick = t;
    applySunHeat(approaching); applySunHeat(within);
  }
  check('com o traje dá pra encostar no Sol sem pegar fogo', approaching.__fire === 0);
  check('mas dentro do Sol o traje não segura o calor', within.__fire > 0,
        `(${within.__fire}s de fogo)`);
}

// --- 7d. O traje vale como traje nas dimensoes do Spacecraft ----------------
// Sem isto, trocar o traje deles pelo melhorado faria o jogador sufocar na Lua.
{
  __reset();
  const onMoon = world.__addPlayer({ id: 'moon', dimensionId: 'nv_sc:moon', location: { x: 0, y: 250, z: 0 } });
  for (const x of REINFORCED_SUIT_PIECES) onMoon.__wear(x.slot, x.item);

  check('sem mochila, o traje sozinho não sustenta',
        !sustainInSpacecraftWorlds(onMoon) && !onMoon.hasTag(SPACECRAFT_SAFE_TAG));

  onMoon.__wear('Offhand', OXYGEN_BACKPACK);
  check('com traje e mochila, a tag do Spacecraft é reposta',
        sustainInSpacecraftWorlds(onMoon) && onMoon.hasTag(SPACECRAFT_SAFE_TAG));

  // Eles removem a tag quando o jogador esta no chao; repor todo tick resolve.
  onMoon.removeTag(SPACECRAFT_SAFE_TAG);
  sustainInSpacecraftWorlds(onMoon);
  check('reposta de novo depois de eles removerem', onMoon.hasTag(SPACECRAFT_SAFE_TAG));

  // No Overworld nao mexe em tag nenhuma.
  __reset();
  const home = world.__addPlayer({ id: 'home', dimensionId: 'minecraft:overworld', location: { x: 0, y: 64, z: 0 } });
  for (const x of REINFORCED_SUIT_PIECES) home.__wear(x.slot, x.item);
  home.__wear('Offhand', OXYGEN_BACKPACK);
  check('no Overworld a tag não é tocada',
        !sustainInSpacecraftWorlds(home) && !home.hasTag(SPACECRAFT_SAFE_TAG));
}

// --- 7e. O que a armadura de estrela faz alem de proteger -------------------
// As tres da netherite (nao queima, resiste a repulsao, tenacidade), melhores,
// mais o fogo em quem encosta. Tudo so com o CONJUNTO INTEIRO.
{
  __reset();
  const longe = { x: 5000, y: 100, z: 5000 };
  const nu = world.__addPlayer({ id: 'sp_nu', dimensionId: DIMENSION_ID, location: longe });
  const armado = world.__addPlayer({ id: 'sp_ok', dimensionId: DIMENSION_ID, location: longe });
  for (const x of STAR_ARMOR_PIECES) armado.__wear(x.slot, x.item);
  const meio = world.__addPlayer({ id: 'sp_meio', dimensionId: DIMENSION_ID, location: longe });
  for (let i = 0; i < 3; i++) meio.__wear(STAR_ARMOR_PIECES[i].slot, STAR_ARMOR_PIECES[i].item);

  for (const p of [nu, armado, meio]) applyStarArmorPowers(p);
  check('a armadura dá resistência ao fogo', !!armado.getEffect('fire_resistance'));
  check('  e a tenacidade, como Resistência', !!armado.getEffect('resistance'));
  check('  sem ela, nenhum dos dois', !nu.getEffect('fire_resistance') && !nu.getEffect('resistance'));
  check('  meia armadura não dá nada',
        !meio.getEffect('fire_resistance') && !meio.getEffect('resistance'));

  // O golpe: quem bateu pega fogo e o empurrão é desfeito.
  const mob = world.__spawn(DIMENSION_ID, 'minecraft:zombie', longe);
  mob.__fire = 0;
  mob.setOnFire = (seg) => { mob.__fire += seg; return true; };
  armado.__knockbacks = [];
  onEntityHurt({ hurtEntity: armado, damageSource: { damagingEntity: mob } });
  check('o mob que ataca pega fogo', mob.__fire > 0, `(${mob.__fire}s)`);
  check('  e o empurrão do golpe é zerado',
        armado.__knockbacks.some((k) => k.x === 0 && k.z === 0 && k.strength === 0));

  // Sem a armadura, nada disso acontece.
  mob.__fire = 0;
  onEntityHurt({ hurtEntity: nu, damageSource: { damagingEntity: mob } });
  check('  sem a armadura o mob não pega fogo', mob.__fire === 0);

  // Dano sem atacante (pressão, frio, queda) não tem em quem pôr fogo.
  mob.__fire = 0;
  onEntityHurt({ hurtEntity: armado, damageSource: { cause: 'freezing' } });
  check('  e dano sem atacante não incendeia ninguém', mob.__fire === 0);
}

// --- 8. Destroços de OVNI ---------------------------------------------------
{
  __reset();
  const dim = world.getDimension('minecraft:overworld');
  dim.__terrain = () => 70;                       // planície

  const built = buildWreckAt(dim, 200, 200, () => 0.5);
  check('em terreno aberto os destroços são construídos', built);

  // O casco apareceu?
  let hull = 0;
  for (const b of dim.__blocks.values()) {
    if (b.typeId === 'minecraft:light_gray_concrete' || b.typeId === 'minecraft:tinted_glass') hull++;
  }
  check('o disco tem casco de verdade', hull >= 20, `(${hull} blocos)`);

  // O molde tem que estar no baú — é o motivo de a estrutura existir.
  const chestKey = [...dim.__blocks.entries()].find(([, b]) => b.typeId === 'minecraft:chest');
  check('há um baú nos destroços', !!chestKey);
  if (chestKey) {
    const items = dim.__containerAt(chestKey[0]).__items.filter(Boolean);
    const hasTemplate = items.some(i => i.typeId === WRECK_TEMPLATE_ITEM);
    check('o baú contém o molde de ferraria', hasTemplate,
          `(${items.map(i => i.typeId.replace('minecraft:', '')).join(', ')})`);
  }

  // Terreno acidentado: recusa em vez de deixar meio disco boiando.
  __reset();
  const hills = world.getDimension('minecraft:overworld');
  hills.__terrain = (x) => 70 + Math.floor(x / 2) % 40;    // encosta forte
  check('em terreno acidentado não constrói', !buildWreckAt(hills, 0, 0, () => 0.5));

  // Nunca substitui construção de alguém.
  __reset();
  const town = world.getDimension('minecraft:overworld');
  town.__terrain = () => 70;
  for (let dx = -3; dx <= 3; dx++)
    for (let dz = -3; dz <= 3; dz++)
      town.setBlockType({ x: 500 + dx, y: 71, z: 500 + dz }, 'minecraft:oak_planks');

  buildWreckAt(town, 500, 500, () => 0.5);
  let survived = 0;
  for (const b of town.__blocks.values()) if (b.typeId === 'minecraft:oak_planks') survived++;
  check('não destrói blocos construídos por jogador', survived === 49,
        `(${survived} de 49 tábuas sobraram)`);
}

// --- 9. O renascimento nunca fica na dimensao do espaco ---------------------
// Entrar no espaco estava mudando o spawn dos jogadores: quem morresse depois
// acordava la em cima. O addon nao chama setSpawnPoint em lugar nenhum — e o
// jogo que reatribui ao entrar numa dimensao custom. Estes testes travam o
// desfazimento.
{
  // (a) tinha cama no Overworld: volta pra cama.
  __reset();
  const bed = world.__addPlayer({ id: 'bed', dimensionId: 'minecraft:overworld', location: { x: 0, y: 64, z: 0 } });
  bed.__setSpawn('minecraft:overworld', { x: 120, y: 70, z: -35 });
  rememberSpawn(bed);

  bed.__setSpawn(DIMENSION_ID, { x: 0, y: 128, z: 58 });   // o jogo mexeu
  const fixedBed = enforceSpawn(bed);
  const sp = bed.getSpawnPoint();
  check('spawn na cama é devolvido depois do espaço',
        fixedBed && sp.dimension.id === 'minecraft:overworld'
        && sp.x === 120 && sp.z === -35,
        `(${sp?.dimension?.id} ${sp?.x},${sp?.z})`);

  // (b) nao tinha spawn proprio: volta a nao ter (= spawn do mundo).
  __reset();
  const fresh = world.__addPlayer({ id: 'fresh', dimensionId: 'minecraft:overworld', location: { x: 0, y: 64, z: 0 } });
  rememberSpawn(fresh);                                     // sem spawn definido
  fresh.__setSpawn(DIMENSION_ID, { x: 0, y: 128, z: 58 });
  const fixedFresh = enforceSpawn(fresh);
  check('quem não tinha spawn volta a não ter (spawn do mundo)',
        fixedFresh && fresh.getSpawnPoint() === undefined,
        `(${JSON.stringify(fresh.getSpawnPoint())})`);

  // (c) spawn legitimo fora do espaco nao e tocado.
  __reset();
  const ok = world.__addPlayer({ id: 'ok', dimensionId: DIMENSION_ID, location: { x: 0, y: 128, z: 58 } });
  ok.__setSpawn('minecraft:overworld', { x: 5, y: 64, z: 5 });
  const touched = enforceSpawn(ok);
  check('spawn fora do espaço não é mexido',
        !touched && ok.getSpawnPoint().x === 5);

  // (d) rememberSpawn nao troca a lembranca boa pela ruim.
  __reset();
  const twice = world.__addPlayer({ id: 'twice', dimensionId: 'minecraft:overworld', location: { x: 0, y: 64, z: 0 } });
  twice.__setSpawn('minecraft:overworld', { x: 9, y: 65, z: 9 });
  rememberSpawn(twice);
  twice.__setSpawn(DIMENSION_ID, { x: 0, y: 128, z: 58 });
  rememberSpawn(twice);                    // segunda viagem, ja com spawn ruim
  enforceSpawn(twice);
  check('uma segunda viagem não grava o spawn ruim por cima do bom',
        twice.getSpawnPoint()?.x === 9 && twice.getSpawnPoint()?.dimension.id === 'minecraft:overworld',
        `(${twice.getSpawnPoint()?.dimension?.id} ${twice.getSpawnPoint()?.x})`);
}

// --- 9b. Os dois buracos que faziam "todo mundo renasce no espaco" ----------
{
  // (e) a conferencia e de TODO jogador, nao so de quem esta no espaco.
  //
  // Era o buraco maior, e ele nao estava no spawnGuard: estava na LIGACAO.
  // `guardSpawnTick` vivia dentro do ramo "este jogador esta no espaco" do laco
  // do main.js. Mas o jogo quebra o renascimento ao ENTRAR aqui, e quem sobe e
  // volta leva o estrago pro Overworld — justamente onde ninguem mais conferia.
  // Morria em casa, dias depois, e acordava no espaco.
  //
  // Nao da pra rodar o laco do main.js aqui (ele e o ponto de entrada, cheio de
  // efeito colateral), entao o que se trava e a posicao da chamada: ela tem que
  // vir ANTES de o laco se dividir entre "esta no espaco" e "nao esta".
  {
    const fonte = fs.readFileSync(
      path.join(process.env.DH_REPO ?? '.', 'packs/Galactic Horizons BP/scripts/gh/main.js'),
      'utf8');
    const chamadas = [...fonte.matchAll(/guardSpawnTick\(player\)/g)].map(m => m.index);
    const divisao = fonte.indexOf('const here = inSpace(player);');
    check('a conferência do renascimento é de todo jogador, não só de quem está no espaço',
          chamadas.length === 1 && divisao > 0 && chamadas[0] < divisao,
          `(${chamadas.length} chamada(s), ${chamadas[0] < divisao ? 'antes' : 'depois'} da divisão)`);
  }

  // (f) a troca de dimensao no sentido de SAIDA tambem conserta, na hora.
  __reset();
  const saindo = world.__addPlayer({ id: 'saindo', dimensionId: DIMENSION_ID, location: { x: 0, y: 800, z: 0 } });
  saindo.__setSpawn('minecraft:overworld', { x: 7, y: 70, z: 7 });
  rememberSpawn(saindo);
  saindo.__setSpawn(DIMENSION_ID, { x: 0, y: 800, z: 0 });
  world.afterEvents.playerDimensionChange.__fire({
    player: saindo,
    fromDimension: world.getDimension(DIMENSION_ID),
    toDimension: world.getDimension('minecraft:overworld'),
  });
  check('  e sair do espaço já conserta na hora, sem esperar o tique',
        saindo.getSpawnPoint()?.dimension?.id === 'minecraft:overworld',
        `(${saindo.getSpawnPoint()?.dimension?.id})`);

  // (g) quem RENASCEU no espaco e trazido de volta.
  //
  // Consertar o ponto de renascimento nao desfaz um renascimento que ja
  // aconteceu: morrer entre duas conferencias ainda jogava o jogador la em
  // cima. Esta e a ultima linha.
  __reset();
  const morto = world.__addPlayer({ id: 'morto', dimensionId: 'minecraft:overworld', location: { x: 0, y: 64, z: 0 } });
  morto.__setSpawn('minecraft:overworld', { x: 44, y: 71, z: -12 });
  rememberSpawn(morto);
  // Morreu e acordou no espaco.
  morto.teleport({ x: 0, y: 800, z: 0 }, { dimension: world.getDimension(DIMENSION_ID) });
  world.afterEvents.playerSpawn.__fire({ player: morto, initialSpawn: false });
  check('quem renasce no espaço é trazido de volta na hora',
        morto.dimension.id === 'minecraft:overworld', `(${morto.dimension.id})`);
  check('  e volta pra cama dele', morto.location.x === 44 && morto.location.z === -12,
        `(${morto.location.x},${morto.location.z})`);

  // (h) sem cama, volta pro spawn do mundo.
  __reset();
  const semCama = world.__addPlayer({ id: 'semcama', dimensionId: DIMENSION_ID, location: { x: 0, y: 800, z: 0 } });
  world.afterEvents.playerSpawn.__fire({ player: semCama, initialSpawn: false });
  check('sem cama, renascer no espaço leva pro spawn do mundo',
        semCama.dimension.id === 'minecraft:overworld', `(${semCama.dimension.id})`);

  // (i) mas ENTRAR no mundo estando no espaco nao teleporta ninguem.
  //
  // Quem sai do jogo no espaco tem que voltar no espaco. Se a volta pra casa
  // valesse tambem no `initialSpawn`, ninguem conseguiria dormir la em cima
  // sem ser cuspido pra Terra no login seguinte.
  __reset();
  const logou = world.__addPlayer({ id: 'logou', dimensionId: DIMENSION_ID, location: { x: 0, y: 800, z: 0 } });
  world.afterEvents.playerSpawn.__fire({ player: logou, initialSpawn: true });
  check('quem só entrou no mundo estando no espaço continua no espaço',
        logou.dimension.id === DIMENSION_ID, `(${logou.dimension.id})`);

  // (j) e quem esta no Overworld nao e teleportado por nada.
  __reset();
  const emCasa = world.__addPlayer({ id: 'emcasa', dimensionId: 'minecraft:overworld', location: { x: 3, y: 64, z: 3 } });
  const mexeu = sendHomeIfHere(emCasa);
  check('quem nunca saiu da Terra não é teleportado',
        !mexeu && emCasa.location.x === 3);
}

// --- 10. A lixeira ----------------------------------------------------------
// Clicar com item na mão faz o item sumir — um por clique, como o vaso
// decorado do jogo. Agachado o jogo faz o de sempre, senão não dava pra
// encostar bloco nenhum nela.
{
  __reset();
  const p = world.__addPlayer({ id: 'lixo', dimensionId: 'minecraft:overworld', location: { x: 0, y: 64, z: 0 } });
  const inv = p.getComponent('inventory').container;
  const dim = world.getDimension('minecraft:overworld');
  const pos = { x: 10, y: 64, z: 10 };
  dim.setBlockType(pos, TRASH_CAN_BLOCK);
  const bloco = dim.getBlock(pos);

  const clicar = (sneak = false) => {
    p.isSneaking = sneak;
    const ev = { block: bloco, player: p, itemStack: inv.getItem(0), cancel: false };
    world.beforeEvents.playerInteractWithBlock.__fire(ev);
    __advance(1);
    return ev;
  };

  inv.setItem(0, new ItemStack('minecraft:dirt', 3));
  let ev = clicar();
  check('clicar na lixeira cancela o uso normal do item', ev.cancel === true);
  check('  e some com UM item da pilha', inv.getItem(0)?.amount === 2,
        `(sobrou ${inv.getItem(0)?.amount})`);

  clicar(); clicar();
  check('  até a pilha acabar', inv.getItem(0) === undefined);

  inv.setItem(0, new ItemStack('minecraft:dirt', 3));
  ev = clicar(true);
  check('  agachado a lixeira não engole nada',
        ev.cancel === false && inv.getItem(0)?.amount === 3);

  // Clicar em outro bloco não tem nada a ver com a lixeira.
  dim.setBlockType({ x: 11, y: 64, z: 10 }, 'minecraft:stone');
  const outro = { block: dim.getBlock({ x: 11, y: 64, z: 10 }), player: p, itemStack: inv.getItem(0), cancel: false };
  p.isSneaking = false;
  world.beforeEvents.playerInteractWithBlock.__fire(outro);
  __advance(1);
  check('  e outro bloco qualquer não engole nada',
        outro.cancel === false && inv.getItem(0)?.amount === 3);
}

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
