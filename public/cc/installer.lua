-- IC2 Reactor Builder installer for ComputerCraft (Tekxit 3.14)
-- Downloads the builder + its stats reader, then offers to build right away.
--
--   wget run https://windingduke77.github.io/ic2-reactor-planner/cc/installer.lua
--   (or)  wget https://windingduke77.github.io/ic2-reactor-planner/cc/installer.lua installer && installer

local BASE = "https://windingduke77.github.io/ic2-reactor-planner/cc/"
local FILES = { "reactor.lua", "reactorstats.lua" }

if not http then
  print("HTTP is disabled on this computer.")
  print("Enable it in the server's ComputerCraft config")
  print("(http_enable=true), then run the installer again.")
  return
end

for _, name in ipairs(FILES) do
  write("Downloading " .. name .. "... ")
  local response = http.get(BASE .. name)
  if not response then
    print("failed!")
    print("Could not reach " .. BASE .. name)
    return
  end
  local body = response.readAll()
  response.close()
  local file = fs.open(name:gsub("%.lua$", ""), "w") -- save as "reactor" / "reactorstats"
  file.write(body)
  file.close()
  print("ok (" .. #body .. " bytes)")
end

print("")
print("Setup: TURTLE facing the reactor, a chest of parts")
print("ABOVE it, and its BACK side feeding the reactor's")
print("redstone. (Change sides in reactor's CONFIG if needed.)")
print("")

write("Build a reactor now? [Y/n] ")
local answer = read()
if answer:lower():sub(1, 1) ~= "n" then
  shell.run("reactor", "build")
else
  print("When ready: reactor build  (then paste your design code)")
end
