/* Bedrock de mentira, o suficiente pros scripts do addon rodarem no Node.
 *
 * Cobre o que os testes exercitam: dimensões, entidades, montaria,
 * structureManager e uma fila de runTimeout que avança tick a tick com
 * __advance(). O resto é stub inerte — o objetivo é pegar erro de lógica no
 * fluxo de viagem, não simular o motor do jogo.
 */

export const TicksPerSecond = 20;

let state;

export function __state() {
  return state;
}

export function __reset() {
  state = {
    tick: 0,
    timers: [],          // { at, fn }
    dimensions: new Map(),
    players: [],
    structures: new Map(),
    breakStructures: false,
    nextEntityId: 1,
    worldProps: new Map(),
  };
  system.currentTick = 0;
}

/** Avança N ticks, disparando os runTimeout que vencerem. */
export function __advance(ticks) {
  for (let i = 0; i < ticks; i++) {
    state.tick++;
    system.currentTick = state.tick;
    const due = state.timers.filter((t) => t.at <= state.tick);
    state.timers = state.timers.filter((t) => t.at > state.tick);
    for (const t of due) t.fn();
  }
}

class Entity {
  constructor(dimension, typeId, location) {
    this.id = "e" + state.nextEntityId++;
    this.typeId = typeId;
    this.dimension = dimension;
    this.location = { ...location };
    this.isValid = true;
    this.__riders = [];
    this.__ridingOn = null;
    this.__tags = new Set();
  }

  teleport(loc, opts) {
    this.location = { ...loc };
    if (opts?.dimension && opts.dimension !== this.dimension) {
      this.dimension.__entities.delete(this);
      this.dimension = opts.dimension;
      this.dimension.__entities.add(this);
    }
  }

  remove() {
    this.dimension.__entities.delete(this);
    this.isValid = false;
  }

  addTag(t) { this.__tags.add(t); return true; }
  hasTag(t) { return this.__tags.has(t); }
  removeTag(t) { return this.__tags.delete(t); }
  addEffect() { }
  removeEffect() { }
  applyDamage() { }
  playSound() { }
  sendMessage() { }
  runCommand() { return { successCount: 1 }; }
  setOnFire() { }
  getRotation() { return { x: 0, y: 0 }; }
  getGameMode() { return "Survival"; }
  setDynamicProperty(k, v) { (this.__props ??= new Map()).set(k, v); }
  getDynamicProperty(k) { return this.__props?.get(k); }
  getHeadLocation() { return this.location; }

  getComponent(name) {
    if (name === "riding" || name === "minecraft:riding") {
      return this.__ridingOn ? { entityRidingOn: this.__ridingOn } : undefined;
    }
    if (name === "rideable" || name === "minecraft:rideable") {
      return {
        getRiders: () => [...this.__riders],
        addRider: (r) => {
          if (this.__riders.length >= 1) return false;
          if (r.__ridingOn) r.__ridingOn.__riders = r.__ridingOn.__riders.filter((x) => x !== r);
          this.__riders.push(r);
          r.__ridingOn = this;
          return true;
        },
        ejectRider: (r) => {
          this.__riders = this.__riders.filter((x) => x !== r);
          if (r.__ridingOn === this) r.__ridingOn = null;
        },
      };
    }
    if (name === "equippable") {
      return { getEquipment: () => undefined };
    }
    return undefined;
  }

  get onScreenDisplay() {
    return { setTitle() { }, setActionBar() { } };
  }
}

class Player extends Entity {
  constructor(dimension, location, id) {
    super(dimension, "minecraft:player", location);
    if (id) this.id = id;
    this.isJumping = false;
    this.isSneaking = false;
    this.isOnGround = false;
  }
  /** Atalho de teste: monta este jogador num veículo. */
  __mountOn(vehicle) {
    vehicle.getComponent("rideable").addRider(this);
  }
  getSpawnPoint() { return { x: 0, y: 64, z: 0 }; }
}

class Dimension {
  constructor(id) {
    this.id = id;
    this.__entities = new Set();
    this.heightRange = { min: -64, max: 320 };
  }

