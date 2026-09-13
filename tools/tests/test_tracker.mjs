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
import { DIMENSION_ID, SKY_MODEL_DISTANCE, SKY_MODEL_HIDE_BELOW,
         SKY_MODEL_NEAREST } from './space_dim/config.js';

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
  // Sem as atmosferas: elas são entidades de céu também, mas não são corpos —
  // acompanham o corpo delas e têm o tamanho aumentado de propósito.
  const models = dim.getEntities().filter(
    (e) => e.typeId.startsWith('space_dim:sky_') &&
           !e.typeId.startsWith('space_dim:sky_atmo_'));
  check('cada corpo rastreado e distante ganha um modelo',
        models.length > 0, `(${models.length} modelos)`);

  // O modelo fica PRESO ao jogador, na direção do corpo. É a única forma de
  // garantir que ele continue sendo renderizado: uma entidade parada no centro
  // real, a centenas de blocos, o jogo não desenha — foi o que fez os corpos
  // sumirem quando eles ficavam lá.
  const { BODIES: TODOS } = await import('./space_dim/config.js');
  // Tudo medido da CABEÇA: é de lá que sai o raio da câmera, e é de lá que o
  // skybox projeta. Medir dos pés dava quase 6° de erro no degrau de 16 blocos.
  const olho = p.getHeadLocation();
  const dists = models.map((e) => Math.hypot(
    e.location.x - olho.x, e.location.y - olho.y, e.location.z - olho.z));
  // Cada corpo tem o SEU degrau de profundidade, entre SKY_MODEL_NEAREST e
  // SKY_MODEL_DISTANCE, na ordem da distância real: o mais perto de verdade fica
  // no degrau mais perto do jogador. Dois cubos no mesmo raio se interpenetram;
  // em degraus diferentes o da frente só tapa o de trás.
  //
  // E o degrau mais longe cabe na distância de simulação (64 blocos): passando
  // dela a entidade descarrega e para de ser desenhada — foi o que fez os
  // corpos sumirem quando o modelo ia pra posição real, a 112 blocos.
  const reais = models.map((e) => {
    const body = TODOS.find((b) => b.id === e.typeId.slice('space_dim:sky_'.length));
    return Math.hypot(body.center.x - olho.x, body.center.y - olho.y,
                      body.center.z - olho.z);
  });
  const ordem = reais.map((r, i) => i).sort((a, b) => reais[a] - reais[b]);
  const passo = models.length > 1
    ? (SKY_MODEL_DISTANCE - SKY_MODEL_NEAREST) / (models.length - 1) : 0;
  const esperado = new Array(models.length);
  ordem.forEach((idx, rank) => {
    esperado[idx] = Math.min(reais[idx], SKY_MODEL_NEAREST + passo * rank);
  });
  check('  cada modelo fica no degrau de profundidade dele',
        dists.every((d, i) => Math.abs(d - esperado[i]) < 0.5),
        `(${dists.map((d, i) => `${d.toFixed(0)}/${esperado[i].toFixed(0)}`).join(' ')})`);
  // E a projeção sai da CABEÇA. Medida dos pés, no degrau de 16 blocos o erro é
  // atan(1,62/16) ≈ 5,8° — o modelo desce e para de casar com a construção que
  // ele está substituindo.
  const pes = models.map((e) => Math.hypot(
    e.location.x - p.location.x, e.location.y - p.location.y, e.location.z - p.location.z));
  check('  e a projeção sai da cabeça, não dos pés',
        dists.some((d, i) => Math.abs(d - pes[i]) > 0.01),
        `(da cabeça ${dists[0].toFixed(2)}, dos pés ${pes[0].toFixed(2)})`);
  check('  nenhum modelo passa da distância de simulação',
        dists.every((d) => d <= 64), `(o mais longe a ${Math.max(...dists).toFixed(0)})`);
  check('  e dois modelos nunca ficam na mesma profundidade',
        new Set(dists.map((d) => d.toFixed(2))).size === dists.length,
        `(${dists.map((d) => d.toFixed(0)).join(', ')})`);

  // E na direção certa: o modelo tem que aparecer onde o corpo está.
  const torto = models.filter((e) => {
    const body = TODOS.find((b) => b.id === e.typeId.slice('space_dim:sky_'.length));
    if (!body) return true;
    const dir = (a, b, c) => {
      const n = Math.hypot(a, b, c);
      return [a / n, b / n, c / n];
    };
    const real = dir(body.center.x - olho.x, body.center.y - olho.y,
                     body.center.z - olho.z);
    const mod = dir(e.location.x - olho.x, e.location.y - olho.y,
                    e.location.z - olho.z);
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

  // Chegando perto, o modelo só sai se houver BLOCO pra assumir o lugar dele.
  //
  // Hoje não há: os planetas são `built: false` e a casca de fora do Sol é
  // `modelOnly`. Então a regra que vale é a inversa — nenhum deles se desliga —
  // e é isso que este bloco tem que medir, senão ele viraria decoração.
  const perto = trackedBodies(p).find((b) => b.id === 'moon') ?? trackedBodies(p)[0];
  p.teleport({ x: perto.center.x, y: perto.center.y, z: perto.center.z + 10 });
  __advance(2);
  skybox.updateSky(p);
  const aindaLa = dim.getEntities()
    .filter((e) => e.typeId === `space_dim:sky_${perto.id}`);
  const temBloco = perto.built !== false &&
    !(perto.layers ?? []).some((l) => l.modelOnly);
  check(temBloco
          ? `modelo some abaixo de ${SKY_MODEL_HIDE_BELOW} blocos`
          : 'corpo sem bloco não desliga o modelo nem colado nele',
        temBloco ? aindaLa.length === 0 : aindaLa.length === 1,
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
  // O Sol NÃO: a coroa dele é `modelOnly`, não existe bloco que a desenhe.
  // Colado nele o modelo continua ligado — é ele que é a camada de fora. Ver o
  // bloco 10 mais abaixo.
  check('  e o do Sol, que está colado, continua ligado do mesmo jeito',
        modelosDe('sun').length === 1, `(${modelosDe('sun').length})`);

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

  // O ângulo do modelo tem que bater com o do corpo real. A distância do modelo
  // é a do degrau que ele recebeu, então sai dele mesmo — não de uma constante.
  const cab8 = p.getHeadLocation();
  const aonde = Math.hypot(modelo.location.x - cab8.x, modelo.location.y - cab8.y,
                           modelo.location.z - cab8.z);
  const anguloReal = moon.radius / 95;
  const anguloModelo = (0.5 * escala) / aonde;
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

  // Dentro do Sol: some tudo menos a coroa dele, que é a camada em que o
  // jogador está e que nenhum bloco desenha.
  p.teleport({ x: sun.center.x, y: sun.center.y, z: sun.center.z + 30 });
  __advance(2); updateSky(p);
  const restam = dim.getEntities().filter((e) => e.typeId.startsWith('space_dim:sky_'));
  // Lá dentro o Sol troca de modelo: `sky_in_sun` em vez de `sky_sun`. O de fora
  // é o empilhado de 16 cascas, e o jogador dentro dele fica atrás de todas de
  // uma vez — a soma vira um branco chapado e não dá pra enxergar nada. O de
  // dentro tem poucas cascas e deixa ver através; de fora nada muda.
  check('dentro do Sol os outros corpos somem',
        restam.every((e) => e.typeId.startsWith('space_dim:sky_')
                            && e.typeId.includes('sun')),
        `(${restam.map((e) => e.typeId).join(', ') || 'nenhum'})`);
  check('  mas o Sol continua', restam.length === 1);
  check('  e lá dentro ele usa o modelo de interior',
        restam[0]?.typeId === 'space_dim:sky_in_sun', `(${restam[0]?.typeId})`);

  // E lá dentro ela vira um céu: cubo do tamanho do corpo, centrado no jogador.
  // Não há ângulo pra projetar quando se está dentro, e centrado no jogador o
  // modelo está sempre à distância zero — nunca descarrega.
  const coroa = restam[0];
  const cab = p.getHeadLocation();
  const longe = Math.hypot(coroa.location.x - cab.x, coroa.location.y - cab.y,
                           coroa.location.z - cab.z);
  check('  centrada na cabeça do jogador', longe < 0.5, `(a ${longe.toFixed(2)} blocos)`);

  const { SKY_SIZE_STEPS } = await import('./space_dim/skySteps.js');
  const evc = (coroa.__events ?? []).filter((e) => e.startsWith('space_dim:set_size_')).pop();
  const escalaCoroa = SKY_SIZE_STEPS[Number(evc?.slice('space_dim:set_size_'.length))];
  const alvoCoroa = 2 * sun.radius;
  check('  e do tamanho do corpo',
        Math.abs(Math.log(escalaCoroa / alvoCoroa)) < Math.log(1.25),
        `(${escalaCoroa} vs ${alvoCoroa})`);

  // Voltando pra fora, ela volta a ser projetada de longe.
  p.teleport({ x: sun.center.x, y: sun.center.y, z: sun.center.z + sun.radius + 300 });
  __advance(2); updateSky(p);
  const fora2 = dim.getEntities().filter((e) => e.typeId === 'space_dim:sky_sun')[0];
  const c2 = p.getHeadLocation();
  const longe2 = Math.hypot(fora2.location.x - c2.x, fora2.location.y - c2.y,
                            fora2.location.z - c2.z);
  check('saindo do Sol a coroa volta a ser um corpo distante', longe2 > 1,
        `(a ${longe2.toFixed(0)} blocos)`);

  clearModels(p.id);
}

// --- 10. A coroa do Sol não se desliga nunca --------------------------------
//
// A camada de fora do Sol é `modelOnly`: raio 100, nenhum bloco. Quem desenha
// é o modelo, e só ele. A troca normal — chegou perto, some o modelo e os
// blocos assumem — apagava a coroa e deixava só a bola de plasma do raio 62.
//
// Dois furos separados faziam isso:
//   1. a troca media do raio NOMINAL (100) e não da casca construída (62), então
//      o modelo se desligava com os blocos ainda a 94 blocos de distância;
//   2. mesmo com a medida certa, nenhum bloco assume o lugar da coroa.
{
  __reset();
  const { updateSky, clearModels } = await import('./space_dim/skybox.js');
  const { BODIES, SKY_MODEL_HIDE_BELOW } = await import('./space_dim/config.js');
  const dim = world.getDimension(DIMENSION_ID);
  const sun = BODIES.find((b) => b.id === 'sun');
  const earth = BODIES.find((b) => b.id === 'earth');
  const p = mk('coroa');

  const modelosDe = (id) =>
    dim.getEntities().filter((e) => e.typeId === `space_dim:sky_${id}`);

  // Colado na coroa: 2 blocos fora do raio nominal. Aqui o modelo do Sol seria
  // desligado por qualquer regra de distância — e não pode ser.
  p.teleport({ x: sun.center.x, y: sun.center.y, z: sun.center.z + sun.radius + 2 });
  __advance(2); updateSky(p);
  check('colado na coroa, o modelo do Sol continua lá',
        modelosDe('sun').length === 1, `(${modelosDe('sun').length})`);

  // E na faixa que o furo abria: casca construída (62) já bem dentro do alcance
  // dos blocos, mas ainda fora da coroa.
  p.teleport({ x: sun.center.x, y: sun.center.y, z: sun.center.z + sun.radius + 20 });
  __advance(2); updateSky(p);
  check('  e a 20 blocos da coroa também', modelosDe('sun').length === 1);

  // E a Terra, que também não tem bloco nenhum (`built: false`), segue a mesma
  // regra: colada nela o modelo continua. Antes ela era o contraste deste
  // bloco — tinha blocos e trocava —, e foi justamente tirar os blocos dela que
  // fez o modelo sumir de perto enquanto `built` não chegava pelo catálogo.
  p.teleport({ x: earth.center.x, y: earth.center.y,
               z: earth.center.z + earth.radius + SKY_MODEL_HIDE_BELOW - 4 });
  __advance(2); updateSky(p);
  check('a Terra, sem bloco nenhum, também não desliga o modelo',
        modelosDe('earth').length === 1, `(${modelosDe('earth').length})`);

  clearModels(p.id);
}

// --- 11. Multijogador: um conjunto de modelos por GRUPO ---------------------
//
// O modelo é um truque de ponto de vista: fica perto de quem olha e é encolhido
// pra dar o mesmo ângulo do corpo lá longe. Isso só vale pra UM observador, e no
// Bedrock não dá pra esconder uma entidade de um jogador só — então com um
// conjunto por jogador cada um via os cubos dos outros flutuando no lugar
// errado. Quem está junto passa a dividir um conjunto só.
{
  __reset();
  const { updateSkyAll, clearModels } = await import('./space_dim/skybox.js');
  const { SKY_SHARE_RADIUS } = await import('./space_dim/config.js');
  // Relida a cada chamada: __reset() cria uma dimensão NOVA, e uma referência
  // guardada antes dele conta as entidades da dimensão velha.
  const conta = () =>
    world.getDimension(DIMENSION_ID).getEntities()
      .filter((e) => e.typeId.startsWith('space_dim:sky_')).length;

  const a = mk('mp_a');
  const b = mk('mp_b');
  const longe = mk('mp_c');
  const base = { x: 0, y: 128, z: 300 };
  a.teleport(base);
  b.teleport({ x: base.x + 2, y: base.y, z: base.z });          // mesma nave

  __advance(2); updateSkyAll([a, b]);
  const juntos = conta();
  check('dois jogadores juntos dividem um conjunto de modelos', juntos > 0);

  __reset();
  const so = mk('mp_so');
  so.teleport(base);
  __advance(2); updateSkyAll([so]);
  check('  e é o mesmo tanto de um jogador sozinho', conta() === juntos,
        `(${juntos} com dois, ${conta()} com um)`);

  // Separados, cada grupo tem o seu: aí os conjuntos estão longe um do outro e
  // não se atrapalham.
  __reset();
  const x = mk('mp_x');
  const y = mk('mp_y');
  x.teleport(base);
  y.teleport({ x: base.x + SKY_SHARE_RADIUS * 4, y: base.y, z: base.z });
  __advance(2); updateSkyAll([x, y]);
  check('separados, cada um tem o seu conjunto', conta() === juntos * 2,
        `(${conta()} vs ${juntos * 2})`);

  clearModels(x.id); clearModels(y.id);
}

// --- 12. Pousar num planeta não faz o modelo sumir --------------------------
//
// A guarda "dentro de um corpo, nada de céu" usava `<=` no raio. Corpo sólido
// deixa o jogador exatamente NO raio ao pousar, então encostar contava como
// estar dentro: o céu sumia e o planeta virava uma caixa em volta da cabeça.
{
  __reset();
  const { updateSky, clearModels } = await import('./space_dim/skybox.js');
  const { BODIES, SKY_MODEL_REAL_BELOW } = await import('./space_dim/config.js');
  const dim = world.getDimension(DIMENSION_ID);
  const terra = BODIES.find((b) => b.id === 'earth');
  const p = mk('pouso');
  const modelosDe = (id) =>
    dim.getEntities().filter((e) => e.typeId === `space_dim:sky_${id}`);

  // Pousado: exatamente no raio, que é onde a barreira deixa o jogador.
  p.teleport({ x: terra.center.x, y: terra.center.y + terra.radius,
               z: terra.center.z });
  __advance(2); updateSky(p);
  check('pousado na Terra o modelo dela continua lá',
        modelosDe('earth').length === 1, `(${modelosDe('earth').length})`);

  // E de perto ele vai pra posição REAL, no tamanho real: o truque do modelo
  // encolhido quebra aqui, porque a superfície dele ficaria mais perto do
  // jogador que o chão em que ele está.
  const m = modelosDe('earth')[0];
  const aoCentro = Math.hypot(m.location.x - terra.center.x,
                              m.location.y - terra.center.y,
                              m.location.z - terra.center.z);
  check('  e no lugar de verdade do corpo, não num degrau', aoCentro < 0.5,
        `(a ${aoCentro.toFixed(2)} do centro)`);

  const cab = p.getHeadLocation();
  const dReal = Math.hypot(terra.center.x - cab.x, terra.center.y - cab.y,
                           terra.center.z - cab.z);
  check('  (e essa distância cabe na faixa de posição real)',
        dReal <= SKY_MODEL_REAL_BELOW, `(${dReal.toFixed(0)} de ${SKY_MODEL_REAL_BELOW})`);

  clearModels(p.id);
}

// --- 13. O corpo do catálogo chega inteiro ----------------------------------
//
// resolve() já foi uma lista de campos escolhidos a dedo, e a lista mordeu três
// vezes: sem `layers` a coroa do Sol sumia de perto, sem `halo` o brilho não
// escalava, sem `built`/`solid`/`atmosphere` os planetas sumiam ao chegar perto.
// Campo novo em BODIES tem que chegar aqui sozinho.
{
  const { BODIES } = await import('./space_dim/config.js');
  const resolvidos = new Map(allTrackable().map((b) => [b.id, b]));
  const faltando = [];
  for (const body of BODIES) {
    const r = resolvidos.get(body.id);
    if (!r) { faltando.push(`${body.id} (não resolveu)`); continue; }
    for (const campo of Object.keys(body)) {
      if (!(campo in r)) faltando.push(`${body.id}.${campo}`);
    }
  }
  check('o corpo resolvido traz todo campo que BODIES tem',
        faltando.length === 0, faltando.join(', '));
}

// --- 14. A atmosfera é MESMO criada junto com o corpo -----------------------
//
// Ela nunca chegou a aparecer no jogo, e não era o desenho: `atmosphere` não
// vinha pelo catálogo, então a entidade simplesmente não nascia. Este bloco
// olha a entidade no mundo, não o arquivo — é o que teria pego aquilo.
{
  __reset();
  const { updateSky, clearModels } = await import('./space_dim/skybox.js');
  const { BODIES } = await import('./space_dim/config.js');
  const dim = world.getDimension(DIMENSION_ID);
  const p = mk('atmo');
  __advance(2); updateSky(p);

  for (const body of BODIES.filter((b) => b.atmosphere)) {
    const corpo = dim.getEntities()
      .filter((e) => e.typeId === `space_dim:sky_${body.id}`);
    const atmo = dim.getEntities()
      .filter((e) => e.typeId === `space_dim:sky_atmo_${body.id}`);
    check(`${body.id}: a atmosfera nasce junto com o corpo`,
          corpo.length === 1 && atmo.length === 1,
          `(corpo ${corpo.length}, atmosfera ${atmo.length})`);

    // No mesmo lugar do corpo: ela é uma casca em volta dele, não um objeto
    // solto perto.
    if (corpo.length && atmo.length) {
      const d = Math.hypot(atmo[0].location.x - corpo[0].location.x,
                           atmo[0].location.y - corpo[0].location.y,
                           atmo[0].location.z - corpo[0].location.z);
      check('  e no mesmo ponto que ele', d < 0.01, `(${d.toFixed(3)})`);
    }
  }
  clearModels(p.id);
}

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
