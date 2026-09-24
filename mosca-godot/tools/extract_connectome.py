#!/usr/bin/env python3
"""Extrai um subcircuito sensorio-motor do conectoma real para o jogo.

Funciona com os downloads do Codex (https://codex.flywire.ai/api/download),
tanto do FlyWire (dataset=fafb) quanto do male CNS (dataset=mcns), e com
exportacoes do neuPrint. So usa a biblioteca padrao do Python.

Passo a passo:
  1. Baixe no Codex (precisa de login) a tabela de conexoes e a de
     anotacoes/classificacao, por exemplo:
        connections*.csv.gz          (pre_root_id, post_root_id, syn_count, nt_type ...)
        classification.csv.gz / neurons.csv.gz / consolidated_cell_types.csv.gz
  2. Rode:
        python3 tools/extract_connectome.py \\
            --connections brain/codex/connections.csv.gz \\
            --annotations brain/codex/classification.csv.gz brain/codex/neurons.csv.gz \\
            --out brain/connectome.json
  3. Abra o jogo: se brain/connectome.json existir, as moscas usam esse cerebro.

Como funciona:
  * Os canais de entrada (odor, acucar, amargo, looming, vento...) e de saida
    (DNp09, DNa02, MDN, Giant Fiber, MN9, aDN...) sao definidos por expressoes
    regulares sobre o tipo celular em tools/channel_map.json. O script mostra
    quantos neuronios achou para cada canal: ajuste o mapa se algum ficar vazio
    (a nomenclatura muda entre FlyWire, MANC e MCNS). Tambem da para listar IDs.
  * Mantem os neuronios que estao em caminhos curtos (ate --depth sinapses
    intermediarias) das entradas para as saidas, seguindo as conexoes mais
    fortes, limitado a --max-neurons.
  * Sinal das sinapses como em Shiu et al. 2024: ACh +, GABA -, Glu -.
"""
import argparse
import csv
import gzip
import io
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

csv.field_size_limit(10**9)

PRE_COLS = ["pre_root_id", "pre_pt_root_id", "pre", "bodyId_pre", "pre_id", "source", "from"]
POST_COLS = ["post_root_id", "post_pt_root_id", "post", "bodyId_post", "post_id", "target", "to"]
W_COLS = ["syn_count", "weight", "w", "count", "synapses", "n_syn"]
NT_EDGE_COLS = ["nt_type", "nt", "predicted_nt", "neurotransmitter"]
ID_COLS = ["root_id", "bodyId", "body_id", "id", "pt_root_id", "segment_id"]
TYPE_COLS = ["cell_type", "type", "primary_type", "hemibrain_type", "mcns_type", "instance", "cell_class", "class"]
SIDE_COLS = ["side", "soma_side", "somaSide", "rootSide", "hemisphere"]
NT_COLS = ["nt_type", "predicted_nt", "predictedNt", "consensusNt", "top_nt", "celltypePredictedNt"]

SIGN = {"ach": 1, "acetylcholine": 1, "gaba": -1, "glut": -1, "glu": -1, "glutamate": -1}


def open_text(path):
    p = Path(path)
    if p.suffix == ".gz":
        return io.TextIOWrapper(gzip.open(p, "rb"), encoding="utf-8", newline="")
    return open(p, encoding="utf-8", newline="")


def pick(header, options, required=True, what=""):
    low = {h.lower(): h for h in header}
    for o in options:
        if o.lower() in low:
            return low[o.lower()]
    if required:
        sys.exit(f"Nao achei a coluna de {what} em {header}. Esperava uma de {options}")
    return None


def norm_side(s):
    s = (s or "").strip().lower()
    if s in ("l", "left", "lh"):
        return "L"
    if s in ("r", "right", "rh"):
        return "R"
    return "C" if s else ""


