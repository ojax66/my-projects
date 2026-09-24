#!/usr/bin/env python3
"""Converte o modelo NeuroMechFly (flygym) para arquivos que o Godot entende.

Uso:
    git clone https://github.com/NeLy-EPFL/flygym
    python3 tools/convert_flygym.py /caminho/para/flygym

Gera:
    fly/meshes/<segmento>.obj  -> malhas em mm (lado direito espelhado do esquerdo)
    fly/fly_model.json         -> hierarquia, posicoes, quaternions, cores,
                                  pose neutra e passadas reais gravadas
                                  (single_steps_untethered.pkl)

Dependencias: pyyaml, numpy
"""
import json
import math
import pickle
import struct
import sys
from pathlib import Path

import numpy as np
import yaml

SCALE = 1000.0  # STL em metros -> mm (igual ao flygym)

SIDES = ["l", "r"]
LEGS = [f"{s}{p}" for s in SIDES for p in "fmh"]
LEG_LINKS = ["coxa", "trochanterfemur", "tibia"] + [f"tarsus{i}" for i in "12345"]
ANTENNA_LINKS = ["pedicel", "funiculus", "arista"]
PROBOSCIS_LINKS = ["rostrum", "haustellum"]
ABDOMEN_LINKS = ["abdomen12"] + [f"abdomen{i}" for i in "3456"]


def chain(*args):
    return [(args[i], args[i + 1]) for i in range(len(args) - 1)]


PAIRS = (
    [("c_thorax", "c_head")]
    + chain("c_head", *(f"c_{lk}" for lk in PROBOSCIS_LINKS))
    + chain("c_thorax", *(f"c_{lk}" for lk in ABDOMEN_LINKS))
    + [("c_head", f"{s}_eye") for s in SIDES]
    + [e for s in SIDES for e in chain("c_head", *(f"{s}_{lk}" for lk in ANTENNA_LINKS))]
    + [("c_thorax", f"{s}_wing") for s in SIDES]
    + [("c_thorax", f"{s}_haltere") for s in SIDES]
    + [e for leg in LEGS for e in chain("c_thorax", *(f"{leg}_{lk}" for lk in LEG_LINKS))]
)

# Ordem dos DOFs por perna usada pelos controladores de locomocao do flygym
LEGACY_DOFS = ["Coxa", "Coxa_roll", "Coxa_yaw", "Femur", "Femur_roll", "Tibia", "Tarsus1"]
V2_DOFS = [
    ("c_thorax", "coxa", "pitch"),
    ("c_thorax", "coxa", "roll"),
    ("c_thorax", "coxa", "yaw"),
    ("coxa", "trochanterfemur", "pitch"),
    ("coxa", "trochanterfemur", "roll"),
    ("trochanterfemur", "tibia", "pitch"),
    ("tibia", "tarsus1", "pitch"),
]


def read_stl(path):
    data = path.read_bytes()
    n = struct.unpack("<I", data[80:84])[0]
    tris = np.frombuffer(data[84 : 84 + n * 50], dtype=np.dtype([("n", "<3f4"), ("v", "<9f4"), ("a", "<u2")]))
    return tris["v"].reshape(-1, 3, 3).astype(np.float64) * SCALE


def write_obj(path, tris, mirror_y):
    if mirror_y:
        tris = tris.copy()
        tris[:, :, 1] *= -1
        tris = tris[:, ::-1, :]  # inverte a ordem para manter as normais para fora
    # solda vertices para obter normais suaves
    flat = np.round(tris.reshape(-1, 3), 6)
    uniq, inv = np.unique(flat, axis=0, return_inverse=True)
    inv = inv.reshape(-1, 3)
    fn = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    vn = np.zeros_like(uniq)
    for k in range(3):
        np.add.at(vn, inv[:, k], fn)
    vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-12)
    lines = [f"# convertido de flygym/NeuroMechFly ({path.stem})"]
    lines += [f"v {x:.5f} {y:.5f} {z:.5f}" for x, y, z in uniq]
    lines += [f"vn {x:.4f} {y:.4f} {z:.4f}" for x, y, z in vn]
    # Godot usa ordem horaria como frente; o OBJ usa anti-horaria e o importador converte.
    lines += [f"f {a+1}//{a+1} {b+1}//{b+1} {c+1}//{c+1}" for a, b, c in inv]
    path.write_text("\n".join(lines) + "\n")


def match(pattern, name):
    import fnmatch

    return fnmatch.fnmatch(name, pattern)


