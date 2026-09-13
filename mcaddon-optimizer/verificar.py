#!/usr/bin/env python3
"""Verificador independente: compara o addon original com o otimizado.

Nao reutiliza o codigo do otimizador de proposito -- se os dois tivessem o
mesmo bug, a verificacao interna nao pegaria. Aqui a comparacao e feita do
zero: lista de arquivos identica, PNGs identicos pixel a pixel e JSONs
identicos apos o parse.

Uso: python3 verificar.py original.mcaddon otimizado.mcaddon
     python3 verificar.py original.mcaddon otimizado.mcaddon --permitir-perda
"""

from __future__ import annotations

import io
import json
import posixpath
import re
import sys
import zipfile

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
NESTED = (".mcpack", ".mcworld", ".mctemplate", ".zip")


def flatten(blob: bytes, prefix: str = "") -> dict[str, bytes]:
    """Achata o pacote (e os pacotes aninhados) em caminho -> bytes."""
    out: dict[str, bytes] = {}
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            data = zf.read(info)
            path = posixpath.join(prefix, info.filename) if prefix else info.filename
            if info.filename.lower().endswith(NESTED) and data[:4] == b"PK\x03\x04":
                out.update(flatten(data, path))
            else:
                out[path] = data
    return out


def strip_json_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"(?m)^\s*//.*$", "", text)
    return text


def parse_json(blob: bytes):
    text = blob.decode("utf-8-sig")
    for candidate in (text, strip_json_comments(text),
                      re.sub(r",(\s*[}\]])", r"\1", strip_json_comments(text))):
        try:
            return True, json.loads(candidate)
        except Exception:
            continue
    return False, None


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    lossy_ok = "--permitir-perda" in sys.argv
    if len(args) != 2:
        print(__doc__)
        return 1
    sys.argv = [sys.argv[0]] + args

    with open(sys.argv[1], "rb") as handle:
        original = flatten(handle.read())
    with open(sys.argv[2], "rb") as handle:
        optimized = flatten(handle.read())

    problems: list[str] = []

    missing = sorted(set(original) - set(optimized))
    extra = sorted(set(optimized) - set(original))
    for name in missing:
        problems.append(f"ARQUIVO SUMIU: {name}")
    for name in extra:
        problems.append(f"ARQUIVO NOVO: {name}")

    identical = pixels_ok = json_ok = other_ok = 0
    lossy_notes: list[str] = []
    for name in sorted(set(original) & set(optimized)):
        before, after = original[name], optimized[name]
        if before == after:
            identical += 1
            continue
        lowered = name.lower()
        if lowered.endswith(".png"):
            try:
                with Image.open(io.BytesIO(before)) as a, Image.open(io.BytesIO(after)) as b:
                    if a.size != b.size:
                        message = f"PNG redimensionado {a.size}->{b.size}: {name}"
                        if lossy_ok:
                            lossy_notes.append(message)
                        else:
                            problems.append(message)
                    elif a.convert("RGBA").tobytes() != b.convert("RGBA").tobytes():
                        message = f"PNG com pixels diferentes: {name}"
                        if lossy_ok:
                            lossy_notes.append(message)
                        else:
                            problems.append(message)
                    else:
                        pixels_ok += 1
            except Exception as exc:
                problems.append(f"PNG ilegivel ({exc}): {name}")
        elif lowered.endswith((".json", ".material", ".mcmeta", ".texture_set")):
            ok_a, obj_a = parse_json(before)
            ok_b, obj_b = parse_json(after)
            if not ok_b:
                problems.append(f"JSON nao parseia mais: {name}")
            elif ok_a and obj_a != obj_b:
                problems.append(f"JSON com conteudo diferente: {name}")
            else:
                json_ok += 1
        else:
            other_ok += 1
            message = f"arquivo binario alterado: {name}"
            if lossy_ok:
                lossy_notes.append(message)
            else:
                problems.append(message)

    print(f"arquivos no original:  {len(original)}")
    print(f"arquivos no otimizado: {len(optimized)}")
    print(f"  identicos byte a byte:      {identical}")
    print(f"  PNG identicos pixel a pixel:{pixels_ok:>4}")
    print(f"  JSON identicos apos parse:  {json_ok:>4}")
    if other_ok:
        print(f"  outros binarios alterados:  {other_ok:>4}")
    if lossy_notes:
        print(f"  alterados no modo com perda:{len(lossy_notes):>4}")
    print()
    if problems:
        print(f"{len(problems)} PROBLEMA(S):")
        for problem in problems[:40]:
            print(f"  - {problem}")
        return 2
    if lossy_notes:
        print("OK para modo com perda: nenhum arquivo perdido e nenhum JSON "
              f"alterado; {len(lossy_notes)} midia(s) reprocessada(s) de proposito.")
    else:
        print("TUDO CERTO: nenhum arquivo perdido, nenhum pixel alterado, "
              "nenhum JSON alterado.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
