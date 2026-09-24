#!/usr/bin/env python3
"""Exporta o conectoma COMPLETO (todos os neuronios) para o simulador em GPU.

    # mosca adulta (MCNS do Codex: neurons.csv.gz + tabela de conexoes)
    python3 tools/export_full_brain.py mcns \\
        --connections brain/codex/connections_princeton.csv.gz \\
        --annotations brain/codex/neurons.csv.gz

    # larva (Winding et al. 2023, network.csv.zip do Netzschleuder)
    python3 tools/export_full_brain.py larva --network brain/codex/larva_network.csv.zip

Gera brain/full/<nome>.bin.gz (binario little-endian, pronto para subir na
GPU sem conversao) e brain/full/<nome>.json (nomes dos canais e grupos).

Cada neuronio recebe:
  chan   canal de entrada sensorial (odor por glomerulo e lado, paladar,
         tato, propriocepcao, dor, visao, temperatura, umidade, sinais
         internos...) ou -1
  out    grupo de leitura (descendentes, neuroendocrinos, dopaminergicos...) ou -1
  disp   grupo de exibicao no painel (classe do neuronio)
  row    linha no raster (amostra de ~700 neuronios) ou -1
  flags  1=KC 2=MBON 4=DAN 8=DAN de punicao
Sinapses KC->MBON ficam numa tabela separada (plasticas, peso por mosca).
"""
import argparse
import csv
import gzip
import io
import json
import random
import re
import struct
import sys
import zipfile
from array import array
from collections import defaultdict
from pathlib import Path

csv.field_size_limit(10**9)
ROOT = Path(__file__).resolve().parent.parent
SIGN = {"ach": 1, "gaba": -1, "glut": -1}


def open_text(path):
    with open(path, "rb") as f:
        magic = f.read(2)
    if magic == b"\x1f\x8b":
        return io.TextIOWrapper(gzip.open(path, "rb"), encoding="utf-8", newline="")
    return open(path, encoding="utf-8", newline="")


class Spec:
    """Acumula canais / grupos a partir de regras."""

    def __init__(self):
        self.chan_names, self.out_names, self.disp_names = [], [], []
        self.disp_kind = []  # 0 sensorial, 1 inter, 2 saida/motor

    def idx(self, lst, name):
        if name not in lst:
            lst.append(name)
        return lst.index(name)


