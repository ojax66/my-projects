import { EffectTypes, world } from "@minecraft/server";
import { CONFIG, IDS } from "./config.js";
import { Capsules, Players } from "./store.js";
import { applyDisguise, applySkin } from "./skin.js";
import { enforceValhalla, sendToValhalla } from "./valhalla.js";

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
  const seconds = { clone: CONFIG.cloneGrowSeconds, original: CONFIG.reviveSeconds, dna: CONFIG.dnaReviveSeconds }[body];
  c.duration = seconds * 1000;
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
  // O corpo que cresce no vidro é de quem vai acordar nele.
  const grows = c.body === "dna" && c.dnaName ? c.dnaName : c.ownerName;
  if (entity.getDynamicProperty("fenix:skinName") !== grows) {
    applySkin(entity, grows);
    entity.setDynamicProperty("fenix:skinName", grows);
  }
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

function immatureWakeUp(player) {
  const ticks = CONFIG.immatureEffectSeconds * 20;
  for (const e of ["weakness", "slowness", "hunger"]) player.addEffect(EffectTypes.get(e), ticks, { amplifier: 1 });
}

/** Acorda o jogador no clone pronto de outro jogador (e avisa o dono). */
function wakeInForeignClone(player, p, host, reason) {
  p.mode = "foreign";
  p.host = host.ownerName;
  Players.save(p);
  startGrowing(host, "clone");
  Capsules.save(host);
  refreshCapsuleEntity(host);
  wakeUpIn(player, host);
  player.sendMessage(
    (reason ?? "") +
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

/** Chamado quando o jogador renasce: decide em qual corpo (ou em que lugar) ele acorda. */
export function handleRespawn(player) {
  const p = Players.of(player);
  const death = p.pendingRespawn;
  if (!death) return;
  p.pendingRespawn = null;

  // Em Valhalla, cada morte volta para Valhalla.
  if (p.mode === "valhalla") {
    Players.save(p);
    sendToValhalla(player);
    return;
  }

  const own = p.capsule ? Capsules.get(p.capsule) : undefined;
  if (own && isLinked(own)) {
    if (p.mode === "original" && own.body === "clone") {
      const immature = !isReady(own);
      // "Priorizar clones crescidos": com o próprio clone imaturo (ex.: uma armadilha
      // matando o jogador em cima da cápsula), um clone crescido da rede vence.
      const grown = immature && p.preferGrown ? networkClones(p.id, death)[0] : undefined;
      if (grown) {
        wakeInForeignClone(player, p, grown, "§7Seu clone ainda não tinha crescido e você prioriza clones crescidos. ");
        return;
      }
      startGrowing(own, "clone");
      Capsules.save(own);
      Players.save(p);
      refreshCapsuleEntity(own);
      wakeUpIn(player, own);
      if (immature) {
        immatureWakeUp(player);
        player.sendMessage("§eVocê acordou num clone que ainda não estava pronto.");
      } else {
        player.sendMessage("§bOperação Fênix: §7você acordou no seu clone.");
      }
      return;
    }
    if (p.mode === "original" && own.body === "dna") {
      // A cápsula está trazendo alguém de Valhalla: o dono acorda nela sem atrapalhar.
      Players.save(p);
      wakeUpIn(player, own);
      immatureWakeUp(player);
      player.sendMessage("§eSua cápsula está ocupada com um DNA; você acordou sem um clone pronto.");
      return;
    }
    if (p.mode === "foreign" && own.body === "original" && isReady(own)) {
      Players.save(p);
      enterOriginal(player, own);
      return;
    }
  }

  // Sem Operação Fênix própria pronta: acorda no clone pronto mais próximo...
  const host = networkClones(p.id, death)[0];
  if (host) {
    wakeInForeignClone(player, p, host);
    return;
  }
  // ...e sem nenhum clone pronto na rede, vai para Valhalla.
  p.mode = "valhalla";
  p.host = null;
  Players.save(p);
  sendToValhalla(player);
  player.sendMessage(
    "§6Nenhum clone disponível: você foi para Valhalla. §7Para voltar, outro jogador precisa tirar o DNA de um corpo seu com uma seringa e usá-lo numa Operação Fênix.",
  );
}

/** "Usar DNA": a cápsula do jogador passa a refazer o corpo de quem está em Valhalla. */
export function startDna(player, c, targetId, targetName) {
  if (c.owner !== player.id) return "§cUse o DNA na sua própria Operação Fênix.";
  if (!isLinked(c)) return "§cVincule esta cápsula primeiro.";
  const target = Players.get(targetId);
  if (!target || target.mode !== "valhalla") return `§e${targetName} não está em Valhalla.`;
  if (c.body === "dna") return "§cEsta cápsula já está revivendo alguém.";
  c.dnaOwner = targetId;
  c.dnaName = targetName;
  startGrowing(c, "dna");
  Capsules.save(c);
  refreshCapsuleEntity(c);
  notifyPlayer(targetId, `§6${player.name} está refazendo seu corpo numa Operação Fênix. §7Aguarde em Valhalla.`);
  return undefined;
}

/** O corpo feito pelo DNA ficou pronto: tira o jogador de Valhalla (quando ele estiver online). */
function finishDna(c) {
  const target = Players.get(c.dnaOwner);
  if (!target || target.mode !== "valhalla") {
    // Já saiu de Valhalla por outro caminho: a cápsula volta ao clone do dono.
    startGrowing(c, "clone");
    return;
  }
  const player = findPlayer(c.dnaOwner);
  if (!player) return; // tenta de novo quando ele entrar
  target.mode = "original";
  target.host = null;
  Players.save(target);
  wakeUpIn(player, c);
  applyDisguise(player, target);
  player.sendMessage(`§bVocê voltou de Valhalla no seu corpo original, graças a §f${c.ownerName}§b.`);
  notifyPlayer(c.owner, `§b${player.name} voltou de Valhalla pela sua Operação Fênix.`);
  c.dnaOwner = undefined;
  c.dnaName = undefined;
  startGrowing(c, "clone");
}

/** Executado a cada segundo: atualiza visuais e avisa quando algo fica pronto. */
export function tick() {
  enforceValhalla((id) => Players.get(id)?.mode === "valhalla");
  for (const c of Capsules.all()) {
    const before = JSON.stringify(c);
    refreshCapsuleEntity(c);
    if (c.active && c.body === "dna" && isReady(c)) finishDna(c);
    else if (c.active && c.start !== null && !c.announced && isReady(c)) {
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
