/* O terreno da Lua e de Marte.
 *
 * O que estes testes protegem não é "o mundo ficou bonito" — é o que quebra
 * calado e só aparece depois de andar meia hora lá dentro:
 *
 *   - uma fronteira de bioma virando paredão de um bloco de largura;
 *   - uma coluna com buraco, ou com as camadas fora de ordem;
 *   - um bioma que o ruído nunca escolhe, e que portanto não existe;
 *   - uma chunk cara demais, que trava o celular na hora de gerar.
 */
import { PLANETS, planetOfDimension, planetOfBody, PLANET_BOUNDS, PLANET_EXIT_Y }
  from './space_dim/planets.js';
import { terrainAt, columnRunsAt, heightAt, biomeAt } from './space_dim/planetTerrain.js';
import { BODIES, BLOCK_BUDGET_PER_TICK, GEN_RADIUS_CHUNKS, SPACE_ENTRY_Y }
  from './space_dim/config.js';

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

for (const planet of PLANETS) {
  console.log(`\n--- ${planet.id} ---`);

  // --- 1. A coluna é inteira: sem buraco, sem sobreposição -------------------
  //
  // O gerador escreve TRECHOS (y0..y1). Um trecho começando dois acima de onde
  // o anterior terminou deixa uma fatia de ar dentro da rocha — invisível da
  // superfície, e um buraco pro void quando alguém cava.
  {
    let buracos = 0, sobrepostos = 0, topoErrado = 0, foraDosLimites = 0, n = 0;
    for (let x = -1200; x <= 1200; x += 37) {
      for (let z = -3000; z <= 3000; z += 53) {
        const runs = columnRunsAt(planet, x, z);
        const h = heightAt(planet, x, z);
        for (let i = 1; i < runs.length; i++) {
          if (runs[i].y0 > runs[i - 1].y1 + 1) buracos++;
          if (runs[i].y0 <= runs[i - 1].y1) sobrepostos++;
        }
        if (runs[runs.length - 1].y1 !== h) topoErrado++;
        if (runs[0].y0 < PLANET_BOUNDS.min || h > PLANET_BOUNDS.max) foraDosLimites++;
        n++;
      }
    }
    check(`${planet.id}: nenhuma coluna com buraco`, buracos === 0, `(${buracos} de ${n})`);
    check(`  nem com trecho sobreposto`, sobrepostos === 0, `(${sobrepostos})`);
    check(`  e o topo do último trecho é a superfície`, topoErrado === 0, `(${topoErrado})`);
    check(`  tudo dentro dos limites da dimensão`, foraDosLimites === 0, `(${foraDosLimites})`);
  }

  // --- 2. A estratigrafia que ele pediu --------------------------------------
  //
  // De cima pra baixo, SEMPRE: poeira, pedra, ardósia. O gelo é a única coisa
  // que pode ficar acima da poeira, e só onde o gelo existe de verdade — na
  // calota polar de Marte e no fundo das crateras polares da Lua.
  {
    const ordem = [planet.blocks.ice, planet.blocks.dust, planet.blocks.stone, planet.blocks.deep];
    let fora = 0, semPoeira = 0, semPoeiraForaDaCratera = 0, semFundo = 0, n = 0;
    for (let x = -1500; x <= 1500; x += 41) {
      for (let z = -3000; z <= 3000; z += 47) {
        const t = terrainAt(planet, x, z);
        const runs = columnRunsAt(planet, x, z);
        // de cima pra baixo, sem a bedrock
        const ids = runs.slice(1).reverse().map((r) => r.id);
        let pos = 0;
        for (const id of ids) {
          const k = ordem.indexOf(id);
          if (k < pos) { fora++; break; }
          pos = k;
        }
        if (!ids.includes(planet.blocks.dust)) {
          semPoeira++;
          // A poeira só pode faltar onde o impacto a arrancou: no fundo de uma
          // cratera grande. Em qualquer outro lugar é bug — seria a regra das
          // camadas quebrada.
          if (!t.topoDePedra) semPoeiraForaDaCratera++;
        }
        if (runs[0].id !== planet.blocks.floor) semFundo++;
        n++;
      }
    }
    check(`  poeira → pedra → ardósia, nessa ordem, em toda coluna`, fora === 0,
          `(${fora} de ${n} fora de ordem)`);
    check(`  a poeira só falta no fundo de cratera grande`,
          semPoeiraForaDaCratera === 0,
          `(${semPoeira} colunas sem poeira, ${semPoeiraForaDaCratera} fora de cratera)`);
    check(`  com bedrock no fundo`, semFundo === 0, `(${semFundo})`);
  }

  // --- 2b. O degradê do fundo das crateras -----------------------------------
  //
  // Nas crateras GRANDES o impacto arrancou a poeira e a pedra aflora, com a
  // passagem pontilhada subindo pela parede. O que este teste protege é que
  // seja mesmo um DEGRADÊ e mesmo nas GRANDES: nada de pedra na superfície
  // rasa, nada de borda dura.
  if (planet.craterFloor) {
    const faixa = new Map();
    for (let x = -2000; x <= 2000; x += 11) {
      for (let z = -2000; z <= 2000; z += 13) {
        const t = terrainAt(planet, x, z);
        const k = Math.min(30, Math.floor((t.fundo ?? 0) / 5) * 5);
        const e = faixa.get(k) ?? [0, 0];
        e[0] += t.topoDePedra ? 1 : 0;
        e[1] += 1;
        faixa.set(k, e);
      }
    }
    const frac = (k) => {
      const e = faixa.get(k);
      return e && e[1] ? e[0] / e[1] : 0;
    };
    // A faixa 5-10 encosta no início do degradê (from = 8), então um fiapo de
    // pedra ali é esperado. A faixa 0-5 não pode ter nenhum.
    check(`  ${planet.id}: chão raso não tem pedra na superfície`,
          frac(0) === 0 && frac(5) < 0.05,
          `(${(100 * frac(0)).toFixed(2)}% e ${(100 * frac(5)).toFixed(2)}%)`);
    check(`  o fundo das crateras grandes tem`, frac(20) > 0.9,
          `(${(100 * frac(20)).toFixed(0)}%)`);
    check(`  e a passagem é um degradê, não uma borda`,
          frac(10) > 0.02 && frac(10) < frac(15) && frac(15) < frac(20),
          `(${(100 * frac(10)).toFixed(0)}% → ${(100 * frac(15)).toFixed(0)}% → ${(100 * frac(20)).toFixed(0)}%)`);
  }

  // --- 3. Onde o terreno tem direito de ser íngreme --------------------------
  //
  // O relevo é uma função contínua e o bioma é só um rótulo dela — é isso que
  // impede o paredão de um bloco de largura em toda fronteira. Mas "contínuo"
  // não quer dizer "manso": a parede do Valles Marineris é um penhasco, e tem
  // que ser. Então o teste separa as duas coisas:
  //
  //   1. fora do cânion, nada passa de SUAVE;
  //   2. no cânion pode, mas ainda dentro de um teto — um degrau de 40 blocos
  //      seria a geometria tendo explodido, não um penhasco;
  //   3. atravessar fronteira de BIOMA não é diferente do resto, que é o que
  //      cai na hora se alguém voltar a dar a cada bioma a sua conta de altura.
  {
    const SUAVE = 6;
    const TETO = 20;
    const vallesIdx = planet.biomes.findIndex((b) => b.id === 'valles');

    let pior = 0, ondePior = null, trocas = 0, piorNaTroca = 0;
    let abruptosForaDoCanion = 0, piorFora = 0, ondeFora = null;

    const olha = (ax, az, bx, bz, onde) => {
      const a = terrainAt(planet, ax, az);
      const b = terrainAt(planet, bx, bz);
      const d = Math.abs(a.height - b.height);
      if (d > pior) { pior = d; ondePior = onde; }
      if (a.biome.id !== b.biome.id) { trocas++; if (d > piorNaTroca) piorNaTroca = d; }
      if (d > SUAVE) {
        const noCanion = vallesIdx >= 0
          && (a.weights[vallesIdx] > 0 || b.weights[vallesIdx] > 0);
        if (!noCanion) {
          abruptosForaDoCanion++;
          if (d > piorFora) { piorFora = d; ondeFora = onde; }
        }
      }
    };

    for (let x = -4000; x <= 4000; x += 1) olha(x, 0, x + 1, 0, `x=${x}`);
    for (let z = -4000; z <= 4000; z += 1) olha(0, z, 0, z + 1, `z=${z}`);
    for (let x = -2000; x <= 2000; x += 3) olha(x, 777, x + 1, 777, `x=${x},z=777`);

    check(`  fora do cânion, nenhum degrau passa de ${SUAVE} blocos`,
          abruptosForaDoCanion === 0,
          `(${abruptosForaDoCanion} casos, pior ${piorFora} em ${ondeFora})`);
    check(`  e nem o cânion passa de ${TETO}`, pior <= TETO,
          `(pior: ${pior} em ${ondePior})`);
    check(`  atravessar fronteira de bioma não é diferente do resto`,
          trocas > 0 && piorNaTroca <= SUAVE,
          `(${trocas} fronteiras, pior degrau nelas: ${piorNaTroca})`);
  }

  // --- 4. Todo bioma existe de verdade ---------------------------------------
  //
  // Um bioma declarado que o ruído nunca escolhe é um arquivo morto no pacote:
  // o jogador nunca o vê, e ninguém descobre que o limiar ficou errado.
  {
    const vistos = new Set();
    for (let x = -3200; x <= 3200; x += 31) {
      for (let z = -3200; z <= 3200; z += 31) vistos.add(biomeAt(planet, x, z).id);
    }
    for (const b of planet.biomes) {
      check(`  o bioma ${b.id} aparece no mundo`, vistos.has(b.id));
    }
  }

  // --- 5. Os pesos repartem exatamente 1 -------------------------------------
  //
  // É deles que saem a força das crateras e a espessura das camadas. Se a soma
  // escorregasse, o terreno todo escorregaria junto — e devagar, sem nada
  // denunciando.
  {
    let pior = 0, negativos = 0;
    for (let x = -3000; x <= 3000; x += 73) {
      for (let z = -3000; z <= 3000; z += 79) {
        const w = terrainAt(planet, x, z).weights;
        let soma = 0;
        for (const v of w) { soma += v; if (v < -1e-9) negativos++; }
        pior = Math.max(pior, Math.abs(soma - 1));
      }
    }
    check(`  os pesos dos biomas somam 1`, pior < 1e-9, `(pior erro: ${pior.toExponential(1)})`);
    check(`  e nenhum é negativo`, negativos === 0, `(${negativos})`);
  }

  // --- 6. A chunk cabe no orçamento ------------------------------------------
  //
  // O teto por tick existe pra o celular não travar. Uma chunk que precise de
  // muitos ticks não é erro — ela retoma de onde parou —, mas encher o raio de
  // geração inteiro tem que caber num tempo que dê pra esperar.
  {
    let pior = 0;
    for (const [cx, cz] of [[0, 0], [12, -30], [-40, 60], [3, 160]]) {
      let blocos = 0;
      for (let x = cx * 16; x < cx * 16 + 16; x++) {
        for (let z = cz * 16; z < cz * 16 + 16; z++) {
          for (const r of columnRunsAt(planet, x, z)) blocos += r.y1 - r.y0 + 1;
        }
      }
      pior = Math.max(pior, blocos);
    }
    const chunks = (2 * GEN_RADIUS_CHUNKS + 1) ** 2;
    const segundos = (chunks * pior) / BLOCK_BUDGET_PER_TICK / 20;
    check(`  a chunk mais cara cabe em poucos ticks`, pior / BLOCK_BUDGET_PER_TICK < 3,
          `(${pior} blocos = ${(pior / BLOCK_BUDGET_PER_TICK).toFixed(1)} ticks)`);
    check(`  e o raio de geração inteiro sai em menos de 30 s`, segundos < 30,
          `(${chunks} chunks → ${segundos.toFixed(1)}s)`);
  }

  // --- 7. Determinismo --------------------------------------------------------
  // O mesmo (x, z) tem que dar sempre a mesma coluna: o gerador é chamado de
  // novo quando uma chunk é retomada depois de estourar o orçamento, e duas
  // respostas diferentes deixariam meia coluna de um jeito e meia de outro.
  {
    let iguais = true;
    for (let i = 0; i < 400; i++) {
      const x = ((i * 7919) % 4001) - 2000;
      const z = ((i * 6047) % 4001) - 2000;
      if (JSON.stringify(columnRunsAt(planet, x, z)) !== JSON.stringify(columnRunsAt(planet, x, z))) {
        iguais = false;
        break;
      }
    }
    check(`  a mesma coluna sai igual toda vez`, iguais);
  }
}

