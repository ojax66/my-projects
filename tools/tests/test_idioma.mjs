/* O idioma do que o addon escreve, e a engrenagem que o troca.
 *
 * O que precisa valer:
 *   - cada jogador tem o SEU idioma, e um não mexe no do outro
 *   - o que o script escreve muda junto: aviso de oxigênio, frio, pressão
 *   - chave que não existe aparece na tela como [chave], não como "undefined"
 *   - a engrenagem chega uma vez só, e volta pra quem entrou antes dela existir
 */
import fs from 'node:fs';
import path from 'node:path';
import { world, system, __reset, __advance, ItemStack } from '@minecraft/server';
import { IDIOMAS, idiomaDe, definirIdioma, t, nome } from './gh/i18n.js';
import { darEngrenagem, abrirIdioma, startSettings } from './gh/settings.js';
import { __shown, __queue } from '@minecraft/server-ui';
startSettings();
import { SETTINGS_ITEM, IDIOMA_PADRAO, DIMENSION_ID } from './gh/config.js';
import { applyCold } from './gh/cold.js';

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

/** Deixa as promessas dos formulários resolverem antes de conferir. */
const settle = () => new Promise((r) => setTimeout(r, 0));

const jogador = (id) => world.__addPlayer({
  id, dimensionId: DIMENSION_ID, location: { x: 5000, y: 100, z: 5000 },
});

// --- 1. O idioma é de cada um ----------------------------------------------
{
  __reset();
  const a = jogador('a');
  const b = jogador('b');

  check('sem escolher, vale o padrão do config',
        idiomaDe(a) === IDIOMA_PADRAO, `(${idiomaDe(a)})`);

  definirIdioma(a, 'en');
  check('trocar o de um não mexe no do outro',
        idiomaDe(a) === 'en' && idiomaDe(b) === IDIOMA_PADRAO,
        `(a ${idiomaDe(a)}, b ${idiomaDe(b)})`);

  definirIdioma(a, 'klingon');
  check('idioma que não existe cai no padrão', idiomaDe(a) === IDIOMA_PADRAO);
}

// --- 2. O texto muda junto ---------------------------------------------------
{
  __reset();
  const p = jogador('t');
  const visto = new Set();
  for (const lang of IDIOMAS) {
    definirIdioma(p, lang);
    const aviso = t(p, 'hud.sem_oxigenio');
    check(`  ${lang}: o aviso de oxigênio tem texto`, aviso.length > 10);
    visto.add(aviso);
  }
  check('os três idiomas dão três textos diferentes', visto.size === IDIOMAS.length,
        `(${visto.size} de ${IDIOMAS.length})`);

  definirIdioma(p, 'es');
  check('o nome dos corpos também muda',
        nome(p, 'earth', '§bTerra') === '§bTierra',
        `(${nome(p, 'earth', '§bTerra')})`);
  check('  e um id sem tradução devolve o nome cru',
        nome(p, 'plutao', '§7Plutão') === '§7Plutão');

  check('chave que não existe aparece como [chave]',
        t(p, 'nao.existe') === '[nao.existe]', `(${t(p, 'nao.existe')})`);
}

// --- 3. O aviso de frio sai no idioma do jogador ------------------------------
// É o caminho de verdade: quem chama applyCold não sabe nada de idioma.
{
  __reset();
  const pt = jogador('f_pt');
  const en = jogador('f_en');
  definirIdioma(pt, 'pt');       // o padrão é inglês: quem quer português escolhe
  definirIdioma(en, 'en');

  let aPt = null, aEn = null;
  for (let i = 0; i < 400; i++) {
    aPt = applyCold(pt) ?? aPt;
    aEn = applyCold(en) ?? aEn;
    __advance(1);
  }
  check('o aviso de frio existe nos dois', !!aPt && !!aEn);
  check('  e sai em idiomas diferentes', aPt !== aEn, `(${aPt} | ${aEn})`);
  check('  o inglês não tem palavra em português', !/CONGELANDO|PERDENDO/.test(aEn),
        `(${aEn})`);
}

// --- 4. A engrenagem ---------------------------------------------------------
{
  __reset();
  const p = jogador('g');
  const inv = p.getComponent('inventory').container;

  check('quem entra ganha a engrenagem', darEngrenagem(p) === true);
  const tem = () => {
    let n = 0;
    for (let i = 0; i < 36; i++) if (inv.getItem(i)?.typeId === SETTINGS_ITEM) n++;
    return n;
  };
  check('  e ela está no inventário', tem() === 1, `(${tem()})`);

  check('entrar de novo não dá outra', darEngrenagem(p) === false);
  check('  continua sendo uma só', tem() === 1, `(${tem()})`);

  // Quem já jogava antes da engrenagem existir ganha a dele na próxima entrada.
  const velho = jogador('v');
  check('quem entrou antes dela existir também ganha', darEngrenagem(velho) === true);
}

