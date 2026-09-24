#!/usr/bin/env python3
"""Embute os kernels GLSL (tools/shaders_src/*.glsl) em scripts/brain/brain_shaders.gd,
para que entrem em qualquer exportacao do jogo (o Godot nao exporta .glsl cru).

    python3 tools/gen_brain_shaders.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
src = ROOT / "tools/shaders_src"
out = ["# GERADO por tools/gen_brain_shaders.py a partir de tools/shaders_src/*.glsl -- nao edite a mao",
       "class_name BrainShaders", "extends RefCounted", ""]
common = (src / "brain_common.glsl").read_text()
out.append('const COMMON := """%s"""' % common.replace('"""', "'''"))
out.append("")
out.append("const KERNELS := {")
for f in sorted(src.glob("*.glsl")):
    if f.stem == "brain_common":
        continue
    out.append('\t"%s": """%s""",' % (f.stem, f.read_text()))
out.append("}")
(ROOT / "scripts/brain/brain_shaders.gd").write_text("\n".join(out) + "\n")
print("ok:", ROOT / "scripts/brain/brain_shaders.gd")
