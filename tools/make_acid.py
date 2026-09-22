#!/usr/bin/env python3
"""O ácido sulfúrico de Vênus, e os dois baldes.

A BASE é a dos líquidos do "Lots o' Liquid" que ele mandou: aquele addon é só
ITEM DE BALDE — item com ícone, pilha de 1, e o líquido existindo como coisa
que se carrega, não como bloco. Os baldes daqui seguem esse padrão.

O que aquele addon NÃO tem, e que este precisa, é o líquido no MUNDO. Bedrock
não deixa um pacote criar fluido de verdade — não há como declarar escoamento,
nível, nem fonte. O que dá pra fazer é um bloco que se COMPORTA como poça:

  - sem colisão, então se entra nele em vez de pisar em cima;
  - `render_method` de mistura, pra ele ser translúcido como líquido;
  - INDESTRUTÍVEL por mineração e por explosão.

O terceiro é o que faz a regra dele valer. "Só vai dar pra pegar com balde de
titânio" não seria verdade se desse pra quebrar o bloco com uma picareta: ele
soltaria nada e a poça sumiria. Sendo indestrutível, o ÚNICO jeito de tirar
ácido do mundo é o balde — e o script só aceita o de titânio.

E por que titânio: ácido sulfúrico concentrado come ferro (dá sulfato de ferro
e gás hidrogênio), e não come titânio, que passiva com uma casca de óxido. O
balde de ferro do jogo seria comido. Isso não é enfeite de história — é a
razão de a regra ser essa.
"""
import json
import os
import struct
import sys
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from langfile import escreve_idiomas  # noqa: E402

MARK = "## o ácido sulfúrico de Vênus (gerado por tools/make_acid.py)"
BP = os.path.join(ROOT, "packs", "Galactic Horizons BP")
RP = os.path.join(ROOT, "packs", "Galactic Horizons RP")
LADO = 32

# O ácido: amarelo-esverdeado turvo.
#
# Ácido sulfúrico puro é incolor; o de Vênus não é puro — é o que forma a nuvem
# do planeta junto com enxofre, e é essa mistura que dá a cor amarelada que as
# fotos mostram. Cinco tons, que é a regra de paleta do resto dos blocos daqui.
ACIDO = ["#8F8C2E", "#A3A035", "#B6B23E", "#C6C24A", "#D6D25C"]

# O titânio do balde: o mesmo cinza-frio do minério de titânio do addon.
TITANIO = ["#4A4E55", "#5E636B", "#737880", "#8A8F98", "#A2A7B0"]


def hex_rgb(h):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def escreve_png(path, w, h, px):
    raw = b""
    for y in range(h):
        raw += b"\x00" + bytes(v for x in range(w) for v in px[y][x])

    def bloco(tipo, body):
        return (struct.pack(">I", len(body)) + tipo + body
                + struct.pack(">I", zlib.crc32(tipo + body) & 0xFFFFFFFF))

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n"
                + bloco(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
                + bloco(b"IDAT", zlib.compress(raw, 9))
                + bloco(b"IEND", b""))


def ruido(x, y, semente):
    """Hash inteiro: o mesmo valor pro mesmo pixel, sempre."""
    n = (x * 374761393 + y * 668265263 + semente * 1274126177) & 0xFFFFFFFF
    n = (n ^ (n >> 13)) * 1274126177 & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 0xFFFF


def textura_acido():
    """A superfície do ácido: manchas largas, sem grão fino.

    Grão fino leria como pedra. Líquido tem mancha GRANDE e borda macia, então
    o ruído é amostrado numa grade de 4 pixels e interpolado — é o que dá
    manchas de uns 8 pixels em vez de chuvisco.
    """
    px = []
    for y in range(LADO):
        linha = []
        for x in range(LADO):
            # duas escalas, a grande mandando
            gx, gy = x / 4.0, y / 4.0
            x0, y0 = int(gx), int(gy)
            fx, fy = gx - x0, gy - y0
            # interpolação suave entre os quatro cantos da célula
            def n(i, j):
                return ruido((x0 + i) % 8, (y0 + j) % 8, 7)
            sx = fx * fx * (3 - 2 * fx)
            sy = fy * fy * (3 - 2 * fy)
            a = n(0, 0) + (n(1, 0) - n(0, 0)) * sx
            b = n(0, 1) + (n(1, 1) - n(0, 1)) * sx
            v = a + (b - a) * sy
            v = 0.78 * v + 0.22 * ruido(x % 16, y % 16, 21)
            tom = ACIDO[min(len(ACIDO) - 1, int(v * len(ACIDO)))]
            # Alfa 200: translúcido como líquido, e opaco o bastante pra a poça
            # não virar um vidro colorido.
            linha.append((*hex_rgb(tom), 200))
        px.append(linha)
    return px


