#!/usr/bin/env python3
"""Anatomia 3D dos conectomas sinteticos da ra e do girino.

Cada neuronio ganha uma posicao dentro da sua regiao (em mm, num encefalo de
anuro: bulbo olfativo, hemisferios, diencefalo, teto optico, toro, isthmo,
bulbo, medula; retinas nos olhos; ganglios e orgaos dos sentidos na
periferia) e um formato simples: soma, dendritos curtos e um axonio que
segue ate o neuronio com quem ele mais faz sinapses, ramificando na chegada.
As ligacoes sao as mesmas do jogo (build_amphibian_brain.py).

    python3 tools/build_brain_3d.py SAIDA

Gera:
  SAIDA/web/cerebro3d.html            visualizador 3D (pagina unica, com os dados)
  SAIDA/web/{ra,girino}.json          os dados do visualizador
  SAIDA/neuroglancer/{ra,girino}/     esqueletos no formato "precomputed" do
                                      Neuroglancer + propriedades e tags
  SAIDA/neuroglancer/servir.py        servidor local com CORS
  SAIDA/neuroglancer/links.txt        links prontos do Neuroglancer
"""
import base64
import json
import struct
import sys
import urllib.parse
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_amphibian_brain as B  # noqa: E402
from export_amphibian_csv import BASE_ID, nt_of  # noqa: E402

# regiao -> (centro |x|, y, z em mm; raios; cor; nome; periferico?, par?)
# x: lateral (+ direita), y: dorsal, z: caudal (+ para tras)
R = {
    "nariz":       ((1.3, 0.2, -10.0), (0.8, 0.5, 0.9), "#c9a77c", "Epitelio olfativo (nariz)", True),
    "bulbo_olf":   ((0.9, 0.5, -6.8), (0.75, 0.7, 1.2), "#e0b25c", "Bulbo olfativo", False),
    "palio":       ((1.45, 1.1, -3.2), (1.25, 1.05, 2.3), "#d98a6a", "Palio (hemisferios)", False),
    "estriado":    ((1.3, -0.15, -2.9), (0.85, 0.55, 1.5), "#c4708f", "Estriado", False),
    "amigdala":    ((1.45, -0.35, -1.3), (0.55, 0.45, 0.6), "#b96aa6", "Amigdala medial", False),
    "hipotalamo":  ((0.0, -1.35, 0.4), (0.95, 0.65, 1.0), "#8f7ad1", "Hipotalamo", False),
    "tuberculo":   ((0.55, -0.85, 1.0), (0.45, 0.35, 0.5), "#f0d04a", "Tuberculo posterior (dopamina)", False),
    "pineal":      ((0.0, 1.75, 0.5), (0.3, 0.3, 0.3), "#9ec5d8", "Glandula pineal", False),
    "preteto":     ((1.25, 0.45, 1.1), (0.7, 0.55, 0.6), "#6fa0e0", "Pre-teto (TH3)", False),
    "teto":        ((1.6, 1.25, 3.1), (1.35, 0.95, 1.75), "#4fc0c8", "Teto optico", False),
    "teto_front":  ((1.1, 1.15, 1.9), (0.7, 0.6, 0.6), "#59d6c0", "Teto optico frontal (binocular)", False),
    "toro":        ((1.0, 0.0, 3.4), (0.65, 0.45, 0.9), "#62b3a0", "Toro semicircular (audicao)", False),
    "isthmi":      ((1.7, 0.05, 4.9), (0.45, 0.4, 0.5), "#7cc488", "Nucleo isthmi", False),
    "lc":          ((0.6, 0.35, 5.4), (0.25, 0.25, 0.3), "#a8d05a", "Locus coeruleus", False),
    "rafe":        ((0.0, -0.45, 6.0), (0.18, 0.6, 1.3), "#e6e070", "Rafe (serotonina)", False),
    "reticular":   ((0.7, -0.5, 6.7), (0.55, 0.55, 1.5), "#e8894e", "Formacao reticular", False),
    "mauthner":    ((0.55, -0.3, 6.1), (0.12, 0.12, 0.12), "#ff5a5a", "Celula de Mauthner", False),
    "mhr":         ((0.45, -0.35, 4.9), (0.35, 0.3, 0.4), "#e36f6f", "Reticulospinais do isthmo (MHR)", False),
    "resp":        ((0.85, -0.45, 7.7), (0.45, 0.4, 0.8), "#f2a65a", "Geradores respiratorio e vocal", False),
    "boca_cpg":    ((0.85, -0.5, 6.3), (0.35, 0.3, 0.4), "#e8b04e", "Gerador da boca", False),
    "nts":         ((0.6, 0.35, 8.1), (0.4, 0.3, 0.8), "#d6c05a", "Nucleo do trato solitario", False),
    "vago":        ((0.75, 0.05, 8.5), (0.3, 0.3, 0.5), "#c98a4e", "Nucleo do vago (coracao)", False),
    "hipoglosso":  ((0.4, -0.6, 9.0), (0.28, 0.28, 0.6), "#ff8c3a", "Nucleo do hipoglosso (lingua)", False),
    "medula_br":   ((0.45, -0.2, 11.5), (0.42, 0.42, 1.6), "#d9775a", "Medula (bracos, coracao)", False),
    "medula_lomb": ((0.45, -0.25, 16.5), (0.45, 0.42, 2.8), "#e0603f", "Medula lombar (pernas)", False),
    "ouvido":      ((3.2, 0.0, 6.0), (0.6, 0.6, 0.6), "#8fb4c7", "Ouvido interno", True),
    "trigemeo":    ((2.3, -0.55, 5.4), (0.45, 0.4, 0.5), "#a99ac7", "Ganglio do trigemeo", True),
    "ll":          ((2.1, 0.25, 5.8), (0.4, 0.35, 0.45), "#86c7c7", "Ganglio da linha lateral", True),
    "paladar":     ((1.9, -1.05, 6.9), (0.4, 0.35, 0.45), "#c7b286", "Ganglio do paladar", True),
    "estiramento": ((1.5, -0.7, 8.6), (0.35, 0.3, 0.4), "#b7a3a3", "Ganglio vagal (pulmao)", True),
    "quimio":      ((1.1, -0.9, 7.3), (0.3, 0.25, 0.3), "#a3b7a3", "Quimiorreceptores (O2/CO2)", True),
    "drg":         ((1.25, -0.25, 14.0), (0.35, 0.35, 4.5), "#b38f7a", "Ganglios das raizes dorsais (pele)", True),
    "retina":      ((4.3, 1.0, -2.0), (1.55, 1.55, 1.55), "#5a86e8", "Retina (olhos)", True),
}


