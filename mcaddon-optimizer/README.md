# Otimizador de addons Minecraft Bedrock

Deixa um `.mcaddon` / `.mcpack` o mais leve possível **sem apagar nenhum
arquivo**. No modo padrão nada é perdido: nenhum pixel muda, nenhum JSON muda,
nenhum arquivo some. O que encolhe é só a forma como os dados estão
armazenados.

## Instalação

```bash
pip install Pillow zopfli
# opcionais, só para os modos com perda:
#   pngquant  -> quantização de PNG
#   ffmpeg    -> reencode de áudio .ogg
```

## Uso

```bash
# modo padrão: 100% sem perda
python3 optimize_mcaddon.py MeuAddon.mcaddon

# com relatório e mais paralelismo
python3 optimize_mcaddon.py MeuAddon.mcaddon -o Leve.mcaddon \
    --relatorio relatorio.md --jobs 8

# só analisar, sem gravar nada
python3 optimize_mcaddon.py MeuAddon.mcaddon --somente-analise --relatorio relatorio.md

# conferir que o resultado bate com o original (código independente)
python3 verificar.py MeuAddon.mcaddon Leve.mcaddon
```

## O que ele faz (sem perda)

| Técnica | Ganho típico |
|---|---|
| **PNG → paleta indexada** na menor profundidade de bits (1/2/4/8 bpp) quando a textura tem ≤ 256 cores — o caso da quase totalidade da arte de Minecraft | 40–70% por textura |
| **Recompressão do IDAT com zopfli** (deflate muito mais forte que o zlib padrão) | 5–15% a mais |
| **Remoção de chunks auxiliares** do PNG (`tEXt`, `iCCP`, `pHYs`, `eXIf`…), que o jogo nunca lê | alguns KB por arquivo |
| **Minificação de JSON** — espaços, quebras de linha, comentários e vírgulas sobrando | 60–80% do texto |
| **Reempacotamento com zopfli**, e arquivos já comprimidos (`.png`, `.ogg`) gravados como `STORED` em vez de recomprimidos à toa | 3–8% do container |

A minificação de JSON é **textual**, não um `json.load` + `json.dump`. Isso
preserva ordem das chaves, chaves duplicadas, precisão dos números e escapes
exatamente como estavam. Reserializar via objeto Python mudaria `1.0` para
`1`, colapsaria chaves repetidas e reordenaria coisas — o tipo de detalhe que
quebra addon.

## Garantias

Todo candidato passa por uma trava antes de ser aceito:

- **PNG**: a imagem resultante é redecodificada e comparada **pixel a pixel em
  RGBA** com a original. Diferiu, o candidato é descartado e o arquivo original
  é mantido.
- **JSON**: o resultado é parseado e comparado semanticamente com o original.
  Se não parsear, ou parsear diferente, o original é mantido.
- **Pacote**: depois de gravado, o `.mcaddon` é reaberto e **cada arquivo é
  comparado byte a byte** com o que deveria estar lá — incluindo os `.mcpack`
  aninhados. Qualquer divergência aborta com código de saída 2.
- Qualquer arquivo que gere exceção é **mantido intacto**, não descartado.
- `verificar.py` refaz a conferência com código independente, justamente para
  que um bug no otimizador não passe despercebido pela verificação do próprio
  otimizador.

## Modos com perda (opcionais, desligados por padrão)

Estes **alteram a arte ou o áudio**. Use só se o tamanho for mais importante
que a fidelidade:

```bash
--max-resolucao 64    # reduz texturas acima de 64px no lado menor
                      # (fator inteiro + NEAREST: mantém a pixel art alinhada)
--png-com-perda       # quantiza para 256 cores via pngquant
--qualidade-png 70-92 # faixa de qualidade do pngquant
--audio-com-perda     # reencoda .ogg
--audio-bitrate 64    # bitrate alvo em kbps
```

## Relatório

Além do tamanho, o relatório aponta o que pesa **em execução** — o que causa
queda de FPS, e que nenhuma compressão resolve:

- texturas muito acima da resolução útil (um bloco de 512×512 ocupa 1024× mais
  memória de GPU que o 16×16 padrão e é renderizado no mesmo espaço na tela);
- arquivos duplicados byte a byte;
- scripts com trabalho por tick (`system.runInterval(..., 1)`,
  `afterEvents.tick`);
- entidades com pilhas grandes de comportamento, `component_groups` e sensores;
- partículas com `spawn_rate` / `max_particles` altos.

Nada disso é alterado automaticamente — são decisões de design do addon, e
mexer nelas mudaria o comportamento do jogo. O relatório lista para você
decidir.

## Onde está o peso de verdade

Medido no Better on Bedrock (versão pública do repo do autor, 2910 arquivos,
`.mcaddon` de 30,2 MB):

| Tipo | Tamanho | Fatia |
|---|---:|---:|
| `.ogg` (áudio) | 23,0 MB | **76%** |
| `.png` | 4,0 MB | 13% |
| `.json` | 3,6 MB | 12% |
| `.mcstructure` | 3,8 MB | — |
| `.fsb` | 3,0 MB | — |

Isso inverte a intuição: num addon assim, **compressão sem perda quase não tem
o que fazer**, porque três quartos do arquivo já é Ogg Vorbis comprimido. O
resultado sem perda foi 30,2 → 29,0 MB (−4,2%). Todo o resto do peso está no
áudio, e só re-encodar mexe nele.

Detalhando o áudio (253 arquivos, 23,0 MB):

| Categoria | Arquivos | Tamanho | Com `--audio moderado` |
|---|---:|---:|---:|
| Música | 11 | 16,3 MB | 10,4 MB |
| Ambiente | 39 | 2,9 MB | 1,2 MB |
| Efeitos | 203 | 3,9 MB | 2,5 MB |
| **Total** | **253** | **23,0 MB** | **14,1 MB (−39%)** |

Onze arquivos de música são 54% do addon inteiro. E 36 dos 203 efeitos estão
em estéreo — peso morto, porque o Minecraft espacializa som posicional a
partir da posição da fonte, então o segundo canal de um som de mob é
descartado na prática. Por isso o perfil de áudio converte efeitos para mono
e deixa música e ambiente em estéreo.

## Resultado em um addon de teste

Pacote sintético de 6,9 MB (1230 arquivos, dois `.mcpack` aninhados,
275 texturas, 873 JSONs):

| Modo | Resultado |
|---|---|
| Sem perda (padrão) | 6,9 MB → **2,0 MB (−70,7%)** |
| Com `--max-resolucao 64 --png-com-perda` | 6,9 MB → **407 KB (−94,2%)** |

Os dois passaram na verificação independente. O número do modo com perda é
otimista: as texturas do teste são ruído aleatório, que quantiza
excepcionalmente bem. Em arte real, espere menos.

## Ordem de ataque recomendada

1. `--audio moderado` — quase sempre o maior ganho isolado, se o addon tiver
   música. Reduz música e ambiente para 96 kbps e efeitos para 64 kbps mono.
2. Modo padrão sem perda — de graça, sem risco.
3. `--max-resolucao 64` — só se o relatório apontar texturas fora do orçamento.
4. `--png-com-perda` — último recurso; é o que mais visivelmente altera a arte.

## Limitações

- Formatos proprietários (`.fsb`, texturas empacotadas) passam intactos.
- PNGs animados (APNG) são detectados e preservados sem alteração.
- O tempo roda em torno de 15s por MB de PNG com `--jobs 8`; zopfli é lento de
  propósito. `--sem-zopfli` acelera bastante e perde pouco.
