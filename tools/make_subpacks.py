#!/usr/bin/env python3
"""Os subpacotes de idioma: a engrenagem do pack, nas configurações do mundo.

O QUE ELES RESOLVEM. Nome de item, bloco e bioma vem dos .lang, e quem escolhe
o arquivo é o CLIENTE, pelo idioma do JOGO — script nenhum alcança isso. Então
quem joga com o Minecraft em inglês vê os nomes em inglês, queira ou não.

O subpacote é a saída que o próprio Bedrock oferece: o pack declara variantes,
o jogador escolhe uma na engrenagem ao lado do pack (configurações do mundo), e
os arquivos da variante entram POR CIMA dos do pack base.

Aqui cada variante escreve o MESMO texto em todos os cinco .lang. Ou seja: com
"Português" escolhido, o jogo procura o .lang do idioma dele e acha português
em qualquer um deles. É assim que um jogador com o jogo em inglês consegue ver
os nomes do addon em português.

O pack BASE fica sem subpacote nenhum: aí vale o comportamento normal do jogo,
cada um lê no idioma do próprio jogo. É o padrão e é o que a maioria quer.
"""
import json
import os
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RP = os.path.join(ROOT, "packs", "Galactic Horizons RP")

# (pasta, nome no seletor, idioma de origem)
#
# O inglês vem PRIMEIRO de propósito: é ele que o jogo deixa marcado pra quem
# nunca mexeu no seletor, e é o padrão do addon inteiro (ver IDIOMA_PADRAO).
VARIANTES = [
    ("en", "English", "en_US"),
    ("pt", "Português", "pt_BR"),
    ("es", "Español", "es_ES"),
]
# Os arquivos que cada variante sobrescreve.
DESTINOS = ["pt_BR", "en_US", "en_GB", "es_ES", "es_MX"]


def main():
    base = os.path.join(RP, "subpacks")
    if os.path.isdir(base):
        shutil.rmtree(base)

    for pasta, _, origem in VARIANTES:
        fonte = os.path.join(RP, "texts", f"{origem}.lang")
        destino = os.path.join(base, pasta, "texts")
        os.makedirs(destino, exist_ok=True)
        conteudo = open(fonte, encoding="utf-8").read()
        for lang in DESTINOS:
            with open(os.path.join(destino, f"{lang}.lang"), "w", encoding="utf-8") as f:
                f.write(conteudo)
        with open(os.path.join(destino, "languages.json"), "w", encoding="utf-8") as f:
            json.dump(DESTINOS, f)
            f.write("\n")

    # --- o manifesto declara as variantes ------------------------------------
    caminho = os.path.join(RP, "manifest.json")
    doc = json.load(open(caminho, encoding="utf-8"))
    doc["subpacks"] = [
        # memory_tier 0 nos três: eles não são níveis de qualidade, são idiomas.
        # Um tier alto faria o jogo escolher sozinho pelo tamanho da memória do
        # aparelho, que não tem nada a ver com a língua de quem está jogando.
        {"folder_name": pasta, "name": nome, "memory_tier": 0}
        for pasta, nome, _ in VARIANTES
    ]
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"{len(VARIANTES)} subpacotes de idioma: "
          + ", ".join(n for _, n, _ in VARIANTES))
    print(f"  cada um sobrescreve os {len(DESTINOS)} .lang com o texto de um idioma só")


if __name__ == "__main__":
    main()
