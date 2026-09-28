import { SKINS } from "./skins.js";

/**
 * Aplica no corpo/clone a skin registrada para o jogador (tools/sync-skins.mjs).
 * @param {import("@minecraft/server").Entity} entity
 * @param {string} playerName
 */
export function applySkin(entity, playerName) {
  const entry = SKINS[playerName.toLowerCase()];
  entity.setProperty("fenix:skin", entry?.skin ?? 0);
  entity.setProperty("fenix:slim", entry?.slim ?? false);
}
