#!/usr/bin/env python3
"""Esculpe os orgaos internos, o esqueleto e os musculos da ra dentro do
corpo da ra (frog/frog_skin.bin, feito do zero por build_frog_body.py).

    pip install numpy scipy scikit-image
    python3 tools/build_frog_organs.py

Cada orgao e uma superficie implicita (SDF: elipsoides, capsulas ao longo de
curvas, lentes, unioes suaves, ruido) poligonizada por marching cubes, e
recortada pela cavidade do corpo (a propria malha da pele voxelizada), entao
os orgaos se encaixam uns nos outros e na parede do corpo como numa
dissecacao. Tubos (intestino delgado, vasos, nervos, ovidutos) sao varridos
ao longo de curvas; o intestino e "acomodado" na cavidade por relaxacao
(nao atravessa a si mesmo nem os outros orgaos).

Anatomia (Anura; referencias: Duellman & Trueb, Biology of Amphibians;
dissecacoes de Rana/Lithobates):
  coracao: seio venoso, 2 atrios, ventriculo unico conico, cone arterial em
  espiral, tronco que se divide em 3 arcos de cada lado (carotido, sistemico,
  pulmocutaneo); aorta dorsal, veia pos-cava, pre-cavas, veia abdominal
  ventral, veias pulmonares.
  pulmoes: sacos de parede fina com septos alveolares, dorsolaterais.
  figado: 3 lobos (esquerdo maior), vesicula biliar verde entre eles.
  estomago em J do lado esquerdo, piloro, duodeno, pancreas, intestino
  delgado enrolado no mesenterio, baco, intestino grosso reto ate a cloaca.
  rins (mesonefros) dorsais, glandulas adrenais, ureteres; bexiga bilobada.
  gonadas: testiculos (macho) ou ovarios com ovulos pigmentados + ovidutos
  enovelados (femea); corpos gordurosos em dedos.
  encefalo: bulbos olfatorios, hemisferios, diencefalo, teto optico,
  cerebelo, bulbo; medula curta (termina no filum), nervos opticos,
  plexo braquial, plexo sacral / nervos isquiaticos.
  esqueleto: cranio (esfenetmoide, frontoparietais, parasfenoide, arco
  maxilar, pterigoides, mandibula), 8 vertebras + sacral com diapofises
  largas, urostilo, ilios, cintura escapular (escapula, supraescapula,
  clavicula, coracoide, esterno), femur, tibiofibula, astragalo+calcaneo,
  metatarsos e falanges, umero com crista deltoide, radio-ulna, mao.
  musculos: coxa (cruralis, gracilis, semimembranoso, sartorio), perna
  (gastrocnemio com tendao, tibial anterior), braco e antebraco.

Saida: frog/frog_organs.bin (malhas, formato ORG2) + frog/frog_organs.json (ovulos etc).
"""
import json
import struct
from pathlib import Path

import numpy as np
from scipy import ndimage as nd
from skimage.measure import marching_cubes
import pyfqmr

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frog"
RNG = np.random.default_rng(7)


# ------------------------------------------------------------------ pele -> volume
def load_skin():
    d = (OUT / "frog_skin.bin").read_bytes()
    nv, ni = struct.unpack("<II", d[4:12])
    o = 12
    P = np.frombuffer(d[o:o + nv * 12], "<f4").reshape(-1, 3).astype(float)
    # FRG2 (build_frog_body.py): pos, normal, uv, uv2, cor, indices
    o += nv * 12 * 2 + nv * 8 + (nv * 8 + nv * 16 if d[:4] == b"FRG2" else 0)
    idx = np.frombuffer(d[o:o + ni * 4], "<i4").reshape(-1, 3)
    return P, idx


def voxelize(P, idx, h=0.005):
    lo = P.min(0) - 0.03
    hi = P.max(0) + 0.03
    n = np.ceil((hi - lo) / h).astype(int)
    T = P[idx]
    xs = {}
    for t in range(len(T)):
        a, b, c = T[t]
        j0 = max(int(np.floor((min(a[1], b[1], c[1]) - lo[1]) / h - 0.5)), 0)
        j1 = min(int(np.ceil((max(a[1], b[1], c[1]) - lo[1]) / h - 0.5)), n[1] - 1)
        k0 = max(int(np.floor((min(a[2], b[2], c[2]) - lo[2]) / h - 0.5)), 0)
        k1 = min(int(np.ceil((max(a[2], b[2], c[2]) - lo[2]) / h - 0.5)), n[2] - 1)
        den = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1])
        if abs(den) < 1e-14:
            continue
        for j in range(j0, j1 + 1):
            py = lo[1] + (j + 0.5) * h
            for k in range(k0, k1 + 1):
                pz = lo[2] + (k + 0.5) * h
                u = ((py - a[1]) * (c[2] - a[2]) - (pz - a[2]) * (c[1] - a[1])) / den
                v = ((b[1] - a[1]) * (pz - a[2]) - (b[2] - a[2]) * (py - a[1])) / den
                if u < 0 or v < 0 or u + v > 1:
                    continue
                xs.setdefault((j, k), []).append(a[0] + u * (b[0] - a[0]) + v * (c[0] - a[0]))
    M = np.zeros(n, bool)
    X = lo[0] + (np.arange(n[0]) + 0.5) * h
    for (j, k), l in xs.items():
        l = np.sort(l)
        if len(l) % 2:
            l = l[:-1]
        for q in range(0, len(l), 2):
            M[(X > l[q]) & (X < l[q + 1]), j, k] = True
    return M, lo, h


class Field:
    """Distancia com sinal (negativa dentro) de uma mascara de voxels."""

    def __init__(self, mask, lo, h):
        self.lo, self.h = lo, h
        self.d = (nd.distance_transform_edt(~mask) - nd.distance_transform_edt(mask)) * h

    def __call__(self, p):
        c = ((p - self.lo) / self.h - 0.5).T
        return nd.map_coordinates(self.d, c, order=1, mode="nearest")


# ------------------------------------------------------------------ SDF basicos
def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    hh = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - hh) + a * hh - k * hh * (1 - hh)


def smax(a, b, k):
    return -smin(-a, -b, k)


