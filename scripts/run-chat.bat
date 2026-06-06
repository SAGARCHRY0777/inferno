@echo off
REM ===========================================================================
REM Inferno - run the streaming chat service (local LLM, SSE, RAG-grounded).
REM Separate process from the gateway (the gateway never loads models). Serves
REM on :8100. First request downloads the small instruct model (~1GB) and is slow
REM on CPU; subsequent tokens stream as they generate. Needs the gateway + a
REM rag-search worker running for grounded answers.
REM ===========================================================================
setlocal
pushd "%~dp0.."

for /f "usebackq tokens=*" %%i in (`conda info --base 2^>nul`) do set CONDA_BASE=%%i
set PYEXE=%CONDA_BASE%\envs\test\python.exe
if not exist "%PYEXE%" goto :noenv

set PYTHONPATH=%CD%
echo [Inferno] Chat service starting on http://127.0.0.1:8100  (first run downloads the model)
"%PYEXE%" -m backend.chat.app
goto :end

:noenv
echo [Inferno] ERROR: conda env "test" python not found. Run scripts\install-*.bat first.
pause

:end
popd
endlocal
