"""Gera os itens que os minérios novos largam: silício, titânio e hélio-3.

Estes três não têm equivalente no jogo base, então largam item próprio (os
outros minérios largam o item cru do jogo, que já serve pra tudo). A tabela é
tools/assets/ores.json, a mesma que o gerador de blocos e o de texturas usam.

O ÍCONE DO SILÍCIO É DELE: tools/assets/icons/silicon.png — um pedaço de
cristal, copiado sem tocar em nada.

Os outros dois têm FORMA PRÓPRIA, desenhada aqui, pelo mesmo motivo que os
minérios deles têm: não são a mesma coisa e não deviam parecer.

  TITÂNIO   um feixe de agulhas. Rutilo e ilmenita, os minerais de titânio,
            crescem em prismas longos e finos.
  HÉLIO-3   bolhas. Não é cristal nenhum — é gás preso no regolito.

Repintar o cristal dele nas duas cores era o que estava lá antes, e deixava
três itens com o mesmo contorno no inventário.
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
NS = "gh"
FORMAT_VERSION = "1.21.80"


def hex_rgb(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def luma(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def recolor(img, base_hex):
    """O desenho dele na cor de outro material, mantendo a escada de brilho.

    Sobra pra quem não tem forma própria. Hoje ninguém usa — os três materiais
    ou são o desenho dele ou têm forma aqui — mas um material novo entra por
    aqui até ganhar a sua.
    """
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


# --- As formas próprias ------------------------------------------------------
#
# Cada uma devolve {(x, y): tom}, num quadro de 16x16, com os tons de 1 (sombra)
# a 4 (brilho). O 0 é o contorno, posto depois em volta de tudo.
LADO = 16

# (coluna, topo, base, largura) — três agulhas de alturas diferentes, como um
# feixe de cristal.
AGULHAS = ((3, 5, 13, 2), (6, 2, 14, 3), (10, 4, 12, 2))

# (coluna, linha, raio) — quatro bolhas separadas. Encostadas elas viram uma
# mancha roxa só, que foi a primeira tentativa.
BOLHAS = ((4, 3, 2), (10, 4, 2), (6, 10, 3), (12, 10, 1))


def forma_agulhas():
    px = {}
    for cx, y0, y1, w in AGULHAS:
        for y in range(y0, y1 + 1):
            larg = 1 if y < y0 + 2 else w        # a ponta afina
            for i in range(larg):
                if y > y1 - 2:
                    tom = 1                      # a base, na sombra
                elif y == y0 or (i == 0 and y < y0 + 5):
                    tom = 4                      # o brilho que desce da ponta
                else:
                    tom = 3 if i == 0 else 2
                px[(cx + i, y)] = tom
    return px


def forma_bolhas():
    px = {}
    for cx, cy, r in BOLHAS:
        for y in range(cy - r, cy + r + 1):
            for x in range(cx - r, cx + r + 1):
                dx, dy = x - cx, y - cy
                if dx * dx + dy * dy > r * r + r:
                    continue                     # fora da bola
                if dx <= -r + 1 and dy <= -r + 1:
                    tom = 4                      # o brilho, no canto de cima
                elif dx + dy >= r:
                    tom = 1                      # a sombra, na barriga de baixo
                elif dx < 0 and dy < 0:
                    tom = 3
                else:
                    tom = 2
                px[(x, y)] = tom
    return px


FORMAS = {"titanium": forma_agulhas, "helium3": forma_bolhas}


def contorna(px):
    """Borda escura em volta, como todo ícone de item do jogo."""
    out = dict(px)
    for (x, y) in px:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if (nx, ny) not in px and 0 <= nx < LADO and 0 <= ny < LADO:
                out[(nx, ny)] = 0
    return out


def rampa(base_hex):
    """Contorno, sombra, corpo, luz e brilho — cinco tons da cor do material."""
    r, g, b = hex_rgb(base_hex)
    escuros = [tuple(round(c * k) for c in (r, g, b)) for k in (0.3, 0.5, 0.72, 0.88)]
    brilho = tuple(min(255, round(c + (255 - c) * 0.45)) for c in (r, g, b))
    return escuros + [brilho]


def desenha(forma, base_hex):
    from PIL import Image

    im = Image.new("RGBA", (LADO, LADO), (0, 0, 0, 0))
    px = im.load()
    tons = rampa(base_hex)
    for (x, y), tom in contorna(forma).items():
        px[x, y] = tons[tom] + (255,)
    return im


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
        elif nome in FORMAS:
            desenha(FORMAS[nome](), item["color"]).save(destino)
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
    print(f"  ícone do {dono} copiado de {os.path.relpath(fonte, ROOT)}")
    for nome in sorted(FORMAS):
        print(f"  ícone do {nome}: forma própria ({FORMAS[nome].__name__})")


if __name__ == "__main__":
    main()