def load_annotations(paths):
    info = {}
    for path in paths:
        with open_text(path) as f:
            rd = csv.DictReader(f)
            idc = pick(rd.fieldnames, ID_COLS, what="id")
            tcols = [c for c in TYPE_COLS if c in rd.fieldnames]
            sc = pick(rd.fieldnames, SIDE_COLS, required=False)
            nc = pick(rd.fieldnames, NT_COLS, required=False)
            for row in rd:
                nid = row[idc].strip()
                d = info.setdefault(nid, {"type": "", "side": "", "nt": ""})
                if not d["type"]:
                    for c in tcols:
                        if row.get(c):
                            d["type"] = row[c].strip()
                            break
                if sc and not d["side"]:
                    d["side"] = norm_side(row.get(sc))
                if nc and not d["nt"]:
                    d["nt"] = (row.get(nc) or "").strip().lower()
        print(f"  anotacoes: {path} -> {len(info)} neuronios")
    return info


def load_edges(path, min_syn):
    out = defaultdict(list)
    inc = defaultdict(list)
    edge_nt = {}
    n = 0
    with open_text(path) as f:
        rd = csv.DictReader(f)
        pc = pick(rd.fieldnames, PRE_COLS, what="pre-sinaptico")
        qc = pick(rd.fieldnames, POST_COLS, what="pos-sinaptico")
        wc = pick(rd.fieldnames, W_COLS, what="numero de sinapses")
        ntc = pick(rd.fieldnames, NT_EDGE_COLS, required=False)
        agg = defaultdict(int)
        for row in rd:
            try:
                w = int(float(row[wc]))
            except ValueError:
                continue
            key = (row[pc].strip(), row[qc].strip())
            agg[key] += w  # soma entre neuropilos
            if ntc and row.get(ntc):
                edge_nt[key[0]] = row[ntc].strip().lower()
            n += 1
            if n % 2_000_000 == 0:
                print(f"  ... {n:,} linhas")
    for (a, b), w in agg.items():
        if w >= min_syn and a != b:
            out[a].append((b, w))
            inc[b].append((a, w))
    print(f"  conexoes: {n:,} linhas, {sum(len(v) for v in out.values()):,} pares com >= {min_syn} sinapses")
    return out, inc, edge_nt


