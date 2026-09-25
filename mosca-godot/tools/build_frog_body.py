#!/usr/bin/env python3
"""Corpo da ra feito do zero (sem malha de terceiros): superficie implicita
(SDF) com as proporcoes de um sapo-banjo (Limnodynastes dumerilii) sentado,
poligonizada, com esqueleto e pesos por vertice.

    pip install numpy scipy scikit-image pyfqmr
    python3 tools/build_frog_body.py

Partes: tronco (costas arqueadas, rabadilha, barriga achatada no chao),
cabeca larga e achatada com focinho arredondado, sulco da boca, papada
(garganta, bomba bucal), palpebras salientes com a abertura do olho (o
globo ocular e uma malha separada no jogo), timpano, narinas, verrugas no
dorso, glandula tibial na perna (tipica do sapo-banjo); coxa, perna, tarso,
pe com 5 dedos compridos e membrana basal; braco, antebraco, mao com 4
dedos e pontas arredondadas.

Esqueleto: os mesmos ossos usados pela ra no jogo (corpo, peito, cabeca,
garganta, olhos, femur, tibia, tarso, pe, umero, antebraco, mao). Os pesos
saem das proprias partes do SDF (cada parte pertence a um osso), entao as
dobras nas articulacoes ficam limpas.

Cada vertice leva a posicao de repouso (UV, UV2.x) e mascaras em COLOR
(dorso/ventre, labio, dedos, faixa dos membros) para o shader da pele
(shaders/frog_skin.gdshader) pintar o padrao sem precisar de textura.

Saida: frog/frog_skin.bin (formato FRG2) + frog/frog_skin.json
"""
import json
import struct
from pathlib import Path

import numpy as np
import pyfqmr
from scipy import ndimage as nd
from skimage.measure import marching_cubes

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frog"
RNG = np.random.default_rng(11)

# articulacoes (espaco do modelo: +x = direita da ra, y para cima, cabeca em -z; SVL = 1)
J = {
    "corpo": (0.0, 0.164, 0.197), "peito": (0.0, 0.213, -0.148), "cabeca": (0.0, 0.295, -0.328), "focinho": (0.0, 0.246, -0.574),
    "garganta": (0.0, 0.12, -0.36), "olho_R": (0.152, 0.418, -0.344), "olho_L": (-0.152, 0.418, -0.344),
}
for s, sg in (("R", 1.0), ("L", -1.0)):
    J |= {
        f"quadril_{s}": (0.09 * sg, 0.139, 0.328), f"joelho_{s}": (0.352 * sg, 0.189, 0.148),
        f"tornozelo_{s}": (0.246 * sg, 0.049, 0.385), f"tarso_{s}": (0.246 * sg, 0.025, 0.18), f"dedos_{s}": (0.27 * sg, 0.008, -0.066),
        f"ombro_{s}": (0.123 * sg, 0.18, -0.205), f"cotovelo_{s}": (0.303 * sg, 0.139, -0.148),
        f"punho_{s}": (0.295 * sg, 0.033, -0.303), f"mao_{s}": (0.279 * sg, 0.008, -0.426),
    }
J = {k: np.array(v) for k, v in J.items()}
BONES = [("corpo", "corpo", "peito", None), ("peito", "peito", "cabeca", "corpo"), ("cabeca", "cabeca", "focinho", "peito"),
         ("garganta", "garganta", "garganta", "cabeca")]
for s in ("R", "L"):
    BONES += [(f"olho_{s}", f"olho_{s}", f"olho_{s}", "cabeca")]
for s in ("R", "L"):
    BONES += [(f"femur_{s}", f"quadril_{s}", f"joelho_{s}", "corpo"), (f"tibia_{s}", f"joelho_{s}", f"tornozelo_{s}", f"femur_{s}"),
              (f"tarso_{s}", f"tornozelo_{s}", f"tarso_{s}", f"tibia_{s}"), (f"pe_{s}", f"tarso_{s}", f"dedos_{s}", f"tarso_{s}"),
              (f"umero_{s}", f"ombro_{s}", f"cotovelo_{s}", "peito"), (f"antebraco_{s}", f"cotovelo_{s}", f"punho_{s}", f"umero_{s}"),
              (f"mao_{s}", f"punho_{s}", f"mao_{s}", f"antebraco_{s}")]
