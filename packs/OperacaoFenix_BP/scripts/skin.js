import { SKINS } from "./skins.js";

/**
 * Aplica no corpo/clone a skin registrada para o jogador (tools/sync_skins.py ou plugin do servidor).
 * @param {import("@minecraft/server").Entity} entity
 * @param {string} playerName
 */
export function applySkin(entity, playerName) {
  const entry = SKINS[playerName.toLowerCase()];
  entity.setProperty("fenix:skin", entry?.skin ?? 0);
  entity.setProperty("fenix:slim", entry?.slim ?? false);
}

/**
 * De quem é o corpo que o jogador está usando: o dele, ou o do dono do clone em que acordou.
 * @param {import("./store.js").PlayerRecord} record
 */
export function bodyName(record) {
  return record.mode === "foreign" && record.host ? record.host : record.name;
}

/**
 * No clone de outro jogador, o jogador aparece com a skin do dono do clone.
 * 0 = skin própria; N = skin registrada N-1 (dono sem skin registrada = Steve).
 * @param {import("@minecraft/server").Player} player
 * @param {import("./store.js").PlayerRecord} record
 */
export function applyDisguise(player, record) {
  const host = record.mode === "foreign" ? record.host : null;
  const entry = host ? SKINS[host.toLowerCase()] : undefined;
  const value = host ? (entry?.skin ?? 0) + 1 : 0;
  const slim = entry?.slim ?? false;
  if (player.getProperty("fenix:disguise") !== value) player.setProperty("fenix:disguise", value);
  if (player.getProperty("fenix:disguise_slim") !== slim) player.setProperty("fenix:disguise_slim", slim);
}
