# Level 1 Spaceship — Add-On para Minecraft Bedrock

Nave pilotável (`nave:level_1_spaceship`) que usa a **programação de voo do UFO**
do Vehicles 3.0, aplicada ao modelo `Level 1 spaceship`.

O add-on é **independente**: não precisa do Vehicles 3.0 instalado.

## Conteúdo

```
Level 1 Spaceship BP/     comportamento (entidade, eventos, spawn, loot)
Level 1 Spaceship RP/     modelo, textura, animações, partícula e som
```

## Instalação

1. Abra o `Level 1 Spaceship.mcaddon` (Minecraft importa os dois pacotes).
2. Ative **os dois** pacotes no mundo (comportamento + recurso).
3. Pegue o ovo de spawn no criativo ou use `/summon nave:level_1_spaceship`.

## O que a nave faz (portado do UFO)

| Recurso | Como funciona |
|---|---|
| Voo | `minecraft:input_air_controlled` — W/S/A/D voam, pular sobe, agachar desce |
| Sem gravidade | `minecraft:physics` com `has_gravity: false`, plana parada no ar |
| 3 assentos | assento do piloto + carona + banco traseiro (o UFO só tinha 1) |
| Buzina | bater na nave enquanto estiver pilotando toca o som |
| Vida / reparo | 70 de vida; cura com **barra de ferro** (20 por barra) |
| Desmontar | **tesoura** na nave devolve o ovo de spawn |
| Queda com dano | abaixo de 10 de vida, cair rápido explode a nave |
| Imune a fogo/lava | `fire_immune` + `breathes_lava` |
| Hitbox reduzida | ao pilotar, a caixa de colisão vira 1×1 (passa em lugares apertados) |
| Spawn natural | só à noite, na superfície; some de dia se nenhum jogador estiver perto |
| Abdução | ao aparecer perto de vila, sobe 19 blocos e às vezes leva um gato ou golem preso |
| Captura | quando um jogador entra, a nave ganha a tag `nave_ship_captured` e nunca mais some |

## Animações (adaptadas do rig do UFO)

- **Idle/hover** — balanço senoidal da nave + anel `octagon` girando (e `octagon5` no sentido contrário).
- **Subir/descer** — inclina 7° e desloca a nave conforme `vertical_speed`.
- **Curva** — inclinação lateral até 8° conforme `yaw_speed`.
- **Trem de pouso** — as rodas (`Wheels`–`Wheels4`) recolhem quando sai do chão.
- **Morte** — encolhe para 0.1.
- **Spawn** — aparece escalando de 0 a 1.
- **Anel de partículas + som do motor** — enquanto voa, está pilotada, ou na cena de spawn.
- **Fumaça** — quando a vida está abaixo de 10 e a nave está em movimento.

Para isso o modelo ganhou três ossos-raiz vazios (`nave_root` → `nave_main` →
`nave_ship`), equivalentes aos `dalibustudios_vehicles` / `main` / `dalibu_ufo`
do UFO original. Nenhum cubo foi alterado.

## Diferenças em relação ao UFO original

- Sem o sistema de pintura por spray (a textura da nave é fixa), então também
  não há variantes de cor nem `minecraft:variant`.
- Itens do Vehicles 3.0 (kit de reparo, chave inglesa, ovo próprio) foram
  trocados por itens vanilla.
- Sem módulo de script (`@minecraft/server`), então não há a câmera de terceira
  pessoa customizada.
- Hitbox maior (3.8 × 2.8) porque o modelo é maior que o do UFO.

## Créditos

Modelo `Level 1 spaceship` e textura: do autor do add-on.
A lógica da entidade é derivada do UFO do **Vehicles 3.0 (DaliBu Studios)**;
o som do motor e a textura de partícula `shockwave` foram copiados desse pacote.
Uso pessoal — para redistribuir publicamente, peça autorização aos autores do
Vehicles 3.0 ou substitua esses dois arquivos por assets próprios.
