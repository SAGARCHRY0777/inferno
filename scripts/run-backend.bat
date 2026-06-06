@echo off
REM ===========================================================================
REM Inferno - run the FastAPI gateway (the API + WebSocket front door).
REM The gateway never runs models; it validates, enqueues, and relays results.
REM
REM Calls the conda env's python.exe DIRECTLY (no `conda activate`) so that
REM launching several components at once never races on conda's temp files.
REM ===========================================================================
setlocal
pushd "%~dp0.."

for /f "usebackq tokens=*" %%i in (`conda info --base 2^>nul`) do set CONDA_BASE=%%i
set PYEXE=%CONDA_BASE%\envs\test\python.exe
if not exist "%PYEXE%" goto :noenv

set PYTHONPATH=%CD%

REM Bind to loopback only: no Windows Firewall prompt, no LAN exposure.
REM To reach the app from ANOTHER device on your network, change --host to 0.0.0.0
REM (Windows will then prompt once to allow it through the firewall).
echo [Inferno] Gateway starting on http://127.0.0.1:8000  (docs at /docs)
"%PYEXE%" -m uvicorn backend.gateway.app:app --host 127.0.0.1 --port 8000
goto :end

:noenv
echo [Inferno] ERROR: conda env "test" python not found at:
echo [Inferno]   %PYEXE%
echo [Inferno] Run scripts\install-cpu.bat or scripts\install-gpu.bat first.
pause

:end
popd
endlocal