BONE_IDX = {b[0]: i for i, b in enumerate(BONES)}
EYE_R = 0.066          # raio do globo ocular (malha separada no jogo)


# ------------------------------------------------------------------ SDF
def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def ellipsoid(p, c, r):
    q = (p - c) / np.asarray(r, float)
    k0 = np.linalg.norm(q, axis=1)
    k1 = np.linalg.norm(q / np.asarray(r, float), axis=1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def capsule(p, a, b, ra, rb):
    ab = b - a
    t = np.clip(((p - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1) - (ra + (rb - ra) * t)


def flat_capsule(p, a, b, ra, rb, flat, up=np.array([0.0, 1.0, 0.0])):
    """Capsula achatada na direcao 'up' (dedos, pes, maos)."""
    ab = b - a
    t = np.clip(((p - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
    q = p - (a + t[:, None] * ab)
    upn = up / np.linalg.norm(up)
    qy = q @ upn
    q = q + upn[None] * (qy * (1.0 / flat - 1.0))[:, None]
    return (np.linalg.norm(q, axis=1) - (ra + (rb - ra) * t)) * flat


# verrugas: pontos aleatorios (Worley F1)
_CELL = 0.034
_JIT = RNG.random((40, 40, 40, 3))


def worley(p, cell=_CELL):
    q = p / cell + 20.0
    i = np.floor(q).astype(int)
    best = np.full(len(p), 9.0)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                c = i + [dx, dy, dz]
                j = _JIT[c[:, 0] % 40, c[:, 1] % 40, c[:, 2] % 40]
                d = np.linalg.norm(c + j - q, axis=1)
                best = np.minimum(best, d)
    return best


def lip_z_to_y(z):
    return np.interp(z, [-0.6, -0.5, -0.4, -0.3, -0.24], [0.36, 0.33, 0.3, 0.27, 0.25])


class Frog:
    """Partes do corpo; cada uma pertence a um osso."""

    def parts(self, p):
        out = {}
        # ---- tronco: costas arqueadas, barriga larga e achatada no chao
        trunk = ellipsoid(p, np.array([0.0, 0.245, 0.0]), [0.255, 0.215, 0.28])
        trunk = smin(trunk, ellipsoid(p, np.array([0.0, 0.19, 0.25]), [0.21, 0.16, 0.18]), 0.06)       # rabadilha
        trunk = smin(trunk, ellipsoid(p, np.array([0.0, 0.11, 0.06]), [0.25, 0.1, 0.26]), 0.07)          # barriga
        for sg in (-1, 1):   # flancos cheios (gordura)
            trunk = smin(trunk, ellipsoid(p, np.array([0.17 * sg, 0.2, 0.03]), [0.1, 0.12, 0.2]), 0.07)
        trunk = smax(trunk, 0.028 - p[:, 1], 0.02)                                                     # apoiada no chao
        cloaca = ellipsoid(p, np.array([0.0, 0.12, 0.415]), [0.05, 0.05, 0.03])
        out["corpo"] = smin(trunk, cloaca, 0.04)
        chest = ellipsoid(p, np.array([0.0, 0.26, -0.19]), [0.22, 0.2, 0.16])
        chest = smax(chest, 0.05 - p[:, 1], 0.02)
        out["peito"] = chest
        # ---- cabeca: larga, achatada em cima, focinho arredondado
        head = ellipsoid(p, np.array([0.0, 0.345, -0.395]), [0.185, 0.115, 0.165])
        snout = ellipsoid(p, np.array([0.0, 0.365, -0.5]), [0.115, 0.07, 0.095])
        head = smin(head, snout, 0.05)
        head = smax(head, p[:, 1] - 0.452 - 0.12 * (p[:, 2] + 0.35) * (p[:, 2] < -0.35), 0.03)          # topo achatado
        # palpebras superiores salientes
        for sg in (-1, 1):
            e = J["olho_R"] * [sg, 1, 1]
            lid = ellipsoid(p, e + [0.0, 0.004, 0.004], [0.083, 0.072, 0.086])
            head = smin(head, lid, 0.035)
        # sulco da boca: uma fenda rasa (1 cm de pele) ao longo da linha do labio
        slab = np.abs(p[:, 1] - lip_z_to_y(p[:, 2])) - 0.0035
        cut = np.maximum(slab, -head - 0.011)
        cut = np.where(p[:, 2] < -0.255, cut, 1.0)
        head = smax(head, -cut, 0.003)
        out["cabeca"] = head
        # papada / assoalho da boca (bomba bucal)
        throat = ellipsoid(p, np.array([0.0, 0.25, -0.37]), [0.15, 0.06, 0.15])
        throat = smax(throat, 0.2 - p[:, 1], 0.02)   # papo recolhido (so infla no canto)
        out["garganta"] = throat
        # ---- membros
        for sg, s in ((1, "R"), (-1, "L")):
            m = np.array([sg, 1, 1])
            hip, knee, ank, tar, toe = J["quadril_" + s], J["joelho_" + s], J["tornozelo_" + s], J["tarso_" + s], J["dedos_" + s]
            thigh = capsule(p, hip + m * [0.0, 0.01, -0.01], knee, 0.105, 0.064)
            thigh = smin(thigh, ellipsoid(p, (hip + knee) * 0.5 + m * [0.0, 0.02, 0.025], [0.11, 0.085, 0.13]), 0.05)   # coxa musculosa
            out["femur_" + s] = thigh
            shank = capsule(p, knee, ank, 0.064, 0.037)
            shank = smin(shank, ellipsoid(p, knee * 0.62 + ank * 0.38 - m * [0.0, 0.01, 0.0], [0.06, 0.055, 0.085]), 0.03)   # panturrilha
            # glandula tibial do sapo-banjo (bulbo no dorso da perna)
            gl = ellipsoid(p, knee * 0.55 + ank * 0.45 + m * [0.018, 0.02, 0.0], [0.035, 0.03, 0.06])
            out["tibia_" + s] = smin(shank, gl, 0.02)
            out["tarso_" + s] = flat_capsule(p, ank, tar, 0.04, 0.033, 0.7)
            # pe: planta + 5 dedos compridos com membrana na base
            d = toe - tar
            L = np.linalg.norm(d)
            d /= L
            lat = np.cross(d, [0, 1, 0]) * sg     # para fora
            base = tar + d * L * 0.3 + [0, -0.012, 0]
            foot = flat_capsule(p, tar, base, 0.03, 0.036, 0.4)
            toes = None
            lens = [0.42, 0.6, 0.85, 1.12, 0.78]            # 1 (medial) .. 5 (lateral); o 4o e o maior
            spread = [-0.42, -0.2, 0.0, 0.2, 0.42]
            tips = []
            for i in range(5):
                ang = spread[i]
                dir_ = d * np.cos(ang) + lat * np.sin(ang)
                b0 = base + lat * (i - 2) * 0.012
                tip = b0 + dir_ * L * 0.95 * lens[i]
                tip[1] = 0.009
                tips.append(tip)
                t_ = flat_capsule(p, b0, tip, 0.014, 0.008, 0.55)
                t_ = smin(t_, np.linalg.norm(p - tip, axis=1) - 0.0085, 0.004)     # ponta arredondada
                toes = t_ if toes is None else np.minimum(toes, t_)
            web = None
            for i in range(4):
                a0 = base + lat * (i - 2) * 0.012
                w = flat_capsule(p, a0 + (tips[i] - a0) * 0.35, a0 + (tips[i + 1] - a0) * 0.35, 0.006, 0.006, 0.45)
                tri = flat_capsule(p, a0, (tips[i] + tips[i + 1] - 2 * a0) * 0.18 + a0, 0.012, 0.01, 0.4)
                w = smin(w, tri, 0.01)
                web = w if web is None else np.minimum(web, w)
            out["pe_" + s] = smin(smin(foot, toes, 0.012), web, 0.006)
            # braco
            sh, el, wr, ht = J["ombro_" + s], J["cotovelo_" + s], J["punho_" + s], J["mao_" + s]
            out["umero_" + s] = smin(capsule(p, sh, el, 0.058, 0.042), ellipsoid(p, sh * 0.5 + el * 0.5 + [0, 0.01, 0], [0.07, 0.052, 0.055]), 0.03)
            fore = capsule(p, el, wr, 0.045, 0.03)
            out["antebraco_" + s] = smin(fore, ellipsoid(p, el * 0.62 + wr * 0.38, [0.05, 0.047, 0.065]), 0.025)
            dh = ht - wr
            Lh = np.linalg.norm(dh)
            dh /= Lh
            lat_h = np.cross(dh, [0, 1, 0]) * sg
            palm_end = wr + dh * Lh * 0.45 + [0, -0.012, 0]
            hand = flat_capsule(p, wr, palm_end, 0.03, 0.03, 0.5)
            flens = [0.55, 0.7, 1.0, 0.72]                   # dedos II..V
            fspread = [-0.55, -0.18, 0.12, 0.45]              # apontam para dentro/frente
            for i in range(4):
                dir_ = dh * np.cos(fspread[i]) + lat_h * np.sin(fspread[i])
                b0 = palm_end + lat_h * (i - 1.5) * 0.01
                tip = b0 + dir_ * 0.12 * flens[i]
                tip[1] = 0.008
                f_ = flat_capsule(p, b0, tip, 0.011, 0.0075, 0.6)
                f_ = smin(f_, np.linalg.norm(p - tip, axis=1) - 0.0075, 0.003)
                hand = smin(hand, f_, 0.006)
            out["mao_" + s] = hand
        return out

    BLEND = {"peito": 0.07, "cabeca": 0.07, "garganta": 0.05, "femur": 0.05, "tibia": 0.02, "tarso": 0.012, "pe": 0.012,
             "umero": 0.035, "antebraco": 0.015, "mao": 0.01}

    def sdf(self, p, parts=None):
        parts = self.parts(p) if parts is None else parts
        d = parts["corpo"]
        for name in ["peito", "cabeca", "garganta"] + [f"{b}_{s}" for s in ("R", "L") for b in ("femur", "umero")]:
            d = smin(d, parts[name], self.BLEND[name.split("_")[0]])
        for s in ("R", "L"):
            for chain_ in (("femur", "tibia", "tarso", "pe"), ("umero", "antebraco", "mao")):
                for b in chain_[1:]:
                    d = smin(d, parts[f"{b}_{s}"], self.BLEND[b])
        # abertura dos olhos (o globo fica dentro), timpano e narinas
        for sg in (-1, 1):
            e = J["olho_R"] * [sg, 1, 1]
            out_dir = np.array([0.72 * sg, 0.62, -0.3])
            out_dir /= np.linalg.norm(out_dir)
            d = smax(d, -(np.linalg.norm(p - (e + out_dir * 0.018), axis=1) - EYE_R * 0.98), 0.006)
            ty = np.array([0.205 * sg, 0.345, -0.255])
            d = smax(d, -(np.linalg.norm(p - (ty + np.array([0.045 * sg, 0.0, 0.0])), axis=1) - 0.05), 0.006)
            na = np.array([0.036 * sg, 0.408, -0.548])
            d = smax(d, -(np.linalg.norm(p - na, axis=1) - 0.0075), 0.003)
        # verrugas no dorso e nos flancos (nao na barriga nem nos dedos)
        dorsal = np.clip((p[:, 1] - 0.16) / 0.12, 0, 1) * (np.abs(p[:, 0]) < 0.42)
        bump = np.clip(1.0 - worley(p) / 0.42, 0, 1) ** 2
        d = d - 0.0065 * bump * dorsal
        return d


# ------------------------------------------------------------------ poligonizacao
def polygonize(fr, h=0.0032):
    lo = np.array([-0.47, -0.02, -0.64])
    hi = np.array([0.47, 0.58, 0.48])
    # passo grosso para achar a casca
    hc = h * 3
    nc = np.ceil((hi - lo) / hc).astype(int) + 1
    gc = np.stack(np.meshgrid(*[lo[i] + np.arange(nc[i]) * hc for i in range(3)], indexing="ij"), -1).reshape(-1, 3)
    dc = np.concatenate([fr.sdf(gc[i:i + 300000]) for i in range(0, len(gc), 300000)]).reshape(nc)
    n = np.ceil((hi - lo) / h).astype(int) + 1
    idx = [np.minimum((np.arange(n[i]) * h / hc).round().astype(int), nc[i] - 1) for i in range(3)]
    coarse = dc[np.ix_(idx[0], idx[1], idx[2])]
    vol = np.where(coarse > 0, 1.0, -1.0).astype(np.float32)
    near = np.abs(coarse) < 0.03
    pts = np.argwhere(near)
    P = lo + pts * h
    print("  %d pontos perto da superficie (de %d)" % (len(P), n.prod()))
    vals = np.concatenate([fr.sdf(P[i:i + 300000]) for i in range(0, len(P), 300000)])
    vol[near] = vals
    vol[0], vol[-1], vol[:, 0], vol[:, -1], vol[:, :, 0], vol[:, :, -1] = 1, 1, 1, 1, 1, 1
    V, F, _, _ = marching_cubes(vol, 0.0, spacing=(h, h, h))
    V += lo
    print("  marching cubes: %d vertices, %d triangulos" % (len(V), len(F)))
    sm = pyfqmr.Simplify()
    sm.setMesh(V.astype(np.float64), F.astype(np.int32))
    sm.simplify_mesh(target_count=52000, aggressiveness=6, preserve_border=True, verbose=False)
    V, F, _ = sm.getMesh()
    return V, F


def main():
    fr = Frog()
    print("esculpindo a ra...")
    V, F = polygonize(fr)
    e = 0.0015
    parts = fr.parts(V)
    g = np.stack([fr.sdf(V + [e, 0, 0]) - fr.sdf(V - [e, 0, 0]), fr.sdf(V + [0, e, 0]) - fr.sdf(V - [0, e, 0]),
                  fr.sdf(V + [0, 0, e]) - fr.sdf(V - [0, 0, e])], 1)
    N = g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)
    tri_n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    if np.mean(np.sum(tri_n * N[F[:, 0]], 1)) > 0:
        F = F[:, [0, 2, 1]]
    # ---- pesos: cada parte do SDF puxa os vertices do seu osso
    names = [b[0] for b in BONES]
    W = np.zeros((len(V), len(BONES)))
    sigma = {"corpo": 0.05, "peito": 0.05, "cabeca": 0.03, "garganta": 0.02}
    for bi, name in enumerate(names):
        if name.startswith("olho"):
            continue
        d = np.maximum(parts[name], 0.0)
        sg = sigma.get(name, 0.012)
        W[:, bi] = np.exp(-d / sg)
    # palpebras e pele em volta dos olhos seguem o olho (afunda ao engolir)
    for s in ("R", "L"):
        dd = np.linalg.norm(V - J["olho_" + s], axis=1)
        W[:, BONE_IDX["olho_" + s]] = np.clip(1.0 - (dd - 0.07) / 0.025, 0, 1) * 1.5
    W[:, 0] += 1e-5
    top = np.argsort(-W, axis=1)[:, :4]
    tw = np.take_along_axis(W, top, 1)
    tw = np.where(tw < 0.02 * tw[:, :1], 0.0, tw)
    tw /= tw.sum(1, keepdims=True)
    main_bone = np.array(names)[top[:, 0]]
    # ---- mascaras para o shader
    limb = np.array([n.split("_")[0] in ("femur", "tibia", "tarso", "umero", "antebraco") for n in main_bone])
    digits = np.array([n.split("_")[0] in ("pe", "mao") for n in main_bone])
    dorsal = np.clip(N[:, 1] * 0.9 + (V[:, 1] - 0.09) * 5.5, 0, 1)
    # membros: o lado de cima (e de fora) e escuro, o de baixo claro
    limb_d = np.clip(N[:, 1] * 1.3 + 0.35 + 0.3 * np.abs(N[:, 0]), 0, 1)
    dorsal = np.where(limb | digits, limb_d, dorsal)
    dorsal = np.where(digits, dorsal * 0.7, dorsal)
    lip = np.exp(-((V[:, 1] - lip_z_to_y(V[:, 2]) - 0.012) / 0.014) ** 2) * (V[:, 2] < -0.26)
    # coordenada ao longo do membro (faixas escuras transversais)
    band = np.zeros(len(V))
    for bi, (name, a, b, _) in enumerate(BONES):
        if name.split("_")[0] in ("femur", "tibia", "tarso", "umero", "antebraco"):
            sel = main_bone == name
            ab = J[b] - J[a]
            band[sel] = ((V[sel] - J[a]) @ ab) / (ab @ ab)
    C = np.stack([dorsal, lip, digits.astype(float), np.where(limb, np.clip(band, 0, 1), -1.0) * 0.5 + 0.5], 1)
    region = np.where(digits, 2.0, np.where(limb, 1.0, 0.0))
    UV = V[:, :2]
    # onde a gordura se acumula (tronco, flancos, coxa): o shader incha com a energia
    fat = np.where(region == 0, np.clip(1.0 - np.abs(V[:, 2] - 0.05) / 0.4, 0, 1) * np.clip((V[:, 1] - 0.05) / 0.1, 0, 1), 0.0)
    fat = fat * (main_bone != "cabeca") * (main_bone != "garganta")
    fat = np.where(np.char.startswith(main_bone.astype(str), "femur"), 0.5, fat)
    UV2 = np.stack([V[:, 2], region + np.clip(fat, 0, 1) * 0.49], 1)
    OUT.mkdir(exist_ok=True)
    with open(OUT / "frog_skin.bin", "wb") as f:
        f.write(struct.pack("<4sII", b"FRG2", len(V), F.size))
        f.write(V.astype("<f4").tobytes())
        f.write(N.astype("<f4").tobytes())
        f.write(UV.astype("<f4").tobytes())
        f.write(UV2.astype("<f4").tobytes())
        f.write(C.astype("<f4").tobytes())
        f.write(F.astype("<i4").tobytes())
        f.write(top.astype("<i4").tobytes())
        f.write(tw.astype("<f4").tobytes())
    bones = [{"nome": n, "pai": p, "cabeca": J[a].round(5).tolist(), "ponta": J[b].round(5).tolist()} for n, a, b, p in BONES]
    extra = {"olho_R": J["olho_R"].tolist(), "olho_L": J["olho_L"].tolist(), "boca": [0.0, 0.33, -0.575], "raio_olho": EYE_R}
    (OUT / "frog_skin.json").write_text(json.dumps({"fonte": "tools/build_frog_body.py (feito do zero)", "ossos": bones, "pontos": extra}, indent=1))
    dom = np.bincount(top[:, 0], minlength=len(BONES))
    print("vertices %d  triangulos %d" % (len(V), len(F)))
    print("vertices por osso:", {names[i]: int(dom[i]) for i in range(len(BONES)) if dom[i]})


if __name__ == "__main__":
    main()
