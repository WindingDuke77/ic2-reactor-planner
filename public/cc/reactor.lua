--========================================================================--
-- reactor.lua - IC2 Classic reactor operator for a ComputerCraft turtle
-- (CC: Tweaked 1.12.2 / IC2 Classic, e.g. Tekxit 3.14 Pi)
--
-- Companion to the IC2 Reactor Planner:
--   https://windingduke77.github.io/ic2-reactor-planner/
--
-- The planner proves a design STABLE. This program keeps it FED:
--   * holds a redstone signal on the reactor so it actually runs
--   * counts powered seconds; when the rods are spent it services the core
--   * service = pull everything out, junk to the waste chest, parts back
--     in the same order they came out (so the layout survives), and a
--     fresh rod from the supply chest into every old rod slot
--   * fails SAFE: any error, missing fuel, or confusion -> redstone OFF
--     first, questions later. An unpowered reactor just idles while the
--     vents keep cooling the hull. It cannot melt down while off.
--
-- Physical setup (matches the default CONFIG below):
--
--                [ supply chest ]   <- fresh fuel rods ONLY
--   [ buffer ] [[    TURTLE    ]] [ REACTOR ]
--                [ waste chest  ]   <- depleted rods + junk land here
--
--   * The turtle FACES the reactor.
--   * The buffer chest is optional scratch space to the turtle's LEFT,
--     for layouts with more parts than the turtle's 16 slots can hold.
--   * Hand-load the reactor with your proven design once, using fresh
--     rods, then run this program. It handles every refuel after that.
--
-- IMPORTANT design rule: fill EVERY grid cell in the planner (pad spare
-- cells with plating) and use one rod type only. Item inventories refill
-- "first empty slot", so a design with holes can shift during a service
-- pass; a completely full grid goes back together exactly as it was.
--
-- There is no heat readout available to CC in this pack, so this program
-- never guesses about heat - it relies on YOU running a planner-proven
-- stable design, and simply keeps that design fed and powered.
--
-- Keys while running:   M = service now   R = reset rod clock   Q = quit
-- One-off helpers:      "reactor id"      print name/damage of the item
--                                         in turtle slot 1 (put a rod in)
--                       "reactor reset"   forget the saved rod clock
--========================================================================--

--=========================== CONFIG - edit me ===========================--

local CONFIG = {
  -- Directions, relative to the turtle: "front", "up" or "down".
  reactorDir   = "front",  -- the reactor itself
  supplyDir    = "up",     -- chest of FRESH fuel rods (fuel only, please)
  wasteDir     = "down",   -- chest for spent rods and anything unknown

  -- Optional overflow chest for big layouts. The turtle TURNS to reach
  -- it, so it must sit level with the turtle: "left", "right" or "none".
  bufferTurn   = "left",

  -- Which side of the turtle emits the run signal into the reactor.
  redstoneSide = "front",

  -- The fuel rod to keep the reactor stocked with. Not sure of the
  -- values? Put a fresh rod in turtle slot 1 and run:  reactor id
  fuelName     = "ic2:reactoruraniumrod",
  fuelDamage   = 0,        -- damage/meta of a FRESH rod (-1 = accept any)

  -- Seconds of POWERED runtime before the rods are spent and the core
  -- gets serviced. Use the planner's "Runtime" stat for your design
  -- (a plain Uranium Cell burns for 10000 seconds).
  rodLifetime  = 10000,

  -- Seconds between maintenance passes (rod clock check + state save).
  maintenanceEvery = 60,

  -- Duty cycle. 0 / 0 = run continuously. Otherwise: run for runSeconds,
  -- then coast unpowered for restSeconds. Rods stop burning while
  -- unpowered but the vents keep cooling, so resting sheds hull heat.
  runSeconds   = 0,
  restSeconds  = 0,

  -- Items whose name contains any of these are treated as spent fuel:
  -- sent to the waste chest, and their slot gets a fresh rod.
  wastePatterns = { "depleted", "neardepleted" },
}

--================= no user-serviceable parts below this =================--

local tArgs = { ... }

local TICK = 1                       -- seconds per control-loop tick
local STATE_FILE = "reactor.state"   -- survives reboots and server restarts