# O balde, desenhado em 16x16 e dobrado pra 32.
#
#   . vazio   b borda   c corpo   l luz   s sombra   L o líquido
BALDE = [
    "................",
    "................",
    "..bbbb....bbbb..",
    "..blcb....bcsb..",
    "..bcLLLLLLLLcb..",
    "..bLLLLLLLLLLb..",
    "...bLLLLLLLLb...",
    "...blccccccsb...",
    "...blccccccsb...",
    "...blccccccsb...",
    "....blccccsb....",
    "....blccccsb....",
    ".....bccccb.....",
    ".....bbbbbb.....",
    "................",
    "................",
]


def textura_balde(com_acido):
    """O balde, vazio ou cheio. O mesmo desenho; só o miolo muda."""
    cor = {
        "b": hex_rgb(TITANIO[0]),
        "s": hex_rgb(TITANIO[1]),
        "c": hex_rgb(TITANIO[2]),
        "l": hex_rgb(TITANIO[4]),
    }
    px = []
    for y in range(LADO):
        linha = []
        for x in range(LADO):
            ch = BALDE[y // 2][x // 2]
            if ch == ".":
                # Transparente, e NÃO preto: o mipmap mistura o vizinho na
                # borda, e vizinho preto desenha um contorno escuro no ícone.
                linha.append((*hex_rgb(TITANIO[2]), 0))
            elif ch == "L":
                if com_acido:
                    # ondulado leve, pra o líquido não ser um retângulo chapado
                    t = 3 if ((x // 2) + (y // 3)) % 4 < 2 else 4
                    linha.append((*hex_rgb(ACIDO[t]), 255))
                else:
                    # vazio: o miolo é a parede de dentro do balde, na sombra
                    linha.append((*hex_rgb(TITANIO[0]), 255))
            else:
                linha.append((*cor[ch], 255))
        px.append(linha)
    return px


def junta(caminho, chave, novos):
    doc = json.load(open(caminho, encoding="utf-8")) if os.path.exists(caminho) else {}
    doc.setdefault(chave, {}).update(novos)
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")


def escreve(caminho, doc):
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")


def main():
    # --- texturas ---------------------------------------------------------
    escreve_png(os.path.join(RP, "textures", "gh", "blocks", "sulfuric_acid.png"),
                LADO, LADO, textura_acido())
    escreve_png(os.path.join(RP, "textures", "gh", "items", "titanium_bucket.png"),
                LADO, LADO, textura_balde(False))
    escreve_png(os.path.join(RP, "textures", "gh", "items", "sulfuric_acid_bucket.png"),
                LADO, LADO, textura_balde(True))

    junta(os.path.join(RP, "textures", "terrain_texture.json"), "texture_data", {
        "gh_sulfuric_acid": {"textures": "textures/gh/blocks/sulfuric_acid"},
    })
    junta(os.path.join(RP, "textures", "item_texture.json"), "texture_data", {
        "gh_titanium_bucket": {"textures": "textures/gh/items/titanium_bucket"},
        "gh_sulfuric_acid_bucket": {"textures": "textures/gh/items/sulfuric_acid_bucket"},
    })
    blocos = json.load(open(os.path.join(RP, "blocks.json"), encoding="utf-8"))
    blocos["gh:sulfuric_acid"] = {"textures": "gh_sulfuric_acid", "sound": "slime"}
    escreve(os.path.join(RP, "blocks.json"), blocos)

    # --- o bloco ----------------------------------------------------------
    escreve(os.path.join(BP, "blocks", "sulfuric_acid.json"), {
        "format_version": "1.21.80",
        "minecraft:block": {
            "description": {"identifier": "gh:sulfuric_acid"},
            "components": {
                "minecraft:material_instances": {
                    "*": {
                        "texture": "gh_sulfuric_acid",
                        # `blend` e não `alpha_test`: alpha_test é liga-desliga
                        # (o pixel aparece ou não), e líquido precisa de
                        # translucidez de verdade.
                        "render_method": "blend",
                        "ambient_occlusion": False,
                        "face_dimming": False,
                    },
                },
                # SEM COLISÃO: entra-se nele, como em qualquer líquido. Com
                # colisão a poça viraria um bloco de vidro em que se anda por
                # cima, e o perigo dela deixaria de existir.
                "minecraft:collision_box": False,
                # A caixa de seleção fica: é ela que deixa MIRAR a poça pra
                # encher o balde.
                "minecraft:selection_box": {
                    "origin": [-8, 0, -8], "size": [16, 16, 16],
                },
                # INDESTRUTÍVEL, e é isto que faz a regra do balde valer. Se
                # desse pra quebrar com picareta, a poça sumiria sem soltar
                # nada e "só com balde de titânio" seria mentira.
                "minecraft:destructible_by_mining": False,
                "minecraft:destructible_by_explosion": False,
                # Brilho fraco: em Vênus a névoa fecha a 46 blocos, e sem um
                # pingo de luz a poça só apareceria quando já se caiu nela.
                "minecraft:light_emission": 3,
                "minecraft:light_dampening": 1,
                "minecraft:map_color": "#B6B23E",
            },
        },
    })

    # --- os dois baldes ---------------------------------------------------
    # O padrão é o dos baldes do addon dele: ícone, pilha de 1, e nada mais.
    # O que ENCHE e o que DESPEJA é script (scripts/gh/acid.js) — o jogo não
    # deixa um item de pacote virar balde de verdade.
    for item_id, icone, cor in (
        ("titanium_bucket", "gh_titanium_bucket", "aqua"),
        ("sulfuric_acid_bucket", "gh_sulfuric_acid_bucket", "yellow"),
    ):
        escreve(os.path.join(BP, "items", item_id + ".json"), {
            "format_version": "1.21.80",
            "minecraft:item": {
                "description": {
                    "identifier": "gh:" + item_id,
                    "menu_category": {"category": "items"},
                },
                "components": {
                    "minecraft:icon": icone,
                    "minecraft:max_stack_size": 1,
                    "minecraft:hover_text_color": cor,
                },
            },
        })

    # --- a receita do balde ------------------------------------------------
    # A forma do balde de ferro, com titânio no lugar do ferro.
    escreve(os.path.join(BP, "recipes", "titanium_bucket.json"), {
        "format_version": "1.12",
        "minecraft:recipe_shaped": {
            "description": {"identifier": "gh:titanium_bucket"},
            "tags": ["crafting_table"],
            "pattern": ["T T", " T "],
            "key": {"T": {"item": "gh:titanium"}},
            "result": {"item": "gh:titanium_bucket", "count": 1},
        },
    })

    # --- os nomes ----------------------------------------------------------
    pt = [
        "tile.gh:sulfuric_acid.name=Ácido Sulfúrico",
        "item.gh:titanium_bucket=Balde de Titânio",
        "item.gh:sulfuric_acid_bucket=Balde de Ácido Sulfúrico",
    ]
    en = [
        "tile.gh:sulfuric_acid.name=Sulfuric Acid",
        "item.gh:titanium_bucket=Titanium Bucket",
        "item.gh:sulfuric_acid_bucket=Sulfuric Acid Bucket",
    ]
    escreve_idiomas(RP, MARK, pt, en)

    print("Ácido sulfúrico: 1 bloco (sem colisão, indestrutível) + 2 baldes")
    print("  poças na planície de Vênus; só o balde de titânio enche")


if __name__ == "__main__":
    main()
