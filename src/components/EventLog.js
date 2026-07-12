"use client";

import { memo } from "react";

// memo: the log only changes when a new simulation lands
export default memo(EventLog);

function EventLog({ events }) {
  return (
    <div className="mc-panel p-3 w-full">
      <h2 className="text-xl text-[#404040] mb-2">Event log</h2>
      {events.length === 0 ? (
        <p className="text-[#5a5a5a] text-base leading-tight">
          Quiet so far. Rods deplete, parts pop and meltdowns show up here.
        </p>
      ) : (
        <div className="mc-inset max-h-80 overflow-y-auto p-2 space-y-0.5">
          {events.map((e, i) => (
            <p key={i} className="text-base leading-tight text-[#c8c8c8]">
              <span className="text-[#ffaa00]">{e.t}s</span> {e.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