local state = {
  rodSeconds   = 0,  -- powered seconds since the current rods went in
  rodsFed      = 0,  -- fresh rods installed over this program's lifetime
  swaps        = 0,  -- completed service passes
  poweredTotal = 0,  -- lifetime powered seconds
}

local status  = "STARTING"
local lastMsg = nil
local mon     = nil
local rsOn    = false

-- Directional turtle functions, bound from CONFIG by bindSides() below.
local suckReactor, rawDropReactor, suckSupply, dropWaste

--============================ small utilities ===========================--

local function log(msg)
  lastMsg = msg
  print(("[%s] %s"):format(textutils.formatTime(os.time(), true), msg))
end

local function fmtTime(s)
  s = math.max(0, math.floor(s))
  local h = math.floor(s / 3600)
  local m = math.floor((s % 3600) / 60)
  if h > 0 then return ("%dh %02dm"):format(h, m) end
  if m > 0 then return ("%dm %02ds"):format(m, s % 60) end
  return ("%ds"):format(s)
end

local function saveState()
  local f = fs.open(STATE_FILE, "w")
  if f then
    f.write(textutils.serialize(state))
    f.close()
  end
end

local function loadState()
  if not fs.exists(STATE_FILE) then return end
  local f = fs.open(STATE_FILE, "r")
  if not f then return end
  local data = textutils.unserialize(f.readAll() or "")
  f.close()
  if type(data) ~= "table" then return end
  -- only accept fields we know, with the right types
  for k, v in pairs(state) do
    if type(data[k]) == type(v) then state[k] = data[k] end
  end
end

local function setRs(on)
  rsOn = on
  rs.setOutput(CONFIG.redstoneSide, on)
end

-- The nuclear option (the good kind): silence every side.
local function killAllRedstone()
  for _, side in ipairs(rs.getSides()) do
    rs.setOutput(side, false)
  end
  rsOn = false
end

-- Drop any stale queued events (keypresses mashed during a long service
-- pass should not trigger a second one).
local function flushEvents()
  os.queueEvent("reactor_flush")
  while os.pullEvent() ~= "reactor_flush" do end
end

--============================ status display ============================--

local function setupMonitor()
  mon = peripheral.find("monitor")
  if not mon then return end
  mon.setTextScale(1)
  local w = mon.getSize()
  if w < 22 then mon.setTextScale(0.5) end
end

local function draw()
  if not mon then return end
  local w, h = mon.getSize()
  local isColor = mon.isColor()
  mon.setBackgroundColor(colors.black)
  mon.setTextColor(colors.white)
  mon.clear()

  local pct = math.min(100, math.floor(state.rodSeconds / math.max(1, CONFIG.rodLifetime) * 100))
  local stateColor = colors.white
  if isColor then
    if status == "RUNNING" then stateColor = colors.lime
    elseif status == "SERVICING" then stateColor = colors.yellow
    elseif status == "RESTING" then stateColor = colors.lightBlue
    else stateColor = colors.red end
  end

  local line = 1
  local function put(text, color)
    if line > h then return end
    mon.setCursorPos(1, line)
    if isColor and color then mon.setTextColor(color) end
    mon.write(text:sub(1, w))
    if isColor then mon.setTextColor(colors.white) end
    line = line + 1
  end

  put("IC2 REACTOR OPERATOR")
  put(string.rep("-", math.min(w, 21)))
  put("State:     " .. status, stateColor)
  put(("Rod wear:  %d%%"):format(pct))
  put("Next swap: " .. fmtTime(CONFIG.rodLifetime - state.rodSeconds))
  put("Rods fed:  " .. state.rodsFed)
  put("Services:  " .. state.swaps)
  put("Powered:   " .. fmtTime(state.poweredTotal))
  if lastMsg then
    put("")
    put(lastMsg)
  end
end

local function statusLine()
  local pct = math.min(100, math.floor(state.rodSeconds / math.max(1, CONFIG.rodLifetime) * 100))
  return ("%s | rods %d%% spent | next service in %s | rods fed %d")
    :format(status, pct, fmtTime(CONFIG.rodLifetime - state.rodSeconds), state.rodsFed)