# ---------------------------------------------------------------- MCNS
def mcns(args):
    print("lendo neuronios...")
    info = {}
    with open_text(args.annotations) as f:
        for r in csv.DictReader(f):
            info[r["Root ID"].strip()] = {
                "type": (r.get("Primary Cell Type") or "").strip(),
                "cls": (r.get("Class") or "").strip(),
                "sup": (r.get("Super Class") or "").strip(),
                "sub": (r.get("Sub Class") or "").strip(),
                "side": {"left": "L", "right": "R"}.get((r.get("Soma side") or "").strip(), ""),
                "nt": (r.get("Predicted NT type") or "").strip().lower(),
            }
    ids = sorted(info, key=lambda x: int(x))
    index = {n: i for i, n in enumerate(ids)}
    N = len(ids)
    print(f"  {N} neuronios")

    print("lendo conexoes (pode levar ~1 min)...")
    agg = defaultdict(int)
    with open_text(args.connections) as f:
        rd = csv.reader(f)
        head = next(rd)
        ip, iq, iw = head.index("pre_root_id"), head.index("post_root_id"), head.index("syn_count")
        for row in rd:
            a = index.get(row[ip])
            b = index.get(row[iq])
            if a is None or b is None or a == b:
                continue
            agg[(a, b)] += int(row[iw])
    print(f"  {len(agg):,} pares")

    # --- papeis especiais (corpo cogumelo)
    t = [info[n]["type"] for n in ids]
    is_kc = [bool(re.match(r"^KC", x)) for x in t]
    is_mbon = [bool(re.match(r"^MBON", x)) for x in t]
    is_dan = [bool(re.match(r"^(PAM|PPL1)", x)) for x in t]
    is_pun = [bool(re.match(r"^PPL1", x)) for x in t]

    # --- GRNs de acucar/amargo pela conectividade (Yao & Scott 2022)
    inc = defaultdict(list)
    for (a, b), w in agg.items():
        if w >= args.min_syn:
            inc[b].append((a, w))

    def upstream_score(target_types, hops):
        targets = {i for i, x in enumerate(t) if x in target_types}
        for _ in range(hops - 1):
            pw = defaultdict(int)
            for tt in targets:
                for a, w in inc[tt]:
                    pw[a] += w
            targets |= {n for n, _ in sorted(pw.items(), key=lambda x: -x[1])[:12]}
        sc = defaultdict(int)
        for tt in targets:
            for a, w in inc[tt]:
                if info[ids[a]]["cls"] == "gustatory":
                    sc[a] += w
        return sc

    sugar_sc = upstream_score({"GNG540", "GNG550", "GNG056"}, 1)
    bitter_sc = upstream_score({"DNg28"}, 2)

    # GRNs das pernas/asas chegam a esses alvos por 2-3 sinapses (via cordao
    # ventral): propaga a "ativacao" de cada GRN pelas 20 saidas mais fortes
    outs = defaultdict(list)
    for (a, b), w in agg.items():
        if w >= args.min_syn:
            outs[a].append((b, w))
    for a in outs:
        outs[a] = sorted(outs[a], key=lambda x: -x[1])[:20]
    sug_t = {i for i, x in enumerate(t) if x in ("GNG540", "GNG550", "GNG056")}
    bit_t = {i for i, x in enumerate(t) if x == "DNg28"}

    def reach(i):
        act = {i: 1.0}
        s_s = s_b = 0.0
        for _ in range(3):
            nxt = defaultdict(float)
            for n0, a0 in act.items():
                tot = sum(w for _, w in outs.get(n0, [])) or 1.0
                for m, w in outs.get(n0, []):
                    nxt[m] += a0 * w / tot
            act = nxt
            s_s += sum(act.get(x, 0.0) for x in sug_t)
            s_b += sum(act.get(x, 0.0) for x in bit_t)
        return s_s, s_b

    for i, n in enumerate(ids):
        if info[n]["cls"] == "gustatory" and sugar_sc.get(i, 0) < 10 and bitter_sc.get(i, 0) < 10:
            s_s, s_b = reach(i)
            if max(s_s, s_b) > 2e-4:
                if s_s >= s_b:
                    sugar_sc[i] = 10
                else:
                    bitter_sc[i] = 10

    sp = Spec()
    chan = array("i", [-1] * N)
    out = array("i", [-1] * N)
    disp = array("i", [-1] * N)
    flags = array("i", [0] * N)

    def C(name):
        return sp.idx(sp.chan_names, name)

    def O(name):
        return sp.idx(sp.out_names, name)

    def D(name, kind):
        if name not in sp.disp_names:
            sp.disp_names.append(name)
            sp.disp_kind.append(kind)
        return sp.disp_names.index(name)

    for i, n in enumerate(ids):
        d = info[n]
        ty, cl, su, sb, sd = d["type"], d["cls"], d["sup"], d["sub"], d["side"] or "L"
        c = None
        if ty.startswith("ORN_"):
            c = f"odor_{ty[4:]}_{sd}"
            disp[i] = D("ORNs (olfato)", 0)
        elif cl == "gustatory" or ty in ("BM_Taste",):
            s1, s2 = sugar_sc.get(i, 0), bitter_sc.get(i, 0)
            mouth = sb in ("labellar_bristle", "taste_peg", "pharyngeal_sensillum") or ty.startswith(("LB", "PhG"))
            where = "boca" if mouth else ("asa" if sb == "wing_bristle" else "perna")
            kind = "acucar" if s1 >= 10 and s1 >= s2 else ("amargo" if s2 >= 10 else "agua")
            c = f"gust_{kind}_{where}"
            disp[i] = D("GRNs (paladar)", 0)
        elif ty.startswith("JO-"):
            c = "jo_som" if re.match(r"^JO-(A|B)", ty) else "jo_vento"
            disp[i] = D("JO (antena: vento/som)", 0)
        elif cl in ("mechanosensory_tactile",) or sb in ("mechanosensory_bristle", "leg_bristle", "wing_bristle", "notum", "grooming") and "sensory" in su:
            part = "asa" if "wing" in sb else ("corpo" if sb in ("notum", "abdomen", "grooming") else "perna")
            c = f"tato_{part}"
            disp[i] = D("cerdas / tato", 0)
        elif cl == "mechanosensory" and ty.startswith("BM"):
            c = "tato_cabeca"
            disp[i] = D("cerdas / tato", 0)
        elif cl == "mechanosensory_proprioceptive" or sb in ("hair_plate", "campaniform_sensilla", "chordotonal_organ"):
            c = "proprio_haltere" if sb == "haltere" else ("proprio_pescoco" if sb == "neck" else "proprio_pernas")
            disp[i] = D("propriocepcao", 0)
        elif cl == "unknown_sensory" and sb in ("abdomen", "leg", ""):
            # multidendriticos sem rotulo do abdome/pernas: provaveis nociceptores
            c = "dor_abdome" if sb == "abdomen" else "dor_pernas"
            disp[i] = D("dor (multidendriticos)", 0)
        elif cl == "visual" or ty.startswith(("R1-R6", "R7", "R8")):
            c = f"luz_{'R1-6' if ty.startswith('R1') else 'R7-8'}_{sd}"
            disp[i] = D("fotorreceptores", 0)
        elif cl == "thermosensory":
            c = "temperatura"
            disp[i] = D("termo / higro", 0)
        elif cl == "hygrosensory":
            c = "umidade"
            disp[i] = D("termo / higro", 0)
        elif ty == "LPLC2":
            c = f"loom_{sd}"
            disp[i] = D("LPLC2 (looming)", 0)
        elif ty in ("ISN", "DH44"):
            c = "hunger"
            out[i] = O("dh44")
            disp[i] = D("neuroendocrinos", 2)
        elif ty == "IPC":
            c = "glucose"
            out[i] = O("insulin")
            disp[i] = D("neuroendocrinos", 2)
        elif re.match(r"^PAM", ty):
            c = "reward"
            out[i] = O("reward_da")
            disp[i] = D("PAM (dopamina +)", 1)
        elif re.match(r"^PPL1", ty):
            c = "punish"
            out[i] = O("punish_da")
            disp[i] = D("PPL1 (dopamina -)", 1)
        elif ty.startswith("pC1"):
            c = "courtship_cue"
            out[i] = O("courtship")
            disp[i] = D("pC1 (corte)", 1)
        elif ty == "DNp09":
            c = f"explore_fwd"
            out[i] = O(f"forward_{sd}")
        elif ty == "DNa02":
            c = f"explore_{sd}"
            out[i] = O(f"turn_{sd}")
        elif ty == "MDN":
            c = "explore_back"
            out[i] = O("backward")
        elif ty == "DNp01":
            out[i] = O("escape")
        elif ty == "MN9":
            out[i] = O("proboscis")
        elif re.match(r"^DNg12_(a|b|c)$", ty):
            out[i] = O("groom")
        elif re.match(r"^OA-", ty):
            out[i] = O("octopamine")
            disp[i] = D("octopamina / 5-HT / LK", 1)
        elif re.match(r"^(5-HT|CSD$)", ty):
            out[i] = O("serotonin")
            disp[i] = D("octopamina / 5-HT / LK", 1)
        elif ty == "LK":
            out[i] = O("leucokinin")
            disp[i] = D("octopamina / 5-HT / LK", 1)
        if c:
            chan[i] = C(c)
        if disp[i] < 0:
            if is_kc[i]:
                disp[i] = D("Kenyon cells (memoria)", 1)
            elif is_mbon[i]:
                disp[i] = D("MBONs", 1)
            elif ty == "APL":
                disp[i] = D("APL", 1)
            elif re.match(r"^[A-Z0-9]+_[a-z]*PN$", ty) or re.search(r"PN$", ty) and su == "cb_intrinsic":
                disp[i] = D("PNs (lobo antenal)", 1)
            elif su == "descending_neuron":
                disp[i] = D("descendentes (DNs)", 2)
            elif su in ("vnc_motor", "cb_motor"):
                disp[i] = D("motoneuronios", 2)
            elif su == "ascending_neuron":
                disp[i] = D("ascendentes", 1)
            elif su.startswith("ol_") or su.startswith("visual"):
                disp[i] = D("lobo optico", 1)
            elif su.startswith("vnc"):
                disp[i] = D("cordao nervoso ventral", 1)
            elif "endocrine" in su:
                disp[i] = D("neuroendocrinos", 2)
            else:
                disp[i] = D("cerebro central", 1)
        flags[i] = (1 if is_kc[i] else 0) | (2 if is_mbon[i] else 0) | (4 if is_dan[i] else 0) | (8 if is_pun[i] else 0)

    sign = [SIGN.get(info[n]["nt"], 1) for n in ids]
    write_brain(args, "mcns", N, agg, sign, is_kc, is_mbon, is_dan, chan, out, disp, flags, sp,
                name="Conectoma completo do male CNS (MCNS)", params={"w_syn": 0.275, "ref_rate": 35.0})


