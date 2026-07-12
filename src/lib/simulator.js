// Faithful re-implementation of the IC2 Classic 1.12-1.5.8 EU reactor tick,
// ported from the exact bytecode shipped in Tekxit 3.14. All the odd integer
// divisions, float truncations and processing orders are intentional - the
// real mod does the same thing. Component numbers live in components.json.
//
// One deliberate deviation: rod depletion in-game rolls a 1/3 chance to leave
// near-depleted cells (else nothing). Both outcomes are inert, so this sim
// always leaves the cells - it keeps every run deterministic.

// Offset order matters: W, E, N, S is the exact jar order for pulses,
// heat acceptors and exchanger neighbors. EnderPearl fuel uses all 8.
const OFFSETS4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const OFFSETS8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

const MAX_SNAPSHOTS = 1400;
const MAX_EVENTS = 300;

export function makeGrid() {
  return Array(54).fill(null);
}

export function widthFor(chambers, data) {
  return data.config.baseColumns + chambers;
}

export function simulate(gridIds, chambers, data, opts = {}) {
  if (opts.steam) return simulateSteam(gridIds, chambers, data, opts);
  const cfg = data.config;
  const width = cfg.baseColumns + chambers;

  const grid = Array(54).fill(null);
  for (let y = 0; y < cfg.rows; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * 9 + x;
      const def = data.components[gridIds[idx]];
      if (def) grid[idx] = makeSlot(gridIds[idx], def);
    }
  }

  const sim = {
    cfg,
    data,
    grid,
    width,
    hull: 0,
    maxHeat: cfg.baseMaxHeat,
    hem: 1,
    output: 0,
    powered: true,
    tick: 0,
    exploded: false,
    explosionPower: 0,
    fireTicks: 0,
    rodsDepleted: 0,
    destroyed: 0,
    events: [],
    slotPeaks: Array(54).fill(0),
  };

  const hullSeries = [];
  const euSeries = [];
  const snapshots = [takeSnapshot(sim)];
  let snapStride = 1;

  let totalEU = 0;
  let maxEU = 0;
  let maxHull = 0;
  let cooldown = 0;
  let fuelGoneTicks = 0;
  let lastState = "";

  while (sim.tick < cfg.maxSimSeconds) {
    sim.tick++;
    doTick(sim);

    const eu = emittedEU(sim);
    totalEU += eu * 20;
    if (eu > maxEU) maxEU = eu;
    if (sim.hull > maxHull) maxHull = sim.hull;
    hullSeries.push(sim.hull);
    euSeries.push(eu);

    if (sim.tick % snapStride === 0 || sim.exploded) {
      snapshots.push(takeSnapshot(sim));
      if (snapshots.length > MAX_SNAPSHOTS) {
        // Grid history got long - drop every other frame and halve the rate
        const thinned = snapshots.filter((s, i) => i % 2 === 0 || i === snapshots.length - 1);
        snapshots.length = 0;
        snapshots.push(...thinned);
        snapStride *= 2;
      }
    }

    if (sim.exploded) break;

    // Once the fuel is gone, keep ticking until heat stops moving (vents may
    // still be draining the hull), then stop. Exchangers can slosh heat back
    // and forth forever, so there is a hard cap too.
    if (!hasFuel(sim)) {
      fuelGoneTicks++;
      const state = stateKey(sim);
      cooldown = state === lastState ? cooldown + 1 : 0;
      lastState = state;
      if (cooldown >= 3 || fuelGoneTicks > cfg.cooldownTicksMax) break;
    }
  }

  if (snapshots[snapshots.length - 1].t !== sim.tick) snapshots.push(takeSnapshot(sim));

  const activeTicks = euSeries.filter((e) => e > 0).length;

  return {
    seconds: sim.tick,
    exploded: sim.exploded,
    explosionPower: sim.explosionPower,
    hullSeries,
    euSeries,
    snapshots,
    totalEU,
    maxEU,
    avgEU: activeTicks > 0 ? Math.round(euSeries.reduce((a, b) => a + b, 0) / activeTicks) : 0,
    maxHull,
    maxHeatFinal: sim.maxHeat,
    fireTicks: sim.fireTicks,
    rodsDepleted: sim.rodsDepleted,
    destroyed: sim.destroyed,
    residualHull: sim.exploded ? 0 : sim.hull,
    events: sim.events,
    slotPeaks: sim.slotPeaks,
  };
}

