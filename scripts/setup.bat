@echo off
REM ===========================================================================
REM Inferno - ONE-TIME setup on a fresh PC. Installs EVERYTHING the project
REM needs (Python env + ML deps, frontend deps, portable Redis), then you just
REM run:  scripts\run-all.bat
REM
REM PREREQUISITES you install yourself first (they need admin):
REM   * Miniconda   -> https://docs.conda.io/en/latest/miniconda.html
REM   * Node.js 20+ -> https://nodejs.org
REM   Run this from an "Anaconda Prompt" so `conda` is on PATH (or run
REM   `conda init cmd.exe` once, then reopen the terminal).
REM
REM Usage:  scripts\setup.bat         (CPU stack - works everywhere)
REM         scripts\setup.bat gpu     (CUDA 12.4 stack - NVIDIA GPU)
REM ===========================================================================
setlocal
pushd "%~dp0.."
set HERE=%~dp0

REM --- prerequisite checks --------------------------------------------------
where conda >nul 2>&1
if errorlevel 1 (
  echo [Inferno] ERROR: 'conda' not found.
  echo            Install Miniconda, then run this from an Anaconda Prompt
  echo            ^(or run 'conda init cmd.exe' once and reopen the terminal^).
  goto :end
)
where npm >nul 2>&1
if errorlevel 1 (
  echo [Inferno] ERROR: 'npm' / Node.js not found. Install Node.js 20+ from https://nodejs.org
  goto :end
)

echo [Inferno] ============================================================
echo [Inferno]  Inferno setup starting. This downloads a few GB on first run.
echo [Inferno] ============================================================

REM --- 1) Python env + ML deps (CPU default; 'gpu' arg for CUDA 12.4) --------
if /i "%1"=="gpu" (
  echo [Inferno] [1/3] Installing the GPU ^(CUDA 12.4^) Python stack into conda env "test"...
  call "%HERE%install-gpu.bat"
) else (
  echo [Inferno] [1/3] Installing the CPU Python stack into conda env "test"...
  call "%HERE%install-cpu.bat"
)

REM --- 2) Frontend dependencies (clean, lockfile-exact) ---------------------
echo [Inferno] [2/3] Installing frontend dependencies (npm ci)...
pushd frontend
call npm ci
if errorlevel 1 call npm install
popd

REM --- 3) Portable Redis (no admin needed) ----------------------------------
if exist "tools\redis\redis-server.exe" (
  echo [Inferno] [3/3] Portable Redis already present - skipping.
) else (
  echo [Inferno] [3/3] Downloading portable Redis...
  powershell -ExecutionPolicy Bypass -File "%HERE%fetch-redis.ps1"
)

echo.
echo [Inferno] ============================================================
echo [Inferno]  Setup complete. Start the whole platform with:
echo [Inferno]      scripts\run-all.bat
echo [Inferno]  Then open  http://localhost:5173
echo [Inferno]  (First run also downloads the model weights - a few minutes.)
echo [Inferno] ============================================================

:end
popd
endlocal
