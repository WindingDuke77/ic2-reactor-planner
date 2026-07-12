"use client";

import { useEffect, useState } from "react";
import { statLines, fmt, tex } from "@/lib/info";

export default function ReactorGrid({ data, grid, width, snapshot, paint, peaks }) {
  const [painting, setPainting] = useState(0); // 0 = no, 1 = place, 2 = erase

  // Stop painting when the mouse is released anywhere on the page
  useEffect(() => {
    const stop = () => setPainting(0);
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  const down = (idx, e) => {
    e.preventDefault();
    const mode = e.button === 2 ? 2 : 1;
    setPainting(mode);
    paint(idx, mode === 2, true);
  };

  const enter = (idx) => {
    if (painting) paint(idx, painting === 2, false);
  };

  return (
    <div className="mc-panel p-3 select-none" onContextMenu={(e) => e.preventDefault()}>
      <div className="flex flex-col gap-1">
        {[0, 1, 2, 3, 4, 5].map((y) => (
          <div key={y} className="flex gap-1">
            {Array.from({ length: width }, (_, x) => {
              const idx = y * 9 + x;
              const live = snapshot ? snapshot.slots[idx] : null;
              const id = snapshot ? (live ? live.id : null) : grid[idx];
              const def = id ? data.components[id] || data.products[id] : null;
              const isProduct = live ? live.product : false;

              return (
                <div
                  key={x}
                  onMouseDown={(e) => down(idx, e)}
                  onMouseEnter={() => enter(idx)}
                  className="mc-slot relative group w-12 h-12 flex items-center justify-center cursor-pointer"
                >
                  {def && (
                    <img
                      src={tex(def.texture)}
                      alt={def.name}
                      className={`w-10 h-10 pixelated ${isProduct ? "opacity-60" : ""}`}
                      draggable={false}
                    />
                  )}

                  {/* Heat / durability bars while scrubbing a simulation */}
                  {live && !isProduct && barFor(live, def)}

                  {/* At rest: dim bar showing how hot this part got during the run */}
                  {!live && def && def.capacity && peaks && peaks[idx] > 0 && (
                    <Bar frac={peaks[idx] / def.capacity} color="rgba(232,63,63,0.5)" />
                  )}

                  {def && (
                    <div className="mc-tooltip hidden group-hover:block absolute left-9 top-9 z-50 w-60 p-2 text-left pointer-events-none">
                      <p className="text-white text-lg leading-tight">{def.name}</p>
                      {live && !isProduct ? liveLines(live, def) : null}
                      {!live && def.type ? statLines(def, data.config).map((line) => (
                        <p key={line} className="text-[#a8a8a8] text-base leading-tight">{line}</p>
                      )) : null}
                      {isProduct ? <p className="text-[#a8a8a8] text-base">Spent product, does nothing</p> : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function barFor(live, def) {
  if (!def || !def.type) return null;

  if (def.type === "fuel" || def.type === "reflector") {
    const left = 1 - live.damage / def.durability;
    return <Bar frac={left} color={left > 0.25 ? "#3fbf3f" : "#bf3f3f"} />;
  }
  if (def.capacity) {
    const frac = Math.max(0, live.heat) / def.capacity;
    if (frac <= 0) return null;
    return <Bar frac={frac} color={frac < 0.5 ? "#e8c53f" : frac < 0.85 ? "#e8833f" : "#e83f3f"} />;
  }
  if (def.type === "depleted" || def.type === "inactiveFuel") {
    const frac = 1 - live.progress / def.durability;
    return <Bar frac={frac} color="#3f9fe8" />;
  }
  return null;
}

function Bar({ frac, color }) {
  return (
    <div className="absolute bottom-0.5 left-1 right-1 h-1 bg-black/60">
      <div className="h-full" style={{ width: `${Math.min(100, frac * 100)}%`, backgroundColor: color }} />
    </div>
  );
}

function liveLines(live, def) {
  const lines = [];
  if (def.type === "fuel" || def.type === "reflector") lines.push(`Durability: ${fmt(def.durability - live.damage)} / ${fmt(def.durability)}`);
  if (def.capacity && def.type !== "fuel") lines.push(`Heat: ${fmt(live.heat)} / ${fmt(def.capacity)}`);
  if (def.type === "depleted" || def.type === "inactiveFuel") lines.push(`Progress: ${fmt(def.durability - live.progress)} / ${fmt(def.durability)}`);
  return lines.map((line) => (
    <p key={line} className="text-[#a8a8a8] text-base leading-tight">{line}</p>
  ));
}
