"use client";

import { memo } from "react";
import { fmt, fmtEU } from "@/lib/info";

// memo: stats only change when a new simulation lands, not on every scrub
export default memo(StatsPanel);

function StatsPanel({ sim, maxHeat, cells }) {
  if (!sim) return null;

  const verdict = sim.exploded
    ? { text: `MELTDOWN at ${sim.seconds}s - boom power ${sim.explosionPower.toFixed(1)} (TNT is 4)`, cls: "bg-[#3f1010] text-[#ff5555] border-[#ff5555]" }
    : sim.destroyed > 0
      ? { text: `SURVIVES, but ${sim.destroyed} component${sim.destroyed === 1 ? "" : "s"} burned out`, cls: "bg-[#3f2a10] text-[#ffaa00] border-[#ffaa00]" }
      : sim.fireTicks > 0
        ? { text: `STABLE-ISH - hull spent ${sim.fireTicks}s in fire-starting range`, cls: "bg-[#3f3a10] text-[#ffff55] border-[#ffff55]" }
        : { text: "STABLE - full cycle, nothing lost", cls: "bg-[#103f10] text-[#55ff55] border-[#55ff55]" };

  return (
    <div className="mc-panel p-3 w-full">
      <h2 className="text-xl text-[#404040] mb-2">Simulation</h2>

      <div className={`border-2 px-2 py-1 mb-3 text-lg leading-tight ${verdict.cls}`}>{verdict.text}</div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-lg leading-tight">
        <Stat label="Avg output" value={`${sim.avgEU} EU/t`} />
        <Stat label="Peak output" value={`${sim.maxEU} EU/t`} />
        <Stat label="Total EU" value={fmtEU(sim.totalEU)} />
        <Stat label="Runtime" value={`${sim.seconds}s`} />
        <Stat label="Max hull heat" value={`${fmt(sim.maxHull)} / ${fmt(maxHeat)}`} />
        <Stat label="Residual heat" value={fmt(sim.residualHull)} />
        <Stat label="Rods depleted" value={`${sim.rodsDepleted}`} />
        <Stat label="Parts lost" value={`${sim.destroyed}`} />
        <Stat label="Fuel cells" value={`${cells || 0}`} />
        <Stat label="EU/t per cell" value={cells > 0 ? `${Math.round(sim.avgEU / cells)}` : "-"} />
      </div>

      {sim.events.length > 0 && (
        <div className="mt-3">
          <p className="text-[#404040] text-lg mb-1">Event log</p>
          <div className="mc-inset max-h-48 overflow-y-auto p-2 space-y-0.5">
            {sim.events.map((e, i) => (
              <p key={i} className="text-base leading-tight text-[#c8c8c8]">
                <span className="text-[#ffaa00]">{e.t}s</span> {e.text}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <>
      <span className="text-[#5a5a5a]">{label}</span>
      <span className="text-[#2a2a2a] text-right">{value}</span>
    </>
  );
}
