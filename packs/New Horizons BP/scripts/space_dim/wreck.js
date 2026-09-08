/* =========================================================================
 * Destroços de OVNI caídos no Overworld.
 *
 * É onde o molde de ferraria de estrela é encontrado — sem ele não há armadura,
 * e sem armadura não há como ficar dentro do Sol. Então este é o primeiro elo
 * da corrente, e ele fica no Overworld de propósito: dá pra começar a linha do
 * espaço sem ainda ter ido ao espaço.
 *
 * Por que construído por script e não uma .mcstructure: uma estrutura seria um
 * arquivo NBT binário, que não dá pra revisar nem ajustar sem um editor. Aqui o
 * disco é desenhado por geometria, o que também deixa cada queda um pouco
 * diferente (rotação, inclinação, quanto do casco sobrou).
 *
 * Cuidados pra isso não virar vandalismo no mundo de ninguém:
 *   - só em terreno aberto, longe do jogador, e nunca duas vezes no mesmo lugar
 *   - nunca substitui bloco construído: só ar, folhas, planta e a superfície
 *   - as coordenadas de cada queda ficam gravadas, então recarregar o mundo não
 *     gera outra em cima
 * ========================================================================= */

import * as mc from "@minecraft/server";
import {
  WRECK_ENABLED,
  WRECK_CHECK_INTERVAL,
  WRECK_CHANCE,
  WRECK_MIN_DISTANCE,
  WRECK_MAX_DISTANCE,
  WRECK_MIN_GAP,
  WRECK_HULL_BLOCK,
  WRECK_GLASS_BLOCK,
  WRECK_SCORCH_BLOCK,
  WRECK_LOOT,
  WRECK_TEMPLATE_ITEM,
} from "./config.js";

const world = mc.world;
const system = mc.system;

const SITES_PROP = "space_dim:wreck_sites";

// Blocos que a queda pode enterrar. Qualquer outra coisa é construção de
// alguém, ou minério, e fica onde está.
const REPLACEABLE = new Set([
  "minecraft:air",
  "minecraft:grass_block",
  "minecraft:dirt",
  "minecraft:coarse_dirt",
  "minecraft:podzol",
  "minecraft:sand",
  "minecraft:red_sand",
  "minecraft:gravel",
  "minecraft:snow",
  "minecraft:snow_layer",
  "minecraft:stone",
  "minecraft:short_grass",
  "minecraft:tall_grass",
  "minecraft:fern",
  "minecraft:large_fern",
  "minecraft:dead_bush",
  "minecraft:oak_leaves",
  "minecraft:birch_leaves",
  "minecraft:spruce_leaves",
  "minecraft:jungle_leaves",
  "minecraft:acacia_leaves",
  "minecraft:dark_oak_leaves",
  "minecraft:water",
  "minecraft:flowing_water",
]);

