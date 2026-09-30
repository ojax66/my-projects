export const CONFIG = {
  // Tempo para a cápsula gerar um clone novo depois de ser vinculada ou usada.
  cloneGrowSeconds: 300,
  // Tempo para reviver o corpo original numa cápsula nova.
  reviveSeconds: 180,
  // Raio em que um painel procura a cápsula que controla.
  panelLinkRadius: 10,
  // Quanto tempo duram os efeitos de acordar num clone que ainda não estava pronto.
  immatureEffectSeconds: 60,
  // Quantos registros de uso do clone ficam guardados por jogador.
  maxLogEntries: 20,
  // Tempo para uma cápsula refazer, a partir do DNA, o corpo de quem está em Valhalla.
  dnaReviveSeconds: 240,
  // Corpo sem itens some depois deste tempo (e sai da bússola).
  emptyBodyDespawnSeconds: 300,
};

export const IDS = {
  capsule: "fenix:capsule",
  panel: "fenix:panel",
  corpse: "fenix:corpse",
  capsuleKit: "fenix:capsule_kit",
  panelKit: "fenix:panel_kit",
  syringe: "fenix:syringe",
  blood: "fenix:blood_sample",
  dna: "fenix:dna_sample",
  compass: "fenix:body_compass",
};

// Dimensão para onde vai quem já teve uma Operação Fênix e ficou sem nenhuma.
export const VALHALLA = "fenix:valhalla";

// Marcador invisível no título que faz o resource pack desenhar a UI da Operação Fênix.
export const FORM_MARKER = "§f§e§n§x";

export const ICONS = {
  capsule: "textures/ui/fenix/capsule",
  clone: "textures/ui/fenix/clone",
  energy: "textures/ui/fenix/energy",
  skull: "textures/ui/fenix/skull",
  link: "textures/ui/fenix/link",
  warning: "textures/ui/fenix/warning",
  checkboxOn: "textures/ui/fenix/checkbox_on",
  checkboxOff: "textures/ui/fenix/checkbox_off",
  bar: (progress) => `textures/ui/fenix/bar/bar_${String(Math.round(Math.min(1, Math.max(0, progress)) * 20)).padStart(2, "0")}`,
};
