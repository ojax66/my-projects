# Cérebros

| Arquivo | O que é | Gerado por |
|---|---|---|
| `connectome.json` | adulto: subcircuito do **male CNS (MCNS)**, 650 neurônios | `tools/extract_connectome.py` + `tools/channel_map.json` |
| `larva_connectome.json` | larva: subcircuito do conectoma de **Winding et al. 2023**, 393 neurônios, 2.476 conexões | `tools/extract_larva.py` |

Sem `connectome.json` as moscas usam o circuito padrão (`scripts/brain/default_circuit.gd`).
A tecla **N** alterna entre os dois (a memória aprendida é mantida).

## Regenerar

Coloque os downloads em `brain/codex/` (pasta ignorada pelo git):

```bash
# adulto (Codex, dataset=mcns): tabela de conexoes + neurons.csv.gz
python3 tools/extract_connectome.py \
    --connections brain/codex/connections_princeton.csv.gz \
    --annotations brain/codex/neurons.csv.gz

# larva (Netzschleuder "fly_larva": network.csv.zip)
python3 tools/extract_larva.py brain/codex/larva_network.csv.zip
```

## O que tem no subcircuito do adulto (MCNS)

| Grupo | Neurônios (mantidos/total) | Papel no jogo |
|---|---|---|
| ORNs DM1, DM2, DM3, DM4, DL1, VA2 (E/D) | 6 por lado de cada | odor de cada fruta |
| GRNs de açúcar | 12/16 | pisar em fruta doce |
| GRNs de amargo | 11/11 | limão |
| LPLC2 (E/D) | 10/~90 | looming |
| JO (órgão de Johnston) | 14/210 | vento/sopro |
| ISN + DH44 | 10 | fome |
| IPC | 16 | insulina |
| PAM / PPL1 | 40/217, 16 | dopamina de recompensa / punição |
| pC1 | 16/148 | corte |
| OA-*, 5-HT*, LK | 25, 10, 12 | octopamina, serotonina, leucocinina |
| uPNs dos 6 glomérulos | 20 | projeção olfativa |
| Kenyon cells | 100/3.434 | memória (escolhidas pelas entradas desses PNs) |
| MBONs | 60/97 | saída do corpo cogumelo |
| APL | 2 | inibição que deixa o código das KCs esparso |
| DNp09, DNa02, MDN, DNp01 (GF), MN9, DNg12 | todos | andar, virar, ré, fuga, probóscide, limpeza |
| entradas mais fortes de MN9, DNa02, DNp09, MDN e alvos do açúcar | ~90 | caminhos até os motores |
| interneurônios em caminhos curtos (mais fortes) | ~86 | o resto |

Pesos = contagem real de sinapses × 0,275 mV, com sinal pelo neurotransmissor
previsto do neurônio pré-sináptico (ACh +, GABA −, Glu −).

### Aproximações (para ser honesto)

- **Amostragem**: quando um grupo homogêneo é amostrado (ORNs, KCs, PAM...), as
  sinapses que saem dele são multiplicadas por total/mantidos (KCs limitadas a
  3×) para o alvo receber a entrada média certa.
- **Pontes**: 5 atalhos marcados no JSON (4º campo = 1) para vias funcionais
  conhecidas cujos intermediários ficaram fora da amostra: açúcar → MN9,
  açúcar → PAM, amargo → PPL1, amargo → MDN e amargo ⊣ MN9.
- **Fora da amostra**: os neurônios locais do lobo antenal. Sem a inibição
  lateral que os equilibra, eles saturavam todos os PNs.
- **APL**: o ganho de saída do APL é reduzido (ele é um neurônio graduado, sem
  spikes; no LIF ele satura).
- **GRNs de açúcar e de amargo**: o MCNS não rotula a modalidade deles. São
  os neurônios gustativos que mais fazem sinapse nos "Sugar SEL PN/LN"
  (GNG540, GNG550, GNG056) e no "Bitter-SEL" (DNg28) de Yao & Scott 2022.
- **Navegação e valência**: a atração pelo gradiente de odor soma a saída
  real dos DNs com um termo de tropismo (genes × fome) e a valência lida das
  sinapses KC→MBON alteradas (sinal do MBON vem do tipo de DAN que o inerva:
  PPL1 → promove aproximação, PAM → promove evitação).
- **Cérebro da larva**: o conjunto do Netzschleuder não tem neurotransmissor;
  LNs e APL são tratados como inibitórios, o resto excitatório. Só as sinapses
  axônio→dendrito ("ad") entram (as axo-axônicas, muitas entre KCs, criavam
  excitação em laço). A quimiotaxia da larva soma a assimetria dos DN-VNC
  reais com um termo de tropismo.
- **Modo de taxa**: aproximação de campo médio do LIF com adaptação de
  frequência (mais forte acima de ~100 Hz), que evita que laços excitatórios
  fiquem travados em saturação.
- **Dopamina que ensina**: só a dos DANs que estão recebendo o estímulo
  incondicionado naquele momento (açúcar ingerido → PAM; amargo, susto ou ser
  agarrada → PPL1), acima de uma linha de base lenta. A atividade tônica dos
  DANs não altera a memória.

## Plasticidade

Regra de três fatores do corpo cogumelo (Hige et al. 2015): `Δw = −η · DA_MBON · e_KC · w`
com traço de elegibilidade da KC (~1,5 s) e recuperação lenta para o peso
original (τ = 240 s, esquecimento). `DA_MBON` é a atividade dos DANs que fazem
sinapse naquele MBON no conectoma, acima do basal. A memória
(`FlyBrain.get_memory()`, peso/peso original) pode ser herdada pelos filhotes.