function makeSlot(id, def) {
  const slot = { id, def, heat: 0, damage: 0, progress: 0, stack: 1, product: false };
  if (def.type === "depleted") slot.progress = def.durability - 1;
  if (def.type === "inactiveFuel") slot.progress = def.durability - 1;
  return slot;
}

function doTick(sim) {
  sim.output = 0;
  sim.maxHeat = sim.cfg.baseMaxHeat;
  sim.hem = 1;

  // Two passes per reactor tick: heat run, then EU run. Row-major, always.
  for (let pass = 0; pass < 2; pass++) {
    const heatRun = pass === 0;
    for (let y = 0; y < sim.cfg.rows; y++) {
      for (let x = 0; x < sim.width; x++) {
        const idx = y * 9 + x;
        const slot = sim.grid[idx];
        if (!slot || slot.product) continue;
        processChamber(sim, slot, idx, x, y, heatRun);
      }
    }
  }

  heatEffects(sim);
}

function processChamber(sim, slot, idx, x, y, heatRun) {
  const type = slot.def.type;
  if (type === "fuel") processRod(sim, slot, idx, x, y, heatRun);
  else if (type === "vent") processVent(sim, slot, idx, heatRun);
  else if (type === "exchanger") processExchanger(sim, slot, idx, x, y);
  else if (type === "ventSpread") processVentSpread(sim, slot, x, y, heatRun);
  else if (type === "plating" && heatRun) {
    sim.maxHeat += slot.def.maxHeatBonus;
    sim.hem = Math.fround(sim.hem * slot.def.hemModifier);
  } else if (type === "heatingCell") {
    if (sim.hull < 1000 * slot.stack) sim.hull += slot.stack;
  }
  // coolant, condensators, reflectors, isotope cells are passive - they only
  // react to alterHeat / pulses from the components above
}

function processRod(sim, slot, idx, x, y, heatRun) {
  if (!sim.powered) return;
  const def = slot.def;
  const area = def.pulseArea === "all8" ? OFFSETS8 : OFFSETS4;
  const basePulses = (1 + ((def.rods / 2) | 0)) * def.pulsesPerTick;

  for (let sub = 0; sub < def.rods; sub++) {
    if (heatRun) {
      let pulses = basePulses;
      for (let p = 0; p < def.pulsesPerTick; p++) {
        for (const [dx, dy] of area) {
          const n = slotIndex(sim, x + dx, y + dy);
          if (n < 0) continue;
          const ns = sim.grid[n];
          if (!ns || ns.product) continue;
          if (acceptPulse(sim, n, true)) pulses += def.pulsesForConnection;
        }
      }

      // Java: (int)((float)(sumUp(pulses) * 4) * heatModifier)
      let heat = Math.trunc(Math.fround(sumUp(pulses) * 4 * def.heatModifier));

      const acceptors = [];
      for (const [dx, dy] of area) {
        const n = slotIndex(sim, x + dx, y + dy);
        if (n >= 0 && canStoreHeat(sim.grid[n])) acceptors.push(n);
      }
      while (acceptors.length && heat > 0) {
        const share = (heat / acceptors.length) | 0;
        heat -= share;
        heat += alterHeat(sim, acceptors.shift(), share);
      }
      if (heat > 0) sim.hull += heat;
    } else {
      sim.output += basePulses * def.euPerPulse;
      for (let p = 0; p < def.pulsesPerTick; p++) {
        for (const [dx, dy] of area) {
          const n = slotIndex(sim, x + dx, y + dy);
          if (n < 0) continue;
          const ns = sim.grid[n];
          if (!ns || ns.product) continue;
          acceptPulse(sim, n, false);
        }
      }
    }
  }

  // Depletion check runs on both passes, production first - a rod gets its
  // full final second of output, then vanishes at the end of the EU pass.
  if (slot.damage + 1 > def.durability) {
    toProduct(sim, idx, def.depletedProduct);
    sim.rodsDepleted++;
    pushEvent(sim, `${def.name} depleted at ${pos(idx)}`);
  } else if (heatRun) {
    slot.damage += 1;
  }
}

