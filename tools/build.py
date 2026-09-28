#!/usr/bin/env python3
"""Empacota os dois packs em dist/OperacaoFenix.mcaddon (abre direto no Minecraft)."""
import pathlib, zipfile

root = pathlib.Path(__file__).resolve().parent.parent
out = root / "dist" / "OperacaoFenix.mcaddon"
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for pack in ("OperacaoFenix_BP", "OperacaoFenix_RP"):
        for f in sorted((root / "packs" / pack).rglob("*")):
            if f.is_file():
                z.write(f, f.relative_to(root / "packs"))
print(out.relative_to(root))