def region_of(disp):
    d = disp.lower()
    rules = [
        ("epitelio olf", "nariz"), ("bulbo olf", "bulbo_olf"), ("palio", "palio"), ("estriado", "estriado"),
        ("amigdala", "amigdala"), ("tuberculo", "tuberculo"), ("hipotalamo", "hipotalamo"), ("pineal", "pineal"),
        ("pre-teto", "preteto"), ("t5.2 frontal", "teto_front"), ("teto", "teto"), ("toro", "toro"),
        ("isthmi", "isthmi"), ("locus", "lc"), ("rafe", "rafe"), ("mauthner", "mauthner"), ("mhr", "mhr"),
        ("reticul", "reticular"), ("gerador resp", "resp"), ("gerador vocal", "resp"), ("cpg da boca", "boca_cpg"),
        ("trato solitario", "nts"), ("vago", "vago"), ("hipoglosso", "hipoglosso"), ("simpatico", "medula_br"),
        ("membros", "medula_lomb"), ("extensores", "medula_lomb"), ("medula", "medula_lomb"), ("motoneuronios", "medula_lomb"),
        ("rohon", "medula_lomb"), ("auditivo", "ouvido"), ("vestibular", "ouvido"), ("trigemeo", "trigemeo"),
        ("linha lateral", "ll"), ("paladar", "paladar"), ("estiramento", "estiramento"), ("quimiorrec", "quimio"),
        ("retina", "retina"), ("tato", "drg"), ("nocicept", "drg"), ("termorrec", "drg"),
    ]
    for k, r in rules:
        if k in d:
            return r
    return "reticular"


def layout(tag):
    """O girino tem encefalo menor e uma medula comprida ao longo da cauda."""
    if tag == "ra":
        return R, 1.0
    reg = {}
    for k, (c, r, col, name, per) in R.items():
        c = np.array(c) * 0.45
        r = np.array(r) * 0.45
        if k == "medula_lomb":
            c, r, name = np.array([0.0, -0.1, 12.0]), np.array([0.22, 0.22, 7.0]), "Medula (natacao, cauda)"
        if k == "drg":
            c, r, name = np.array([0.35, -0.1, 12.0]), np.array([0.12, 0.2, 7.0]), "Rohon-Beard / sensoriais da medula"
        if k == "retina":
            c = np.array([1.6, 0.5, -1.0])
        reg[k] = (tuple(c), tuple(r), col, name, per)
    return reg, 0.45


