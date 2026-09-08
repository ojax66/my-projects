#!/usr/bin/env python3
"""Troca todos os UUIDs dos dois packs por UUIDs novos.

Pra que serve: o Minecraft identifica um pack pelo UUID, não pelo nome nem pelo
arquivo. Reimportar um .mcaddon com os UUIDs de sempre cai em cima da versão já
instalada, e nem sempre o jogo troca os arquivos — dá pra passar uma tarde
testando a build anterior sem perceber. UUID novo entra como pack novo, e não
tem como confundir.

O preço: o mundo que já usava a versão antiga não migra sozinho. É preciso
ativar o pack novo nele. Os blocos e itens já colocados sobrevivem, porque eles
são identificados por `space_dim:<nome>`, que não muda — só o pack muda de
identidade, o conteúdo não.

São cinco UUIDs, e as duas dependências cruzadas precisam continuar batendo
depois da troca:

    BP.header  <──── RP.dependencies[0]
    RP.header  <──── BP.dependencies[0]
    BP.modules[data], BP.modules[script], RP.modules[resources]

Uso: python3 tools/new_uuids.py
"""
import json
import os
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "Distant Horizons BP", "manifest.json")
RP = os.path.join(ROOT, "packs", "Distant Horizons RP", "manifest.json")


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save(path, doc):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")


def main():
    bp = load(BP)
    rp = load(RP)

    old_bp_header = bp["header"]["uuid"]
    old_rp_header = rp["header"]["uuid"]

    new_bp_header = str(uuid.uuid4())
    new_rp_header = str(uuid.uuid4())

    bp["header"]["uuid"] = new_bp_header
    rp["header"]["uuid"] = new_rp_header
    for mod in bp["modules"] + rp["modules"]:
        mod["uuid"] = str(uuid.uuid4())

    # As dependências entre os dois packs apontam pro *header* do outro. Trocar
    # o header sem trocar isto aqui deixa cada pack pedindo um pack que não
    # existe mais — e o jogo recusa os dois, sem dizer por quê.
    fixed = 0
    for doc, old, new in ((bp, old_rp_header, new_rp_header),
                          (rp, old_bp_header, new_bp_header)):
        for dep in doc.get("dependencies", []):
            if dep.get("uuid") == old:
                dep["uuid"] = new
                fixed += 1
    if fixed != 2:
        raise SystemExit(
            f"esperava 2 dependências cruzadas pra corrigir, achei {fixed} — "
            f"confira os manifests antes de empacotar"
        )

    save(BP, bp)
    save(RP, rp)

    print("UUIDs novos:")
    print(f"  BP header    {new_bp_header}")
    for mod in bp["modules"]:
        print(f"  BP {mod['type']:<10}{mod['uuid']}")
    print(f"  RP header    {new_rp_header}")
    for mod in rp["modules"]:
        print(f"  RP {mod['type']:<10}{mod['uuid']}")
    print("\nDependências cruzadas religadas. O mundo antigo precisa ativar o pack novo.")


if __name__ == "__main__":
    main()
