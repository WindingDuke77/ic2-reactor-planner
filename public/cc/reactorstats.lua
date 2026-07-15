--========================================================================--
-- reactorstats.lua - reactor design-code API for ComputerCraft
-- Part of the IC2 Reactor Planner:
--   https://windingduke77.github.io/ic2-reactor-planner/
--
-- A design "code" from the planner is base64 of a small JSON array.
--   v1:  [1, chambers, cells]              (layout only)
--   v2:  [2, chambers, cells, stats]       (layout + the planner's EXACT
--                                           simulated stats, baked in)
-- "cells" is 54 numbers, one per reactor slot (row*9 + col), each a
-- component index (see COMPONENTS below) or -1 for empty.
--
-- Because a v2 code carries the numbers the website's own simulator produced,
-- CC gets the SAME stats the site shows - no reactor sim runs on the computer,
-- nothing to drift out of sync.
--
-- USE AS A LIBRARY (from another program):
--   local rs = dofile("reactorstats")
--   local d  = rs.decode(code)        -- { version, chambers, width, cells, stats, err }
--   local s  = rs.stats(code)         -- the stats table, or nil for a v1 code
--   print(rs.report(code))            -- ready-to-print multi-line summary
--
-- USE AS A PROGRAM:
--   reactorstats <code>               -- prints the report for that code
--
-- The full component database (every part's real numbers) is also published
-- as JSON next to this file:
--   https://windingduke77.github.io/ic2-reactor-planner/cc/components.json
--========================================================================--

local M = {}

-- design-code index -> component id / display name / kind
local COMPONENTS = {
  [0]={id="uranium_cell",name="Uranium Cell",kind="fuel"},
  [1]={id="uranium_dual_cell",name="Dual Uranium Cell",kind="fuel"},
  [2]={id="uranium_quad_cell",name="Quad Uranium Cell",kind="fuel"},
  [3]={id="redstone_uranium_cell",name="Redstone Enriched Uranium Cell",kind="fuel"},
  [4]={id="redstone_uranium_dual_cell",name="Redstone Enriched Dual Uranium Cell",kind="fuel"},
  [5]={id="redstone_uranium_quad_cell",name="Redstone Enriched Quad Uranium Cell",kind="fuel"},
  [6]={id="blaze_uranium_cell",name="Blaze Enriched Uranium Cell",kind="fuel"},
  [7]={id="blaze_uranium_dual_cell",name="Blaze Enriched Dual Uranium Cell",kind="fuel"},
  [8]={id="blaze_uranium_quad_cell",name="Blaze Enriched Quad Uranium Cell",kind="fuel"},
  [9]={id="enderpearl_uranium_cell",name="EnderPearl Enriched Uranium Cell",kind="fuel"},
  [10]={id="enderpearl_uranium_dual_cell",name="EnderPearl Enriched Dual Uranium Cell",kind="fuel"},
  [11]={id="enderpearl_uranium_quad_cell",name="EnderPearl Enriched Quad Uranium Cell",kind="fuel"},
  [12]={id="netherstar_uranium_cell",name="NetherStar Enriched Uranium Cell",kind="fuel"},
  [13]={id="netherstar_uranium_dual_cell",name="NetherStar Enriched Dual Uranium Cell",kind="fuel"},
  [14]={id="netherstar_uranium_quad_cell",name="NetherStar Enriched Quad Uranium Cell",kind="fuel"},
  [15]={id="charcoal_uranium_cell",name="Charcoal Enriched Uranium Cell",kind="fuel"},
  [16]={id="charcoal_uranium_dual_cell",name="Charcoal Enriched Dual Uranium Cell",kind="fuel"},
  [17]={id="charcoal_uranium_quad_cell",name="Charcoal Enriched Quad Uranium Cell",kind="fuel"},
  [18]={id="coolant_cell_10k",name="10k Coolant Cell",kind="coolant"},
  [19]={id="coolant_cell_30k",name="30k Coolant Cell",kind="coolant"},
  [20]={id="coolant_cell_60k",name="60k Coolant Cell",kind="coolant"},
  [21]={id="heat_vent",name="Heat Vent",kind="vent"},
  [22]={id="reactor_heat_vent",name="Reactor Heat Vent",kind="vent"},
  [23]={id="overclocked_heat_vent",name="Overclocked Heat Vent",kind="vent"},
  [24]={id="advanced_heat_vent",name="Advanced Heat Vent",kind="vent"},
  [25]={id="component_heat_vent",name="Component Heat Vent",kind="ventSpread"},
  [26]={id="steam_vent",name="Steam Vent",kind="vent"},
  [27]={id="reactor_steam_vent",name="Reactor Steam Vent",kind="vent"},
  [28]={id="overclocked_steam_vent",name="Overclocked Steam Vent",kind="vent"},
  [29]={id="advanced_steam_vent",name="Advanced Steam Vent",kind="vent"},
  [30]={id="electric_heat_vent",name="Electric Heat Vent",kind="vent"},
  [31]={id="electric_reactor_heat_vent",name="Electric Reactor Heat Vent",kind="vent"},
  [32]={id="electric_overclocked_heat_vent",name="Electric Overclocked Heat Vent",kind="vent"},
  [33]={id="electric_advanced_heat_vent",name="Electric Advanced Heat Vent",kind="vent"},
  [34]={id="heat_exchanger",name="Heat Exchanger",kind="exchanger"},
  [35]={id="reactor_heat_exchanger",name="Reactor Heat Exchanger",kind="exchanger"},
  [36]={id="component_heat_exchanger",name="Component Heat Exchanger",kind="exchanger"},
  [37]={id="advanced_heat_exchanger",name="Advanced Heat Exchanger",kind="exchanger"},
  [38]={id="rsh_condensator",name="RSH-Condensator",kind="condensator"},
  [39]={id="lzh_condensator",name="LZH-Condensator",kind="condensator"},
  [40]={id="reactor_plating",name="Reactor Plating",kind="plating"},
  [41]={id="heat_capacity_reactor_plating",name="Heat-Capacity Reactor Plating",kind="plating"},
  [42]={id="containment_reactor_plating",name="Containment Reactor Plating",kind="plating"},
  [43]={id="neutron_reflector",name="Neutron Reflector",kind="reflector"},
  [44]={id="thick_neutron_reflector",name="Thick Neutron Reflector",kind="reflector"},
  [45]={id="iridium_neutron_reflector",name="Iridium Neutron Reflector",kind="reflector"},
  [46]={id="uranium_depleted_isotope",name="Depleted Isotope Cell",kind="depleted"},
  [47]={id="redstone_depleted_isotope",name="Depleted Redstone Isotope Cell",kind="depleted"},
  [48]={id="blaze_depleted_isotope",name="Depleted Blaze Isotope Cell",kind="depleted"},
  [49]={id="enderpearl_depleted_isotope",name="Depleted EnderPearl Isotope Cell",kind="depleted"},
  [50]={id="netherstar_depleted_isotope",name="Depleted NetherStar Isotope Cell",kind="depleted"},
  [51]={id="charcoal_depleted_isotope",name="Depleted Charcoal Isotope Cell",kind="depleted"},
  [52]={id="heating_cell",name="Heating Cell",kind="heatingCell"},
  [53]={id="inactive_fuel_cell",name="Inactive Fuel Cell",kind="inactiveFuel"},
}
M.COMPONENTS = COMPONENTS

local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local B64LUT = {}
for i = 1, #B64 do B64LUT[B64:sub(i, i)] = i - 1 end

-- Standard base64 decode. Pure arithmetic (no bit library) so it runs on any
-- CC Lua; acc is masked back down every byte so it never loses precision.
function M.b64decode(input)
  local acc, bits, out = 0, 0, {}
  for i = 1, #input do
    local v = B64LUT[input:sub(i, i)]
    if v then -- skip '=' padding and any stray whitespace
      acc = acc * 64 + v
      bits = bits + 6
      if bits >= 8 then
        bits = bits - 8
        local p = 2 ^ bits
        out[#out + 1] = string.char(math.floor(acc / p) % 256)
        acc = acc % p
      end
    end
  end
  return table.concat(out)
end

local ujson = textutils.unserialiseJSON or textutils.unserializeJSON

-- decode(code) -> table or (nil, errorMessage)
--   .version   1 or 2
--   .chambers  0..6
--   .width     3 + chambers
--   .cells     { [0..53] = componentIndex or false }
--   .stats     the baked stats table (v2 only), else nil
function M.decode(code)
  if type(code) ~= "string" then return nil, "no code given" end
  code = code:gsub("%s", "")
  local ok, json = pcall(M.b64decode, code)
  if not ok or not json or #json == 0 then return nil, "that is not a valid design code" end
  if not ujson then return nil, "this ComputerCraft has no JSON reader (textutils.unserialiseJSON)" end
  local arr = ujson(json)
  if type(arr) ~= "table" or type(arr[3]) ~= "table" then return nil, "code did not decode to a reactor" end

  local version = arr[1]
  local chambers = arr[2] or 0
  if type(chambers) ~= "number" or chambers < 0 or chambers > 6 then return nil, "bad chamber count in code" end

  local raw = arr[3]
  local cells = {}
  for slot = 0, 53 do
    local v = raw[slot + 1] -- JSON array is 1-indexed; slot 0 -> raw[1]
    cells[slot] = (type(v) == "number" and v >= 0) and v or false
  end

  return {
    version = version,
    chambers = chambers,
    width = 3 + chambers,
    cells = cells,
    stats = (version == 2 and type(arr[4]) == "table") and arr[4] or nil,
  }
end

-- stats(code) -> statsTable or (nil, note)
function M.stats(code)
  local d, err = M.decode(code)
  if not d then return nil, err end
  if not d.stats then return nil, "this code has no baked stats (it is a v1 code) - re-copy it from the planner" end
  return d.stats
end

-- countKinds(cells) -> { fuel=n, vent=n, ... }, total
function M.countKinds(cells)
  local counts, total = {}, 0
  for slot = 0, 53 do
    local idx = cells[slot]
    if idx and COMPONENTS[idx] then
      local k = COMPONENTS[idx].kind
      counts[k] = (counts[k] or 0) + 1
      total = total + 1
    end
  end
  return counts, total
end

-- report(code) -> a ready-to-print multi-line string
function M.report(code)
  local d, err = M.decode(code)
  if not d then return "Bad code: " .. tostring(err) end

  local counts, total = M.countKinds(d.cells)
  local lines = {}
  local function add(s) lines[#lines + 1] = s end

  add("=== Reactor design ===")
  add(("Size: %d chambers  (%d x 6 grid)"):format(d.chambers, d.width))
  add(("Parts: %d placed"):format(total))
  add(("  fuel rods: %d   vents: %d   coolant: %d"):format(
    counts.fuel or 0, (counts.vent or 0) + (counts.ventSpread or 0), counts.coolant or 0))
  add(("  exchangers: %d   plating: %d   reflectors: %d"):format(
    counts.exchanger or 0, counts.plating or 0, counts.reflector or 0))

  local s = d.stats
  if s then
    add("--- planner stats (exact) ---")
    add(("Verdict: %s"):format(tostring(s.verdict or (s.ok and "stable" or "unstable"))))
    add(("Output:  %s EU/t  (peak %s)"):format(tostring(s.euT), tostring(s.peakEU)))
    add(("Total:   %s EU over %ss"):format(tostring(s.totalEU), tostring(s.seconds)))
    add(("Max hull heat: %s / %s"):format(tostring(s.maxHull), tostring(s.maxHeat)))
    if s.partsLost and s.partsLost > 0 then add(("Parts burned out: %d"):format(s.partsLost)) end
    if s.explosion and s.explosion > 0 then add(("!! MELTDOWN - blast power %s (TNT is 4)"):format(tostring(s.explosion))) end
    if s.ok then add("SAFE to run.") else add("NOT SAFE - do not power this on.") end
  else
    add("--- no baked stats in this code ---")
    add("Re-copy the code from the planner to include stats,")
    add("or open it in the planner to simulate it.")
  end

  return table.concat(lines, "\n")
end

-- CLI: `reactorstats <code>` prints the report. Loaded via dofile() (no args),
-- it just hands back the API table.
local cliCode = ...
if type(cliCode) == "string" and #cliCode > 0 then
  print(M.report(cliCode))
end

return M
