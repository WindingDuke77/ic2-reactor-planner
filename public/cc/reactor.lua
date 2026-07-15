--========================================================================--
-- reactor.lua - build an IC2 reactor from a planner design code, on a TURTLE
-- Companion to https://windingduke77.github.io/ic2-reactor-planner/
-- Target: CC:Tweaked 1.89.2 (MC 1.12.2), IC2 Classic, e.g. Tekxit 3.14.
--
-- WHAT IT DOES
--   You paste a design code, the turtle fills the reactor to match it, pulling
--   parts from a chest. The reactor's redstone stays OFF the entire time, so
--   nothing can heat up while it is being built - powering it ON is the very
--   last step and only happens after you confirm. That is the safe reading of
--   "fuel goes in last": the reactor never runs until the build is done.
--
-- SETUP  (all directions are configurable below)
--        [ SUPPLY CHEST ]   <- all your components, any arrangement
--   ...  [   TURTLE     ] -> [ REACTOR ]
--   The turtle FACES the reactor, supply chest sits ABOVE the turtle, and the
--   turtle's BACK side feeds the reactor's redstone. Empty the reactor first.
--
-- IMPORTANT LIMITATION (a CC 1.12.2 fact, not a bug)
--   This ComputerCraft version cannot drop an item into a chosen reactor slot;
--   the reactor always fills its first empty slot. So the turtle fills slots in
--   order, which perfectly reproduces any GAP-FREE design (every used slot
--   filled) - exactly what the planner's auto-designer makes. A design with
--   holes in the middle can't be rebuilt this way; the turtle will offer to
--   pad the holes, or you can fill them in the planner first.
--
-- COMMANDS
--   reactor            menu
--   reactor build      paste a code, then build
--   reactor build CODE build straight from CODE
--   reactor scan       put an item in turtle slot 1 to see its id (fixes ids)
--   reactor on / off   switch the reactor's redstone
--========================================================================--

--=============================== CONFIG =================================--
local CONFIG = {
  reactorDir   = "front", -- the reactor
  supplyDir    = "up",    -- chest of fresh components
  redstoneSide = "back",  -- side that powers the reactor
  autoPadGaps  = true,    -- fill interior holes with plating if a design has them
}

