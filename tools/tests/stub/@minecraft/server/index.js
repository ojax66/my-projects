export const world = {
  getDimension: () => ({}), getAllPlayers: () => [], getDynamicProperty: () => undefined,
  setDynamicProperty: () => {}, getDefaultSpawnLocation: () => ({x:0,y:0,z:0}),
  afterEvents: { playerDimensionChange: { subscribe(){} }, playerSpawn: { subscribe(){} } },
  beforeEvents: { playerLeave: { subscribe(){} } },
  tickingAreaManager: { createTickingArea: async () => {}, hasTickingArea: () => false, removeTickingArea: () => {} },
};
export const system = {
  currentTick: 0, runInterval: () => 0, runTimeout: () => 0, clearRun: () => {},
  beforeEvents: { startup: { subscribe(){} } },
  afterEvents: { scriptEventReceive: { subscribe(){} } },
};
export const BlockPermutation = { resolve: () => ({}) };
export class BlockVolume { constructor(from, to) { this.from = from; this.to = to; } }
export const TicksPerSecond = 20;
export default { world, system, BlockPermutation, BlockVolume, TicksPerSecond };
