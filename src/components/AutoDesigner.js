"use client";

import { useState } from "react";
import { design, describe, improve, PRESETS } from "@/lib/designer";
import { tex } from "@/lib/info";

export default function AutoDesigner({ data, grid, chambers, apply }) {
  const [fuelId, setFuelId] = useState("uranium_cell");
  const [count, setCount] = useState(4);
  const [mode, setMode] = useState("spread");
  const [goal, setGoal] = useState("eu");
  const [note, setNote] = useState("");

  const fuels = Object.entries(data.components).filter(([, def]) => def.type === "fuel");
  const fuel = data.components[fuelId];

  const build = () => {
    const result = design(fuelId, count, mode, data, goal);
    setNote(describe(result, fuelId, count, data));
    if (result) apply(result.grid, result.chambers);
  };

  const iterate = () => {
    const result = improve(grid, chambers, goal, data);
    setNote(result.note);
    if (result.changed) apply(result.grid, result.chambers);
  };

  const pick = (p) => {
    setFuelId(p.fuelId);
    setCount(p.count);
    setMode(p.mode);
    setGoal(p.goal);
    const result = design(p.fuelId, p.count, p.mode, data, p.goal, p.armored);
    setNote(describe(result, p.fuelId, p.count, data));
    if (result) apply(result.grid, result.chambers);
  };

  return (
    <div className="mc-panel p-3 w-full lg:w-80 shrink-0">
      <h2 className="text-xl text-[#404040] mb-2">Auto Designer</h2>
      <p className="text-[#5a5a5a] text-base leading-tight mb-2">
        Pick your fuel and a goal, the machine does the cooling. Every design is
        proven by running the full simulation.
      </p>

      {/* Fuel */}
      <div className="flex items-center gap-2 mb-2">
        <div className="mc-slot w-12 h-12 flex items-center justify-center shrink-0">
          <img src={tex(fuel.texture)} alt={fuel.name} className="w-10 h-10 pixelated" draggable={false} />
        </div>
        <select
          value={fuelId}
          onChange={(e) => setFuelId(e.target.value)}
          className="mc-inset text-[#e0e0e0] text-lg w-full p-1 cursor-pointer"
        >
          {fuels.map(([id, def]) => (
            <option key={id} value={id}>{def.name}</option>
          ))}
        </select>
      </div>

      {/* Cells */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[#5a5a5a] text-lg">Cells:</span>
        <button onClick={() => setCount((c) => Math.max(1, c - 1))} className="mc-btn w-8 py-0.5 text-lg">-</button>
        <span className="text-[#2a2a2a] text-xl w-8 text-center">{count}</span>
        <button onClick={() => setCount((c) => Math.min(24, c + 1))} className="mc-btn w-8 py-0.5 text-lg">+</button>
      </div>

      {/* Mode */}
      <div className="flex gap-1 mb-2">
        {[["spread", "Spread out (safe)"], ["paired", "Paired (more EU)"]].map(([value, label]) => (
          <button
            key={value}
            onClick={() => setMode(value)}
            className={`mc-btn flex-1 py-1 text-base ${mode === value ? "mc-btn-active" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Goal */}
      <div className="flex gap-1 mb-3">
        {[["eu", "Most EU/t"], ["total", "Most EU"], ["efficiency", "Efficient"]].map(([value, label]) => (
          <button
            key={value}
            onClick={() => setGoal(value)}
            className={`mc-btn flex-1 py-1 text-base ${goal === value ? "mc-btn-active" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>

      <button onClick={build} className="mc-btn w-full py-2 text-xl">
        Design my reactor
      </button>
      <button onClick={iterate} className="mc-btn w-full py-1 text-lg mt-1">
        Iterate on current grid
      </button>

      {note && <p className="text-[#2a2a2a] text-base leading-tight mt-2">{note}</p>}

      {/* Presets */}
      <p className="text-[#5a5a5a] text-lg mt-3 mb-1">Presets</p>
      <div className="grid grid-cols-2 gap-1">
        {PRESETS.map((p) => (
          <button key={p.name} onClick={() => pick(p)} className="mc-btn py-1 px-1 text-base leading-tight">
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}