-- design-code index -> { id = registry name, meta = metadata, fuel = bool }
-- Most ids are confirmed from the mod jar. A few standalone parts (marked ?)
-- could not be confirmed offline - if the turtle can't find one, run
-- "reactor scan" with that item in slot 1 and correct the id here.
local COMPONENTS = {
  -- fuel rods: one item, meta = uraniumType*3 + size (single/dual/quad)
  [0]  = { id = "ic2:itemreactorrods", meta = 0,  fuel = true },
  [1]  = { id = "ic2:itemreactorrods", meta = 1,  fuel = true },
  [2]  = { id = "ic2:itemreactorrods", meta = 2,  fuel = true },
  [3]  = { id = "ic2:itemreactorrods", meta = 3,  fuel = true },
  [4]  = { id = "ic2:itemreactorrods", meta = 4,  fuel = true },
  [5]  = { id = "ic2:itemreactorrods", meta = 5,  fuel = true },
  [6]  = { id = "ic2:itemreactorrods", meta = 6,  fuel = true },
  [7]  = { id = "ic2:itemreactorrods", meta = 7,  fuel = true },
  [8]  = { id = "ic2:itemreactorrods", meta = 8,  fuel = true },
  [9]  = { id = "ic2:itemreactorrods", meta = 9,  fuel = true },
  [10] = { id = "ic2:itemreactorrods", meta = 10, fuel = true },
  [11] = { id = "ic2:itemreactorrods", meta = 11, fuel = true },
  [12] = { id = "ic2:itemreactorrods", meta = 12, fuel = true },
  [13] = { id = "ic2:itemreactorrods", meta = 13, fuel = true },
  [14] = { id = "ic2:itemreactorrods", meta = 14, fuel = true },
  [15] = { id = "ic2:itemreactorrods", meta = 15, fuel = true },
  [16] = { id = "ic2:itemreactorrods", meta = 16, fuel = true },
  [17] = { id = "ic2:itemreactorrods", meta = 17, fuel = true },
  -- coolant cells
  [18] = { id = "ic2:itemheatstorage", meta = 0 },
  [19] = { id = "ic2:itemheatstorage", meta = 1 },
  [20] = { id = "ic2:itemheatstorage", meta = 2 },
  -- heat vents (0-3), steam vents (10-13), electric vents (20-23)
  [21] = { id = "ic2:itemheatvent", meta = 0 },
  [22] = { id = "ic2:itemheatvent", meta = 1 },
  [23] = { id = "ic2:itemheatvent", meta = 2 },
  [24] = { id = "ic2:itemheatvent", meta = 3 },
  [25] = { id = "ic2:reactorventspread", meta = 0 }, -- ? Component Heat Vent
  [26] = { id = "ic2:itemheatvent", meta = 10 },
  [27] = { id = "ic2:itemheatvent", meta = 11 },
  [28] = { id = "ic2:itemheatvent", meta = 12 },
  [29] = { id = "ic2:itemheatvent", meta = 13 },
  [30] = { id = "ic2:itemheatvent", meta = 20 },
  [31] = { id = "ic2:itemheatvent", meta = 21 },
  [32] = { id = "ic2:itemheatvent", meta = 22 },
  [33] = { id = "ic2:itemheatvent", meta = 23 },
  -- heat exchangers (note the mod's own "swtiches" typo)
  [34] = { id = "ic2:itemheatswtiches", meta = 0 },
  [35] = { id = "ic2:itemheatswtiches", meta = 1 },
  [36] = { id = "ic2:itemheatswtiches", meta = 2 },
  [37] = { id = "ic2:itemheatswtiches", meta = 3 },
  -- condensators
  [38] = { id = "ic2:itemcondensators", meta = 0 },
  [39] = { id = "ic2:itemcondensators", meta = 1 },
  -- plating
  [40] = { id = "ic2:itemreactorplating", meta = 0 },
  [41] = { id = "ic2:itemreactorplating", meta = 1 },
  [42] = { id = "ic2:itemreactorplating", meta = 2 },
  -- reflectors
  [43] = { id = "ic2:itemreflectors", meta = 0 },
  [44] = { id = "ic2:itemreflectors", meta = 1 },
  [45] = { id = "ic2:itemreflectors", meta = 2 },
  -- depleted isotope cells ? (umbrella item.itemDepletedRods)
  [46] = { id = "ic2:itemdepletedrods", meta = 0 },
  [47] = { id = "ic2:itemdepletedrods", meta = 1 },
  [48] = { id = "ic2:itemdepletedrods", meta = 2 },
  [49] = { id = "ic2:itemdepletedrods", meta = 3 },
  [50] = { id = "ic2:itemdepletedrods", meta = 4 },
  [51] = { id = "ic2:itemdepletedrods", meta = 5 },
  -- misc
  [52] = { id = "ic2:reactorheatpack", meta = 0 },        -- ? Heating Cell
  [53] = { id = "ic2:iteminactivefuelcell", meta = 0 },   -- Inactive Fuel Cell
}

-- Plating index used to pad interior holes when autoPadGaps is on
local PAD_INDEX = 40
--========================================================================--

-- Load the shared decoder / stats reader that sits next to this file
local rs
do
  local ok, mod = pcall(dofile, "reactorstats")
  if ok and type(mod) == "table" then rs = mod end
end

local function setPower(on)
  redstone.setOutput(CONFIG.redstoneSide, on and true or false)
end

local function label(idx)
  return (rs and rs.COMPONENTS[idx] and rs.COMPONENTS[idx].name) or ("component #" .. tostring(idx))
end

local function suckFn()
  return CONFIG.supplyDir == "up" and turtle.suckUp
    or CONFIG.supplyDir == "down" and turtle.suckDown or turtle.suck
end
local function dropReactor()
  return CONFIG.reactorDir == "up" and turtle.dropUp
    or CONFIG.reactorDir == "down" and turtle.dropDown or turtle.drop
end
local function dropSupply()
  return CONFIG.supplyDir == "up" and turtle.dropUp
    or CONFIG.supplyDir == "down" and turtle.dropDown or turtle.drop
end

-- Pull whatever the supply chest gives into the turtle's free slots
local function fillHand()
  local suck = suckFn()
  local pulled = true
  while pulled do
    pulled = false
    for s = 1, 16 do
      if turtle.getItemCount(s) == 0 then
        turtle.select(s)
        if suck() then pulled = true end
      end
    end
    -- stop once the turtle is full or the chest is empty
    local free = 0
    for s = 1, 16 do if turtle.getItemCount(s) == 0 then free = free + 1 end end
    if free == 0 then break end
    if not pulled then break end
  end
end

-- Find a turtle slot holding component idx (id+meta), pulling more if needed
local function findSlot(idx)
  local c = COMPONENTS[idx]
  if not c then return nil end
  local want = c.id .. "@" .. tostring(c.meta)
  local function scan()
    for s = 1, 16 do
      local dt = turtle.getItemDetail(s)
      if dt and dt.count > 0 and (dt.name .. "@" .. tostring(dt.damage)) == want then return s end
    end
    return nil
  end
  local s = scan()
  if s then return s end
  fillHand()          -- try to draw more from the chest
  return scan()
end

-- Drop one of component idx into the reactor's next empty slot
local function placeOne(idx)
  local s = findSlot(idx)
  if not s then return false, "out of " .. label(idx) .. " (id " .. (COMPONENTS[idx] and COMPONENTS[idx].id or "?") .. ")" end
  turtle.select(s)
  if not dropReactor()(1) then return false, "reactor refused " .. label(idx) end
  return true
end

-- Return everything still in the turtle to the supply chest
local function returnLeftovers()
  local drop = dropSupply()
  for s = 1, 16 do
    if turtle.getItemCount(s) > 0 then turtle.select(s); drop() end
  end
  turtle.select(1)
end

-- Ordered fill plan over the used slots (col < width), in slot index order.
-- Interior holes become plating pads (so first-empty insertion stays aligned).
local function planSlots(d)
  local order, gaps, lastFilled = {}, {}, -1
  for slot = 0, 53 do
    if slot % 9 < d.width then
      if d.cells[slot] then
        for _, g in ipairs(gaps) do order[#order + 1] = { slot = g, idx = PAD_INDEX, pad = true } end
        gaps = {}
        order[#order + 1] = { slot = slot, idx = d.cells[slot] }
        lastFilled = slot
      else
        gaps[#gaps + 1] = slot
      end
    end
  end
  return order, lastFilled
end

local function build(code)
  if not rs then print("Missing 'reactorstats' - run the installer again."); return end
  local d, err = rs.decode(code)
  if not d then print("Bad code: " .. tostring(err)); return end

  print(rs.report(code))
  print("")

  local order, lastFilled = planSlots(d)
  if lastFilled < 0 then print("Nothing to build - the design is empty."); return end
  local hasGaps = false
  for _, o in ipairs(order) do if o.pad then hasGaps = true end end
  if hasGaps then
    if not CONFIG.autoPadGaps then
      print("This design has holes the turtle can't skip on CC 1.12.2.")
      print("Fill them in the planner (or set autoPadGaps=true) and re-copy.")
      return
    end
    print("Heads up: design has holes - padding them with plating.")
  end

  write("Build this reactor now? [y/N] ")
  if read():lower():sub(1, 1) ~= "y" then print("Cancelled. Reactor left OFF."); return end

  setPower(false) -- OFF for the whole build - this is the safety guarantee
  print("Reactor OFF. Loading parts...")
  fillHand()

  for _, o in ipairs(order) do
    local ok, why = placeOne(o.idx)
    if not ok then
      setPower(false)
      returnLeftovers()
      print("Stopped at slot " .. o.slot .. ": " .. tostring(why))
      print("Reactor is OFF. Add the missing parts and build again.")
      return
    end
  end

  returnLeftovers()
  print("Built! Every part is placed and the reactor is still OFF.")
  write("Power it ON now? [y/N] ")
  if read():lower():sub(1, 1) == "y" then
    setPower(true)
    print("Reactor ON. Keep an eye on it the first run.")
  else
    print("Left OFF. Run 'reactor on' when you're ready.")
  end
end

local function scan()
  local dt = turtle.getItemDetail(1)
  if not dt then print("Put an item in the turtle's slot 1, then run 'reactor scan'."); return end
  print("id:   " .. dt.name)
  print("meta: " .. tostring(dt.damage))
  print("Match this to the COMPONENTS table in reactor.lua.")
end

local function menu()
  print("IC2 Reactor Builder")
  print(" 1) Build from a pasted code")
  print(" 2) Power ON")
  print(" 3) Power OFF")
  print(" 4) Scan the item in slot 1")
  print(" q) Quit")
  write("> ")
  local pick = read()
  if pick == "1" then write("Paste your design code: "); build(read())
  elseif pick == "2" then setPower(true); print("Reactor ON.")
  elseif pick == "3" then setPower(false); print("Reactor OFF.")
  elseif pick == "4" then scan() end
end

-- Entry point, fully guarded: any error powers the reactor OFF first
local args = { ... }
local ok, err = pcall(function()
  if args[1] == "build" then
    if args[2] then build(args[2]) else write("Paste your design code: "); build(read()) end
  elseif args[1] == "scan" then scan()
  elseif args[1] == "on" then setPower(true); print("Reactor ON.")
  elseif args[1] == "off" then setPower(false); print("Reactor OFF.")
  elseif args[1] then build(args[1])
  else menu() end
end)
if not ok then
  setPower(false)
  print("Error (reactor forced OFF): " .. tostring(err))
end
