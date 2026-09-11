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

  // O modelo fica PRESO ao jogador, na direção do corpo. É a única forma de
  // garantir que ele continue sendo renderizado: uma entidade parada no centro
  // real, a centenas de blocos, o jogo não desenha — foi o que fez os corpos
  // sumirem quando eles ficavam lá.
  const { BODIES: TODOS } = await import('./space_dim/config.js');
  const dists = models.map((e) => Math.hypot(
    e.location.x - p.location.x, e.location.y - p.location.y, e.location.z - p.location.z));
  // Na posição REAL do corpo, mas nunca além do alcance em que o jogo ainda
  // desenha uma entidade. Perto, o modelo fica exatamente onde o corpo está e
  // entra em oclusão como qualquer coisa; longe, encosta nessa borda.
  const reais = models.map((e) => {
    const body = TODOS.find((b) => b.id === e.typeId.slice('space_dim:sky_'.length));
    return Math.hypot(body.center.x - p.location.x, body.center.y - p.location.y,
                      body.center.z - p.location.z);
  });
  check('  cada modelo fica à distância real, limitada ao alcance',
        dists.every((d, i) => Math.abs(d - Math.min(reais[i], SKY_MODEL_DISTANCE)) < 0.5),
        `(${dists.map((d, i) => `${d.toFixed(0)}/${Math.min(reais[i], SKY_MODEL_DISTANCE).toFixed(0)}`).join(' ')})`);

  // E na direção certa: o modelo tem que aparecer onde o corpo está.
  const torto = models.filter((e) => {
    const body = TODOS.find((b) => b.id === e.typeId.slice('space_dim:sky_'.length));
    if (!body) return true;
    const dir = (a, b, c) => {
      const n = Math.hypot(a, b, c);
      return [a / n, b / n, c / n];
    };
    const real = dir(body.center.x - p.location.x, body.center.y - p.location.y,
                     body.center.z - p.location.z);
    const mod = dir(e.location.x - p.location.x, e.location.y - p.location.y,
                    e.location.z - p.location.z);
    return Math.abs(real[0] - mod[0]) + Math.abs(real[1] - mod[1]) +
           Math.abs(real[2] - mod[2]) > 0.01;
  });
  check('  e na direção do corpo de verdade', torto.length === 0,
        `(torto: ${torto.map((e) => e.typeId).join(', ') || 'nenhum'})`);

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

// --- 7. Os três níveis: blocos, modelo, estrela ------------------------------
//
// O nível do meio é o que o jogador pediu: ver a Terra estando perto do Sol.
// E o de fora é o que fecha a ideia — além da borda do sistema o corpo vira um
// ponto branco, como qualquer estrela vista daqui.
{
  __reset();
  const { updateSky, clearModels } = await import('./space_dim/skybox.js');
  const { SOLAR_SYSTEM_RADIUS, SKY_MODEL_HIDE_BELOW, STAR_ENTITY } =
    await import('./space_dim/config.js');
  const { BODIES } = await import('./space_dim/config.js');

  const dim = world.getDimension(DIMENSION_ID);
  const sun = BODIES.find((b) => b.id === 'sun');
  const earth = BODIES.find((b) => b.id === 'earth');
  const p = mk('niveis');

  const modelosDe = (id) => dim.getEntities().filter((e) => e.typeId === `space_dim:sky_${id}`);
  const estrelas = () => dim.getEntities().filter((e) => e.typeId === STAR_ENTITY);

  // Perto do Sol: a Terra está a 520 dali, muito além dos blocos — tem que
  // aparecer como MODELO. É exatamente o caso que ele descreveu.
  p.teleport({ x: sun.center.x, y: sun.center.y, z: sun.center.z + sun.radius + 30 });
  __advance(2); updateSky(p);
  check('perto do Sol dá pra ver a Terra como modelo', modelosDe('earth').length === 1,
        `(${modelosDe('earth').length})`);
  check('  e o Sol, que está colado, fica por conta dos blocos',
        modelosDe('sun').length === 0);

  // Perto de Marte: o Sol está a 1040 — modelo também.
  const mars = BODIES.find((b) => b.id === 'mars');
  p.teleport({ x: mars.center.x, y: mars.center.y, z: mars.center.z + mars.radius + 30 });
  __advance(2); updateSky(p);
  check('perto de Marte dá pra ver o Sol', modelosDe('sun').length === 1,
        `(${modelosDe('sun').length})`);

  // Muito além da borda do sistema: tudo vira estrela.
  clearModels(p.id);
  p.teleport({ x: sun.center.x, y: 128, z: sun.center.z + SOLAR_SYSTEM_RADIUS + 4000 });
  __advance(2); updateSky(p);
  check('fora do sistema os corpos viram estrelas', estrelas().length > 0,
        `(${estrelas().length} estrelas)`);
  check('  e nenhum modelo de corpo sobra',
        BODIES.every((b) => modelosDe(b.id).length === 0));

  clearModels(p.id);
}

