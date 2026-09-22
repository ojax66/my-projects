#!/usr/bin/env python3
"""Vênus vista do espaço: o disco de nuvem e as quatro camadas de atmosfera.

A primeira versão era o molde de Marte com faixas pintadas por cima, e ficava
feia pelo motivo certo: Vênus NÃO é um planeta listrado. Em luz visível ela é
quase lisa — um creme amarelado sem nada, o objeto mais brilhante do céu
depois do Sol e da Lua, porque a nuvem reflete 75% da luz que recebe. As
faixas em "Y" que todo mundo conhece só aparecem em ULTRAVIOLETA, e mesmo lá
são suaves.

E o que se vê de Vênus NUNCA é a superfície. É o topo da nuvem, a 70 km de
altura. Ninguém jamais viu o chão dela de fora — foi preciso pousar (as
Venera) ou usar radar (a Magalhães).

AS QUATRO CAMADAS são as de verdade, de fora pra dentro:

    névoa superior      70–90 km   tênue, quase branca
    nuvem superior      57–70 km   o creme amarelado que se vê
    nuvem média/baixa   48–57 km   mais densa, mais alaranjada
    névoa inferior      30–48 km   laranja fundo, já perto do chão

Como elas são desenhadas: cubos concêntricos NO MESMO MODELO do corpo, com o
cubo do corpo POR ÚLTIMO, e o material `gh_halo` (sky mais DisableDepthWrite).
As três coisas juntas — faltar uma quebra tudo em silêncio. Casca em entidade
separada já foi tentada e vira um quadrado tapando o planeta; ver as notas em
tools/validate.py.

A ordem de desenho vem do ALFA: a superfície vai a 254 (passada transparente,
desenhada depois) e os anéis a 0 (passada opaca, antes). Assim o corpo tapa o
miolo dos anéis em vez de o contrário.
"""
import json
import math
import os
import struct
import sys
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from make_block_textures import read_png  # noqa: E402

RP = os.path.join(ROOT, "packs", "Galactic Horizons RP")
LADO = 256          # a planificação do cubo: 4 colunas x 4 linhas de 64
CELULA = 64

# --- as quatro camadas, de fora pra dentro --------------------------------
# (escala sobre o raio do corpo, cor)
#
# As escalas são DRAMATIZADAS, e isso é deliberado — como já é na Terra, que
# tem atmosfera de 1,002 raio desenhada a 1,14. Na escala real a nuvem de
# Vênus seria 1,012 e não se veria nada. O que se mantém é a PROPORÇÃO entre
# elas e a ordem das cores, que são as de verdade.
CAMADAS = [
    (1.26, (232, 220, 196)),   # névoa superior: quase branca
    (1.20, (224, 207, 160)),   # nuvem superior: o creme que se vê
    (1.13, (212, 182, 120)),   # nuvem média: mais quente
    (1.06, (192, 154, 85)),    # névoa inferior: laranja fundo
]
REACH = CAMADAS[0][0]

# O topo da nuvem, que é o que o disco mostra.
NUVEM_CLARA = (238, 226, 198)
NUVEM_ESCURA = (206, 180, 132)

# Onde cada anel mora na planificação: linha 3, uma célula pra cada.
#
# Linha 3 e não linha 2: a linha 2 fica colada na linha das faces, e cor
# chapada encostando numa face vaza pra dentro dela quando o mipmap mistura.
# Cada mancha é 32x32 centrada numa célula de 64, então sobram 16 px de folga
# em volta — nenhuma encosta em nenhuma.
LINHA_ANEIS = 3


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


def nuvem(u, v):
    """A cor do topo da nuvem no ponto (u, v) de uma face, ambos em 0..1.

    Quase liso de propósito. O contraste é BAIXO — o desvio máximo é de uns
    6% — porque é isso que Vênus é em luz visível: quem espera listras está
    lembrando das fotos em ultravioleta, que são processadas pra realçar
    justamente o que a vista não pega.
    """
    # Faixa larga e inclinada, com a borda torta: a "onda" que as fotos em
    # ultravioleta mostram, aqui bem mais fraca do que nelas.
    onda = math.sin(v * 5.2 + math.sin(u * 3.1) * 0.9)
    # Um segundo campo, mais fino e fora de fase, pra a faixa não virar listra
    # de camiseta.
    fino = math.sin(v * 13.0 + u * 2.2 + 1.7)
    t = 0.5 + 0.5 * (0.74 * onda + 0.26 * fino)
    # Comprime pro meio: o disco de Vênus é claro em quase toda a extensão, e
    # o escuro é exceção, não metade.
    t = t ** 2.1
    return tuple(int(NUVEM_CLARA[i] + (NUVEM_ESCURA[i] - NUVEM_CLARA[i]) * t)
                 for i in range(3))


