#!/usr/bin/env python3
"""Gera as definições dos blocos dos corpos celestes.

Um bloco custom no Bedrock precisa de quatro coisas espalhadas em dois packs:
o JSON de comportamento (BP/blocks), a entrada em blocks.json (RP), a entrada
em terrain_texture.json (RP) e o nome em texts/*.lang. Escrever isso à mão pra
14 blocos é convite a um deles ficar pra trás e o bloco virar cubo roxo.

Aqui a fonte é a tabela BLOCKS abaixo e os quatro arquivos saem dela.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from langfile import replace_section  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "Galactic Horizons BP")
RP = os.path.join(ROOT, "packs", "Galactic Horizons RP")

FORMAT_VERSION = "1.21.80"

# Um registro por bloco. `solid=False` tira a colisão: o jogador atravessa.
#
# O Sol é atravessável — coroa e plasma são casca sem colisão, e por dentro
# delas há vácuo até a camada seguinte. Só o núcleo é sólido, pra quem
# conseguir chegar lá ter onde pousar. Os três emitem luz 15: no vácuo preto,
# sem isso o Sol seria uma silhueta.
#
# `light_dampening=0` nos blocos do Sol deixa a luz atravessar as cascas, senão
# o miolo dele ficaria escuro apesar de tudo em volta brilhar.
#
# Os blocos dos PLANETAS emitem luz baixa (BODY_LIGHT). Não é pra eles serem
# lâmpadas: é que a dimensão do espaço não tem luz de céu nenhuma, então sem
# isso a superfície de um planeta é preta e não se enxerga nada em cima dele.
# Com emissão baixa o corpo aparece iluminado — que é o que se espera de um
# corpo recebendo luz do Sol. O preço, assumido: o lado de trás também aparece
# iluminado, porque luz de bloco não tem direção.
BODY_LIGHT = 6

# O CHÃO da Lua e de Marte é a exceção, e agora emite ZERO.
#
# Eles nasceram pra serem vistos de longe, na dimensão do espaço, onde não há
# luz de céu — daí a emissão 6. Mas agora eles são o terreno de duas dimensões
# de verdade, que têm céu e têm dia e noite. Chão que brilha sozinho lá tira as
# duas coisas que fazem a Lua parecer a Lua: a sombra dura das crateras e o
# breu da noite lunar. E some com o escuro das cavernas de Marte junto.
#
# Nenhum deles é mais colocado na dimensão do espaço (`built: false` no
# config.js dos dois), então a emissão antiga não estava mais servindo pra nada.
GROUND_LIGHT = 0

# Os blocos em que o jogador PISA — o terreno da Lua e de Marte. Eles são a
# exceção em duas coisas: não emitem luz, e não recebem oclusão de ambiente.
GROUND_BLOCKS = {
    "moon_regolith_light", "moon_regolith", "moon_regolith_dark",
    "mars_dust", "mars_rock", "mars_rock_dark", "mars_ice",
    # Os minérios entram aqui também: eles ficam encostados na pedra do
    # planeta, e ter oclusão num e não no outro deixaria a junta entre os dois
    # marcada.
    "moon_iron_ore", "moon_gold_ore", "moon_redstone_ore", "moon_diamond_ore",
    "mars_iron_ore", "mars_copper_ore", "mars_gold_ore", "mars_diamond_ore",
}

def block(texture, map_color, pt, en, light=BODY_LIGHT, hardness=1.2, solid=True, dampening=None):
    return {
        "texture": texture,
        "map_color": map_color,
        "light": light,
        "hardness": hardness,
        "solid": solid,
        "dampening": dampening,
        "pt": pt,
        "en": en,
        # Minério: o que ele larga. None = larga ele mesmo.
        "loot": None,
    }


BLOCKS = {
    # --- Sol: atravessável, luminoso ----------------------------------------
    "sun_corona": block("sun_corona", "#F05914", "Coroa Solar", "Solar Corona",
                        light=15, hardness=2.0, solid=False, dampening=0),
    "sun_plasma": block("sun_plasma", "#FFDF64", "Plasma Solar", "Solar Plasma",
                        light=15, hardness=2.0, solid=False, dampening=0),
    "sun_core":   block("sun_core", "#FFFDF1", "Núcleo Solar", "Solar Core",
                        light=15, hardness=4.0, solid=True, dampening=0),
    # O branco da SUPERFÍCIE, separado do branco do NÚCLEO.
    #
    # Os dois têm a mesma cor e papéis opostos: `sun_core` é o chão maciço lá no
    # meio do Sol, e este aqui é o miolo claro da casca externa, que tem que ser
    # atravessável. Pintar a superfície com `sun_core` fechou a primeira camada
    # do Sol — dava pra encostar, não pra entrar.
    "sun_blaze":  block("sun_blaze", "#FFFDF1", "Clarão Solar", "Solar Blaze",
                        light=15, hardness=2.0, solid=False, dampening=0),
    # Os tons intermediários existem por um motivo só: dar ao disco do Sol o
    # degradê da referência. Com três blocos ele saía em faixas duras; com seis,
    # a passagem do branco ao vermelho se lê como um degradê.
    "sun_flare":  block("sun_flare", "#FEEC9A", "Fulgor Solar", "Solar Flare",
                        light=15, hardness=2.0, solid=False, dampening=0),
    "sun_ember":  block("sun_ember", "#FFA123", "Brasa Solar", "Solar Ember",
                        light=15, hardness=2.0, solid=False, dampening=0),
    "sun_edge":   block("sun_edge", "#AA300B", "Borda Solar", "Solar Edge",
                        light=15, hardness=2.0, solid=False, dampening=0),

    # --- Terra ---------------------------------------------------------------
    "earth_ocean":   block("earth_ocean", "#063E93", "Oceano Profundo", "Deep Ocean"),
    "earth_shallow": block("earth_shallow", "#056C91", "Água Rasa", "Shallow Water"),
    "earth_land":    block("earth_land", "#038500", "Continente", "Continent", hardness=1.0),
    "earth_forest":  block("earth_forest", "#026002", "Floresta", "Forest", hardness=1.0),
    "earth_ice":     block("earth_ice", "#E8EFFA", "Calota Polar", "Polar Ice Cap", hardness=1.0),

    # --- Lua: os tons são BLOCOS separados, não buraco desenhado na textura ---
    # A cor de mapa é a média da textura que ele desenhou.
    #
    # As três tonalidades são CAMADAS, não variações: a mais clara é a poeira da
    # superfície, a do meio é a pedra, a mais escura é a ardósia lá no fundo —
    # a mesma ordem de grama/terra/pedra/deepslate. A luminância média das
    # texturas confere: 216, 161 e 94.
    "moon_regolith_light": block("moon_regolith_light", "#AFB7CA",
                                 "Poeira de Regolito", "Regolith Dust",
                                 light=GROUND_LIGHT, hardness=1.0),
    "moon_regolith":       block("moon_regolith", "#808694",
                                 "Pedra de Regolito", "Regolith Stone",
                                 light=GROUND_LIGHT, hardness=1.4),
    "moon_regolith_dark":  block("moon_regolith_dark", "#494D55",
                                 "Ardósia de Regolito", "Regolith Slate",
                                 light=GROUND_LIGHT, hardness=1.8),

    # --- Marte ---------------------------------------------------------------
    # Mesma regra da Lua, e o mesmo nome de camada: poeira, pedra, ardósia — só
    # que de ferrita, que é o óxido de ferro que dá a Marte a cor dele.
    # Luminância medida: 100, 78 e 40.
    "mars_dust":      block("mars_dust", "#BA4E2A", "Poeira de Ferrita", "Ferrite Dust",
                            light=GROUND_LIGHT, hardness=1.0),
    "mars_rock":      block("mars_rock", "#923D22", "Pedra de Ferrita", "Ferrite Stone",
                            light=GROUND_LIGHT, hardness=1.4),
    "mars_rock_dark": block("mars_rock_dark", "#501E10", "Ardósia de Ferrita", "Ferrite Slate",
                            light=GROUND_LIGHT, hardness=1.8),
    "mars_ice":       block("mars_ice", "#E2D7CF", "Gelo Marciano", "Martian Ice",
                            light=GROUND_LIGHT, hardness=1.0),
}

# --- Minérios ----------------------------------------------------------------
#
# A tabela é tools/assets/ores.json, compartilhada com o gerador de texturas:
# lá está a aparência de cada minério e o que ele larga; aqui saem o JSON do
# bloco, a tabela de loot e o nome. Onde cada um aparece (profundidade, peso,
# raridade) está em planets.js, junto do resto da geração.
#
# Cada minério existe em DUAS pedras — a do meio da crosta e a ardósia funda —
# como no jogo base. Quem escolhe a variante é o gerador, pelo bloco que está
# substituindo.
#
# Os minérios do jogo base largam o item CRU dele, e isso não é preguiça: é o
# que os torna úteis no minuto em que são minerados, sem uma árvore de receitas
# nova pra decorar. Os TRÊS NOVOS (silício, titânio, hélio-3) largam item
# próprio, porque não existe equivalente no jogo.
with open(os.path.join(ROOT, "tools", "assets", "ores.json"), encoding="utf-8") as _f:
    ORES_SPEC = json.load(_f)

# A cor de mapa de um minério é a da pedra que ele substitui: de longe, no mapa,
# um veio não muda a cor do terreno.
MAP_COLOR = {
    "moon_regolith": "#8A8E9C", "moon_regolith_dark": "#4F4B52",
    "mars_rock": "#95432A", "mars_rock_dark": "#50281A",
}

ORES = []
for _planeta, _host in ORES_SPEC["hosts"].items():
    for _tipo in _host["ores"]:
        _spec = ORES_SPEC["types"][_tipo]
        for _suf, _pedra, _pt_pedra, _en_pedra in (
            ("", _host["stone"], "", ""),
            ("_deep", _host["deep"], " em Ardósia", "Deepslate "),
        ):
            _short = f"{_planeta}_{_tipo}_ore{_suf}"
            ORES.append((
                _short, MAP_COLOR[_pedra],
                f"Minério de {_spec['pt']}{_pt_pedra} {_host['pt']}",
                f"{_en_pedra}{_host['en']} {_spec['en']} Ore",
                _spec["drop"], _spec["min"], _spec["max"],
            ))

for _short, _cor, _pt, _en, _item, _min, _max in ORES:
    # A ardósia é mais dura, como no jogo base.
    BLOCKS[_short] = block(_short, _cor, _pt, _en,
                           light=GROUND_LIGHT,
                           hardness=4.5 if _short.endswith("_deep") else 3.0)
    BLOCKS[_short]["loot"] = {"item": _item, "min": _min, "max": _max}

NS = "space_dim"


def texture_key(short):
    return f"{NS}_{short}"


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def main():
    # --- 1. BP: um JSON por bloco --------------------------------------------
    block_dir = os.path.join(BP, "blocks")
    for short, spec in BLOCKS.items():
        components = {
            "minecraft:geometry": "minecraft:geometry.full_block",
            "minecraft:material_instances": {
                "*": {
                    "texture": texture_key(short),
                    "render_method": "opaque",
                    # A oclusão de ambiente é o que escurece as JUNTAS entre
                    # blocos. Num chão de um bloco só, ela é o que denuncia cada
                    # bloco: uma sombrinha em cada quina, e a planície inteira
                    # vira um quadriculado — foi exatamente a reclamação dele.
                    #
                    # Ela fica LIGADA nos blocos dos corpos celestes, que são
                    # vistos de longe e onde ela dá volume. E DESLIGADA no chão
                    # da Lua e de Marte, que é onde se anda.
                    #
                    # `face_dimming` continua nos dois: é ela que deixa o topo
                    # mais claro que a lateral, e sem isso o relevo some.
                    "ambient_occlusion": short not in GROUND_BLOCKS,
                    "face_dimming": True,
                }
            },
            "minecraft:destructible_by_mining": {"seconds_to_destroy": spec["hardness"]},
            "minecraft:destructible_by_explosion": {"explosion_resistance": 15},
            "minecraft:map_color": spec["map_color"],
        }
        # SEM `minecraft:friction`.
        #
        # Estava em 0.6 em todos os blocos. Tirar não quer dizer "sem atrito":
        # quer dizer devolver o valor pro padrão do motor, que é o que ele mediu
        # como andar mais rápido. Foi ele quem testou em jogo, e é o tipo de
        # coisa que só se mede andando.
        if spec["light"]:
            components["minecraft:light_emission"] = spec["light"]
        if spec["dampening"] is not None:
            components["minecraft:light_dampening"] = spec["dampening"]
        if spec.get("loot"):
            components["minecraft:loot"] = f"loot_tables/{NS}/blocks/{short}.json"
        if not spec["solid"]:
            # Sem caixa de colisão o jogador atravessa. A caixa de SELEÇÃO fica,
            # senão o bloco não dá pra mirar nem quebrar.
            components["minecraft:collision_box"] = False

        write_json(
            os.path.join(block_dir, f"{short}.json"),
            {
                "format_version": FORMAT_VERSION,
                "minecraft:block": {
                    "description": {
                        "identifier": f"{NS}:{short}",
                        "menu_category": {"category": "nature"},
                    },
                    "components": components,
                },
            },
        )

    # --- 1b. BP: as tabelas de loot dos minérios ------------------------------
    loot_dir = os.path.join(BP, "loot_tables", NS, "blocks")
    for short, spec in BLOCKS.items():
        loot = spec.get("loot")
        if not loot:
            continue
        write_json(os.path.join(loot_dir, f"{short}.json"), {
            "pools": [{
                "rolls": 1,
                "entries": [{
                    "type": "item",
                    "name": loot["item"],
                    "weight": 1,
                    "functions": [{
                        "function": "set_count",
                        "count": {"min": loot["min"], "max": loot["max"]},
                    }],
                }],
            }],
        })

    # --- 2. RP: blocks.json ---------------------------------------------------
    blocks_json = {"format_version": [1, 1, 0]}
    for short in BLOCKS:
        blocks_json[f"{NS}:{short}"] = {
            "textures": texture_key(short),
            "sound": "stone",
        }
    write_json(os.path.join(RP, "blocks.json"), blocks_json)

    # --- 3. RP: terrain_texture.json -----------------------------------------
    write_json(
        os.path.join(RP, "textures", "terrain_texture.json"),
        {
            "resource_pack_name": NS,
            "texture_name": "atlas.terrain",
            "padding": 8,
            "num_mip_levels": 4,
            "texture_data": {
                texture_key(short): {
                    "textures": f"textures/{NS}/blocks/{BLOCKS[short]['texture']}"
                }
                for short in BLOCKS
            },
        },
    )

    # --- 4. Nomes nos .lang ---------------------------------------------------
    # Reescreve só o bloco marcado, pra não perder as linhas escritas à mão.
    MARK = "## blocos dos corpos celestes (gerado por tools/make_blocks.py)"
    for lang, key in (("pt_BR", "pt"), ("en_US", "en"), ("en_GB", "en")):
        replace_section(
            os.path.join(RP, "texts", f"{lang}.lang"), MARK,
            [f"tile.{NS}:{short}.name={spec[key]}" for short, spec in BLOCKS.items()],
        )

    print(f"{len(BLOCKS)} blocos gerados:")
    print(f"  BP/blocks/*.json")
    print(f"  RP/blocks.json")
    print(f"  RP/textures/terrain_texture.json")
    print(f"  RP/texts/{{pt_BR,en_US,en_GB}}.lang")


if __name__ == "__main__":
    main()
