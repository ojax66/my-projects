#!/usr/bin/env python3
"""Conectomas SINTETICOS de ra adulta e girino (versao 2, em grande escala).

Nao existe (2026) um conectoma medido de ra ou girino. Estes sao construidos
por regras a partir da anatomia e da fisiologia publicadas, no mesmo formato
e com o mesmo modelo (LIF / campo medio, depressao sinaptica, plasticidade de
tres fatores) dos conectomas de inseto do jogo. A versao 2 tem ~10x mais
neuronios, todos os sistemas conhecidos do encefalo de anuro, e mapas
topograficos (a posicao no campo visual vira posicao no teto optico, que vira
o angulo do giro), em vez de so "esquerda/direita".

Regras de ligacao: cada ligacao e dada pelo numero medio de entradas que um
neuronio do alvo recebe da populacao de origem (grau de entrada), entao a
rede pode crescer sem desregular a dinamica. Topografia: cada neuronio de uma
populacao mapeada tem uma coordenada u (0..1) e as entradas vem de neuronios
com coordenada proxima ("perto"), acima ("acima") ou de uma faixa.

RA ADULTA (Rana / Lithobates; Ewert 1987, 2004; Roth 1987; Ingle 1983;
Nishikawa 2000; Wilczynski & Endepols 2007; Kelley 2004; Zornik & Kelley
2008; Straka & Dieringer 2004; Giszter et al. 1993; Kiehn 2006)
  retina   8 setores do campo visual (4 por olho) de ganglionares R2 ("inseto"),
           R3/R4 (escurecimento, ameaca), R1 (bordas/luz), binocular de perto,
           movimento do campo inteiro (optocinetico)
  teto     T5.2 / T5.1 / T5.3 (presa), T6 (objetos grandes), camadas T1-T4 e
           interneuronios, com retinotopia cruzada; nucleo isthmi (atencao)
  pre-teto TH3 (ameaca, inibe o teto: "worm/antiworm"), lentiforme (optocinetico),
           nucleo da raiz optica basal
  talamo   anterior, central (audicao), posterior, lateral (visao)
  telencefalo  palio medial (hipocampo: lugares), dorsal e lateral (olfato;
           codigo esparso, papel das celulas de Kenyon), estriado aproximar /
           evitar (plastico, com dopamina), accumbens, septo, amigdala
           medial/lateral/central, area preoptica (canto e sexo)
  olfato   epitelio principal, vomeronasal, bulbo principal (mitrais +
           granulos), bulbo acessorio
  audicao  papila anfibia e basilar, nucleo dorsal do bulbo, oliva superior,
           toro semicircular, talamo central -> preoptico (reconhece o canto)
  equilibrio  canais semicirculares, utriculo, saculo (vibracao do chao),
           nucleos vestibulares, vestibuloespinhais (endireitar)
  cerebelo granulos, Purkinje, Golgi, euridendroides, oliva inferior
  hipotalamo  fome (NPY), saciedade, VMH (defesa), SCN (relogio), PVN (CRH ->
           corticosterona), vasotocina (canto, agua), GnRH (reproducao), TRH
           (tireoide), POMC/MSH (cor da pele), termorregulacao, sede,
           tuberculo posterior (dopamina de recompensa e punicao), pineal
           (melatonina)
  mesencefalo  tegmento, substancia cinzenta periaquedutal, oculomotor,
           locus coeruleus (noradrenalina), rafe (serotonina)
  rombencefalo  reticular: inicio da locomocao, orientacao (mapa motor),
           aproximacao, fuga; reticuloespinhais; hipoglosso (protrator e
           retrator da lingua), trigemeo motor (abrir e fechar a boca),
           retrator do bulbo (olhos afundam para engolir), membrana
           nictitante; gerador vocal (DTAM + pre-trigeminal: canto de anuncio,
           canto de soltura, grito de socorro); geradores respiratorios bucal
           e pulmonar; vago e simpatico (coracao); nucleo do trato solitario
  medula   bracos (CPG, ombro, limpar o rosto, abraco do acasalamento) e pernas
           (CPG com comissurais, Ia, Renshaw; extensores, flexores, passo);
           glandulas da pele (secrecao), inflar (defesa)

GIRINO (Xenopus, estagios 37-45; Roberts et al. 2010, 2014; Li 2011, 2014;
Soffe 1993; Pronych & Wassersug 1994; Dong & Aizenman 2012)
  medula: Rohon-Beard, dlc/dla, dIN (ritmo), cIN, aIN, motoneuronios, e o
  circuito do debater-se (struggling) de quando e segurado; reticuloespinhais,
  MHR (parar, acionados pela cabeca e pela glandula de cimento), Mauthner e
  as celulas de fuga; linha lateral, pineal, retina de 8 setores -> teto
  retinotopico; olfato, paladar, gerador da boca (raspar algas), bomba
  bucal (branquias), coracao, palio/estriado com dopamina, hipotalamo com
  TRH -> tireoide (tempo da metamorfose)

    python3 tools/build_amphibian_brain.py            # gera os dois
    python3 tools/build_amphibian_brain.py --test     # + teste de resposta
Saida: brain/full/{girino,ra}.bin.gz + .json
"""
import argparse
import gzip
import io
import json
import struct
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SIDES = ("L", "R")
OTHER = {"L": "R", "R": "L"}


class Agg:
    """Ligacoes (pre, pos, sinapses) em vetores; imita o dicionario antigo."""

    def __init__(self, pre, post, w):
        self.pre, self.post, self.w = pre, post, w

    def items(self):
        for a, b, k in zip(self.pre.tolist(), self.post.tolist(), self.w.tolist()):
            yield (a, b), k

    def values(self):
        return self.w.tolist()

    def __len__(self):
        return len(self.w)