  getEntities(opts = {}) {
    let out = [...this.__entities];
    if (opts.type) out = out.filter((e) => e.typeId === opts.type);
    if (opts.families) out = [];
    if (opts.location && opts.maxDistance !== undefined) {
      out = out.filter((e) => {
        const d = Math.hypot(
          e.location.x - opts.location.x,
          e.location.y - opts.location.y,
          e.location.z - opts.location.z
        );
        return d <= opts.maxDistance;
      });
    }
    if (opts.closest) out = out.slice(0, opts.closest);
    return out;
  }

  getPlayers() { return [...this.__entities].filter((e) => e instanceof Player); }
  spawnEntity(typeId, location) {
    const e = new Entity(this, typeId, location);
    this.__entities.add(e);
    return e;
  }
  spawnParticle() { }
  getBlock() { return undefined; }
  setBlockType() { }
  fillBlocks() { }
}

const structureManager = {
  createFromWorld(name, dimension, from, to, opts) {
    if (state.breakStructures) throw new Error("structureManager quebrado (teste)");
    const inside = [...dimension.__entities].filter(
      (e) =>
        !(e instanceof Player) &&
        Math.floor(e.location.x) >= Math.min(from.x, to.x) &&
        Math.floor(e.location.x) <= Math.max(from.x, to.x) &&
        Math.floor(e.location.y) >= Math.min(from.y, to.y) &&
        Math.floor(e.location.y) <= Math.max(from.y, to.y) &&
        Math.floor(e.location.z) >= Math.min(from.z, to.z) &&
        Math.floor(e.location.z) <= Math.max(from.z, to.z)
    );
    if (opts?.includeEntities === false) return;
    state.structures.set(
      name,
      inside.map((e) => ({ typeId: e.typeId, tags: [...e.__tags] }))
    );
  },
  place(name, dimension, location) {
    if (state.breakStructures) throw new Error("structureManager quebrado (teste)");
    const saved = state.structures.get(name);
    if (!saved) throw new Error("estrutura inexistente: " + name);
    for (const s of saved) {
      const e = dimension.spawnEntity(s.typeId, location);
      for (const t of s.tags) e.addTag(t);
    }
  },
  delete(name) { return state.structures.delete(name); },
  get(name) { return state.structures.get(name); },
};

function noopEvent() {
  return { subscribe() { }, unsubscribe() { } };
}

export const world = {
  structureManager,

  getDimension(id) {
    if (!state.dimensions.has(id)) state.dimensions.set(id, new Dimension(id));
    return state.dimensions.get(id);
  },
  getAllPlayers() { return [...state.players]; },
  getDynamicProperty(k) { return state.worldProps.get(k); },
  setDynamicProperty(k, v) { state.worldProps.set(k, v); },
  getDefaultSpawnLocation() { return { x: 0, y: 64, z: 0 }; },

  afterEvents: {
    playerDimensionChange: noopEvent(),
    playerSpawn: noopEvent(),
    entityHurt: noopEvent(),
  },
  beforeEvents: {
    playerLeave: noopEvent(),
  },
  tickingAreaManager: {
    createTickingArea: async () => { },
    hasTickingArea: () => false,
    removeTickingArea: () => { },
  },

  // --- atalhos de teste ---
  __addPlayer({ id, dimensionId, location }) {
    const dim = this.getDimension(dimensionId);
    const p = new Player(dim, location, id);
    dim.__entities.add(p);
    state.players.push(p);
    return p;
  },
  __spawn(dimensionId, typeId, location) {
    return this.getDimension(dimensionId).spawnEntity(typeId, location);
  },
};

export const system = {
  currentTick: 0,
  runInterval() { return 0; },
  runTimeout(fn, ticks) {
    state.timers.push({ at: state.tick + Math.max(1, ticks | 0), fn });
    return state.timers.length;
  },
  clearRun() { },
  beforeEvents: { startup: noopEvent() },
  afterEvents: { scriptEventReceive: noopEvent() },
};

export const BlockPermutation = { resolve: () => ({}) };
export class BlockVolume {
  constructor(from, to) { this.from = from; this.to = to; }
}

__reset();

export default { world, system, BlockPermutation, BlockVolume, TicksPerSecond };
