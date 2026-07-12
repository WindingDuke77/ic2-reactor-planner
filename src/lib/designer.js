// Auto-designer: give it a fuel cell and a count, it builds a reactor around
// them and proves the layout by running the real simulator on it. Every kit
// and reflector variant at the smallest reactor size that fits gets scored
// against the chosen goal (EU/t, total EU, EU per cell) and the winner comes
// back - not just the first thing that didn't explode.
//
// The workhorse combo: a cell ringed by Overclocked Heat Vents (20/s each)
// with Component Heat Vents webbed around them (+4/s per touch) covers the
// 24/s per-side output of a quad cell exactly.

import { simulate } from "@/lib/simulator";

const KITS = [
  { name: "basic vents", neighbor: "heat_vent", web: false, filler: null, maxCool: 6 },
  { name: "advanced vents", neighbor: "advanced_heat_vent", web: false, filler: "heat_vent", maxCool: 12 },
  { name: "overclocked vents + component vent web", neighbor: "overclocked_heat_vent", web: true, filler: "reactor_heat_vent", maxCool: 28 },
  { name: "exchangers + overclocked vent web", neighbor: "advanced_heat_exchanger", web: true, filler: "overclocked_heat_vent", maxCool: 999 },
];

const GOALS = { eu: "most EU/t", total: "most total EU", efficiency: "best efficiency" };

export function design(fuelId, count, mode, data, goal = "eu", armored = false) {
  const fuel = data.components[fuelId];
  if (!fuel || fuel.type !== "fuel" || count < 1) return null;

  // Per-vent load if the cell dumps its heat over 4 sides - lets us skip
  // kits that could never keep up instead of simulating them
  const share = Math.ceil((cellHeat(fuel) * (mode === "paired" ? 3 : 1)) / 4);
  const kits = KITS.filter((kit, i) => kit.maxCool >= share || i === KITS.length - 1);

  let bestFail = null;

  for (let chambers = 0; chambers <= data.config.maxChambers; chambers++) {
    const width = data.config.baseColumns + chambers;
    const positions = placeCells(count, width, mode, fuel.pulseArea === "all8");
    if (!positions) continue;

    // Score every kit x reflector variant at this size. The smallest reactor
    // with any stable design wins; best-by-goal among the survivors.
    let best = null;
    const reflector = reflectorFor(fuel, data);
    for (const kit of kits) {
      const base = buildLayout(positions, fuelId, kit, width);
      for (const v of reflectorVariants(base, positions, kit, width, reflector)) {
        const sim = simulate(v.grid, chambers, data);
        const candidate = { grid: v.grid, chambers, sim, kit: v.label, stable: isStable(sim), goal };
        if (!candidate.stable) {
          if (!bestFail || score(sim) > score(bestFail.sim)) bestFail = candidate;
        } else if (!best || goalScore(sim, goal, count) > goalScore(best.sim, goal, count)) {
          best = candidate;
        }
      }
    }
    if (best) return armored ? armor(best, data) : best;
  }

  return bestFail; // nothing survived - hand back the least bad attempt, flagged
}

// Belt-and-braces mode: pack every leftover slot with Containment Reactor
// Plating. Each plate multiplies a hypothetical blast by 0.9 and adds hull
// headroom, so even sabotage barely dents the floor.
function armor(candidate, data) {
  const width = data.config.baseColumns + candidate.chambers;
  const grid = [...candidate.grid];
  let filled = false;
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * 9 + x;
      if (!grid[idx]) {
        grid[idx] = "containment_reactor_plating";
        filled = true;
      }
    }
  }
  if (!filled) return candidate;
  const sim = simulate(grid, candidate.chambers, data);
  if (!isStable(sim)) return candidate;
  return { ...candidate, grid, sim, kit: `${candidate.kit} + containment plating` };
}

export function describe(result, fuelId, count, data) {
  if (!result) return "Could not fit that many cells in a reactor. Fewer cells, chief.";
  const fuel = data.components[fuelId];
  const verdict = result.stable
    ? `Stable for a full ${fuel.durability}s cycle.`
    : result.sim.exploded
      ? `UNSTABLE - best attempt still melts down at ${result.sim.seconds}s. Reduce cells or babysit it.`
      : "UNSTABLE - components burn out during the cycle. Treat as disposable.";
  const tuned = GOALS[result.goal] ? ` Tuned for ${GOALS[result.goal]}.` : "";
  return `${count}x ${fuel.name}, ${result.chambers} chamber${result.chambers === 1 ? "" : "s"}, cooling: ${result.kit}.${tuned} ${verdict} ~${result.sim.avgEU} EU/t, ${fmtEU(result.sim.totalEU)} total.`;
}

