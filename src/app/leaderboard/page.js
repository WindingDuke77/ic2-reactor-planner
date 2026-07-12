"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Leaderboard from "@/components/Leaderboard";
import { useLocalState } from "@/lib/useLocalState";
import { simulate, makeGrid } from "@/lib/simulator";
import { tex } from "@/lib/info";
import DATA from "@/lib/components.json";

export default function LeaderboardPage() {
  const router = useRouter();
  const [grid, setGrid] = useLocalState("ic2:grid", makeGrid());
  const [chambers, setChambers] = useLocalState("ic2:chambers", 3);

  const sim = useMemo(() => simulate(grid, chambers, DATA), [grid, chambers]);

  // Loading an entry drops it into the planner and jumps back there
  const apply = (newGrid, newChambers) => {
    setGrid(newGrid);
    setChambers(newChambers);
    router.push("/");
  };

  return (
    <div className="min-h-screen mc-dirt p-3">
      <div className="mc-panel px-4 py-2 mb-3 flex flex-wrap items-center gap-3">
        <img src={tex("iridium_neutron_reflector.png")} alt="" className="w-8 h-8 pixelated" />
        <h1 className="text-3xl text-[#2a2a2a] leading-none">Global Leaderboard</h1>
        <Link href="/" className="mc-btn px-3 py-0.5 text-lg ml-auto">Back to planner</Link>
      </div>

      <div className="max-w-2xl mx-auto">
        <Leaderboard data={DATA} grid={grid} chambers={chambers} sim={sim} apply={apply} />
      </div>
    </div>
  );
}