def match_channel(spec, info):
    ids = set(str(i) for i in spec.get("ids", []))
    pats = [re.compile(p) for p in spec.get("types", [])]
    for nid, d in info.items():
        if any(p.search(d["type"]) for p in pats):
            ids.add(nid)
    return ids


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--connections", required=True)
    ap.add_argument("--annotations", nargs="+", required=True)
    ap.add_argument("--map", default=str(Path(__file__).with_name("channel_map.json")))
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "brain/connectome.json"))
    ap.add_argument("--min-syn", type=int, default=5, help="limiar de sinapses por par (FlyWire usa 5)")
    ap.add_argument("--depth", type=int, default=2, help="camadas intermediarias entre entrada e saida")
    ap.add_argument("--fanout", type=int, default=25, help="conexoes mais fortes seguidas por neuronio")
    ap.add_argument("--max-neurons", type=int, default=600, help="o simulador em GDScript aguenta ~500-800 neuronios em tempo real")
    ap.add_argument("--name", default="")
    args = ap.parse_args()

    cmap = json.loads(Path(args.map).read_text())
    print("Lendo anotacoes...")
    info = load_annotations(args.annotations)
    print("Lendo conexoes...")
    out, inc, edge_nt = load_edges(args.connections, args.min_syn)

    # --- canais
    def split_sides(ids):
        by = defaultdict(set)
        for i in ids:
            by[info.get(i, {}).get("side", "")].add(i)
        return by

    in_groups = {}   # canal -> set de ids
    out_groups = {}
    print("\nCanais encontrados:")
    for ch, spec in cmap["inputs"].items():
        ids = match_channel(spec, info)
        if spec.get("lateral", False):
            by = split_sides(ids)
            in_groups[ch + "_L"] = by.get("L", set())
            in_groups[ch + "_R"] = by.get("R", set())
        else:
            in_groups[ch] = ids
    for ch, spec in cmap["outputs"].items():
        ids = match_channel(spec, info)
        if spec.get("lateral", False):
            by = split_sides(ids)
            out_groups[ch + "_L"] = by.get("L", set())
            out_groups[ch + "_R"] = by.get("R", set())
        else:
            out_groups[ch] = ids
    for ch, ids in list(in_groups.items()) + list(out_groups.items()):
        types = sorted({info[i]["type"] for i in ids if i in info})
        flag = "  <-- VAZIO: ajuste tools/channel_map.json" if not ids else ""
        print(f"  {ch:14s} {len(ids):5d} neuronios {types[:6]}{flag}")

    S = set().union(*in_groups.values()) if in_groups else set()
    T = set().union(*out_groups.values()) if out_groups else set()
    if not S or not T:
        sys.exit("Sem entradas ou sem saidas; nada a extrair.")

    # --- caminhos curtos S -> T pelas conexoes mais fortes
    def expand(start, adj, depth):
        reach = {n: 0 for n in start}
        frontier = set(start)
        for d in range(1, depth + 1):
            nxt = set()
            for n in frontier:
                for m, _w in sorted(adj.get(n, []), key=lambda x: -x[1])[: args.fanout]:
                    if m not in reach:
                        reach[m] = d
                        nxt.add(m)
            frontier = nxt
        return reach

    fwd = expand(S, out, args.depth)
    bwd = expand(T, inc, args.depth)
    middle = [n for n in fwd if n in bwd and n not in S and n not in T and fwd[n] + bwd[n] <= args.depth + 1]
    budget = max(0, args.max_neurons - len(S | T))

    def score(n):
        a = sum(w for m, w in inc.get(n, []) if m in fwd)
        b = sum(w for m, w in out.get(n, []) if m in bwd)
        return min(a, b)

    middle.sort(key=score, reverse=True)
    keep = list(S | T) + middle[:budget]
    idx = {n: i for i, n in enumerate(keep)}
    print(f"\nNeuronios: {len(S)} entrada, {len(T)} saida, {len(middle)} intermediarios candidatos, {len(keep)} mantidos")

    # --- grupos por tipo + lado (os canais apontam para esses grupos)
    def group_of(n):
        d = info.get(n, {})
        t = d.get("type") or "sem_tipo"
        s = d.get("side", "")
        return f"{t}_{s}" if s in ("L", "R") else t

    neurons = []
    for n in keep:
        d = info.get(n, {})
        neurons.append({"id": n, "type": d.get("type", ""), "group": group_of(n)})

    edges = []
    for n in keep:
        nt = edge_nt.get(n) or info.get(n, {}).get("nt", "")
        sign = SIGN.get(nt.split(",")[0].strip(), 1)
        for m, w in out.get(n, []):
            if m in idx:
                edges.append([idx[n], idx[m], sign * w])
    print(f"Conexoes no subcircuito: {len(edges):,}")

    def groups_for(ids):
        return sorted({group_of(n) for n in ids if n in idx})

    channels = {"inputs": {}, "outputs": {}}
    for ch, ids in in_groups.items():
        channels["inputs"][ch] = groups_for(ids)
    for ch, ids in out_groups.items():
        channels["outputs"][ch] = groups_for(ids)
    # exploracao espontanea: ruido tonico nos proprios descendentes
    for ch, srcs in cmap.get("explore", {}).items():
        channels["inputs"][ch] = sorted({g for src in srcs for g in channels["outputs"].get(src, [])})

    brain = {
        "name": args.name or f"Conectoma ({Path(args.connections).name}) — {len(keep)} neuronios",
        "source": f"{args.connections} + {', '.join(args.annotations)}",
        "params": {"w_syn": 0.275, "ref_rate": 60.0},
        "neurons": neurons,
        "edges": edges,
        "channels": channels,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(brain))
    print(f"\nSalvo em {args.out}")


if __name__ == "__main__":
    main()
