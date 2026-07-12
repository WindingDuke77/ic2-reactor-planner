// Validates a "[Submission]" issue against the real simulator and, when the
// design is stable and fast enough, writes it into public/leaderboard.json.
// Zero dependencies, always exits 0, always writes submission-result.json -
// the workflow reads that file to decide whether to commit, and what to say
// on the issue. Reasons are fixed strings from this file, never user text.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BOARD = path.join(ROOT, "public", "leaderboard.json");
const RESULT = path.join(ROOT, "submission-result.json");
const MAX_ENTRIES = 50;

main();

async function main() {
  let result;
  try {
    result = await run();
  } catch {
    result = { accepted: false, reason: "The validator choked on that submission entirely." };
  }
  fs.writeFileSync(RESULT, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
}

async function run() {
  const body = process.env.ISSUE_BODY || "";
  const author = process.env.ISSUE_AUTHOR || "";

  const codeMatch = body.match(/```code\s+([\s\S]*?)```/);
  if (!codeMatch) return reject("No ```code block found in the issue body.");
  const code = codeMatch[1].replace(/\s+/g, "");

  const nameMatch = body.match(/^name:[ \t]*(.*)$/m);
  const name = sanitizeName(nameMatch ? nameMatch[1] : "") || sanitizeName(author) || "Anonymous";

  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(code, "base64").toString("utf8"));
  } catch {
    return reject("That code is not a reactor. It might be a creeper.");
  }
  if (!Array.isArray(decoded)) return reject("That code is not a reactor. It might be a creeper.");
  const [version, chambers, cells] = decoded;
  if (version !== 1) return reject("Unknown design code version.");
  if (!Number.isInteger(chambers) || chambers < 0 || chambers > 6) return reject("Chamber count out of range.");
  if (!Array.isArray(cells) || cells.length !== 54) return reject("A reactor grid has exactly 54 cells. This one does not.");

  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "lib", "components.json"), "utf8"));
  const ids = Object.keys(data.components);
  // Same mapping the planner uses to load a code - unknown indices become empty slots
  const grid = cells.map((i) => (Number.isInteger(i) && ids[i]) || null);

  const { simulate } = await import("../src/lib/simulator.js");
  const sim = simulate(grid, chambers, data);

  if (sim.exploded) return reject(`It explodes (power ${sim.explosionPower.toFixed(1)}). The board is for reactors, not craters.`);
  if (sim.destroyed > 0) return reject(`${sim.destroyed} component${sim.destroyed === 1 ? "" : "s"} burned out during the run. Not stable enough.`);
  if (sim.maxHull >= 4000) return reject(`Hull heat peaks at ${sim.maxHull} - anything past 4000 starts setting the world on fire.`);
  if (sim.avgEU <= 0) return reject("It produces no EU. Impressively safe, though.");

  const euT = sim.avgEU;

  // Fuel summary for the board row - first fuel id plus how many cells run
  const width = data.config.baseColumns + chambers;
  let fuel = null;
  let fuelCells = 0;
  for (let y = 0; y < data.config.rows; y++) {
    for (let x = 0; x < width; x++) {
      const id = grid[y * 9 + x];
      const def = data.components[id];
      if (def && def.type === "fuel") {
        fuelCells++;
        if (!fuel) fuel = id;
      }
    }
  }

  let board;
  try {
    board = JSON.parse(fs.readFileSync(BOARD, "utf8"));
  } catch {
    board = { entries: [] };
  }
  const entries = Array.isArray(board.entries) ? board.entries : [];
  if (entries.some((e) => e.code === code)) return reject("That exact design is already on the board.");

  entries.push({
    name,
    code,
    fuel,
    cells: fuelCells,
    euT,
    totalEU: sim.totalEU,
    chambers,
    date: new Date().toISOString().slice(0, 10),
  });
  entries.sort((a, b) => b.euT - a.euT);
  const kept = entries.slice(0, MAX_ENTRIES);
  if (!kept.some((e) => e.code === code)) {
    return reject(`Valid and stable, but ${euT} EU/t does not crack the top ${MAX_ENTRIES}. Back to the drawing board.`);
  }

  fs.writeFileSync(BOARD, JSON.stringify({ entries: kept }, null, 2) + "\n");
  return { accepted: true, reason: "", euT };
}

function reject(reason) {
  return { accepted: false, reason };
}

// Board names render straight into the page - strip markdown and angle brackets
function sanitizeName(raw) {
  return String(raw)
    .replace(/[<>`*_~#[\]()|\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
}