// One hill-climbing round on the player's CURRENT grid: a bounded set of
// single-slot swaps, each proven by the simulator, best one wins. If the grid
// is already unstable the goal switches to survival - later meltdown, cooler
// hull or fewer dead parts all count as progress.
export function improve(grid, chambers, goal, data) {
  const width = data.config.baseColumns + chambers;
  const base = simulate(grid, chambers, data);
  const startStable = isStable(base);

  const cells = fuelCells(grid, width, data);
  if (!cells.length) {
    return { grid, chambers, sim: base, note: "No fuel in the reactor - nothing to iterate on. Drop some cells in first.", changed: false };
  }

  let best = null;
  for (const m of collectMutations(grid, width, base, data)) {
    const next = [...grid];
    next[m.idx] = m.id;
    const sim = simulate(next, chambers, data);
    let gain;
    if (startStable) {
      // Stable stays stable - a hotter reactor that pops parts is not a win
      if (!isStable(sim)) continue;
      gain = goalScore(sim, goal, cells.length) - goalScore(base, goal, cells.length);
    } else {
      gain = (isStable(sim) ? 1e12 : 0) + score(sim) - score(base);
    }
    if (gain <= 0) continue;
    if (!best || gain > best.gain) best = { grid: next, sim, note: m.note, gain };
  }

  if (!best) {
    const note = startStable
      ? `Already dialed in for ${GOALS[goal] || goal} - no single swap beats it.`
      : "No single swap saves this one. Time for a redesign (or a bucket).";
    return { grid, chambers, sim: base, note, changed: false };
  }

  return { grid: best.grid, chambers, sim: best.sim, note: `${best.note}: ${improvement(goal, base, best.sim)}`, changed: true };
}

// One-click builds. Each runs through design() so the result is still proven
// by the simulator before it touches the grid.
export const PRESETS = [
  { name: "Peasant's First Pile", fuelId: "uranium_cell", count: 6, mode: "spread", goal: "eu" },
  { name: "Dual-Core Workhorse", fuelId: "uranium_dual_cell", count: 4, mode: "spread", goal: "eu" },
  { name: "Quad-Cell Quarry Feeder", fuelId: "uranium_quad_cell", count: 4, mode: "spread", goal: "eu" },
  { name: "Redstone Penny-Pincher", fuelId: "redstone_uranium_cell", count: 6, mode: "spread", goal: "efficiency" },
  { name: "Cuddle Puddle (paired)", fuelId: "uranium_cell", count: 8, mode: "paired", goal: "eu" },
  { name: "NetherStar Abomination", fuelId: "netherstar_uranium_quad_cell", count: 6, mode: "spread", goal: "total" },
  { name: "Creeper-Proof Bunker", fuelId: "uranium_cell", count: 4, mode: "spread", goal: "eu", armored: true },
];

// Cell placement. "spread" tries three passes, best first: "isolated" keeps
// cells off the walls (a wall cell dumps its heat over 3 vents instead of 4)
// and at manhattan >= 4 so no two ring vents ever touch and every one gets
// its own component-vent web. "strict" allows walls but no shared vent slots
// (manhattan >= 3, chebyshev >= 2), "relaxed" is plain non-adjacency.
// "paired" places touching pairs for the neighbor-pulse EU bonus instead.
function placeCells(count, width, mode, diagonalsMatter) {
  const candidates = [];
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < width; x++) candidates.push([x, y]);
  }
  // Interior slots first - a cell against the wall wastes vent sides
  candidates.sort((a, b) => centrality(b, width) - centrality(a, width));

  if (mode === "paired") {
    const picked = [];
    for (const [x, y] of candidates) {
      if (x + 1 >= width) continue;
      const pair = [[x, y], [x + 1, y]];
      const clear = picked.every((p) => pair.every((c) => dist(p, c) >= 3 && cheb(p, c) >= 2));
      if (clear) picked.push(...pair);
      if (picked.length >= count) return picked.slice(0, count);
    }
    return null;
  }

  for (const pass of ["isolated", "strict", "relaxed"]) {
    const picked = [];
    for (const c of candidates) {
      if (pass === "isolated" && !interior(c, width)) continue;
      const ok = pass === "relaxed"
        ? picked.every((p) => (diagonalsMatter ? cheb(p, c) >= 2 : dist(p, c) >= 2))
        : pass === "strict"
          ? picked.every((p) => dist(p, c) >= 3 && cheb(p, c) >= 2)
          : picked.every((p) => dist(p, c) >= 4);
      if (ok) picked.push(c);
      if (picked.length >= count) return picked;
    }
  }
  return null;
}