// ---------------------------------------------------------------------------
// Registro das quedas já feitas
// ---------------------------------------------------------------------------
function loadSites() {
  try {
    const raw = world.getDynamicProperty(SITES_PROP);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSite(x, z) {
  try {
    const sites = loadSites();
    sites.push([Math.round(x), Math.round(z)]);
    // Guarda só as últimas: a property tem limite de tamanho, e o que importa
    // é não gerar duas quedas coladas.
    while (sites.length > 64) sites.shift();
    world.setDynamicProperty(SITES_PROP, JSON.stringify(sites));
  } catch { }
}

function tooCloseToOtherSite(x, z) {
  for (const [sx, sz] of loadSites()) {
    if (Math.hypot(x - sx, z - sz) < WRECK_MIN_GAP) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Achar chão
// ---------------------------------------------------------------------------
function surfaceAt(dimension, x, z) {
  try {
    const top = dimension.getTopmostBlock({ x, z });
    if (!top) return null;
    // O bloco mais alto precisa ser chão natural. Se for tábua, pedra
    // trabalhada, tronco — é construção de alguém ou uma árvore, e a queda não
    // acontece ali. É a primeira barreira contra cair no meio de uma casa.
    if (!REPLACEABLE.has(top.typeId)) return null;
    if (top.typeId.includes("water")) return null;
    return top.y;
  } catch {
    return null;
  }
}

/** O terreno é plano o bastante pra o disco não ficar boiando? */
function terrainIsOpen(dimension, cx, cz, radius) {
  const centre = surfaceAt(dimension, cx, cz);
  if (centre === null) return null;

  let lo = centre;
  let hi = centre;
  for (const [dx, dz] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius],
                          [radius, radius], [-radius, -radius]]) {
    const y = surfaceAt(dimension, cx + dx, cz + dz);
    if (y === null) return null;
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  // Mais que isso é encosta de morro: o disco ficaria metade no ar.
  if (hi - lo > 5) return null;
  return centre;
}

// ---------------------------------------------------------------------------
// Construção
// ---------------------------------------------------------------------------
function place(dimension, x, y, z, blockId) {
  try {
    const block = dimension.getBlock({ x, y, z });
    if (!block) return false;
    if (!REPLACEABLE.has(block.typeId)) return false;
    dimension.setBlockType({ x, y, z }, blockId);
    return true;
  } catch {
    return false;
  }
}

/** Cava a cratera do impacto e chamusca o chão em volta. */
function digCrater(dimension, cx, cy, cz, radius) {
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const d = Math.hypot(dx, dz);
      if (d > radius) continue;
      const depth = Math.round((1 - d / radius) * 2.5);
      for (let dy = 0; dy <= depth; dy++) {
        try {
          const b = dimension.getBlock({ x: cx + dx, y: cy - dy, z: cz + dz });
          if (b && REPLACEABLE.has(b.typeId)) {
            dimension.setBlockType(
              { x: cx + dx, y: cy - dy, z: cz + dz },
              dy === depth ? WRECK_SCORCH_BLOCK : "minecraft:air"
            );
          }
        } catch { }
      }
    }
  }
}

/**
 * O disco. Duas calotas achatadas (um disco voador é uma esfera esmagada no
 * eixo Y), com uma cúpula de vidro em cima e um pedaço faltando — ele caiu.
 */
function buildSaucer(dimension, cx, cy, cz, radius, rng) {
  const flatten = 3.2;                     // quanto o disco é achatado
  const missing = rng() * Math.PI * 2;     // direção do rombo
  const missingWidth = 0.7 + rng() * 0.6;
  let placed = 0;

  const height = Math.ceil(radius / flatten) + 2;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const dh = Math.hypot(dx, dz);
      if (dh > radius) continue;

      // O rombo: um setor inteiro do disco não existe mais.
      const angle = Math.atan2(dz, dx);
      let diff = Math.abs(angle - missing);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff < missingWidth && dh > radius * 0.35) continue;

      // Casca do elipsoide: |r|=1 na superfície.
      for (let dy = -height; dy <= height; dy++) {
        const r = Math.sqrt((dh / radius) ** 2 + ((dy * flatten) / radius) ** 2);
        if (r > 1 || r < 0.72) continue;

        const y = cy + dy + 1;
        // Cúpula de vidro no topo do miolo, casco no resto.
        const isDome = dy > 0 && dh < radius * 0.38;
        if (place(dimension, cx + dx, y, cz + dz, isDome ? WRECK_GLASS_BLOCK : WRECK_HULL_BLOCK)) {
          placed++;
        }
      }
    }
  }
  return placed;
}

