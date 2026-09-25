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
- **Conectomas sintéticos** (`tools/build_amphibian_brain.py`): não existe
  conectoma medido de rã/girino, então eles são construídos por regras da
  anatomia publicada, no mesmo formato e motor (GPU, LIF, plasticidade com
  dopamina) dos de inseto:
  - **girino** (7.078 neurônios): medula de Roberts et al. (Rohon-Beard, dlc,
    dla, dIN, cIN, aIN, motoneurônios), célula de Mauthner (fuga em C),
    linha lateral, pineal (sombra faz nadar), MHR (parar), teto óptico, pálio
    e estriado com dopamina, CPG da boca;
  - **rã** (25.570 neurônios): retina R2 → teto T5.2 (presa) → orientação,
    aproximação e hipoglosso (língua); R3/R4 → pré-teto (ameaça), que suprime
    a caça e aciona a fuga (Ewert); membros posteriores (pulo), gerador vocal,
    hipotálamo (fome), pálio → estriado com dopamina de recompensa/punição.
  - `python3 tools/build_amphibian_brain.py --test` mostra as respostas (presa
    à esquerda → orientar à esquerda + língua; ameaça → fuga e pulo...).
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
