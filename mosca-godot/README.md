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
| Cérebro do adulto | **subcircuito real do male CNS (MCNS/Codex)**: 650 neurônios e ~6.100 conexões com contagem real de sinapses e sinal pelo neurotransmissor previsto (`brain/connectome.json`, gerado por `tools/extract_connectome.py`) |
| Cérebro da larva | **conectoma da larva** (Winding et al., *Science* 2023): 393 neurônios (`brain/larva_connectome.json`, `tools/extract_larva.py`) |
| Desempenho | a mosca seguida roda o LIF com spikes (~20% de um núcleo); as outras usam o campo médio (~1,5% cada). Limite de 14 adultos e 18 larvas |
| Neurônios | LIF com os parâmetros de Shiu et al. (Nature 2024). A mosca que você segue roda com spikes; as outras, com a aproximação de campo médio do mesmo LIF (mesmos pesos, bem mais barata) |
| Circuito padrão (reserva) | ~164 neurônios com tipos celulares reais e pesos ilustrativos (`scripts/brain/default_circuit.gd`), usado se não houver `connectome.json` |

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
- Continua: segue cheiro, come, foge de looming (Giant Fiber), anda para trás
  com amargo, limpa as antenas com vento, anda em qualquer superfície.

O painel **Cérebro** (B) mostra spikes e taxas por população; o painel de
**vida** (L) mostra sexo, geração, idade, energia, memória, genes, as barras
de hormônios e a população.

## Controles

| | |
|---|---|
| **W A S D** / botões verdes | mover (setas ↑↓ também) |
| **E / Espaço**, **Q / Ctrl** | subir / descer |
| **← → / Z X** | girar |
| **Shift** / **Alt** | rápido / lento; roda do mouse muda a velocidade |
| **botão direito** (segurar) | olhar em volta — **Tab** prende o mouse |
| **C** / botão Seguir | seguir a mosca (W/S zoom, A/D orbita, E/Q inclina) |
| **botão esquerdo** (segurar) | pegar frutas, pedras, moscas ou larvas; solte em movimento para arremessar; roda = distância (ser agarrada é aversivo: a mosca aprende a evitar o cheiro daquele momento) |
| **F** / botão do meio | soprar |
| **1–7** | criar maçã, cereja, laranja, limão, pedra, mosca, larva |
| **I** / botão "Ir até a mosca" | teleporta até a mosca e passa a segui-la |
| **L** | painel de vida (hormônios, memória, genes, população) |
| **Del** | apagar o objeto segurado |
| **T** | câmera lenta (x1, x0.5, x0.25, x0.1) — a mosca pisa a ~12 Hz |
| **B / H / N** | cérebro / ajuda / trocar cérebro |

Os botões de movimento na tela funcionam com mouse e toque (segurar = tecla
pressionada). As texturas estão em `assets/ui/` e são geradas por
`tools/make_textures.py`.

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