class Builder:
    def __init__(self, seed):
        self.rng = np.random.default_rng(seed)
        self.pops = {}      # nome -> (inicio, n)
        self.meta = {}
        self.N = 0
        self._pre, self._post, self._w = [], [], []
        self._agg = None

    # ------------------------------------------------------------ populacoes
    def pop(self, name, n, disp, kind=1, sign=1, chan=None, out=None, kc=False, mbon=False, dan=False, pun=False, sided=False):
        names = [f"{name}_{s}" for s in SIDES] if sided else [name]
        for nm in names:
            side = nm[-1] if sided else ""
            self.pops[nm] = (self.N, int(n))
            self.meta[nm] = dict(disp=disp, kind=kind, sign=sign, kc=kc, mbon=mbon, dan=dan, pun=pun,
                                 chan=chan.format(s=side) if chan else None, out=out.format(s=side) if out else None)
            self.N += int(n)

    def _pairs(self, src, dst, mode):
        s_sided = src not in self.pops
        d_sided = dst not in self.pops
        if s_sided and d_sided:
            if mode == "both":
                return [(f"{src}_{a}", f"{dst}_{b}") for a in SIDES for b in SIDES]
            return [(f"{src}_{s}", f"{dst}_{s if mode == 'ipsi' else OTHER[s]}") for s in SIDES]
        ss = [src] if not s_sided else [f"{src}_{s}" for s in SIDES]
        dd = [dst] if not d_sided else [f"{dst}_{s}" for s in SIDES]
        return [(a, b) for a in ss for b in dd]

    def conn(self, src, dst, K, w=(1, 3), mode="ipsi", topo=None, src_range=None, dst_range=None):
        """K: numero medio de entradas que cada neuronio do alvo recebe da origem.
        topo: ("perto", sigma) | ("acima", folga) - usa a coordenada u (0..1).
        src_range / dst_range: so essa faixa de u da origem / do alvo."""
        if K <= 0:
            return
        for a, b in self._pairs(src, dst, mode):
            a0, na = self.pops[a]
            b0, nb = self.pops[b]
            ub = (np.arange(nb) + 0.5) / nb
            k = self.rng.poisson(K, nb)
            if dst_range:
                k[(ub < dst_range[0]) | (ub > dst_range[1])] = 0
            tot = int(k.sum())
            if tot == 0:
                continue
            tgt = np.repeat(np.arange(nb), k)
            lo, hi = src_range if src_range else (0.0, 1.0)
            if topo is None:
                us = lo + self.rng.random(tot) * (hi - lo)
            elif topo[0] == "perto":
                us = np.clip(ub[tgt] + self.rng.normal(0, topo[1], tot), lo, hi)
            elif topo[0] == "acima":
                base = np.clip(ub[tgt] - topo[1], lo, hi)
                us = base + self.rng.random(tot) * (hi - base)
            else:
                raise ValueError(topo)
            s = np.clip((us * na).astype(np.int64), 0, na - 1)
            ok = (s + a0) != (tgt + b0)
            self._pre.append((s + a0)[ok].astype(np.int32))
            self._post.append((tgt + b0)[ok].astype(np.int32))
            self._w.append(self.rng.integers(w[0], w[1] + 1, int(ok.sum())).astype(np.int32))
        self._agg = None

    @property
    def agg(self):
        if self._agg is None:
            pre = np.concatenate(self._pre).astype(np.int64)
            post = np.concatenate(self._post).astype(np.int64)
            w = np.concatenate(self._w).astype(np.int64)
            key = pre * self.N + post
            uk, inv = np.unique(key, return_inverse=True)
            ws = np.bincount(inv, weights=w).astype(np.int64)
            self._agg = Agg((uk // self.N).astype(np.int64), (uk % self.N).astype(np.int64), ws)
        return self._agg

    # ------------------------------------------------------------ escrita (formato FLYB do jogo)
    def export(self, tag, name, params):
        N = self.N
        chan_names, out_names, disp_names, disp_kind = [], [], [], []
        chan = np.full(N, -1, np.int32)
        out = np.full(N, -1, np.int32)
        disp = np.full(N, -1, np.int32)
        flags = np.zeros(N, np.int32)
        sign = np.zeros(N, np.int32)
        is_kc = np.zeros(N, bool)
        is_mbon = np.zeros(N, bool)
        is_dan = np.zeros(N, bool)
        for nm, (a0, n) in self.pops.items():
            m = self.meta[nm]
            if m["disp"] not in disp_names:
                disp_names.append(m["disp"])
                disp_kind.append(m["kind"])
            sl = slice(a0, a0 + n)
            disp[sl] = disp_names.index(m["disp"])
            if m["chan"]:
                if m["chan"] not in chan_names:
                    chan_names.append(m["chan"])
                chan[sl] = chan_names.index(m["chan"])
            if m["out"]:
                if m["out"] not in out_names:
                    out_names.append(m["out"])
                out[sl] = out_names.index(m["out"])
            flags[sl] = (1 if m["kc"] else 0) | (2 if m["mbon"] else 0) | (4 if m["dan"] else 0) | (8 if m["pun"] else 0)
            sign[sl] = m["sign"]
            is_kc[sl], is_mbon[sl], is_dan[sl] = m["kc"], m["mbon"], m["dan"]
        A = self.agg
        s = sign[A.pre] * A.w
        plastic = is_kc[A.pre] & is_mbon[A.post] & (s > 0)

        def csr(src, dst, val, dtype):
            order = np.argsort(src, kind="stable")
            off = np.zeros(N + 1, np.uint32)
            np.add.at(off, src + 1, 1)
            return np.cumsum(off).astype(np.uint32), dst[order].astype(np.uint32), val[order].astype(dtype)

        off, dst, ww = csr(A.pre[~plastic], A.post[~plastic], s[~plastic], np.int32)
        poff, pdst, pw = csr(A.pre[plastic], A.post[plastic], s[plastic].astype(np.float32), np.float32)
        md = is_dan[A.pre] & is_mbon[A.post]
        moff, mdan, mw = csr(A.post[md], A.pre[md], A.w[md].astype(np.float32), np.float32)
        E, P, M = len(dst), len(pdst), len(mdan)
        # linhas do raster: amostra estratificada por grupo de exibicao
        rng = np.random.default_rng(3)
        rows = np.full(N, -1, np.int32)
        row = 0
        for g in range(len(disp_names)):
            members = np.where(disp == g)[0]
            kk = min(len(members), max(8, int(700 * len(members) / N)))
            for i in np.sort(rng.choice(members, kk, replace=False)):
                rows[i] = row
                row += 1
        buf = io.BytesIO()
        buf.write(b"FLYB")
        buf.write(struct.pack("<6I", 1, N, E, P, M, row))
        for arr in (off, dst, ww, chan, out, disp, rows, flags, poff, pdst, pw, moff, mdan, mw):
            buf.write(np.ascontiguousarray(arr).tobytes())
        outdir = ROOT / "brain/full"
        outdir.mkdir(parents=True, exist_ok=True)
        with gzip.open(outdir / f"{tag}.bin.gz", "wb", compresslevel=9) as f:
            f.write(buf.getvalue())
        meta = {"name": name, "tag": tag, "neurons": N, "edges": E, "plastic": P, "mbon_dan": M, "raster_rows": row,
                "channels": chan_names, "outputs": out_names, "display": disp_names, "display_kind": disp_kind,
                "params": params, "min_syn": 1, "synapses": int(A.w.sum())}
        (outdir / f"{tag}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
        size = (outdir / f"{tag}.bin.gz").stat().st_size / 1e6
        print(f"{tag}: {N:,} neuronios, {E + P:,} conexoes ({P:,} plasticas), {int(A.w.sum()):,} sinapses, "
              f"{len(chan_names)} canais, {len(out_names)} saidas, {len(disp_names)} grupos -> {size:.1f} MB")
        return chan_names, sign


SECT = [(0.75, 1.0), (0.5, 0.75), (0.25, 0.5), (0.0, 0.25)]    # s0..s3 (olho esquerdo, de tras para a frente)


def retina_to_tectum(b, src, dst, K, w, overlap=0.08):
    """Setores 0-3 (olho esquerdo) -> teto direito; 4-7 (olho direito) -> teto
    esquerdo; a coordenada u do teto e a excentricidade (0 frente, 1 atras)."""
    for k in range(8):
        lo, hi = SECT[k] if k < 4 else SECT[7 - k]
        side = "R" if k < 4 else "L"
        b.conn(f"{src}_s{k}", f"{dst}_{side}", K, w, dst_range=(max(0, lo - overlap), min(1, hi + overlap)))


# ================================================================ RA ADULTA
def frog():
    b = Builder(23)
    S = True
    P, C, E = b.pop, b.conn, "both"
    # -------------------------------------------------- sentidos
    for k in range(8):
        P(f"ret_R2_s{k}", 700, "retina R2 (detectores de inseto)", 0, chan=f"presa_s{k}")
        P(f"ret_R34_s{k}", 500, "retina R3/R4 (escurecimento, ameaca)", 0, chan=f"sombra_s{k}")
    P("ret_R1", 1200, "retina R1 (bordas, luz)", 0, chan="luz_{s}", sided=S)
    P("ret_perto", 800, "retina: presa perto (binocular)", 0, chan="presa_perto")
    P("ret_fluxo", 600, "retina: movimento do campo (optocinetico)", 0, chan="fluxo_{s}", sided=S)
    P("olf_epit", 3000, "epitelio olfativo", 0, chan="olfato_{s}", sided=S)
    P("vomeronasal", 800, "orgao vomeronasal", 0, chan="vomeronasal", sided=S)
    P("gust_bom", 500, "paladar (bom)", 0, chan="paladar_bom")
    P("gust_ruim", 500, "paladar (amargo)", 0, chan="paladar_ruim")
    P("papila_anf", 800, "ouvido: papila anfibia (graves)", 0, chan="som_{s}", sided=S)
    P("papila_bas", 300, "ouvido: papila basilar (agudos)", 0, chan="som_{s}", sided=S)
    P("canais", 400, "vestibular: canais semicirculares", 0, chan="equilibrio", sided=S)
    P("utriculo", 200, "vestibular: utriculo (gravidade)", 0, chan="equilibrio", sided=S)
    P("saculo", 400, "saculo (vibracao do chao)", 0, chan="vibracao", sided=S)
    P("tato_cabeca", 600, "trigemeo (tato na cabeca)", 0, chan="tato_cabeca")
    P("tato_corpo", 1000, "pele: tato do corpo", 0, chan="tato")
    P("polegar", 300, "calos nupciais do polegar", 0, chan="polegar")
    P("irritante", 400, "pele: irritacao (reflexo de limpar)", 0, chan="irritante_{s}", sided=S)
    P("proprio", 800, "fusos musculares (propriocepcao)", 0, chan="proprio_{s}", sided=S)
    P("dor", 800, "nociceptores", 0, chan="dor", sided=S)
    P("termo", 300, "termorreceptores", 0, chan="temperatura")
    P("pele_seca", 300, "pele: ressecamento", 0, chan="pele_seca")
    P("quimio", 400, "quimiorreceptores (O2/CO2)", 0, chan="oxigenio_baixo")
    P("estiramento", 300, "receptores de estiramento (pulmao)", 0, chan="pulmao_cheio")
    P("baro", 200, "barorreceptores (pressao)", 0, chan="pressao")
    P("estomago", 300, "estiramento do estomago", 0, chan="estomago_cheio")
    P("pineal", 400, "glandula pineal (luz do dia)", 0, chan="luz_pineal")
    P("fome", 800, "hipotalamo: fome (NPY/AgRP)", 1, chan="fome")
    P("glicose", 500, "hipotalamo: glicose (saciedade)", 1, chan="glicose")
    P("explore", 1000, "mesencefalo: regiao locomotora (inicio)", 1, chan="explore_{s}", sided=S)
    # -------------------------------------------------- teto, pre-teto, isthmi
    P("T52", 5000, "teto optico T5.2 (presa)", sided=S)
    P("T51", 2000, "teto optico T5.1 (movimento)", sided=S)
    P("T53", 1500, "teto optico T5.3 (direcao)", sided=S)
    P("T6", 2000, "teto optico T6 (objetos grandes)", sided=S)
    P("T14", 3000, "teto optico camadas T1-T4", sided=S)
    P("teto_inh", 3000, "teto: interneuronios GABA", sign=-1, sided=S)
    P("T52_front", 1000, "teto frontal (presa binocular)")
    P("front_inh", 300, "teto frontal: inibicao", sign=-1)
    P("TH3", 2000, "pre-teto TH3 (ameaca)", sided=S)
    P("pret_inh", 1500, "pre-teto: inibicao do teto", sign=-1, sided=S)
    P("lentiforme", 500, "pre-teto: lentiforme (optocinetico)", sided=S)
    P("nBOR", 300, "nucleo da raiz optica basal")
    P("isthmi", 1200, "nucleo isthmi (atencao)", sided=S)
    # -------------------------------------------------- talamo
    P("tal_ant", 800, "talamo anterior", sided=S)
    P("tal_cent", 900, "talamo central (audicao)", sided=S)
    P("tal_post", 700, "talamo posterior", sided=S)
    P("tal_lat", 1000, "talamo lateral (visao)", sided=S)
    # -------------------------------------------------- audicao, equilibrio
    P("dmn", 900, "nucleo dorsal do bulbo (audicao)", sided=S)
    P("oliva_sup", 600, "oliva superior", sided=S)
    P("toro", 2000, "toro semicircular (audicao)", sided=S)
    P("vest_nuc", 900, "nucleos vestibulares", sided=S)
    P("vestspin", 400, "vestibuloespinhais (endireitar)", sided=S)
    # -------------------------------------------------- cerebelo
    P("cb_gran", 25000, "cerebelo: granulos")
    P("cb_golgi", 600, "cerebelo: Golgi", sign=-1)
    P("cb_purk", 1200, "cerebelo: Purkinje", sign=-1)
    P("cb_eury", 400, "cerebelo: euridendroides (saida)")
    P("oliva_inf", 400, "oliva inferior (fibras trepadeiras)")
    # -------------------------------------------------- telencefalo
    P("pal_med", 4000, "palio medial (hipocampo: lugares)", sided=S)
    P("pal_dor", 2500, "palio dorsal (codigo esparso)", kc=True, sided=S)
    P("pal_lat", 2500, "palio lateral (olfato, codigo esparso)", kc=True, sided=S)
    P("pal_inh", 1500, "palio: interneuronios", sign=-1, sided=S)
    P("str_ap", 800, "estriado (aproximar)", mbon=True)
    P("str_ev", 800, "estriado (evitar)", mbon=True)
    P("accumbens", 800, "nucleo accumbens", sided=S)
    P("septo", 800, "septo", sided=S)
    P("amig_med", 800, "amigdala medial", sided=S)
    P("amig_lat", 800, "amigdala lateral", sided=S)
    P("amig_cent", 500, "amigdala central (medo)", sided=S)
    P("poa", 1500, "area preoptica (canto, sexo)")
    # -------------------------------------------------- olfato
    P("mitral", 1800, "bulbo olfativo: mitrais", sided=S)
    P("ob_gran", 2200, "bulbo olfativo: granulos", sign=-1, sided=S)
    P("aob", 500, "bulbo olfativo acessorio", sided=S)
    # -------------------------------------------------- hipotalamo e hormonios
    P("hip_npy", 600, "hipotalamo: fome (NPY)")
    P("hip_sac", 500, "hipotalamo: saciedade", sign=-1)
    P("vmh", 500, "hipotalamo ventromedial (defesa)")
    P("scn", 400, "nucleo supraquiasmatico (relogio)")
    P("pvn_crh", 400, "PVN: CRH (estresse)", 2, out="cort")
    P("avt", 300, "vasotocina (canto, agua)", 2, out="avt")
    P("gnrh", 250, "GnRH (reproducao)", 2, out="gnrh")
    P("trh", 200, "TRH (tireoide)", 2, out="tsh")
    P("msh", 200, "POMC/MSH (cor da pele)", 2, out="escurecer")
    P("hip_termo", 300, "hipotalamo: temperatura")
    P("sede", 300, "hipotalamo: sede", 2, out="sede")
    P("melat", 200, "pineal: melatonina", 2, out="melatonina")
    P("da_rec", 600, "dopamina (tuberculo posterior): recompensa", 2, chan="reward", out="reward_da", dan=True)
    P("da_pun", 600, "dopamina (tuberculo posterior): punicao", 2, chan="punish", out="punish_da", dan=True, pun=True)
    # -------------------------------------------------- mesencefalo
    P("tegmento", 800, "tegmento", sided=S)
    P("pag", 800, "cinzenta periaquedutal (defesa, voz)")
    P("oculomotor", 300, "oculomotor", 2, out="olhos")
    P("lc", 400, "locus coeruleus (noradrenalina)", 2, out="octopamine")
    P("rafe", 600, "rafe (serotonina)", 2, out="serotonin")
    # -------------------------------------------------- rombencefalo
    P("mlr", 1000, "reticular: inicio da locomocao", sided=S)
    P("orient", 1600, "reticular: mapa de orientacao", 2, out="orient_{s}", sided=S)
    P("aprox", 1200, "reticular: aproximacao", 2, out="approach")
    P("fuga", 1200, "reticular: fuga", 2, out="escape_{s}", sided=S)
    P("fuga_inh", 500, "reticular: fuga (inibicao)", sign=-1)
    P("rs", 2000, "reticuloespinhais", sided=S)
    P("hipoglosso", 400, "hipoglosso: protrator da lingua", 2, out="snap")
    P("hipo_ret", 300, "hipoglosso: retrator da lingua", 2, out="retrair_lingua")
    P("boca_abre", 300, "trigemeo motor: abrir a boca", 2, out="boca_abrir")
    P("boca_fecha", 300, "trigemeo motor: fechar a boca", 2, out="boca_fechar")
    P("retrator", 250, "retrator do bulbo (engolir)", 2, out="engolir")
    P("nictitante", 150, "membrana nictitante (piscar)", 2, out="piscar")
    P("dtam", 1200, "gerador vocal (DTAM): canto de anuncio", 2, out="call")
    P("pretrig", 600, "nucleo pre-trigeminal (voz)")
    P("vocal_inh", 300, "gerador vocal: inibicao", sign=-1)
    P("soltura", 200, "gerador vocal: canto de soltura", 2, out="canto_soltura")
    P("socorro", 200, "gerador vocal: grito de socorro", 2, out="grito")
    P("bucal", 800, "gerador respiratorio bucal", 2, out="respirar")
    P("pulmonar", 400, "gerador respiratorio pulmonar", 2, out="ventilar_pulmao")
    P("resp_inh", 300, "gerador respiratorio: inibicao", sign=-1)
    P("inflar", 200, "inflar o corpo (defesa)", 2, out="inflar")
    P("vago", 300, "coracao: vago", 2, out="coracao_freia")
    P("simpatico", 300, "coracao: simpatico", 2, out="coracao_acelera")
    P("nts", 1500, "nucleo do trato solitario")
    # -------------------------------------------------- medula (juntas: ver frog_spinal)
    P("limpar", 500, "medula: reflexo de limpar", 2, out="limpar_{s}", sided=S)
    P("abraco", 250, "medula: abraco do amplexo", 2, out="abraco_{s}", sided=S)
    frog_spinal(b)
    P("glandulas", 200, "glandulas da pele (secrecao)", 2, out="secrecao")

    # ================================================== LIGACOES
    # ---- visao: retina -> teto do lado oposto, retinotopica
    retina_to_tectum(b, "ret_R2", "T52", 24, (1, 3))
    retina_to_tectum(b, "ret_R2", "T51", 16, (1, 2))
    retina_to_tectum(b, "ret_R34", "T6", 18, (1, 3))
    retina_to_tectum(b, "ret_R34", "T14", 8, (1, 2))
    for k in range(8):
        side = "R" if k < 4 else "L"
        C(f"ret_R34_s{k}", f"TH3_{side}", 10, (1, 3))
        C(f"ret_R2_s{k}", f"T14_{side}", 3, (1, 2))
        if k in (3, 4):   # setores frontais: faixa binocular
            C(f"ret_R2_s{k}", "T52_front", 6, (1, 2))
    C("ret_R1", "T14", 10, (1, 2), "contra")
    C("ret_R1", "tal_lat", 8, (1, 2), "contra")
    C("ret_R1", "isthmi", 3, (1, 2), "contra")
    C("ret_R1", "scn", 2, (1, 2))
    C("ret_fluxo", "lentiforme", 20, (1, 3), "contra")
    C("ret_fluxo", "nBOR", 6, (1, 2))
    # teto: interneuronios, isthmi (topografico, reciproco), camadas
    C("T52", "teto_inh", 8, (1, 2), topo=("perto", 0.1))
    C("teto_inh", "T52", 10, (1, 2), topo=("perto", 0.25))
    C("T51", "T52", 6, (1, 2), topo=("perto", 0.05))
    C("T14", "T52", 4, (1, 2), topo=("perto", 0.05))
    C("T14", "T6", 4, (1, 2), topo=("perto", 0.05))
    C("T52", "T53", 10, (1, 2), topo=("perto", 0.05))
    C("T52", "isthmi", 10, (1, 2), topo=("perto", 0.05))
    C("isthmi", "T52", 6, (1, 2), topo=("perto", 0.05))
    C("isthmi", "T52", 2, (1, 2), "contra", topo=("perto", 0.08))
    C("T6", "TH3", 4, (1, 2))
    C("TH3", "pret_inh", 20, (1, 3))
    C("pret_inh", "T52", 30, (2, 4))     # ameaca grande suprime a caca (Ewert)
    C("pret_inh", "T52_front", 25, (2, 4), E)
    C("lentiforme", "orient", 6, (1, 2), "ipsi")     # optocinetico: acompanha o giro do mundo
    C("nBOR", "oculomotor", 10, (1, 2))
    C("lentiforme", "oculomotor", 4, (1, 2))
    # teto -> mapa motor de orientacao: presa a esquerda -> teto direito ->
    # vira para a esquerda; quanto mais lateral, mais neuronios, giro maior
    C("T52", "orient", 30, (1, 3), "contra", topo=("acima", 0.12))
    C("T53", "orient", 10, (1, 2), "contra", topo=("acima", 0.12))
    C("T52", "aprox", 15, (1, 2), E, src_range=(0.0, 0.5))
    C("T52", "T52_front", 6, (1, 2), E, src_range=(0.0, 0.18))
    C("T52", "tal_lat", 3, (1, 2))
    C("T52", "hipoglosso", 1, (1, 2), E, src_range=(0.0, 0.2))
    # presa perto e centrada: teto frontal -> hipoglosso (lingua), boca
    C("ret_perto", "T52_front", 40, (1, 3))
    C("T52_front", "hipoglosso", 20, (2, 3))
    C("T52_front", "boca_abre", 12, (1, 3))
    C("T52_front", "front_inh", 30, (1, 2))
    C("front_inh", "aprox", 24, (2, 4))     # perto: para de se aproximar, ataca
    # ---- fome e saciedade
    C("fome", "hip_npy", 40, (1, 3))
    C("hip_npy", "T52", 3, (1, 2), E)
    C("hip_npy", "T52_front", 4, (1, 2))
    C("hip_npy", "aprox", 10, (1, 2))
    C("hip_npy", "hipoglosso", 8, (1, 2))
    C("hip_npy", "mlr", 3, (1, 2), E)
    C("glicose", "hip_sac", 40, (1, 3))
    C("estomago", "hip_sac", 20, (1, 3))
    C("hip_sac", "hip_npy", 50, (2, 4))
    C("hip_sac", "hipoglosso", 18, (1, 2))
    C("hip_sac", "T52_front", 15, (1, 2))
    C("glicose", "rafe", 30, (1, 2))
    # ---- aproximacao, fuga e locomocao
    C("aprox", "rs", 10, (1, 3), E)
    C("aprox", "salto", 12, (2, 4), E)
    C("TH3", "fuga", 36, (1, 3), "contra")
    C("T6", "fuga", 20, (1, 2), "ipsi")
    C("dor", "fuga", 16, (1, 3), E)
    C("tato_corpo", "fuga", 12, (1, 2), E)
    C("saculo", "fuga", 6, (1, 2), "contra")     # vibracao forte no chao: foge
    C("fuga", "salto", 30, (2, 4), E)
    C("fuga", "rs", 16, (1, 3), "ipsi")
    C("fuga", "amig_cent", 6, (1, 2), E)
    C("fuga", "fuga_inh", 12, (1, 2), E)
    C("fuga_inh", "hipoglosso", 150, (2, 4))
    C("fuga_inh", "aprox", 150, (2, 4))
    C("fuga_inh", "dtam", 60, (2, 4))
    C("vmh", "fuga", 6, (1, 2), E)
    C("amig_cent", "fuga", 6, (1, 2), E)
    C("explore", "mlr", 30, (2, 3), "ipsi")
    C("mlr", "rs", 20, (2, 3), "ipsi")
    C("mlr", "salto", 8, (2, 3), "ipsi")
    C("mlr", "passo", 10, (1, 3), "ipsi")
    C("explore", "orient", 12, (1, 3), "ipsi")
    C("rs", "salto", 6, (1, 3), "ipsi")
    C("rs", "passo", 4, (1, 2), "ipsi")
    C("vest_nuc", "vestspin", 20, (1, 3))
    C("vestspin", "recolher", 4, (1, 2))
    C("vestspin", "apoio", 8, (1, 2))
    C("canais", "vest_nuc", 25, (1, 3))
    C("utriculo", "vest_nuc", 15, (1, 3))
    C("saculo", "vest_nuc", 8, (1, 2))
    C("vest_nuc", "orient", 2, (1, 2), E)
    C("vest_nuc", "oculomotor", 6, (1, 2), E)
    # ---- reflexos dos bracos (premotores; as juntas estao em frog_spinal)
    C("irritante", "limpar", 30, (1, 3), "ipsi")
    C("tato_cabeca", "limpar", 6, (1, 2), E)
    C("gust_ruim", "limpar", 20, (1, 3), E)     # engoliu algo ruim: limpa a boca com as maos
    C("polegar", "abraco", 36, (2, 4))
    C("gnrh", "abraco", 8, (1, 2))
    C("proprio", "cb_gran", 1, (1, 2))
    # ---- lingua, boca e engolir
    C("hipoglosso", "boca_abre", 16, (1, 3))
    C("hipoglosso", "hipo_ret", 6, (1, 2))
    C("gust_bom", "retrator", 24, (1, 3))
    C("gust_bom", "boca_fecha", 16, (1, 3))
    C("estomago", "retrator", 6, (1, 2))
    C("gust_ruim", "boca_abre", 12, (1, 2))
    C("dor", "nictitante", 6, (1, 2), E)
    C("tato_cabeca", "nictitante", 18, (1, 3))
    C("TH3", "nictitante", 4, (1, 2))
    # ---- gosto -> NTS -> dopamina e palio
    C("gust_bom", "nts", 16, (1, 3))
    C("gust_ruim", "nts", 16, (1, 3))
    C("estomago", "nts", 10, (1, 2))
    C("estiramento", "nts", 10, (1, 2))
    C("baro", "nts", 10, (1, 2))
    C("gust_bom", "da_rec", 60, (1, 3))
    C("gust_ruim", "da_pun", 60, (1, 3))
    C("dor", "da_pun", 16, (1, 3))
    C("nts", "hip_sac", 4, (1, 2))
    # ---- olfato
    C("olf_epit", "mitral", 30, (2, 3), "ipsi")
    C("mitral", "ob_gran", 10, (1, 2), "ipsi")
    C("ob_gran", "mitral", 12, (1, 2), "ipsi")
    C("vomeronasal", "aob", 30, (2, 3), "ipsi")
    C("mitral", "pal_lat", 8, (1, 2), "ipsi")
    C("mitral", "amig_lat", 6, (1, 2), "ipsi")
    C("aob", "amig_med", 16, (1, 3), "ipsi")
    C("aob", "poa", 4, (1, 2))
    C("mitral", "aprox", 1, (1, 2))
    # ---- palio: codigo esparso (visao + cheiro + gosto) -> estriado plastico
    C("tal_lat", "pal_dor", 6, (1, 2), "ipsi")
    C("tal_ant", "pal_med", 8, (1, 2), "ipsi")
    C("tal_post", "pal_dor", 3, (1, 2), "ipsi")
    C("T52", "tal_ant", 4, (1, 2))
    C("nts", "pal_dor", 2, (1, 2), E)
    C("pal_dor", "pal_inh", 8, (1, 2), "ipsi")
    C("pal_lat", "pal_inh", 8, (1, 2), "ipsi")
    C("pal_inh", "pal_dor", 12, (1, 2), "ipsi")
    C("pal_inh", "pal_lat", 12, (1, 2), "ipsi")
    C("pal_dor", "str_ap", 60, (1, 2))
    C("pal_lat", "str_ap", 40, (1, 2))
    C("pal_dor", "str_ev", 60, (1, 2))
    C("pal_lat", "str_ev", 40, (1, 2))
    C("da_pun", "str_ap", 150, (2, 4))
    C("da_rec", "str_ev", 150, (2, 4))
    C("str_ap", "hipoglosso", 6, (1, 2))
    C("str_ap", "aprox", 6, (1, 2))
    C("str_ap", "accumbens", 4, (1, 2))
    C("str_ev", "pret_inh", 6, (1, 3), E)
    C("str_ev", "amig_cent", 6, (1, 2), E)
    C("accumbens", "mlr", 4, (1, 2), "ipsi")
    C("da_rec", "accumbens", 6, (1, 2))
    # ---- hipocampo: lugares e caminhos (palio medial)
    C("pal_med", "pal_med", 10, (1, 2), "ipsi", topo=("perto", 0.05))
    C("pal_med", "septo", 8, (1, 2), "ipsi")
    C("septo", "pal_med", 4, (1, 2), "ipsi")
    C("pal_med", "accumbens", 4, (1, 2), "ipsi")
    C("pal_med", "pal_inh", 3, (1, 2), "ipsi")
    C("vest_nuc", "tal_ant", 4, (1, 2), "ipsi")
    C("ret_R1", "pal_med", 1, (1, 2))
    # ---- audicao -> toro -> talamo -> preoptico (reconhecer o canto)
    C("papila_anf", "dmn", 30, (1, 3), "ipsi")
    C("papila_bas", "dmn", 20, (1, 3), "ipsi")
    C("dmn", "oliva_sup", 12, (1, 2), E)
    C("dmn", "toro", 10, (1, 3), "contra")
    C("oliva_sup", "toro", 10, (1, 2), "ipsi")
    C("toro", "tal_cent", 12, (1, 2), "ipsi")
    C("toro", "orient", 8, (1, 3), "contra")    # fonotaxia: vira para o canto (o DMN ja cruzou)
    C("tal_cent", "poa", 8, (1, 2))
    C("tal_cent", "amig_lat", 4, (1, 2), "ipsi")
    C("toro", "pretrig", 3, (1, 2))
    # ---- canto: preoptico + vasotocina + GnRH -> DTAM; o socorro e a soltura
    C("poa", "dtam", 12, (1, 3))
    C("avt", "dtam", 16, (1, 3))
    C("gnrh", "poa", 12, (1, 2))
    C("explore", "dtam", 1, (1, 2), E)
    C("dtam", "pretrig", 12, (1, 2))
    C("pretrig", "dtam", 8, (1, 2))
    C("dtam", "bucal", 3, (1, 2))                # canta com o ar dos pulmoes
    C("amig_cent", "vocal_inh", 10, (1, 3), E)
    C("vocal_inh", "dtam", 60, (2, 4))
    C("hip_npy", "vocal_inh", 2, (1, 2))
    C("tato_corpo", "soltura", 20, (1, 3))       # agarrado por outro macho: canto de soltura
    C("dor", "socorro", 20, (1, 3), E)
    C("tato_corpo", "socorro", 8, (1, 2))
    C("pag", "socorro", 10, (1, 3))
    C("dor", "pag", 8, (1, 2), E)
    C("amig_cent", "pag", 6, (1, 2), E)
    # ---- defesa: inflar o corpo e secrecao da pele
    C("TH3", "inflar", 6, (1, 2), E)
    C("tato_corpo", "inflar", 6, (1, 2))
    C("pag", "inflar", 8, (1, 2))
    C("dor", "glandulas", 20, (1, 3), E)
    C("pag", "glandulas", 6, (1, 2))
    # ---- hormonios e relogio
    C("pineal", "scn", 20, (1, 3))
    P("pineal_escuro", 150, "pineal: escuro (fotorreceptores desligam)", 0, chan="escuro_pineal")
    C("pineal_escuro", "melat", 30, (1, 3))
    P("melat_inh", 150, "pineal: luz inibe a melatonina", sign=-1)
    C("pineal", "melat_inh", 30, (1, 3))
    C("melat_inh", "melat", 60, (2, 4))
    # estacao de reproducao (hormonios sexuais, dados pelo corpo) -> GnRH, preoptico
    P("esteroides", 300, "hormonios sexuais (testosterona/estradiol)", 0, chan="reproducao")
    C("esteroides", "gnrh", 30, (1, 3))
    C("esteroides", "poa", 16, (1, 3))
    C("esteroides", "avt", 10, (1, 2))
    C("melat", "poa", 0, (1, 1))
    C("dor", "pvn_crh", 12, (1, 3), E)
    C("amig_cent", "pvn_crh", 8, (1, 2), E)
    C("pele_seca", "pvn_crh", 6, (1, 2))
    C("quimio", "pvn_crh", 4, (1, 2))
    C("pele_seca", "sede", 40, (1, 3))
    C("pele_seca", "avt", 10, (1, 2))
    C("sede", "mlr", 4, (1, 2), E)
    C("poa", "avt", 6, (1, 2))
    C("scn", "gnrh", 2, (1, 2))
    C("aob", "gnrh", 4, (1, 2))
    C("termo", "hip_termo", 30, (1, 3))
    C("hip_termo", "trh", 10, (1, 2))
    C("hip_termo", "msh", 6, (1, 2))
    C("ret_R1", "msh", 1, (1, 2))
    C("hip_termo", "mlr", 2, (1, 2), E)
    C("termo", "mlr", 1, (1, 2), E)
    # ---- cerebelo: coordena o salto e a lingua
    C("mlr", "cb_gran", 1, (1, 2))
    C("vest_nuc", "cb_gran", 1, (1, 2))
    C("T52", "cb_gran", 0.3, (1, 2))
    C("cb_gran", "cb_golgi", 30, (1, 2))
    C("cb_golgi", "cb_gran", 3, (1, 2))
    C("cb_gran", "cb_purk", 400, (1, 1))
    C("oliva_inf", "cb_purk", 1, (6, 8))
    C("dor", "oliva_inf", 6, (1, 2), E)
    C("proprio", "oliva_inf", 4, (1, 2), E)
    C("cb_purk", "cb_eury", 30, (2, 4))
    C("mlr", "cb_eury", 6, (1, 2))
    C("cb_eury", "rs", 3, (1, 2), E)
    C("cb_eury", "vest_nuc", 4, (1, 2), E)
    C("cb_eury", "hipoglosso", 2, (1, 2))
    # ---- moduladores
    C("amig_cent", "lc", 8, (1, 2), E)
    C("dor", "lc", 10, (1, 3), E)
    C("lc", "fuga", 2, (1, 2), E)
    C("lc", "simpatico", 30, (2, 3))
    C("lc", "T52", 0.5, (1, 2), E)
    C("rafe", "hip_npy", 3, (1, 2))
    C("rafe", "salto", 1, (1, 2), E)
    C("amig_med", "vmh", 8, (1, 2), E)
    C("amig_lat", "amig_cent", 10, (1, 2), "ipsi")
    C("T6", "amig_lat", 2, (1, 2), "ipsi")
    # ---- respiracao: quimiorreceptores -> geradores bucal e pulmonar; pulmao cheio inibe
    C("quimio", "bucal", 30, (2, 4))
    C("quimio", "pulmonar", 30, (2, 4))
    C("explore", "bucal", 2, (1, 2), E)
    C("bucal", "pulmonar", 4, (1, 2))
    C("estiramento", "resp_inh", 36, (2, 4))
    C("resp_inh", "pulmonar", 30, (2, 4))
    C("resp_inh", "bucal", 12, (2, 4))
    C("fuga", "bucal", 2, (1, 2), E)
    C("inflar", "pulmonar", 20, (1, 3))
    # ---- coracao: simpatico acelera (medo, esforco, falta de ar), vago freia
    C("fuga", "simpatico", 3, (1, 2), E)
    C("quimio", "simpatico", 12, (1, 2))
    C("pvn_crh", "simpatico", 6, (1, 2))
    C("glicose", "vago", 10, (1, 2))
    C("estiramento", "vago", 10, (1, 2))
    C("baro", "vago", 20, (1, 3))
    return b


def frog_spinal(b):
    """Medula da ra: motoneuronios de cada junta (extensor e flexor) e os
    geradores que os coordenam. Pernas: 'salto' (sinergia extensora,
    proximal -> distal) e 'recolher' (flexores) sao dois meio-centros que se
    inibem (Ia) e se cansam (adaptacao): com comando continuo alternam (chute
    de nado, pulos seguidos), com um comando curto dao um pulo so. Na agua os
    comissurais excitatorios deixam os dois lados em sincronia (chute de ra);
    em terra, com pouco comando, o 'passo' alterna os lados (andar).
    Bracos: 'apoio' (sustenta a frente do corpo contra a gravidade), 'pouso'
    (no ar, bracos para a frente para receber o chao), bracos para tras na
    agua, 'limpar' e 'abraco'. (Giszter 1993; Kiehn 2006; Kamel 1996;
    Cox & Gillis 2015 - pouso sobre os bracos; Nauwelaerts 2005 - nado.)"""
    P, C, E = b.pop, b.conn, "both"
    S = True
    P("no_ar", 200, "vestibular: queda livre (no ar)", 0, chan="no_ar")
    P("imerso", 200, "pele/pressao: dentro d'agua", 0, chan="imerso")
    P("carga_maos", 200, "carga nas maos (apoio)", 0, chan="apoio_maos_{s}", sided=S)
    # premotores da perna
    P("salto", 900, "medula lombar: sinergia de salto/chute", sided=S)
    P("recolher", 700, "medula lombar: recolher (flexores)", sided=S)
    P("ia_ext", 300, "medula lombar: Ia do extensor", sign=-1, sided=S)
    P("ia_flex", 300, "medula lombar: Ia do flexor", sign=-1, sided=S)
    P("sincro", 300, "medula lombar: comissurais (sincronia)", sided=S)
    P("passo", 700, "medula lombar: passo", sided=S)
    P("alterna", 300, "medula lombar: comissurais (alternancia)", sign=-1, sided=S)
    P("renshaw", 300, "medula lombar: Renshaw", sign=-1, sided=S)
    # motoneuronios de cada junta da perna
    for j, nome, n_e, n_f in (("quadril", "quadril", 260, 200), ("joelho", "joelho", 260, 200),
                              ("tornozelo", "tornozelo", 240, 200), ("tarso", "tarso-metatarso", 160, 120)):
        P(f"mn_{j}_ext", n_e, f"motoneuronios: {nome} (extensores)", 2, out=f"{j}_ext_{{s}}", sided=S)
        P(f"mn_{j}_flex", n_f, f"motoneuronios: {nome} (flexores)", 2, out=f"{j}_flex_{{s}}", sided=S)
    P("mn_dedos", 120, "motoneuronios: abrir os dedos do pe", 2, out="dedos_abrir_{s}", sided=S)
    # premotores e motoneuronios do braco
    P("apoio", 400, "medula braquial: apoio (antigravidade)", sided=S)
    P("pouso", 300, "medula braquial: pouso (bracos a frente)", sided=S)
    P("braco_nado", 250, "medula braquial: bracos para tras (nado)", sided=S)
    P("br_inh", 300, "medula braquial: inibicao", sign=-1, sided=S)
    for j, nome, n in (("ombro_frente", "ombro (para a frente)", 160), ("ombro_tras", "ombro (para tras)", 160),
                       ("ombro_baixo", "ombro (empurra para baixo)", 160), ("ombro_cima", "ombro (levanta o braco)", 120), ("cotovelo_ext", "cotovelo (estende)", 160),
                       ("cotovelo_flex", "cotovelo (dobra)", 160), ("punho_ext", "punho (estende)", 90),
                       ("punho_flex", "punho (dobra)", 90), ("dedos_mao", "dedos da mao (fecha)", 70)):
        P(f"mn_{j}", n, f"motoneuronios: {nome}", 2, out=f"{j}_{{s}}", sided=S)
    # --- perna: meio-centros
    C("salto", "ia_ext", 14, (1, 3), "ipsi")
    C("ia_ext", "recolher", 30, (2, 4), "ipsi")
    C("recolher", "ia_flex", 14, (1, 3), "ipsi")
    C("ia_flex", "salto", 30, (2, 4), "ipsi")
    # o comando de locomocao liga os dois meio-centros: o que ganhar cansa e o outro assume (ritmo)
    C("mlr", "recolher", 10, (1, 3), "ipsi")
    C("imerso", "recolher", 6, (1, 3))
    C("rs", "recolher", 3, (1, 2), "ipsi")
    C("utriculo", "recolher", 14, (1, 3))                   # sentada: tonus flexor (pernas dobradas)
    C("no_ar", "recolher", 16, (1, 3))                      # no ar: recolhe as pernas para pousar
    C("no_ar", "salto", 0, (1, 1))
    C("proprio", "recolher", 3, (1, 2), "ipsi")             # perna esticada ao maximo -> recolhe
    # sincronia (salto e chute: as duas pernas juntas); na agua mais forte
    C("salto", "sincro", 10, (1, 3), "ipsi")
    C("sincro", "salto", 8, (1, 2), "contra")
    C("imerso", "sincro", 10, (1, 3))
    C("imerso", "salto", 4, (1, 2))
    C("imerso", "mn_dedos", 20, (1, 3))                     # na agua: dedos abertos (membrana)
    # passo: alternado, so em terra e com pouco comando
    C("passo", "alterna", 10, (1, 3), "ipsi")
    C("alterna", "passo", 20, (2, 4), "contra")
    C("salto", "passo", 0, (1, 1))
    P("passo_inh", 200, "medula lombar: salto inibe o passo", sign=-1, sided=S)
    C("salto", "passo_inh", 4, (1, 2), "ipsi")
    C("passo_inh", "passo", 30, (2, 4), "ipsi")
    C("imerso", "passo_inh", 20, (1, 3))
    C("no_ar", "passo_inh", 20, (1, 3))
    # sinergia de salto nas juntas (proximal forte, distal um pouco depois)
    C("salto", "mn_quadril_ext", 18, (2, 3), "ipsi")
    C("salto", "mn_joelho_ext", 16, (2, 3), "ipsi")
    C("salto", "mn_tornozelo_ext", 14, (2, 3), "ipsi")
    C("salto", "mn_tarso_ext", 12, (2, 3), "ipsi")
    C("salto", "mn_dedos", 4, (1, 2), "ipsi")
    C("mn_quadril_ext", "renshaw", 8, (1, 2), "ipsi")
    C("renshaw", "mn_quadril_ext", 6, (1, 2), "ipsi")
    C("renshaw", "mn_joelho_ext", 6, (1, 2), "ipsi")
    for j in ("quadril", "joelho", "tornozelo", "tarso"):
        C("recolher", f"mn_{j}_flex", 14, (2, 3), "ipsi")
        C("ia_ext", f"mn_{j}_flex", 10, (1, 3), "ipsi")
        C("ia_flex", f"mn_{j}_ext", 10, (1, 3), "ipsi")
    # passo: quadril e joelho, pouco
    C("passo", "mn_quadril_ext", 6, (1, 2), "ipsi")
    C("passo", "mn_joelho_ext", 4, (1, 2), "ipsi")
    C("alterna", "mn_quadril_flex", 0, (1, 1))
    C("passo", "mn_quadril_flex", 5, (1, 2), "contra")
    # --- bracos
    C("utriculo", "apoio", 20, (1, 3))                      # a gravidade liga o apoio
    C("carga_maos", "apoio", 16, (1, 3), "ipsi")
    C("apoio", "mn_ombro_baixo", 14, (2, 3), "ipsi")
    C("apoio", "mn_cotovelo_ext", 14, (2, 3), "ipsi")
    C("apoio", "mn_punho_ext", 10, (1, 3), "ipsi")
    C("no_ar", "pouso", 30, (2, 4))
    C("pouso", "mn_ombro_frente", 16, (2, 3), "ipsi")
    C("pouso", "mn_cotovelo_ext", 14, (2, 3), "ipsi")
    C("pouso", "mn_punho_ext", 10, (1, 3), "ipsi")
    C("imerso", "braco_nado", 30, (2, 4))
    C("braco_nado", "mn_ombro_tras", 16, (2, 3), "ipsi")
    C("braco_nado", "mn_cotovelo_flex", 10, (1, 3), "ipsi")
    C("limpar", "mn_ombro_frente", 14, (2, 3), "ipsi")
    C("limpar", "mn_cotovelo_flex", 18, (2, 3), "ipsi")
    C("limpar", "mn_ombro_cima", 18, (2, 3), "ipsi")
    C("mn_ombro_cima", "br_inh", 3, (1, 2), "ipsi")
    C("limpar", "mn_punho_flex", 12, (1, 3), "ipsi")
    C("abraco", "mn_ombro_frente", 10, (1, 3), "ipsi")
    C("abraco", "mn_cotovelo_flex", 20, (2, 3), "ipsi")
    C("abraco", "mn_dedos_mao", 20, (2, 3), "ipsi")
    C("passo", "mn_ombro_frente", 5, (1, 2), "contra")      # andar: braco do lado oposto vai a frente
    C("passo", "mn_ombro_tras", 5, (1, 2), "ipsi")
    # o que usa o braco desliga o apoio (e o apoio nao briga com o pouso)
    for src in ("no_ar", "imerso"):
        C(src, "br_inh", 20, (1, 3))
    C("limpar", "br_inh", 12, (1, 3), "ipsi")
    C("abraco", "br_inh", 12, (1, 3), "ipsi")
    C("br_inh", "apoio", 30, (2, 4), "ipsi")
    C("br_inh", "mn_ombro_baixo", 12, (1, 3), "ipsi")
    # ombro: frente x tras se inibem
    P("ombro_inh", 150, "medula braquial: frente x tras", sign=-1, sided=S)
    C("mn_ombro_frente", "ombro_inh", 6, (1, 2), "ipsi")
    C("ombro_inh", "mn_ombro_tras", 10, (1, 3), "ipsi")
    C("mn_cotovelo_flex", "br_inh", 2, (1, 2), "ipsi")


# ================================================================ GIRINO
def tadpole():
    b = Builder(11)
    S = True
    P, C, E = b.pop, b.conn, "both"
    # sentidos
    for k in range(8):
        P(f"ret_sombra_s{k}", 250, "retina (sombra/looming)", 0, chan=f"sombra_s{k}")
    P("ret_luz", 400, "retina (luz)", 0, chan="luz_{s}", sided=S)
    P("RB", 300, "Rohon-Beard (tato)", 0, chan="tato_{s}", sided=S)
    P("linha_lateral", 600, "linha lateral", 0, chan="linha_lateral_{s}", sided=S)
    P("pineal", 100, "pineal (escurecimento)", 0, chan="escuro_pineal")
    P("tato_cabeca", 400, "trigemeo (tato na cabeca)", 0, chan="tato_cabeca")
    P("olf", 1000, "epitelio olfativo", 0, chan="olfato_{s}", sided=S)
    P("gust_bom", 400, "paladar (bom)", 0, chan="paladar_bom")
    P("gust_ruim", 300, "paladar (amargo)", 0, chan="paladar_ruim")
    P("dor", 300, "nociceptores", 0, chan="dor")
    P("quimio", 200, "quimiorreceptores (O2/CO2)", 0, chan="oxigenio_baixo")
    P("estiramento", 150, "receptores de estiramento", 0, chan="pulmao_cheio")
    P("fome", 300, "hipotalamo: fome", 1, chan="fome")
    P("glicose", 200, "hipotalamo: glicose", 1, chan="glicose")
    P("explore", 400, "reticular (inicio)", 1, chan="explore_{s}", sided=S)
    # medula (Roberts): dlc, dla, dIN, cIN, aIN, MN, e o circuito de se debater
    P("dlc", 250, "medula: dlc (sensoriais cruzados)", sided=S)
    P("dla", 180, "medula: dla (sensoriais diretos)", sided=S)
    P("dIN", 900, "medula: dIN (ritmo)", sided=S)
    P("cIN", 800, "medula: cIN (inibicao cruzada)", sign=-1, sided=S)
    P("aIN", 500, "medula: aIN (inibicao)", sign=-1, sided=S)
    P("MN", 1200, "motoneuronios (cauda)", 2, out="swim_{s}", sided=S)
    P("debater", 300, "medula: circuito de se debater", 2, out="debater_{s}", sided=S)
    P("mauthner", 1, "celula de Mauthner (fuga)", 2, out="escape_{s}", sided=S)
    P("mid_fuga", 12, "celulas MiD2/MiD3 (fuga)", sided=S)
    P("hRS", 800, "reticuloespinhais", sided=S)
    P("MHR", 200, "MHR (parar)", sign=-1)
    P("cimento", 60, "glandula de cimento (encostou)", 0, chan="tato_cabeca")
    # cabeca
    P("teto", 3000, "teto optico", sided=S)
    P("teto_inh", 1200, "teto: interneuronios", sign=-1, sided=S)
    P("mitral", 400, "bulbo olfativo", sided=S)
    P("pal", 2500, "palio (codigo esparso)", kc=True)
    P("pal_inh", 250, "palio: interneuronios", sign=-1)
    P("str_ap", 250, "estriado (aproximar)", mbon=True)
    P("str_ev", 250, "estriado (evitar)", mbon=True)
    P("da_rec", 150, "dopamina (tuberculo posterior): recompensa", 2, chan="reward", out="reward_da", dan=True)
    P("da_pun", 150, "dopamina (tuberculo posterior): punicao", 2, chan="punish", out="punish_da", dan=True, pun=True)
    P("cb_gran", 2500, "cerebelo: granulos")
    P("cb_purk", 150, "cerebelo: Purkinje", sign=-1)
    P("vest_nuc", 300, "nucleos vestibulares", sided=S)
    P("boca", 600, "gerador da boca (raspar algas)", 2, out="feed")
    P("bucal", 400, "bomba bucal (branquias)", 2, out="respirar")
    P("resp_inh", 150, "bomba bucal: inibicao", sign=-1)
    P("nts", 400, "nucleo do trato solitario")
    P("simpatico", 100, "coracao: simpatico", 2, out="coracao_acelera")
    P("vago", 100, "coracao: vago", 2, out="coracao_freia")
    P("rafe", 150, "rafe (serotonina)", 2, out="serotonin")
    P("lc", 120, "locus coeruleus (noradrenalina)", 2, out="octopamine")
    P("hip_npy", 250, "hipotalamo: fome (NPY)")
    P("hip_sac", 200, "hipotalamo: saciedade", sign=-1)
    P("trh", 150, "TRH -> tireoide (metamorfose)", 2, out="tsh")
    P("pvn_crh", 150, "PVN: CRH (estresse)", 2, out="cort")
    P("msh", 100, "POMC/MSH (cor)", 2, out="escurecer")
    # ---- medula (Roberts et al.): ritmo por dIN recorrentes, alternancia por cIN
    C("RB", "dlc", 18, (2, 4), "ipsi")
    C("RB", "dla", 18, (2, 4), "ipsi")
    C("dlc", "dIN", 10, (1, 3), "contra")
    C("dla", "dIN", 6, (1, 3), "ipsi")
    C("dIN", "dIN", 12, (1, 2), "ipsi", topo=("perto", 0.08))
    C("dIN", "MN", 20, (2, 3), "ipsi", topo=("perto", 0.08))
    C("dIN", "cIN", 15, (1, 3), "ipsi", topo=("perto", 0.08))
    C("dIN", "aIN", 15, (1, 3), "ipsi", topo=("perto", 0.08))
    C("cIN", "dIN", 15, (1, 3), "contra", topo=("perto", 0.1))
    C("cIN", "MN", 15, (1, 3), "contra", topo=("perto", 0.1))
    C("cIN", "cIN", 7, (1, 2), "contra")
    C("aIN", "dIN", 6, (1, 2), "ipsi")
    C("aIN", "dla", 7, (1, 2), "ipsi")
    C("hRS", "dIN", 24, (2, 3), "ipsi")
    C("explore", "hRS", 16, (2, 3), "ipsi")
    C("MHR", "dIN", 12, (2, 4), E)
    C("MHR", "hRS", 12, (2, 4), E)
    C("pineal", "hRS", 12, (2, 4), E)
    C("tato_cabeca", "MHR", 18, (2, 4))
    C("cimento", "MHR", 12, (2, 4))
    # debater-se quando e segurado: RB forte + dor -> ritmo lento e forte
    C("RB", "debater", 10, (1, 3), E)
    C("dor", "debater", 14, (1, 3), E)
    C("debater", "MN", 6, (2, 3), "ipsi")
    C("debater", "cIN", 4, (1, 2), "ipsi")
    # fuga: Mauthner (linha lateral / sombra / toque forte) -> MN do lado oposto
    C("linha_lateral", "mauthner", 90, (2, 4), "ipsi")
    C("linha_lateral", "mid_fuga", 60, (1, 3), "ipsi")
    for k in range(8):
        side = "L" if k >= 4 else "R"      # sombra de um lado -> Mauthner do lado oposto
        C(f"ret_sombra_s{k}", f"mauthner_{side}", 12, (1, 3))
        C(f"ret_sombra_s{k}", f"hRS_{side}", 2, (1, 2))
    C("RB", "mauthner", 30, (1, 2), "ipsi")
    C("mauthner", "MN", 1, (14, 18), "contra")
    C("mauthner", "cIN", 1, (9, 12), "contra")
    C("mid_fuga", "MN", 2, (2, 4), "contra")
    C("linha_lateral", "hRS", 3, (1, 2), "contra")
    # visao: retina -> teto retinotopico
    retina_to_tectum(b, "ret_sombra", "teto", 16, (1, 3))
    C("ret_luz", "teto", 8, (1, 2), "contra")
    C("teto", "teto_inh", 8, (1, 2), topo=("perto", 0.1))
    C("teto_inh", "teto", 10, (1, 2), topo=("perto", 0.2))
    C("teto", "hRS", 12, (1, 3), "contra", topo=("acima", 0.15))
    C("teto", "pal", 1, (1, 2), E)
    # olfato/paladar -> palio (esparso) -> estriado (plastico)
    C("olf", "mitral", 30, (2, 3), "ipsi")
    C("mitral", "pal", 8, (1, 2), E)
    C("gust_bom", "pal", 3, (1, 2))
    C("pal", "pal_inh", 20, (1, 2))
    C("pal_inh", "pal", 12, (1, 2))
    C("pal", "str_ap", 120, (1, 2))
    C("pal", "str_ev", 120, (1, 2))
    C("da_pun", "str_ap", 70, (2, 4))
    C("da_rec", "str_ev", 70, (2, 4))
    C("gust_bom", "da_rec", 60, (1, 3))
    C("gust_ruim", "da_pun", 50, (1, 3))
    C("dor", "da_pun", 16, (1, 3))
    C("str_ap", "hRS", 6, (1, 2), E)
    C("str_ap", "boca", 10, (1, 2))
    C("str_ev", "MHR", 10, (1, 2))
    C("str_ev", "hRS", 4, (1, 2), E)
    C("mitral", "hRS", 4, (1, 2), "ipsi")
    # alimentacao
    C("gust_bom", "boca", 60, (1, 3))
    C("fome", "hip_npy", 30, (1, 3))
    C("hip_npy", "boca", 20, (1, 2))
    C("hip_npy", "hRS", 6, (1, 2), E)
    C("glicose", "hip_sac", 40, (1, 3))
    C("hip_sac", "boca", 30, (1, 3))
    C("hip_sac", "hip_npy", 30, (1, 3))
    C("gust_ruim", "MHR", 20, (1, 3))
    C("gust_bom", "nts", 20, (1, 3))
    C("gust_ruim", "nts", 20, (1, 3))
    # cerebelo e vestibular: equilibrio no nado
    C("vest_nuc", "cb_gran", 2, (1, 2))
    C("hRS", "cb_gran", 1, (1, 2))
    C("cb_gran", "cb_purk", 200, (1, 1))
    C("cb_purk", "vest_nuc", 10, (1, 2), E)
    C("vest_nuc", "hRS", 3, (1, 2), "ipsi")
    # respiracao (bomba bucal pelas branquias) e coracao
    C("quimio", "bucal", 40, (2, 4))
    C("explore", "bucal", 3, (1, 2), E)
    C("estiramento", "resp_inh", 40, (2, 4))
    C("resp_inh", "bucal", 30, (2, 4))
    C("lc", "simpatico", 40, (2, 3))
    C("quimio", "simpatico", 6, (1, 2))
    C("dor", "simpatico", 16, (1, 2))
    C("glicose", "vago", 8, (1, 2))
    C("estiramento", "vago", 4, (1, 2))
    # hormonios: TRH -> tireoide (o girino so vira ra com hormonio tireoidiano)
    C("glicose", "trh", 12, (1, 2))
    C("hip_npy", "trh", 0, (1, 1))
    C("dor", "pvn_crh", 12, (1, 3))
    C("pvn_crh", "trh", 4, (1, 2))    # estresse acelera a metamorfose (Denver)
    C("ret_luz", "msh", 2, (1, 2))
    # moduladores
    C("dor", "lc", 20, (1, 3))
    C("linha_lateral", "lc", 3, (1, 2))
    C("lc", "hRS", 2, (1, 2), E)
    C("glicose", "rafe", 30, (1, 2))
    return b


# ================================================================ teste (campo medio, igual ao shader)
def simulate(b, chan_names, sign, w_syn, inputs, steps=60, dt=20.0, trace=None):
    """inputs: dict fixo ou funcao passo -> dict. trace: populacoes para gravar a cada passo."""
    N = b.N
    A = b.agg
    pre, post = A.pre, A.post
    w = sign[pre] * A.w.astype(float)
    chan = np.full(N, -1)
    for nm, (a0, n) in b.pops.items():
        c = b.meta[nm]["chan"]
        if c:
            chan[a0:a0 + n] = chan_names.index(c)
    def drive(inp):
        ir = np.zeros(N)
        for c, v in inp.items():
            if c in chan_names:
                ir[chan == chan_names.index(c)] = v
        return ir
    ir = drive(inputs) if not callable(inputs) else None
    rows = []
    r = np.zeros(N)
    ad = np.zeros(N)
    dep = np.ones(N)
    th = 7.0

    def lif(x):
        xe = th + 0.8 * np.log1p(np.exp(np.clip((x - th) / 0.8, -30, 30)))
        return 1.0 / (0.0022 + 0.02 * np.log(xe / (xe - th)))

    base = lif(np.zeros(1))
    for step in range(steps):
        if callable(inputs):
            ir = drive(inputs(step))
        g = np.bincount(post, weights=r[pre] * dep[pre] * 0.005 * w_syn * w, minlength=N)
        ad += (r - ad) * dt / (dt + 400)
        x = g - 0.1 * ad - 0.3 * np.maximum(0, ad - 80)
        tgt = np.maximum(0, lif(x) - base)
        tgt += ir * np.clip((x + th) / th, 0, 1)
        tgt = np.minimum(tgt, 200)
        r += (tgt - r) * dt / (dt + 30)
        dep = np.clip((dep + dt / 300) / (1 + dt / 300 + 0.06 * r * dt / 1000), 0.02, 1)
        if trace:
            rows.append([float(r[b.pops[k][0]:b.pops[k][0] + b.pops[k][1]].mean()) for k in trace])
    if trace:
        return np.array(rows)
    res = {}
    for nm, (a0, n) in b.pops.items():
        res[nm] = float(r[a0:a0 + n].mean())
    return res


def motor_test(b, chans, sign, w_syn, base):
    """Series no tempo da medula: salto (comando curto), chute de nado (comando continuo
    na agua), andar (pouco comando em terra), queda (no ar)."""
    tr = ["salto_L", "salto_R", "recolher_L", "passo_L", "passo_R", "mn_quadril_ext_L", "mn_quadril_flex_L",
          "mn_dedos_L", "apoio_L", "pouso_L", "braco_nado_L", "mn_ombro_baixo_L", "mn_ombro_frente_L", "mn_ombro_tras_L"]
    g = base | {"equilibrio": 10, "apoio_maos_L": 100, "apoio_maos_R": 100}
    cases = {
        "parada": lambda t: g,
        "fuga curta (salto)": lambda t: g | ({"sombra_s5": 160, "sombra_s6": 160} if 10 <= t < 16 else {}),
        "nado (agua + ir)": lambda t: base | {"imerso": 120, "explore_L": 110, "explore_R": 110},
        "andar (ir devagar)": lambda t: g | {"explore_L": 70, "explore_R": 70},
        "no ar": lambda t: base | {"no_ar": 120},
        "ir (explorar 110)": lambda t: g | {"explore_L": 110, "explore_R": 110},
    }
    for nm, f in cases.items():
        X = simulate(b, chans, sign, w_syn, f, steps=150, trace=tr)
        print(f"  motor {nm}")
        for i, k in enumerate(tr):
            v = X[:, i]
            line = "".join(" .:-=+*#%@"[min(9, int(x / 8))] for x in v[::2])
            print(f"    {k:18s} max {v.max():5.1f} |{line}|")


def sectors(v, ks):
    return {f"presa_s{k}": v for k in ks}


def shadows(v, ks):
    return {f"sombra_s{k}": v for k in ks}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--test", action="store_true")
    ap.add_argument("--only", choices=["ra", "girino"])
    ap.add_argument("--motor", action="store_true", help="so o teste da medula da ra (nao grava)")
    args = ap.parse_args()
    specs = [
        ("girino", "Conectoma sintetico do girino v2 (regras: Roberts et al.)", tadpole, {"w_syn": 2.0, "ref_rate": 40.0}),
        ("ra", "Conectoma sintetico da ra v2 (regras: Ewert, Roth, Nishikawa, Wilczynski, Kelley)", frog, {"w_syn": 2.2, "ref_rate": 40.0}),
    ]
    for tag, name, fn, params in specs:
        if args.only and tag != args.only:
            continue
        b = fn()
        if args.motor:
            chans = sorted({m["chan"] for m in b.meta.values() if m["chan"]})
            sign = np.concatenate([np.full(n, b.meta[k]["sign"], float) for k, (a0, n) in sorted(b.pops.items(), key=lambda kv: kv[1][0])])
            base = {"explore_L": 20, "explore_R": 20, "fome": 60, "glicose": 20, "luz_L": 80, "luz_R": 80, "luz_pineal": 80}
            motor_test(b, chans, sign, params["w_syn"], base)
            continue
        chans, sign = b.export(tag, name, params)
        if not args.test:
            continue
        base = {"explore_L": 20, "explore_R": 20, "fome": 60, "glicose": 20, "luz_L": 80, "luz_R": 80, "luz_pineal": 80}
        if tag == "ra":
            cases = {"repouso": {},
                     "presa longe a esquerda (s1)": sectors(120, [1]),
                     "presa a esquerda perto da frente (s3)": sectors(120, [3]),
                     "presa a direita atras (s6)": sectors(120, [6]),
                     "presa perto e centrada": sectors(60, [3, 4]) | {"presa_perto": 150},
                     "presa perto, saciada": sectors(60, [3, 4]) | {"presa_perto": 150, "fome": 0, "glicose": 120, "estomago_cheio": 120},
                     "ameaca grande a direita": shadows(150, [5, 6]),
                     "presa + ameaca": sectors(120, [2]) | shadows(150, [2, 3]),
                     "falta de ar": {"oxigenio_baixo": 150},
                     "pulmao cheio": {"oxigenio_baixo": 40, "pulmao_cheio": 150},
                     "canto a direita": {"som_R": 150},
                     "vontade de ir (explorar 100)": {"explore_L": 100, "explore_R": 100},
                     "vontade de ir a esquerda": {"explore_L": 160, "explore_R": 20},
                     "gosto bom (engolir)": {"paladar_bom": 150},
                     "gosto ruim": {"paladar_ruim": 150},
                     "irritacao no lado esquerdo": {"irritante_L": 150},
                     "macho segurando femea (polegar)": {"polegar": 150},
                     "segurada pelo jogador (dor+tato)": {"dor": 120, "tato": 150},
                     "pele secando": {"pele_seca": 150},
                     "noite (pineal escuro)": {"luz_pineal": 0, "escuro_pineal": 120, "luz_L": 5, "luz_R": 5},
                     "macho na epoca de reproducao": {"reproducao": 120, "luz_pineal": 0, "escuro_pineal": 120}}
            keys = ["orient_L", "orient_R", "aprox", "hipoglosso", "boca_abre", "retrator", "fuga_L", "fuga_R", "salto_L", "salto_R", "mn_quadril_ext_L", "apoio_L", "pouso_L",
                    "bucal", "pulmonar", "simpatico", "dtam", "limpar_L", "abraco_L", "socorro", "sede", "melat", "pvn_crh", "gnrh"]
        else:
            cases = {"repouso": {}, "toque a esquerda": {"tato_L": 150}, "onda na linha lateral direita": {"linha_lateral_R": 150},
                     "alga (paladar)": {"paladar_bom": 120}, "sombra (pineal)": {"escuro_pineal": 120},
                     "procurando (explorar)": {"explore_L": 90, "explore_R": 90},
                     "virando a esquerda": {"explore_L": 30, "explore_R": 110},
                     "cabeca encostou": {"explore_L": 90, "explore_R": 90, "tato_cabeca": 150},
                     "sombra a esquerda": {f"sombra_s{k}": 150 for k in (1, 2)},
                     "segurado (dor + toque)": {"tato_L": 150, "tato_R": 150, "dor": 150},
                     "falta de oxigenio": {"oxigenio_baixo": 150}, "bem alimentado": {"glicose": 150, "fome": 0}}
            keys = ["MN_L", "MN_R", "mauthner_L", "mauthner_R", "debater_L", "boca", "MHR", "bucal", "simpatico", "trh"]
        if tag == "ra":
            motor_test(b, chans, sign, params["w_syn"], base)
        for cname, inp in cases.items():
            res = simulate(b, chans, sign, params["w_syn"], base | inp)
            print(f"  {tag} {cname:38s} " + "  ".join(f"{k} {res[k]:5.1f}" for k in keys))


if __name__ == "__main__":
    main()
