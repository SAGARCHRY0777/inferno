@echo off
REM ===========================================================================
REM Inferno - run the React/Vite operations console (dev server on :5173).
REM Installs node_modules on first run. Proxies /api + WS to the gateway.
REM ===========================================================================
setlocal
pushd "%~dp0..\frontend"

if not exist "node_modules" (
  echo [Inferno] Installing frontend dependencies on first run...
  call npm install
  if errorlevel 1 goto :npmfail
)

echo [Inferno] Frontend starting on http://localhost:5173
call npm run dev
goto :end

:npmfail
echo [Inferno] ERROR: npm install failed. Is Node 20+ installed?

:end
popd
endlocal
