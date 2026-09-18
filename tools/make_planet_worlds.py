#!/usr/bin/env python3
"""Gera as dimensões, os biomas e os nomes da Lua e de Marte.

A fonte da verdade é UMA: `scripts/gh/planets.js`. Quem quiser mudar um
bioma de nome, trocar a cor do céu ou acrescentar um bioma mexe lá e roda isto —
os JSONs de dimensão, os biomas dos dois packs e os .lang saem daqui.

Escrever isso à mão era o caminho curto pro erro que não aparece: um bioma
citado no script e sem arquivo no pacote não dá erro nenhum no jogo, só um
pedaço de mundo sem névoa e sem nome. O validador confere os dois lados.

As NÉVOAS não são geradas: elas carregam cor, começo e fim, que são decisão de
aparência e não derivam de nada. Ficam em RP/fogs escritas à mão — o validador
confere que toda névoa citada por um bioma existe.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from langfile import replace_section  # noqa: E402

BP = os.path.join(ROOT, "packs", "Galactic Horizons BP")
RP = os.path.join(ROOT, "packs", "Galactic Horizons RP")
PLANETS_JS = os.path.join(BP, "scripts", "gh", "planets.js")

MARK = "## dimensões da Lua e de Marte (gerado por tools/make_planet_worlds.py)"

# Tags de bioma por planeta. Não saem do script porque não são usadas por ele —
# são pra quem for escrever regras de spawn ou de estrutura depois.
TAGS = {
    "moon": ["lua", "moon", "regolito", "sem_atmosfera", "no_legacy_worldgen"],
    "mars": ["marte", "mars", "ferrita", "sem_atmosfera", "no_legacy_worldgen"],
}

# Nome em inglês de cada bioma. O português vem do próprio planets.js (é o que o
# jogador vê na action bar); aqui fica só a tradução.
EN = {
    "mar_de_basalto": "Basalt Sea",
    "terras_altas": "Highlands",
    "bacia_de_impacto": "Impact Basin",
    "polo_sombrio": "Shadowed Pole",
    "planicie_boreal": "Boreal Plain",
    "terras_altas_do_sul": "Southern Highlands",
    "valles": "Valles Marineris",
    "tharsis": "Tharsis Plateau",
    "campo_de_dunas": "Dune Field",
    "calota_polar": "Polar Cap",
}

# O nome do planeta, sem os códigos de cor do Minecraft.
PLANET_EN = {"moon": "Moon", "mars": "Mars"}


def strip_colors(text):
    return re.sub(r"§.", "", text)


def read_bounds(src):
    """PLANET_BOUNDS: os limites verticais das duas dimensões.

    Eles moram no script porque o gerador de terreno usa os mesmos números pra
    limitar a altura — escrever o teto no JSON e no script separado é como o
    relevo acaba passando do teto sem nada avisar.
    """
    m = re.search(r"PLANET_BOUNDS = \{ min: (-?\d+), max: (-?\d+) \};", src)
    if not m:
        raise SystemExit("planets.js sem PLANET_BOUNDS")
    return {"min": int(m.group(1)), "max": int(m.group(2))}


def read_exit_y(src):
    m = re.search(r"^export const PLANET_EXIT_Y = (\d+);", src, re.M)
    if not m:
        raise SystemExit("planets.js sem PLANET_EXIT_Y")
    return int(m.group(1))


def read_planets():
    src = open(PLANETS_JS, encoding="utf-8").read()
    out = []
    for m in re.finditer(r"\nconst (?:MOON|MARS) = \{(.*?)\n\};", src, re.S):
        body = m.group(1)

        def field(name):
            f = re.search(r'\n  %s: "([^"]+)"' % name, body)
            return f.group(1) if f else None

        planet = {
            "id": field("id"),
            "dimensionId": field("dimensionId"),
            "name": field("name"),
            "defaultBiome": field("defaultBiome"),
            "fog": field("fog"),
            "sky": field("skyColor"),
            "biomes": [],
        }
        for b in re.finditer(
                r'\{\s*\n\s*id: "(\w+)",\s*\n\s*biomeId: "([^"]+)",\s*\n\s*name: "([^"]+)",',
                body):
            bid, biome_id, name = b.groups()
            tail = body[b.end():]
            # o resto DESTE bioma, até o próximo `id:` de bioma
            nxt = re.search(r'\n\s*\{\s*\n\s*id: "', tail)
            seg = tail[:nxt.start()] if nxt else tail
            fog = re.search(r'fog: "([^"]+)"', seg)
            planet["biomes"].append({
                "id": bid,
                "biomeId": biome_id,
                "name": name,
                "fog": fog.group(1) if fog else None,
            })
        out.append(planet)

    if len(out) != 2:
        raise SystemExit("planets.js: esperava 2 planetas, achei %d" % len(out))
    for p in out:
        missing = [k for k, v in p.items() if v is None]
        if missing:
            raise SystemExit("planets.js: %s sem %s" % (p["id"], ", ".join(missing)))
        ids = {b["biomeId"] for b in p["biomes"]}
        if p["defaultBiome"] not in ids:
            raise SystemExit("%s: defaultBiome %s não está entre os biomas"
                             % (p["id"], p["defaultBiome"]))
    return out


def write(path, doc):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")


def main():
    src = open(PLANETS_JS, encoding="utf-8").read()
    bounds = read_bounds(src)
    exit_y = read_exit_y(src)
    if exit_y >= bounds["max"]:
        raise SystemExit(
            "PLANET_EXIT_Y (%d) nao cabe embaixo do teto (%d): a porta de volta "
            "pro espaco nunca abriria" % (exit_y, bounds["max"]))

    planets = read_planets()
    written = 0

    for p in planets:
        short = p["dimensionId"].split(":")[1]
        write(os.path.join(BP, "dimensions", "%s_surface.json" % short), {
            "format_version": "1.21.80",
            "minecraft:dimension": {
                "description": {"identifier": p["dimensionId"]},
                "components": {
                    # Os limites saem de PLANET_BOUNDS, no script. O teto tem
                    # que ficar acima de PLANET_EXIT_Y, senão a porta de volta
                    # pro espaço não abre — conferido lá em cima.
                    "minecraft:dimension_bounds": bounds,
                    # O relevo é escrito por script (planetTerrain.js); o motor
                    # só precisa entregar a dimensão vazia.
                    "minecraft:generation": {"generator_type": "void"},
                    "minecraft:default_biome": {"biome": p["defaultBiome"]},
                },
            },
        })
        written += 1

        for b in p["biomes"]:
            name = b["biomeId"].split(":")[1]
            write(os.path.join(BP, "biomes", "%s.json" % name), {
                "format_version": "1.21.40",
                "minecraft:biome": {
                    "description": {"identifier": b["biomeId"]},
                    "components": {
                        # Sem chuva e sem neve: nenhum dos dois tem água no ar.
                        "minecraft:climate": {
                            "temperature": 0.5,
                            "downfall": 0.0,
                            "snow_accumulation": [0.0, 0.0],
                        },
                        "minecraft:tags": {"tags": TAGS[p["id"]] + [b["id"]]},
                    },
                },
            })
            write(os.path.join(RP, "biomes", "%s.client_biome.json" % name), {
                "format_version": "1.21.40",
                "minecraft:client_biome": {
                    "description": {"identifier": b["biomeId"]},
                    "components": {
                        "minecraft:fog_appearance": {
                            "fog_identifier": b["fog"] or p["fog"],
                        },
                        "minecraft:sky_color": {"sky_color": p["sky"]},
                    },
                },
            })
            written += 2

    for lang, key in (("pt_BR", "pt"), ("en_US", "en"), ("en_GB", "en")):
        lines = []
        for p in planets:
            for b in p["biomes"]:
                short = b["biomeId"].split(":")[1]
                label = strip_colors(b["name"]) if key == "pt" else EN[b["id"]]
                lines.append("biome.gh.%s.name=%s" % (short, label))
        # Só no RP: nome de bioma no behavior pack o jogo ignora, e o
        # validador reclama (com razão — vira nome faltando no jogo).
        path = os.path.join(RP, "texts", "%s.lang" % lang)
        if os.path.isfile(path):
            replace_section(path, MARK, lines)

    print("%d arquivo(s) de mundo gerados (y %d..%d, saida a %d):"
          % (written, bounds["min"], bounds["max"], exit_y))
    for p in planets:
        print("  %-5s %s  %d bioma(s): %s"
              % (p["id"], p["dimensionId"], len(p["biomes"]),
                 ", ".join(b["id"] for b in p["biomes"])))


if __name__ == "__main__":
    main()
