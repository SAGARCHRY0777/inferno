@echo off
REM ===========================================================================
REM Inferno - record the product demo (webm video + looping GIF).
REM
REM Prereq: the stack is already running (scripts\run-all.bat) so the gateway
REM is live on :8000 with at least the dummy-echo worker. The heavier models
REM (yolo/whisper) are toured automatically if their workers are up.
REM
REM Serves the prebuilt static `frontend\dist` on :4173 (it is baked to talk to
REM the gateway at 127.0.0.1:8000), drives a ~50s scripted demo with Playwright,
REM then assembles the GIF with Pillow. Output -> docs\demo\
REM ===========================================================================
setlocal
pushd "%~dp0.."

for /f "usebackq tokens=*" %%i in (`conda info --base 2^>nul`) do set CONDA_BASE=%%i
set PYEXE=%CONDA_BASE%\envs\test\python.exe
if not exist "%PYEXE%" (
  echo [Inferno] ERROR: conda env "test" python not found. Run install first.
  goto :end
)

if not exist "frontend\dist\index.html" (
  echo [Inferno] Building frontend (no dist found)...
  pushd frontend
  call npm run build
  popd
)

REM Serve the prebuilt (gateway-direct) dist on :5173 — the CORS-allowed origin.
REM If run-all's Vite already owns :5173 that's fine too; the capture just uses it.
echo [Inferno] Serving static dist on http://localhost:5173 ...
start "Inferno DemoServer" cmd /c "%PYEXE% -m http.server 5173 --directory frontend\dist >nul 2>&1"
REM give the static server a moment
ping -n 3 127.0.0.1 >nul

echo [Inferno] Recording demo (Playwright) ...
set DEMO_URL=http://localhost:5173
pushd frontend
call node demo-capture.mjs
popd

echo [Inferno] Building GIF (Pillow) ...
"%PYEXE%" scripts\make_gif.py

REM stop our static server (no-op if Vite was serving 5173)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5173 .*LISTENING"') do taskkill /f /pid %%p >nul 2>&1

echo [Inferno] Done. See docs\demo\inferno-demo.gif and docs\demo\inferno-demo.webm

:end
popd
endlocal