def build(tag, out):
    b = B.frog() if tag == "ra" else B.tadpole()
    reg, _ = layout(tag)
    rng = np.random.default_rng(5)
    N = b.N
    pops = list(b.pops.items())
    pop_of = np.zeros(N, np.int32)
    pos = np.zeros((N, 3))
    pinfo = []
    for pi, (nm, (a0, n)) in enumerate(pops):
        m = b.meta[nm]
        side = nm[-1] if nm[-2:] in ("_L", "_R") else ""
        rk = region_of(m["disp"])
        if tag == "girino" and m["disp"].startswith("medula: dlc"):
            rk = "drg"
        c, r, col, rname, per = reg[rk]
        c = np.array(c)
        r = np.array(r)
        for i in range(a0, a0 + n):
            pop_of[i] = pi
            sx = (-1 if side == "L" else 1) if side else (1 if rng.random() < 0.5 else -1)
            if c[0] == 0:
                sx = 1
            if rk == "retina":
                # camada na parede de tras do olho (hemisferio voltado para dentro)
                v = rng.normal(size=3)
                v /= np.linalg.norm(v)
                v[0] = -abs(v[0]) * sx            # metade voltada para o encefalo
                p = c * [sx, 1, 1] + v * r * rng.uniform(0.92, 1.0)
            else:
                while True:
                    v = rng.uniform(-1, 1, 3)
                    if v @ v <= 1:
                        break
                p = c * [sx, 1, 1] + v * r
            pos[i] = p
        pinfo.append({"nome": nm, "classe": m["disp"], "lado": {"L": "esquerdo", "R": "direito"}.get(side, "centro"),
                      "nt": nt_of(nm, m), "fluxo": {0: "sensorial", 2: "saida/motor"}.get(m["kind"], "central"),
                      "regiao": rk, "n": n, "canal": m["chan"] or m["out"] or ""})
    # alvo principal de cada neuronio e as 3 populacoes que ele mais excita/inibe
    best = np.full(N, -1)
    best_w = np.zeros(N)
    per_pop = defaultdict(lambda: defaultdict(int))
    pp = defaultdict(int)
    for (a, c), k in b.agg.items():
        per_pop[a][pop_of[c]] += k
        pp[(pop_of[a], pop_of[c])] += k
        if k > best_w[a]:
            best_w[a] = k
            best[a] = c
    top = np.full((N, 3), 255, np.uint8)
    topw = np.zeros((N, 3), np.uint16)
    for a, d in per_pop.items():
        s = sorted(d.items(), key=lambda t: -t[1])[:3]
        for j, (p_, k) in enumerate(s):
            top[a, j] = p_
            topw[a, j] = min(k, 65535)
    regions = {k: {"nome": v[3], "centro": list(v[0]), "raios": list(v[1]), "cor": v[2], "periferico": v[4]} for k, v in reg.items()
               if any(p["regiao"] == k for p in pinfo)}
    # ---- dados da pagina
    q = np.round(pos / 0.002).astype("<i2")
    bt = np.where(best < 0, np.arange(N), best).astype("<u2" if N < 65536 else "<u4")
    web = {
        "tag": tag, "N": N, "sinapses": int(sum(b.agg.values())), "conexoes": len(b.agg), "escala": 0.002,
        "populacoes": pinfo, "regioes": regions,
        "matriz": [[int(a), int(c), int(k)] for (a, c), k in sorted(pp.items(), key=lambda t: -t[1])],
        "pos": base64.b64encode(q.tobytes()).decode(), "pop": base64.b64encode(pop_of.astype("u1").tobytes()).decode(),
        "alvo": base64.b64encode(bt.tobytes()).decode(),
        "top": base64.b64encode(top.tobytes()).decode(), "topw": base64.b64encode(topw.astype("<u2").tobytes()).decode(),
        "id0": str(BASE_ID[tag] + 1),
    }
    (out / "web").mkdir(parents=True, exist_ok=True)
    (out / "web" / f"{tag}.json").write_text(json.dumps(web, separators=(",", ":")))
    # ---- Neuroglancer: esqueletos precomputed
    ng = out / "neuroglancer" / tag
    ng.mkdir(parents=True, exist_ok=True)
    ids = []
    for i in range(N):
        verts, edges = skeleton(i, pos, bt, pop_of, rng)
        sid = BASE_ID[tag] + i + 1
        ids.append(str(sid))
        with open(ng / str(sid), "wb") as f:
            f.write(struct.pack("<II", len(verts), len(edges)))
            f.write((np.array(verts) * 1e6).astype("<f4").tobytes())      # mm -> nm
            f.write(np.array(edges, "<u4").tobytes())
    tags = sorted({p["regiao"] for p in pinfo}) + ["GLUT", "GABA", "GLY", "ACH", "DA", "SER", "NA", "sensorial", "central", "saida_motor"]
    tag_ix = {t: j for j, t in enumerate(tags)}
    labels, tagv, descs = [], [], []
    for i in range(N):
        p = pinfo[pop_of[i]]
        labels.append(f"{p['nome']}")
        descs.append(f"{p['classe']} | lado {p['lado']} | {p['nt']} | {p['fluxo']}")
        tagv.append([tag_ix[p["regiao"]], tag_ix[p["nt"]], tag_ix[p["fluxo"].replace("/", "_")]])
    (ng / "props").mkdir(exist_ok=True)
    (ng / "props" / "info").write_text(json.dumps({"@type": "neuroglancer_segment_properties", "inline": {
        "ids": ids, "properties": [{"id": "label", "type": "label", "values": labels},
                                    {"id": "description", "type": "description", "values": descs},
                                    {"id": "tags", "type": "tags", "tags": tags, "values": tagv,
                                     "tag_descriptions": [R[t][3] if t in R else t for t in tags]}]}}))
    (ng / "info").write_text(json.dumps({"@type": "neuroglancer_skeletons", "transform": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
                                         "vertex_attributes": [], "segment_properties": "props"}))
    print(f"{tag}: {N} neuronios, {len(b.agg)} conexoes, {len(regions)} regioes")
    return ids