/** O baú com o molde, escondido no miolo do disco. */
function placeChest(dimension, cx, cy, cz) {
  // O baú passa pela mesma guarda que o resto: se o ponto do meio tiver algo
  // que não é nosso, tenta os vizinhos antes de desistir. Sem isso ele era o
  // único bloco capaz de apagar construção de jogador.
  const candidates = [
    { x: cx, y: cy + 1, z: cz },
    { x: cx + 1, y: cy + 1, z: cz },
    { x: cx - 1, y: cy + 1, z: cz },
    { x: cx, y: cy + 1, z: cz + 1 },
    { x: cx, y: cy + 1, z: cz - 1 },
  ];

  let loc = null;
  for (const c of candidates) {
    try {
      const b = dimension.getBlock(c);
      if (b && REPLACEABLE.has(b.typeId)) { loc = c; break; }
    } catch { }
  }
  if (!loc) return false;

  try {
    dimension.setBlockType(loc, "minecraft:chest");
    const block = dimension.getBlock(loc);
    const container = block?.getComponent("minecraft:inventory")?.container;
    if (!container) return false;

    // O molde é o motivo de a estrutura existir: entra sempre, no primeiro
    // espaço, e nunca fica de fora por sorteio.
    container.setItem(0, new mc.ItemStack(WRECK_TEMPLATE_ITEM, 1));

    let slot = 2;
    for (const entry of WRECK_LOOT) {
      if (Math.random() > entry.chance) continue;
      const count = entry.min + Math.floor(Math.random() * (entry.max - entry.min + 1));
      try {
        container.setItem(slot, new mc.ItemStack(entry.item, count));
        slot += 1 + Math.floor(Math.random() * 3);
      } catch { }
      if (slot >= container.size) break;
    }
    return true;
  } catch (e) {
    console.warn("[space_dim] baú dos destroços: " + e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Queda
// ---------------------------------------------------------------------------

/** Constrói uma queda em (cx, cz), se o terreno servir. Devolve true se saiu. */
export function buildWreckAt(dimension, cx, cz, rng = Math.random) {
  const radius = 5 + Math.floor(rng() * 3);   // 5 a 7 blocos
  const ground = terrainIsOpen(dimension, cx, cz, radius);
  if (ground === null) return false;

  digCrater(dimension, cx, ground, cz, radius + 2);
  const placed = buildSaucer(dimension, cx, ground, cz, radius, rng);
  // Terreno ocupado demais pra valer a pena: desiste em vez de deixar um
  // esqueleto de meia dúzia de blocos.
  if (placed < 20) return false;

  placeChest(dimension, cx, ground, cz);
  saveSite(cx, cz);
  return true;
}

/**
 * Chamado periodicamente pra cada jogador do Overworld. Quase sempre não faz
 * nada: é uma queda rara, não um evento.
 */
export function maybeDropWreck(player) {
  if (!WRECK_ENABLED) return false;
  if (system.currentTick % WRECK_CHECK_INTERVAL !== 0) return false;
  if (Math.random() > WRECK_CHANCE) return false;

  const dimension = player.dimension;
  if (dimension.id !== "minecraft:overworld") return false;

  // Longe o bastante pra o jogador não ver blocos aparecendo do nada, perto o
  // bastante pra a chunk estar carregada.
  const angle = Math.random() * Math.PI * 2;
  const dist = WRECK_MIN_DISTANCE + Math.random() * (WRECK_MAX_DISTANCE - WRECK_MIN_DISTANCE);
  const cx = Math.round(player.location.x + Math.cos(angle) * dist);
  const cz = Math.round(player.location.z + Math.sin(angle) * dist);

  if (tooCloseToOtherSite(cx, cz)) return false;

  if (buildWreckAt(dimension, cx, cz)) {
    try {
      player.playSound("ambient.weather.thunder", { volume: 0.35, pitch: 1.4 });
    } catch { }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Comandos de apoio
// ---------------------------------------------------------------------------
system.afterEvents.scriptEventReceive.subscribe((data) => {
  if (data.id !== "space_dim:wreck") return;
  const player = data.sourceEntity;
  if (player?.typeId !== "minecraft:player") return;

  // /scriptevent space_dim:wreck — força uma queda perto, pra testar.
  const angle = Math.random() * Math.PI * 2;
  const cx = Math.round(player.location.x + Math.cos(angle) * 24);
  const cz = Math.round(player.location.z + Math.sin(angle) * 24);
  const ok = buildWreckAt(player.dimension, cx, cz);
  try {
    player.sendMessage(
      ok
        ? `§7Destroços em §f${cx}, ${cz}§7.`
        : "§cTerreno acidentado demais aqui — tente num lugar mais aberto."
    );
  } catch { }
});
