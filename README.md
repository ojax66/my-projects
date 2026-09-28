# Dragon-forge- Addon

## Operação Fênix (Fenix Capsule)

Add-on para **Minecraft Bedrock** (1.21.90+, Script API `@minecraft/server` 2.0.0) em que a cápsula de clonagem substitui a cama como ponto de renascimento.

### Instalação

```bash
python3 tools/build.py          # gera dist/OperacaoFenix.mcaddon e o plugin .whl
```

Abra o `.mcaddon` no Minecraft e ative os dois packs (comportamento + recursos) no mundo. Não precisa de experimentos.

### Receitas (bancada)

| Item | Receita |
| --- | --- |
| **Cápsula Fênix** | `vidro vidro vidro` / `vidro diamante vidro` / `bloco de ferro, bloco de redstone, bloco de ferro` |
| **Painel Fênix** | `ferro painel-de-vidro ferro` / `ferro redstone ferro` / `ferro ferro ferro` |

Use o item num bloco para montar a peça. O painel se conecta à cápsula mais próxima (até 10 blocos). Interagir com o painel **ou** com a própria cápsula abre a UI.

### Como funciona

- **Cama**: continua passando a noite, mas **não define mais o renascimento**. O spawn anterior é restaurado logo depois que você deita.
- **Vincular meu clone**: a cápsula passa a gerar um clone seu (5 min). Com o clone vinculado, quando você morre acorda na cápsula. Se o clone ainda não estava pronto, você acorda nele mesmo assim, mas com fraqueza, lentidão e fome por 60 s.
- **Corpo**: ao morrer, seu corpo fica deitado no chão com **todos os seus itens** (inventário + armadura + mão secundária). Só o dono consegue pegar os itens de volta interagindo com o corpo. O corpo não recebe dano nem some.
- **Cápsula quebrada ou desativada**: se sua Operação Fênix for destruída, desvinculada por você ou **desativada por outro jogador** pelo painel dela, na próxima morte você acorda no **clone pronto mais próximo de outro jogador** (esse clone é consumido e o dono é avisado).
  - Nesse clone alheio você **não pode pegar os itens** dos seus corpos.
  - Para voltar: monte uma nova Operação Fênix → **Vincular meu clone** → **Reviver corpo original** (3 min) → **Entrar no corpo original**. Aí os seus corpos podem ser saqueados de novo.
  - Se não houver nenhum clone pronto na rede, você nasce no spawn do mundo, ainda sem o corpo original.
- **Rede de clones**: lista todas as cápsulas ativas, com status e distância.
- **Avisar quando usarem meu clone**: liga/desliga o aviso. O ⚠ mostra quantas vezes usaram seu clone. Clicar nele abre o histórico.
- **Integridade**: vida da cápsula (60). Só ataques e explosões causam dano. Se você mesmo quebrar sua cápsula ou painel, o item volta para você. O dono é avisado quando alguém ataca a cápsula.

Tempos e raios ficam em `packs/OperacaoFenix_BP/scripts/config.js`.

### Skins (corpo e clone na cápsula)

O Bedrock **não deixa add-ons lerem a skin dos jogadores**, mas o servidor recebe essa skin quando o jogador entra. Por isso há dois jeitos:

#### Servidor dedicado com Endstone (automático)

O plugin `server_plugin/` captura a skin real de cada jogador ao entrar (e quando ele troca de skin) e a grava no resource pack da Operação Fênix.

1. Instale o [Endstone](https://endstone.dev) no servidor dedicado (Bedrock Dedicated Server, Linux ou Windows).
2. Instale os dois packs no mundo.
3. Copie `dist/endstone_operacao_fenix-1.0.0-py3-none-any.whl` para a pasta `plugins/` do servidor.
4. Inicie o servidor. Cada jogador que entrar tem a skin registrada automaticamente.

Uma skin nova ou trocada aparece **depois do próximo reinício do servidor**. É quando o servidor recarrega os packs e os jogadores baixam a versão nova. O plugin sobe a versão do resource pack sozinho e guarda as skins em `plugins/operacao_fenix/`, então atualizar o add-on não apaga nada.

Funciona com skins clássicas (64x64, 64x32 antigas e HD 128x128), largas ou slim (detectadas sozinhas). Skins do **criador de personagem** (persona) usam um modelo próprio que não cabe no corpo padrão; esses jogadores aparecem como Steve.

#### Sem servidor dedicado (manual)

1. Coloque a skin em `skins/<Gamertag>.png` (ou `skins/<Gamertag>.slim.png` para braços finos).
2. Rode `python3 tools/sync_skins.py`.
3. Gere o `.mcaddon` de novo.

Quem não tem skin registrada aparece com o Steve.

### Estrutura

```
packs/OperacaoFenix_BP/   comportamento: entidades, itens, receitas e scripts
  scripts/main.js           eventos (colocar, interagir, morrer, renascer, cama)
  scripts/fenix.js          cápsulas, vínculo, rede de clones, renascimento
  scripts/corpse.js         corpo com os itens
  scripts/ui.js             formulários
packs/OperacaoFenix_RP/   recursos: modelos, texturas, UI (ui/server_form.json)
server_plugin/            plugin Endstone que captura as skins reais
tools/                    build (.mcaddon + plugin) e registro manual de skins
skins/                    skins dos jogadores (entrada do tools/sync_skins.py)
```