def skeleton(i, pos, bt, pop_of, rng):
    """Soma + 3 dendritos + axonio curvo ate o alvo principal, com ramos finais."""
    s = pos[i]
    verts = [s]
    edges = []
    for _ in range(3):
        d = rng.normal(size=3)
        d /= np.linalg.norm(d)
        L = rng.uniform(0.08, 0.25)
        prev = 0
        for k in range(1, 3):
            verts.append(s + d * L * k / 2 + rng.normal(size=3) * 0.02)
            edges.append((prev, len(verts) - 1))
            prev = len(verts) - 1
    t = pos[int(bt[i])]
    if np.linalg.norm(t - s) > 0.05:
        mid = (s + t) / 2
        # feixe: os axonios longos passam pelo meio (ventral, perto da linha media)
        mid = mid + (np.array([0.0, -0.4, mid[2]]) - mid) * np.array([0.35, 0.25, 0.0])
        prev = 0
        n = 10
        for k in range(1, n + 1):
            u = k / n
            p = (1 - u) ** 2 * s + 2 * (1 - u) * u * mid + u * u * t
            verts.append(p)
            edges.append((prev, len(verts) - 1))
            prev = len(verts) - 1
        for _ in range(3):
            d = rng.normal(size=3)
            d /= np.linalg.norm(d)
            verts.append(t + d * rng.uniform(0.05, 0.15))
            edges.append((prev, len(verts) - 1))
    return verts, edges


SERVER = '''#!/usr/bin/env python3
"""Serve esta pasta em http://127.0.0.1:8000 com CORS, para o Neuroglancer ler.
    python3 servir.py
Depois abra um dos links de links.txt no navegador (Chrome/Firefox)."""
import http.server, functools, os
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()
os.chdir(os.path.dirname(os.path.abspath(__file__)))
print("servindo em http://127.0.0.1:8000  (Ctrl+C para parar)")
http.server.ThreadingHTTPServer(("127.0.0.1", 8000), H).serve_forever()
'''


def main():
    out = Path(sys.argv[1])
    links = []
    for tag in ("ra", "girino"):
        ids = build(tag, out)
        sample = ids[::max(1, len(ids) // 400)]
        state = {"dimensions": {"x": [1e-9, "m"], "y": [1e-9, "m"], "z": [1e-9, "m"]},
                 "projectionScale": 3.0e7 if tag == "ra" else 2.0e7,
                 "layers": [{"type": "segmentation", "source": f"precomputed://http://127.0.0.1:8000/{tag}", "name": tag,
                             "segments": sample, "skeletonRendering": {"mode3d": "lines", "lineWidth3d": 1.5}}],
                 "layout": "3d", "showAxisLines": False}
        links.append((tag, "https://neuroglancer-demo.appspot.com/#!" + urllib.parse.quote(json.dumps(state, separators=(",", ":")))))
    # pagina 3D (um arquivo so, com os dados dentro)
    tpl = (Path(__file__).resolve().parent / "brain_viewer.html").read_text()
    page = tpl.replace("__RA__", (out / "web" / "ra.json").read_text()).replace("__GIRINO__", (out / "web" / "girino.json").read_text())
    (out / "web" / "cerebro3d.html").write_text(page)
    ngd = out / "neuroglancer"
    (ngd / "servir.py").write_text(SERVER)
    (ngd / "links.txt").write_text("\n\n".join(f"{t}:\n{u}" for t, u in links) + "\n")


if __name__ == "__main__":
    main()
