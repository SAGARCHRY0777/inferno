@echo off
REM ===========================================================================
REM Inferno - close EVERYTHING that run-all.bat opened in one go:
REM   Redis + gateway + the 6 model workers + chat + frontend, and their windows.
REM Safe to run anytime; it silently ignores whatever isn't running.
REM ===========================================================================
echo [Inferno] Stopping all Inferno windows and services...

REM 1) Close the consoles run-all opened (cmd.exe windows titled "Inferno ...")
REM    plus their child processes (redis-server / python / node) via /T.
REM    The IMAGENAME filter restricts to cmd.exe so a BROWSER tab whose title also
REM    starts with "Inferno" (e.g. the app page) is NEVER touched.
taskkill /F /T /FI "IMAGENAME eq cmd.exe" /FI "WINDOWTITLE eq Inferno*" >nul 2>&1

REM 2) Fallback: free the known ports in case a window lost its "Inferno" title
REM    (e.g. a tool renamed it). Only LISTENING server sockets are matched.
for %%P in (6379 8000 8100 5173) do (
  for /f "tokens=5" %%I in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%%P"') do (
    taskkill /F /PID %%I >nul 2>&1
  )
)

REM 3) Fallback: the bundled portable Redis, if it ran outside an Inferno window.
taskkill /F /IM redis-server.exe >nul 2>&1

echo [Inferno] Done - all Inferno services stopped.
timeout /t 2 >nul
