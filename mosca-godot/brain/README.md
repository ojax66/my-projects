# Cérebro da mosca

O jogo procura `brain/connectome.json`. Se existir, todas as moscas usam esse
cérebro; senão usam o circuito padrão (`scripts/brain/default_circuit.gd`).
Com os dois disponíveis, a tecla **N** (ou o botão "Trocar cerebro") alterna.

## Gerando a partir do conectoma real (Codex / FlyWire / MCNS)

1. Entre no Codex (<https://codex.flywire.ai/api/download>, precisa de login) e
   baixe para `brain/codex/` (pasta ignorada pelo git):
   - a tabela de conexões (`connections*.csv.gz`)
   - a tabela de anotações/tipos celulares (`classification.csv.gz`,
     `neurons.csv.gz` ou `consolidated_cell_types.csv.gz`)
2. Rode:

   ```bash
   python3 tools/extract_connectome.py \
       --connections brain/codex/connections.csv.gz \
       --annotations brain/codex/classification.csv.gz \
       --out brain/connectome.json
   ```

3. O script mostra quantos neurônios achou para cada canal (odor, açúcar,
   amargo, LPLC2, JO, DNp09, DNa02, MDN, Giant Fiber, MN9, aDN...). Se algum
   vier **VAZIO**, ajuste as expressões regulares em `tools/channel_map.json`
   (os nomes de tipos mudam entre FlyWire, MANC e MCNS) ou liste os IDs.

O subcircuito mantém os neurônios em caminhos curtos (via conexões mais
fortes) das entradas sensoriais até os neurônios descendentes, com no máximo
`--max-neurons` (padrão 600 — o simulador em GDScript roda ~500–800 neurônios
em tempo real). Os pesos são as contagens reais de sinapses, com sinal pelo
neurotransmissor (ACh +, GABA −, Glu −) e os parâmetros LIF de Shiu et al. 2024.

## Formato do JSON

```json
{
  "name": "...", "source": "...",
  "params": {"w_syn": 0.275, "ref_rate": 60},
  "neurons": [{"id": "7205...", "type": "DNa02", "group": "DNa02_L"}],
  "edges": [[pre_idx, post_idx, sinapses_com_sinal]],
  "channels": {
    "inputs":  {"odor_L": ["ORN_DM1_L"], "sugar_L": [...], "loom_L": [...], "mechano": [...], "hunger": [...], "explore_fwd": [...]},
    "outputs": {"forward_L": ["DNp09_L"], "turn_L": ["DNa02_L"], "backward": [...], "escape": [...], "proboscis": [...], "groom": [...]}
  }
}
```