// Pulse a component (fuel neighbor bonus / reflector / isotope breeding).
// Returns true if the target "accepts" the pulse, which grants the pulsing
// rod +pulsesForConnection on its heat run.
function acceptPulse(sim, idx, heatRun) {
  const slot = sim.grid[idx];
  const def = slot.def;

  if (def.type === "fuel") {
    // Steam reactors: acceptUraniumPulse short-circuits before addOutput,
    // so rods pulse each other for heat but never generate output.
    if (!heatRun && !sim.steamMode) sim.output += def.euPerPulse;
    return true;
  }
  if (def.type === "depleted") {
    slot.progress -= 1 + ((sim.hull / 3000) | 0);
    if (slot.progress <= 0) {
      toProduct(sim, idx, def.becomes);
      pushEvent(sim, `${def.name} re-enriched at ${pos(idx)}`);
    }
    return true;
  }
  if (def.type === "inactiveFuel") {
    slot.progress -= 1 + ((sim.hull / 1000) | 0);
    if (slot.progress <= 0) {
      toProduct(sim, idx, def.becomes);
      pushEvent(sim, `Inactive Fuel Cell finished at ${pos(idx)}`);
    }
    return true;
  }
  if (def.type === "reflector") {
    if (heatRun) {
      if (slot.damage + 1 > def.durability) {
        if (def.iridium) return false;
        destroy(sim, idx, `${def.name} wore out at ${pos(idx)}`);
        return true;
      }
      slot.damage += 1;
      return true;
    }
    if (def.iridium && slot.damage + 1 > def.durability) return false;
    sim.output += 1;
    return true;
  }
  return false;
}

function processVent(sim, slot, idx, heatRun) {
  if (!heatRun) return;
  const def = slot.def;
  let draw = def.hullDraw;
  if (def.electric) draw = sim.powered ? def.hullDraw : (def.hullDraw / 2) | 0;

  if (draw > 0) {
    const drawn = Math.min(sim.hull, draw);
    alterHeat(sim, idx, drawn);
    sim.hull -= drawn;
    if (!sim.grid[idx]) return; // popped from the heat it just drank
  }

  if (def.electric) {
    if (sim.powered) {
      sim.output -= def.selfVent * 0.005;
      alterHeat(sim, idx, -def.selfVent);
    } else {
      alterHeat(sim, idx, -((def.selfVent / 2) | 0));
    }
  } else {
    alterHeat(sim, idx, -def.selfVent);
  }
}

// Exchangers ignore the heat-run flag entirely, so they balance TWICE per
// reactor tick. Condensators lie to them (getCurrentHeat = 0) - also faithful.
function processExchanger(sim, slot, idx, x, y) {
  const def = slot.def;
  let med = slot.heat / def.capacity;
  let count = 1;
  if (def.hullExchange > 0) {
    count++;
    med += sim.hull / sim.maxHeat;
  }

  const targets = [];
  if (def.componentExchange > 0) {
    for (const [dx, dy] of OFFSETS4) {
      const n = slotIndex(sim, x + dx, y + dy);
      if (n < 0 || !canStoreHeat(sim.grid[n])) continue;
      targets.push(n);
      const max = sim.grid[n].def.capacity;
      if (max > 0) med += currentHeat(sim.grid[n]) / max;
    }
  }
  med /= count + targets.length;

  let acc = 0;
  for (const n of targets) {
    const ns = sim.grid[n];
    let want = Math.trunc(med * ns.def.capacity - currentHeat(ns));
    if (want > def.componentExchange) want = def.componentExchange;
    if (want < -def.componentExchange) want = -def.componentExchange;
    acc -= want;
    acc += alterHeat(sim, n, want);
  }
  if (def.hullExchange > 0) {
    let want = Math.trunc(med * sim.maxHeat - sim.hull);
    if (want > def.hullExchange) want = def.hullExchange;
    if (want < -def.hullExchange) want = -def.hullExchange;
    acc -= want;
    sim.hull += want;
  }
  alterHeat(sim, idx, acc);
}

