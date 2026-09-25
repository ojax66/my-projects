#!/usr/bin/env python3
"""Gera conectomas SINTETICOS de girino e ra (anuro) para o simulador em GPU.

Nao existe (2026) um conectoma medido de ra ou girino como os da mosca
(MCNS) e da larva (Winding 2023). Estes sao construidos por REGRAS a partir
da anatomia e fisiologia publicadas, no MESMO formato e com o MESMO modelo
(LIF / campo medio, depressao sinaptica, plasticidade de tres fatores) dos
conectomas de inseto do jogo:

Girino (Xenopus, estagio de natacao; Roberts et al. 2010, 2014; Li 2011)
  Rohon-Beard (tato) -> dlc (cruza) / dla (ipsilateral) -> dIN
  dIN: excitatorios descendentes, recorrentes ipsilaterais (geram o ritmo)
  cIN: inibitorios comissurais (alternancia esquerda/direita)
  aIN: inibitorios ascendentes (ipsilaterais)
  MN: motoneuronios do tronco -> saida swim_L / swim_R
  celula de Mauthner: fuga rapida (C-start) com linha lateral / sombra
  reticulospinais do rombencefalo (inicio/giro) e MHR GABAergicos (parar,
  acionados pela glandula pineal quando escurece)
  linha lateral, retina -> teto optico (cruzado), olfato, paladar
  CPG da boca (raspar algas) -> saida feed

Ra adulta (Rana; Ewert 1987, 2004; Roth 1987; Ingle 1983; Nishikawa 2000)
  retina R2 ("detectores de inseto", objetos pequenos em movimento) ->
    teto optico T5.2 (cruzado) -> reticular de orientacao -> orient_L/R
  retina R3/R4 (escurecimento, objetos grandes) -> pre-teto TH3 ->
    inibe o teto (presa x ameaca: "worm / antiworm") e aciona a fuga
  nucleo isthmi (atencao), hipoglosso (lingua) -> snap; mandibula
  reticulospinais -> CPG dos membros posteriores -> hop; escape
  gerador vocal do rombencefalo -> call; auditivo (canto de outras ras)
  hipotalamo (fome/NPY) facilita o teto; NTS (paladar) -> dopamina
  palio (codigo esparso, papel das celulas de Kenyon) -> estriado
  (saidas de aproximacao / evitacao, papel das MBONs) com dopamina do
  tuberculo posterior: recompensa (engolir comida) e punicao (amargo, dor)
  -> as ras aprendem a evitar presas ruins e a reconhecer as boas.

    python3 tools/build_amphibian_brain.py            # gera os dois
    python3 tools/build_amphibian_brain.py --test     # + teste de resposta
Saida: brain/full/{girino,ra}.bin.gz + .json
"""
import argparse
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_full_brain import Spec, write_brain  # noqa: E402

SIDES = ("L", "R")


