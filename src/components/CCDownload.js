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
      <h2 className="text-xl text-[#404040] mb-2">Build it with a turtle</h2>
      <p className="text-[#5a5a5a] text-base leading-tight mb-2">
        Paste a design code into a turtle and it builds the reactor for you,
        pulling parts from a chest. Redstone stays OFF the whole time - it only
        powers on after you confirm.
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
        On a mining turtle facing the reactor, a chest of parts above it: run
        the line above, then hit <span className="text-[#2a2a2a]">Copy code</span> up
        top and paste it when the turtle asks. Works best with auto-designed
        (gap-free) layouts. It also reads the code&apos;s baked-in stats, so the
        turtle shows EU/t and stability before it builds.
      </p>
    </div>
  );
}
