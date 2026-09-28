import { EffectTypes, world } from "@minecraft/server";
import { CONFIG, IDS } from "./config.js";
import { Capsules, Players } from "./store.js";
import { applyDisguise, applySkin } from "./skin.js";

/** @typedef {import("./store.js").CapsuleRecord} CapsuleRecord */
/** @typedef {import("./store.js").PlayerRecord} PlayerRecord */
/** @typedef {import("@minecraft/server").Player} Player */

/** Progresso 0..1 do que a cápsula está gerando (clone ou corpo original). */
export function progress(c) {
  if (!c.active || c.start === null) return 0;
  return Math.min(1, (Date.now() - c.start) / c.duration);
}

export const isReady = (c) => progress(c) >= 1;

/** Está vinculada ao dono? */
export function isLinked(c) {
  return c.active && Players.get(c.owner)?.capsule === c.id;
}

export function findPlayer(id) {
  return world.getAllPlayers().find((p) => p.id === id);
}

export function notifyPlayer(id, message) {
  const player = findPlayer(id);
  if (!player) return;
  player.sendMessage(message);
  player.playSound("note.bass", { pitch: 0.6 });
}

/** Onde o jogador aparece ao sair da cápsula, olhando para fora dela. */
function capsuleExit(c) {
  const rad = (c.yaw * Math.PI) / 180;
  return {
    location: { x: c.x - Math.sin(rad) * 1.5, y: c.y + 0.1, z: c.z + Math.cos(rad) * 1.5 },
    rotation: { x: 0, y: c.yaw },
  };
}

function startGrowing(c, body) {
  c.body = body;
  c.start = Date.now();
  c.duration = (body === "clone" ? CONFIG.cloneGrowSeconds : CONFIG.reviveSeconds) * 1000;
  c.announced = false;
}

/** Atualiza as propriedades visuais da entidade (clone dentro do vidro, luzes). */
export function refreshCapsuleEntity(c) {
  const entity = world.getEntity(c.id);
  if (!entity?.isValid) return;
  const value = Math.round(progress(c) * 100) / 100;
  if (entity.getProperty("fenix:clone") !== value) entity.setProperty("fenix:clone", value);
  if (entity.getProperty("fenix:active") !== c.active) entity.setProperty("fenix:active", c.active);
  const health = entity.getComponent("minecraft:health");
  if (health) c.integrity = health.currentValue / health.effectiveMax;
}

export function registerCapsule(entity, player) {
  /** @type {CapsuleRecord} */
  const c = {
    id: entity.id,
    owner: player.id,
    ownerName: player.name,
    dim: entity.dimension.id,
    x: entity.location.x,
    y: entity.location.y,
    z: entity.location.z,
    yaw: entity.getRotation().y,
    active: false,
    body: "clone",
    start: null,
    duration: CONFIG.cloneGrowSeconds * 1000,
    integrity: 1,
  };
  applySkin(entity, player.name);
  Capsules.save(c);
  return c;
}

/** "Vincular meu clone": a cápsula passa a ser o ponto de renascimento do dono. */
export function linkCapsule(player, c) {
  const p = Players.of(player);
  if (c.owner !== player.id) return "§cSó o dono pode vincular esta cápsula.";
  if (isLinked(c)) return "§7Esta cápsula já está vinculada a você.";

  if (p.capsule && p.capsule !== c.id) {
    const old = Capsules.get(p.capsule);
    if (old) {
      old.active = false;
      old.start = null;
      Capsules.save(old);
      refreshCapsuleEntity(old);
    }
  }
  c.active = true;
  if (p.mode === "foreign") {
    // Num clone alheio: a cápsula nova serve para reviver o corpo original.
    c.body = "original";
    c.start = null;
  } else {
    startGrowing(c, "clone");
  }
  p.capsule = c.id;
  p.everLinked = true;
  Players.save(p);
  Capsules.save(c);
  refreshCapsuleEntity(c);
  return p.mode === "foreign"
    ? "§bCápsula vinculada. §7Use §fReviver corpo original§7 para trazer seu corpo de volta."
    : "§bClone vinculado. §7Ele fica pronto em alguns minutos.";
}