class Builder:
    def __init__(self, seed):
        self.rng = np.random.default_rng(seed)
        self.pops = {}      # nome -> (inicio, n)
        self.meta = {}      # nome -> dict
        self.N = 0
        self.agg = defaultdict(int)

    def pop(self, name, n, disp, kind=1, sign=1, chan=None, out=None, kc=False, mbon=False, dan=False, pun=False, sided=False):
        names = [f"{name}_{s}" for s in SIDES] if sided else [name]
        for nm in names:
            side = nm[-1] if sided else ""
            self.pops[nm] = (self.N, n)
            self.meta[nm] = dict(disp=disp, kind=kind, sign=sign, kc=kc, mbon=mbon, dan=dan, pun=pun,
                                 chan=chan.format(s=side) if chan else None, out=out.format(s=side) if out else None)
            self.N += n

    def _expand(self, name, side=None):
        if name in self.pops:
            return [name]
        if side:
            return [f"{name}_{side}"]
        return [f"{name}_{s}" for s in SIDES]

    def conn(self, src, dst, p, w=(1, 3), mode="ipsi"):
        """mode: ipsi (mesmo lado), contra (lado oposto), both (todos)."""
        src_sided = src not in self.pops
        dst_sided = dst not in self.pops
        pairs = []
        if src_sided and dst_sided:
            for s in SIDES:
                o = s if mode == "ipsi" else ("R" if s == "L" else "L")
                if mode == "both":
                    pairs += [(f"{src}_{s}", f"{dst}_{t}") for t in SIDES]
                else:
                    pairs.append((f"{src}_{s}", f"{dst}_{o}"))
        else:
            pairs = [(a, b) for a in self._expand(src) for b in self._expand(dst)]
        for a, b in pairs:
            a0, na = self.pops[a]
            b0, nb = self.pops[b]
            k = self.rng.binomial(nb, min(p, 1.0), size=na)
            for i in range(na):
                if k[i] == 0:
                    continue
                tg = self.rng.choice(nb, size=min(k[i], nb), replace=False)
                ws = self.rng.integers(w[0], w[1] + 1, size=tg.size)
                for t, ww in zip(tg, ws):
                    if a0 + i != b0 + t:
                        self.agg[(a0 + i, b0 + int(t))] += int(ww)

    def export(self, tag, name, params, args):
        N = self.N
        sp = Spec()
        from array import array
        chan = array("i", [-1] * N)
        out = array("i", [-1] * N)
        disp = array("i", [-1] * N)
        flags = array("i", [0] * N)
        sign, is_kc, is_mbon, is_dan = [0] * N, [False] * N, [False] * N, [False] * N
        for nm, (a0, n) in self.pops.items():
            m = self.meta[nm]
            if m["disp"] not in sp.disp_names:
                sp.disp_names.append(m["disp"])
                sp.disp_kind.append(m["kind"])
            d = sp.disp_names.index(m["disp"])
            c = sp.idx(sp.chan_names, m["chan"]) if m["chan"] else -1
            o = sp.idx(sp.out_names, m["out"]) if m["out"] else -1
            f = (1 if m["kc"] else 0) | (2 if m["mbon"] else 0) | (4 if m["dan"] else 0) | (8 if m["pun"] else 0)
            for i in range(a0, a0 + n):
                chan[i], out[i], disp[i], flags[i] = c, o, d, f
                sign[i] = m["sign"]
                is_kc[i], is_mbon[i], is_dan[i] = m["kc"], m["mbon"], m["dan"]
        write_brain(args, tag, N, self.agg, sign, is_kc, is_mbon, is_dan, chan, out, disp, flags, sp,
                    name=name, params=params, min_syn=1)
        return sp, sign, is_kc, is_mbon