function processVentSpread(sim, slot, x, y, heatRun) {
  if (!heatRun) return;
  for (const [dx, dy] of OFFSETS4) {
    const n = slotIndex(sim, x + dx, y + dy);
    if (n >= 0 && canStoreHeat(sim.grid[n])) alterHeat(sim, n, -slot.def.cooling);
  }
}

// The one shared heat-storage routine (coolant cells, vents, exchangers) plus
// the condensator special case. Faithful quirks: overflow destroys the item
// and refunds "max - cur + 1" (<= 0) to the caller; condensators can go
// NEGATIVE from component-vent cooling and are never destroyed.
function alterHeat(sim, idx, delta) {
  const slot = sim.grid[idx];
  const def = slot.def;

  if (def.type === "condensator") {
    const room = def.capacity - slot.heat - 1;
    const take = Math.min(delta, room);
    slot.heat += take;
    if (slot.heat > sim.slotPeaks[idx]) sim.slotPeaks[idx] = slot.heat;
    return delta - take;
  }

  const cur = slot.heat + delta;
  if (cur > def.capacity) {
    destroy(sim, idx, `${def.name} overheated at ${pos(idx)}`);
    return def.capacity - cur + 1;
  }
  if (cur < 0) {
    slot.heat = 0;
    return cur;
  }
  slot.heat = cur;
  if (cur > sim.slotPeaks[idx]) sim.slotPeaks[idx] = cur;
  return 0;
}

function canStoreHeat(slot) {
  if (!slot || slot.product) return false;
  const type = slot.def.type;
  if (type === "coolant" || type === "vent" || type === "exchanger") return true;
  if (type === "condensator") return slot.heat + 1 < slot.def.capacity;
  return false;
}

function currentHeat(slot) {
  return slot.def.type === "condensator" ? 0 : slot.heat;
}

function heatEffects(sim) {
  if (sim.hull < 4000) return;
  const p = sim.hull / sim.maxHeat;
  if (p >= 1) {
    explode(sim);
    return;
  }
  // >= 85%: in-game this starts fires around the reactor (0.2 * hem chance/s)
  if (p >= 0.85) sim.fireTicks++;
}

function explode(sim) {
  let power = sim.cfg.baseExplosionPower;
  let mod = 1;
  for (let y = 0; y < sim.cfg.rows; y++) {
    for (let x = 0; x < sim.width; x++) {
      const slot = sim.grid[y * 9 + x];
      if (!slot || slot.product) continue;
      const def = slot.def;
      let f = 0;
      if (def.type === "fuel") f = def.explosionModifier * def.rods;
      else if (def.type === "reflector") f = -1;
      else if (def.type === "heatingCell") f = (slot.stack / 10) | 0;
      else if (def.type === "plating") f = def.hemModifier;
      if (f > 0 && f < 1) mod *= f;
      else power += f;
    }
  }
  power = power * sim.hem * mod;
  sim.explosionPower = Math.min(power, sim.cfg.explosionPowerMax);
  sim.exploded = true;
  pushEvent(sim, `MELTDOWN - explosion power ${sim.explosionPower.toFixed(1)} (TNT is 4)`);
}

function emittedEU(sim) {
  const eu = Math.trunc(sim.output * sim.cfg.euPerOutputUnit);
  return eu >= 1 ? eu : 0;
}

function slotIndex(sim, x, y) {
  if (x < 0 || x >= sim.width || y < 0 || y >= sim.cfg.rows) return -1;
  return y * 9 + x;
}