// --- 5. O padrão é o inglês -------------------------------------------------
//
// Quem baixa o addon e nunca toca na engrenagem lê inglês. Era português, e
// português é o idioma de UM dos três.
{
  __reset();
  const novato = jogador('novato');
  check('o padrão do addon é o inglês', IDIOMA_PADRAO === 'en', `(${IDIOMA_PADRAO})`);
  const aviso = t(novato, 'hud.sem_oxigenio');
  check('  e quem nunca escolheu lê em inglês',
        aviso.includes('NO OXYGEN'), `(${aviso})`);

  // O seletor do pack de recurso tem que concordar com isto: é ele que decide
  // os NOMES de bloco e item, que script nenhum alcança.
  const manifesto = JSON.parse(fs.readFileSync(
    path.join(process.env.DH_REPO ?? '.', 'packs/Galactic Horizons RP/manifest.json'), 'utf8'));
  check('  e o primeiro subpacote do seletor também é o inglês',
        manifesto.subpacks?.[0]?.folder_name === 'en',
        `(${manifesto.subpacks?.[0]?.folder_name})`);
}

// --- 6. A engrenagem abre de verdade ---------------------------------------
//
// Ela não abria. `itemUse` só dispara com o item usado NO AR, e no celular o
// dedo cai no chão — quem dispara é a interação com o bloco, que ninguém ouvia.
{
  __reset();
  __shown.length = 0;
  const p = jogador('toque');

  // (a) tocando um bloco, que é o caso normal no celular.
  world.beforeEvents.playerInteractWithBlock.__fire({
    player: p,
    itemStack: new ItemStack(SETTINGS_ITEM, 1),
    block: { typeId: 'minecraft:stone' },
    cancel: false,
  });
  __advance(1);
  await settle();
  check('tocando um bloco com a engrenagem, a tela abre', __shown.length >= 1,
        `(${__shown.length} tela(s))`);

  // (b) no ar.
  __shown.length = 0;
  world.afterEvents.itemUse.__fire({
    source: p, itemStack: new ItemStack(SETTINGS_ITEM, 1),
  });
  __advance(1);
  await settle();
  check('  e usando no ar também', __shown.length >= 1, `(${__shown.length} tela(s))`);

  // (c) a interação com o bloco é cancelada: a engrenagem não vai abrir um baú.
  __shown.length = 0;
  const ev = {
    player: p, itemStack: new ItemStack(SETTINGS_ITEM, 1),
    block: { typeId: 'minecraft:chest' }, cancel: false,
  };
  world.beforeEvents.playerInteractWithBlock.__fire(ev);
  check('  e o toque no bloco não faz mais nada além disso', ev.cancel === true);

  // (d) agachado o jogo faz o de sempre — dá pra abrir um baú segurando a
  // engrenagem sem ter que guardá-la.
  //
  // O toque de (c) deixou uma abertura agendada pro tique seguinte; escoa ela
  // antes de medir, senão a tela dele seria contada como se fosse desta.
  __advance(1);
  await settle();
  __shown.length = 0;
  p.isSneaking = true;
  const ev2 = {
    player: p, itemStack: new ItemStack(SETTINGS_ITEM, 1),
    block: { typeId: 'minecraft:chest' }, cancel: false,
  };
  world.beforeEvents.playerInteractWithBlock.__fire(ev2);
  __advance(1);
  await settle();
  check('  agachado, o baú abre e a tela não', ev2.cancel === false && __shown.length === 0,
        `(cancel ${ev2.cancel}, ${__shown.length} tela(s))`);
  p.isSneaking = false;

  // (e) outro item qualquer não é mexido.
  __shown.length = 0;
  const ev3 = {
    player: p, itemStack: new ItemStack('minecraft:stone', 1),
    block: { typeId: 'minecraft:chest' }, cancel: false,
  };
  world.beforeEvents.playerInteractWithBlock.__fire(ev3);
  __advance(1);
  await settle();
  check('  com outro item na mão nada disso acontece',
        ev3.cancel === false && __shown.length === 0);
}

// --- 7. Formulário recusado: insiste em vez de desistir ---------------------
//
// `UserBusy` é o jogo dizendo "ele ainda está com o dedo na tela" — e é o que
// volta quando a tela é pedida no mesmo toque que a abriu. Pedir uma vez e
// desistir calado tem a mesma cara de um botão quebrado.
{
  __reset();
  __shown.length = 0;
  __queue.length = 0;
  const p = jogador('ocupado');

  abrirIdioma(p);                 // o stub recusa com UserBusy enquanto a fila vazia
  await settle();
  const primeira = __shown.length;

  __advance(40);                  // quatro tentativas depois
  await settle();
  check('uma tela recusada por "ocupado" é pedida de novo', __shown.length > primeira,
        `(${primeira} → ${__shown.length})`);

  // E quando ele enfim responde, a escolha vale.
  __queue.push(IDIOMAS.indexOf('es'));
  __advance(20);
  await settle();
  check('  e quando ele responde, o idioma troca', idiomaDe(p) === 'es',
        `(${idiomaDe(p)})`);
}

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