# ---------------------------------------------------------------- girino
def tadpole():
    b = Builder(11)
    S = True
    # sensoriais
    b.pop("RB", 150, "Rohon-Beard (tato)", 0, chan="tato_{s}", sided=S)
    b.pop("linha_lateral", 180, "linha lateral", 0, chan="linha_lateral_{s}", sided=S)
    b.pop("ret_sombra", 150, "retina (sombra/looming)", 0, chan="sombra_{s}", sided=S)
    b.pop("ret_luz", 100, "retina (luz)", 0, chan="luz_{s}", sided=S)
    b.pop("pineal", 40, "pineal (escurecimento)", 0, chan="escuro_pineal")
    b.pop("tato_cabeca", 60, "trigemeo (tato na cabeca)", 0, chan="tato_cabeca")
    b.pop("olf", 150, "epitelio olfativo", 0, chan="olfato_{s}", sided=S)
    b.pop("gust_bom", 100, "paladar", 0, chan="paladar_bom")
    b.pop("gust_ruim", 80, "paladar", 0, chan="paladar_ruim")
    b.pop("dor", 80, "nociceptores", 0, chan="dor")
    b.pop("fome", 60, "hipotalamo (fome)", 1, chan="fome")
    b.pop("glicose", 40, "hipotalamo (fome)", 1, chan="glicose")
    b.pop("explore", 80, "reticular (inicio)", 1, chan="explore_{s}", sided=S)
    # medula (Roberts): dlc, dla, dIN, cIN, aIN, MN
    b.pop("dlc", 80, "medula: dlc/dla (sensoriais)", sided=S)
    b.pop("dla", 60, "medula: dlc/dla (sensoriais)", sided=S)
    b.pop("dIN", 250, "medula: dIN (ritmo)", sided=S)
    b.pop("cIN", 250, "medula: cIN (inibicao cruzada)", sign=-1, sided=S)
    b.pop("aIN", 150, "medula: aIN (inibicao)", sign=-1, sided=S)
    b.pop("MN", 300, "motoneuronios (cauda)", 2, out="swim_{s}", sided=S)
    b.pop("mauthner", 4, "Mauthner (fuga)", 2, out="escape_{s}", sided=S)
    b.pop("hRS", 200, "reticulospinais", sided=S)
    b.pop("MHR", 60, "MHR (parar)", sign=-1)
    b.pop("teto", 400, "teto optico", sided=S)
    b.pop("mitral", 120, "bulbo olfativo", sided=S)
    b.pop("pal", 800, "palio (codigo esparso)", kc=True)
    b.pop("pal_inh", 60, "palio: interneuronios", sign=-1)
    b.pop("str_ap", 60, "estriado (aproximar)", mbon=True)
    b.pop("str_ev", 60, "estriado (evitar)", mbon=True)
    b.pop("da_rec", 40, "dopamina (tuberculo posterior)", chan="reward", dan=True)
    b.pop("da_pun", 40, "dopamina (tuberculo posterior)", chan="punish", dan=True, pun=True)
    b.pop("boca", 150, "CPG da boca (raspar)", 2, out="feed")
    b.pop("rafe", 30, "rafe (serotonina)", 2, out="serotonin")
    b.pop("lc", 30, "locus coeruleus (noradrenalina)", 2, out="octopamine")
    # medula
    b.conn("RB", "dlc", 0.12, (2, 4), "ipsi")
    b.conn("RB", "dla", 0.12, (2, 4), "ipsi")
    b.conn("dlc", "dIN", 0.12, (1, 3), "contra")
    b.conn("dla", "dIN", 0.10, (1, 3), "ipsi")
    b.conn("dIN", "dIN", 0.05, (1, 2), "ipsi")
    b.conn("dIN", "MN", 0.08, (2, 3), "ipsi")
    b.conn("dIN", "cIN", 0.06, (1, 3), "ipsi")
    b.conn("dIN", "aIN", 0.06, (1, 3), "ipsi")
    b.conn("cIN", "dIN", 0.06, (1, 3), "contra")
    b.conn("cIN", "MN", 0.06, (1, 3), "contra")
    b.conn("cIN", "cIN", 0.03, (1, 2), "contra")
    b.conn("aIN", "dIN", 0.04, (1, 2), "ipsi")
    b.conn("aIN", "dla", 0.05, (1, 2), "ipsi")
    b.conn("hRS", "dIN", 0.12, (2, 3), "ipsi")
    b.conn("explore", "hRS", 0.2, (2, 3), "ipsi")
    b.conn("MHR", "dIN", 0.2, (2, 4), "both")
    b.conn("MHR", "hRS", 0.2, (2, 4), "both")
    # a pineal detecta o escurecimento (sombra) e faz o girino nadar;
    # encostar a cabeca em algo aciona o MHR e para a natacao (Roberts)
    b.conn("pineal", "hRS", 0.3, (2, 4), "both")
    b.conn("tato_cabeca", "MHR", 0.3, (2, 4))
    # fuga: Mauthner (linha lateral / sombra / toque forte) -> MN do lado oposto
    b.conn("linha_lateral", "mauthner", 0.5, (2, 4), "ipsi")
    b.conn("ret_sombra", "mauthner", 0.4, (1, 3), "contra")
    b.conn("RB", "mauthner", 0.2, (1, 2), "ipsi")
    b.conn("mauthner", "MN", 0.9, (4, 6), "contra")
    b.conn("mauthner", "cIN", 0.6, (2, 4), "contra")
    b.conn("linha_lateral", "hRS", 0.05, (1, 2), "contra")
    # visao
    b.conn("ret_sombra", "teto", 0.08, (1, 3), "contra")
    b.conn("ret_luz", "teto", 0.05, (1, 2), "contra")
    b.conn("teto", "hRS", 0.05, (1, 3), "contra")
    b.conn("teto", "pal", 0.02, (1, 2), "both")
    # olfato/paladar -> palio (esparso) -> estriado (plastico)
    b.conn("olf", "mitral", 0.15, (2, 3), "ipsi")
    b.conn("mitral", "pal", 0.02, (1, 2), "both")
    b.conn("gust_bom", "pal", 0.01, (1, 2))
    b.conn("pal", "pal_inh", 0.05, (1, 2))
    b.conn("pal_inh", "pal", 0.08, (1, 2))
    b.conn("pal", "str_ap", 0.12, (1, 2))
    b.conn("pal", "str_ev", 0.12, (1, 2))
    b.conn("da_pun", "str_ap", 0.5, (2, 4))
    b.conn("da_rec", "str_ev", 0.5, (2, 4))
    b.conn("gust_bom", "da_rec", 0.2, (1, 3))
    b.conn("gust_ruim", "da_pun", 0.2, (1, 3))
    b.conn("dor", "da_pun", 0.2, (1, 3))
    b.conn("str_ap", "hRS", 0.06, (1, 2), "both")
    b.conn("str_ap", "boca", 0.1, (1, 2))
    b.conn("str_ev", "MHR", 0.1, (1, 2))
    b.conn("str_ev", "hRS", 0.04, (1, 2), "both")
    b.conn("mitral", "hRS", 0.03, (1, 2), "ipsi")
    # alimentacao
    b.conn("gust_bom", "boca", 0.2, (1, 3))
    b.conn("fome", "boca", 0.2, (1, 2))
    b.conn("fome", "hRS", 0.06, (1, 2))
    b.conn("glicose", "boca", 0.1, (1, 2))
    b.pop("inib_saciedade", 40, "hipotalamo (fome)", sign=-1)
    b.conn("glicose", "inib_saciedade", 0.3, (1, 3))
    b.conn("inib_saciedade", "boca", 0.3, (1, 3))
    b.conn("gust_ruim", "MHR", 0.1, (1, 3))
    # moduladores
    b.conn("dor", "lc", 0.2, (1, 3))
    b.conn("linha_lateral", "lc", 0.05, (1, 2))
    b.conn("lc", "hRS", 0.05, (1, 2), "both")
    b.conn("glicose", "rafe", 0.2, (1, 2))
    b.conn("dor", "RB", 0.0, (1, 1))
    return b