function sumUp(n) {
  return (n * (n + 1)) / 2;
}

function pos(idx) {
  return `(${(idx % 9) + 1}, ${((idx / 9) | 0) + 1})`;
}

function destroy(sim, idx, text) {
  sim.grid[idx] = null;
  sim.destroyed++;
  pushEvent(sim, text);
}

function toProduct(sim, idx, productId) {
  const product = sim.data.products[productId];
  sim.grid[idx] = product
    ? { id: productId, def: product, heat: 0, damage: 0, progress: 0, stack: 1, product: true }
    : null;
}

function pushEvent(sim, text) {
  if (sim.events.length < MAX_EVENTS) sim.events.push({ t: sim.tick, text });
}

function hasFuel(sim) {
  for (let y = 0; y < sim.cfg.rows; y++) {
    for (let x = 0; x < sim.width; x++) {
      const slot = sim.grid[y * 9 + x];
      if (slot && !slot.product && slot.def.type === "fuel") return true;
    }
  }
  return false;
}

function stateKey(sim) {
  let key = `${sim.hull}`;
  for (let i = 0; i < 54; i++) {
    const slot = sim.grid[i];
    if (slot && !slot.product && slot.heat > 0) key += `:${i},${slot.heat}`;
  }
  return key;
}

// ---------------------------------------------------------------------------
// STEAM REACTOR (TileEntityNuclearSteamReactor, getTickRate() = 1)
//
// The steam reactor runs its ENTIRE base update every game tick (20x/s):
// reset output/maxHeat/hem, two passes (heat then "EU") in row-major order,
// then hull heat effects (fire chance >= 85%, explosion >= 100%) - all 20x/s.
// Rods run their full pulse/heat logic every game tick (so heat generation
// and reflector wear are 20x the EU-reactor rate) but produce zero EU; rod
// damage +1 and the depletion check happen only once per 20 game ticks, so
// rod lifetime in SECONDS is unchanged. Exchangers still run both passes,
// which now means 40 invocations per second.
//
// Simulation assumptions (documented deviations / choices):
// - Water supply is infinite: the water tank is refilled to full at the
//   start of every game tick. `waterUsed` counts the mB actually drained
//   from the tank into vent buffers (includes the initial buffer fill).
// - The steam tank is drained by opts.steamDrain mB per game tick at the
//   start of the tick (default Infinity = always drained to 0). With a
//   finite drain the tank can back up, and per the jar bytecode a vent
//   whose steam batch does not fit skips the WHOLE batch: no water used,
//   no heat consumed, no steam.
// - tick20 (the once-per-second rod damage/depletion flag) fires on the
//   first game tick of each simulated second. In-game it is tied to
//   worldTime % 20 == 0, whose phase relative to insertion is arbitrary.
// - "powered" is assumed true, as in the EU sim.
// - heatFrac = stored / (itemMaxHeat - 100): gap-9's "/1000.0" is the
//   evaluated divisor for the 1100-capacity steam vents (1100-100 = 1000),
//   confirmed by its note that heatFrac can reach 1100/1000 = 1.1.
//
// Ejected before processing (dropUselessItems - not ISteamReactorComponent):
// heating cells, depleted isotope cells, inactive fuel cells. Electric vents
// stay but are inert heat sinks: canStoreHeat = true, 10k capacity, destroyed
// on overflow, never vent, never draw.
// ---------------------------------------------------------------------------

export function steamTankSizes(chambers) {
  return { water: 2000 + 1000 * chambers, steam: 20000 + 5000 * chambers };
}

// Flat offset arrays + scratch acceptor list: the steam loop runs 20x more
// ticks than the EU loop, so the hot rod path avoids per-tick allocations.
const OFF4X = [-1, 1, 0, 0];
const OFF4Y = [0, 0, -1, 1];
const OFF8X = [-1, 0, 1, -1, 1, -1, 0, 1];
const OFF8Y = [-1, -1, -1, 0, 0, 1, 1, 1];
const ACCEPTORS = new Int32Array(8);