def ellipsoid(p, c, r, rot=None):
    q = p - c
    if rot is not None:
        q = q @ rot
    r = np.asarray(r, float)
    k0 = np.linalg.norm(q / r, axis=1)
    k1 = np.linalg.norm(q / (r * r), axis=1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def capsule(p, a, b, ra, rb):
    a, b = np.asarray(a, float), np.asarray(b, float)
    ab = b - a
    t = np.clip(((p - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1) - (ra + (rb - ra) * t)


def chain(p, pts, radii, k=0.0):
    d = None
    for i in range(len(pts) - 1):
        s = capsule(p, pts[i], pts[i + 1], radii[i], radii[i + 1])
        d = s if d is None else smin(d, s, k)
    return d


def rot_y(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_x(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_z(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


_PERM = RNG.random((64, 64, 64))


def vnoise(p, f):
    q = p * f * 1.0
    return nd.map_coordinates(_PERM, (q.T % 64), order=1, mode="wrap")


def curve(ctrl, n):
    """Catmull-Rom denso pelos pontos de controle."""
    ctrl = np.asarray(ctrl, float)
    P = np.vstack([2 * ctrl[0] - ctrl[1], ctrl, 2 * ctrl[-1] - ctrl[-2]])
    out = []
    segs = len(ctrl) - 1
    for i in range(segs):
        p0, p1, p2, p3 = P[i:i + 4]
        m = max(2, int(n / segs))
        for t in np.linspace(0, 1, m, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(ctrl[-1])
    return np.array(out)


# ------------------------------------------------------------------ malhas
MESHES = []


def add_mesh(name, bone, mat, pivot, V, N, F, C=None):
    pivot = np.asarray(pivot, float)
    if C is None:
        C = np.tile([0.5, 0.5, 0.5, 1.0], (len(V), 1))
    MESHES.append(dict(name=name, bone=bone, mat=mat, pivot=pivot, V=V - pivot, N=N, F=F, C=C))
    return len(V)


def merge(pred, name):
    """Junta varias malhas (mesmo osso e material) numa so (menos draw calls)."""
    sel = [m for m in MESHES if pred(m)]
    if len(sel) < 2:
        return
    pivot = sel[0]["pivot"]
    V, N, F, C = [], [], [], []
    base = 0
    for m in sel:
        V.append(m["V"] + m["pivot"] - pivot)
        N.append(m["N"])
        C.append(np.asarray(m["C"]))
        F.append(m["F"].astype(np.int64) + base)
        base += len(m["V"])
        MESHES.remove(m)
    MESHES.append(dict(name=name, bone=sel[0]["bone"], mat=sel[0]["mat"], pivot=pivot, V=np.vstack(V), N=np.vstack(N),
                       F=np.vstack(F).astype(np.uint32), C=np.vstack(C)))


def sdf_mesh(name, bone, mat, f, lo, hi, h=0.004, pivot=None, clip=None, clip_k=0.012, color=None, keep=0.28):
    lo = np.asarray(lo, float)
    hi = np.asarray(hi, float)
    n = np.ceil((hi - lo) / h).astype(int) + 1
    g = np.stack(np.meshgrid(*[lo[i] + np.arange(n[i]) * h for i in range(3)], indexing="ij"), -1).reshape(-1, 3)

    def F(p):
        d = f(p)
        if clip is not None:
            d = smax(d, clip(p), clip_k)
        return d

    vol = np.concatenate([F(g[i:i + 400000]) for i in range(0, len(g), 400000)]).reshape(n)
    if vol.min() >= 0:
        print("  (vazio)", name)
        return
    vol[0, :, :] = vol[-1, :, :] = vol[:, 0, :] = vol[:, -1, :] = vol[:, :, 0] = vol[:, :, -1] = 1.0
    V, Fc, _, _ = marching_cubes(vol, 0.0, spacing=(h, h, h))
    V += lo
    # simplifica (quadricas) mantendo a forma; as normais vem do campo
    target = max(300, int(len(Fc) * keep))
    if target < len(Fc):
        sm = pyfqmr.Simplify()
        sm.setMesh(V.astype(np.float64), Fc.astype(np.int32))
        sm.simplify_mesh(target_count=target, aggressiveness=5, preserve_border=True, verbose=False)
        V, Fc, _ = sm.getMesh()
    e = h * 0.5
    gr = np.stack([F(V + [e, 0, 0]) - F(V - [e, 0, 0]), F(V + [0, e, 0]) - F(V - [0, e, 0]), F(V + [0, 0, e]) - F(V - [0, 0, e])], 1)
    N = gr / np.maximum(np.linalg.norm(gr, axis=1, keepdims=True), 1e-9)
    # orienta os triangulos com as normais para fora
    tri_n = np.cross(V[Fc[:, 1]] - V[Fc[:, 0]], V[Fc[:, 2]] - V[Fc[:, 0]])
    if np.mean(np.sum(tri_n * N[Fc[:, 0]], 1)) > 0:
        Fc = Fc[:, [0, 2, 1]]
    C = color(V) if color is not None else None
    if pivot is None:
        pivot = V.mean(0)
    add_mesh(name, bone, mat, pivot, V, N, Fc.astype(np.uint32), C)
    print("  %-18s %6d vertices" % (name, len(V)))


def frames(pts):
    T = np.gradient(pts, axis=0)
    T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-9)
    ref = np.array([0.0, 1.0, 0.0]) if abs(T[0, 1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    Nn = [np.cross(T[0], ref)]
    Nn[0] /= np.linalg.norm(Nn[0])
    for i in range(1, len(T)):
        v = Nn[-1] - T[i] * (Nn[-1] @ T[i])
        Nn.append(v / max(np.linalg.norm(v), 1e-9))
    Nn = np.array(Nn)
    return T, Nn, np.cross(T, Nn)


def tube(name, bone, mat, pts, radii, sides=12, pivot=None, cap=True, bulge=None):
    pts = np.asarray(pts, float)
    radii = np.broadcast_to(np.asarray(radii, float), (len(pts),)).copy()
    T, A, B = frames(pts)
    V, N, C = [], [], []
    for i in range(len(pts)):
        for j in range(sides):
            a = 2 * np.pi * j / sides
            d = A[i] * np.cos(a) + B[i] * np.sin(a)
            V.append(pts[i] + d * radii[i])
            N.append(d)
            w = 1.0 if bulge is None else bulge[i]
            C.append([*(T[i] * 0.5 + 0.5), w])
    F = []
    for i in range(len(pts) - 1):
        for j in range(sides):
            a = i * sides + j
            b = i * sides + (j + 1) % sides
            F += [[a, b, a + sides], [b, b + sides, a + sides]]
    if cap:
        for end, sgn in ((0, -1), (len(pts) - 1, 1)):
            ci = len(V)
            V.append(pts[end] + T[end] * sgn * radii[end] * 0.6)
            N.append(T[end] * sgn)
            C.append([*(T[end] * 0.5 + 0.5), 0.0])
            for j in range(sides):
                a = end * sides + j
                b = end * sides + (j + 1) % sides
                F.append([a, ci, b] if sgn < 0 else [a, b, ci])
    V, N, F = np.array(V), np.array(N), np.array(F, np.uint32)
    tri_n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    if np.mean(np.sum(tri_n * N[F[:, 0]], 1)) > 0:
        F = F[:, [0, 2, 1]]
    add_mesh(name, bone, mat, pts[0] if pivot is None else pivot, V, N, F, np.array(C))


def mirror(p):
    return np.array([-p[0], p[1], p[2]])


# ------------------------------------------------------------------ o corpo
def main():
    print("voxelizando a pele...")
    P, idx = load_skin()
    M, lo, h = voxelize(P, idx)
    skin = Field(M, lo, h)
    depth = nd.distance_transform_edt(M) * h
    inner = depth > 0.022
    lab, _ = nd.label(inner)
    c = lab[tuple(((np.array([0, 0.25, 0.0]) - lo) / h - 0.5).round().astype(int))]
    cav_f = Field(lab == c, lo, h)
    meta = json.loads((OUT / "frog_skin.json").read_text())
    bones = {b["nome"]: (np.array(b["cabeca"]), np.array(b["ponta"])) for b in meta["ossos"]}

    def cav(p):
        # cavidade do tronco (sem os membros)
        return smax(cav_f(p), np.abs(p[:, 0]) - 0.235, 0.03)

    def cav_in(p, m):
        return cav(p) + m

    print("orgaos:")
    heart(cav)
    vessels()
    lungs(cav)
    liver(cav)
    gut(cav)
    uro_genital(cav)
    brain_nerves(skin)
    skeleton(skin, bones)
    muscles(skin, bones)
    eggs = ovary_eggs()
    # vasos, nervos e ossos do tronco que nao se mexem sozinhos: uma malha por tecido
    for mat, name in (("arteria", "arterias"), ("veia", "veias"), ("nervo", "nervos")):
        keep = {"cone_arterial", "seio_venoso"}
        merge(lambda m, mat=mat: m["mat"] == mat and m["bone"] == "corpo" and m["name"] not in keep, name)
        merge(lambda m, mat=mat: m["mat"] == mat and m["bone"] == "cabeca", name + "_cabeca")
    write(eggs)


# ------------------------------------------------------------------ coracao
HEART_C = np.array([0.0, 0.2, -0.185])


def heart(cav):
    c = HEART_C
    # ventriculo: cone arredondado com o apice para tras e para baixo
    def ventr(p):
        q = (p - c) @ rot_x(0.45)
        d = ellipsoid(q, np.array([0, 0, 0.008]), [0.055, 0.05, 0.06])
        cone = capsule(q, [0, 0, -0.01], [0.004, -0.004, 0.068], 0.046, 0.012)
        return smin(d, cone, 0.03)
    sdf_mesh("ventriculo", "corpo", "ventriculo", ventr, c - 0.1, c + 0.12, 0.0028, pivot=c + [0, 0.02, -0.02])
    # atrios: dois sacos de parede fina em cima e na frente; o direito maior; auriculas
    def atr(sg):
        ac = c + [0.034 * sg, 0.045, -0.035]
        def f(p):
            d = ellipsoid(p, ac, [0.038 if sg > 0 else 0.032, 0.03, 0.034])
            d = smin(d, ellipsoid(p, ac + [0.025 * sg, 0.005, -0.02], [0.018, 0.014, 0.016]), 0.012)
            return d + 0.0025 * np.sin(p[:, 0] * 180) * np.sin(p[:, 2] * 150)
        return f
    for sg, s in ((1, "R"), (-1, "L")):
        sdf_mesh("atrio_" + s, "corpo", "atrio", atr(sg), c + [-0.1, -0.02, -0.12], c + [0.1, 0.1, 0.03], 0.0028,
                 pivot=c + [0.02 * sg, 0.03, -0.02])
    # seio venoso (dorsal) recebendo as cavas
    sv = c + [0.01, 0.07, 0.005]
    sdf_mesh("seio_venoso", "corpo", "veia", lambda p: ellipsoid(p, sv, [0.03, 0.016, 0.028]), sv - 0.05, sv + 0.05, 0.0028)
    # cone arterial: sai do ventriculo (lado direito, na frente) em espiral e vira o tronco
    cone = curve([c + [0.012, 0.01, -0.05], c + [0.02, 0.03, -0.075], c + [0.008, 0.045, -0.095], c + [0.0, 0.05, -0.105]], 16)
    tube("cone_arterial", "corpo", "cone", cone, np.linspace(0.017, 0.013, len(cone)), 14, pivot=c)


def arch(sg, kind):
    """Arcos aorticos saindo do tronco (ponto de divisao)."""
    s = np.array([sg, 1, 1])
    t0 = HEART_C + [0.0, 0.05, -0.105]
    b = HEART_C + [0.03 * sg, 0.058, -0.118]
    if kind == "carotida":
        pts = [t0, b, HEART_C + s * [0.06, 0.09, -0.15], HEART_C + s * [0.075, 0.14, -0.18], HEART_C + s * [0.07, 0.19, -0.23]]
        return curve(pts, 20), 0.0065
    if kind == "sistemico":
        pts = [t0, b, HEART_C + s * [0.08, 0.08, -0.125], HEART_C + s * [0.11, 0.13, -0.1], HEART_C + s * [0.08, 0.19, -0.04],
               np.array([0.012 * sg, 0.43, -0.12])]
        return curve(pts, 28), 0.0075
    pts = [t0, b, HEART_C + s * [0.07, 0.07, -0.11], HEART_C + s * [0.085, 0.11, -0.06], HEART_C + s * [0.1, 0.14, 0.0],
           HEART_C + s * [0.12, 0.13, 0.09]]
    return curve(pts, 26), 0.006


def vessels():
    for sg, s in ((1, "R"), (-1, "L")):
        for kind in ("carotida", "sistemico", "pulmonar"):
            pts, r = arch(sg, kind)
            rr = np.linspace(r * 1.3, r * 0.75, len(pts))
            tube("arco_%s_%s" % (kind, s), "corpo", "arteria", pts, rr, 10)
        # pre-cava: dos bracos e da cabeca para o seio venoso
        pc = curve([HEART_C + [0.015 * sg, 0.07, -0.01], HEART_C + [0.06 * sg, 0.1, -0.05], HEART_C + [0.11 * sg, 0.1, -0.06],
                    HEART_C + [0.15 * sg, 0.02, -0.03]], 20)
        tube("precava_" + s, "corpo", "veia", pc, np.linspace(0.009, 0.006, len(pc)), 10)
        # veias pulmonares -> atrio esquerdo
        pv = curve([HEART_C + [-0.03, 0.06, -0.04], HEART_C + [0.05 * sg, 0.1, -0.02], HEART_C + [0.1 * sg, 0.13, 0.03]], 14)
        tube("veia_pulmonar_" + s, "corpo", "veia", pv, 0.0045, 8)
        # arterias iliacas (da aorta para as pernas) e renais
        il = curve([np.array([0.0, 0.375, 0.1]), np.array([0.03 * sg, 0.34, 0.2]), np.array([0.06 * sg, 0.25, 0.29]), np.array([0.085 * sg, 0.16, 0.33])], 20)
        tube("iliaca_" + s, "corpo", "arteria", il, np.linspace(0.006, 0.005, len(il)), 8)
    # aorta dorsal: os dois arcos sistemicos se juntam atras do coracao
    ao = curve([np.array([0.0, 0.43, -0.11]), np.array([0.0, 0.415, 0.0]), np.array([0.0, 0.39, 0.07]), np.array([0.0, 0.375, 0.1])], 22)
    tube("aorta_dorsal", "corpo", "arteria", ao, np.linspace(0.009, 0.007, len(ao)), 12)
    # arteria celiacomesenterica: da aorta ao estomago e intestino
    cm = curve([np.array([0.0, 0.41, -0.02]), np.array([-0.02, 0.34, -0.0]), np.array([-0.05, 0.26, 0.0]), np.array([-0.02, 0.2, 0.06])], 16)
    tube("mesenterica", "corpo", "arteria", cm, 0.005, 8)
    # veia pos-cava: dos rins, atravessa o figado ate o seio venoso
    pc = curve([np.array([0.0, 0.33, 0.24]), np.array([0.01, 0.33, 0.1]), np.array([0.015, 0.3, -0.02]), np.array([0.015, 0.27, -0.1]),
                HEART_C + [0.01, 0.075, 0.01]], 26)
    tube("pos_cava", "corpo", "veia", pc, np.linspace(0.008, 0.011, len(pc)), 12)
    # veia abdominal ventral: corre por dentro da parede da barriga ate o figado
    va = curve([np.array([0.0, 0.1, 0.33]), np.array([0.0, 0.075, 0.2]), np.array([0.0, 0.07, 0.06]), np.array([0.005, 0.095, -0.05])], 22)
    tube("veia_abdominal", "corpo", "veia", va, 0.0055, 8)
    # veia porta hepatica: do intestino ao figado
    vp = curve([np.array([0.02, 0.17, 0.14]), np.array([0.03, 0.16, 0.05]), np.array([0.03, 0.15, -0.03])], 14)
    tube("porta_hepatica", "corpo", "veia", vp, 0.006, 8)


# ------------------------------------------------------------------ pulmoes
LUNG_HILUM = {1: np.array([0.05, 0.3, -0.2]), -1: np.array([-0.05, 0.3, -0.2])}


def lungs(cav):
    for sg, s in ((1, "R"), (-1, "L")):
        hl = LUNG_HILUM[sg]
        def f(p, sg=sg, hl=hl):
            s3 = np.array([sg, 1, 1])
            d = chain(p, [hl, hl + s3 * [0.045, 0.02, 0.05], hl + s3 * [0.085, 0.02, 0.14], hl + s3 * [0.085, 0.0, 0.2]],
                      [0.02, 0.06, 0.07, 0.035], 0.05)
            # superficie em favo: os septos internos marcam a parede
            return d + 0.003 * (vnoise(p, 90) - 0.5) - 0.002 * np.abs(np.sin(p[:, 2] * 120) * np.sin(p[:, 0] * 110))
        sdf_mesh("pulmao_" + s, "corpo", "pulmao", f, hl + [-0.12, -0.12, -0.05], hl + [0.12, 0.12, 0.3], 0.0035,
                 pivot=hl, clip=lambda p: cav(p) + 0.004)
        # bronquio curto da laringe ao pulmao
        br = curve([np.array([0.0, 0.3, -0.26]), np.array([0.02 * sg, 0.3, -0.23]), hl], 10)
        tube("bronquio_" + s, "corpo", "cartilagem", br, 0.007, 8)
    lar = curve([np.array([0.0, 0.29, -0.3]), np.array([0.0, 0.3, -0.26])], 6)
    tube("laringe", "corpo", "cartilagem", lar, 0.012, 10)


# ------------------------------------------------------------------ figado
def liver(cav):
    def lobe(p, c, r, a, notch=None):
        q = (p - c) @ rot_y(a)
        # lente: bordas finas como um lobo hepatico de verdade
        d = ellipsoid(q, np.zeros(3), r)
        thin = np.abs(q[:, 1]) - r[1] * (1.0 - (q[:, 0] / r[0]) ** 2 * 0.55 - (q[:, 2] / r[2]) ** 2 * 0.55)
        return smax(d, thin, 0.01)

    def f(p):
        d = lobe(p, np.array([-0.1, 0.13, -0.06]), [0.12, 0.05, 0.11], 0.35)       # lobo esquerdo (maior)
        d = smin(d, lobe(p, np.array([0.1, 0.13, -0.07]), [0.1, 0.045, 0.095], -0.35), 0.012)   # direito
        d = smin(d, lobe(p, np.array([0.0, 0.115, -0.045]), [0.055, 0.035, 0.07], 0.0), 0.02)    # mediano
        # o coracao fica num recesso na frente do figado
        d = smax(d, -ellipsoid(p, HEART_C + [0, -0.01, 0.01], [0.075, 0.08, 0.095]), 0.01)
        return d + 0.0015 * (vnoise(p, 40) - 0.5)
    sdf_mesh("figado", "corpo", "figado", f, [-0.25, 0.04, -0.23], [0.22, 0.22, 0.06], 0.0035, clip=lambda p: cav(p) + 0.002)
    gb = np.array([0.025, 0.13, -0.03])
    sdf_mesh("vesicula", "corpo", "vesicula", lambda p: ellipsoid(p, gb, [0.018, 0.016, 0.022]), gb - 0.04, gb + 0.04, 0.0025)
    duct = curve([gb + [0, 0.01, 0.015], np.array([0.0, 0.14, 0.02]), np.array([-0.02, 0.135, 0.05])], 10)
    tube("ducto_coledoco", "corpo", "vesicula", duct, 0.003, 6)


# ------------------------------------------------------------------ tubo digestivo
STOMACH = [np.array([0.0, 0.31, -0.3]), np.array([-0.045, 0.3, -0.22]), np.array([-0.11, 0.27, -0.13]), np.array([-0.135, 0.23, -0.04]),
           np.array([-0.115, 0.185, 0.03]), np.array([-0.065, 0.155, 0.065]), np.array([-0.035, 0.15, 0.065])]
STOMACH_R = [0.022, 0.034, 0.052, 0.056, 0.048, 0.03, 0.02]


def stomach_sdf(p):
    return chain(p, STOMACH, STOMACH_R, 0.03)


def gut(cav):
    sdf_mesh("estomago", "corpo", "estomago", lambda p: stomach_sdf(p) + 0.0012 * np.sin(p[:, 2] * 260 + p[:, 0] * 90),
             [-0.22, 0.08, -0.34], [0.05, 0.37, 0.12], 0.0035, pivot=STOMACH[1], clip=lambda p: cav(p) + 0.002)
    # pancreas: tecido lobulado claro entre o estomago e o duodeno
    def pan(p):
        d = chain(p, [np.array([-0.07, 0.17, 0.04]), np.array([-0.02, 0.155, 0.04]), np.array([0.03, 0.15, 0.01])], [0.012, 0.017, 0.01], 0.01)
        return d + 0.004 * (vnoise(p, 120) - 0.5)
    sdf_mesh("pancreas", "corpo", "pancreas", pan, [-0.11, 0.1, -0.03], [0.07, 0.21, 0.09], 0.0025)
    # baco: esfera vermelho-escura no mesenterio perto do intestino grosso
    sp = np.array([0.03, 0.235, 0.15])
    sdf_mesh("baco", "corpo", "baco", lambda p: ellipsoid(p, sp, [0.016, 0.014, 0.018]), sp - 0.03, sp + 0.03, 0.0022)
    # intestino grosso: reto e largo ate a cloaca
    colon = [np.array([0.0, 0.2, 0.235]), np.array([0.0, 0.19, 0.3]), np.array([0.0, 0.165, 0.355]), np.array([0.0, 0.135, 0.395])]
    sdf_mesh("intestino_grosso", "corpo", "colon", lambda p: chain(p, colon, [0.028, 0.034, 0.03, 0.016], 0.02),
             [-0.06, 0.08, 0.18], [0.06, 0.26, 0.43], 0.003, clip=lambda p: cav(p) + 0.002)
    # duodeno + intestino delgado (ileo), acomodado por relaxacao
    start = np.array([-0.035, 0.15, 0.065])
    duo = [start, np.array([0.02, 0.14, 0.06]), np.array([0.07, 0.15, 0.03]), np.array([0.1, 0.16, 0.05])]
    end = np.array([0.0, 0.205, 0.215])
    path = coil(duo, end, cav)
    tube("intestino_delgado", "corpo", "intestino", path, 0.0135, 12, pivot=np.array([0.0, 0.17, 0.12]))
    mes = curve([np.array([0.0, 0.4, 0.05]), np.array([0.01, 0.3, 0.1]), np.array([0.02, 0.22, 0.13])], 10)
    tube("vasos_mesentericos", "corpo", "arteria", mes, 0.003, 6)
    # cloaca
    cl = np.array([0.0, 0.125, 0.41])
    sdf_mesh("cloaca", "corpo", "colon", lambda p: ellipsoid(p, cl, [0.02, 0.018, 0.02]), cl - 0.03, cl + 0.03, 0.0025)


def obstacles(p):
    d = stomach_sdf(p)
    d = np.minimum(d, ellipsoid(p, np.array([-0.1, 0.13, -0.06]), [0.12, 0.05, 0.11]))
    d = np.minimum(d, ellipsoid(p, np.array([0.1, 0.13, -0.07]), [0.1, 0.045, 0.095]))
    for sg in (-1, 1):
        d = np.minimum(d, ellipsoid(p, np.array([0.045 * sg, 0.33, 0.16]), [0.035, 0.03, 0.11]))  # rins
    d = np.minimum(d, chain(p, [np.array([0.0, 0.2, 0.235]), np.array([0.0, 0.19, 0.3]), np.array([0.0, 0.165, 0.36])], [0.028, 0.034, 0.03]))
    d = np.minimum(d, ellipsoid(p, np.array([0.0, 0.1, 0.33]), [0.07, 0.035, 0.045]))   # bexiga
    return d


def coil(duo, end, cav, r=0.0135, length=1.45):
    """Intestino delgado: meandros iniciais em camadas, depois relaxacao."""
    seg = 0.011
    n = int(length / seg)
    # caminho inicial: alcas em serpentina em duas camadas
    ctrl = [*duo]
    layers = [0.13, 0.19, 0.25]
    zs = np.linspace(0.07, 0.2, 5)
    for li, y in enumerate(layers):
        for zi, z in enumerate(zs if li % 2 == 0 else zs[::-1]):
            x = 0.13 if (zi + li) % 2 == 0 else -0.13
            ctrl.append(np.array([x, y, z]))
    ctrl.append(end)
    pts = curve(ctrl, n * 3)
    # reamostra com passo fixo
    def resample(pts, n):
        d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
        t = np.linspace(0, d[-1], n)
        return np.stack([np.interp(t, d, pts[:, i]) for i in range(3)], 1)
    pts = resample(pts, n)
    fixed = len(duo) * 4
    for it in range(500):
        f = np.zeros_like(pts)
        # afastamento entre partes nao vizinhas
        D = pts[:, None, :] - pts[None, :, :]
        dist = np.linalg.norm(D, axis=2) + np.eye(len(pts))
        near = (dist < 2.25 * r) & (np.abs(np.arange(len(pts))[:, None] - np.arange(len(pts))[None, :]) > 3)
        push = np.where(near, (2.25 * r - dist) / dist, 0.0)
        f += 0.5 * np.sum(D * push[:, :, None], axis=1)
        # dentro da cavidade e fora dos outros orgaos
        e = 0.002
        for fn, m in ((cav, r + 0.004), (lambda q: -obstacles(q), r + 0.003)):
            v = fn(pts) + m
            bad = v > 0
            if bad.any():
                g = np.stack([fn(pts + [e, 0, 0]) - fn(pts - [e, 0, 0]), fn(pts + [0, e, 0]) - fn(pts - [0, e, 0]),
                              fn(pts + [0, 0, e]) - fn(pts - [0, 0, e])], 1)
                g /= np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)
                f[bad] -= g[bad] * v[bad, None] * 0.6
        # comprimento dos segmentos + suavidade (dobra)
        dd = np.diff(pts, axis=0)
        L = np.linalg.norm(dd, axis=1, keepdims=True)
        corr = dd * (1 - seg / np.maximum(L, 1e-9)) * 0.5
        f[:-1] += corr
        f[1:] -= corr
        lap = np.zeros_like(pts)
        lap[1:-1] = (pts[:-2] + pts[2:]) * 0.5 - pts[1:-1]
        f += 0.08 * lap
        f[:fixed] = 0
        f[-2:] = 0
        pts += np.clip(f, -0.004, 0.004)
    over = np.sum((np.linalg.norm(pts[:, None] - pts[None], axis=2) < 1.9 * r) & (np.abs(np.arange(len(pts))[:, None] - np.arange(len(pts))[None]) > 3)) // 2
    print("  intestino: %d pontos, %.2f SVL, %d contatos fortes" % (len(pts), np.sum(np.linalg.norm(np.diff(pts, axis=0), axis=1)), over))
    return curve(pts[::2], len(pts) * 2)


# ------------------------------------------------------------------ rins, gonadas, gordura, bexiga
KIDNEY = {sg: [np.array([0.045 * sg, 0.36, 0.06]), np.array([0.05 * sg, 0.335, 0.15]), np.array([0.04 * sg, 0.29, 0.25])] for sg in (-1, 1)}


def uro_genital(cav):
    for sg, s in ((1, "R"), (-1, "L")):
        k = KIDNEY[sg]
        def kid(p, k=k):
            d = chain(p, k, [0.022, 0.03, 0.018], 0.03)
            d = smax(d, (p[:, 1] - 0.39 + (p[:, 2] - 0.06) * 0.5), 0.01)   # achatado contra o dorso
            return d + 0.002 * (vnoise(p, 80) - 0.5)
        sdf_mesh("rim_" + s, "corpo", "rim", kid, [0.0 if sg > 0 else -0.11, 0.24, 0.0], [0.11 if sg > 0 else 0.0, 0.42, 0.3], 0.003,
                 clip=lambda p: cav(p) + 0.001)
        ad = curve([k[0] + [0.0, -0.02, 0.02], k[1] + [0.0, -0.027, 0.0], k[2] + [0.0, -0.015, -0.02]], 12)
        tube("adrenal_" + s, "corpo", "adrenal", ad, 0.0035, 6)
        ur = curve([k[2], np.array([0.02 * sg, 0.22, 0.33]), np.array([0.008 * sg, 0.15, 0.39])], 14)
        tube("ureter_" + s, "corpo", "ureter", ur, 0.0028, 6)
        # testiculos (macho): feijoes amarelados na frente dos rins
        t = np.array([0.055 * sg, 0.305, 0.07])
        sdf_mesh("testiculo_" + s, "corpo", "testiculo", lambda p, t=t: ellipsoid(p, t, [0.02, 0.018, 0.042]), t - 0.06, t + 0.06, 0.0025)
        # ovario (femea): massa lobulada; os ovulos vao por MultiMesh
        o = np.array([0.1 * sg, 0.25, 0.08])
        def ov(p, o=o, sg=sg):
            d = ellipsoid(p, o, [0.075, 0.075, 0.11])
            return d + 0.012 * (vnoise(p, 30) - 0.5)
        sdf_mesh("ovario_" + s, "corpo", "ovario", ov, o - 0.13, o + 0.13, 0.004, pivot=o, clip=lambda p: cav(p) + 0.003)
        # oviduto enovelado: do lado do pulmao ate a cloaca
        ctrl = []
        for i in range(14):
            z = -0.2 + i * 0.038
            ctrl.append(np.array([sg * (0.165 + 0.02 * np.sin(i * 2.1)), 0.3 - 0.01 * i + 0.02 * np.cos(i * 1.7), z]))
        ctrl += [np.array([0.05 * sg, 0.17, 0.36]), np.array([0.01 * sg, 0.14, 0.395])]
        od = curve(ctrl, 120)
        od += np.stack([np.zeros(len(od)), 0.008 * np.sin(np.arange(len(od)) * 0.9), 0.008 * np.cos(np.arange(len(od)) * 0.9)], 1)
        tube("oviduto_" + s, "corpo", "oviduto", od, 0.0065, 8)
        # corpos gordurosos: dedos amarelos na frente das gonadas
        base = np.array([0.06 * sg, 0.3, 0.03])
        def fat(p, base=base, sg=sg):
            d = None
            for i in range(5):
                a = -0.6 + i * 0.3
                tip = base + np.array([sg * (0.03 + 0.05 * np.sin(a + 0.6)), -0.02 - 0.01 * i, -0.09 - 0.02 * np.cos(a * 2)])
                mid = (base + tip) * 0.5 + [0.01 * sg, 0.01, 0]
                di = chain(p, [base, mid, tip], [0.01, 0.013, 0.006], 0.01)
                d = di if d is None else smin(d, di, 0.006)
            return d + 0.003 * (vnoise(p, 110) - 0.5)
        sdf_mesh("gordura_" + s, "corpo", "gordura", fat, base - [0.1, 0.08, 0.16], base + [0.12, 0.05, 0.03], 0.0025, pivot=base)
    # bexiga bilobada, de parede fina, ventral a cloaca
    def bl(p):
        return smin(ellipsoid(p, np.array([0.035, 0.105, 0.325]), [0.04, 0.03, 0.045]), ellipsoid(p, np.array([-0.035, 0.105, 0.325]), [0.04, 0.03, 0.045]), 0.02)
    sdf_mesh("bexiga", "corpo", "bexiga", bl, [-0.1, 0.05, 0.26], [0.1, 0.16, 0.4], 0.003, pivot=np.array([0.0, 0.12, 0.37]), clip=lambda p: cav(p) + 0.002)


def ovary_eggs():
    eggs = {}
    for sg, s in ((1, "R"), (-1, "L")):
        o = np.array([0.1 * sg, 0.25, 0.08])
        pts = []
        tries = 0
        while len(pts) < 150 and tries < 20000:
            tries += 1
            q = o + (RNG.random(3) - 0.5) * [0.15, 0.15, 0.22]
            if ellipsoid(q[None], o, [0.068, 0.068, 0.1])[0] > 0:
                continue
            if abs(q[0]) > 0.215:
                continue
            if all(np.linalg.norm(q - e) > 0.019 for e in pts):
                pts.append(q)
        eggs[s] = [[round(float(v), 5) for v in (e - o)] + [round(float(0.0085 + RNG.random() * 0.002), 5)] for e in pts]
        eggs[s + "_pivot"] = o.round(5).tolist()
    return eggs


# ------------------------------------------------------------------ encefalo e nervos
BRAIN_Y = 0.42


def brain_nerves(skin):
    y = BRAIN_Y
    def br(p):
        d = None
        parts = []
        for sg in (-1, 1):
            parts += [ellipsoid(p, np.array([0.009 * sg, y - 0.004, -0.515]), [0.009, 0.009, 0.022]),     # bulbos olfatorios
                      ellipsoid(p, np.array([0.017 * sg, y, -0.462]), [0.018, 0.017, 0.038]),       # hemisferios
                      ellipsoid(p, np.array([0.02 * sg, y + 0.004, -0.39]), [0.02, 0.019, 0.022])]   # teto optico
        parts += [ellipsoid(p, np.array([0.0, y - 0.006, -0.418]), [0.014, 0.014, 0.018]),            # diencefalo
                  ellipsoid(p, np.array([0.0, y + 0.012, -0.362]), [0.018, 0.005, 0.007]),            # cerebelo (prega)
                  capsule(p, [0, y - 0.002, -0.37], [0, y - 0.005, -0.31], 0.014, 0.01),             # bulbo
                  ellipsoid(p, np.array([0.0, y - 0.022, -0.425]), [0.006, 0.01, 0.008])]            # hipofise
        for q in parts:
            d = q if d is None else smin(d, q, 0.005)
        # sulco entre os hemisferios
        return d + 0.004 * np.exp(-(p[:, 0] / 0.003) ** 2) * (p[:, 2] < -0.37)
    sdf_mesh("encefalo", "cabeca", "cerebro", br, [-0.05, y - 0.05, -0.55], [0.05, y + 0.05, -0.29], 0.002)
    # medula espinhal: curta nas ras (acaba no filum terminal)
    sc = curve([np.array([0.0, y - 0.005, -0.31]), np.array([0.0, 0.445, -0.25]), np.array([0.0, 0.438, -0.12]), np.array([0.0, 0.43, -0.02]),
                np.array([0.0, 0.415, 0.06])], 30)
    tube("medula", "corpo", "cerebro", sc, np.linspace(0.009, 0.0035, len(sc)), 10)
    fil = curve([np.array([0.0, 0.415, 0.06]), np.array([0.0, 0.39, 0.13]), np.array([0.0, 0.33, 0.24])], 12)
    tube("filum", "corpo", "nervo", fil, 0.0022, 6)
    for sg, s in ((1, "R"), (-1, "L")):
        # nervos opticos (quiasma -> olhos)
        on = curve([np.array([0.0, y - 0.015, -0.42]), np.array([0.05 * sg, y - 0.01, -0.405]), np.array([0.11 * sg, y - 0.005, -0.37])], 12)
        tube("nervo_optico_" + s, "cabeca", "nervo", on, 0.0035, 6)
        ol = curve([np.array([0.009 * sg, y - 0.004, -0.535]), np.array([0.02 * sg, y - 0.005, -0.56]), np.array([0.03 * sg, y - 0.01, -0.585])], 8)
        tube("nervo_olfatorio_" + s, "cabeca", "nervo", ol, 0.0025, 6)
        # plexo braquial (nervo 2) para o braco e ramos intercostais
        bp = curve([np.array([0.0, 0.445, -0.24]), np.array([0.05 * sg, 0.4, -0.23]), np.array([0.1 * sg, 0.28, -0.215]), np.array([0.13 * sg, 0.19, -0.205])], 16)
        tube("plexo_braquial_" + s, "corpo", "nervo", bp, 0.0035, 6)
        for k, z in enumerate((-0.16, -0.08, 0.0)):
            sn = curve([np.array([0.0, 0.436, z]), np.array([0.05 * sg, 0.42, z + 0.02]), np.array([0.12 * sg, 0.36, z + 0.05])], 10)
            tube("nervo_espinhal_%d_%s" % (k, s), "corpo", "nervo", sn, 0.0022, 5)
        # plexo sacral -> nervo isquiatico (o maior do corpo) ate o quadril
        sci = curve([np.array([0.0, 0.415, 0.06]), np.array([0.035 * sg, 0.39, 0.12]), np.array([0.07 * sg, 0.3, 0.24]), np.array([0.09 * sg, 0.18, 0.32])], 18)
        tube("isquiatico_" + s, "corpo", "nervo", sci, 0.0045, 8)


# ------------------------------------------------------------------ esqueleto
def lip_arc(skin, dy):
    """Arco em U que segue o labio (medido na propria pele)."""
    side = []
    for z in np.linspace(-0.56, -0.3, 12):
        y = np.interp(z, [-0.585, -0.3], [0.385, 0.315]) + dy
        xs = np.arange(0.0, 0.3, 0.002)
        q = np.stack([xs, np.full_like(xs, y), np.full_like(xs, z)], 1)
        ok = np.where(skin(q) < -0.013)[0]
        if len(ok):
            side.append(np.array([xs[ok[-1]], y, z]))
    front = np.array([0.0, 0.385 + dy, -0.572])
    return [mirror(p) for p in side[::-1]] + [front] + side


def skeleton(skin, bones):
    head_clip = lambda p: skin(p) + 0.012
    # cranio: caixa craniana (esfenetmoide + frontoparietais), arco maxilar,
    # pterigoides, parasfenoide em cruz, esquamosais; orbitas abertas
    y = BRAIN_Y
    def skull(p):
        box = capsule(p, [0, y, -0.54], [0, y, -0.32], 0.034, 0.03)
        box = smax(box, -capsule(p, [0, y, -0.53], [0, y, -0.33], 0.026, 0.023), 0.004)     # oco (o encefalo fica dentro)
        roof = smax(ellipsoid(p, np.array([0, y + 0.03, -0.43]), [0.05, 0.008, 0.13]), -ellipsoid(p, np.array([0, y + 0.03, -0.43]), [0.03, 0.02, 0.02]), 0.003)
        d = smin(box, roof, 0.01)
        # arco maxilar: segue o labio, em U
        arc = lip_arc(skin, 0.0)
        for i in range(len(arc) - 1):
            d = smin(d, capsule(p, arc[i], arc[i + 1], 0.009, 0.009), 0.006)
        for sg in (-1, 1):
            # pterigoide: do arco ate a caixa craniana atras da orbita
            d = smin(d, chain(p, [arc[0 if sg < 0 else -1] * [1, 1, 1], np.array([0.09 * sg, 0.37, -0.34]), np.array([0.03 * sg, y - 0.02, -0.36])], [0.008, 0.007, 0.007]), 0.008)
            # esquamosal: da regiao otica para baixo ate a articulacao da mandibula
            d = smin(d, chain(p, [np.array([0.04 * sg, y + 0.01, -0.34]), np.array([0.12 * sg, y + 0.01, -0.31]), arc[0 if sg < 0 else -1]], [0.008, 0.009, 0.008]), 0.008)
            # capsula otica (ouvido interno) e anel timpanico
            d = smin(d, ellipsoid(p, np.array([0.05 * sg, y, -0.335]), [0.022, 0.02, 0.022]), 0.008)
            # parasfenoide (palato em cruz)
            d = smin(d, capsule(p, [0.0, y - 0.035, -0.5], [0.0, y - 0.035, -0.34], 0.01, 0.008), 0.01)
            d = smin(d, capsule(p, [0.0, y - 0.035, -0.37], [0.07 * sg, y - 0.03, -0.35], 0.007, 0.005), 0.008)
        return d
    sdf_mesh("cranio", "cabeca", "cranio", skull, [-0.25, 0.28, -0.62], [0.25, 0.49, -0.26], 0.003, clip=head_clip, clip_k=0.006)
    # mandibula
    jaw_pts = lip_arc(skin, -0.022)
    def jaw(p):
        d = None
        pts = jaw_pts
        for i in range(len(pts) - 1):
            s = capsule(p, pts[i], pts[i + 1], 0.009, 0.009)
            d = s if d is None else smin(d, s, 0.004)
        return d
    sdf_mesh("mandibula", "cabeca", "cranio", jaw, [-0.25, 0.25, -0.62], [0.25, 0.36, -0.24], 0.003, clip=head_clip, clip_k=0.006)
    # coluna: 8 vertebras pre-sacrais (processos transversos), sacral com diapofises largas, urostilo
    def spine(p):
        d = None
        zs = np.linspace(-0.285, 0.06, 8)
        for i, z in enumerate(zs):
            yv = 0.445 - 0.035 * (i / 7) ** 1.5
            c = np.array([0.0, yv - 0.012, z])
            v = capsule(p, c - [0, 0, 0.018], c + [0, 0, 0.018], 0.014, 0.014)                               # centro
            v = smin(v, smax(ellipsoid(p, c + [0, 0.014, 0], [0.02, 0.016, 0.02]), -capsule(p, c + [0, 0.012, -0.05], c + [0, 0.012, 0.05], 0.009, 0.009), 0.003), 0.004)  # arco neural
            span = 0.07 if i in (2, 3) else 0.05 if i < 6 else 0.045
            for sg in (-1, 1):
                v = smin(v, capsule(p, c + [0.0, 0.01, 0], c + [span * sg, 0.02 - 0.012 * (i == 2), 0.005 * i], 0.006, 0.004), 0.004)
            d = v if d is None else np.minimum(d, v)
        c = np.array([0.0, 0.395, 0.105])
        sac = capsule(p, c - [0, 0, 0.016], c + [0, 0, 0.016], 0.015, 0.015)
        for sg in (-1, 1):
            sac = smin(sac, chain(p, [c, c + [0.05 * sg, 0.005, 0.01], c + [0.085 * sg, 0.0, 0.015]], [0.009, 0.011, 0.016]), 0.008)
        d = np.minimum(d, sac)
        d = np.minimum(d, capsule(p, [0, 0.38, 0.125], [0, 0.23, 0.345], 0.011, 0.006))       # urostilo
        return d
    sdf_mesh("coluna", "corpo", "osso", spine, [-0.13, 0.19, -0.33], [0.13, 0.49, 0.37], 0.0028)
    # pelve: ilios longos da sacral ate o acetabulo; isquio+pubis em disco
    def pelvis(p):
        d = None
        for sg in (-1, 1):
            il = chain(p, [np.array([0.085 * sg, 0.395, 0.12]), np.array([0.075 * sg, 0.3, 0.23]), np.array([0.055 * sg, 0.18, 0.32])], [0.011, 0.01, 0.012], 0.01)
            d = il if d is None else np.minimum(d, il)
        disc = ellipsoid(p, np.array([0.0, 0.15, 0.335]), [0.07, 0.04, 0.02])
        disc = smax(disc, -ellipsoid(p, np.array([0.08, 0.14, 0.33]), [0.028, 0.028, 0.05]), 0.004)
        disc = smax(disc, -ellipsoid(p, np.array([-0.08, 0.14, 0.33]), [0.028, 0.028, 0.05]), 0.004)
        return smin(d, disc, 0.02)
    sdf_mesh("pelve", "corpo", "osso", pelvis, [-0.14, 0.09, 0.08], [0.14, 0.43, 0.38], 0.003)
    # cintura escapular + esterno
    def girdle(p):
        d = None
        for sg in (-1, 1):
            sh = bones["umero_" + ("R" if sg > 0 else "L")][0]
            g = chain(p, [sh + [0.0, 0.01, 0.0], sh + [0.025 * sg, 0.08, 0.0], np.array([0.15 * sg, 0.34, -0.2])], [0.01, 0.012, 0.01], 0.01)  # escapula
            ss = smax(ellipsoid(p, np.array([0.12 * sg, 0.4, -0.19]), [0.05, 0.045, 0.035]) , np.abs((p - np.array([0.12 * sg, 0.4, -0.19])) @ np.array([0.6 * sg, 0.8, 0.0])) - 0.004, 0.003)  # supraescapula (lamina)
            cl = capsule(p, sh + [0, -0.01, -0.01], np.array([0.0, 0.13, -0.235]), 0.007, 0.006)              # clavicula
            co = capsule(p, sh + [0, -0.015, 0.005], np.array([0.0, 0.125, -0.19]), 0.01, 0.012)              # coracoide
            g = smin(smin(g, cl, 0.01), co, 0.012)
            g = np.minimum(g, ss)
            d = g if d is None else np.minimum(d, g)
        return d
    sdf_mesh("cintura_escapular", "corpo", "osso", girdle, [-0.22, 0.08, -0.33], [0.22, 0.47, -0.07], 0.003)
    # esterno: omosterno na frente e xifisterno (placa de cartilagem) atras
    st = lambda p: np.minimum(ellipsoid(p, np.array([0.0, 0.115, -0.13]), [0.03, 0.005, 0.045]), ellipsoid(p, np.array([0.0, 0.13, -0.28]), [0.02, 0.005, 0.03]))
    sdf_mesh("esterno", "corpo", "cartilagem", st, [-0.06, 0.08, -0.33], [0.06, 0.16, -0.07], 0.0025)
    # ossos dos membros (no espaco do proprio osso)
    for s in ("R", "L"):
        for b in ("femur", "tibia", "tarso", "pe", "umero", "antebraco", "mao"):
            a, t = bones[b + "_" + s]
            limb_bone(b, s, a, t)


def perp(d):
    d = d / np.linalg.norm(d)
    u = np.cross(d, [0, 1, 0])
    if np.linalg.norm(u) < 1e-3:
        u = np.cross(d, [1, 0, 0])
    u /= np.linalg.norm(u)
    return d, u, np.cross(u, d)


def limb_bone(b, s, a, t):
    L = np.linalg.norm(t - a)
    d, u, v = perp(t - a)
    sg = 1 if s == "R" else -1
    name = "osso_%s_%s" % (b, s)
    r = {"femur": 0.011, "tibia": 0.012, "tarso": 0.007, "umero": 0.01, "antebraco": 0.009}.get(b, 0.006)
    if b in ("pe", "mao"):
        # metatarsos/metacarpos + falanges em leque (5 dedos no pe, 4 na mao)
        nd_ = 5 if b == "pe" else 4
        L2 = L * (1.35 if b == "pe" else 1.1)
        def f(p):
            dd = None
            for i in range(nd_):
                ang = (i - (nd_ - 1) / 2) * (0.22 if b == "pe" else 0.35)
                lens = [0.65, 0.95, 1.0, 1.25, 0.85][i] if b == "pe" else [0.7, 0.9, 1.0, 0.8][i]
                dir_ = d * np.cos(ang) + u * np.sin(ang)
                tip = a + dir_ * L2 * lens
                mid = a + dir_ * L2 * lens * 0.45
                s_ = chain(p, [a + dir_ * 0.01, mid, tip], [0.0045, 0.0035, 0.0025], 0.0)
                for k in (0.45, 0.7):
                    s_ = smin(s_, np.linalg.norm(p - (a + dir_ * L2 * lens * k), axis=1) - 0.0045, 0.002)
                dd = s_ if dd is None else np.minimum(dd, s_)
            return dd
        lo = np.minimum(a, t) - L2 * 1.3
        hi = np.maximum(a, t) + L2 * 1.3
        sdf_mesh(name, b + "_" + s, "osso", f, lo, hi, 0.0025, pivot=a)
        return
    def f(p):
        if b == "tarso":
            # astragalo e calcaneo: dois ossos longos lado a lado, unidos nas pontas
            dd = np.minimum(capsule(p, a + u * 0.006, t + u * 0.006, r, r), capsule(p, a - u * 0.006, t - u * 0.006, r, r))
            return smin(dd, np.minimum(np.linalg.norm(p - a, axis=1) - r * 1.8, np.linalg.norm(p - t, axis=1) - r * 1.7), 0.006)
        # diafise fina, epifises largas (cartilagem nas pontas fica no material)
        dd = capsule(p, a + d * 0.01, t - d * 0.01, r * 0.8, r * 0.75)
        dd = smin(dd, ellipsoid(p, a + d * 0.008, [r * 1.7] * 3), 0.008)
        dd = smin(dd, ellipsoid(p, t - d * 0.008, [r * 1.8] * 3), 0.008)
        if b == "umero":
            dd = smin(dd, capsule(p, a + d * L * 0.15 + v * r * 0.9, a + d * L * 0.5 + v * r * 0.6, r * 0.6, r * 0.3), 0.006)   # crista deltoide
        if b == "tibia":
            dd = smax(dd, -capsule(p, a + d * L * 0.2 + v * r * 0.9, t - d * L * 0.2 + v * r * 0.9, r * 0.25, r * 0.25), 0.002)  # sulco tibio-fibular
        return dd
    lo = np.minimum(a, t) - 0.04
    hi = np.maximum(a, t) + 0.04
    sdf_mesh(name, b + "_" + s, "osso", f, lo, hi, 0.0022, pivot=a)


# ------------------------------------------------------------------ musculos
def muscles(skin, bones):
    for s in ("R", "L"):
        for b, spec in MUSCLES.items():
            a, t = bones[b + "_" + s]
            d, u, v = perp(t - a)
            L = np.linalg.norm(t - a)
            for mname, (off0, off1, r0, rmax, r1, belly, frac) in spec.items():
                # fuso: origem, ventre e insercao deslocados do eixo do osso
                o0 = np.array(off0)
                o1 = np.array(off1)
                p0 = a + d * L * frac[0] + (u * o0[0] + v * o0[1]) * (1 if s == "R" else 1)
                p1 = t * 0 + a + d * L * frac[1] + (u * o1[0] + v * o1[1])
                pm = p0 + (p1 - p0) * belly
                pm_off = pm + (u * (o0[0] + o1[0]) + v * (o0[1] + o1[1])) * 0.5
                ctrl = [p0, (p0 + pm_off) * 0.5, pm_off, (pm_off + p1) * 0.5, p1]
                rad = [r0, rmax * 0.75, rmax, rmax * 0.7, r1]
                pts = curve(ctrl, 30)
                tt = np.linspace(0, 1, len(pts))
                rr = np.interp(tt, np.linspace(0, 1, 5), rad)
                # recorta pela pele do membro (em repouso)
                ok = skin(pts) + rr * 0.6
                rr = np.where(ok > 0, np.maximum(rr - ok, rr * 0.45), rr)
                bul = np.clip(1 - np.abs(tt - belly) / 0.5, 0, 1) ** 1.5
                tube("musc_%s_%s_%s" % (b, mname, s), b + "_" + s, "musculo", pts, rr, 16, pivot=a, bulge=bul)
            if b == "tibia":
                # tendao de Aquiles (do gastrocnemio a planta)
                ten = curve([t - d * L * 0.1 - v * 0.018, t - v * 0.014, t + d * 0.02 - v * 0.01], 10)
                tube("tendao_aquiles_" + s, b + "_" + s, "tendao", ten, 0.004, 8, pivot=a)


# musculo: (desloc. na origem (u,v), desloc. na insercao, r origem, r ventre, r insercao, posicao do ventre, (frac. inicio, fim))
MUSCLES = {
    "femur": {
        "cruralis": ((0.0, 0.018), (0.0, 0.012), 0.016, 0.046, 0.014, 0.5, (0.0, 1.05)),
        "semimembranoso": ((0.0, -0.02), (0.0, -0.014), 0.016, 0.041, 0.011, 0.45, (0.0, 1.05)),
        "gracilis": ((0.022, -0.004), (0.015, -0.006), 0.014, 0.035, 0.009, 0.5, (0.0, 1.08)),
        "sartorio": ((-0.02, 0.006), (-0.016, 0.0), 0.008, 0.018, 0.007, 0.5, (0.02, 1.05)),
    },
    "tibia": {
        "gastrocnemio": ((0.0, -0.016), (0.0, -0.014), 0.016, 0.043, 0.008, 0.32, (-0.04, 0.92)),
        "tibial_anterior": ((0.0, 0.014), (0.0, 0.01), 0.011, 0.023, 0.007, 0.45, (0.0, 0.95)),
        "peroneo": ((0.016, 0.0), (0.012, 0.0), 0.008, 0.018, 0.005, 0.4, (0.0, 0.95)),
    },
    "umero": {
        "deltoide": ((0.0, 0.014), (0.0, 0.01), 0.011, 0.023, 0.008, 0.35, (0.0, 0.9)),
        "triceps": ((0.0, -0.014), (0.0, -0.01), 0.012, 0.026, 0.008, 0.45, (0.0, 1.02)),
    },
    "antebraco": {
        "flexores": ((0.0, -0.01), (0.0, -0.006), 0.011, 0.020, 0.005, 0.3, (0.0, 0.9)),
        "extensores": ((0.0, 0.01), (0.0, 0.006), 0.009, 0.018, 0.005, 0.3, (0.0, 0.9)),
    },
}


# ------------------------------------------------------------------ saida
def write(eggs, name="frog_organs"):
    """ORG2: posicoes em meia precisao (float16), normais em int8, cor em
    uint8, indices uint32 (o arquivo fica ~3x menor)."""
    with open(OUT / (name + ".bin"), "wb") as f:
        f.write(struct.pack("<4sI", b"ORG2", len(MESHES)))
        for m in MESHES:
            for sname in (m["name"], m["bone"], m["mat"]):
                b = sname.encode()
                f.write(struct.pack("<H", len(b)) + b)
            f.write(struct.pack("<3f", *m["pivot"]))
            f.write(struct.pack("<II", len(m["V"]), m["F"].size))
            f.write(m["V"].astype("<f2").tobytes())
            f.write(np.clip(np.round(m["N"] * 127), -127, 127).astype("i1").tobytes())
            f.write(np.clip(np.round(np.asarray(m["C"]) * 255), 0, 255).astype("u1").tobytes())
            f.write(m["F"].astype("<u4").tobytes())
    (OUT / (name + ".json")).write_text(json.dumps({"ovulos": eggs, "malhas": [m["name"] for m in MESHES]}))
    tv = sum(len(m["V"]) for m in MESHES)
    print("%d malhas, %d vertices, %.1f MB" % (len(MESHES), tv, (OUT / (name + ".bin")).stat().st_size / 1e6))


if __name__ == "__main__":
    main()
