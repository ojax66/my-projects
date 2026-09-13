#!/usr/bin/env python3
"""Otimizador de addons Minecraft Bedrock (.mcaddon / .mcpack / .zip).

Reduz o tamanho do pacote sem remover nenhum arquivo e sem alterar nenhum
pixel: recomprime PNGs, minifica JSON e reempacota o container com zopfli.
Tudo e verificado antes de ser aceito -- qualquer candidato que nao bata
byte a byte (JSON) ou pixel a pixel (PNG) com o original e descartado.

Uso:
    python3 optimize_mcaddon.py entrada.mcaddon
    python3 optimize_mcaddon.py entrada.mcaddon -o saida.mcaddon --jobs 8
    python3 optimize_mcaddon.py entrada.mcaddon --relatorio relatorio.md
"""

from __future__ import annotations

import argparse
import concurrent.futures as futures
import io
import os
import posixpath
import sys
import time
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mcopt import audit, jsonmin, pngopt, zipper  # noqa: E402

NESTED_EXTENSIONS = (".mcpack", ".mcworld", ".mctemplate", ".zip")
JSON_EXTENSIONS = (".json", ".material", ".geo", ".mcmeta", ".texture_set")


# --------------------------------------------------------------------------
# arvore do pacote
# --------------------------------------------------------------------------

class Archive:
    """Um container zip, possivelmente com outros containers dentro."""

    def __init__(self, name: str):
        self.name = name
        self.children: list[tuple[str, object]] = []  # (nome, Archive | int)


def _looks_like_zip(blob: bytes) -> bool:
    return blob[:4] in (b"PK\x03\x04", b"PK\x05\x06")


def build_tree(blob: bytes, name: str, leaves: list[bytes],
               paths: list[str], prefix: str = "") -> Archive:
    node = Archive(name)
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            data = zf.read(info)
            full = posixpath.join(prefix, info.filename) if prefix else info.filename
            if info.filename.lower().endswith(NESTED_EXTENSIONS) and _looks_like_zip(data):
                node.children.append(
                    (info.filename, build_tree(data, info.filename, leaves, paths, full))
                )
            else:
                node.children.append((info.filename, len(leaves)))
                leaves.append(data)
                paths.append(full)
    return node


def rebuild(node: Archive, leaves: list[bytes], use_zopfli: bool,
            iterations: int) -> bytes:
    entries: list[tuple[str, bytes]] = []
    for name, child in node.children:
        if isinstance(child, Archive):
            entries.append((name, rebuild(child, leaves, use_zopfli, iterations)))
        else:
            entries.append((name, leaves[child]))
    buffer = io.BytesIO()
    zipper.write_archive(buffer, entries, use_zopfli=use_zopfli, iterations=iterations)
    return buffer.getvalue()


# --------------------------------------------------------------------------
# processamento de um arquivo
# --------------------------------------------------------------------------

def process_leaf(task):
    index, path, blob, opts = task
    lowered = path.lower()
    ext = posixpath.splitext(lowered)[1]
    original = len(blob)  # medido antes de qualquer transformacao

    try:
        if ext in JSON_EXTENSIONS or lowered.endswith("manifest.json"):
            out, why = jsonmin.minify_checked(blob)
            return index, out, "json", why, original

        if ext == ".png":
            how_prefix = ""
            if opts["max_resolution"]:
                budget = opts["max_resolution"]
                smaller = pngopt.downscale(blob, budget)
                if smaller:
                    blob = smaller
                    how_prefix = "reduzido+"
            out, how = pngopt.optimize(blob, allow_indexed=opts["indexed"])
            how = how_prefix + how
            if opts["lossy_png"] and len(out) > opts["lossy_min_bytes"]:
                quantized = pngopt.quantize(blob, opts["lossy_quality"])
                if quantized and len(quantized) < len(out):
                    requantized, _ = pngopt.optimize(quantized, allow_indexed=True)
                    out = min(requantized, quantized, key=len)
                    how = "quantizado"
            return index, out, "png", how, original

        if ext == ".ogg" and opts["lossy_audio"]:
            out = _reencode_ogg(blob, opts["audio_bitrate"])
            if out and len(out) < original:
                return index, out, "audio", "reencode", original
            return index, blob, "audio", "inalterado", original
    except Exception as exc:  # nunca deixa um arquivo quebrar o lote
        return index, blob, "erro", f"{type(exc).__name__}: {exc}", original

    return index, blob, "outro", "inalterado", original


