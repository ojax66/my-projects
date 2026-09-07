import { world, system, BlockPermutation } from "@minecraft/server";

export function hash2(x, z) {
  let n = x * 374761393 + z * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  n = n ^ (n >> 16);
  return ((n >>> 0) % 100000) / 100000;
}

export function hash3(x, y, z) {
  let n = x * 374761393 + y * 668265263 + z * 2147483647;
  n = (n ^ (n >> 13)) * 1274126177;
  n = n ^ (n >> 16);
  return ((n >>> 0) % 100000) / 100000;
}

export function smooth(t) {
  return t * t * (3 - 2 * t);
}

export function valueNoise(x, z) {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const x1 = x0 + 1, z1 = z0 + 1;
  const sx = smooth(x - x0), sz = smooth(z - z0);
  const n00 = hash2(x0, z0), n10 = hash2(x1, z0);
  const n01 = hash2(x0, z1), n11 = hash2(x1, z1);
  const ix0 = n00 + (n10 - n00) * sx;
  const ix1 = n01 + (n11 - n01) * sx;
  return ix0 + (ix1 - ix0) * sz;
}

export function valueNoise3D(x, y, z) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const x1 = x0 + 1, y1 = y0 + 1, z1 = z0 + 1;
  const sx = smooth(x - x0), sy = smooth(y - y0), sz = smooth(z - z0);

  const n000 = hash3(x0, y0, z0), n100 = hash3(x1, y0, z0);
  const n010 = hash3(x0, y1, z0), n110 = hash3(x1, y1, z0);
  const n001 = hash3(x0, y0, z1), n101 = hash3(x1, y0, z1);
  const n011 = hash3(x0, y1, z1), n111 = hash3(x1, y1, z1);

  const ix00 = n000 + (n100 - n000) * sx;
  const ix10 = n010 + (n110 - n010) * sx;
  const ix01 = n001 + (n101 - n001) * sx;
  const ix11 = n011 + (n111 - n011) * sx;

  const iy0 = ix00 + (ix10 - ix00) * sy;
  const iy1 = ix01 + (ix11 - ix01) * sy;

  return iy0 + (iy1 - iy0) * sz;
}

export function fbm(x, z, octaves, persistence, scale) {
  let total = 0, amp = 1, freq = scale, maxAmp = 0;
  for (let i = 0; i < octaves; i++) {
    total += valueNoise(x * freq, z * freq) * amp;
    maxAmp += amp;
    amp *= persistence;
    freq *= 2;
  }
  return total / maxAmp;
}

