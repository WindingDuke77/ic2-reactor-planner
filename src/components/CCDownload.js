"use client";

import { useState } from "react";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
const WGET = "wget run https://windingduke77.github.io/ic2-reactor-planner/cc/installer.lua";

export default function CCDownload() {
  const [msg, setMsg] = useState("");

  const copy = () => {
    try { navigator.clipboard.writeText(WGET); } catch {}
    setMsg("Copied. Paste it into your turtle.");
  };

  return (
    <div className="mc-panel p-3 w-full">
      <h2 className="text-xl text-[#404040] mb-2">ComputerCraft Manager</h2>
      <p className="text-[#5a5a5a] text-base leading-tight mb-2">
        Let a turtle babysit the reactor: it holds the redstone on, counts the
        rod clock, swaps spent rods for fresh ones from a chest and fails safe
        (redstone off) if anything looks wrong.
      </p>

      <div className="mc-inset p-2 mb-2">
        <p className="text-[#55ff55] text-base leading-tight break-all">{WGET}</p>
      </div>
      <div className="flex gap-2 mb-2">
        <button onClick={copy} className="mc-btn flex-1 py-1 text-lg">Copy command</button>
        <a href={`${BASE}/cc/reactor.lua`} download className="mc-btn flex-1 py-1 text-lg text-center">
          Download .lua
        </a>
      </div>
      {msg && <p className="text-[#2a2a2a] text-base leading-tight mb-2">{msg}</p>}

      <p className="text-[#5a5a5a] text-base leading-tight">
        Run it on a turtle facing the reactor: supply chest above, waste chest
        below. Then type installer, and after that: reactor. Fill every planner
        slot (pad with plating) so the layout survives refuels.
      </p>
    </div>
  );
}
