"""Minificacao textual de JSON.

Trabalha sobre o texto bruto em vez de reserializar objetos Python. Isso
preserva ordem de chaves, chaves duplicadas, precisao de numeros e escapes
exatamente como estavam no arquivo original -- so o que o parser do jogo
ignora (espacos, quebras de linha, comentarios e virgulas sobrando) e
removido.
"""

from __future__ import annotations

import json

WHITESPACE = " \t\r\n\v\f﻿"


def minify(text: str, strip_comments: bool = True) -> str:
    """Remove espacos/comentarios/virgulas finais fora de strings."""
    out: list[str] = []
    i = 0
    n = len(text)
    in_string = False
    escaped = False

    while i < n:
        ch = text[i]

        if in_string:
            out.append(ch)
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            i += 1
            continue

        if ch == '"':
            in_string = True
            out.append(ch)
            i += 1
            continue

        if strip_comments and ch == "/" and i + 1 < n:
            nxt = text[i + 1]
            if nxt == "/":
                end = text.find("\n", i)
                i = n if end == -1 else end + 1
                continue
            if nxt == "*":
                end = text.find("*/", i + 2)
                i = n if end == -1 else end + 2
                continue

        if ch in WHITESPACE:
            i += 1
            continue

        # virgula sobrando antes de fechar objeto/array: invalida em JSON estrito
        if ch in "}]":
            while out and out[-1] == ",":
                out.pop()

        out.append(ch)
        i += 1

    return "".join(out)


def _parses(text: str):
    try:
        return True, json.loads(text)
    except Exception:
        return False, None


def minify_checked(raw: bytes) -> tuple[bytes, str]:
    """Minifica com rede de seguranca.

    Retorna (bytes_resultantes, motivo). Se o original era JSON valido e o
    resultado nao bate semanticamente, devolve o original intacto.
    """
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw, "nao-utf8"

    small = minify(text)
    if not small:
        return raw, "vazio"

    ok_new, new_obj = _parses(small)
    ok_old, old_obj = _parses(text)

    if ok_old and not ok_new:
        return raw, "regressao-de-parse"
    if ok_old and ok_new and old_obj != new_obj:
        return raw, "semantica-diferente"
    if not ok_old and not ok_new:
        # arquivo ja era invalido para json estrito (comentarios/virgulas).
        # revalida removendo so os comentarios para garantir que nao pioramos.
        ok_stripped, _ = _parses(minify(text))
        if not ok_stripped:
            return raw, "json-nao-estrito"

    encoded = small.encode("utf-8")
    if len(encoded) >= len(raw):
        return raw, "sem-ganho"
    return encoded, "ok"
