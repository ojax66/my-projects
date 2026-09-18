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

  // --- 1. A coluna é inteira, e os buracos dela são CAVERNAS ----------------
  //
  // O gerador escreve TRECHOS (y0..y1). Um trecho começando dois acima de onde
  // o anterior terminou é uma fatia de ar dentro da rocha. Desde que há
  // cavernas, isso é esperado — mas só dentro das regras delas: nunca na casca
  // de cima (senão o jogador cai num vão andando na planície) e nunca encostada
  // na bedrock (senão dá pra ver o fundo do mundo lá de dentro).
  {
    let sobrepostos = 0, topoErrado = 0, foraDosLimites = 0, n = 0;
    let vaos = 0, vaoRasoDemais = 0, vaoNaBedrock = 0, colunasComCaverna = 0;
    const c = planet.caves;
    for (let x = -1200; x <= 1200; x += 37) {
      for (let z = -3000; z <= 3000; z += 53) {
        const runs = columnRunsAt(planet, x, z);
        const h = heightAt(planet, x, z);
        const bedrockY = h - planet.crust;
        let temCaverna = false;
        for (let i = 1; i < runs.length; i++) {
          if (runs[i].y0 <= runs[i - 1].y1) sobrepostos++;
          if (runs[i].y0 > runs[i - 1].y1 + 1) {
            vaos++;
            temCaverna = true;
            // o vão vai de runs[i-1].y1+1 até runs[i].y0-1
            const topoDoVao = runs[i].y0 - 1;
            const baseDoVao = runs[i - 1].y1 + 1;
            if (h - topoDoVao < c.fromSurface) vaoRasoDemais++;
            if (baseDoVao - bedrockY <= c.aboveFloor) vaoNaBedrock++;
          }
        }
        if (temCaverna) colunasComCaverna++;
        if (runs[runs.length - 1].y1 !== h) topoErrado++;
        if (runs[0].y0 < PLANET_BOUNDS.min || h > PLANET_BOUNDS.max) foraDosLimites++;
        n++;
      }
    }
    check(`${planet.id}: nenhum trecho sobreposto`, sobrepostos === 0, `(${sobrepostos})`);
    check(`  o topo do último trecho é a superfície`, topoErrado === 0, `(${topoErrado})`);
    check(`  tudo dentro dos limites da dimensão`, foraDosLimites === 0, `(${foraDosLimites})`);
    check(`  existem cavernas`, colunasComCaverna > n * 0.05,
          `(${colunasComCaverna} de ${n} colunas, ${vaos} vãos)`);
    check(`  e nenhuma fura a casca de cima`, vaoRasoDemais === 0, `(${vaoRasoDemais})`);
    check(`  nem encosta na bedrock`, vaoNaBedrock === 0, `(${vaoNaBedrock})`);
  }

  // --- 1b. Os minérios -------------------------------------------------------
  //
  // Um minério fora da faixa de profundidade dele, ou aflorando na poeira, é
  // bug. E se a taxa escapar pra cima o planeta vira uma mina a céu aberto —
  // por isso há teto, não só piso.
  if (planet.ores) {
    const conta = new Map();
    let solidos = 0, foraDaFaixa = 0, naPoeira = 0, semPar = 0;
    const faixa = new Map(planet.ores.list.map((m) => [m.ore, m]));
    // bloco -> tipo. Cada tipo tem DUAS pedras; as duas contam pro mesmo tipo.
    const tipoDe = new Map();
    for (const m of planet.ores.list) {
      tipoDe.set(`space_dim:${planet.id}_${m.ore}_ore`, m.ore);
      tipoDe.set(`space_dim:${planet.id}_${m.ore}_ore_deep`, m.ore);
    }
    // A VARIANTE TEM QUE BATER COM A PEDRA QUE ELA SUBSTITUIU.
    //
    // É o invariante de verdade, e não dá pra medir por profundidade: a
    // espessura das camadas muda de coluna pra coluna, então um minério "fundo"
    // às vezes cai na pedra do meio — e aí ele TEM que ser a variante clara.
    // Aqui a camada é recalculada na mão, do mesmo jeito que o gerador faz.
    const camadaEm = (t, prof) => {
      let acc = 0;
      for (const l of t.layers) {
        if (l.t <= 0) continue;
        acc += l.t;
        if (prof <= acc) return l.id;
      }
      return planet.blocks.deep;
    };
    let varianteErrada = 0;
    const usadas = { pedra: 0, ardosia: 0 };
    for (let x = -400; x <= 400; x += 7) {
      for (let z = -400; z <= 400; z += 11) {
        const t = terrainAt(planet, x, z);
        for (const r of columnRunsAt(planet, x, z)) {
          const n = r.y1 - r.y0 + 1;
          solidos += n;
          if (r.id.includes("_ore") && !tipoDe.has(r.id)) { semPar += n; continue; }
          const tipo = tipoDe.get(r.id);
          if (!tipo) continue;
          const m = faixa.get(tipo);
          conta.set(tipo, (conta.get(tipo) ?? 0) + n);
          const fundo = r.id.endsWith("_deep");
          for (let y = r.y0; y <= r.y1; y++) {
            const prof = t.height - y + 1;
            if (prof < m.from || prof > m.to) foraDaFaixa++;
            if (prof <= 1) naPoeira++;
            if (fundo) usadas.ardosia++; else usadas.pedra++;
            if (fundo !== (camadaEm(t, prof) === planet.blocks.deep)) varianteErrada++;
          }
        }
      }
    }
    check(`  ${planet.id}: nenhum minério fora da faixa de profundidade dele`,
          foraDaFaixa === 0, `(${foraDaFaixa})`);
    check(`  nenhum aflorando na superfície`, naPoeira === 0, `(${naPoeira})`);
    check(`  nenhum bloco de minério fora da tabela`, semPar === 0, `(${semPar})`);
    check(`  a variante do minério bate com a pedra em que ele está`,
          varianteErrada === 0, `(${varianteErrada} erradas)`);
    check(`  e as duas pedras são usadas`,
          usadas.pedra > 0 && usadas.ardosia > 0,
          `(pedra ${usadas.pedra}, ardósia ${usadas.ardosia})`);

    // A ESCADA DE RARIDADE. É o pedido dele: ferro e ouro muito raros, diamante
    // quase impossível. O teto continua existindo pra nenhum deles virar mina a
    // céu aberto.
    for (const m of planet.ores.list) {
      const taxa = (conta.get(m.ore) ?? 0) / solidos;
      check(`  ${planet.id}/${m.ore}: existe e não é abundante demais`,
            taxa > 0.000004 && taxa < 0.04, `(${(100 * taxa).toFixed(4)}%)`);
    }
    const taxaDe = (o) => (conta.get(o) ?? 0) / solidos;
    if (faixa.has("silicon") && faixa.has("iron")) {
      check(`  ${planet.id}: ferro é MUITO mais raro que silício`,
            taxaDe("iron") * 4 < taxaDe("silicon"),
            `(ferro ${(100 * taxaDe("iron")).toFixed(4)}%, silício ${(100 * taxaDe("silicon")).toFixed(4)}%)`);
    }
    if (faixa.has("gold") && faixa.has("iron")) {
      check(`  e ouro é mais raro que ferro`, taxaDe("gold") < taxaDe("iron"),
            `(ouro ${(100 * taxaDe("gold")).toFixed(4)}%)`);
    }
    if (faixa.has("diamond")) {
      check(`  e diamante é quase impossível`,
            taxaDe("diamond") < taxaDe("gold") / 2,
            `(diamante ${(100 * taxaDe("diamond")).toFixed(4)}% — 1 bloco a cada ` +
            `${Math.round(1 / Math.max(taxaDe("diamond"), 1e-9)).toLocaleString("pt-BR")} de pedra)`);
    }
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
