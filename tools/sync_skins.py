#!/usr/bin/env python3
"""Coloca no add-on as skins da pasta skins/.

  skins/<Gamertag>.png          -> modelo clássico (Steve, braços de 4px)
  skins/<Gamertag>.slim.png     -> modelo slim (Alex, braços de 3px)
  skins/auto/...                -> baixadas por tools/fetch_skins.py

Skins colocadas à mão têm prioridade sobre as baixadas. Cada jogador mantém
sempre o mesmo número de skin (skins/index.json), para que corpos e cápsulas
que já existem no mundo não troquem de skin quando entra alguém novo.

Uso: python3 tools/sync_skins.py
"""
import json
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / "server_plugin" / "src" / "endstone_operacao_fenix"))
from packs import MAX_SKINS, VANILLA, SkinEntry, normalize_png, write_packs  # noqa: E402

skins_dir = root / "skins"
index_path = skins_dir / "index.json"

found: dict[str, tuple[str, bool, Path]] = {}
for folder in (skins_dir / "auto", skins_dir):  # a pasta manual vem por último e sobrescreve
    for file in sorted(folder.glob("*.png")) if folder.exists() else []:
        m = re.fullmatch(r"(.+?)(\.slim)?\.png", file.name, re.IGNORECASE)
        found[m[1].lower()] = (m[1], bool(m[2]), file)

index: dict[str, int] = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {}
used = set(index.values())
entries = []
for key, (name, slim, file) in sorted(found.items()):
    if key not in index:
        free = next((i for i in range(len(VANILLA), MAX_SKINS) if i not in used), None)
        if free is None:
            sys.exit(f"Máximo de {MAX_SKINS - len(VANILLA)} skins de jogadores.")
        index[key] = free
        used.add(free)
    entries.append(SkinEntry(name=name, index=index[key], slim=slim, png=normalize_png(file.read_bytes())))

skins_dir.mkdir(exist_ok=True)
index_path.write_text(json.dumps(index, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
write_packs(root / "packs" / "OperacaoFenix_BP", root / "packs" / "OperacaoFenix_RP", entries)
print(f"{len(entries)} skin(s) de jogadores no add-on.")