// --- 8. A escala do modelo é a projeção do corpo ----------------------------
//
// O modelo fica a SKY_MODEL_DISTANCE do jogador e tem que dar o MESMO ÂNGULO
// que o corpo daria lá longe. O cubo do geometry tem 16 unidades de aresta, que
// é um bloco: meia-aresta 0,5. Igualando os ângulos:
//
//     escala = 2 × SKY_MODEL_DISTANCE × raio / distância
//
// A versão anterior dividia por 8, tratando a meia-aresta como 8 BLOCOS —
// dezesseis vezes menor, e nada media isso.
{
  __reset();
  const { updateSky, clearModels } = await import('./space_dim/skybox.js');
  const { SKY_SIZE_STEPS } = await import('./space_dim/skySteps.js');
  const { BODIES } = await import('./space_dim/config.js');

  const dim = world.getDimension(DIMENSION_ID);
  const moon = BODIES.find((b) => b.id === 'moon');
  const p = mk('projecao');

  // A Lua a 95 blocos: o caso que ele reportou.
  p.teleport({ x: moon.center.x, y: moon.center.y, z: moon.center.z + 95 });
  __advance(2); updateSky(p);

  const modelo = dim.getEntities().filter((e) => e.typeId === 'space_dim:sky_moon')[0];
  check('a Lua a 95 blocos vira um modelo', !!modelo);

  const ev = (modelo?.__events ?? []).find((e) => e.startsWith('space_dim:set_size_'));
  const escala = SKY_SIZE_STEPS[Number(ev?.slice('space_dim:set_size_'.length))];
  check('  e recebeu um degrau de escala', escala > 0, `(${ev} = ${escala})`);

  // O ângulo do modelo tem que bater com o do corpo real.
  const anguloReal = moon.radius / 95;
  const anguloModelo = (0.5 * escala) / SKY_MODEL_DISTANCE;
  check('  o ângulo do modelo bate com o do corpo',
        Math.abs(Math.log(anguloModelo / anguloReal)) < Math.log(1.25),
        `(modelo ${anguloModelo.toFixed(4)} vs real ${anguloReal.toFixed(4)})`);

  check('nenhum degrau da tabela é zero', SKY_SIZE_STEPS.every((v) => v > 0),
        `(${SKY_SIZE_STEPS.length} degraus, menor ${Math.min(...SKY_SIZE_STEPS)})`);

  clearModels(p.id);
}

// --- 9. Dentro de um corpo, nada de céu -------------------------------------
//
// O modelo fica a poucos blocos do jogador, então lá dentro do Sol a Terra, a
// Lua e Marte apareciam flutuando no meio do plasma, atravessando as camadas
// que deviam escondê-los.
{
  __reset();
  const { updateSky, clearModels } = await import('./space_dim/skybox.js');
  const { BODIES } = await import('./space_dim/config.js');
  const dim = world.getDimension(DIMENSION_ID);
  const sun = BODIES.find((b) => b.id === 'sun');
  const p = mk('dentro');

  // Fora, mas perto: o céu aparece.
  p.teleport({ x: sun.center.x, y: sun.center.y, z: sun.center.z + sun.radius + 400 });
  __advance(2); updateSky(p);
  const fora = dim.getEntities().filter((e) => e.typeId.startsWith('space_dim:sky_')).length;
  check('fora do Sol o céu aparece', fora > 0, `(${fora} modelos)`);

  // Dentro do Sol: nada.
  p.teleport({ x: sun.center.x, y: sun.center.y, z: sun.center.z + 30 });
  __advance(2); updateSky(p);
  const dentro = dim.getEntities().filter((e) => e.typeId.startsWith('space_dim:sky_')).length;
  check('dentro do Sol o céu some', dentro === 0, `(${dentro} modelos)`);

  clearModels(p.id);
}

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
