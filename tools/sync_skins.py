#!/usr/bin/env python3
"""Registra skins à mão (sem o plugin do servidor).

  skins/<Gamertag>.png        -> modelo clássico (Steve, braços de 4px)
  skins/<Gamertag>.slim.png   -> modelo slim (Alex, braços de 3px)

Uso: python3 tools/sync_skins.py
Em servidor dedicado com Endstone, use o plugin em server_plugin/: ele captura
a skin real de cada jogador sozinho.
"""
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / "server_plugin" / "src" / "endstone_operacao_fenix"))
from packs import VANILLA, SkinEntry, write_packs  # noqa: E402

entries = []
skins_dir = root / "skins"
for file in sorted(skins_dir.glob("*.png")) if skins_dir.exists() else []:
    m = re.fullmatch(r"(.+?)(\.slim)?\.png", file.name, re.IGNORECASE)
    entries.append(SkinEntry(name=m[1], index=len(VANILLA) + len(entries), slim=bool(m[2]), png=file.read_bytes()))

write_packs(root / "packs" / "OperacaoFenix_BP", root / "packs" / "OperacaoFenix_RP", entries)
print(f"{len(entries)} skins de jogadores registradas.")
