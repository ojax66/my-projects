"""Gera os itens que os minérios novos largam: silício, titânio e hélio-3.

Estes três não têm equivalente no jogo base, então largam item próprio (os
outros minérios largam o item cru do jogo, que já serve pra tudo). A tabela é
tools/assets/ores.json, a mesma que o gerador de blocos e o de texturas usam.

O ÍCONE DO SILÍCIO É DELE: tools/assets/icons/silicon.png. Os outros dois saem
desse mesmo desenho com a cor trocada — o mesmo critério das texturas de
minério, e pelo mesmo motivo: o traço tem que ser um só. A troca é por BRILHO,
pixel a pixel: cada tom do desenho dele vira o tom de mesma luminosidade na cor
do outro material, então sombra, meio-tom e reflexo continuam onde estavam.
"""
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from langfile import replace_section  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "Galactic Horizons BP")
RP = os.path.join(ROOT, "packs", "Galactic Horizons RP")
ASSETS = os.path.join(ROOT, "tools", "assets")
NS = "space_dim"
FORMAT_VERSION = "1.21.80"


def hex_rgb(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def luma(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def recolor(img, base_hex):
    """O desenho dele na cor de outro material, mantendo a escada de brilho."""
    from PIL import Image

    r, g, b = hex_rgb(base_hex)
    l0 = luma((r, g, b))
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    px = out.load()
    src = img.load()
    for y in range(img.height):
        for x in range(img.width):
            c = src[x, y]
            if c[3] == 0:
                continue
            alvo = luma(c)
            if alvo <= l0:
                k = alvo / l0 if l0 else 0
                novo = tuple(min(255, round(v * k)) for v in (r, g, b))
            else:
                t = (alvo - l0) / (255 - l0) if l0 < 255 else 0
                novo = tuple(min(255, round(v + (255 - v) * t)) for v in (r, g, b))
            px[x, y] = novo + (c[3],)
    return out


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def main():
    from PIL import Image

    spec = json.load(open(os.path.join(ASSETS, "ores.json"), encoding="utf-8"))
    fonte = os.path.join(ASSETS, spec["pattern"]["icon_ref"])
    base_icon = Image.open(fonte).convert("RGBA")
    # O material cujo ícone é o arquivo dele: copiado, nunca recolorido.
    dono = os.path.splitext(os.path.basename(fonte))[0]

    materiais = {}
    for tipo, t in spec["types"].items():
        if "item" in t:
            materiais[tipo] = t

    icon_dir = os.path.join(RP, "textures", NS, "items")
    os.makedirs(icon_dir, exist_ok=True)

    for nome, t in materiais.items():
        item = t["item"]
        iid = t["drop"]
        if not iid.startswith(f"{NS}:"):
            raise SystemExit(f"{nome}: item próprio tem que ser do addon, veio {iid}")
        curto = iid.split(":")[1]

        # --- ícone -----------------------------------------------------------
        # O arquivo tem o nome EXATO do item; a chave do atlas leva o
        # namespace, que é o que a torna única entre packs.
        destino = os.path.join(icon_dir, f"{curto}.png")
        if nome == dono:
            shutil.copyfile(fonte, destino)
        else:
            recolor(base_icon, item["color"]).save(destino)

        # --- item ------------------------------------------------------------
        write_json(
            os.path.join(BP, "items", f"{curto}.json"),
            {
                "format_version": FORMAT_VERSION,
                "minecraft:item": {
                    "description": {
                        "identifier": iid,
                        "menu_category": {
                            "category": "items",
                            "group": "minecraft:itemGroup.name.miscFood",
                        },
                    },
                    "components": {
                        "minecraft:icon": f"{NS}_{curto}",
                        "minecraft:max_stack_size": 64,
                        "minecraft:hover_text_color": "aqua",
                    },
                },
            },
        )

    # --- item_texture.json -----------------------------------------------------
    # Mescla: o atlas é compartilhado com os trajes, a armadura e o rastreador.
    path = os.path.join(RP, "textures", "item_texture.json")
    doc = json.load(open(path, encoding="utf-8")) if os.path.isfile(path) else {
        "resource_pack_name": NS, "texture_name": "atlas.items", "texture_data": {},
    }
    for t in materiais.values():
        curto = t["drop"].split(":")[1]
        doc["texture_data"][f"{NS}_{curto}"] = {
            "textures": f"textures/{NS}/items/{curto}"
        }
    write_json(path, doc)

    # --- nomes -----------------------------------------------------------------
    MARK = "## materiais dos planetas (gerado por tools/make_materials.py)"
    for lang, key in (("pt_BR", "pt"), ("en_US", "en"), ("en_GB", "en")):
        replace_section(
            os.path.join(RP, "texts", f"{lang}.lang"), MARK,
            [f"item.{t['drop']}={t['item'][key]}" for t in materiais.values()],
        )

    print(f"{len(materiais)} materiais: {', '.join(sorted(materiais))}")
    print(f"  ícone do {dono} copiado de {os.path.relpath(fonte, ROOT)}; "
          f"os outros saem dele com a cor trocada")


if __name__ == "__main__":
    main()
