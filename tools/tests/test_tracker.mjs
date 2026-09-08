/* Rastreador: o que o jogador conhece, o que ele escolhe ver, e os modelos
 * que aparecem por isso.
 *
 * O rastreador antigo era uma linha de texto com os quatro corpos fixos. Este
 * é a base de um sistema que vai crescer, então o que os testes protegem é o
 * comportamento que precisa continuar valendo quando houver vinte sistemas:
 *
 *   - progresso não se perde ao desligar algo da tela;
 *   - sistema trancado não vaza posição nenhuma;
 *   - corpo novo no catálogo entra ligado, sem mexer em save de ninguém.
 */
import { world, system, __reset, __advance } from '@minecraft/server';
import { SYSTEMS, allTrackable, bodiesOf, defaultSystems } from './space_dim/catalog.js';
import {
  unlockedSystems, isSystemUnlocked, unlockSystem,
  isBodyOn, toggleBody, toggleSystem, trackedBodies, trackerState,
} from './space_dim/tracker.js';
import { DIMENSION_ID, SKY_MODEL_DISTANCE, SKY_MODEL_HIDE_BELOW } from './space_dim/config.js';

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

__reset();
const mk = (id = 'p1') =>
  world.__addPlayer({ id, dimensionId: DIMENSION_ID, location: { x: 0, y: 128, z: 300 } });

// --- 1. Catálogo -------------------------------------------------------------
{
  const all = allTrackable();
  check('todo corpo do catálogo resolve pra uma posição',
        all.length > 0 && all.every((b) => b.center && typeof b.radius === 'number'),
        `(${all.length} corpos)`);
  check('o sistema de casa já vem aberto', defaultSystems().includes('sol'));
}

// --- 2. Estado inicial -------------------------------------------------------
{
  const p = mk('novo');
  check('jogador novo conhece o sistema de casa', isSystemUnlocked(p, 'sol'));
  check('  e vê todos os corpos dele',
        trackedBodies(p).length === bodiesOf('sol').length,
        `(${trackedBodies(p).length})`);
}

// --- 3. Desligar é preferência, não perda de progresso -----------------------
{
  const p = mk('pref');
  const antes = trackedBodies(p).length;
  toggleBody(p, 'mars');
  check('desligar um corpo tira ele da tela',
        trackedBodies(p).length === antes - 1 && !isBodyOn(p, 'mars'));
  check('  mas o sistema continua conhecido', isSystemUnlocked(p, 'sol'));
  toggleBody(p, 'mars');
  check('  e religar devolve', trackedBodies(p).length === antes && isBodyOn(p, 'mars'));

  toggleSystem(p, 'sol');
  check('desligar o sistema inteiro esvazia a tela', trackedBodies(p).length === 0);
  check('  sem desconhecer o sistema', isSystemUnlocked(p, 'sol'));
  toggleSystem(p, 'sol');
}

// --- 4. Sistema trancado não vaza nada ---------------------------------------
{
  // Um sistema inventado só pra este teste, para não depender do catálogo real
  // ter mais de um sistema hoje.
  SYSTEMS.push({
    id: 'teste_distante', name: 'Sistema de Teste', unlockedByDefault: false,
    bodies: [{ id: 'estrela_teste', name: 'Estrela de Teste',
               center: { x: 99999, y: 128, z: 99999 }, radius: 40 }],
  });

  const p = mk('tranca');
  check('sistema trancado não aparece no rastreado',
        !trackedBodies(p).some((b) => b.systemId === 'teste_distante'));

  const state = trackerState(p);
  const locked = state.find((s) => s.id === 'teste_distante');
  check('  mas aparece no menu, marcado como trancado',
        locked && locked.unlocked === false);

  const novo = unlockSystem(p, 'teste_distante');
  check('o mapa estelar abre o sistema', novo === true);
  check('  e ele passa a ser rastreado',
        trackedBodies(p).some((b) => b.id === 'estrela_teste'));
  check('  usar o mesmo mapa de novo não conta como novidade',
        unlockSystem(p, 'teste_distante') === false);
  check('  um mapa de sistema inexistente não abre nada',
        unlockSystem(p, 'nao_existe') === false);
  check('  e o progresso ficou guardado no jogador',
        unlockedSystems(p).includes('teste_distante'));
}

// --- 5. Corpo novo no catálogo entra ligado sozinho --------------------------
//
// O estado guarda o que está DESLIGADO. Se guardasse o que está ligado, todo
// corpo acrescentado depois nasceria invisível pra quem já tem save.
{
  const p = mk('save_antigo');
  toggleBody(p, 'moon');                       // esse jogador desligou a Lua
  const antes = new Set(trackedBodies(p).map((b) => b.id));

  SYSTEMS[0].bodies.push({ id: 'corpo_novo', name: 'Corpo Novo',
                           center: { x: 1, y: 128, z: 1 }, radius: 5 });
  const depois = new Set(trackedBodies(p).map((b) => b.id));

  check('corpo acrescentado depois aparece ligado num save antigo',
        depois.has('corpo_novo'));
  check('  e a escolha antiga do jogador continua valendo',
        !antes.has('moon') && !depois.has('moon'));
  SYSTEMS[0].bodies.pop();
}

// --- 6. Modelos de céu seguem o rastreador -----------------------------------
{
  const skybox = await import('./space_dim/skybox.js');
  const p = mk('ceu');
  const dim = world.getDimension(DIMENSION_ID);

  system.currentTick = 0;
  __advance(2);
  skybox.updateSky(p);
  const models = dim.getEntities().filter((e) => e.typeId.startsWith('space_dim:sky_'));
  check('cada corpo rastreado e distante ganha um modelo',
        models.length > 0, `(${models.length} modelos)`);

  const dists = models.map((e) => Math.hypot(
    e.location.x - p.location.x, e.location.y - p.location.y, e.location.z - p.location.z));
  check('  todos ficam perto do jogador, dentro da renderização',
        dists.every((d) => Math.abs(d - SKY_MODEL_DISTANCE) < 0.5),
        `(distâncias: ${dists.map((d) => d.toFixed(1)).join(', ')})`);

  // Desligar um corpo no menu tem que apagar o modelo dele.
  const alvo = trackedBodies(p)[0];
  toggleBody(p, alvo.id);
  __advance(2);
  skybox.updateSky(p);
  const restantes = dim.getEntities()
    .filter((e) => e.typeId === `space_dim:sky_${alvo.id}`);
  check('desligar no menu apaga o modelo daquele corpo', restantes.length === 0,
        `(${alvo.id}: ${restantes.length})`);
  toggleBody(p, alvo.id);

  // Chegando perto, o modelo sai e o corpo de blocos assume.
  const perto = trackedBodies(p).find((b) => b.id === 'moon') ?? trackedBodies(p)[0];
  p.teleport({ x: perto.center.x, y: perto.center.y, z: perto.center.z + 10 });
  __advance(2);
  skybox.updateSky(p);
  const aindaLa = dim.getEntities()
    .filter((e) => e.typeId === `space_dim:sky_${perto.id}`);
  check(`modelo some abaixo de ${SKY_MODEL_HIDE_BELOW} blocos`, aindaLa.length === 0,
        `(${perto.id}: ${aindaLa.length})`);

  skybox.clearModels(p.id);
  const zerados = dim.getEntities().filter((e) => e.typeId.startsWith('space_dim:sky_'));
  check('sair do espaço leva todos os modelos junto', zerados.length === 0,
        `(${zerados.length} sobraram)`);
}

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
