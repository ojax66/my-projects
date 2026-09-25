#!/usr/bin/env python3
"""Converte o modelo 3D da ra (OBJ + textura do usuario, sapo-banjo
Limnodynastes) num corpo com esqueleto para o jogo.

    python3 tools/import_frog_model.py caminho/12268_banjofrog_v1_L3.obj

- troca o sistema de coordenadas (Z para cima do 3ds Max -> Y para cima,
  cabeca para -Z) e normaliza para SVL = 1 (focinho ate a cloaca)
- cria o esqueleto: corpo, cabeca, garganta (bomba bucal / saco vocal),
  olhos (afundam para engolir), e em cada lado quadril->femur->tibia->tarso->pe
  e ombro->umero->radio-ulna->mao, nas posicoes das articulacoes do modelo
  sentado
- calcula os pesos de cada vertice para ate 4 ossos (distancia ao segmento
  do osso, so do mesmo lado para os membros)
Saida: frog/frog_skin.bin + frog/frog_skin.json + frog/banjofrog_diffuse.jpg
"""
import json
import shutil
import struct
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frog"

# articulacoes no sistema do OBJ (x lado, y comprimento com a cabeca em -y, z altura)
J = {
    "corpo": (0.0, 1.2, 1.0), "peito": (0.0, -0.9, 1.3), "cabeca": (0.0, -2.0, 1.8), "focinho": (0.0, -3.5, 1.5),
    "garganta": (0.0, -2.2, 0.55),
    # no OBJ o +x e o lado ESQUERDO do sapo (ele olha para -y com z para cima)
    "olho_L": (0.95, -2.1, 2.55), "olho_R": (-0.95, -2.1, 2.55),
}
for s, sg in (("L", 1.0), ("R", -1.0)):
    J |= {
        f"quadril_{s}": (0.55 * sg, 2.0, 0.85), f"joelho_{s}": (2.15 * sg, 0.9, 1.15),
        f"tornozelo_{s}": (1.5 * sg, 2.35, 0.3), f"tarso_{s}": (1.5 * sg, 1.1, 0.15), f"dedos_{s}": (1.65 * sg, -0.4, 0.05),
        f"ombro_{s}": (0.75 * sg, -1.25, 1.1), f"cotovelo_{s}": (1.85 * sg, -0.9, 0.85),
        f"punho_{s}": (1.8 * sg, -1.85, 0.2), f"mao_{s}": (1.7 * sg, -2.6, 0.05),
    }
# ossos: nome, junta inicial, junta final (ponta), pai, raio de influencia
BONES = [("corpo", "corpo", "peito", None, 1.35), ("peito", "peito", "cabeca", "corpo", 1.2),
         ("cabeca", "cabeca", "focinho", "peito", 1.05), ("garganta", "garganta", "garganta", "cabeca", 0.55)]
for s in ("R", "L"):
    BONES += [(f"olho_{s}", f"olho_{s}", f"olho_{s}", "cabeca", 0.36)]
for s in ("R", "L"):
    BONES += [(f"femur_{s}", f"quadril_{s}", f"joelho_{s}", "corpo", 0.62), (f"tibia_{s}", f"joelho_{s}", f"tornozelo_{s}", f"femur_{s}", 0.5),
              (f"tarso_{s}", f"tornozelo_{s}", f"tarso_{s}", f"tibia_{s}", 0.35), (f"pe_{s}", f"tarso_{s}", f"dedos_{s}", f"tarso_{s}", 0.42),
              (f"umero_{s}", f"ombro_{s}", f"cotovelo_{s}", "peito", 0.42), (f"antebraco_{s}", f"cotovelo_{s}", f"punho_{s}", f"umero_{s}", 0.36),
              (f"mao_{s}", f"punho_{s}", f"mao_{s}", f"antebraco_{s}", 0.45)]
SVL = 6.1          # comprimento focinho-cloaca no OBJ


def to_godot(p):
    p = np.asarray(p, float)
    # (x, y, z) obj -> (-x, z, y) godot  (rotacao propria, sem espelhar)
    return np.stack([-p[..., 0], p[..., 2], p[..., 1]], -1) / SVL


def seg_dist(P, a, b):
    ab = b - a
    l2 = float(ab @ ab)
    if l2 < 1e-9:
        return np.linalg.norm(P - a, axis=1)
    t = np.clip(((P - a) @ ab) / l2, 0.0, 1.0)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1)