# ---------------------------------------------------------------- ra adulta
def frog():
    b = Builder(23)
    S = True
    b.pop("ret_R2", 800, "retina R2 (presa)", 0, chan="presa_{s}", sided=S)
    b.pop("ret_R34", 600, "retina R3/R4 (ameaca)", 0, chan="sombra_{s}", sided=S)
    b.pop("ret_luz", 300, "retina (luz)", 0, chan="luz_{s}", sided=S)
    b.pop("olf", 400, "epitelio olfativo", 0, chan="olfato_{s}", sided=S)
    b.pop("gust_bom", 150, "paladar", 0, chan="paladar_bom")
    b.pop("gust_ruim", 150, "paladar", 0, chan="paladar_ruim")
    b.pop("tato", 400, "tato", 0, chan="tato")
    b.pop("dor", 200, "nociceptores", 0, chan="dor")
    b.pop("vest", 150, "vestibular", 0, chan="equilibrio")
    b.pop("audit", 300, "auditivo (papila)", 0, chan="som")
    b.pop("temp", 80, "termorreceptores", 0, chan="temperatura")
    b.pop("fome", 100, "hipotalamo (fome/NPY)", 1, chan="fome")
    b.pop("glicose", 60, "hipotalamo (fome/NPY)", 1, chan="glicose")
    b.pop("explore", 150, "reticular (inicio)", 1, chan="explore_{s}", sided=S)
    b.pop("T52", 1500, "teto optico T5.2 (presa)", sided=S)
    b.pop("T6", 600, "teto optico (objetos grandes)", sided=S)
    b.pop("teto_inh", 400, "teto: interneuronios", sign=-1, sided=S)
    b.pop("TH3", 800, "pre-teto TH3 (ameaca)", sided=S)
    b.pop("pret_inh", 400, "pre-teto: inibicao do teto", sign=-1, sided=S)
    b.pop("isthmi", 300, "nucleo isthmi (atencao)", sided=S)
    b.pop("orient", 400, "reticular: orientacao", 2, out="orient_{s}", sided=S)
    b.pop("aprox", 300, "reticular: aproximacao", 2, out="approach")
    b.pop("hipoglosso", 200, "hipoglosso (lingua)", 2, out="snap")
    b.pop("fuga", 300, "reticular: fuga", 2, out="escape_{s}", sided=S)
    b.pop("mp_ext", 500, "medula: membros posteriores", 2, out="hop", sided=S)
    b.pop("mp_flex", 500, "medula: membros posteriores", sided=S)
    b.pop("mp_inh", 200, "medula: interneuronios", sign=-1, sided=S)
    b.pop("vpg", 200, "gerador vocal", 2, out="call")
    b.pop("mitral", 400, "bulbo olfativo", sided=S)
    b.pop("nts", 300, "nucleo do trato solitario", 1)
    b.pop("pal", 4000, "palio (codigo esparso)", kc=True)
    b.pop("pal_inh", 300, "palio: interneuronios", sign=-1)
    b.pop("str_ap", 200, "estriado (aproximar)", mbon=True)
    b.pop("str_ev", 200, "estriado (evitar)", mbon=True)
    b.pop("da_rec", 120, "dopamina (tuberculo posterior)", chan="reward", dan=True)
    b.pop("da_pun", 120, "dopamina (tuberculo posterior)", chan="punish", dan=True, pun=True)
    b.pop("hip", 200, "hipotalamo (fome/NPY)")
    b.pop("saciedade", 80, "hipotalamo (fome/NPY)", sign=-1)
    b.pop("rafe", 100, "rafe (serotonina)", 2, out="serotonin")
    b.pop("lc", 100, "locus coeruleus (noradrenalina)", 2, out="octopamine")
    b.pop("amig", 300, "amigdala medial (medo)")
    # visao: retina -> teto/pre-teto do lado oposto (quiasma)
    b.conn("ret_R2", "T52", 0.03, (1, 3), "contra")
    b.conn("ret_R34", "T6", 0.03, (1, 3), "contra")
    b.conn("ret_R34", "TH3", 0.04, (1, 3), "contra")
    b.conn("ret_luz", "TH3", 0.01, (1, 2), "contra")
    b.conn("T52", "teto_inh", 0.02, (1, 2), "ipsi")
    b.conn("teto_inh", "T52", 0.02, (1, 2), "ipsi")
    b.conn("TH3", "pret_inh", 0.05, (1, 3), "ipsi")
    b.conn("pret_inh", "T52", 0.04, (2, 4), "ipsi")     # ameaca grande suprime a caca
    b.conn("T52", "isthmi", 0.03, (1, 2), "ipsi")
    b.conn("isthmi", "T52", 0.02, (1, 2), "ipsi")
    # presa na esquerda -> teto direito -> orientacao para a esquerda
    b.conn("T52", "orient", 0.03, (1, 3), "contra")
    b.conn("T52", "aprox", 0.01, (1, 2))
    b.conn("T52", "hipoglosso", 0.012, (1, 2))
    b.conn("aprox", "mp_ext", 0.02, (1, 2), "both")
    # fome facilita a caca (NPY sobre o teto), saciedade inibe
    b.conn("fome", "hip", 0.2, (1, 3))
    b.conn("hip", "T52", 0.01, (1, 2), "both")
    b.conn("hip", "aprox", 0.05, (1, 2))
    b.conn("hip", "hipoglosso", 0.05, (1, 2))
    b.conn("glicose", "saciedade", 0.3, (1, 3))
    b.conn("saciedade", "hip", 0.3, (2, 4))
    b.conn("saciedade", "hipoglosso", 0.1, (1, 2))
    # ameaca -> fuga e salto
    b.conn("TH3", "fuga", 0.03, (1, 3), "contra")
    b.conn("T6", "fuga", 0.02, (1, 2), "ipsi")
    b.conn("dor", "fuga", 0.05, (1, 3), "both")
    b.conn("tato", "fuga", 0.02, (1, 2), "both")
    b.conn("fuga", "mp_ext", 0.08, (2, 4), "both")
    b.conn("fuga", "amig", 0.05, (1, 2), "both")
    b.conn("fuga", "hipoglosso", 0.0, (1, 1))
    b.pop("fuga_inh", 100, "reticular: fuga", sign=-1)
    b.conn("fuga", "fuga_inh", 0.1, (1, 2), "both")
    b.conn("fuga_inh", "hipoglosso", 0.3, (2, 4))
    b.conn("fuga_inh", "aprox", 0.3, (2, 4))
    # medula: extensores x flexores
    b.conn("mp_ext", "mp_inh", 0.03, (1, 2), "ipsi")
    b.conn("mp_inh", "mp_flex", 0.05, (1, 3), "ipsi")
    b.conn("mp_flex", "mp_inh", 0.02, (1, 2), "ipsi")
    b.conn("explore", "mp_ext", 0.02, (1, 2), "ipsi")
    b.conn("explore", "orient", 0.02, (1, 2), "ipsi")
    b.conn("vest", "orient", 0.01, (1, 2), "both")
    # vocal: canto de outras ras e estado
    b.conn("audit", "vpg", 0.05, (1, 2))
    b.conn("explore", "vpg", 0.02, (1, 2), "both")
    b.conn("amig", "vpg", 0.0, (1, 1))
    b.pop("vpg_inh", 60, "gerador vocal", sign=-1)
    b.conn("amig", "vpg_inh", 0.2, (1, 3))
    b.conn("vpg_inh", "vpg", 0.3, (2, 4))
    # olfato e paladar -> palio / dopamina
    b.conn("olf", "mitral", 0.05, (2, 3), "ipsi")
    b.conn("gust_bom", "nts", 0.1, (1, 3))
    b.conn("gust_ruim", "nts", 0.1, (1, 3))
    b.conn("gust_bom", "da_rec", 0.2, (1, 3))
    b.conn("gust_ruim", "da_pun", 0.2, (1, 3))
    b.conn("dor", "da_pun", 0.1, (1, 3))
    b.conn("gust_ruim", "fuga_inh", 0.0, (1, 1))
    # palio: codigo esparso da presa (visao do teto + cheiro + gosto)
    b.conn("T52", "pal", 0.003, (1, 2), "both")
    b.conn("T6", "pal", 0.002, (1, 2), "both")
    b.conn("mitral", "pal", 0.004, (1, 2), "both")
    b.conn("nts", "pal", 0.005, (1, 2))
    b.conn("pal", "pal_inh", 0.02, (1, 2))
    b.conn("pal_inh", "pal", 0.03, (1, 2))
    b.conn("pal", "str_ap", 0.06, (1, 2))
    b.conn("pal", "str_ev", 0.06, (1, 2))
    b.conn("da_pun", "str_ap", 0.5, (2, 4))
    b.conn("da_rec", "str_ev", 0.5, (2, 4))
    # estriado: aproximar facilita a caca; evitar recruta a inibicao do pre-teto
    b.conn("str_ap", "hipoglosso", 0.05, (1, 2))
    b.conn("str_ap", "aprox", 0.05, (1, 2))
    b.conn("str_ev", "pret_inh", 0.03, (1, 3), "both")
    b.conn("str_ev", "amig", 0.05, (1, 2), "both")
    # moduladores
    b.conn("amig", "lc", 0.05, (1, 2), "both")
    b.conn("dor", "lc", 0.1, (1, 3))
    b.conn("lc", "fuga", 0.01, (1, 2), "both")
    b.conn("glicose", "rafe", 0.2, (1, 2))
    b.conn("temp", "explore", 0.02, (1, 2), "both")
    return b


