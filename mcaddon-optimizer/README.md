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

## Limitações

- Formatos proprietários (`.fsb`, texturas empacotadas) passam intactos.
- PNGs animados (APNG) são detectados e preservados sem alteração.
- O tempo roda em torno de 15s por MB de PNG com `--jobs 8`; zopfli é lento de
  propósito. `--sem-zopfli` acelera bastante e perde pouco.
