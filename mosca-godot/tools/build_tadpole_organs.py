#!/usr/bin/env python3
"""Orgaos internos do girino (estagios de Gosner ~26-41), esculpidos dentro
do corpo do TadpoleModel (comprimento total = 1, focinho em z = -0.5).

    python3 tools/build_tadpole_organs.py

Usa as mesmas ferramentas de build_frog_organs.py (SDF + marching cubes,
tubos varridos). Anatomia (McDiarmid & Altig, Tadpoles; Viertel &
Richter 1999):
  - intestino longo enrolado em espiral dupla (vai para o centro e volta),
    precedido pelo esofago e pelo "manicotto" glandular; reto ate o
    tubo cloacal (abre a direita da nadadeira ventral)
  - figado grande a direita/frente do novelo, vesicula biliar
  - coracao ventral sob as branquias: seio venoso, atrio, ventriculo, bulbo
    e tronco arterial com as 4 arterias branquiais aferentes
  - branquias internas: 4 arcos de cada lado com filamentos em franja,
    dentro da camara branquial (a agua sai pelo espiraculo)
  - pronefros (rim larval) atras das branquias, pulmoes dorsais (crescem
    perto da metamorfose), encefalo, medula e notocorda
Saida: frog/girino_organs.bin + frog/girino_organs.json
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_frog_organs as B  # noqa: E402
from build_frog_organs import capsule, chain, curve, ellipsoid, sdf_mesh, smin, tube, vnoise  # noqa: E402

BODY_FRAC = 0.36


def profile(t):
    k = np.clip(t / BODY_FRAC, 0, 1)
    w = 0.13 * np.sin(np.pi * np.clip(k * 0.9 + 0.06, 0, 1)) ** 0.6
    h = 0.105 * np.sin(np.pi * np.clip(k * 0.92 + 0.05, 0, 1)) ** 0.75
    return w, h


def body(p):
    t = p[:, 2] + 0.5
    w, h = profile(t)
    hh = np.where(p[:, 1] > 0, h, h * 0.85)
    w = np.maximum(w, 1e-3)
    hh = np.maximum(hh, 1e-3)
    r = np.sqrt((p[:, 0] / w) ** 2 + (p[:, 1] / hh) ** 2)
    d = (r - 1.0) * np.minimum(w, hh)
    d = np.where((t < 0) | (t > BODY_FRAC + 0.02), np.maximum(d, 0.05), d)
    return d


def inside(m):
    return lambda p: body(p) + m


def main():
    clip = inside(0.012)
    # ------------------------------------------------ tubo digestivo
    # espiral dupla: entra girando ate o centro e sai girando no sentido oposto
    c = np.array([0.0, -0.045, -0.285])
    pts = []
    n = 150
    for k in range(n):
        tt = k / (n - 1)
        if tt < 0.5:
            a = tt / 0.5 * np.pi * 2 * 2.6
            r = 0.095 * (1 - tt / 0.5 * 0.82)
            ang = a
        else:
            q = (tt - 0.5) / 0.5
            a = q * np.pi * 2 * 2.6
            r = 0.095 * (0.18 + q * 0.78)
            ang = -a + np.pi * 0.9
        y = c[1] + 0.012 * np.sin(a * 1.3) + (0.012 if tt >= 0.5 else -0.006)
        pts.append(c + np.array([np.cos(ang) * r, y - c[1], np.sin(ang) * r * 0.95]))
    pts = np.array(pts)
    # achata para caber na barriga
    ok = body(pts) + 0.016
    pts[ok > 0, 1] -= 0.0
    eso = curve([np.array([0.0, -0.03, -0.47]), np.array([-0.02, -0.035, -0.43]), np.array([-0.05, -0.04, -0.39])], 12)
    man = curve([np.array([-0.05, -0.04, -0.39]), np.array([-0.075, -0.04, -0.35]), pts[0]], 12)
    rect = curve([pts[-1], np.array([0.03, -0.06, -0.2]), np.array([0.02, -0.075, -0.155]), np.array([0.015, -0.085, -0.13])], 16)
    tube("esofago", "tronco", "intestino", eso, 0.006, 8)
    tube("manicotto", "tronco", "manicotto", man, np.linspace(0.014, 0.012, len(man)), 10)
    gut = curve(pts, 300)
    tube("intestino", "tronco", "intestino_girino", gut, 0.0125, 10, pivot=c)
    tube("reto", "tronco", "colon", rect, np.linspace(0.01, 0.006, len(rect)), 8)
    # ------------------------------------------------ figado e vesicula
    lv = np.array([0.045, -0.02, -0.37])
    sdf_mesh("figado", "tronco", "figado", lambda p: ellipsoid(p, lv, [0.055, 0.035, 0.045]) + 0.002 * (vnoise(p, 60) - 0.5),
             lv - 0.08, lv + 0.08, 0.0025, clip=clip)
    gb = lv + [-0.02, -0.02, 0.02]
    sdf_mesh("vesicula", "tronco", "vesicula", lambda p: ellipsoid(p, gb, [0.011, 0.01, 0.012]), gb - 0.03, gb + 0.03, 0.0018)
    # ------------------------------------------------ coracao e arterias branquiais
    hc = np.array([0.0, -0.062, -0.415])
    sdf_mesh("ventriculo", "tronco", "ventriculo", lambda p: smin(ellipsoid(p, hc, [0.017, 0.015, 0.017]),
             capsule(p, hc, hc + [0.0, -0.004, 0.02], 0.013, 0.005), 0.008), hc - 0.04, hc + 0.05, 0.0016, pivot=hc)
    at = hc + [-0.012, 0.018, 0.012]
    sdf_mesh("atrio", "tronco", "atrio", lambda p: ellipsoid(p, at, [0.016, 0.012, 0.013]), at - 0.03, at + 0.03, 0.0016, pivot=at)
    sv = at + [0.0, 0.012, 0.015]
    sdf_mesh("seio_venoso", "tronco", "veia", lambda p: ellipsoid(p, sv, [0.012, 0.007, 0.01]), sv - 0.02, sv + 0.02, 0.0016)
    bulb = curve([hc + [0.006, 0.004, -0.012], hc + [0.008, 0.012, -0.025], hc + [0.0, 0.018, -0.035]], 10)
    tube("bulbo_arterial", "tronco", "cone", bulb, np.linspace(0.008, 0.006, len(bulb)), 10, pivot=hc)
    tr = hc + [0.0, 0.018, -0.035]
    # ------------------------------------------------ branquias internas
    for sg, s in ((1, "R"), (-1, "L")):
        for k in range(4):
            z = -0.405 + k * 0.018
            # arco branquial em C na parede da camara, com a arteria aferente
            arc = curve([np.array([0.045 * sg, -0.045, z - 0.004]), np.array([0.075 * sg, -0.035, z]), np.array([0.09 * sg, -0.01, z + 0.004]),
                         np.array([0.08 * sg, 0.015, z + 0.006])], 16)
            tube("arco_branquial_%d_%s" % (k, s), "tronco", "cartilagem", arc, 0.0035, 6, pivot=np.array([0.07 * sg, -0.02, z]))
            aff = curve([tr, np.array([0.025 * sg, -0.045, z - 0.01]), arc[0]], 10)
            tube("aferente_%d_%s" % (k, s), "tronco", "arteria", aff, 0.0022, 6)
            # filamentos em franja (onde o sangue troca gas com a agua)
            fil_pts = arc[2:-2]
            for j, fp in enumerate(fil_pts):
                out = np.array([sg * 0.55, -0.35, 0.75 if j % 2 else 0.55])
                out /= np.linalg.norm(out)
                L = 0.012 + 0.006 * np.sin(j * 1.7 + k)
                fl = np.array([fp, fp + out * L * 0.5 + [0, 0.002 * np.sin(j), 0], fp + out * L])
                tube("filamento_%d_%d_%s" % (k, j, s), "tronco", "branquia", fl, np.array([0.0022, 0.0018, 0.0012]), 5,
                     pivot=np.array([0.07 * sg, -0.02, -0.38]))
        # pronefros: rim larval enovelado atras das branquias
        pn = np.array([0.045 * sg, 0.025, -0.35])
        sdf_mesh("pronefro_" + s, "tronco", "rim", lambda p, pn=pn: ellipsoid(p, pn, [0.014, 0.012, 0.02]) + 0.004 * (vnoise(p, 150) - 0.5),
                 pn - 0.03, pn + 0.03, 0.0016)
        dct = curve([pn + [0, -0.005, 0.015], np.array([0.035 * sg, 0.015, -0.25]), np.array([0.02 * sg, -0.05, -0.16]), np.array([0.012 * sg, -0.08, -0.135])], 16)
        tube("ducto_pronefrico_" + s, "tronco", "ureter", dct, 0.002, 5)
        # pulmoes: sacos finos dorsais (crescem perto da metamorfose)
        lu = np.array([0.035 * sg, 0.035, -0.38])
        sdf_mesh("pulmao_" + s, "tronco", "pulmao",
                 lambda p, lu=lu, sg=sg: chain(p, [lu, lu + [0.01 * sg, 0.0, 0.06], lu + [0.012 * sg, -0.005, 0.14]], [0.008, 0.016, 0.01], 0.01),
                 lu - [0.04, 0.04, 0.03], lu + [0.04, 0.04, 0.18], 0.0022, pivot=lu, clip=clip)
    # ------------------------------------------------ encefalo e medula
    by = 0.04
    def br(p):
        d = None
        for sg in (-1, 1):
            for q in (ellipsoid(p, np.array([0.008 * sg, by - 0.003, -0.475]), [0.007, 0.006, 0.012]),
                      ellipsoid(p, np.array([0.012 * sg, by, -0.452]), [0.012, 0.011, 0.018]),
                      ellipsoid(p, np.array([0.013 * sg, by + 0.004, -0.415]), [0.013, 0.012, 0.014])):
                d = q if d is None else smin(d, q, 0.004)
        d = smin(d, capsule(p, [0, by, -0.4], [0, by - 0.002, -0.37], 0.01, 0.007), 0.004)
        return d
    sdf_mesh("encefalo", "tronco", "cerebro", br, [-0.04, by - 0.03, -0.5], [0.04, by + 0.03, -0.35], 0.0014)
    for sg, s in ((1, "R"), (-1, "L")):
        on = curve([np.array([0.0, by - 0.012, -0.435]), np.array([0.03 * sg, by - 0.005, -0.435]), np.array([0.058 * sg, 0.05, -0.43])], 8)
        tube("nervo_optico_" + s, "tronco", "nervo", on, 0.0022, 5)
    sc = curve([np.array([0.0, by - 0.002, -0.37]), np.array([0.0, 0.035, -0.28]), np.array([0.0, 0.028, -0.14])], 16)
    tube("medula", "tronco", "cerebro", sc, np.linspace(0.006, 0.005, len(sc)), 8)
    nc = curve([np.array([0.0, 0.012, -0.4]), np.array([0.0, 0.014, -0.28]), np.array([0.0, 0.012, -0.14])], 16)
    tube("notocorda_corpo", "tronco", "notocorda", nc, np.linspace(0.004, 0.008, len(nc)), 8)
    ao = curve([tr, np.array([0.0, -0.01, -0.39]), np.array([0.0, 0.0, -0.3]), np.array([0.0, 0.0, -0.14])], 16)
    tube("aorta_dorsal", "tronco", "arteria", ao, 0.0035, 6)
    for side in ("L", "R"):
        B.merge(lambda m, side=side: m["name"].startswith("filamento_") and m["name"].endswith(side), "branquias_" + side)
        B.merge(lambda m, side=side: m["name"].startswith("arco_branquial_") and m["name"].endswith(side), "arcos_branquiais_" + side)
    B.merge(lambda m: m["mat"] == "arteria", "arterias")
    B.merge(lambda m: m["mat"] == "nervo", "nervos")
    B.write({}, "girino_organs")


if __name__ == "__main__":
    main()