function interior([x, y], width) {
  return x > 0 && x < width - 1 && y > 0 && y < 5;
}

function buildLayout(positions, fuelId, kit, width) {
  const grid = Array(54).fill(null);
  for (const [x, y] of positions) grid[y * 9 + x] = fuelId;

  // Ring every cell with the kit's heat acceptor
  for (const [x, y] of positions) {
    for (const [dx, dy] of ORTHO) {
      const idx = at(x + dx, y + dy, width);
      if (idx >= 0 && !grid[idx]) grid[idx] = kit.neighbor;
    }
  }

  // Fill the rest: component vents wherever they can boost a heat holder,
  // the kit's filler everywhere else. Row-major, so fillers placed earlier
  // can earn component vents later.
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * 9 + x;
      if (grid[idx]) continue;
      if (kit.web && touchesHeatHolder(grid, x, y, width)) grid[idx] = "component_heat_vent";
      else if (kit.filler) grid[idx] = kit.filler;
    }
  }

  return grid;
}

// Reflector variants: 0, 1 or 2 ring vents per cell traded for reflectors.
// Reflected pulses mean more EU but also more heat, so every variant goes
// through the simulator before it can win.
function reflectorVariants(base, positions, kit, width, reflector) {
  const variants = [{ grid: base, label: kit.name }];
  for (const perCell of [1, 2]) {
    const grid = [...base];
    let swapped = 0;
    for (const [x, y] of positions) {
      let left = perCell;
      for (const [dx, dy] of ORTHO) {
        if (!left) break;
        const idx = at(x + dx, y + dy, width);
        if (idx >= 0 && grid[idx] === kit.neighbor) {
          grid[idx] = reflector;
          left--;
          swapped++;
        }
      }
    }
    if (swapped < positions.length * perCell) break; // ran out of ring vents
    variants.push({ grid, label: `${kit.name} + ${perCell === 2 ? "double " : ""}reflectors` });
  }
  return variants;
}

// Cheapest reflector that outlives one fuel cycle. A rod hits its neighbor
// rods x pulsesPerTick times a second, and a worn-out reflector counts as a
// destroyed part, so undersized ones disqualify the whole design.
function reflectorFor(fuel, data) {
  const wear = fuel.durability * fuel.rods * fuel.pulsesPerTick;
  for (const id of ["neutron_reflector", "thick_neutron_reflector"]) {
    if (wear <= data.components[id].durability) return id;
  }
  return "iridium_neutron_reflector"; // never breaks, just stops reflecting
}

const CAP = 40; // hard cap on candidate sims per improve() round
const VENT_UPGRADE = { heat_vent: "advanced_heat_vent", advanced_heat_vent: "overclocked_heat_vent" };

function collectMutations(grid, width, base, data) {
  const out = [];
  const seen = new Set();
  const add = (idx, id, note) => {
    const key = `${idx}:${id}`;
    if (idx < 0 || grid[idx] === id || seen.has(key) || out.length >= CAP) return;
    seen.add(key);
    out.push({ idx, id, note });
  };
  const defAt = (idx) => (grid[idx] ? data.components[grid[idx]] : null);

  // Reflectors on fuel sides - more pulses, more EU, the sim referees the heat
  for (const [x, y] of fuelCells(grid, width, data)) {
    const reflector = reflectorFor(data.components[grid[y * 9 + x]], data);
    const rName = data.components[reflector].name;
    for (const [dx, dy] of ORTHO) {
      const n = at(x + dx, y + dy, width);
      if (n < 0) continue;
      const def = defAt(n);
      if (!def) add(n, reflector, `Added a ${rName} at ${spot(n)}`);
      else if (def.type === "vent" || def.type === "ventSpread") add(n, reflector, `Swapped a ${def.name} for a ${rName} at ${spot(n)}`);
    }
  }

  // Vent tier upgrades
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * 9 + x;
      const up = VENT_UPGRADE[grid[idx]];
      if (up) add(idx, up, `Upgraded ${defAt(idx).name} to ${data.components[up].name} at ${spot(idx)}`);
    }
  }

  // Empty slots: component vents where they can boost a heat holder, plain
  // hull-draw vents elsewhere
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * 9 + x;
      if (grid[idx]) continue;
      if (touchesHeatHolder(grid, x, y, width)) add(idx, "component_heat_vent", `Filled ${spot(idx)} with a Component Heat Vent`);
      else add(idx, "reactor_heat_vent", `Filled ${spot(idx)} with a Reactor Heat Vent`);
    }
  }

  // Hull ran warm: trade an idle vent (never held heat, not feeding a cell)
  // for plating to raise the meltdown ceiling
  if (base.maxHull >= 1000) {
    let swaps = 0;
    for (let y = 0; y < 6 && swaps < 4; y++) {
      for (let x = 0; x < width && swaps < 4; x++) {
        const idx = y * 9 + x;
        const def = defAt(idx);
        if (!def || def.type !== "vent") continue;
        if (base.slotPeaks[idx] > 0 || nextToFuel(grid, x, y, width, data)) continue;
        add(idx, "reactor_plating", `Swapped an idle ${def.name} for Reactor Plating at ${spot(idx)}`);
        swaps++;
      }
    }
  }

  return out;
}