def main():
    obj = Path(sys.argv[1])
    V, VT, VN, faces = [], [], [], []
    for line in obj.open():
        if line.startswith("v "):
            V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("vt "):
            VT.append([float(x) for x in line.split()[1:3]])
        elif line.startswith("vn "):
            VN.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("f "):
            idx = [tuple(int(i) - 1 if i else -1 for i in (c.split("/") + ["", ""])[:3]) for c in line.split()[1:]]
            for k in range(1, len(idx) - 1):
                faces.append((idx[0], idx[k], idx[k + 1]))
    V, VT, VN = np.array(V), np.array(VT), np.array(VN)
    uniq = {}
    pos, uv, nrm, index = [], [], [], []
    for tri in faces:
        for c in (tri[0], tri[2], tri[1]):     # inverte o sentido (a troca de eixos inverte a orientacao)
            if c not in uniq:
                uniq[c] = len(pos)
                pos.append(V[c[0]])
                uv.append(VT[c[1]] if c[1] >= 0 else [0, 0])
                nrm.append(VN[c[2]] if c[2] >= 0 else [0, 0, 1])
            index.append(uniq[c])
    P_obj = np.array(pos)
    P = to_godot(P_obj)
    N = to_godot(np.array(nrm)) * SVL
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    UV = np.array(uv)
    UV[:, 1] = 1.0 - UV[:, 1]
    # esqueleto
    joints = {k: to_godot(v) for k, v in J.items()}
    names = [b[0] for b in BONES]
    W = np.zeros((len(P), len(BONES)))
    side_x = P_obj[:, 0]
    for bi, (name, a, b, parent, r) in enumerate(BONES):
        d = seg_dist(P, joints[a], joints[b]) * SVL
        w = np.exp(-(d / r) ** 2)
        if name.endswith("_L") and not name.startswith("olho"):
            w *= (side_x > 0.35).astype(float)
        if name.endswith("_R") and not name.startswith("olho"):
            w *= (side_x < -0.35).astype(float)
        if name.startswith("olho"):
            w *= (d < 0.34) * 4.0
        if name == "garganta":
            w *= ((P_obj[:, 2] < 1.0) & (P_obj[:, 1] < -1.6) & (np.abs(side_x) < 1.1)) * 2.0
        W[:, bi] = w
    # o tronco pega o que sobrar (pele entre os membros)
    W[:, 0] += 1e-4
    top = np.argsort(-W, axis=1)[:, :4]
    tw = np.take_along_axis(W, top, 1)
    tw /= tw.sum(1, keepdims=True)
    OUT.mkdir(exist_ok=True)
    with open(OUT / "frog_skin.bin", "wb") as f:
        f.write(struct.pack("<4sII", b"FROG", len(P), len(index)))
        f.write(P.astype("<f4").tobytes())
        f.write(N.astype("<f4").tobytes())
        f.write(UV.astype("<f4").tobytes())
        f.write(np.array(index, "<i4").tobytes())
        f.write(top.astype("<i4").tobytes())
        f.write(tw.astype("<f4").tobytes())
    bones = []
    for name, a, b, parent, r in BONES:
        bones.append({"nome": name, "pai": parent, "cabeca": joints[a].round(5).tolist(), "ponta": joints[b].round(5).tolist()})
    extra = {"olho_R": joints["olho_R"].tolist(), "olho_L": joints["olho_L"].tolist(), "boca": to_godot((0.0, -3.45, 1.15)).tolist()}
    (OUT / "frog_skin.json").write_text(json.dumps({"fonte": obj.name, "svl_obj": SVL, "ossos": bones, "pontos": extra}, indent=1))
    tex = obj.parent / "12268_banjofrog_diffuse.jpg"
    if tex.exists():
        shutil.copy(tex, OUT / "banjofrog_diffuse.jpg")
    dom = np.bincount(top[:, 0], minlength=len(BONES))
    print("vertices %d  triangulos %d  ossos %d" % (len(P), len(index) // 3, len(BONES)))
    print("vertices por osso principal:", {names[i]: int(dom[i]) for i in range(len(BONES)) if dom[i]})


if __name__ == "__main__":
    main()