/** Desvincula/desativa a cápsula. `by` é quem desativou (pode ser outro jogador). */
export function deactivateCapsule(c, by) {
  c.active = false;
  c.start = null;
  Capsules.save(c);
  refreshCapsuleEntity(c);
  const owner = Players.get(c.owner);
  if (owner?.capsule === c.id) {
    owner.capsule = null;
    Players.save(owner);
  }
  if (by && by.id !== c.owner) {
    notifyPlayer(c.owner, `§c⚠ ${by.name} desativou sua Operação Fênix! §7Se você morrer, vai acordar no clone de outro jogador.`);
  }
}

export function onCapsuleDestroyed(id, killer) {
  const c = Capsules.get(id);
  if (!c) return;
  Capsules.remove(id);
  const owner = Players.get(c.owner);
  if (owner?.capsule === id) {
    owner.capsule = null;
    Players.save(owner);
  }
  if (killer?.id !== c.owner) {
    const who = killer?.typeId === "minecraft:player" ? killer.name : "algo";
    notifyPlayer(c.owner, `§c⚠ Sua Operação Fênix foi destruída por ${who}!`);
  }
}

export function startRevive(player, c) {
  const p = Players.of(player);
  if (p.mode !== "foreign") return "§7Você já está no seu corpo original.";
  if (!isLinked(c)) return "§cVincule esta cápsula primeiro.";
  if (c.body === "original" && c.start !== null) return "§7O corpo original já está sendo revivido.";
  startGrowing(c, "original");
  Capsules.save(c);
  refreshCapsuleEntity(c);
  return "§6Revivendo seu corpo original...";
}

/** Sai do clone alheio e volta para o corpo original revivido na cápsula. */
export function enterOriginal(player, c) {
  const p = Players.of(player);
  if (p.mode !== "foreign" || c.body !== "original" || !isReady(c)) return "§cSeu corpo original ainda não está pronto.";
  p.mode = "original";
  p.host = null;
  Players.save(p);
  applyDisguise(player, p);
  startGrowing(c, "clone");
  Capsules.save(c);
  refreshCapsuleEntity(c);
  wakeUpIn(player, c);
  player.sendMessage("§bVocê voltou ao seu corpo original. §7Seus corpos caídos podem ser saqueados de novo.");
  return undefined;
}

function wakeUpIn(player, c) {
  const exit = capsuleExit(c);
  player.teleport(exit.location, { dimension: world.getDimension(c.dim), rotation: exit.rotation });
  player.addEffect(EffectTypes.get("blindness"), 30, { showParticles: false });
  player.playSound("beacon.activate");
}

function distance(c, loc) {
  if (!loc) return 0;
  const penalty = c.dim === loc.dim ? 0 : 1e7;
  return Math.hypot(c.x - loc.x, c.y - loc.y, c.z - loc.z) + penalty;
}

/** Clones prontos de outros jogadores, do mais próximo ao mais distante. */
export function networkClones(forPlayerId, from) {
  return Capsules.all()
    .filter((c) => c.owner !== forPlayerId && c.active && c.body === "clone" && isReady(c) && isLinked(c))
    .sort((a, b) => distance(a, from) - distance(b, from));
}