function simulateSteam(gridIds, chambers, data, opts) {
  const cfg = data.config;
  const width = cfg.baseColumns + chambers;
  const steamDrain = opts.steamDrain ?? Infinity;
  const tanks = steamTankSizes(chambers);

  const sim = {
    cfg,
    data,
    grid: Array(54).fill(null),
    width,
    hull: 0,
    maxHeat: cfg.baseMaxHeat,
    hem: 1,
    output: 0,
    powered: true,
    tick: 0, // seconds (event timestamps)
    gt: 0, // game ticks
    steamMode: true,
    steamTank: 0,
    steamCap: tanks.steam,
    waterTank: tanks.water,
    waterUsed: 0,
    steamThisTick: 0,
    exploded: false,
    explosionPower: 0,
    fireTicks: 0,
    rodsDepleted: 0,
    destroyed: 0,
    events: [],
    slotPeaks: Array(54).fill(0),
  };

  for (let y = 0; y < cfg.rows; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * 9 + x;
      const def = data.components[gridIds[idx]];
      if (!def) continue;
      if (def.type === "heatingCell" || def.type === "depleted" || def.type === "inactiveFuel") {
        pushEvent(sim, `${def.name} ejected at ${pos(idx)} - not a steam reactor component`);
        continue;
      }
      const slot = makeSlot(gridIds[idx], def);
      if (def.steam) {
        slot.water = 0; // internal WaterBuffer, double mB (holds up to selfVent)
        slot.hs = 0; // HeatStorage accumulator for fractional heat removal
      }
      sim.grid[idx] = slot;
    }
  }

  const hullSeries = [];
  const steamSeries = [];
  const euSeries = [];
  const snapshots = [takeSnapshotSteam(sim, 0)];
  let snapStride = 1;

  let totalSteam = 0;
  let maxSteam = 0;
  let maxHull = 0;
  let cooldown = 0;
  let fuelGoneTicks = 0;
  let lastState = "";

  while (sim.tick < cfg.maxSimSeconds) {
    sim.tick++;
    let secondSteam = 0;
    let gts = 0;
    for (let i = 0; i < 20; i++) {
      sim.gt++;
      gts++;
      sim.steamTank -= Math.min(sim.steamTank, steamDrain);
      sim.waterTank = tanks.water; // infinite external water supply
      doGameTickSteam(sim);
      secondSteam += sim.steamThisTick;
      totalSteam += sim.steamThisTick;
      if (sim.hull > maxHull) maxHull = sim.hull;
      if (sim.exploded) break;
    }

    const rate = secondSteam / gts; // avg mB/t over this second
    hullSeries.push(sim.hull);
    steamSeries.push(rate);
    euSeries.push(0);
    if (rate > maxSteam) maxSteam = rate;

    if (sim.tick % snapStride === 0 || sim.exploded) {
      snapshots.push(takeSnapshotSteam(sim, rate));
      if (snapshots.length > MAX_SNAPSHOTS) {
        const thinned = snapshots.filter((s, i) => i % 2 === 0 || i === snapshots.length - 1);
        snapshots.length = 0;
        snapshots.push(...thinned);
        snapStride *= 2;
      }
    }

    if (sim.exploded) break;

    if (!hasFuel(sim)) {
      fuelGoneTicks++;
      const state = stateKey(sim);
      cooldown = state === lastState ? cooldown + 1 : 0;
      lastState = state;
      if (cooldown >= 3 || fuelGoneTicks > cfg.cooldownTicksMax) break;
    }
  }

  if (snapshots[snapshots.length - 1].t !== sim.tick) snapshots.push(takeSnapshotSteam(sim, steamSeries[steamSeries.length - 1] ?? 0));

  let steamSum = 0;
  let producing = 0;
  for (const s of steamSeries) {
    if (s > 0) {
      steamSum += s;
      producing++;
    }
  }

  return {
    seconds: sim.tick,
    gameTicks: sim.gt,
    exploded: sim.exploded,
    explosionPower: sim.explosionPower,
    hullSeries,
    euSeries, // kept as zeros so EU-oriented UI code keeps working
    steamSeries, // per second: avg steam mB/t over that second
    snapshots,
    totalEU: 0,
    maxEU: 0,
    avgEU: 0,
    totalSteam,
    maxSteam,
    avgSteam: producing > 0 ? Math.round(steamSum / producing) : 0,
    waterUsed: sim.waterUsed,
    waterTankSize: tanks.water,
    steamTankSize: tanks.steam,
    maxHull,
    maxHeatFinal: sim.maxHeat,
    fireTicks: sim.fireTicks, // game ticks spent >= 85% hull heat
    rodsDepleted: sim.rodsDepleted,
    destroyed: sim.destroyed,
    residualHull: sim.exploded ? 0 : sim.hull,
    events: sim.events,
    slotPeaks: sim.slotPeaks,
  };
}

