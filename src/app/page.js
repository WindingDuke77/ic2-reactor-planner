"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Palette from "@/components/Palette";
import ReactorGrid from "@/components/ReactorGrid";
import StatsPanel from "@/components/StatsPanel";
import HeatGraph from "@/components/HeatGraph";
import AutoDesigner from "@/components/AutoDesigner";
import CCDownload from "@/components/CCDownload";
import EventLog from "@/components/EventLog";
import { useLocalState } from "@/lib/useLocalState";
import { simulate, makeGrid, widthFor } from "@/lib/simulator";
import { tex } from "@/lib/info";
import DATA from "@/lib/components.json";

export default function Home() {
  const [grid, setGrid] = useLocalState("ic2:grid", makeGrid());
  const [chambers, setChambers] = useLocalState("ic2:chambers", 3);
  const [reactorType, setReactorType] = useLocalState("ic2:type", "eu");
  const [tool, setTool] = useState("uranium_cell");
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const history = useRef([]);

  const width = widthFor(chambers, DATA);
  const steam = reactorType === "steam";

  // Simulate a beat after the last edit instead of on every paint stroke -
  // dragging a row of vents stays smooth even on big reactors
  const [sim, setSim] = useState(() => simulate(makeGrid(), 3, DATA));
  useEffect(() => {
    const t = setTimeout(() => setSim(simulate(grid, chambers, DATA, { steam })), 120);
    return () => clearTimeout(t);
  }, [grid, chambers, steam]);

  const remember = (g) => {
    history.current.push(g);
    if (history.current.length > 50) history.current.shift();
  };

  // Ctrl+Z steps back through edits
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        const prev = history.current.pop();
        if (prev) setGrid(prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A design can arrive in the URL (?d=<code>) from a shared link
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const shared = params.get("d") || params.get("code") || params.get("");
      const design = shared && decodeDesign(shared);
      if (design) {
        setGrid(design.grid);
        setChambers(design.chambers);
        // Strip the query so a refresh does not reload it and the URL stays clean
        window.history.replaceState(null, "", window.location.pathname);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Editing the reactor rewinds the playback to the fresh grid
  useEffect(() => {
    setCursor(0);
    setPlaying(false);
  }, [grid, chambers]);

  // Playback: walk the snapshots while playing
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setCursor((c) => {
        if (c + 1 >= sim.snapshots.length) {
          setPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, 40);
    return () => clearInterval(t);
  }, [playing, sim]);

  const paint = (idx, erase, strokeStart) => {
    setGrid((g) => {
      if (strokeStart) remember(g);
      const next = [...g];
      next[idx] = erase ? null : tool === "erase" ? null : tool;
      return next;
    });
  };

  const clear = () => {
    if (grid.some(Boolean)) {
      remember(grid);
      setGrid(makeGrid());
    }
  };

  const apply = (newGrid, newChambers) => {
    remember(grid);
    setGrid(newGrid);
    setChambers(newChambers);
  };

  const snapshot = cursor > 0 ? sim.snapshots[cursor] : null;

  return (
    <div
      className="min-h-screen lg:h-screen lg:overflow-hidden flex flex-col mc-dirt p-3"
      style={{ backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.62), rgba(0, 0, 0, 0.62)), url(${tex("dirt.png")})` }}
    >
      {/* Header */}
      <div className="mc-panel shrink-0 px-4 py-2 mb-3 flex flex-wrap items-center gap-3">
        <img src={tex("uranium_quad_cell.png")} alt="" className="w-8 h-8 pixelated" />
        <h1 className="text-3xl text-[#2a2a2a] leading-none">IC2 Reactor Planner</h1>
        <span className="text-[#5a5a5a] text-lg leading-none hidden md:block">
          IC2 Classic 1.5.8 mechanics.
        </span>

        <div className="ml-auto flex items-center gap-2">
          {[["eu", "EU"], ["steam", "Steam"]].map(([value, label]) => (
            <button
              key={value}
              onClick={() => setReactorType(value)}
              className={`mc-btn px-3 py-0.5 text-lg ${reactorType === value ? "mc-btn-active" : ""}`}
            >
              {label}
            </button>
          ))}
          <span className="text-[#5a5a5a] text-lg ml-2">Chambers:</span>
          {[0, 1, 2, 3, 4, 5, 6].map((n) => (
            <button
              key={n}
              onClick={() => setChambers(n)}
              className={`mc-btn w-8 py-0.5 text-lg ${chambers === n ? "mc-btn-active" : ""}`}
            >
              {n}
            </button>
          ))}
          <button onClick={clear} className="mc-btn px-3 py-0.5 text-lg ml-2">Clear</button>
          <Link href="/leaderboard" className="mc-btn px-3 py-0.5 text-lg">Leaderboard</Link>
        </div>
      </div>

      {/* Three columns, each with its own scrollbar on desktop */}
      <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-stretch flex-1 min-h-0">
        <div className="w-full lg:w-72 shrink-0 lg:h-full lg:overflow-y-auto overflow-x-hidden">
          <Palette data={DATA} tool={tool} pick={setTool} />
        </div>

        {/* Reactor + timeline */}
        <div className="flex flex-col gap-3 min-w-0 flex-1 lg:h-full lg:overflow-y-auto overflow-x-hidden">
          {/* Below 2xl the center column is too narrow to flank the reactor,
              so the two stat panels sit in a row above it instead. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 2xl:hidden">
            <StatsPanel left steam={steam} sim={sim} maxHeat={sim.maxHeatFinal} cells={countFuel(grid, width, DATA)} />
            <StatsPanel right steam={steam} sim={sim} maxHeat={sim.maxHeatFinal} cells={countFuel(grid, width, DATA)} />
          </div>

          <div className="flex justify-center items-start gap-3">
            <div className="hidden 2xl:block w-56 shrink-0">
              <StatsPanel left steam={steam} sim={sim} maxHeat={sim.maxHeatFinal} cells={countFuel(grid, width, DATA)} />
            </div>
            <ReactorGrid data={DATA} grid={grid} width={width} snapshot={snapshot} paint={paint} peaks={sim.slotPeaks} />
            <div className="hidden 2xl:block w-56 shrink-0">
              <StatsPanel right steam={steam} sim={sim} maxHeat={sim.maxHeatFinal} cells={countFuel(grid, width, DATA)} />
            </div>
          </div>


          <div className="mc-panel p-2 w-full flex items-center gap-2">
            <button onClick={() => setPlaying((p) => !p)} className="mc-btn w-10 py-1 text-lg">
              {playing ? "❚❚" : "▶"}
            </button>
            <button onClick={() => { setPlaying(false); setCursor(0); }} className="mc-btn w-10 py-1 text-lg">
              ⏮
            </button>
            <input
              type="range"
              min={0}
              max={sim.snapshots.length - 1}
              value={cursor}
              onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)); }}
              className="flex-1 accent-[#55ff55] cursor-pointer"
            />
            <span className="text-[#2a2a2a] text-lg w-24 text-right">
              {snapshot ? `${snapshot.t}s` : "start"}
            </span>
          </div>

          <div className="w-full">
            <HeatGraph sim={sim} steam={steam} cursor={cursor} scrub={(i) => { setPlaying(false); setCursor(i); }} />
          </div>


          <div className="mc-panel px-3 py-1 text-lg text-[#2a2a2a] flex gap-4">
            <span>Hull: {snapshot?.hull} / {snapshot?.maxHeat}</span>
            <span>Output: {steam ? `${snapshot?.steam ?? 0} mB/t steam` : `${snapshot?.eu ?? 0} EU/t`}</span>
          </div>

          <EventLog events={sim.events} />
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-3 w-full lg:w-80 shrink-0 lg:h-full lg:overflow-y-auto overflow-x-hidden">
          <AutoDesigner data={DATA} grid={grid} chambers={chambers} apply={apply} />
          <ShareCode grid={grid} chambers={chambers} apply={apply} />
          <CCDownload />
        </div>
      </div>
    </div>
  );
}

function ShareCode({ grid, chambers, apply }) {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");

  const copy = () => {
    const out = encodeDesign(grid, chambers);
    setCode(out);
    try { navigator.clipboard.writeText(out); } catch {}
    setMsg("Code copied - it carries the live stats for the turtle.");
  };

  const copyLink = () => {
    const out = encodeDesign(grid, chambers);
    const url = `${window.location.origin}${window.location.pathname}?d=${encodeURIComponent(out)}`;
    setCode(out);
    try { navigator.clipboard.writeText(url); } catch {}
    setMsg("Share link copied - opens this exact design.");
  };

  const load = () => {
    const design = decodeDesign(code);
    if (!design) {
      setMsg("That code is not a reactor. It might be a creeper.");
      return;
    }
    apply(design.grid, design.chambers);
    setMsg("Loaded.");
  };

  return (
    <div className="mc-panel p-3 w-full">
      <h2 className="text-xl text-[#404040] mb-2">Design code</h2>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="paste a code here"
        className="mc-inset text-[#e0e0e0] text-base w-full p-1 mb-2"
        spellCheck={false}
      />
      <div className="flex gap-2 mb-2">
        <button onClick={copy} className="mc-btn flex-1 py-1 text-lg">Copy code</button>
        <button onClick={copyLink} className="mc-btn flex-1 py-1 text-lg">Copy link</button>
      </div>
      <button onClick={load} className="mc-btn w-full py-1 text-lg">Load pasted code</button>
      {msg && <p className="text-[#2a2a2a] text-base mt-1">{msg}</p>}
    </div>
  );
}

// ---- design code: base64 of [version, chambers, cells, stats?] ----
// v2 bakes in the planner's exact simulated stats so ComputerCraft (and
// anything else) reads the same numbers the site shows, without re-simulating.
const IDS = Object.keys(DATA.components);

function buildStats(grid, chambers) {
  const width = widthFor(chambers, DATA);
  const sim = simulate(grid, chambers, DATA); // EU reactor - the code is a layout, mode-independent
  let rods = 0, vents = 0, coolant = 0;
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < width; x++) {
      const def = DATA.components[grid[y * 9 + x]];
      if (!def) continue;
      if (def.type === "fuel") rods++;
      else if (def.type === "vent") vents++;
      else if (def.type === "coolant") coolant++;
    }
  }
  return {
    ok: !sim.exploded && sim.destroyed === 0 && sim.maxHull < 4000,
    verdict: sim.exploded ? "meltdown" : sim.destroyed > 0 ? "parts_lost" : sim.fireTicks > 0 ? "hot" : "stable",
    euT: sim.avgEU, peakEU: sim.maxEU, totalEU: sim.totalEU,
    seconds: sim.seconds, maxHull: sim.maxHull, maxHeat: sim.maxHeatFinal,
    rodsDepleted: sim.rodsDepleted, partsLost: sim.destroyed,
    explosion: sim.exploded ? Math.round(sim.explosionPower * 10) / 10 : 0,
    chambers, rods, vents, coolant,
  };
}

function encodeDesign(grid, chambers) {
  const cells = grid.map((id) => (id ? IDS.indexOf(id) : -1));
  return btoa(JSON.stringify([2, chambers, cells, buildStats(grid, chambers)]));
}

function decodeDesign(str) {
  try {
    const [v, ch, cells] = JSON.parse(atob(String(str).trim()));
    if ((v !== 1 && v !== 2) || !Array.isArray(cells) || cells.length !== 54) return null;
    return {
      grid: cells.map((i) => IDS[i] || null),
      chambers: Math.max(0, Math.min(6, ch | 0)),
    };
  } catch {
    return null;
  }
}

function countFuel(grid, width, data) {
  let n = 0;
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < width; x++) {
      const def = data.components[grid[y * 9 + x]];
      if (def && def.type === "fuel") n++;
    }
  }
  return n;
}
