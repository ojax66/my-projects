#!/usr/bin/env python3
"""Extrai um subcircuito do conectoma da LARVA (Winding et al., Science 2023).

Entrada: o network.csv.zip do Netzschleuder (nodes.csv + edges.csv), ou a pasta
com esses arquivos.

    python3 tools/extract_larva.py brain/codex/network.csv.zip --out brain/larva_connectome.json

Esse conjunto nao traz o neurotransmissor de cada neuronio. Usamos: neuronios
locais (LN) e APL inibitorios (a maioria e GABAergica), o resto excitatorio.
Isso e uma aproximacao -- os dados suplementares do artigo trazem a lista real.
"""
import argparse
import csv
import io
import json
import random
import re
import zipfile
from collections import defaultdict
from pathlib import Path


def read_tables(src):
    p = Path(src)
    if p.is_dir():
        return (open(p / "nodes.csv", encoding="utf-8").read(), open(p / "edges.csv", encoding="utf-8").read())
    z = zipfile.ZipFile(p)
    return z.read("nodes.csv").decode(), z.read("edges.csv").decode()


def rows(text):
    rd = csv.reader(io.StringIO(text))
    header = [h.strip().lstrip("#").strip() for h in next(rd)]
    for r in rd:
        yield dict(zip(header, r))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "brain/larva_connectome.json"))
    ap.add_argument("--max-neurons", type=int, default=380)
    ap.add_argument("--seed", type=int, default=2)
    args = ap.parse_args()
    random.seed(args.seed)
    nodes_t, edges_t = read_tables(args.src)

    info = {}
    for r in rows(nodes_t):
        side = {"left": "L", "right": "R"}.get(r.get("hemisphere", ""), "")
        info[r["index"]] = {"type": r.get("cell_type", "") or "sem_tipo", "ann": r.get("annotations", ""), "side": side}
    out = defaultdict(list)
    inc = defaultdict(list)
    for r in rows(edges_t):
        # so sinapses classicas axonio -> dendrito ("ad"); as axo-axonicas
        # (muitas entre KCs) modulam a liberacao e aqui causariam excitacao em laco
        if r.get("etype", "ad") != "ad":
            continue
        a, b, w = r["source"], r["target"], int(r["count"])
        out[a].append((b, w))
        inc[b].append((a, w))
    print(f"larva: {len(info)} neuronios, {sum(len(v) for v in out.values())} conexoes")

    def sel(pred, cap=None, side=None):
        ids = [n for n, d in info.items() if pred(d) and (side is None or d["side"] == side)]
        total = len(ids)
        if cap and len(ids) > cap:
            ids = random.sample(ids, cap)
        return ids, total

    sens = lambda k: (lambda d: d["type"] == "sensory" and k in d["ann"])
    spec = {
        # entradas
        "odor_L": (sens("olfactory"), None, "L"), "odor_R": (sens("olfactory"), None, "R"),
        "taste": (sens("gustatory-external"), 30, None),
        # nociceptivos e mecanossensoriais chegam ao cerebro por neuronios ascendentes
        "noci": (lambda d: d["type"] in ("sensory", "ascending") and "noci" in d["ann"] and "2nd" not in d["ann"], None, None),
        "light_L": (sens("visual"), None, "L"), "light_R": (sens("visual"), None, "R"),
        "mechano": (lambda d: d["ann"] == "mechano-Ch", None, None),
        # saidas (descendentes para o cordao ventral e SEZ)
        "crawl_L": (lambda d: d["type"] == "DN-VNC", 18, "L"), "crawl_R": (lambda d: d["type"] == "DN-VNC", 18, "R"),
        "feed": (lambda d: d["type"] == "DN-SEZ", 24, None),
        # corpo cogumelo e PNs
        "PN": (lambda d: d["type"] == "PN" and "olfactory" in d["ann"], None, None),
        "KC": (lambda d: d["type"] == "KC", 60, None),
        "MBON": (lambda d: d["type"] == "MBON", None, None),
        "MBIN": (lambda d: d["type"] == "MBIN", None, None),
    }
    groups, scale = {}, {}
    used = set()
    for g, (pred, cap, side) in spec.items():
        ids, total = sel(lambda d, p=pred: p(d), cap, side)
        ids = [i for i in ids if i not in used]
        used.update(ids)
        groups[g] = ids
        k = total / max(len(ids), 1) if g in ("taste", "KC") else 1.0
        for i in ids:
            scale[i] = min(k, 3.0)
        print(f"  {g:10s} {len(ids):4d}/{total}")

    core = set(used)
    ins = set().union(*(set(groups[g]) for g in ["odor_L", "odor_R", "taste", "noci", "light_L", "light_R", "mechano", "MBON"]))
    outs = set().union(*(set(groups[g]) for g in ["crawl_L", "crawl_R", "feed"]))

    def expand(start, adj, depth=2, fan=15):
        reach = {n: 0 for n in start}
        fr = set(start)
        for d in range(1, depth + 1):
            nx = set()
            for n in fr:
                for m, _ in sorted(adj.get(n, []), key=lambda x: -x[1])[:fan]:
                    if m not in reach:
                        reach[m] = d
                        nx.add(m)
            fr = nx
        return reach

    fw, bw = expand(ins, out), expand(outs, inc)
    mid = [n for n in fw if n in bw and n not in core]
    mid.sort(key=lambda n: -min(sum(w for m, w in inc[n] if m in fw), sum(w for m, w in out[n] if m in bw)))
    keep = sorted(core) + mid[: max(0, args.max_neurons - len(core))]
    idx = {n: i for i, n in enumerate(keep)}
    member = {i: g for g, ids in groups.items() for i in ids}

    def group_of(n):
        if n in member:
            return member[n]
        d = info[n]
        return f"{d['type']}_{d['side']}" if d["side"] else d["type"]

    def sign(n):
        d = info[n]
        return -1 if d["type"] == "LN" or "APL" in d["ann"] else 1

    neurons = [{"id": n, "type": info[n]["type"] + (":" + info[n]["ann"] if info[n]["ann"] not in ("", "no official annotation") else ""),
                "group": group_of(n)} for n in keep]
    edges = []
    for n in keep:
        for m, w in out[n]:
            if m in idx:
                edges.append([idx[n], idx[m], round(sign(n) * w * scale.get(n, 1.0), 2)])
    print(f"subcircuito: {len(keep)} neuronios, {len(edges)} conexoes")
    ch_in = {g: [g] for g in ["odor_L", "odor_R", "taste", "noci", "light_L", "light_R", "mechano"]}
    ch_in["explore_L"] = ["crawl_L"]
    ch_in["explore_R"] = ["crawl_R"]
    ch_in["reward"] = ["MBIN"]
    ch_out = {g: [g] for g in ["crawl_L", "crawl_R", "feed"]}
    brain = {
        "name": f"Conectoma da larva (Winding 2023) — {len(keep)} neuronios",
        "source": "Winding et al. 2023, Science 379 eadd9330 (Netzschleuder fly_larva)",
        "params": {"w_syn": 1.8, "ref_rate": 40.0, "rate_dt": 40.0},
        "neurons": neurons, "edges": edges,
        "channels": {"inputs": ch_in, "outputs": ch_out},
        "plasticity": {"pre": "^KC", "post": "^MBON", "dan": "^MBIN", "punish_dan": "^$", "rate": 0.2, "recovery_s": 300.0, "trace_s": 1.5},
    }
    Path(args.out).write_text(json.dumps(brain, separators=(",", ":")))
    print(f"salvo em {args.out}")


if __name__ == "__main__":
    main()
