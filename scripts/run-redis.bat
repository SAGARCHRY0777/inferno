@echo off
REM ===========================================================================
REM Inferno - start the bundled portable Redis (Windows, no install/admin).
REM If you run your own Redis/Memurai/Docker, skip this and set INFERNO_REDIS__URL.
REM ===========================================================================
setlocal
pushd "%~dp0.."

set REDIS=tools\redis\redis-server.exe
if not exist "%REDIS%" (
  echo [Inferno] Bundled Redis not found at %REDIS%.
  echo           Download it once with: scripts\fetch-redis.ps1
  echo           ...or point INFERNO_REDIS__URL at your own Redis/Memurai.
  goto :end
)

REM Bind to loopback only: no Windows Firewall prompt, no LAN exposure, works on any PC.
echo [Inferno] Starting Redis on 127.0.0.1:6379  (Ctrl+C to stop)
"%REDIS%" --bind 127.0.0.1 --protected-mode yes

:end
popd
endlocal
