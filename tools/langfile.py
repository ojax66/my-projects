"""Escrita de blocos marcados num .lang, sem depender da ordem dos geradores.

Cada gerador é dono de UM bloco, marcado por um comentário `## ...`. A versão
anterior escrevia assim:

    existing = open(path).read().split(MARK)[0]

ou seja: guardava o que vinha ANTES do próprio marcador e jogava fora tudo que
vinha depois. Funcionava enquanto os geradores rodassem sempre na mesma ordem,
e quebrava calado toda vez que um deles fosse rodado sozinho — o .lang perdia os
blocos dos outros, e os itens apareciam no jogo com o id no lugar do nome.

Aqui o arquivo é lido como uma lista de blocos e o gerador troca só o seu, rode
quem rodar, na ordem que for.
"""
import os


def _parse(path):
    """(preâmbulo, [(marcador, linhas), ...]) — o preâmbulo é o que vem antes
    do primeiro marcador (pack.name, o nome do bioma, e afins)."""
    if not os.path.isfile(path):
        return [], []
    head, blocks = [], []
    with open(path, encoding="utf-8") as f:
        for line in f.read().splitlines():
            if line.strip().startswith("## "):
                blocks.append((line.strip(), []))
            elif blocks:
                blocks[-1][1].append(line)
            else:
                head.append(line)
    return head, blocks


def _trim(lines):
    out = list(lines)
    while out and not out[-1].strip():
        out.pop()
    while out and not out[0].strip():
        out.pop(0)
    return out


def replace_section(path, marker, lines):
    """Troca (ou acrescenta) o bloco `marker`, preservando todos os outros."""
    marker = marker.strip()
    head, blocks = _parse(path)

    replaced = False
    for i, (mark, _) in enumerate(blocks):
        if mark == marker:
            blocks[i] = (marker, list(lines))
            replaced = True
            break
    if not replaced:
        blocks.append((marker, list(lines)))

    out = _trim(head)
    for mark, body in blocks:
        body = _trim(body)
        if not body:
            continue          # bloco vazio não fica no arquivo
        out += ["", mark] + body

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")


# ---------------------------------------------------------------------------
# Os cinco idiomas
# ---------------------------------------------------------------------------
# O addon fala português, inglês e espanhol. Cada gerador sabe o pt e o en das
# coisas dele; o ESPANHOL fica todo num lugar só (tools/assets/es.json), como
# um dicionário do texto em português pro texto em espanhol.
#
# Por que num arquivo à parte e não numa terceira coluna em cada tabela: são
# nove geradores e mais de cem nomes. Espalhado, revisar a tradução exige abrir
# nove arquivos e caçar campo por campo; junto, é uma lista que se lê de cima a
# baixo. E o que faltar não some calado — `FALTANDO_ES` acumula, o gerador
# avisa e o validador reprova.
import json as _json

_ES = None
FALTANDO_ES = set()


def _dicionario_es():
    global _ES
    if _ES is None:
        caminho = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               "assets", "es.json")
        if os.path.isfile(caminho):
            with open(caminho, encoding="utf-8") as f:
                _ES = {k: v for k, v in _json.load(f).items()
                       if not k.startswith("_")}
        else:
            _ES = {}
    return _ES


def para_es(texto):
    """O texto em espanhol. Sem tradução, devolve o português e ANOTA."""
    d = _dicionario_es()
    if texto in d:
        return d[texto]
    FALTANDO_ES.add(texto)
    return texto


def escreve_idiomas(rp, marcador, linhas_pt, linhas_en):
    """Grava o bloco `marcador` nos cinco .lang do pack.

    pt_BR / en_US / en_GB saem das listas; es_ES / es_MX saem do português
    passado pelo dicionário, chave por chave — a chave (o que vem antes do
    `=`) nunca é traduzida, só o valor.
    """
    textos = os.path.join(rp, "texts")
    replace_section(os.path.join(textos, "pt_BR.lang"), marcador, linhas_pt)
    for lang in ("en_US", "en_GB"):
        replace_section(os.path.join(textos, f"{lang}.lang"), marcador, linhas_en)

    linhas_es = []
    for linha in linhas_pt:
        chave, sep, valor = linha.partition("=")
        linhas_es.append(f"{chave}{sep}{para_es(valor)}" if sep else linha)
    for lang in ("es_ES", "es_MX"):
        replace_section(os.path.join(textos, f"{lang}.lang"), marcador, linhas_es)
