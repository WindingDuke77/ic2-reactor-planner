# IC2 Reactor Planner

A web-based nuclear reactor simulator + auto-designer for **IC2 Classic 1.12-1.5.8**
(the version shipped in Tekxit 3.14). Build a reactor in a Minecraft-style GUI,
watch the full fuel cycle play out second by second, and let the auto-designer
build a proven-stable layout around whatever fuel cells you ask for.

The simulation is not wiki lore - the tick algorithm was lifted from the actual
mod jar's bytecode, including all its weird integer divisions, the two-pass
processing order, exchangers running twice per tick, reflectors generating
bonus EU, and condensators that can go negative. Isolated designs here should
match the in-game reactor exactly.

## Run it

```
npm install
npm run dev
```

Open http://localhost:3000.

## How to use

- **Left click** a slot to place the selected component, **right click** to
  erase, **drag** to paint. Your design saves itself to localStorage.
- The simulation re-runs automatically on every edit. The verdict panel tells
  you if the design survives a full fuel cycle.
- Use the **timeline** (play button / slider / clicking the graph) to scrub
  through time - slots show live heat and durability bars.
- **Auto Designer**: pick a fuel cell and how many, hit the button. It
  escalates through cooling kits and chamber counts, running the real
  simulator on each attempt until one survives. Unstable results are flagged,
  not hidden.

## Everything is JSON

Every component - all 18 fuel cell variants, coolant cells, all 12 vents,
exchangers, condensators, plating, reflectors, isotope cells, the lot - lives
in [src/lib/components.json](src/lib/components.json) with its real decompiled
stats. Edit a number, save, and the whole planner (tooltips, simulation,
auto-designer) follows. Add a new entry and it shows up in the palette.
The `config` block holds the reactor-level constants (EU multiplier, hull max
heat, explosion cap - matching the Tekxit ic2.cfg).

## Faithfulness notes

- EU reactor only (steam reactors are a different block and not simulated).
- The reactor is assumed redstone-powered the whole run.
- In-game, a depleted rod has a 1/3 chance to leave near-depleted cells.
  Both outcomes are inert, so the sim always leaves them to stay deterministic.
- Fire-starting above 85% hull heat is reported as time-in-range instead of
  actually setting your base on fire.

Textures are sliced from the IC2 Classic item atlases and belong to the IC2
Classic team. This is a fan tool - not affiliated with IC2 or Tekxit.