# ---------------------------------------------------------------- larva
def larva(args):
    z = zipfile.ZipFile(args.network)

    def rows(name):
        rd = csv.reader(io.StringIO(z.read(name).decode()))
        head = [h.strip().lstrip("#").strip() for h in next(rd)]
        for r in rd:
            yield dict(zip(head, r))

    nodes = list(rows("nodes.csv"))
    N = len(nodes)
    agg = defaultdict(int)
    for r in rows("edges.csv"):
        if r.get("etype") != "ad":
            continue  # so axonio->dendrito (as axo-axonicas geram lacos entre KCs)
        a, b = int(r["source"]), int(r["target"])
        if a != b:
            agg[(a, b)] += int(r["count"])
    sp = Spec()
    chan = array("i", [-1] * N)
    out = array("i", [-1] * N)
    disp = array("i", [-1] * N)
    flags = array("i", [0] * N)
    sign, is_kc, is_mbon, is_dan = [], [], [], []

    def D(name, kind):
        if name not in sp.disp_names:
            sp.disp_names.append(name)
            sp.disp_kind.append(kind)
        return sp.disp_names.index(name)

    for i, r in enumerate(nodes):
        ty, ann = r.get("cell_type", ""), r.get("annotations", "")
        sd = {"left": "L", "right": "R"}.get(r.get("hemisphere", ""), "L")
        c = None
        first = ann.split(";")[0].strip()
        if ty in ("sensory", "ascending") and "2nd_order" not in ann:
            m = {"olfactory": f"odor_{sd}", "gustatory-external": "gust_externo", "gustatory-pharyngeal": "gust_faringe",
                 "noci": "dor", "mechano-Ch": "tato_ch", "mechano-II/III": "tato", "proprio": "proprio",
                 "visual": f"luz_{sd}", "thermo-warm": "calor", "thermo-cold": "frio", "respiratory": "co2", "gut": "intestino",
                 "unknown modality": "outro"}
            for k, v in m.items():
                if k in ann:
                    c = v
                    break
            disp[i] = D(f"sensorial: {c or first}".split("_")[0] if c else "sensorial", 0)
        if ty == "DN-VNC":
            out[i] = sp.idx(sp.out_names, f"crawl_{sd}")
            c = c or f"explore_{sd}"
            disp[i] = D("DN-VNC (rastejar)", 2)
        elif ty == "DN-SEZ":
            out[i] = sp.idx(sp.out_names, "feed")
            disp[i] = D("DN-SEZ (comer)", 2)
        elif ty == "MBIN":
            c = c or "reward"
            disp[i] = D("MBIN (dopamina)", 1)
        if c:
            chan[i] = sp.idx(sp.chan_names, c)
        kc, mb, dn = ty == "KC", ty == "MBON", ty == "MBIN"
        is_kc.append(kc)
        is_mbon.append(mb)
        is_dan.append(dn)
        flags[i] = (1 if kc else 0) | (2 if mb else 0) | (4 if dn else 0)
        if disp[i] < 0:
            disp[i] = D({"KC": "Kenyon cells", "MBON": "MBONs", "PN": "PNs", "LN": "LNs (inibitorios)"}.get(ty, "outros"), 1)
        sign.append(-1 if ty == "LN" or "APL" in ann else 1)
    write_brain(args, "larva", N, agg, sign, is_kc, is_mbon, is_dan, chan, out, disp, flags, sp,
                name="Conectoma completo da larva (Winding 2023)", params={"w_syn": 2.0, "ref_rate": 40.0}, min_syn=1)


