-- IC2 Reactor Manager installer for ComputerCraft (Tekxit 3.14)
-- Grabs reactor.lua from the planner site and optionally sets it to run on boot.
--
--   wget https://windingduke77.github.io/ic2-reactor-planner/cc/installer.lua installer
--   installer

local URL = "https://windingduke77.github.io/ic2-reactor-planner/cc/reactor.lua"

if not http then
  print("HTTP is disabled on this computer.")
  print("Enable it in the server's computercraft config")
  print("(http_enable=true), then run the installer again.")
  return
end

write("Downloading reactor manager... ")
local response = http.get(URL)
if not response then
  print("failed!")
  print("Could not reach " .. URL)
  return
end

local body = response.readAll()
response.close()

local file = fs.open("reactor", "w")
file.write(body)
file.close()
print("done (" .. #body .. " bytes).")

print("")
write("Run automatically on boot? [y/N] ")
local answer = read()
if answer:lower():sub(1, 1) == "y" then
  local startup = fs.open("startup", "w")
  startup.write('shell.run("reactor")')
  startup.close()
  print("Wrote startup file.")
end

print("")
print("Setup: place this TURTLE against the reactor,")
print("chest of fresh parts ABOVE it, waste chest BELOW.")
print("Edit the config block at the top of 'reactor'")
print("to match your sides and fuel, then run: reactor")
