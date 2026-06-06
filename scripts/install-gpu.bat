@echo off
REM ===========================================================================
REM Inferno - install the GPU (CUDA 12.4) stack into conda env "test".
REM Creates the env if needed, installs core deps + the cu124 ML wheels.
REM Run from anywhere: scripts\install-gpu.bat
REM ===========================================================================
setlocal
pushd "%~dp0.."

echo [Inferno] Ensuring conda env "test" with Python 3.10...
call conda create -n test python=3.10 -y 2>nul
call conda activate test
if errorlevel 1 echo [Inferno] ERROR: could not activate conda env "test" - is conda on PATH?
if errorlevel 1 goto :end

echo [Inferno] Upgrading pip...
python -m pip install --upgrade pip

echo [Inferno] Installing core backend dependencies...
python -m pip install -r requirements.txt || goto :fail

echo [Inferno] Installing ML stack (CUDA 12.4)...
python -m pip install -r requirements-ml-gpu.txt || goto :fail

echo [Inferno] Verifying torch / CUDA visibility...
python -c "import torch; print('torch', torch.__version__, '| cuda available:', torch.cuda.is_available())"

echo [Inferno] GPU install complete. (If CUDA is unavailable the platform auto-falls back to CPU.)
goto :end

:fail
echo [Inferno] Installation FAILED. See the pip output above.
:end
popd
endlocal
