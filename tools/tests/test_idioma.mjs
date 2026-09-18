/* O idioma do que o addon escreve, e a engrenagem que o troca.
 *
 * O que precisa valer:
 *   - cada jogador tem o SEU idioma, e um não mexe no do outro
 *   - o que o script escreve muda junto: aviso de oxigênio, frio, pressão
 *   - chave que não existe aparece na tela como [chave], não como "undefined"
 *   - a engrenagem chega uma vez só, e volta pra quem entrou antes dela existir
 */
import { world, system, __reset, __advance, ItemStack } from '@minecraft/server';
import { IDIOMAS, idiomaDe, definirIdioma, t, nome } from './gh/i18n.js';
import { darEngrenagem, abrirIdioma } from './gh/settings.js';
import { SETTINGS_ITEM, IDIOMA_PADRAO, DIMENSION_ID } from './gh/config.js';
import { applyCold } from './gh/cold.js';

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

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

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