// --- 8. Os planetas e os corpos celestes conversam ---------------------------
{
  for (const planet of PLANETS) {
    const body = BODIES.find((b) => b.id === planet.bodyId);
    check(`o planeta ${planet.id} corresponde ao corpo ${planet.bodyId}`, !!body);
    check(`  e o portal do corpo leva pra dimensão dele`,
          body?.portal?.kind === 'planet' && body.portal.dimension === planet.dimensionId,
          `(${JSON.stringify(body?.portal)})`);
    check(`  planetOfDimension acha ele`, planetOfDimension(planet.dimensionId) === planet);
    check(`  planetOfBody também`, planetOfBody(planet.bodyId) === planet);
  }
  check('dimensão desconhecida não vira planeta', planetOfDimension('minecraft:overworld') === null);

  // A altitude de saída é UMA só pro jogo inteiro. Ela já foi 300 aqui, porque
  // o teto de uma dimensão custom era 320 e 800 seria uma porta que nunca abre;
  // o Minecraft passou a deixar o addon escolher os limites, e o número voltou
  // a ser o mesmo. Duas constantes com o mesmo valor combinado escorregam
  // sozinhas depois — por isso está escrito aqui.
  check('a altitude de saída dos planetas é a mesma do Overworld',
        PLANET_EXIT_Y === SPACE_ENTRY_Y, `(${PLANET_EXIT_Y} vs ${SPACE_ENTRY_Y})`);
  check('  e ela cabe embaixo do teto dos planetas',
        PLANET_EXIT_Y < PLANET_BOUNDS.max,
        `(saída ${PLANET_EXIT_Y}, teto ${PLANET_BOUNDS.max})`);

  // O relevo tem que CABER nos limites, e com folga — senão um vulcão sorteado
  // num canto que ninguém testou sai decapitado pelo teto.
  for (const planet of PLANETS) {
    let alto = -Infinity, baixo = Infinity;
    for (let x = -4000; x <= 4000; x += 23) {
      for (let z = -4000; z <= 4000; z += 29) {
        const runs = columnRunsAt(planet, x, z);
        alto = Math.max(alto, runs[runs.length - 1].y1);
        baixo = Math.min(baixo, runs[0].y0);
      }
    }
    check(`  o relevo de ${planet.id} cabe nos limites da dimensão`,
          baixo > PLANET_BOUNDS.min && alto < PLANET_BOUNDS.max,
          `(${baixo}..${alto} dentro de ${PLANET_BOUNDS.min}..${PLANET_BOUNDS.max})`);
  }

  // A dica da bússola tem que reconhecer o portal novo. Ela decidia por
  // `kind === "spacecraft"`, que não existe mais: sem isto o jogador chegaria
  // do lado da Lua e a bússola não diria o que fazer.
  const { compassHintFor } = await import('./space_dim/ambience.js');
  for (const planet of PLANETS) {
    const body = BODIES.find((b) => b.id === planet.bodyId);
    const hint = compassHintFor(body);
    check(`  a bússola diz o que fazer ao chegar em ${planet.id}`,
          typeof hint === 'string' && hint.includes('pousar'), `(${hint})`);
  }
  const terra = BODIES.find((b) => b.id === 'earth');
  check('  e a da Terra continua falando em voltar',
        (compassHintFor(terra) ?? '').includes('Overworld'));
  const sol = BODIES.find((b) => b.id === 'sun');
  check('  o Sol não ganha dica (o aviso dele é o calor)', compassHintFor(sol) === null);
}

console.log(failures ? `\n${failures} FALHA(S)` : '\nTodos os testes passaram.');
process.exit(failures ? 1 : 0);