export function createTerrainGenerator(config) {
  if (!config || !config.dimensionId) throw new Error("createTerrainGenerator precisa de dimensionId");
  if (typeof config.generateColumn !== "function") throw new Error("createTerrainGenerator precisa de generateColumn");

  const dimensionId = config.dimensionId;
  const generateColumn = config.generateColumn;
  const getHeight = config.getHeight ?? null;
  const chunkSize = config.chunkSize ?? 16;
  const genRadiusChunks = config.genRadiusChunks ?? 3;
  const chunksPerTick = config.chunksPerTick ?? 1;
  const recenterMargin = config.tickingRecenterMargin ?? 32;
  const markerBlockId = config.markerBlockId ?? "minecraft:barrier";
  const registerDimension = config.registerDimension !== false;
  const heightRangeFallback = config.heightRangeFallback ?? { min: -64, max: 320 };
  const onError = config.onError ?? function (ctx, err) { console.warn("[world-gen:" + dimensionId + "] " + ctx + ": " + err); };

  const maxReach = recenterMargin + (genRadiusChunks + 1) * chunkSize;
  const tickingRadius = config.tickingRadius ?? (maxReach + 32);
  if (tickingRadius < maxReach) onError("configuração", { tickingRadius, maxReach });

  const blockCache = new Map();
  function perm(id) {
    let p = blockCache.get(id);
    if (!p) {
      p = BlockPermutation.resolve(id);
      blockCache.set(id, p);
    }
    return p;
  }
  const markerPerm = () => perm(markerBlockId);

  let hrCache = null;
  function getHeightRangeOf(dim) {
    if (hrCache) return hrCache;
    try {
      hrCache = { min: dim.heightRange.min, max: dim.heightRange.max };
    } catch (e) {
      onError("getHeightRange", e);
      hrCache = { min: heightRangeFallback.min, max: heightRangeFallback.max };
    }
    return hrCache;
  }

  const markerLoc = (cx, cz, hr) => ({ x: cx * chunkSize, y: hr.min, z: cz * chunkSize });

  function hasMarker(dim, cx, cz, hr) {
    try {
      return dim.getBlock(markerLoc(cx, cz, hr))?.typeId === markerBlockId;
    } catch (e) {
      return false;
    }
  }

  function genChunk(dim, cx, cz) {
    const sx = cx * chunkSize, sz = cz * chunkSize;
    const heights = [];
    let hadError = false;

    for (let x = sx; x < sx + chunkSize; x++) {
      for (let z = sz; z < sz + chunkSize; z++) {
        try {
          heights.push({ x, z, h: generateColumn(dim, x, z) });
        } catch (e) {
          hadError = true;
          onError("generateColumn " + x + "," + z, e);
        }
      }
    }

    if (!hadError) {
      try {
        dim.getBlock(markerLoc(cx, cz, getHeightRangeOf(dim)))?.setPermutation(markerPerm());
      } catch (e) {
        onError("marcador " + cx + "," + cz, e);
      }
    }

    return { heights, hadError };
  }

  function pureHeights(cx, cz) {
    if (!getHeight) return null;
    const sx = cx * chunkSize, sz = cz * chunkSize;
    const heights = [];
    for (let x = sx; x < sx + chunkSize; x++) {
      for (let z = sz; z < sz + chunkSize; z++) heights.push({ x, z, h: getHeight(x, z) });
    }
    return heights;
  }

  const done = new Set();
  const queues = new Map();
  const lastChunk = new Map();
  const key = (cx, cz) => cx + "," + cz;

  function refillQueue(dim, player) {
    const cx = Math.floor(player.location.x / chunkSize);
    const cz = Math.floor(player.location.z / chunkSize);
    const k = key(cx, cz);
    if (lastChunk.get(player.id) === k) return;
    lastChunk.set(player.id, k);

    const hr = getHeightRangeOf(dim);
    const needed = [];
    for (let dx = -genRadiusChunks; dx <= genRadiusChunks; dx++) {
      for (let dz = -genRadiusChunks; dz <= genRadiusChunks; dz++) {
        const ccx = cx + dx, ccz = cz + dz, kk = key(ccx, ccz);
        if (done.has(kk)) continue;
        if (hasMarker(dim, ccx, ccz, hr)) { done.add(kk); continue; }
        needed.push({ cx: ccx, cz: ccz, d: dx * dx + dz * dz });
      }
    }
    needed.sort((a, b) => a.d - b.d);
    queues.set(player.id, needed);
  }

  function drainQueue(dim, player) {
    const q = queues.get(player.id);
    if (!q || !q.length) return;
    for (let i = 0; i < chunksPerTick; i++) {
      const next = q.shift();
      if (!next) return;
      const k = key(next.cx, next.cz);
      if (done.has(k)) continue;
      const r = genChunk(dim, next.cx, next.cz);
      if (!r.hadError) done.add(k);
    }
  }

  const tickAreas = new Map();
  const pendingSync = new Set();
  let tickAreaN = 0;

  async function syncTickingArea(dim, player) {
    const loc = player.location;
    const cur = tickAreas.get(player.id);
    if (cur && Math.abs(loc.x - cur.x) < recenterMargin && Math.abs(loc.z - cur.z) < recenterMargin) return;

    // createTickingArea é assíncrono e este método é chamado TODO tick. Sem
    // esta trava, os ticks que passam enquanto a primeira criação ainda não
    // resolveu veem `cur` vazio e disparam outra criação — dezenas de áreas
    // de ticking (wgen_..._1, _2, _3...) nos primeiros segundos, e só a
    // última fica registrada no mapa; as outras vazam.
    if (pendingSync.has(player.id)) return;
    pendingSync.add(player.id);
    try {

      const hr = getHeightRangeOf(dim);
      const id = "wgen_" + dimensionId.replace(/[^a-zA-Z0-9]/g, "_") + "_" + (++tickAreaN);

      await world.tickingAreaManager.createTickingArea(id, {
        dimension: dim,
        from: { x: loc.x - tickingRadius, y: hr.min, z: loc.z - tickingRadius },
        to: { x: loc.x + tickingRadius, y: hr.max, z: loc.z + tickingRadius },
      });

      if (cur && world.tickingAreaManager.hasTickingArea(cur.id)) world.tickingAreaManager.removeTickingArea(cur.id);
      tickAreas.set(player.id, { id, x: loc.x, z: loc.z });
    } finally {
      pendingSync.delete(player.id);
    }
  }

  function dropPlayer(player) {
    const cur = tickAreas.get(player.id);
    if (cur) {
      if (world.tickingAreaManager.hasTickingArea(cur.id)) world.tickingAreaManager.removeTickingArea(cur.id);
      tickAreas.delete(player.id);
    }
    queues.delete(player.id);
    lastChunk.delete(player.id);
    pendingSync.delete(player.id);
  }

  function spiral(r) {
    const cells = [];
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) cells.push({ dx, dz, d: dx * dx + dz * dz });
    }
    cells.sort((a, b) => a.d - b.d);
    return cells;
  }

  let spotN = 0;

  async function findValidSpot(targetX, targetZ, isValid, options) {
    options = options || {};
    const searchRadiusChunks = options.searchRadiusChunks ?? 2;
    const dim = world.getDimension(dimensionId);
    const hr = getHeightRangeOf(dim);
    const half = (searchRadiusChunks + 1) * chunkSize + 8;
    const tickingId = "wgen_spot_" + (++spotN);

    await world.tickingAreaManager.createTickingArea(tickingId, {
      dimension: dim,
      from: { x: targetX - half, y: hr.min, z: targetZ - half },
      to: { x: targetX + half, y: hr.max, z: targetZ + half },
    });

    const baseCx = Math.floor(targetX / chunkSize);
    const baseCz = Math.floor(targetZ / chunkSize);

    let found = null;
    for (const c of spiral(searchRadiusChunks)) {
      const cx = baseCx + c.dx, cz = baseCz + c.dz, k = key(cx, cz);

      let heights;
      if (done.has(k) || hasMarker(dim, cx, cz, hr)) {
        done.add(k);
        heights = pureHeights(cx, cz);
        if (!heights) continue;
      } else {
        const r = genChunk(dim, cx, cz);
        if (!r.hadError) done.add(k);
        heights = r.heights;
      }

      let best = null, bestDist = Infinity;
      for (const col of heights) {
        if (!isValid(col.x, col.z, col.h)) continue;
        const dist = (col.x - targetX) ** 2 + (col.z - targetZ) ** 2;
        if (dist < bestDist) { bestDist = dist; best = col; }
      }
      if (best) { found = best; break; }
    }

    if (world.tickingAreaManager.hasTickingArea(tickingId)) world.tickingAreaManager.removeTickingArea(tickingId);

    return found ? { x: found.x, y: found.h + 1, z: found.z } : null;
  }

  function start() {
    if (registerDimension) {
      system.beforeEvents.startup.subscribe((event) => {
        try {
          event.dimensionRegistry.registerCustomDimension(dimensionId);
        } catch (e) {
          onError("registro da dimensão", e);
        }
      });
    }

    system.runInterval(() => {
      try {
        const dim = world.getDimension(dimensionId);
        const players = dim.getPlayers();
        if (!players.length) return;
        for (const player of players) {
          syncTickingArea(dim, player).catch((e) => onError("syncTickingArea", e));
          refillQueue(dim, player);
          drainQueue(dim, player);
        }
      } catch (e) {
        onError("loop principal", e);
      }
    }, 1);

    world.afterEvents.playerDimensionChange.subscribe((event) => {
      try {
        if (event.fromDimension.id === dimensionId) dropPlayer(event.player);
      } catch (e) {
        onError("playerDimensionChange", e);
      }
    });

    world.beforeEvents.playerLeave.subscribe((event) => {
      try {
        dropPlayer(event.player);
      } catch (e) {
        onError("playerLeave", e);
      }
    });
  }

  function isChunkReady(x, z) {
    return done.has(key(Math.floor(x / chunkSize), Math.floor(z / chunkSize)));
  }

  return { start, findValidSpot, isChunkReady, getHeightRangeOf, dimensionId };
}
