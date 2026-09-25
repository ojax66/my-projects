#!/usr/bin/env python3
"""Exporta os conectomas sinteticos da ra e do girino (os mesmos que o jogo
usa, gerados por build_amphibian_brain.py) no formato de tabelas do FlyWire
/ Codex, igual aos arquivos da mosca:

  classification.csv.gz  root_id, flow, super_class, class, cell_type, side, nt_type, canal
  connections.csv.gz     pre_root_id, post_root_id, neuropil, syn_count, nt_type

    python3 tools/export_amphibian_csv.py [pasta_de_saida]
"""
import csv
import gzip
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_amphibian_brain as B  # noqa: E402

BASE_ID = {"ra": 820000000000000000, "girino": 810000000000000000}


def nt_of(name, m):
    d = m["disp"].lower()
    if m["dan"]:
        return "DA"
    if "serotonina" in d:
        return "SER"
    if "noradrenalina" in d:
        return "NA"
    if m["sign"] < 0:
        return "GLY" if d.startswith("medula") or "cin" in d or "ain" in d else "GABA"
    if "motoneuron" in d or d.startswith("coracao: vago"):
        return "ACH"          # motoneuronios de vertebrado e o vago sao colinergicos
    return "GLUT"


def export(tag, b, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    who = {}
    rows = []
    for nm, (a0, n) in b.pops.items():
        m = b.meta[nm]
        side = {"L": "left", "R": "right"}.get(nm[-1], "center") if nm[-2:] in ("_L", "_R") else "center"
        flow = {0: "afferent", 2: "efferent"}.get(m["kind"], "intrinsic")
        sup = {"afferent": "sensory", "efferent": "motor/output"}.get(flow, "central")
        if m["kc"]:
            sup = "central (codigo esparso)"
        nt = nt_of(nm, m)
        cell = nm[:-2] if side != "center" else nm
        for i in range(a0, a0 + n):
            who[i] = (m["disp"], nt)
            rows.append([BASE_ID[tag] + i + 1, flow, sup, m["disp"], cell, side, nt, m["chan"] or m["out"] or ""])
    with gzip.open(out_dir / "classification.csv.gz", "wt", newline="") as f:
        w = csv.writer(f)
        w.writerow(["root_id", "flow", "super_class", "class", "cell_type", "side", "nt_type", "canal_do_jogo"])
        w.writerows(rows)
    n_syn = 0
    with gzip.open(out_dir / "connections.csv.gz", "wt", newline="") as f:
        w = csv.writer(f)
        w.writerow(["pre_root_id", "post_root_id", "neuropil", "syn_count", "nt_type"])
        for (a, c), k in sorted(b.agg.items()):
            w.writerow([BASE_ID[tag] + a + 1, BASE_ID[tag] + c + 1, who[c][0], k, who[a][1]])
            n_syn += k
    print("%s: %d neuronios, %d conexoes, %d sinapses -> %s" % (tag, b.N, len(b.agg), n_syn, out_dir))


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("conectomas_csv")
    export("ra", B.frog(), out / "ra")
    export("girino", B.tadpole(), out / "girino")


if __name__ == "__main__":
    main()