def main():
    flygym = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("../flygym")
    assets = flygym / "src/flygym/assets/model/neuromechfly"
    out = Path(__file__).resolve().parent.parent / "fly"
    (out / "meshes").mkdir(parents=True, exist_ok=True)

    rigging = yaml.safe_load((assets / "rigging.yaml").read_text())
    visuals = yaml.safe_load((assets / "visuals.yaml").read_text())
    pose = yaml.safe_load((assets / "pose/neutral/yaw_pitch_roll.yaml").read_text())

    parent = {c: p for p, c in PAIRS}
    order = ["c_thorax"] + [c for _, c in PAIRS]

    segments = []
    for name in order:
        mirror = name[0] == "r"
        src = ("l" + name[1:]) if mirror else name
        tris = read_stl(assets / "meshes/simplified_max2000faces" / f"{src}.stl")
        write_obj(out / "meshes" / f"{name}.obj", tris, mirror)
        color = [0.59, 0.39, 0.12]
        alpha = 1.0
        speckle = [0.0, 0.0, 0.0, 0.0]
        gradient = None
        for vis in visuals.values():
            apply_to = vis["apply_to"]
            apply_to = [apply_to] if isinstance(apply_to, str) else apply_to
            if any(match(p, name) for p in apply_to):
                mat = vis["material"]
                tex = vis.get("texture")
                rgba = mat.get("rgba", [1, 1, 1, 1])
                alpha = rgba[3]
                if tex:
                    color = tex["rgb1"]
                    if tex.get("builtin") == "gradient":
                        gradient = tex["rgb2"]
                    if tex.get("mark") == "random":
                        speckle = list(tex["markrgb"]) + [tex.get("random", 0.0)]
                else:
                    color = rgba[:3]
        r = rigging[name]
        segments.append(
            {
                "name": name,
                "parent": parent.get(name, ""),
                "pos": r["pos"],
                "quat": r["quat"],  # w, x, y, z (MuJoCo)
                "mass": r["mass"],
                "color": color,
                "alpha": alpha,
                "speckle": speckle,
                "gradient": gradient,
            }
        )

    # Passadas reais (recortes de caminhada de moscas, flygym_demo/complex_terrain)
    steps_path = flygym / "src/flygym_demo/complex_terrain/assets/single_steps_untethered.pkl"
    with open(steps_path, "rb") as f:
        steps = pickle.load(f)
    step_angles = {}
    swing_end = {}
    n = len(steps["joint_LFCoxa"])
    duration = n * steps["meta"]["timestep"]
    for leg in LEGS:
        legacy = leg.upper()
        rows = []
        for dof, (_, _, axis) in zip(LEGACY_DOFS, V2_DOFS):
            a = np.asarray(steps[f"joint_{legacy}{dof}"], dtype=float)
            if leg[0] == "r" and axis in ("roll", "yaw"):
                a = -a  # convencao anatomica do flygym v2
            rows.append([round(float(x), 5) for x in a])
        step_angles[leg] = rows
        swing_end[leg] = float(steps["swing_stance_time"]["stance"][legacy]) / duration * 2 * math.pi

    neutral = {k: math.radians(v) for k, v in pose["joint_angles"].items()}
    # espelha pose neutra para o lado direito (convencao v2: mesmos valores)
    for k, v in list(neutral.items()):
        parts = k.split("-")
        if parts[1].startswith("l"):
            rk = "-".join([p.replace("l", "r", 1) if p[0] == "l" else p for p in parts[:2]] + [parts[2]])
            neutral.setdefault(rk, v)

    model = {
        "source": "https://github.com/NeLy-EPFL/flygym (NeuroMechFly v2, simplified_max2000faces)",
        "units": "mm",
        "axis_order": ["yaw", "pitch", "roll"],
        "axis_vectors": {"yaw": [1, 0, 0], "pitch": [0, 1, 0], "roll": [0, 0, 1]},
        "segments": segments,
        "neutral_pose": neutral,
        "step": {
            "timestep": steps["meta"]["timestep"],
            "samples": n,
            "duration": duration,
            "legs": LEGS,
            "dofs": ["-".join(d) for d in V2_DOFS],
            "angles": step_angles,
            "swing_end_phase": swing_end,
            "source": steps["meta"]["source"],
        },
        "tripod_phase_bias": [[math.pi * v for v in row] for row in [
            [0, 1, 0, 1, 0, 1],
            [1, 0, 1, 0, 1, 0],
            [0, 1, 0, 1, 0, 1],
            [1, 0, 1, 0, 1, 0],
            [0, 1, 0, 1, 0, 1],
            [1, 0, 1, 0, 1, 0],
        ]],
    }
    (out / "fly_model.json").write_text(json.dumps(model, indent=1))
    print(f"OK: {len(segments)} segmentos -> {out}")


if __name__ == "__main__":
    main()
