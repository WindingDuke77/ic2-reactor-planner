"use client";

import { memo } from "react";
import HoverTip from "@/components/HoverTip";
import { statLines, categories, tex } from "@/lib/info";

// memo: the palette is 40+ tooltip-heavy buttons that never change during
// playback, so skip re-rendering it unless the selected tool does
export default memo(Palette);

function Palette({ data, tool, pick }) {
  return (
    <div className="mc-panel p-3 w-full lg:w-72 shrink-0">
      <h2 className="text-xl text-[#404040] mb-2">Components</h2>

      <button
        onClick={() => pick("erase")}
        className={`mc-btn w-full mb-3 py-1 text-lg ${tool === "erase" ? "mc-btn-active" : ""}`}
      >
        Eraser {tool === "erase" ? "(selected)" : ""}
      </button>

      {categories(data).map((group) => (
        <div key={group.name} className="mb-3">
          <p className="text-[#404040] text-lg leading-none mb-1">{group.name}</p>
          <div className="flex flex-wrap gap-1">
            {group.items.map(({ id, def }) => (
              <HoverTip
                key={id}
                tip={
                  <>
                    <p className="text-white text-lg leading-tight">{def.name}</p>
                    {statLines(def, data.config).map((line) => (
                      <p key={line} className="text-[#a8a8a8] text-base leading-tight">{line}</p>
                    ))}
                  </>
                }
              >
                <button
                  onClick={() => pick(id)}
                  className={`mc-slot w-10 h-10 flex items-center justify-center cursor-pointer ${
                    tool === id ? "mc-slot-selected" : ""
                  }`}
                >
                  <img src={tex(def.texture)} alt={def.name} className="w-8 h-8 pixelated" draggable={false} />
                </button>
              </HoverTip>
            ))}
          </div>
        </div>
      ))}

      <p className="text-[#5a5a5a] text-base leading-tight mt-2">
        Left click paints, right click erases. Drag to paint a row of them.
      </p>
    </div>
  );
}
