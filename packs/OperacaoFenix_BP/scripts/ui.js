import { system } from "@minecraft/server";
import { ActionFormData, FormCancelationReason, MessageFormData } from "@minecraft/server-ui";
import { FORM_MARKER, ICONS } from "./config.js";
import { Capsules, Players } from "./store.js";
import { deactivateCapsule, enterOriginal, isLinked, isReady, linkCapsule, networkClones, progress, startRevive } from "./fenix.js";

/** @typedef {import("@minecraft/server").Player} Player */

/** Mostra um formulário tentando de novo se o jogador estiver ocupado (ex.: chat aberto). */
async function show(player, form, tries = 5) {
  const response = await form.show(player);
  if (response.canceled && response.cancelationReason === FormCancelationReason.UserBusy && tries > 0) {
    await system.waitTicks(10);
    return show(player, form, tries - 1);
  }
  return response;
}

const pct = (v) => `${Math.round(v * 100)}%`;
const coords = (c) => `${Math.floor(c.x)} ${Math.floor(c.y)} ${Math.floor(c.z)}`;

function status(c) {
  if (!isLinked(c)) return { text: "§7DESATIVADA", icon: ICONS.skull };
  const value = progress(c);
  if (c.body === "dna") {
    return value < 1 ? { text: `§dDNA ${pct(value)}`, icon: ICONS.energy } : { text: "§dDNA PRONTO", icon: ICONS.clone };
  }
  if (c.body === "original") {
    if (c.start === null) return { text: "§cCORPO PERDIDO", icon: ICONS.skull };
    return value < 1 ? { text: `§6REVIVENDO ${pct(value)}`, icon: ICONS.energy } : { text: "§bCORPO PRONTO", icon: ICONS.clone };
  }
  return value < 1 ? { text: `§eGERANDO ${pct(value)}`, icon: ICONS.energy } : { text: "§aPRONTO", icon: ICONS.clone };
}

