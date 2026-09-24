#!/usr/bin/env python3
"""Extrai um subcircuito do conectoma real da mosca adulta para o jogo.

Aceita os downloads do Codex (https://codex.flywire.ai/api/download):
male CNS (dataset=mcns) e FlyWire (dataset=fafb), e exportacoes do neuPrint.
So usa a biblioteca padrao do Python.

    python3 tools/extract_connectome.py \\
        --connections brain/codex/connections_princeton.csv.gz \\
        --annotations brain/codex/neurons.csv.gz \\
        --out brain/connectome.json

O mapa tools/channel_map.json define, por expressoes regulares sobre o tipo
celular, os grupos que entram no subcircuito:

  inputs    neuronios sensoriais que recebem estimulo do jogo (odor por
            glomerulo, acucar, amargo, looming, vento, fome, glicose...)
  outputs   neuronios cuja atividade o jogo le (DNs de locomocao, MN9,
            Giant Fiber, pC1, e os neuroendocrinos que liberam hormonios)
  keep      circuitos mantidos inteiros ou amostrados (PNs, Kenyon cells,
            MBONs, dopaminergicos PAM/PPL1, APL) -- o corpo cogumelo e onde
            a mosca aprende

Cada grupo pode ter "cap" (maximo por lado). Quando um grupo e amostrado,
as sinapses que saem dele sao multiplicadas por (total / mantidos) para o
neuronio pos-sinaptico receber a mesma entrada media. Um grupo pode ser
definido por "upstream_of": os neuronios de uma classe (ex.: gustatorios)
que mais fazem sinapse em tipos-alvo (ex.: "Sugar SEL PN" de Yao & Scott
2022) -- assim achamos os GRNs de acucar e de amargo, que nao tem rotulo.

Depois inclui interneuronios em caminhos curtos (mais fortes) das entradas
ate as saidas, ate --max-neurons. Sinal da sinapse pelo neurotransmissor do
neuronio pre-sinaptico (como Shiu et al. 2024): ACh +, GABA -, Glu -;
DA/OA/5-HT/HIST contam como +.
"""
import argparse
import csv
import gzip
import io
import json
import random
import re
import sys
from collections import defaultdict
from pathlib import Path

csv.field_size_limit(10**9)


def norm(h):
    return re.sub(r"[^a-z0-9]+", "_", h.strip().lower()).strip("_")


PRE_COLS = ["pre_root_id", "pre_pt_root_id", "pre", "bodyid_pre", "pre_id", "source", "from"]
POST_COLS = ["post_root_id", "post_pt_root_id", "post", "bodyid_post", "post_id", "target", "to"]
W_COLS = ["syn_count", "weight", "w", "count", "synapses", "n_syn"]
NT_EDGE_COLS = ["nt_type", "nt", "predicted_nt", "neurotransmitter"]
ID_COLS = ["root_id", "bodyid", "body_id", "id", "pt_root_id", "segment_id"]
TYPE_COLS = ["primary_cell_type", "cell_type", "type", "primary_type", "hemibrain_type", "mcns_type", "instance"]
CLASS_COLS = ["class", "cell_class", "super_class"]
SIDE_COLS = ["soma_side", "side", "somaside", "rootside", "hemisphere"]
NT_COLS = ["predicted_nt_type", "verified_nt_type", "nt_type", "predicted_nt", "predictednt", "consensusnt", "top_nt"]

SIGN = {"ach": 1, "acetylcholine": 1, "gaba": -1, "glut": -1, "glu": -1, "glutamate": -1}


def open_text(path):
    p = Path(path)
    with open(p, "rb") as f:
        magic = f.read(2)
    if magic == b"\x1f\x8b":
        return io.TextIOWrapper(gzip.open(p, "rb"), encoding="utf-8", newline="")
    return open(p, encoding="utf-8", newline="")


def pick(header, options, required=True, what=""):
    low = {norm(h): h for h in header}
    for o in options:
        if o in low:
            return low[o]
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
            tc = pick(rd.fieldnames, TYPE_COLS, what="tipo celular")
            cc = pick(rd.fieldnames, CLASS_COLS, required=False)
            sc = pick(rd.fieldnames, SIDE_COLS, required=False)
            ncs = [pick(rd.fieldnames, [c], required=False) for c in NT_COLS]
            ncs = [c for c in ncs if c]
            for row in rd:
                nid = row[idc].strip()
                d = info.setdefault(nid, {"type": "", "cls": "", "side": "", "nt": ""})
                d["type"] = d["type"] or (row.get(tc) or "").strip()
                if cc:
                    d["cls"] = d["cls"] or (row.get(cc) or "").strip()
                if sc:
                    d["side"] = d["side"] or norm_side(row.get(sc))
                for c in ncs:
                    if not d["nt"] and row.get(c):
                        d["nt"] = row[c].strip().lower()
        print(f"  anotacoes: {path} -> {len(info):,} neuronios")
    return info


