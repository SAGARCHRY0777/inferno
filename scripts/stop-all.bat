@echo off
REM ===========================================================================
REM Inferno - close EVERYTHING run-all.bat opened (Redis, gateway, 6 workers,
REM chat, frontend) and their windows. Safe to run anytime.
REM ===========================================================================
echo [Inferno] Stopping all Inferno windows and services...

REM 1) Most robust: find the launcher consoles by the run-*.bat they're running
REM    (works even when a tool like npm/vite RENAMES the window title) and kill
REM    each window's whole process tree -- so the shell AND the server both go.
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cmd.exe' -and $_.CommandLine -match 'run-(redis|backend|worker|chat|frontend)\.bat' } | ForEach-Object { taskkill /F /T /PID $_.ProcessId 2>$null | Out-Null }" >nul 2>&1

REM 2) Also match by window title (covers any still titled "Inferno ...").
taskkill /F /T /FI "IMAGENAME eq cmd.exe" /FI "WINDOWTITLE eq Inferno*" >nul 2>&1

REM 3) Fallback: free the known server ports in case anything is left listening.
for %%P in (6379 8000 8100 5173) do (
  for /f "tokens=5" %%I in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%%P"') do (
    taskkill /F /PID %%I >nul 2>&1
  )
)

REM 4) Fallback: the bundled portable Redis, if it ran outside an Inferno window.
taskkill /F /IM redis-server.exe >nul 2>&1

echo [Inferno] Done - all Inferno windows and services stopped.
timeout /t 2 >nul