function ago(ms) {
  const min = Math.floor((Date.now() - ms) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.floor(h / 24)} d`;
}

/**
 * Painel da Operação Fênix. O dono vê a UI do mockup; outros jogadores só podem desativar.
 * @param {Player} player
 * @param {string} capsuleId
 */
export async function openPanel(player, capsuleId) {
  const c = Capsules.get(capsuleId);
  if (!c) {
    player.sendMessage("§cNenhuma Operação Fênix encontrada perto deste painel.");
    return;
  }
  if (c.owner !== player.id) return openIntruderPanel(player, c);

  const p = Players.of(player);
  const linked = isLinked(c);
  const st = status(c);

  // Botões 0..3 carregam dados que o resource pack desenha no quadro da esquerda;
  // 4..7 são as ações da direita; 8 é a caixa de aviso, 9 o contador de usos e
  // 10 a caixa "Priorizar clones crescidos".
  let action = "Vincular meu clone";
  if (linked && p.mode === "foreign") {
    if (c.body !== "original" || c.start === null) action = "Reviver corpo original";
    else action = isReady(c) ? "Entrar no corpo original" : "Revivendo...";
  }
  const form = new ActionFormData()
    .title(`${FORM_MARKER}OPERACAO FENIX`)
    .body(p.mode === "foreign" ? "CORPO ORIGINAL" : "SEU CLONE")
    .button(st.text, st.icon)
    .button(`Capsula ${coords(c)}`, ICONS.bar(progress(c)))
    .button(`Integridade ${pct(c.integrity)}`)
    .button(linked ? "§bVinculado" : "§7Desvinculado", linked ? ICONS.link : undefined)
    .button(action)
    .button("Rede de clones")
    .button("Desvincular")
    .button("Fechar")
    .button("Avisar quando usarem meu clone", p.notify ? ICONS.checkboxOn : ICONS.checkboxOff)
    .button(p.unseen > 0 ? String(p.unseen) : "", p.unseen > 0 ? ICONS.warning : undefined)
    .button("Priorizar clones crescidos", p.preferGrown ? ICONS.checkboxOn : ICONS.checkboxOff);

  const res = await show(player, form);
  if (res.canceled || res.selection === undefined) return;
  const again = () => openPanel(player, capsuleId);

  switch (res.selection) {
    case 4: {
      let msg;
      if (!linked) msg = linkCapsule(player, c);
      else if (p.mode === "foreign" && action === "Reviver corpo original") msg = startRevive(player, c);
      else if (action === "Entrar no corpo original") return void enterOriginal(player, c);
      else msg = p.mode === "foreign" ? "§7Seu corpo original está sendo revivido." : "§7Esta cápsula já está vinculada a você.";
      if (msg) player.sendMessage(msg);
      return again();
    }
    case 5:
      return openNetwork(player, again);
    case 6: {
      if (!linked) return again();
      const confirm = await show(
        player,
        new MessageFormData()
          .title("Desvincular")
          .body("Desvincular esta cápsula? O que ela está gerando será perdido e, se você morrer, vai acordar no clone de outro jogador.")
          .button1("Desvincular")
          .button2("Cancelar"),
      );
      if (confirm.selection === 0) {
        deactivateCapsule(c, player);
        player.sendMessage("§7Operação Fênix desvinculada.");
      }
      return again();
    }
    case 8:
      p.notify = !p.notify;
      Players.save(p);
      return again();
    case 10:
      p.preferGrown = !p.preferGrown;
      Players.save(p);
      player.sendMessage(
        p.preferGrown
          ? "§bPriorizar clones crescidos: §aligado. §7Se o seu clone não estiver crescido quando você morrer, você acorda no clone crescido mais próximo de outro jogador."
          : "§bPriorizar clones crescidos: §cdesligado.",
      );
      return again();
    case 9:
      if (p.log.length === 0 && p.unseen === 0) return again();
      return openLog(player, again);
    case 7:
      return;
    default:
      return again();
  }
}

/** Painel visto por quem não é o dono: dá para desativar a cápsula. */
async function openIntruderPanel(player, c) {
  const linked = isLinked(c);
  const form = new ActionFormData()
    .title("Operação Fênix")
    .body(`Cápsula de §f${c.ownerName}§r\n\nStatus: ${status(c).text}§r\nIntegridade: ${pct(c.integrity)}`);
  if (linked) form.button("Desativar cápsula", ICONS.skull);
  form.button("Fechar");
  const res = await show(player, form);
  if (!linked || res.selection !== 0) return;

  const confirm = await show(
    player,
    new MessageFormData()
      .title("Desativar cápsula")
      .body(`Desativar a Operação Fênix de ${c.ownerName}? O dono será avisado.`)
      .button1("Desativar")
      .button2("Cancelar"),
  );
  if (confirm.selection !== 0) return;
  const fresh = Capsules.get(c.id);
  if (!fresh) return;
  deactivateCapsule(fresh, player);
  player.sendMessage(`§7Você desativou a cápsula de ${c.ownerName}.`);
}

async function openNetwork(player, back) {
  const all = Capsules.all().filter((c) => isLinked(c));
  const here = { dim: player.dimension.id, ...player.location };
  const ready = new Set(networkClones(player.id, here).map((c) => c.id));
  const form = new ActionFormData()
    .title("Rede de clones")
    .body(
      all.length === 0
        ? "Nenhuma Operação Fênix ativa no mundo."
        : "Se sua cápsula for destruída ou desativada, você acorda no clone pronto mais próximo de onde morreu.",
    );
  for (const c of all) {
    const dist = c.dim === here.dim ? `${Math.round(Math.hypot(c.x - here.x, c.z - here.z))}m` : c.dim.replace("minecraft:", "");
    const mine = c.owner === player.id ? " §8(você)" : "";
    form.button(`${c.ownerName}${mine}§r\n${status(c).text} §8· ${dist}`, ready.has(c.id) || mine ? ICONS.clone : ICONS.energy);
  }
  form.button("Voltar");
  const res = await show(player, form);
  if (!res.canceled) back();
}

async function openLog(player, back) {
  const p = Players.of(player);
  const lines = p.log.map((e) => `§f${e.by}§7 acordou no seu clone ${ago(e.at)}`);
  p.unseen = 0;
  Players.save(p);
  const res = await show(
    player,
    new ActionFormData()
      .title("Usos do seu clone")
      .body(lines.length ? lines.join("\n") : "Ninguém usou seu clone ainda.")
      .button("Voltar"),
  );
  if (!res.canceled) back();
}
