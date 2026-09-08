/* Bedrock de mentira, o suficiente pros scripts do addon rodarem no Node.
 *
 * Cobre o que os testes exercitam: dimensões, entidades, montaria,
 * structureManager e uma fila de runTimeout que avança tick a tick com
 * __advance(). O resto é stub inerte — o objetivo é pegar erro de lógica no
 * fluxo de viagem, não simular o motor do jogo.
 */

export const TicksPerSecond = 20;

export class ItemStack {
  constructor(typeId, amount = 1) {
    this.typeId = typeId;
    this.amount = amount;
  }
  getComponent(name) {
    if (name === "minecraft:durability") return { damage: 0, maxDurability: 100 };
    return undefined;
  }
}

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
    objectives: new Map(),
    displaySlots: new Map(),
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

  applyImpulse(v) {
    this.__impulses ??= [];
    this.__impulses.push({ ...v });
    this.location = {
      x: this.location.x + v.x, y: this.location.y + v.y, z: this.location.z + v.z,
    };
  }
  applyKnockback(dir, strength) {
    this.__knockbacks ??= [];
    this.__knockbacks.push({ ...dir, strength });
  }
  getEffect(id) { return this.__effects?.[id]; }
  __giveEffect(id, amp = 0) { (this.__effects ??= {})[id] = { amplifier: amp }; }

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
  setProperty(k, v) { (this.__entityProps ??= new Map()).set(k, v); }
  triggerEvent(name) { (this.__events ??= []).push(name); }
  getProperty(k) { return this.__entityProps?.get(k); }
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
      const worn = (this.__equipment ??= {});
      return {
        getEquipment: (slot) => worn[slot],
        setEquipment: (slot, item) => { worn[slot] = item; return true; },
      };
    }
    return undefined;
  }

  get onScreenDisplay() {
    const self = this;
    return {
      setTitle() { },
      setActionBar(text) { self.__actionBar = text; (self.__actionBars ??= []).push(text); },
    };
  }
}

class Player extends Entity {
  constructor(dimension, location, id) {
    super(dimension, "minecraft:player", location);
    if (id) this.id = id;
    this.isJumping = false;
    this.isSneaking = false;
    this.isOnGround = false;
    this.selectedSlotIndex = 0;
  }
  /** Atalho de teste: veste uma peça. */
  __wear(slot, typeId) {
    (this.__equipment ??= {})[slot] = new ItemStack(typeId, 1);
  }
  /** Atalho de teste: monta este jogador num veículo. */
  __mountOn(vehicle) {
    vehicle.getComponent("rideable").addRider(this);
  }
  // --- ponto de renascimento ---
  // undefined = sem spawn próprio (o jogador nasce no spawn do mundo).
  getSpawnPoint() { return this.__spawnPoint; }
  setSpawnPoint(point) { this.__spawnPoint = point; }
  /** Atalho de teste: força um spawn numa dimensão. */
  __setSpawn(dimensionId, loc) {
    this.__spawnPoint = { ...loc, dimension: world.getDimension(dimensionId) };
  }
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
    if (opts.families) {
      out = out.filter((e) => (e.__families ?? []).some((f) => opts.families.includes(f)));
    }
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

  // --- blocos ---
  // O mundo falso e um mapa esparso: o que nao esta nele e ar acima da altura
  // do terreno, ou pedra abaixo. __terrain(x,z) define a altura da superficie.
  __terrain = () => 64;

  __key(x, y, z) { return `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`; }

  getBlock(loc) {
    const { x, y, z } = loc;
    const k = this.__key(x, y, z);
    if (!this.__blocks) this.__blocks = new Map();
    if (this.__blocks.has(k)) return this.__blocks.get(k);

    const ground = this.__terrain(Math.floor(x), Math.floor(z));
    const typeId = y > ground ? "minecraft:air"
      : y === ground ? "minecraft:grass_block"
      : "minecraft:stone";
    const dim = this;
    return {
      typeId,
      x: Math.floor(x), y: Math.floor(y), z: Math.floor(z),
      getComponent(name) {
        if (name !== "minecraft:inventory") return undefined;
        return { container: dim.__containerAt(k) };
      },
    };
  }

  __containerAt(k) {
    this.__containers ??= new Map();
    if (!this.__containers.has(k)) {
      const items = new Array(27).fill(undefined);
      this.__containers.set(k, {
        size: 27,
        setItem(i, item) { items[i] = item; },
        getItem(i) { return items[i]; },
        __items: items,
      });
    }
    return this.__containers.get(k);
  }

  setBlockType(loc, typeId) {
    this.__blocks ??= new Map();
    const k = this.__key(loc.x, loc.y, loc.z);
    const dim = this;
    this.__blocks.set(k, {
      typeId,
      x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z),
      getComponent(name) {
        if (name !== "minecraft:inventory") return undefined;
        return { container: dim.__containerAt(k) };
      },
    });
  }

  getTopmostBlock(loc) {
    const ground = this.__terrain(Math.floor(loc.x), Math.floor(loc.z));
    return this.getBlock({ x: loc.x, y: ground, z: loc.z });
  }

  fillBlocks(vol, id) {
    for (let y = vol.from.y; y <= vol.to.y; y++) {
      this.setBlockType({ x: vol.from.x, y, z: vol.from.z }, id);
    }
  }
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

// --- placar ------------------------------------------------------------------
// O canal do rastreador que sobrevive a `hud @s hide all`.
class Objective {
  constructor(id, display) {
    this.id = id;
    this.displayName = display;
    this.__scores = new Map();
  }
  setScore(participant, score) { this.__scores.set(participant, score); }
  getScore(participant) { return this.__scores.get(participant); }
  getParticipants() { return [...this.__scores.keys()]; }
  removeParticipant(p) { return this.__scores.delete(p); }
}

const scoreboard = {
  addObjective(id, display) {
    const obj = new Objective(id, display);
    state.objectives.set(id, obj);
    return obj;
  },
  getObjective(id) { return state.objectives.get(id); },
  removeObjective(id) {
    const key = typeof id === "string" ? id : id?.id;
    if (state.displaySlots.get("sidebar")?.id === key) state.displaySlots.delete("sidebar");
    return state.objectives.delete(key);
  },
  setObjectiveAtDisplaySlot(slot, opts) { state.displaySlots.set(slot, opts.objective); },
  getObjectiveAtDisplaySlot(slot) { return state.displaySlots.get(slot); },
  clearObjectiveAtDisplaySlot(slot) { state.displaySlots.delete(slot); },
};

export const world = {
  scoreboard,
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
    itemUse: noopEvent(),
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
export const EquipmentSlot = { Head: "Head", Chest: "Chest", Legs: "Legs", Feet: "Feet", Offhand: "Offhand" };
export class BlockVolume {
  constructor(from, to) { this.from = from; this.to = to; }
}

__reset();

export default { world, system, BlockPermutation, BlockVolume, TicksPerSecond, ItemStack, EquipmentSlot };
