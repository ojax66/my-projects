/* Onde o rastreador escreve — e por que não é só a barra de ação.
 *
 * O Spacecraft roda `player.runCommand("hud @s hide all")` nas cinemáticas
 * dele (racoTriggers.js) e desfaz com `hud @s reset all` no fim. `hide all`
 * inclui o `item_text`, que é onde a barra de ação é desenhada — e se a
 * cinemática não terminar limpa (o jogador sai, morre, dá erro no meio), o HUD
 * fica escondido pra sempre. Não dá pra consultar esse estado por script.
 *
 * O placar lateral NÃO é um `hud_element`: `hud hide all` não o alcança. Por
 * isso ele é o canal padrão, e por isso estes testes existem.
 */
import { world, system, __reset, __state, __advance } from '@minecraft/server';
import { DIMENSION_ID, HUD_CHANNEL_DEFAULT, HUD_OBJECTIVE, HUD_INTERVAL_TICKS } from './space_dim/config.js';
import { hudChannel, cycleHudChannel, CHANNELS } from './space_dim/tracker.js';
import { showCompass, clearSidebar } from './space_dim/ambience.js';

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

__reset();
const mk = (id) => world.__addPlayer({
  id, dimensionId: DIMENSION_ID, location: { x: 0, y: 128, z: 400 },
});

const sidebarLines = () => {
  const obj = __state().displaySlots.get('sidebar');
  return obj ? obj.getParticipants() : null;
};

// --- 1. O padrão é o canal que sobrevive ao `hud hide all` ------------------
{
  const p = mk('p1');
  check('o canal padrão é o placar lateral', hudChannel(p) === 'sidebar',
        `(${HUD_CHANNEL_DEFAULT})`);
}

// --- 2. Ele realmente escreve lá --------------------------------------------
{
  __reset();
  clearSidebar();
  const p = mk('p1');
  system.currentTick = HUD_INTERVAL_TICKS;   // o HUD só escreve no tick certo
  showCompass(p, null);

  const lines = sidebarLines();
  check('o rastreador escreve no placar', Array.isArray(lines) && lines.length > 0,
        `(${lines ? lines.length : 0} linhas)`);
  check('  e o objetivo é o do addon',
        __state().displaySlots.get('sidebar')?.id === HUD_OBJECTIVE);
  check('  sem escrever na barra de ação',
        (p.__actionBars ?? []).length === 0,
        `(${(p.__actionBars ?? []).length} escritas)`);
  check('  com um corpo por linha',
        lines.some((l) => l.includes('Terra')) && lines.some((l) => l.includes('Sol')),
        `(${lines.join(' | ')})`);
}

// --- 3. Trocar de canal no menu ---------------------------------------------
{
  __reset();
  clearSidebar();
  const p = mk('p1');
  check('os canais dão a volta', CHANNELS.length === 3);

  const depois = cycleHudChannel(p);
  check('trocar sai do placar', depois !== 'sidebar', `(${depois})`);

  // Com "actionbar" tem que escrever na barra e NÃO no placar.
  while (hudChannel(p) !== 'actionbar') cycleHudChannel(p);
  system.currentTick = HUD_INTERVAL_TICKS;
  showCompass(p, null);
  check('no canal "actionbar" escreve na barra', (p.__actionBars ?? []).length === 1);
  check('  e não toca no placar', sidebarLines() === null);

  // "off" não escreve em lugar nenhum.
  while (hudChannel(p) !== 'off') cycleHudChannel(p);
  p.__actionBars = [];
  system.currentTick = HUD_INTERVAL_TICKS * 2;
  showCompass(p, null);
  check('no canal "off" não escreve em lugar nenhum',
        (p.__actionBars ?? []).length === 0 && sidebarLines() === null);
}

// --- 4. Com dois jogadores o placar não serve -------------------------------
//
// O slot lateral é do MUNDO, não do jogador: com dois no espaço, um veria as
// distâncias do outro. Nesse caso o rastreador cai pra barra de ação sozinho.
{
  __reset();
  clearSidebar();
  const a = mk('pa');
  const b = mk('pb');
  b.teleport({ x: 400, y: 128, z: 0 });
  system.currentTick = HUD_INTERVAL_TICKS;
  showCompass(a, null);

  check('com dois jogadores no espaço, volta pra barra de ação',
        (a.__actionBars ?? []).length === 1 && sidebarLines() === null);
}

// --- 5. Sair do espaço limpa o placar ---------------------------------------
{
  __reset();
  clearSidebar();
  const p = mk('p1');
  system.currentTick = HUD_INTERVAL_TICKS;
  showCompass(p, null);
  check('o placar está montado antes de sair', sidebarLines() !== null);
  clearSidebar();
  check('sair do espaço tira o placar da tela', sidebarLines() === null);
}

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