# ---------------------------------------------------------------- teste (campo medio, igual ao shader)
def simulate(b, sp, sign, w_syn, inputs, steps=60, dt=20.0):
    N = b.N
    pre, post, w = [], [], []
    for (a, c), n in b.agg.items():
        pre.append(a)
        post.append(c)
        w.append(sign[a] * n)
    pre, post, w = np.array(pre), np.array(post), np.array(w, float)
    chan = np.full(N, -1)
    for nm, (a0, n) in b.pops.items():
        c = b.meta[nm]["chan"]
        if c:
            chan[a0:a0 + n] = sp.chan_names.index(c)
    ir = np.zeros(N)
    for c, v in inputs.items():
        if c in sp.chan_names:
            ir[chan == sp.chan_names.index(c)] = v
    r = np.zeros(N)
    ad = np.zeros(N)
    dep = np.ones(N)
    th = 7.0

    def lif(x):
        xe = th + 0.8 * np.log1p(np.exp(np.clip((x - th) / 0.8, -30, 30)))
        return 1.0 / (0.0022 + 0.02 * np.log(xe / (xe - th)))

    for _ in range(steps):
        g = np.zeros(N)
        np.add.at(g, post, r[pre] * dep[pre] * 0.005 * w_syn * w)
        ad += (r - ad) * dt / (dt + 400)
        x = g - 0.1 * ad - 0.3 * np.maximum(0, ad - 80)
        tgt = np.maximum(0, lif(x) - lif(np.zeros(1)))
        tgt += ir * np.clip((x + th) / th, 0, 1)
        tgt = np.minimum(tgt, 200)
        r += (tgt - r) * dt / (dt + 30)
        dep = np.clip((dep + dt / 300) / (1 + dt / 300 + 0.06 * r * dt / 1000), 0.02, 1)
    res = {}
    for nm, (a0, n) in b.pops.items():
        res[nm] = float(r[a0:a0 + n].mean())
    return res


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--test", action="store_true")
    ap.add_argument("--min-syn", type=int, default=1)
    args = ap.parse_args()
    specs = [
        ("girino", "Conectoma sintetico do girino (regras: Roberts et al.)", tadpole, {"w_syn": 2.0, "ref_rate": 40.0}),
        ("ra", "Conectoma sintetico da ra (regras: Ewert, Roth, Nishikawa)", frog, {"w_syn": 2.2, "ref_rate": 40.0}),
    ]
    for tag, name, fn, params in specs:
        b = fn()
        sp, sign, _, _ = b.export(tag, name, params, args)
        if args.test:
            base = {"explore_L": 20, "explore_R": 20, "fome": 60, "glicose": 20}
            cases = {"repouso": {}}
            if tag == "ra":
                cases |= {"presa a esquerda": {"presa_L": 120}, "presa, saciada": {"presa_L": 120, "fome": 0, "glicose": 120},
                          "ameaca grande a direita": {"sombra_R": 150}, "presa + ameaca": {"presa_L": 120, "sombra_L": 150}}
                keys = ["orient_L", "orient_R", "aprox", "hipoglosso", "fuga_L", "fuga_R", "mp_ext_L", "mp_ext_R"]
            else:
                cases |= {"toque a esquerda": {"tato_L": 150}, "onda na linha lateral direita": {"linha_lateral_R": 150},
                          "alga (paladar)": {"paladar_bom": 120}, "sombra (pineal)": {"escuro_pineal": 120},
                          "procurando (explorar)": {"explore_L": 90, "explore_R": 90},
                          "virando a esquerda": {"explore_L": 30, "explore_R": 110},
                          "cabeca encostou": {"explore_L": 90, "explore_R": 90, "tato_cabeca": 150}}
                keys = ["MN_L", "MN_R", "mauthner_L", "mauthner_R", "boca", "MHR"]
            for cname, inp in cases.items():
                res = simulate(b, sp, sign, params["w_syn"], base | inp)
                print(f"  {tag} {cname:28s} " + "  ".join(f"{k} {res[k]:5.1f}" for k in keys))


if __name__ == "__main__":
    main()