def _reencode_ogg(blob: bytes, bitrate: int) -> bytes | None:
    import subprocess
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "in.ogg")
        dst = os.path.join(tmp, "out.ogg")
        with open(src, "wb") as handle:
            handle.write(blob)
        try:
            proc = subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-i", src, "-c:a", "libvorbis",
                 "-b:a", f"{bitrate}k", dst],
                capture_output=True, timeout=300,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return None
        if proc.returncode != 0 or not os.path.exists(dst):
            return None
        with open(dst, "rb") as handle:
            return handle.read()


# --------------------------------------------------------------------------
# relatorio
# --------------------------------------------------------------------------

def human(num: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if abs(num) < 1024:
            return f"{num:.1f} {unit}" if unit != "B" else f"{int(num)} B"
        num /= 1024
    return f"{num:.1f} TB"


def build_report(stats, before, after, findings, elapsed, changes) -> str:
    saved = before - after
    pct = (saved / before * 100) if before else 0
    lines = [
        "# Relatorio de otimizacao",
        "",
        f"- Tamanho original: **{human(before)}**",
        f"- Tamanho otimizado: **{human(after)}**",
        f"- Economia: **{human(saved)} ({pct:.1f}%)**",
        f"- Tempo: {elapsed:.1f}s",
        "",
        "## Por tipo de arquivo",
        "",
        "| Tipo | Arquivos | Antes | Depois | Economia |",
        "|---|---:|---:|---:|---:|",
    ]
    for kind in sorted(stats, key=lambda k: -(stats[k]["before"] - stats[k]["after"])):
        entry = stats[kind]
        delta = entry["before"] - entry["after"]
        share = (delta / entry["before"] * 100) if entry["before"] else 0
        lines.append(
            f"| {kind} | {entry['count']} | {human(entry['before'])} | "
            f"{human(entry['after'])} | {human(delta)} ({share:.1f}%) |"
        )

    if changes:
        lines += ["", "## Maiores reducoes individuais", "",
                  "| Arquivo | Antes | Depois | Tecnica |", "|---|---:|---:|---|"]
        for path, was, now, how in changes[:25]:
            lines.append(f"| `{path}` | {human(was)} | {human(now)} | {how} |")

    counts = findings["counts"]
    lines += [
        "",
        "## Inventario do addon",
        "",
        f"- Entidades: {counts['entities']} | Blocos: {counts['blocks']} | "
        f"Itens: {counts['items']} | Particulas: {counts['particles']}",
        f"- Texturas: {counts['textures']} | Sons: {counts['sounds']} | "
        f"Scripts: {counts['scripts']} | JSON: {counts['json']}",
    ]

    oversized = findings["oversized_textures"]
    if oversized:
        total = sum(item["bytes"] for item in oversized)
        lines += [
            "",
            "## Texturas acima do orcamento de resolucao",
            "",
            f"{len(oversized)} textura(s), {human(total)}. Elas nao sao tocadas "
            "pelo modo sem perda (reduzir resolucao muda a arte). Use "
            "`--max-resolucao` se quiser cortar isso -- e a maior economia "
            "disponivel depois da recompressao.",
            "",
            "| Arquivo | Resolucao | Orcamento | Tamanho |",
            "|---|---|---:|---:|",
        ]
        for item in oversized[:20]:
            lines.append(
                f"| `{item['path']}` | {item['size']} | {item['budget']}px | "
                f"{human(item['bytes'])} |"
            )

    duplicates = findings["duplicates"]
    if duplicates:
        total = sum(item["wasted"] for item in duplicates)
        lines += [
            "",
            "## Arquivos duplicados",
            "",
            f"{len(duplicates)} grupo(s) de arquivos identicos, {human(total)} "
            "desperdicados. Nada foi removido -- resolver isso exige editar as "
            "referencias no addon.",
            "",
        ]
        for item in duplicates[:10]:
            lines.append(f"- {human(item['wasted'])}: " + ", ".join(
                f"`{p}`" for p in item["paths"][:4]))

    if findings["tick_scripts"]:
        lines += ["", "## Scripts com trabalho por tick", "",
                  "Custo de CPU em jogo (nao de tamanho):", ""]
        for item in findings["tick_scripts"][:15]:
            lines.append(f"- `{item['path']}`: {', '.join(item['hits'])}")

    if findings["heavy_entities"]:
        lines += ["", "## Entidades pesadas", "",
                  "| Entidade | Comportamentos | Grupos | Sensores |",
                  "|---|---:|---:|---:|"]
        for item in findings["heavy_entities"][:15]:
            lines.append(
                f"| `{item['id']}` | {item['behaviors']} | {item['groups']} | "
                f"{item['sensors']} |"
            )

    if findings["hot_particles"]:
        lines += ["", "## Particulas de taxa alta", ""]
        for item in findings["hot_particles"][:10]:
            lines.append(
                f"- `{item['path']}`: spawn_rate={item['spawn_rate']}, "
                f"max={item['max']}"
            )

    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Otimiza um addon de Minecraft Bedrock sem remover arquivos.",
    )
    parser.add_argument("entrada", help="arquivo .mcaddon/.mcpack/.zip")
    parser.add_argument("-o", "--saida", help="caminho de saida")
    parser.add_argument("--relatorio", help="grava um relatorio markdown")
    parser.add_argument("--jobs", type=int, default=os.cpu_count() or 4)
    parser.add_argument("--iteracoes", type=int, default=15,
                        help="iteracoes do zopfli (maior = menor e mais lento)")
    parser.add_argument("--sem-zopfli", action="store_true",
                        help="usa deflate padrao no container (mais rapido)")
    parser.add_argument("--sem-paleta", action="store_true",
                        help="nao converte PNG para indexado")
    parser.add_argument("--png-com-perda", action="store_true",
                        help="quantiza PNGs para 256 cores (reduz muito, altera a arte)")
    parser.add_argument("--qualidade-png", default="70-92")
    parser.add_argument("--audio-com-perda", action="store_true",
                        help="reencoda .ogg em bitrate menor")
    parser.add_argument("--audio-bitrate", type=int, default=64)
    parser.add_argument("--max-resolucao", type=int, default=0, metavar="PX",
                        help="reduz texturas acima de PX no lado menor "
                             "(com perda: altera a arte; use 32 ou 64)")
    parser.add_argument("--somente-analise", action="store_true",
                        help="so gera o relatorio, nao escreve o pacote")
    args = parser.parse_args(argv)

    source = args.entrada
    if not os.path.isfile(source):
        print(f"erro: nao encontrei {source}", file=sys.stderr)
        return 1

    before = os.path.getsize(source)
    destination = args.saida or _default_output(source)
    started = time.time()

    print(f"lendo {source} ({human(before)})...")
    with open(source, "rb") as handle:
        blob = handle.read()
    if not _looks_like_zip(blob):
        print("erro: o arquivo nao e um zip (.mcaddon valido)", file=sys.stderr)
        return 1

    leaves: list[bytes] = []
    paths: list[str] = []
    tree = build_tree(blob, os.path.basename(source), leaves, paths)
    print(f"{len(leaves)} arquivos encontrados (pacotes aninhados incluidos)")

    print("analisando o addon...")
    findings = audit.analyze(dict(zip(paths, leaves)))

    opts = {
        "indexed": not args.sem_paleta,
        "lossy_png": args.png_com_perda,
        "lossy_quality": args.qualidade_png,
        "lossy_min_bytes": 2048,
        "lossy_audio": args.audio_com_perda,
        "audio_bitrate": args.audio_bitrate,
        "max_resolution": args.max_resolucao,
    }

    stats: dict[str, dict] = {}
    changes: list[tuple[str, int, int, str]] = []
    errors: list[str] = []

    tasks = [(i, paths[i], leaves[i], opts) for i in range(len(leaves))]
    done = 0
    print(f"otimizando com {args.jobs} processos...")
    with futures.ProcessPoolExecutor(max_workers=args.jobs) as pool:
        for index, data, kind, how, original in pool.map(process_leaf, tasks, chunksize=4):
            leaves[index] = data
            entry = stats.setdefault(kind, {"count": 0, "before": 0, "after": 0})
            entry["count"] += 1
            entry["before"] += original
            entry["after"] += len(data)
            if kind == "erro":
                errors.append(f"{paths[index]}: {how}")
            elif len(data) < original:
                changes.append((paths[index], original, len(data), how))
            done += 1
            if done % 250 == 0 or done == len(tasks):
                print(f"  {done}/{len(tasks)}", end="\r", flush=True)
    print()

    changes.sort(key=lambda item: -(item[1] - item[2]))

    if args.somente_analise:
        after = before
    else:
        print("reempacotando...")
        packed = rebuild(tree, leaves, not args.sem_zopfli, args.iteracoes)
        with open(destination, "wb") as handle:
            handle.write(packed)
        after = len(packed)

        print("verificando integridade...")
        problems = _verify(destination, tree, leaves)
        if problems:
            print("FALHA na verificacao:", file=sys.stderr)
            for problem in problems[:20]:
                print(f"  - {problem}", file=sys.stderr)
            return 2
        print("verificacao OK: todos os arquivos conferem")

    elapsed = time.time() - started
    report = build_report(stats, before, after, findings, elapsed, changes)
    if args.relatorio:
        with open(args.relatorio, "w", encoding="utf-8") as handle:
            handle.write(report)
        print(f"relatorio gravado em {args.relatorio}")

    if errors:
        print(f"\n{len(errors)} arquivo(s) preservados por erro de leitura:")
        for message in errors[:10]:
            print(f"  - {message}")

    saved = before - after
    print()
    print(f"antes:  {human(before)}")
    print(f"depois: {human(after)}")
    if before:
        print(f"economia: {human(saved)} ({saved / before * 100:.1f}%)")
    if not args.somente_analise:
        print(f"saida: {destination}")
    return 0


def _default_output(source: str) -> str:
    root, ext = os.path.splitext(source)
    return f"{root}-otimizado{ext}"


def _verify(destination: str, tree: Archive, leaves: list[bytes]) -> list[str]:
    """Confere que todo arquivo folha sobreviveu com o conteudo esperado."""
    problems: list[str] = []

    def walk(node: Archive, opener) -> None:
        expected = {}
        nested = {}
        for name, child in node.children:
            if isinstance(child, Archive):
                nested[name] = child
            else:
                expected[name] = leaves[child]
        try:
            with zipfile.ZipFile(opener()) as zf:
                names = set(zf.namelist())
                for name in expected:
                    if name not in names:
                        problems.append(f"{node.name}: faltando {name}")
                    elif zf.read(name) != expected[name]:
                        problems.append(f"{node.name}: conteudo divergente em {name}")
                for name, child in nested.items():
                    if name not in names:
                        problems.append(f"{node.name}: faltando pacote {name}")
                        continue
                    data = zf.read(name)
                    walk(child, lambda d=data: io.BytesIO(d))
        except Exception as exc:
            problems.append(f"{node.name}: ilegivel ({exc})")

    walk(tree, lambda: destination)
    return problems


if __name__ == "__main__":
    raise SystemExit(main())