end

--========================== inventory plumbing ==========================--

local function firstEmptySlot()
  for i = 1, 16 do
    if turtle.getItemCount(i) == 0 then return i end
  end
  return nil
end

local function findInTurtle(name)
  for i = 1, 16 do
    local d = turtle.getItemDetail(i)
    if d and d.name == name then return i end
  end
  return nil
end

-- Is this a fresh rod of the configured type?
local function isFreshRod(d)
  return d.name == CONFIG.fuelName
    and (CONFIG.fuelDamage < 0 or d.damage == CONFIG.fuelDamage)
end

-- During a drain, EVERYTHING with the fuel's item name is old by
-- definition (fresh rods never enter the reactor between services), and
-- anything matching wastePatterns is a depleted leftover. Both mark a
-- rod slot and both belong in the waste chest.
local function isSpentFuel(d)
  if d.name == CONFIG.fuelName then return true end
  local lower = string.lower(d.name)
  for _, pat in ipairs(CONFIG.wastePatterns) do
    if lower:find(pat, 1, true) then return true end
  end
  return false
end

-- Merge the stack in `slot` into any existing matching stack, so
-- stackable parts (pristine vents, plating) share turtle slots.
local function compact(slot)
  local d = turtle.getItemDetail(slot)
  if not d then return end
  for i = 1, 16 do
    if i ~= slot then
      local e = turtle.getItemDetail(i)
      if e and e.name == d.name and e.damage == d.damage then
        turtle.select(slot)
        turtle.transferTo(i)
        if turtle.getItemCount(slot) == 0 then return end
      end
    end
  end
end

-- Send the stack in `slot` to the waste chest, waiting politely if the
-- chest is full. Never gives up: waste MUST leave the work area.
local function wasteAway(slot)
  turtle.select(slot)
  while turtle.getItemCount(slot) > 0 do
    if not dropWaste() then
      log("Waste chest is full! Empty it and I will carry on.")
      sleep(10)
      turtle.select(slot)
    end
  end
end

local function turnToBuffer()
  if CONFIG.bufferTurn == "left" then turtle.turnLeft() else turtle.turnRight() end
end

local function turnBack()
  if CONFIG.bufferTurn == "left" then turtle.turnRight() else turtle.turnLeft() end
end

-- Park the turtle's whole inventory in the buffer chest. Returns false
-- if no buffer chest is configured.
local function unloadToBuffer()
  if CONFIG.bufferTurn == "none" then return false end
  turnToBuffer()
  for i = 1, 16 do
    if turtle.getItemCount(i) > 0 then
      turtle.select(i)
      while turtle.getItemCount(i) > 0 do
        if not turtle.drop() then
          log("Buffer chest is full! Make room and I will carry on.")
          sleep(10)
        end
      end
    end
  end
  turnBack()
  return true
end

-- Drop from the selected slot into the reactor, with a few retries.
local function dropReactor(count)
  for _ = 1, 10 do
    local ok
    if count then ok = rawDropReactor(count) else ok = rawDropReactor() end
    if ok then return true end
    sleep(1)
  end
  return false
end

-- Shove every turtle stack into the reactor, positions be damned.
-- Only used on the safety fallback paths.
local function dumpAllIntoReactor()
  for i = 1, 16 do
    if turtle.getItemCount(i) > 0 then
      turtle.select(i)
      dropReactor()
    end
  end
end

--=========================== fuel and parts =============================--

-- Return a turtle slot holding a fresh rod, pulling from the supply
-- chest as needed. Blocks (reactor is already off) until fuel appears.
-- Junk found in the supply chest is exiled to the waste chest.
local function getFreshRod()
  for i = 1, 16 do
    local d = turtle.getItemDetail(i)
    if d and isFreshRod(d) then return i end
  end
  local warned = false
  while true do
    local free = firstEmptySlot()
    if not free then
      if not unloadToBuffer() then
        return nil, "no free slot to fetch fuel into"
      end
      free = firstEmptySlot()
    end
    turtle.select(free)
    if suckSupply(1) then
      local d = turtle.getItemDetail(free)
      if d and isFreshRod(d) then
        if status == "OUT OF FUEL" then
          status = "SERVICING"
          log("Fuel restocked. Back to it.")
          draw()
        end
        return free
      end
      log("Non-fuel item in the supply chest - moving it to waste.")
      wasteAway(free)
    else
      if not warned then
        status = "OUT OF FUEL"
        log("Supply chest is empty! Stock it with " .. CONFIG.fuelName ..
          " and I will finish the service pass.")
        draw()
        warned = true
      end
      sleep(15)
    end
  end
