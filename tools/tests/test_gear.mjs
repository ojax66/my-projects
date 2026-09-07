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
import { world, system, __reset, __advance, __state, ItemStack } from '@minecraft/server';
import { BODIES, DIMENSION_ID, STAR_ARMOR_PIECES, WRECK_TEMPLATE_ITEM } from './space_dim/config.js';
import { gravityAt, gravityStrengthAt, applyPlayerGravity, applyEntityGravity } from './space_dim/gravity.js';
import { hasStarArmor, starArmorPieces } from './space_dim/starGear.js';
import { applySunPressure } from './space_dim/hazards.js';
import { buildWreckAt } from './space_dim/wreck.js';

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

// --- 4. Pilotando, quem é puxado é o veículo -------------------------------
{
  __reset();
  const p = world.__addPlayer({
    id: 'pilot', dimensionId: DIMENSION_ID, location: spaceLoc(earth, earth.radius + 8),
  });
  const ufo = world.__spawn(DIMENSION_ID, 'dlb_van:ufo', p.location);
  p.__mountOn(ufo);

  applyPlayerGravity(p);
  check('pilotando, o veículo leva o impulso', (ufo.__impulses?.length ?? 0) > 0,
        `(${ufo.__impulses?.length ?? 0} impulso(s))`);
  check('e o jogador não leva empurrão separado', (p.__knockbacks?.length ?? 0) === 0);

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

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