def main():
    # Fundo transparente — mas NÃO preto.
    #
    # O que o mipmap faz com a borda é misturar o vizinho, e vizinho preto
    # desenha uma moldura escura em volta do planeta quando ele está longe.
    # O alfa é 0 do mesmo jeito (nada disso é desenhado), e a COR é a da nuvem,
    # que é o que borra sem aparecer.
    px = [[(*NUVEM_CLARA, 0) for _ in range(LADO)] for _ in range(LADO)]

    # --- as seis faces, na mesma planificação que a Terra usa --------------
    faces = {
        "up": (1, 0), "down": (2, 0),
        "east": (0, 1), "north": (1, 1), "west": (2, 1), "south": (3, 1),
    }
    for nome, (cx, cy) in faces.items():
        for j in range(CELULA):
            for i in range(CELULA):
                u, v = i / CELULA, j / CELULA
                # Cada face tem a sua fase, senão as seis saem idênticas e o
                # cubo fica com a mesma marca nos seis lados.
                desloc = list(faces).index(nome) * 0.37
                r, g, b = nuvem(u + desloc, v + desloc * 0.6)
                # 254, não 255: 255 o jogo trata como opaco e o corpo sairia
                # ANTES dos anéis, tapando o halo. 254 manda o pixel pra
                # passada transparente sem mudar nada a olho nu.
                px[cy * CELULA + j][cx * CELULA + i] = (r, g, b, 254)

    # --- as manchas de cor dos anéis --------------------------------------
    for k, (_escala, cor) in enumerate(CAMADAS):
        ox = k * CELULA + 16
        oy = LINHA_ANEIS * CELULA + 16
        for j in range(32):
            for i in range(32):
                # Alfa 0: os anéis ficam na passada OPACA, desenhados antes do
                # corpo. Ver o cabeçalho.
                px[oy + j][ox + i] = (*cor, 0)

    escreve_png(os.path.join(RP, "textures", "gh", "sky", "venus.png"),
                LADO, LADO, px)

    # --- o modelo: anéis de fora pra dentro, e o CORPO POR ÚLTIMO ---------
    cubos = []
    for k, (escala, _cor) in enumerate(CAMADAS):
        tam = round(16 * escala, 4)
        uv = [k * CELULA + 16, LINHA_ANEIS * CELULA + 16]
        cubos.append({
            "origin": [-tam / 2, -tam / 2, -tam / 2],
            "size": [tam, tam, tam],
            "uv": {f: {"uv": list(uv), "uv_size": [32, 32]}
                   for f in ("up", "down", "east", "north", "west", "south")},
        })
    cubos.append({
        "origin": [-8, -8, -8],
        "size": [16, 16, 16],
        "uv": {
            "up": {"uv": [64, 0], "uv_size": [64, 64]},
            "down": {"uv": [128, 0], "uv_size": [64, 64]},
            "east": {"uv": [0, 64], "uv_size": [64, 64]},
            "north": {"uv": [64, 64], "uv_size": [64, 64]},
            "west": {"uv": [128, 64], "uv_size": [64, 64]},
            "south": {"uv": [192, 64], "uv_size": [64, 64]},
        },
    })
    geo = {
        "format_version": "1.12.0",
        "minecraft:geometry": [{
            "description": {
                "identifier": "geometry.gh.sky_venus",
                "texture_width": LADO,
                "texture_height": LADO,
                "visible_bounds_width": 64,
                "visible_bounds_height": 64,
                "visible_bounds_offset": [0, 0, 0],
            },
            "bones": [{"name": "body", "pivot": [0, 0, 0], "cubes": cubos}],
        }],
    }
    caminho = os.path.join(RP, "models", "entity", "sky_venus.geo.json")
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(geo, f, indent=2, ensure_ascii=False)
        f.write("\n")

    # --- a entidade do cliente -------------------------------------------
    ent_path = os.path.join(RP, "entity", "sky_venus.entity.json")
    ent = json.load(open(ent_path, encoding="utf-8"))
    desc = ent["minecraft:client_entity"]["description"]
    desc["geometry"]["default"] = "geometry.gh.sky_venus"
    # `gh_halo` é o sky mais DisableDepthWrite. Sem ele o cubo do corpo, que
    # está ATRÁS dos anéis, é recusado pelo teste de profundidade e some.
    desc["materials"]["default"] = "gh_halo"
    with open(ent_path, "w", encoding="utf-8") as f:
        json.dump(ent, f, indent=2, ensure_ascii=False)
        f.write("\n")

    conferido = read_png(os.path.join(RP, "textures", "gh", "sky", "venus.png"))
    cores = {p[:3] for linha in conferido for p in linha if p[3]}
    print(f"Vênus no céu: {LADO}x{LADO}, {len(cores)} tons de nuvem, "
          f"{len(CAMADAS)} camadas de atmosfera (reach {REACH})")
    for escala, cor in CAMADAS:
        print(f"  {escala:.2f}  #{cor[0]:02X}{cor[1]:02X}{cor[2]:02X}")


if __name__ == "__main__":
    main()
