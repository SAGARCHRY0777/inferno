@echo off
REM ===========================================================================
REM Inferno - run ONE worker. Scaling = launch this script N times.
REM   Usage: scripts\run-worker.bat [model_name]
REM   Default model: dummy-echo
REM   Examples:
REM     scripts\run-worker.bat distilbert-sentiment
REM     scripts\run-worker.bat resnet-image
REM
REM Calls the conda env's python.exe DIRECTLY (no `conda activate`) so that
REM launching several workers at once never races on conda's temp files.
REM ===========================================================================
setlocal
pushd "%~dp0.."

for /f "usebackq tokens=*" %%i in (`conda info --base 2^>nul`) do set CONDA_BASE=%%i
set PYEXE=%CONDA_BASE%\envs\test\python.exe
if not exist "%PYEXE%" goto :noenv

set PYTHONPATH=%CD%

set MODEL=%1
if "%MODEL%"=="" set MODEL=dummy-echo
set INFERNO_WORKER__MODEL_NAME=%MODEL%

echo [Inferno] Worker starting for model "%MODEL%"  (Ctrl+C to drain + exit)
"%PYEXE%" -m backend.worker.main
goto :end

:noenv
echo [Inferno] ERROR: conda env "test" python not found at:
echo [Inferno]   %PYEXE%
echo [Inferno] Run scripts\install-cpu.bat or scripts\install-gpu.bat first.
pause

:end
popd
endlocal