function doGameTickSteam(sim) {
  sim.output = 0;
  sim.maxHeat = sim.cfg.baseMaxHeat;
  sim.hem = 1;
  sim.steamThisTick = 0;
  // Once-per-second flag: rod damage/depletion only. Set on pass 1 (EU pass).
  const tick20 = sim.gt % 20 === 1;

  for (let pass = 0; pass < 2; pass++) {
    const heatRun = pass === 0;
    for (let y = 0; y < sim.cfg.rows; y++) {
      for (let x = 0; x < sim.width; x++) {
        const idx = y * 9 + x;
        const slot = sim.grid[idx];
        if (!slot || slot.product) continue;
        const def = slot.def;
        const type = def.type;
        if (type === "fuel") {
          processRodSteam(sim, slot, idx, x, y, heatRun, tick20 && !heatRun);
        } else if (type === "vent") {
          if (def.electric) continue; // inert sink: absorbs via alterHeat only
          if (def.steam) {
            if (heatRun) processSteamVent(sim, slot, idx);
            else refillSteamVent(sim, slot);
          } else if (heatRun) {
            processVent(sim, slot, idx, heatRun); // EU logic, per game tick
          }
        } else if (type === "exchanger") {
          processExchanger(sim, slot, idx, x, y); // both passes = 40x/s
        } else if (type === "ventSpread") {
          processVentSpread(sim, slot, x, y, heatRun);
        } else if (type === "plating" && heatRun) {
          sim.maxHeat += def.maxHeatBonus;
          sim.hem = Math.fround(sim.hem * def.hemModifier);
        }
      }
    }
  }

  heatEffects(sim); // fire >= 85%, explode >= 100% - every game tick
}

// Same pulse/heat logic as the EU rod, run every game tick, but no output;
// damage/depletion only when doDamage (once per 20 game ticks, pass 1).
// Written with flat loops + a scratch acceptor array for speed.
function processRodSteam(sim, slot, idx, x, y, heatRun, doDamage) {
  if (!sim.powered) return;
  const def = slot.def;
  const all8 = def.pulseArea === "all8";
  const offX = all8 ? OFF8X : OFF4X;
  const offY = all8 ? OFF8Y : OFF4Y;
  const len = offX.length;
  const basePulses = (1 + ((def.rods / 2) | 0)) * def.pulsesPerTick;

  for (let sub = 0; sub < def.rods; sub++) {
    if (heatRun) {
      let pulses = basePulses;
      for (let p = 0; p < def.pulsesPerTick; p++) {
        for (let o = 0; o < len; o++) {
          const n = slotIndex(sim, x + offX[o], y + offY[o]);
          if (n < 0) continue;
          const ns = sim.grid[n];
          if (!ns || ns.product) continue;
          if (acceptPulse(sim, n, true)) pulses += def.pulsesForConnection;
        }
      }

      let heat = Math.trunc(Math.fround(sumUp(pulses) * 4 * def.heatModifier));

      let count = 0;
      for (let o = 0; o < len; o++) {
        const n = slotIndex(sim, x + offX[o], y + offY[o]);
        if (n >= 0 && canStoreHeat(sim.grid[n])) ACCEPTORS[count++] = n;
      }
      let head = 0;
      while (head < count && heat > 0) {
        const share = (heat / (count - head)) | 0;
        heat -= share;
        heat += alterHeat(sim, ACCEPTORS[head++], share);
      }
      if (heat > 0) sim.hull += heat;
    } else {
      // "EU" pass: pings only (reflector wear-free output ping, etc.).
      // acceptPulse adds no output for fuel in steam mode.
      for (let p = 0; p < def.pulsesPerTick; p++) {
        for (let o = 0; o < len; o++) {
          const n = slotIndex(sim, x + offX[o], y + offY[o]);
          if (n < 0) continue;
          const ns = sim.grid[n];
          if (!ns || ns.product) continue;
          acceptPulse(sim, n, false);
        }
      }
    }
  }

  if (doDamage) {
    if (slot.damage + 1 > def.durability) {
      toProduct(sim, idx, def.depletedProduct);
      sim.rodsDepleted++;
      pushEvent(sim, `${def.name} depleted at ${pos(idx)}`);
    } else {
      slot.damage += 1;
    }
  }
}

