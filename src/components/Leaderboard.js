"use client";

import { useEffect, useState } from "react";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
const REPO = "https://github.com/WindingDuke77/ic2-reactor-planner";
// The repo IS the database: raw.githubusercontent serves the freshest board
// the moment the robot commits an entry - no redeploy needed. The bundled
// copy is only a fallback for when GitHub raw is unreachable.
const DB = "https://raw.githubusercontent.com/WindingDuke77/ic2-reactor-planner/master/public/leaderboard.json";

export default function Leaderboard({ data, grid, chambers, sim, apply }) {
  const [entries, setEntries] = useState(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let alive = true;
    const accept = (json) => { if (alive) setEntries(Array.isArray(json.entries) ? json.entries : []); };
    fetch(`${DB}?t=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(accept)
      .catch(() =>
        fetch(`${BASE}/leaderboard.json`)
          .then((r) => (r.ok ? r.json() : Promise.reject()))
          .then(accept)
          .catch(() => { if (alive) setOffline(true); })
      );
    return () => { alive = false; };
  }, []);

  const stable = !sim.exploded && sim.destroyed === 0 && sim.maxHull < 4000;
  const top = (entries || []).slice().sort((a, b) => b.euT - a.euT).slice(0, 10);

  const load = (entry) => {
    try {
      const [v, ch, cells] = JSON.parse(atob(entry.code));
      if ((v !== 1 && v !== 2) || !Array.isArray(cells) || cells.length !== 54) throw new Error();
      const ids = Object.keys(data.components);
      apply(cells.map((i) => ids[i] || null), Math.max(0, Math.min(6, ch)));
    } catch {}
  };

  const submit = () => {
    if (!stable) return;
    const ids = Object.keys(data.components);
    const cells = grid.map((id) => (id ? ids.indexOf(id) : -1));
    const code = btoa(JSON.stringify([1, chambers, cells]));
    const title = `[Submission] ${sim.avgEU} EU/t`;
    const body = [
      "Reactor submission from the planner. Put your display name on the name line, leave the rest alone.",
      "",
      "name: ",
      "",
      "```code",
      code,
      "```",
      "",
      `Planner says: ${sim.avgEU} EU/t avg, ${sim.totalEU} EU total, ${chambers} chambers, ran ${sim.seconds}s.`,
      "A robot will re-simulate this before it goes on the board.",
    ].join("\n");
    window.open(`${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`, "_blank", "noopener");
  };

  return (
    <div className="mc-panel p-3 w-full">
      <h2 className="text-xl text-[#404040] mb-2">Global Leaderboard</h2>

      {offline && (
        <p className="text-[#5a5a5a] text-base leading-tight mb-2">
          Leaderboard offline. Someone probably unplugged the satellite dish.
        </p>
      )}
      {!offline && entries === null && (
        <p className="text-[#5a5a5a] text-base leading-tight mb-2">Fetching the board...</p>
      )}
      {!offline && entries !== null && top.length === 0 && (
        <p className="text-[#5a5a5a] text-base leading-tight mb-2">
          No reactors on the board yet. Be the first.
        </p>
      )}

      {top.length > 0 && (
        <div className="flex flex-col gap-1 mb-2">
          {top.map((entry, i) => {
            const fuel = data.components[entry.fuel];
            return (
              <div key={entry.code || i} className="mc-inset flex items-center gap-2 px-2 py-1">
                <span className="text-[#ffff55] text-lg w-6 shrink-0">{i + 1}.</span>
                {fuel && (
                  <img
                    src={`${BASE}/textures/${fuel.texture}`}
                    alt={fuel.name}
                    title={fuel.name}
                    className="w-5 h-5 pixelated shrink-0"
                    draggable={false}
                  />
                )}
                <span className="text-[#e0e0e0] text-lg truncate flex-1">{entry.name}</span>
                <span className="text-[#55ff55] text-lg shrink-0">{entry.euT} EU/t</span>
                <button onClick={() => load(entry)} className="mc-btn px-2 py-0.5 text-base shrink-0">
                  Load
                </button>
              </div>
            );
          })}
        </div>
      )}

      <button
        onClick={submit}
        disabled={!stable}
        title={stable ? "Opens a prefilled GitHub issue" : "Stable reactors only. This one ends in a crater."}
        className={`mc-btn w-full py-1 text-lg ${stable ? "" : "opacity-50 cursor-not-allowed"}`}
      >
        Submit current design
      </button>

      <p className="text-[#5a5a5a] text-base leading-tight mt-2">
        Submissions open a GitHub issue and get validated by a robot before they
        appear. The robot runs the real simulator and cannot be bribed.
      </p>
    </div>
  );
}
