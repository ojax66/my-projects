import { world } from "@minecraft/server";

const CAPSULE_PREFIX = "fenix:cap:";
const PLAYER_PREFIX = "fenix:plr:";
const BODY_PREFIX = "fenix:body:";

function read(key) {
  const raw = world.getDynamicProperty(key);
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function write(key, value) {
  world.setDynamicProperty(key, value === undefined ? undefined : JSON.stringify(value));
}

/**
 * @typedef {object} CapsuleRecord
 * @property {string} id           id da entidade fenix:capsule
 * @property {string} owner        id do jogador dono
 * @property {string} ownerName
 * @property {string} dim
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} yaw          para onde a porta da cápsula aponta
 * @property {boolean} active      vinculada ao dono
 * @property {"clone"|"original"|"dna"} body  o que a cápsula está gerando
 * @property {string} [dnaOwner]   "dna": id de quem está sendo trazido de Valhalla
 * @property {string} [dnaName]
 * @property {number|null} start   Date.now() do início da geração (null = parada)
 * @property {number} duration     ms para completar a geração
 * @property {number} integrity    0..1, vida da cápsula
 * @property {boolean} [announced] dono já foi avisado que ficou pronto
 */
export const Capsules = {
  /** @returns {CapsuleRecord|undefined} */
  get: (id) => read(CAPSULE_PREFIX + id),
  /** @param {CapsuleRecord} c */
  save: (c) => write(CAPSULE_PREFIX + c.id, c),
  remove: (id) => write(CAPSULE_PREFIX + id, undefined),
  /** @returns {CapsuleRecord[]} */
  all: () =>
    world
      .getDynamicPropertyIds()
      .filter((k) => k.startsWith(CAPSULE_PREFIX))
      .map(read)
      .filter(Boolean),
};

/**
 * @typedef {object} PlayerRecord
 * @property {string} id
 * @property {string} name
 * @property {string|null} capsule        cápsula vinculada
 * @property {"original"|"foreign"|"valhalla"} mode
 *   "foreign" = está num clone que não é o seu corpo original; "valhalla" = sem corpo, preso em Valhalla
 * @property {string|null} host           dono do clone em que está
 * @property {boolean} everLinked         já teve uma Operação Fênix
 * @property {boolean} notify             avisar quando usarem meu clone
 * @property {boolean} [preferGrown]      prefere um clone crescido de outro jogador a um clone próprio imaturo
 * @property {number} unseen              usos do meu clone ainda não vistos
 * @property {{by: string, at: number}[]} log
 * @property {{dim: string, x: number, y: number, z: number}|null} pendingRespawn
 */
export const Players = {
  /** @returns {PlayerRecord|undefined} */
  get: (id) => read(PLAYER_PREFIX + id),
  /** @param {import("@minecraft/server").Player} player @returns {PlayerRecord} */
  of(player) {
    const p = read(PLAYER_PREFIX + player.id) ?? {
      id: player.id,
      capsule: null,
      mode: "original",
      host: null,
      everLinked: false,
      notify: true,
      unseen: 0,
      log: [],
      pendingRespawn: null,
    };
    p.name = player.name;
    return p;
  },
  /** @param {PlayerRecord} p */
  save: (p) => write(PLAYER_PREFIX + p.id, p),
};

/**
 * @typedef {object} BodyRecord
 * @property {string} id            id da entidade fenix:corpse
 * @property {string} owner
 * @property {string} dim
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} at            Date.now() da morte
 * @property {number|null} emptySince  desde quando está sem itens
 */
export const Bodies = {
  /** @returns {BodyRecord|undefined} */
  get: (id) => read(BODY_PREFIX + id),
  /** @param {BodyRecord} b */
  save: (b) => write(BODY_PREFIX + b.id, b),
  remove: (id) => write(BODY_PREFIX + id, undefined),
  /** @returns {BodyRecord[]} */
  all: () =>
    world
      .getDynamicPropertyIds()
      .filter((k) => k.startsWith(BODY_PREFIX))
      .map(read)
      .filter(Boolean),
};