// Steam vent heat pass (ItemHeatVentBase.processTick, type 1), per game tick.
// Doubles and (int) casts follow the gap-9 bytecode exactly.
function processSteamVent(sim, slot, idx) {
  const def = slot.def;

  // 1. Hull draw. The hull loses the heat even if the vent pops from it.
  if (def.hullDraw > 0) {
    const take = Math.min(sim.hull, def.hullDraw);
    alterHeat(sim, idx, take);
    sim.hull -= take;
    if (!sim.grid[idx]) return;
  }

  // 2./3. Below 100 stored heat or dry buffer: cool 1 every 40 game ticks.
  if (slot.heat < 100 || slot.water <= 0) {
    if (sim.gt % 40 === 0) alterHeat(sim, idx, -1);
    return;
  }

  // 5. configMod (energyGeneratorSteamReactor) = 1.0 in this instance.
  const heatFrac = slot.heat / (def.capacity - 100);
  let use = (def.selfVent * heatFrac) / 40;
  if (slot.water < use) use = slot.water;
  if (use <= 0) return;

  // 6. Whole batch skipped if the steam does not fit in the tank.
  const steam = Math.trunc(160 * use);
  if (steam <= 0) return;
  if (sim.steamCap - sim.steamTank < steam) return;

  // 7./8. Produce steam, consume water, remove heat via the double accumulator.
  sim.steamTank += steam;
  sim.steamThisTick += steam;
  sim.output += steam / 1.6 / 2; // GUI stat only in the real mod
  slot.water -= use;
  slot.hs += use * 40;
  const t = -Math.trunc(slot.hs);
  const r = alterHeat(sim, idx, t);
  slot.hs += t - r;
}

// Steam vent pass-1 refill: top the internal buffer up to selfVent mB from
// the water tank, but only once the buffer has dropped to selfVent-1 or less.
function refillSteamVent(sim, slot) {
  const def = slot.def;
  if (slot.water > def.selfVent - 1) return;
  const drain = Math.min(sim.waterTank, Math.trunc(def.selfVent - slot.water));
  if (drain <= 0) return;
  slot.water += drain;
  sim.waterTank -= drain;
  sim.waterUsed += drain;
}

function takeSnapshotSteam(sim, rate) {
  const snap = takeSnapshot(sim);
  snap.eu = 0;
  snap.steam = rate;
  return snap;
}

function takeSnapshot(sim) {
  const slots = Array(54).fill(null);
  for (let i = 0; i < 54; i++) {
    const slot = sim.grid[i];
    if (!slot) continue;
    slots[i] = { id: slot.id, heat: slot.heat, damage: slot.damage, progress: slot.progress, product: slot.product };
  }
  return { t: sim.tick, hull: sim.hull, maxHeat: sim.maxHeat, eu: emittedEU(sim), slots };
}
