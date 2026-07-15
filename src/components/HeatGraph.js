"use client";

import { useMemo, useRef } from "react";

const W = 600;
const H = 110;

export default function HeatGraph({ sim, steam, cursor, scrub }) {
  const box = useRef(null);

  // Downsampling 25k points per line is too slow to redo on every scrub tick
  const paths = useMemo(() => {
    if (!sim || sim.seconds < 1) return null;
    const hullMax = Math.max(sim.maxHeatFinal, sim.maxHull, 1);
    const out = steam ? sim.steamSeries || [] : sim.euSeries;
    const outMax = Math.max(steam ? sim.maxSteam || 0 : sim.maxEU, 1);
    return {
      hull: pathFor(sim.hullSeries, sim.seconds, hullMax),
      eu: pathFor(out, sim.seconds, outMax),
    };
  }, [sim, steam]);

  if (!sim || sim.seconds < 1) return null;
  const snap = sim.snapshots[cursor];
  const cursorX = snap ? (snap.t / sim.seconds) * W : 0;

  const pickFrom = (clientX) => {
    const rect = box.current.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * sim.seconds;
    // Snap the click to the nearest stored snapshot
    let nearest = 0;
    for (let i = 0; i < sim.snapshots.length; i++) {
      if (Math.abs(sim.snapshots[i].t - t) < Math.abs(sim.snapshots[nearest].t - t)) nearest = i;
    }
    scrub(nearest);
  };

  const down = (e) => {
    pickFrom(e.clientX);
    const move = (ev) => pickFrom(ev.clientX);
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="mc-panel p-3">
      <div className="flex justify-between text-lg text-[#404040] leading-none mb-1">
        <span><span className="text-[#b02020]">■</span> Hull heat <span className="ml-3 text-[#8f7a00]">■</span> {steam ? "Steam mB/t" : "EU/t"}</span>
        <span>{snap ? `t = ${snap.t}s` : ""}</span>
      </div>
      <div ref={box} onMouseDown={down} className="mc-inset cursor-crosshair">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" preserveAspectRatio="none">
          {/* 85% fire line */}
          <line x1="0" x2={W} y1={H - 0.85 * H} y2={H - 0.85 * H} stroke="#663333" strokeDasharray="4 4" strokeWidth="1" />
          <polyline points={paths.eu} fill="none" stroke="#e8c53f" strokeWidth="1.5" />
          <polyline points={paths.hull} fill="none" stroke="#e83f3f" strokeWidth="1.5" />
          <line x1={cursorX} x2={cursorX} y1="0" y2={H} stroke="#ffffff" strokeWidth="1" />
        </svg>
      </div>
    </div>
  );
}

// Downsample a per-second series into a polyline that stays under ~2 points
// per pixel, keeping the worst (max) value in each bucket so spikes survive
function pathFor(series, seconds, max) {
  const step = Math.max(1, Math.ceil(series.length / W));
  const pts = [`0,${H}`];
  for (let i = 0; i < series.length; i += step) {
    let v = series[i];
    for (let j = i; j < Math.min(i + step, series.length); j++) if (series[j] > v) v = series[j];
    const x = ((i + 1) / seconds) * W;
    pts.push(`${x.toFixed(1)},${(H - (v / max) * (H - 4)).toFixed(1)}`);
  }
  return pts.join(" ");
}