/** Chamado quando o jogador renasce: decide em qual corpo ele acorda. */
export function handleRespawn(player) {
  const p = Players.of(player);
  const death = p.pendingRespawn;
  if (!death) return;
  p.pendingRespawn = null;

  const own = p.capsule ? Capsules.get(p.capsule) : undefined;
  if (own && isLinked(own)) {
    if (p.mode === "original" && own.body === "clone") {
      const immature = !isReady(own);
      startGrowing(own, "clone");
      Capsules.save(own);
      Players.save(p);
      refreshCapsuleEntity(own);
      wakeUpIn(player, own);
      if (immature) {
        const ticks = CONFIG.immatureEffectSeconds * 20;
        for (const e of ["weakness", "slowness", "hunger"]) player.addEffect(EffectTypes.get(e), ticks, { amplifier: 1 });
        player.sendMessage("§eVocê acordou num clone que ainda não estava pronto.");
      } else {
        player.sendMessage("§bOperação Fênix: §7você acordou no seu clone.");
      }
      return;
    }
    if (p.mode === "foreign" && own.body === "original" && isReady(own)) {
      Players.save(p);
      enterOriginal(player, own);
      return;
    }
  }

  // Sem Operação Fênix própria: quem já teve uma acorda no clone pronto mais próximo.
  if (!p.everLinked) {
    Players.save(p);
    return;
  }
  const host = networkClones(p.id, death)[0];
  p.mode = "foreign";
  if (!host) {
    p.host = null;
    Players.save(p);
    player.sendMessage("§cNenhum clone disponível na rede. §7Seu corpo original ficou para trás: construa uma Operação Fênix e reviva-o.");
    return;
  }
  p.host = host.ownerName;
  Players.save(p);
  startGrowing(host, "clone");
  Capsules.save(host);
  refreshCapsuleEntity(host);
  wakeUpIn(player, host);
  player.sendMessage(
    `§eVocê acordou no clone de §f${host.ownerName}§e. §7Seus itens ficaram presos no corpo original: construa uma nova Operação Fênix e reviva-o para recuperá-los.`,
  );

  const hostRecord = Players.get(host.owner);
  if (hostRecord) {
    hostRecord.unseen += 1;
    hostRecord.log.unshift({ by: player.name, at: Date.now() });
    hostRecord.log.length = Math.min(hostRecord.log.length, CONFIG.maxLogEntries);
    Players.save(hostRecord);
    if (hostRecord.notify) notifyPlayer(host.owner, `§e⚠ ${player.name} acordou no seu clone. §7Ele vai ser gerado de novo.`);
  }
}

/** Executado a cada segundo: atualiza visuais e avisa quando algo fica pronto. */
export function tick() {
  for (const c of Capsules.all()) {
    const before = JSON.stringify(c);
    refreshCapsuleEntity(c);
    if (c.active && c.start !== null && !c.announced && isReady(c)) {
      c.announced = true;
      notifyPlayer(c.owner, c.body === "clone" ? "§aSeu clone está pronto." : "§bSeu corpo original foi revivido! §7Entre nele pelo painel.");
    }
    if (JSON.stringify(c) !== before) Capsules.save(c);
  }
  for (const dimId of ["overworld", "nether", "the_end"]) {
    for (const panel of world.getDimension(dimId).getEntities({ type: IDS.panel })) {
      const c = resolvePanelCapsule(panel);
      const active = !!c && c.active;
      if (panel.getProperty("fenix:active") !== active) panel.setProperty("fenix:active", active);
    }
  }
}

/** Cápsula que um painel controla: a salva nele, ou a mais próxima no raio. */
export function resolvePanelCapsule(panel, preferOwner) {
  const saved = panel.getDynamicProperty("fenix:capsule");
  if (typeof saved === "string") {
    const c = Capsules.get(saved);
    if (c) return c;
  }
  const loc = { dim: panel.dimension.id, ...panel.location };
  const near = Capsules.all()
    .filter((c) => c.dim === loc.dim && distance(c, loc) <= CONFIG.panelLinkRadius)
    .sort((a, b) => Number(b.owner === preferOwner) - Number(a.owner === preferOwner) || distance(a, loc) - distance(b, loc))[0];
  if (near) panel.setDynamicProperty("fenix:capsule", near.id);
  return near;
}
