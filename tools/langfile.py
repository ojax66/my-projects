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
