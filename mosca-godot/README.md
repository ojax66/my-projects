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
| Cérebro | rede LIF com os parâmetros de Shiu et al. (Nature 2024, modelo do conectoma FlyWire) |
| Circuito padrão | ~164 neurônios com **tipos celulares reais** e vias da literatura, mas pesos ilustrativos |
| Conectoma real | `tools/extract_connectome.py` extrai um subcircuito dos CSVs do Codex (FlyWire ou MCNS) — veja `brain/README.md` |

> O download do Codex exige login, então o repositório não traz o conectoma
> em si: traz o extrator e o circuito padrão. Depois de gerar
> `brain/connectome.json`, as moscas passam a usar as sinapses reais.

## O que a mosca faz (tudo sai do cérebro)

- **Olfato**: ORNs Or42b (DM1) → PNs → corno lateral → **DNa02** (virar) e
  **DNp09** (andar). Frutas caídas fermentam e cheiram mais. Comparação
  bilateral + temporal (klinocinese).
- **Paladar**: pisar em fruta → GRNs de açúcar → G2N/Rattle → **MN9**
  (estende a probóscide) e Fdg (para de andar). A fome sobe com o tempo e cai
  enquanto come; saciada, vai embora voando.
- **Amargo** (limão verde): GRNs Gr66a → **MDN** (anda para trás).
- **Looming**: algo vindo rápido (fruta arremessada, você chegando voando)
  → LPLC2 → **Giant Fiber (DNp01)** → decola e foge.
- **Vento** (sopro): órgão de Johnston → **aDN** → limpa as antenas com as
  patas dianteiras.
- Anda em **qualquer superfície com colisão**: chão, frutas (inclusive de
  cabeça para baixo), pedras, troncos e galhos. Se a fruta for chacoalhada, foge.

O painel **Cérebro** (tecla B) mostra o raster de spikes e a taxa de cada
população em tempo real.

## Controles

| | |
|---|---|
| **W A S D** / botões verdes | mover (setas ↑↓ também) |
| **E / Espaço**, **Q / Ctrl** | subir / descer |
| **← → / Z X** | girar |
| **Shift** / **Alt** | rápido / lento; roda do mouse muda a velocidade |
| **botão direito** (segurar) | olhar em volta — **Tab** prende o mouse |
| **C** / botão Seguir | seguir a mosca (W/S zoom, A/D orbita, E/Q inclina) |
| **botão esquerdo** (segurar) | pegar frutas, pedras ou a mosca; solte em movimento para arremessar; roda = distância |
| **F** / botão do meio | soprar |
| **1–6** | criar maçã, cereja, laranja, limão, pedra, mosca |
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
- FlyWire (Dorkenwald et al. 2024) e male CNS (Janelia) via Codex.