def load_edges(path, min_syn):
    agg = defaultdict(int)
    edge_nt = {}
    n = 0
    with open_text(path) as f:
        rd = csv.DictReader(f)
        pc = pick(rd.fieldnames, PRE_COLS, what="pre-sinaptico")
        qc = pick(rd.fieldnames, POST_COLS, what="pos-sinaptico")
        wc = pick(rd.fieldnames, W_COLS, what="numero de sinapses")
        ntc = pick(rd.fieldnames, NT_EDGE_COLS, required=False)
        for row in rd:
            try:
                w = int(float(row[wc]))
            except ValueError:
                continue
            a, b = row[pc].strip(), row[qc].strip()
            agg[(a, b)] += w  # soma entre neuropilos
            if ntc and row.get(ntc):
                edge_nt[a] = row[ntc].strip().lower()
            n += 1
            if n % 2_000_000 == 0:
                print(f"  ... {n:,} linhas")
    out = defaultdict(list)
    inc = defaultdict(list)
    for (a, b), w in agg.items():
        if w >= min_syn and a != b:
            out[a].append((b, w))
            inc[b].append((a, w))
    print(f"  conexoes: {n:,} linhas, {sum(len(v) for v in out.values()):,} pares com >= {min_syn} sinapses")
    return out, inc, edge_nt


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--connections", required=True)
    ap.add_argument("--annotations", nargs="+", required=True)
    ap.add_argument("--map", default=str(Path(__file__).with_name("channel_map.json")))
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "brain/connectome.json"))
    ap.add_argument("--min-syn", type=int, default=5, help="limiar de sinapses por par")
    ap.add_argument("--depth", type=int, default=2, help="camadas intermediarias entre entrada e saida")
    ap.add_argument("--fanout", type=int, default=20, help="conexoes mais fortes seguidas por neuronio")
    ap.add_argument("--max-neurons", type=int, default=650)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--name", default="")
    args = ap.parse_args()
    random.seed(args.seed)

    cmap = json.loads(Path(args.map).read_text())
    print("Lendo anotacoes...")
    info = load_annotations(args.annotations)
    print("Lendo conexoes...")
    out, inc, edge_nt = load_edges(args.connections, args.min_syn)

    # ------------------------------------------------------------ grupos
    def matches(spec):
        pats = [re.compile(p) for p in spec.get("types", [])]
        cls = spec.get("class")
        ids = {str(i) for i in spec.get("ids", [])}
        for nid, d in info.items():
            if cls and d["cls"] != cls:
                continue
            if any(p.search(d["type"]) for p in pats):
                ids.add(nid)
        if "rank_by_input_from" in spec:
            src = set()
            for gname in spec["rank_by_input_from"]:
                src |= set(groups.get(gname, []))
            score = defaultdict(int)
            for a in src:
                for post, w in out.get(a, []):
                    if post in ids:
                        score[post] += w
            spec["_score"] = score
        if "downstream_of" in spec:
            src = set(groups.get(spec["downstream_of"], []))
            score = defaultdict(int)
            for a in src:
                for post, w in out.get(a, []):
                    score[post] += w
            ids |= {n for n, s in score.items() if s >= spec.get("min_syn", 10)}
            spec["_score"] = score
        if "upstream_of" in spec:
            tg = [re.compile(p) for p in spec["upstream_of"]]
            targets = {n for n, d in info.items() if any(p.search(d["type"]) for p in tg)}
            for _hop in range(spec.get("hops", 1) - 1):
                # inclui os parceiros pre-sinapticos mais fortes dos alvos
                pre_w = defaultdict(int)
                for t in targets:
                    for pre, w in inc.get(t, []):
                        pre_w[pre] += w
                targets = targets | {n for n, _ in sorted(pre_w.items(), key=lambda x: -x[1])[:12]}
            score = defaultdict(int)
            for t in targets:
                for pre, w in inc.get(t, []):
                    d = info.get(pre)
                    if d and (not cls or d["cls"] == cls):
                        score[pre] += w
            ids |= {n for n, s in score.items() if s >= spec.get("min_syn", 10)}
            spec["_score"] = score
        return ids

    groups = {}      # nome do canal/grupo -> (lista mantida, fator de escala)
    roles = {}       # nome -> "input" | "output" | "keep"
    scale_of = {}    # id -> fator nas sinapses de saida

    used = set()

    def add_group(name, spec, role):
        ids = matches(spec) - used  # cada neuronio pertence a um so grupo
        cap = spec.get("cap")
        sides = ["L", "R"] if spec.get("lateral") else [None]
        for s in sides:
            sel = sorted(i for i in ids if s is None or info.get(i, {}).get("side") == s)
            total = len(sel)
            if cap and total > cap and "balance_by" in spec:
                # escolhe em rodizio as KCs mais fortes para cada tipo de PN
                per = defaultdict(lambda: defaultdict(int))
                src = set()
                for gname in spec["balance_by"]:
                    src |= set(groups.get(gname, []))
                selset = set(sel)
                for a in src:
                    t = info[a]["type"]
                    for post, w in out.get(a, []):
                        if post in selset:
                            per[t][post] += w
                queues = [sorted(d.items(), key=lambda x: -x[1]) for d in per.values()]
                chosen = []
                while len(chosen) < cap and any(queues):
                    for q in queues:
                        while q and q[0][0] in chosen:
                            q.pop(0)
                        if q and len(chosen) < cap:
                            chosen.append(q.pop(0)[0])
                sel = chosen
            elif cap and total > cap:
                if "_score" in spec:
                    sel = sorted(sel, key=lambda i: -spec["_score"].get(i, 0))[:cap]
                else:
                    sel = random.sample(sel, cap)
            gname = f"{name}_{s}" if s else name
            # reescala so populacoes homogeneas (sensoriais, KCs, DANs); grupos
            # definidos por conectividade ("upstream_of") nao
            k = total / max(len(sel), 1) if spec.get("scale", role != "keep" or name == "KC") and "upstream_of" not in spec and "downstream_of" not in spec else 1.0
            k = min(k, spec.get("max_scale", 1e9)) * spec.get("out_gain", 1.0)
            for i in sel:
                scale_of[i] = k if "out_gain" in spec else max(scale_of.get(i, 1.0), k)
            groups[gname] = sel
            used.update(sel)
            roles[gname] = role
            typ = sorted({info[i]["type"] for i in sel})[:5]
            flag = "  <-- VAZIO: ajuste tools/channel_map.json" if not sel else ""
            print(f"  {gname:16s} {len(sel):4d}/{total:<5d} {typ}{flag}")

    print("\nGrupos:")
    for role in ("inputs", "outputs", "keep"):
        for name, spec in cmap.get(role, {}).items():
            add_group(name, spec, role[:-1] if role != "keep" else "keep")

    core = set()
    for g in groups.values():
        core |= set(g)
    inputs = set().union(*(set(v) for k, v in groups.items() if roles[k] == "input"))
    outputs = set().union(*(set(v) for k, v in groups.items() if roles[k] == "output"))

    # ------------------------------------------------------------ interneuronios
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

    fwd = expand(inputs | set(groups.get("MBON", [])), out, args.depth)
    bwd = expand(outputs, inc, args.depth)
    excl = [re.compile(p) for p in cmap.get("exclude_middle", [])]
    middle = [n for n in fwd if n in bwd and n not in core and fwd[n] + bwd[n] <= args.depth + 1
              and not any(p.search(info.get(n, {}).get("type", "")) for p in excl)]

    def score(n):
        a = sum(w for m, w in inc.get(n, []) if m in fwd)
        b = sum(w for m, w in out.get(n, []) if m in bwd)
        return min(a, b)

    middle.sort(key=score, reverse=True)
    budget = max(0, args.max_neurons - len(core))
    keep = sorted(core) + middle[:budget]
    idx = {n: i for i, n in enumerate(keep)}
    print(f"\nNeuronios: {len(core)} nos grupos + {min(budget, len(middle))} interneuronios = {len(keep)}")

    member_group = {}
    for g, ids in groups.items():
        for i in ids:
            member_group.setdefault(i, g)

    def group_of(n):
        if n in member_group:
            return member_group[n]
        d = info.get(n, {})
        t = d.get("type") or "sem_tipo"
        s = d.get("side", "")
        return f"{t}_{s}" if s in ("L", "R") else t

    neurons = []
    for n in keep:
        d = info.get(n, {})
        neurons.append({"id": n, "type": d.get("type", ""), "group": group_of(n), "nt": d.get("nt", "")})

    edges = []
    for n in keep:
        nt = edge_nt.get(n) or info.get(n, {}).get("nt", "")
        sign = SIGN.get(nt.split(",")[0].strip(), 1)
        k = scale_of.get(n, 1.0)
        for m, w in out.get(n, []):
            if m in idx:
                edges.append([idx[n], idx[m], round(sign * w * k, 2)])
    n_real = len(edges)
    for a, bgrp, w in cmap.get("bridges", {}).get("list", []):
        for x in groups.get(a, []):
            for y in groups.get(bgrp, []):
                edges.append([idx[x], idx[y], w, 1])
    print(f"Conexoes no subcircuito: {n_real:,} reais + {len(edges) - n_real} pontes")

    channels = {"inputs": {}, "outputs": {}}
    for g, r in roles.items():
        if r == "input":
            channels["inputs"][g] = [g]
        elif r == "output":
            channels["outputs"][g] = [g]
    for ch, srcs in cmap.get("aliases_in", {}).items():
        channels["inputs"][ch] = [g for g in srcs if g in groups and groups[g]]
    for ch, srcs in cmap.get("aliases_out", {}).items():
        channels["outputs"][ch] = [g for g in srcs if g in groups and groups[g]]

    brain = {
        "name": args.name or f"Conectoma real ({len(keep)} neuronios)",
        "source": f"{Path(args.connections).name} + {', '.join(Path(a).name for a in args.annotations)}",
        "params": {"w_syn": 0.275, "ref_rate": 35.0},
        "neurons": neurons,
        "edges": edges,
        "channels": channels,
        "plasticity": cmap.get("plasticity", {}),
        "chemicals": cmap.get("chemicals", {}),
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(brain, separators=(",", ":")))
    print(f"\nSalvo em {args.out} ({Path(args.out).stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