# ---------------------------------------------------------------- escrita
def write_brain(args, tag, N, agg, sign, is_kc, is_mbon, is_dan, chan, out, disp, flags, sp, name, params, min_syn=None):
    min_syn = args.min_syn if min_syn is None else min_syn
    main_e = defaultdict(list)
    plast = defaultdict(list)
    md = defaultdict(list)
    for (a, b), w in agg.items():
        if w < min_syn:
            continue
        s = sign[a] * w
        if is_kc[a] and is_mbon[b] and s > 0:
            plast[a].append((b, float(s)))
        else:
            main_e[a].append((b, s))
        if is_dan[a] and is_mbon[b]:
            md[b].append((a, float(w)))

    def csr(table, wtype):
        off = array("I", [0] * (N + 1))
        dst = array("I")
        ww = array(wtype)
        for i in range(N):
            for b, w in table.get(i, []):
                dst.append(b)
                ww.append(w)
            off[i + 1] = len(dst)
        return off, dst, ww

    off, dst, ww = csr(main_e, "i")
    poff, pdst, pw = csr(plast, "f")
    moff, mdan, mw = csr(md, "f")
    E, P, M = len(dst), len(pdst), len(mdan)
    # linhas do raster: amostra estratificada por grupo de exibicao
    random.seed(3)
    rows = array("i", [-1] * N)
    by = defaultdict(list)
    for i in range(N):
        by[disp[i]].append(i)
    row = 0
    for g in range(len(sp.disp_names)):
        members = by.get(g, [])
        k = min(len(members), max(8, int(700 * len(members) / N)))
        for i in sorted(random.sample(members, k)):
            rows[i] = row
            row += 1
    outdir = ROOT / "brain/full"
    outdir.mkdir(parents=True, exist_ok=True)
    buf = io.BytesIO()
    buf.write(b"FLYB")
    buf.write(struct.pack("<6I", 1, N, E, P, M, row))
    for arr in (off, dst, ww, chan, out, disp, rows, flags, poff, pdst, pw, moff, mdan, mw):
        buf.write(arr.tobytes())
    with gzip.open(outdir / f"{tag}.bin.gz", "wb", compresslevel=6) as f:
        f.write(buf.getvalue())
    meta = {"name": name, "tag": tag, "neurons": N, "edges": E, "plastic": P, "mbon_dan": M, "raster_rows": row,
            "channels": sp.chan_names, "outputs": sp.out_names, "display": sp.disp_names, "display_kind": sp.disp_kind,
            "params": params, "min_syn": min_syn}
    (outdir / f"{tag}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    size = (outdir / f"{tag}.bin.gz").stat().st_size / 1e6
    print(f"{tag}: {N:,} neuronios, {E:,} sinapses (+{P:,} KC->MBON plasticas), {len(sp.chan_names)} canais, "
          f"{len(sp.out_names)} saidas -> brain/full/{tag}.bin.gz ({size:.1f} MB)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("which", choices=["mcns", "larva"])
    ap.add_argument("--connections", default=str(ROOT / "brain/codex/connections_princeton.csv.gz"))
    ap.add_argument("--annotations", default=str(ROOT / "brain/codex/neurons.csv.gz"))
    ap.add_argument("--network", default=str(ROOT / "brain/codex/larva_network.csv.zip"))
    ap.add_argument("--min-syn", type=int, default=5)
    args = ap.parse_args()
    mcns(args) if args.which == "mcns" else larva(args)


if __name__ == "__main__":
    main()
