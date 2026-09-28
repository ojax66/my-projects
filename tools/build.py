#!/usr/bin/env python3
"""Gera dist/OperacaoFenix.mcaddon (abre direto no Minecraft) e o plugin do servidor (.whl)."""
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

# Plugin do servidor dedicado (Endstone): dist/endstone_operacao_fenix-*.whl
import subprocess, sys

result = subprocess.run(
    [sys.executable, "-m", "pip", "wheel", "--quiet", "--no-deps", "-w", str(out.parent), str(root / "server_plugin")],
)
if result.returncode == 0:
    print(*sorted(p.relative_to(root) for p in out.parent.glob("*.whl")))
else:
    print("(plugin do servidor não gerado; o .mcaddon está pronto)")
