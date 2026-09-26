# Mosca no Jardim — NeuroMechFly + cérebro spiking no Godot 4

Uma *Drosophila melanogaster* virtual vivendo num jardim com árvores
frutíferas. Você é um espectador invisível: voa pelo mundo, segue a mosca,
pega e arremessa frutas e pedras, sopra vento, cria mais frutas e moscas.

**Abra no Godot 4.4+** (`project.godot`) e aperte F5.

## De onde vem cada coisa

| Parte | Origem |
|---|---|
| Corpo (69 segmentos, malhas, cores, hierarquia, pose neutra) | [flygym / NeuroMechFly v2](https://github.com/NeLy-EPFL/flygym), convertido por `tools/convert_flygym.py` |
| Passadas | recortes **reais** de caminhada do flygym (`single_steps_untethered.pkl`, 7 DOFs por perna) |
| Coordenação das pernas | CPG de osciladores acoplados em tripé, igual ao `flygym_demo/complex_terrain` |
| Cérebro do adulto | **conectoma COMPLETO do male CNS (MCNS)**: todos os 166.700 neurônios e 6,2 milhões de conexões (≥ 5 sinapses), rodando na **GPU** (`brain/full/mcns.bin.gz`, `tools/export_full_brain.py`) |
| Cérebro da larva | **conectoma COMPLETO da larva** (Winding et al., *Science* 2023): todos os 2.956 neurônios, também na GPU (`brain/full/larva.bin.gz`) |
| Neurônios | LIF (Shiu et al., Nature 2024) com depressão sináptica de curto prazo. A criatura que você segue roda com **spikes** (1 ms, propagação por eventos); as outras com a aproximação de **campo médio** do mesmo LIF, na mesma GPU |
| Sem Vulkan | no renderizador Compatibility (ou GPU sem compute) o jogo cai automaticamente para os subcircuitos em GDScript (`brain/connectome.json`, 650 neurônios; `brain/larva_connectome.json`, 393) |

Veja `brain/README.md` para o que está no subcircuito, o que é aproximação e
como regenerar a partir dos CSVs do Codex.

## O que a mosca faz

- **Olfato por glomérulo**: cada fruta tem um perfil de odor sobre 6 glomérulos
  (DM1, DM2, DM3, DM4, DL1, VA2). Os ORNs reais desses glomérulos → PNs →
  **Kenyon cells** (código esparso, com o APL) e corno lateral → descendentes.
  Frutas caídas fermentam e cheiram mais.
- **Memória e aprendizado contínuo**: as sinapses **KC → MBON** do corpo
  cogumelo mudam quando chega **dopamina** — PAM (recompensa: comer açúcar) ou
  PPL1 (punição: amargo, susto, ser agarrada por você). Os DANs que inervam
  cada MBON vêm do conectoma. A memória é específica do cheiro e é esquecida
  devagar. A "valência aprendida" do cheiro atual guia a mosca: ela passa a ir
  atrás dos cheiros que deram comida e a fugir dos que deram susto.
- **Hormônios e químicos**: os neurônios neuroendócrinos e modulatórios do
  próprio conectoma liberam substâncias na hemolinfa — **insulina** (IPC),
  **DH44/ISN**, **octopamina** (OA-*), **serotonina** (5-HT), **leucocinina**
  (LK), **dopamina** (PAM/PPL1) — e o corpo solta **AKH** no jejum. Cada uma
  tem sua dinâmica e modula sensibilidade ao açúcar e ao cheiro, locomoção,
  alimentação e a velocidade de aprendizado.
- **Metabolismo**: come a polpa de verdade (a fruta encolhe e escurece até
  sumir), o alimento vai para o papo, é digerido em energia, e o resíduo sai
  como **excremento** (gotinhas escuras onde ela anda). Morre de **fome**, de
  **velhice** ou **esmagada** por objetos arremessados.
- **Reprodução**: machos maduros perto de fêmeas ativam os **pC1** (corte),
  seguem a fêmea, cantam com uma asa e copulam. A fêmea fecundada bota **ovos**
  nas frutas → **larva** (com o cérebro da larva: rasteja por peristaltismo,
  come, cresce, foge da luz) → **pupa** (escurece) → **adulto**.
- **Evolução**: cada filhote mistura os genes dos pais com mutações (tamanho,
  cor, velocidade, ganho motor, olfato, preferências inatas por glomérulo,
  taxa de aprendizado, metabolismo, longevidade, fecundidade...). Quem come e
  se reproduz mais passa mais genes. Com **"Herança do aprendizado"** ligada
  (padrão), o filhote também nasce com metade das memórias KC→MBON dos pais —
  isso é lamarckiano (na biologia real só os genes passam), então há um botão
  para desligar.
- **Sistema nervoso periférico completo** (139 canais do conectoma): ORNs de
  ~50 glomérulos por lado (inclui cVA dos machos no DA1), GRNs de açúcar,
  amargo e água na **boca, pernas e asas**, cerdas táteis das pernas, asas,
  corpo e cabeça, **propriocepção** (pernas, halteres, pescoço), **dor**
  (multidendríticos do abdome e das pernas), **fotorreceptores** R1–6/R7–8
  de cada olho (sol x sombra), **termo** e **higrossensores**, órgão de
  Johnston (vento e o **canto** do macho), LPLC2 (looming).
- **Dor e saúde**: batidas, ser apertada nos dedos e calor ao sol doem; a dor
  ativa os nociceptores do conectoma, ensina (PPL1) e tira saúde. **Algo
  pesado caindo em cima esmaga** a mosca ou a larva (fica achatada, com uma
  mancha de hemolinfa); coisas leves só machucam.
- Continua: segue cheiro, come, foge de looming (Giant Fiber), anda para trás
  com amargo, limpa as antenas com vento, anda em qualquer superfície.
- **Larva**: além do cérebro completo, tem os órgãos visíveis — ganchos da
  boca, órgão de Bolwig (olhinhos), intestino que enche quando come, corpo
  gorduroso que cresce com a energia, traqueias — e a mesma fisiologia da
  mosca (energia, digestão, excremento, dor, morte). Com dor forte faz o
  **rolamento de fuga**; tocada, recua.

O painel **Cérebro** (B) mostra spikes e taxas por população; o painel de
**vida** (L) mostra sexo, geração, idade, energia, memória, genes, as barras
de hormônios e a população.

## Mundo, decisão, memória e arquivos

- **Começa vazio**: a tela inicial oferece *Continuar mundo salvo* ou *Novo
  mundo (sem moscas)*; as moscas entram pelo Menu → **+ Mosca**.
- **Dia e noite**: um dia dura 12 min de jogo (x1). De noite o sol se põe, a
  luz entra fraca nos fotorreceptores e as moscas dormem.
- **Tempo**: barra de cima com **Pausar**, **x1/x2/x4/x8** (e câmera lenta),
  **Salvar** e **Sair** (salva e fecha). Salva sozinho a cada 4 min e quando o
  app vai para o fundo.
- **Cérebro zerado**: ninguém nasce sabendo de nada — nem que o limão é
  amargo. A memória de cheiros (`scripts/brain/creature_memory.gd`) só
  aprende pelo paladar (açúcar +, amargo −) ou vendo outro indivíduo comer ou
  cuspir; susto, dor e ser pego vão para a memória de perigo, então a maçã
  nunca fica "negativa". Cada fruta tem uma assinatura de cheiro própria, e o
  que se aprende do limão não contamina a laranja nem a maçã.
- **Tomada de decisão**: a cada ~0,5 s cada mosca/larva pesa *comer, buscar
  comida, evitar, fugir, descansar, explorar* (larva: *comer, procurar comida,
  desviar, evitar, pupar*) a partir de fome, medo, noite, hormônios, memória e
  sentidos. O conectoma continua gerando o andar, o giro e os reflexos.
- **Esmagamento**: só se algo pesado cair **literalmente em cima**, vindo de
  cima e em queda (`scripts/world/hazards.gd`). Ficar embaixo de uma fruta
  parada ou levar uma batida de lado não mata (só machuca).
- **Aprendizado social**: quem vê outro indivíduo morrer esmagado aprende o
  lugar perigoso e fica com medo de coisas caindo, e passa a desviar quando
  algo cai na sua direção.
- **Conectoma único por indivíduo**: cada sinapse tem um fator de peso
  herdado (um "haplótipo" de fiação da mãe, outro do pai, mais uma mutação
  própria). Cada indivíduo vivo tem um arquivo
  `user://mundo/individuos/<id>.json` com genes, as sementes da fiação, os
  pesos KC→MBON aprendidos, a memória e o corpo; os mortos vão para
  `user://mundo/arquivo/`. O conectoma base de cada espécie já vem no jogo
  (`brain/full/*.bin.gz`), sem precisar extrair nada.

## Ciclo de vida (em dias do jogo)

- **Ovo** ~1 dia → **larva** em 3 estágios (L1, L2, L3) com **mudas de pele**
  (fica a cutícula velha): cada estágio exige dias e comida, ~4 dias no total
  comendo quase sem parar → **pupa** ~4 dias → **mosca**.
- **Frutas**: amadurecem nas árvores e caem ao longo de dias; novas crescem
  aos poucos. Caídas, fermentam, e depois de ~3 dias apodrecem (escurecem,
  murcham, achatam) e em mais ~2 dias viram terra. Não há limite de frutas.
  Os furos das larvas aceleram o apodrecimento.
- A larva cava **buracos de verdade** e entra de cabeça: na **polpa** (o furo
  fica na casca da fruta) e na **terra** (buraco com a terra tirada em volta,
  que fica ~1 dia). A larva come **enterrada na polpa**, **cava buracos na terra** para se
  esconder quando tem medo ou sente algo caindo, e a L3 errante **escolhe um
  lugar seguro** para pupar (longe de perigos lembrados, fora de onde caem
  frutas, fora da comida, na sombra), enterrada se for terra.
- **Pupa**: casulo semitransparente onde dá para ver a larva sendo dissolvida
  (histólise), os discos imaginais crescendo, o corpo da mosca se formando,
  os olhos ficando vermelhos e a cutícula escurecendo. Segure para pegar e
  carregar (se estiver enterrada, você a desenterra). No fim fica o pupário
  vazio.
- **Memória**: os filhos herdam só os genes e a fiação do conectoma e nascem
  sem memória. Da larva para a mosca adulta ~60% da memória sobrevive, como
  na vida real (Tully et al. 1994).

## Lagos, rãs e girinos

- **Dois lagos** com água, algas no fundo (crescem com a luz do dia) e
  frutas que caem e boiam. Moscas e larvas não entram na água.
- **Conectomas sintéticos v2** (`tools/build_amphibian_brain.py`): não
  existe conectoma medido de rã/girino, então eles são construídos por regras
  da anatomia e fisiologia publicadas, no mesmo formato e motor (GPU, LIF,
  plasticidade com dopamina) dos de inseto. As ligações são dadas pelo número
  de entradas por neurônio, com mapas topográficos: a posição da presa no
  campo visual vira posição no teto óptico, que vira o ângulo do giro.
  - **rã: 221.550 neurônios, 13,9 milhões de sinapses**, 131 grupos. Tem:
    - retina de 8 setores (R2 inseto, R3/R4 ameaça, R1, binocular,
      optocinético);
    - teto T5.1/5.2/5.3/T6/T1-4, pré-teto TH3, lentiforme, isthmi e tálamo;
    - pálio medial (hipocampo), pálio dorsal e lateral, estriado, accumbens,
      septo, amígdalas e área pré-óptica;
    - bulbo olfativo e vomeronasal; audição (papilas → bulbo → oliva →
      toro → tálamo); vestibular e sáculo (vibração do chão);
    - cerebelo com 25 mil grânulos;
    - hipotálamo: fome/saciedade, relógio, corticosterona, vasotocina,
      GnRH, TRH, MSH, sede e temperatura; dopamina, noradrenalina,
      serotonina e melatonina;
    - reticular com mapa de orientação, aproximação e fuga;
    - língua (protrator e retrator), boca, retrator do bulbo, membrana
      nictitante;
    - gerador vocal (canto de anúncio, de soltura e grito de socorro),
      geradores respiratórios bucal e pulmonar, coração;
    - medula com motoneurônios de cada junta: quadril, joelho, tornozelo,
      tarso e dedos do pé; ombro (frente, trás, baixo, cima), cotovelo,
      punho e dedos da mão. Os geradores da medula são: salto
      (sinergia extensora), recolher, meio-centros com Ia e cansaço (dão o
      ritmo do chute e dos pulos seguidos), comissurais de sincronia (as
      duas pernas juntas) e de alternância (passo), Renshaw, apoio dos
      braços, pouso (braços à frente no ar), braços para trás no nado,
      limpar o rosto e abraço do amplexo;
    - glândulas da pele e defesa inflando o corpo.
  - **girino: 38.766 neurônios, 2,5 milhões de sinapses**. Tem:
    - medula de Roberts et al.: Rohon-Beard, dlc/dla, dIN, cIN, aIN,
      motoneurônios e o circuito de se debater quando é segurado;
    - Mauthner e células de fuga, MHR e glândula de cimento (parar),
      reticuloespinhais;
    - linha lateral, pineal, retina de 8 setores → teto retinotópico;
    - olfato, paladar, pálio/estriado com dopamina, cerebelo;
    - boca (raspar algas), bomba bucal, coração;
    - hipotálamo com o eixo TRH → tireoide, que dá o ritmo da metamorfose.
  - No jogo, a rã recebe dos sentidos:
    - os 8 setores dos olhos e o fluxo óptico do próprio giro;
    - vibração (fruta caindo, o jogador andando perto), a pele secando, o
      estômago cheio e a pressão;
    - a propriocepção das pernas, a carga nas mãos, se está no ar ou dentro
      d'água, o polegar no amplexo, a irritação depois de um gosto ruim;
    - a luz na pineal e os hormônios da época de reprodução.
  - E faz o que o cérebro manda:
    - gira, pula, anda, usa a língua e abre a boca;
    - afunda os olhos para engolir e pisca;
    - limpa a boca com as mãos e abraça no amplexo;
    - grita quando é segurada (o macho dá o canto de soltura);
    - infla o corpo, solta muco e escurece a pele (MSH);
    - canta só quando o gerador vocal liga;
    - fica sem fome sob estresse e procura água com sede.
  - O girino se debate quando é segurado, e a metamorfose segue o próprio
    hormônio tireoidiano.
  - `python3 tools/build_amphibian_brain.py --test` mostra as respostas de
    cada caso (presa, ameaça, canto, sede, amplexo, noite...).
- **Modelo da rã (feito do zero)**: `tools/build_frog_body.py` esculpe o
  corpo com as proporções e a aparência de um sapo-banjo sentado:
  - tronco cheio com gordura e barriga apoiada, coxas grossas e musculosas,
    panturrilha, glândula tibial;
  - braços fortes, pés com 5 dedos compridos e membrana, mãos com 4 dedos;
  - cabeça larga com sulco da boca, pálpebras saltadas, tímpano, narinas e
    verrugas; o papo fica recolhido (só o saco vocal infla, no canto).
  Tem esqueleto (os mesmos ossos) e pesos por vértice tirados das próprias
  partes. A pele é pintada pelo shader, sem textura (`shaders/frog_skin.*`):
  dorso escuro com reticulado e verrugas cor de ferrugem, flancos
  marmorizados, barriga creme, faixas nas patas, lábio bronze, pele úmida
  com relevo. A gordura do corpo aumenta e diminui com a energia. Os olhos
  são globos separados, com íris dourada e pupila horizontal.
- **Órgãos anatômicos** (`tools/build_frog_organs.py`,
  `tools/build_tadpole_organs.py` → `frog/*_organs.bin`): cada órgão é
  esculpido como superfície implícita (SDF) dentro da cavidade do próprio
  corpo (a pele voxelizada) e poligonizado; eles se encaixam uns nos outros
  como numa dissecação. A rã tem:
  - coração com seio venoso, 2 átrios, ventrículo e cone arterial em espiral;
  - arcos aórticos (carotídeo, sistêmico, pulmocutâneo), aorta dorsal, cavas,
    veia abdominal e porta hepática;
  - pulmões com septos alveolares e fígado de 3 lobos com vesícula;
  - estômago em J, pâncreas, duodeno, intestino delgado de ~1,6× o corpo
    (acomodado por relaxação física, sem atravessar nada), baço, intestino
    grosso e cloaca;
  - rins com adrenais e ureteres, bexiga bilobada e corpos gordurosos;
  - testículos no macho; na fêmea, ovários com ~300 óvulos pigmentados e
    ovidutos;
  - encéfalo completo, medula, nervos ópticos, plexo braquial e ciáticos;
  - crânio, mandíbula, coluna com sacral e urostilo, pelve, cintura
    escapular, esterno e os ossos de cada membro;
  - músculos da coxa (cruralis, grácil, semimembranoso, sartório), da perna
    (gastrocnêmio com tendão de Aquiles, tibial, fibular), do braço e do
    antebraço.
  O shader de tecido (`shaders/organ.gdshaderinc`) desenha vasos, alvéolos,
  lóbulos e fibras.
  O girino tem o intestino em espiral dupla com esôfago e manicotto, fígado,
  coração (seio, átrio, ventrículo, bulbo), artérias branquiais, brânquias
  internas em franja nos 4 arcos, pronefros, pulmões que crescem, encéfalo,
  medula e notocorda. A pele do girino tem barriga translúcida, bico córneo,
  espiráculo e cauda com miômeros e nadadeiras.
- **Órgãos em movimento**: os átrios contraem antes do ventrículo, e o
  ventrículo empalidece ao ejetar o sangue. Os pulmões enchem a partir do
  hilo; o estômago, o intestino, os corpos gordurosos e os ovários mudam com
  a comida e a energia. Os músculos incham e avermelham quando os
  motoneurônios contraem, e as brânquias do girino somem na metamorfose.
- **Velhice, quedas e genética** (`scripts/life/mortality.gd`,
  `genome.gd`):
  - velhice pela lei de Gompertz: o risco de morrer cresce com a idade, a
    mediana é o gene `lifespan`, e os velhos ficam mais lentos e fracos;
  - quedas: a velocidade do impacto é a da queda livre freada pelo ar. A rã
    se machuca ou morre caindo de alto (ex.: largada pelo jogador), a larva
    mole também; a pupa aguenta mais, e a mosca é leve demais para se
    machucar;
  - genes mendelianos recessivos (portador x afetado), herdados um de cada
    pai, com mutações novas raras; cruzamento entre parentes gera mais
    defeitos:
    - mosca: `vestigial` (não voa), `curly` (asas enroladas, voo fraco),
      `white` (olho branco, enxerga mal), `ebony` (corpo escuro), `shaker`
      (cansa e vive menos), letal (morre larva);
    - rã: ectromelia (sem uma pata), polimelia (pata extra), anoftalmia (sem
      um olho), albinismo (resseca no sol), cardiopatia (arritmia, vive
      menos), escoliose (pula e nada mal), letal (morre girino);
  - o painel mostra os defeitos e de quais o indivíduo é portador;
  - fruta caindo não mata rã: só dá uma pancada e um susto.
- **Rã caçadora de verdade**: fica de tocaia, mas desiste de um lugar sem
  presa. O tempo de desistência é mais curto com fome. Então ela vai
  procurar aos saltos (uns pulos, para e olha em volta), escolhendo:
  - os lugares onde já comeu (memória);
  - as frutas no chão, onde as moscas se juntam;
  - a beira do lago;
  - ou um rumo novo.
  Caça mais no crepúsculo e à noite, e no sol forte do meio-dia se abriga
  na sombra das árvores.
- **Sem animação pronta** (`frog_limbs.gd`, `frog.gd`): cada junta tem o
  seu par de motoneurônios no conectoma (extensor e flexor), e o músculo leva
  a junta ao ângulo de equilíbrio entre os dois. O salto, o recolher, o
  passo, o apoio dos braços, o pouso e o nado saem da medula do conectoma,
  não do script. O corpo é esculpido com os membros esticados e separados.
  Cada osso tem a sua junta: fêmur, tíbia, tarso, pé, os 5 dedos do pé, úmero,
  antebraço, mão e os 4 dedos da mão. A postura sentada é só o ângulo 0.
  No chão, o esqueleto assenta nos pontos que encostam (pés, mãos,
  barriga, queixo), então a mão não atravessa o chão. Pé encostado que vai
  para trás empurra o corpo para a frente. A perna esticando rápido lança o
  corpo na linha pé → quadril, com a catapulta dos tendões (~1,7 m/s, uns
  8 corpos). No ar, os braços vão à frente e recebem o chão. Na água o
  corpo deita, os braços vão para trás e as duas pernas chutam juntas. A
  membrana dos pés (dedos abertos pelo conectoma) empurra a água pelo
  arrasto, fecha na volta, e o corpo desliza entre os chutes. A língua sai
  quando o hipoglosso dispara. No girino, os motoneurônios E/D contraem os miômeros
  em onda pela cauda, e a onda empurra a água; a Mauthner contrai um lado
  inteiro (curva em C).
- **Órgãos funcionando** (`organs.gd`): o coração bate no ritmo dos neurônios
  simpático e vago do conectoma; o gerador respiratório move a garganta
  (bomba bucal), que enche os pulmões só com a narina fora d'água; há
  respiração pela pele e brânquias no girino. O O2 do sangue cai com o
  esforço, e O2 baixo ativa os quimiorreceptores, que fazem respirar mais; a
  presa vai para o estômago e é digerida.
- **Olhos de raios** (`retina.gd`): cada olho amostra a cena com raios (luz,
  sombra, algo grande chegando). Para os pontinhos que se mexem, lança um raio
  de linha de visão (pedras e frutas tapam) e mede o movimento pela mudança
  de posição entre as olhadas. Na faixa binocular da frente estima a
  distância (presa perto → língua). O próprio movimento não conta como
  ameaça. **Ouvidos**: os tímpanos E/D ouvem o canto das outras rãs.
- **Rã**: caça "senta e espera" objetos pequenos que se mexem (moscas,
  larvas, girinos, até pedrinhas), pula até perto e dispara a língua (~70 ms);
  engole afundando os olhos. Aprende: mosca = comida; pedrinha = cospe e passa
  a ignorar. Resseca fora d'água e volta para o lago; foge pulando para a
  água. De noite os machos cantam (saco vocal), a fêmea segue o canto,
  amplexo e desova na água.
- **Desova** (~1,5 dia) → **girinos**: nadam com a cauda (motoneurônios E/D),
  raspam algas, sentem ondas pela linha lateral e fogem com a Mauthner;
  crescem em ~6 dias, ganham patas traseiras e dianteiras, reabsorvem a cauda
  e saem do lago como rã jovem (parte da memória fica).
- **Moscas aprendem com o predador**: ver uma rã comer outra marca o lugar como
  perigoso e faz fugir.
- **Vários mundos salvos**: a tela inicial lista todos (continuar ou
  **Apagar**, com confirmação) e "Novo mundo" cria outro.

## Controles

**Toque / mouse (o botão esquerdo do mouse funciona como um dedo):**

| | |
|---|---|
| arrastar o dedo na tela | girar a câmera |
| segurar o dedo parado (~0,3 s) em cima de algo | pegar fruta, pedra, mosca ou larva; arraste para mover e solte para largar/arremessar |
| toque rápido numa mosca/larva | passar a segui-la |
| dois dedos (pinça) | zoom |
| botões verdes grandes (canto inferior esquerdo) | andar, subir/descer, girar — funcionam junto com outro dedo na tela |
| **Ir até a mosca**, **Seguir**, **Soprar**, **Menu** | canto inferior direito; o Menu cria frutas/pedras/moscas/larvas e abre os painéis |

**Teclado:** W A S D (setas) andar, E/Espaço sobe, Q/Ctrl desce, Z/X girar,
Shift/Alt rápido/lento, roda = velocidade, botão direito = olhar, Tab prende
o mouse, C seguir, I ir até a mosca, F soprar, 1–7 criar itens, 8 rã, 9 girino, 0 desova, Del apagar o
segurado, P pausar, T acelerar o tempo, F5 salvar, B cérebro, L vida, N trocar
cérebro, H ajuda.

## Desempenho e requisitos

- Cérebro completo: precisa de **Vulkan** (renderizador Forward+ ou Mobile).
  O conectoma (≈ 50 MB de sinapses) é carregado uma vez; cada mosca guarda só
  o próprio estado (~5 MB de GPU) e a própria memória KC→MBON.
- Os cérebros rodam num lote assíncrono por quadro (a GPU calcula enquanto a
  CPU cuida da física e do desenho), com um orçamento de sinapses por quadro
  que se ajusta sozinho ao FPS. A criatura seguida tem prioridade; as outras
  rodam em passos de 50–120 ms de campo médio.
- Física a 60 ticks/s; o CPG usa sub-passos maiores. **Gráficos leves** (Menu)
  desliga SSAO/brilho, reduz sombras, grama e a resolução 3D (padrão no
  celular).
- Testado só com Vulkan emulado na CPU (lavapipe); **não pude medir em GPU
  real**. Se ainda ficar pesado: Gráficos leves, menos moscas, ou N para o
  subcircuito.
- Para exportar, veja `export_presets_nota.txt` (os conectomas precisam entrar
  no filtro de arquivos).

## Escala

1 unidade = 1 mm. A mosca tem ~2,5 mm; uma maçã tem ~75 mm; as árvores têm
1–1,6 m e o jardim 6 × 6 m. A mosca anda a ~15–20 mm/s como uma mosca de
verdade — use o modo seguir e a câmera lenta para ver as pernas.

## Estrutura

```
fly/                    malhas OBJ + fly_model.json (gerados do flygym)
scripts/fly/            corpo (fly_body), CPG (fly_cpg), agente (fly)
scripts/brain/          simulador LIF (fly_brain) e circuito padrão
scripts/world/          jardim, árvores, frutas, pedras
scripts/player/         câmera espectadora e manipulação
scripts/ui/             HUD, botões, painel do cérebro
shaders/                chão, grama, folhas, frutas
tools/                  conversor do flygym, extrator do conectoma, texturas
```

Para regenerar o modelo: `git clone https://github.com/NeLy-EPFL/flygym` e
`python3 tools/convert_flygym.py ../flygym` (precisa de `numpy` e `pyyaml`).

## Créditos

- NeuroMechFly / flygym — Lobato-Rios et al. 2022, Wang-Chen et al. 2024 (NeLy, EPFL), licença Apache-2.0.
- Modelo LIF do conectoma — Shiu et al. 2024, *A Drosophila computational brain model reveals sensorimotor processing*.
- Male CNS (MCNS, Janelia/FlyEM) e FlyWire (Dorkenwald et al. 2024) via Codex.
- Conectoma da larva — Winding et al. 2023, *The connectome of an insect brain*, Science 379 eadd9330.
- GRNs de açúcar/amargo identificados pelas conexões até os interneurônios de Yao & Scott 2022.