// One-line summary of what a winning mutation bought us
function improvement(goal, before, after) {
  if (isStable(after) && !isStable(before)) return "now survives the full cycle";
  if (!isStable(after)) {
    if (after.seconds > before.seconds) return `meltdown pushed back to ${after.seconds}s`;
    if (after.maxHull < before.maxHull) return `hull peak down ${before.maxHull - after.maxHull}`;
    return `${before.destroyed - after.destroyed} fewer parts lost`;
  }
  if (goal === "total") return `+${fmtEU(after.totalEU - before.totalEU)}`;
  return `+${after.avgEU - before.avgEU} EU/t`;
}

const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const HOLDERS = new Set(["heat_vent", "reactor_heat_vent", "overclocked_heat_vent", "advanced_heat_vent", "advanced_heat_exchanger", "heat_exchanger", "component_heat_exchanger"]);

function at(x, y, width) {
  if (x < 0 || x >= width || y < 0 || y >= 6) return -1;
  return y * 9 + x;
}

function touchesHeatHolder(grid, x, y, width) {
  for (const [dx, dy] of ORTHO) {
    const idx = at(x + dx, y + dy, width);
    if (idx >= 0 && HOLDERS.has(grid[idx])) return true;
  }
  return false;
}

function fuelCells(grid, width, data) {
  const cells = [];
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < width; x++) {
      const def = grid[y * 9 + x] ? data.components[grid[y * 9 + x]] : null;
      if (def && def.type === "fuel") cells.push([x, y]);
    }
  }
  return cells;
}

function nextToFuel(grid, x, y, width, data) {
  for (const [dx, dy] of ORTHO) {
    const idx = at(x + dx, y + dy, width);
    if (idx < 0 || !grid[idx]) continue;
    const def = data.components[grid[idx]];
    if (def && def.type === "fuel") return true;
  }
  return false;
}

function centrality([x, y], width) {
  return Math.min(x, width - 1 - x) * 2 + Math.min(y, 5 - y);
}

// Heat/s of a lone cell (same math as the simulator's heat run)
function cellHeat(fuel) {
  const basePulses = (1 + ((fuel.rods / 2) | 0)) * fuel.pulsesPerTick;
  return fuel.rods * Math.trunc(Math.fround(((basePulses * (basePulses + 1)) / 2) * 4 * fuel.heatModifier));
}

function dist([ax, ay], [bx, by]) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function cheb([ax, ay], [bx, by]) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function isStable(sim) {
  return !sim.exploded && sim.destroyed === 0 && sim.maxHull < 4000;
}

// What "better" means for each goal. Efficiency divides by cell count, so it
// only ranks differently from eu when fuel loads differ.
function goalScore(sim, goal, cells) {
  if (goal === "total") return sim.totalEU;
  if (goal === "efficiency") return sim.avgEU / Math.max(1, cells);
  return sim.avgEU;
}

// Ranking for failed attempts: surviving longer beats everything, then
// cooler hulls, then fewer dead components
function score(sim) {
  return sim.seconds * 1000000 - sim.maxHull * 10 - sim.destroyed;
}

function spot(idx) {
  return `(${(idx % 9) + 1}, ${((idx / 9) | 0) + 1})`;
}

function fmtEU(n) {
  if (n >= 1000000000) return `${(n / 1000000000).toFixed(1)}B EU`;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M EU`;
  if (n >= 1000) return `${Math.round(n / 1000)}k EU`;
  return `${n} EU`;
}
