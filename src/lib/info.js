// Tooltip stat lines, derived straight from components.json so edits to the
// JSON show up in the UI without touching code.

export function statLines(def, cfg) {
  if (def.type === "fuel") {
    const basePulses = (1 + ((def.rods / 2) | 0)) * def.pulsesPerTick;
    const eu = Math.trunc(def.rods * basePulses * def.euPerPulse * cfg.euPerOutputUnit);
    const heat = def.rods * Math.trunc(Math.fround(((basePulses * (basePulses + 1)) / 2) * 4 * def.heatModifier));
    return [
      `${eu} EU/t, ${heat} heat/s (isolated)`,
      `Lifespan: ${def.durability}s`,
      `Rods: ${def.rods} | Pulses/t: ${def.pulsesPerTick} | Bonus/link: ${def.pulsesForConnection}`,
      def.pulseArea === "all8" ? "Pulses all 8 neighbors (diagonals!)" : "Pulses 4 orthogonal neighbors",
    ];
  }
  if (def.type === "coolant") return [`Stores ${fmt(def.capacity)} heat`, "Pops if overfilled"];
  if (def.type === "vent") {
    const lines = [`Vents ${def.selfVent} heat/s from itself`, `Stores ${fmt(def.capacity)} heat`];
    if (def.hullDraw > 0) lines.splice(1, 0, `Pulls ${def.hullDraw} heat/s from the hull`);
    if (def.electric) lines.push(`Costs ${def.selfVent / 40} EU/t while powered`);
    return lines;
  }
  if (def.type === "ventSpread") return [`Cools each adjacent component by ${def.cooling}/s`, "Stores nothing itself"];
  if (def.type === "exchanger") {
    return [
      `Stores ${fmt(def.capacity)} heat`,
      `Moves up to ${def.componentExchange * 2}/s with neighbors`,
      `Moves up to ${def.hullExchange * 2}/s with the hull`,
      "Balances everything toward equal fill %",
    ];
  }
  if (def.type === "condensator") return [`Absorbs ${fmt(def.capacity)} heat, then stops`, "No regen inside the reactor", "Never explodes, just goes inert"];
  if (def.type === "plating") return [`Hull max heat +${def.maxHeatBonus}`, `Heat effects x${def.hemModifier} (also softens the boom)`];
  if (def.type === "reflector") {
    return [
      "Bounces pulses back: +EU and +heat for the rod",
      `Takes ${fmt(def.durability)} pulses before ${def.iridium ? "going inert" : "breaking"}`,
    ];
  }
  if (def.type === "heatingCell") return ["Warms the hull toward 1000 heat", "For breeder setups"];
  if (def.type === "inactiveFuel") return ["Charge with pulses to make a Fuel Cell", "Charges faster on a hot hull"];
  if (def.type === "depleted") return ["Re-enriches when pulsed by a fuel cell", `Needs ~${fmt(def.durability)} pulses, faster on a hot hull`, `Becomes a Re-Enriched cell`];
  return [];
}

// Texture URL that survives the GitHub Pages base path
export function tex(name) {
  return `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/textures/${name}`;
}

export function fmt(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${n % 1000 === 0 ? n / 1000 : (n / 1000).toFixed(1)}k`;
  return `${n}`;
}

export function fmtEU(n) {
  if (n >= 1000000000) return `${(n / 1000000000).toFixed(2)}B`;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return `${n}`;
}

export function categories(data) {
  const groups = [];
  const seen = {};
  for (const [id, def] of Object.entries(data.components)) {
    if (!seen[def.category]) {
      seen[def.category] = { name: def.category, items: [] };
      groups.push(seen[def.category]);
    }
    seen[def.category].items.push({ id, def });
  }
  return groups;
}
