@echo off
REM ===========================================================================
REM Inferno - install the CPU-only stack into conda env "test".
REM No GPU/CUDA required. Identical app code path; CPU wheels only.
REM Run from anywhere: scripts\install-cpu.bat
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

echo [Inferno] Installing ML stack (CPU-only)...
python -m pip install -r requirements-ml-cpu.txt || goto :fail

echo [Inferno] Verifying torch...
python -c "import torch; print('torch', torch.__version__, '| cpu build')"

echo [Inferno] CPU install complete.
goto :end

:fail
echo [Inferno] Installation FAILED. See the pip output above.
:end
popd
endlocal
