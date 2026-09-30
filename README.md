# Dragon-forge- Addon

## Operação Fênix (Fenix Capsule)

Add-on para **Minecraft Bedrock** (1.26+, Script API `@minecraft/server` 2.8.0) em que a cápsula de clonagem substitui a cama como ponto de renascimento.

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
  - Nesse clone alheio você **fica com a skin do dono do clone** (e se morrer, o corpo que cai também tem a skin dele).
  - Nesse clone alheio você **não pode pegar os itens** dos seus corpos.
  - Para voltar: monte uma nova Operação Fênix → **Vincular meu clone** → **Reviver corpo original** (3 min) → **Entrar no corpo original**. Aí os seus corpos podem ser saqueados de novo.
  - Se não houver nenhum clone pronto na rede, você vai para **Valhalla** (veja abaixo).
- **Rede de clones**: lista todas as cápsulas ativas, com status e distância.
- **Priorizar clones crescidos** (desligado por padrão): se você morrer e o seu clone ainda não tiver crescido, você acorda no clone crescido mais próximo de outro jogador em vez do seu. Serve contra armadilhas que matam o jogador sem parar em cima da cápsula. O seu clone continua crescendo.
- **Avisar quando usarem meu clone**: liga/desliga o aviso. O ⚠ mostra quantas vezes usaram seu clone. Clicar nele abre o histórico.
- **Integridade**: vida da cápsula (60). Só ataques e explosões causam dano. Se você mesmo quebrar sua cápsula ou painel, o item volta para você. O dono é avisado quando alguém ataca a cápsula.

- **Bússola de Corpos**: você ganha uma sempre que morre (se já não tiver). Segurando, a barra de ação mostra uma seta e a distância até o seu **corpo mais antigo**; quando ele acaba, passa para o próximo. Se o corpo está em outra dimensão, a seta fica girando e mostra o nome da dimensão. Corpo **sem itens some depois de 5 minutos** e sai da bússola.

### Valhalla

Quem já teve uma Operação Fênix, não tem mais nenhuma e não achou clone pronto na rede vai para **Valhalla**: uma dimensão de ilhas de campo e neve flutuando num céu dourado, gerada pela API de terreno do Galactic Horizons. Morrer em Valhalla leva de volta para Valhalla, e lá não dá para montar Operação Fênix.

Para sair, outro jogador precisa:
1. Fazer uma **Seringa** vazia (garrafa de vidro, pepita de ferro e barra de ferro, na diagonal) e usá-la num **corpo** do jogador. Ela vira uma **Amostra de Sangue** dessa pessoa.
2. Levar a amostra a **qualquer** painel ou cápsula da Operação Fênix e clicar com ela na mão. O DNA é isolado numa **Cápsula de DNA** e a seringa volta vazia.
3. Usar a Cápsula de DNA na **própria** Operação Fênix (clicando na cápsula ou no painel com ela na mão). A cápsula para de gerar o clone do dono e refaz o corpo original de quem está em Valhalla (4 min).
4. Quando fica pronto, a pessoa sai de Valhalla nessa cápsula, no corpo original, e a cápsula volta a gerar o clone do dono.

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

#### Aternos e outros servidores sem plugin (busca automática)

Os add-ons de cabeça de jogador fazem assim: baixam a skin pelo gamertag e colocam no pack. A ferramenta abaixo faz o mesmo para o corpo e o clone. Rode no seu computador (precisa de internet e Python 3):

1. Escreva os gamertags em `skins/players.txt`, um por linha. Use `java:Nome` para pegar a skin de uma conta do Minecraft Java.
2. Rode `python3 tools/fetch_skins.py`. Ele baixa as skins e gera `dist/OperacaoFenix.mcaddon` atualizado.
3. Envie os packs para o servidor (no Aternos: aba Arquivos → pasta `packs`) e reinicie.

De onde vem cada skin:
- **Gamertag do Bedrock** → API global da GeyserMC. Ela só conhece a skin de quem **já entrou em algum servidor com Geyser**. Quem nunca entrou aparece como Steve.
- **`java:Nome`** → conta do Minecraft Java com esse nome.
- **Manual** → `skins/<Gamertag>.png` (ou `.slim.png` para braços finos) sempre tem prioridade. Serve para quem não foi encontrado. Depois rode `python3 tools/sync_skins.py` e `python3 tools/build.py`.

Cada jogador mantém sempre o mesmo número de skin (`skins/index.json`), então adicionar gente nova não troca a skin dos corpos e cápsulas que já existem no mundo.

### Compatibilidade

Para trocar a skin de quem está no clone de outro jogador, o add-on sobrescreve os arquivos do jogador (`entities/player.json` e `entity/player.entity.json`), copiados do vanilla **1.26.50.4** ([bedrock-samples](https://github.com/Mojang/bedrock-samples)). Por isso:
- outro add-on que também mexa no jogador pode entrar em conflito (o que estiver por cima na lista de packs vence);
- quando o Minecraft atualizar o jogador, esses dois arquivos precisam ser copiados de novo da versão nova.

### Estrutura

```
packs/OperacaoFenix_BP/   comportamento: entidades, itens, receitas e scripts
  scripts/main.js           eventos (colocar, interagir, morrer, renascer, cama)
  scripts/fenix.js          cápsulas, vínculo, rede de clones, renascimento
  scripts/corpse.js         corpo com os itens
  scripts/ui.js             formulários
  scripts/valhalla.js       dimensão Valhalla (terreno pelo world_generator_API.js)
  scripts/compass.js        bússola de corpos e limpeza de corpos vazios
  scripts/dna.js            seringa, amostra de sangue e cápsula de DNA
packs/OperacaoFenix_RP/   recursos: modelos, texturas, UI (ui/server_form.json)
server_plugin/            plugin Endstone que captura as skins reais
tools/                    build (.mcaddon + plugin) e registro manual de skins
skins/                    players.txt, skins manuais e baixadas (auto/)
```