end

-- Return a turtle slot holding a part with this name, fishing through
-- the buffer chest if needed. Returns nil, err if it truly cannot.
local function findPart(name)
  local slot = findInTurtle(name)
  if slot then return slot end
  if CONFIG.bufferTurn == "none" then
    return nil, "ran out of " .. name .. " (and there is no buffer chest to search)"
  end
  for _ = 1, 2 do
    -- pull from the buffer until the part shows up or we run dry
    turnToBuffer()
    while true do
      local free = firstEmptySlot()
      if not free then break end
      turtle.select(free)
      if not turtle.suck() then break end
      compact(free)
      if findInTurtle(name) then break end
    end
    turnBack()
    slot = findInTurtle(name)
    if slot then return slot end
    if firstEmptySlot() then
      -- the buffer is empty and the part is nowhere: genuinely missing
      return nil, "could not find a " .. name .. " for the rebuild"
    end
    -- the turtle is stuffed with parts needed later; park them, retry once
    unloadToBuffer()
  end
  return nil, "layout too tangled to rebuild in order"
end

--========================== drain and rebuild ===========================--

-- Empty the reactor one slot at a time. turtle.suck always pulls from
-- the first occupied slot, so items come out in slot order - that order
-- IS the layout. We write it down as a logbook of positions:
--   { kind = "fuel" }              spent rod slot (item went to waste)
--   { kind = "part", name = ... }  a component we kept (turtle/buffer)
-- Returns the logbook, or nil + error if the turtle ran out of room.
local function drain()
  local logbook = {}
  while true do
    local slot = firstEmptySlot()
    if not slot then
      if not unloadToBuffer() then
        return nil, "turtle is full and there is no buffer chest (see CONFIG.bufferTurn)"
      end
      slot = firstEmptySlot()
    end
    turtle.select(slot)
    if not suckReactor() then break end -- reactor is empty
    local d = turtle.getItemDetail(slot)
    if not d then break end             -- should never happen; bail safely
    for _ = 1, d.count do
      if isSpentFuel(d) then
        logbook[#logbook + 1] = { kind = "fuel" }
      else
        logbook[#logbook + 1] = { kind = "part", name = d.name }
      end
    end
    if isSpentFuel(d) then wasteAway(slot) else compact(slot) end
  end
  return logbook
end

-- Refill the empty reactor by replaying the logbook. Inserting into an
-- empty inventory fills slots in ascending order, so replaying the
-- drain order rebuilds the exact layout: same part names in the same
-- positions, fresh rods where the spent ones sat.
-- Returns rods fed, or nil + error + rods still owed.
local function rebuild(logbook)
  local totalRods = 0
  for _, e in ipairs(logbook) do
    if e.kind == "fuel" then totalRods = totalRods + 1 end
  end
  local fed = 0
  for i = 1, #logbook do
    local entry = logbook[i]
    local slot, err
    if entry.kind == "fuel" then
      slot, err = getFreshRod()
    else
      slot, err = findPart(entry.name)
    end
    if not slot then
      return nil, err or "rebuild lost track of an item", totalRods - fed
    end
    turtle.select(slot)
    if not dropReactor(1) then
      return nil, "the reactor refused an item mid-rebuild", totalRods - fed
    end
    if entry.kind == "fuel" then fed = fed + 1 end
  end
  return fed
end

--============================ safety states =============================--

-- Dead stop: reactor off, wait for a human. R resumes with a fresh rod
-- clock, Q quits (the top-level handler leaves the redstone off).
local function haltLatch(msg)
  status = "HALTED"
  setRs(false)
  saveState()
  log(msg)
  log("Reactor is OFF. Press R to reset the rod clock and resume, or Q to quit.")
  draw()
  while true do
    local ev, p1 = os.pullEvent()
    if ev == "char" then
      local c = string.lower(p1)
      if c == "r" then
        state.rodSeconds = 0
        saveState()
        status = "RUNNING"
        setRs(true)
        log("Resuming. Keep an eye on it for a minute.")
        draw()
        return
      elseif c == "q" then
        error("stopped by operator at the halt prompt", 0)
      end
    end
  end
end

-- Ordered rebuild fell apart: get every part back inside (any order),
-- feed the rods still owed, then refuse to run until a human checks the
-- layout against the planner. Safe, if a little embarrassing.
local function rebuildLoose(rodsNeeded)
  log("Reinserting everything without ordering...")
  dumpAllIntoReactor()
  if CONFIG.bufferTurn ~= "none" then
    while true do
      turnToBuffer()
      local pulled = false
      while true do
        local free = firstEmptySlot()
        if not free then break end
        turtle.select(free)
        if not turtle.suck() then break end
        pulled = true
      end
      turnBack()
      if not pulled then break end
      dumpAllIntoReactor()
    end
  end
  for _ = 1, rodsNeeded or 0 do
    local slot = getFreshRod()
    if not slot then break end
    turtle.select(slot)
    dropReactor(1)
  end
  haltLatch("Layout may be scrambled! Compare the reactor with your planner design before resuming.")
end

--============================ the service pass ==========================--

local function service()
  status = "SERVICING"
  setRs(false) -- rule one: never touch the inventory while it is running
  draw()
  log("Service time: powering down and pulling the core apart.")
  sleep(1)

  local logbook, err = drain()
  if not logbook then
    log("Drain aborted: " .. err)
    dumpAllIntoReactor()
    haltLatch("Parts went back in, but the layout is suspect. " ..
      "Add a buffer chest beside the turtle for layouts this large.")
    return
  end

  if #logbook == 0 then
    haltLatch("The reactor was empty. Hand-load your proven design (fresh rods), then resume.")
    return
  end

  local rods = 0
  for _, e in ipairs(logbook) do
    if e.kind == "fuel" then rods = rods + 1 end
  end
  log(("Drained %d items, %d of them rod slots. Rebuilding..."):format(#logbook, rods))
  if rods == 0 then
    log("Odd: no fuel found inside. Check CONFIG.fuelName (try: reactor id).")
  end

  local fed, rerr, owed = rebuild(logbook)
  if not fed then
    log("Ordered rebuild failed: " .. tostring(rerr))
    rebuildLoose(owed)
    return
  end

  for i = 1, 16 do
    if turtle.getItemCount(i) > 0 then
      log("Note: leftover items are still sitting in the turtle.")
      break
    end
  end

  state.rodSeconds = 0
  state.swaps = state.swaps + 1
  state.rodsFed = state.rodsFed + fed
  saveState()
  log(("Service done: %d fresh rods installed. Back to work."):format(fed))
  status = "RUNNING"
  setRs(true)
  draw()
end

--============================== main loop ===============================--

local function bindSides()
  local SUCK = { front = turtle.suck, up = turtle.suckUp, down = turtle.suckDown }
  local DROP = { front = turtle.drop, up = turtle.dropUp, down = turtle.dropDown }
  suckReactor    = assert(SUCK[CONFIG.reactorDir], "CONFIG.reactorDir must be front, up or down")
  rawDropReactor = DROP[CONFIG.reactorDir]
  suckSupply     = assert(SUCK[CONFIG.supplyDir], "CONFIG.supplyDir must be front, up or down")
  dropWaste      = assert(DROP[CONFIG.wasteDir], "CONFIG.wasteDir must be front, up or down")
  assert(CONFIG.bufferTurn == "left" or CONFIG.bufferTurn == "right" or CONFIG.bufferTurn == "none",
    "CONFIG.bufferTurn must be left, right or none")
end

local function main()
  print("IC2 Reactor Operator - planner companion")
  print("https://windingduke77.github.io/ic2-reactor-planner/")
  print("")

  bindSides()
  setupMonitor()
  loadState()

  -- The turtle inventory is our workbench; it has to start clear.
  for i = 1, 16 do
    if turtle.getItemCount(i) > 0 then
      error("empty the turtle's inventory first - all 16 slots are my workbench", 0)
    end
  end

  log("Online. Keys: M = service now, R = reset rod clock, Q = quit.")
  if mon then log("Monitor found - status screen is up.") end
  if state.rodSeconds > 0 then
    log(("Resuming a rod cycle at %s of %s powered.")
      :format(fmtTime(state.rodSeconds), fmtTime(CONFIG.rodLifetime)))
  end

  status = "RUNNING"
  setRs(true)
  draw()

  local sinceMaint = 0
  local phase, phaseT = "run", 0
  local timer = os.startTimer(TICK)

  while true do
    local ev, p1 = os.pullEvent()

    if ev == "timer" and p1 == timer then
      -- duty cycle bookkeeping (only if both knobs are set)
      if CONFIG.runSeconds > 0 and CONFIG.restSeconds > 0 then
        phaseT = phaseT + TICK
        if phase == "run" and phaseT >= CONFIG.runSeconds then
          phase, phaseT = "rest", 0
          status = "RESTING"
          setRs(false)
          log(("Duty cycle: coasting for %s - vents keep cooling."):format(fmtTime(CONFIG.restSeconds)))
        elseif phase == "rest" and phaseT >= CONFIG.restSeconds then
          phase, phaseT = "run", 0
          status = "RUNNING"
          setRs(true)
          log("Duty cycle: back to work.")
        end
      end

      -- rods only burn while the signal is on
      if rsOn then
        state.rodSeconds = state.rodSeconds + TICK
        state.poweredTotal = state.poweredTotal + TICK
      end

      -- periodic maintenance pass: persist state, report, check the clock
      sinceMaint = sinceMaint + TICK
      if sinceMaint >= CONFIG.maintenanceEvery then
        sinceMaint = 0
        saveState()
        if not mon then log(statusLine()) end
      end

      if state.rodSeconds >= CONFIG.rodLifetime then
        service()
        flushEvents()
        phase, phaseT = "run", 0
      end

      draw()
      timer = os.startTimer(TICK)

    elseif ev == "char" then
      local c = string.lower(p1)
      if c == "q" then
        log("Shutting down. Redstone off; the reactor idles and cools.")
        break
      elseif c == "m" then
        service()
        flushEvents()
        timer = os.startTimer(TICK)
      elseif c == "r" then
        state.rodSeconds = 0
        saveState()
        log("Rod clock reset to zero.")
        draw()
      end
    end
  end
end

--=========================== program entry ==============================--

if tArgs[1] == "id" then
  -- helper: identify the item in slot 1 so CONFIG can be filled in
  if not turtle then
    print("Run this on a turtle.")
    return
  end
  local d = turtle.getItemDetail(1)
  if not d then
    print("Put the item in turtle slot 1 first, then run: reactor id")
  else
    print("name   = " .. d.name)
    print("damage = " .. tostring(d.damage))
    print("count  = " .. tostring(d.count))
    print("Copy name/damage into the CONFIG block at the top of this file.")
  end
  return
end

if tArgs[1] == "reset" then
  if fs.exists(STATE_FILE) then
    fs.delete(STATE_FILE)
    print("Saved rod clock forgotten. Next run assumes fresh rods.")
  else
    print("No saved state to forget.")
  end
  return
end

if not turtle then
  print("This program runs on a TURTLE parked next to the reactor.")
  print("See the setup notes in the comments at the top of this file.")
  return
end

-- Everything runs inside pcall so that no matter HOW it ends - error,
-- Ctrl+T, operator quit - the redstone dies before the program does.
local ok, err = pcall(main)

killAllRedstone()
pcall(saveState)

if ok then
  print("reactor: stopped cleanly. Redstone is OFF.")
else
  printError("reactor: " .. tostring(err))
  printError("Redstone is OFF; the reactor is idle and cooling. Fix the issue and rerun.")
end
