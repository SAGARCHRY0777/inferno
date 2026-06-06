@echo off
REM ===========================================================================
REM Inferno - create a faithful BINARY "direct copy" of the conda "test" env
REM with conda-pack. Use this to move the exact env to another Windows x64 box
REM WITHOUT re-downloading/re-resolving anything (offline-friendly).
REM   Output:  dist\inferno-test-env.tar.gz   (several GB)
REM   Restore: scripts\restore-env.bat   (on the target machine)
REM ===========================================================================
setlocal
pushd "%~dp0.."

for /f "usebackq tokens=*" %%i in (`conda info --base 2^>nul`) do set CONDA_BASE=%%i
set BASEPY=%CONDA_BASE%\python.exe

"%BASEPY%" -c "import conda_pack" 2>nul
if errorlevel 1 (
  echo [Inferno] Installing conda-pack into base...
  "%BASEPY%" -m pip install conda-pack
)

if not exist dist mkdir dist
echo [Inferno] Packing env "test" -^> dist\inferno-test-env.tar.gz (a few minutes)...
conda pack -n test -o dist\inferno-test-env.tar.gz --force --n-threads -1

echo [Inferno] Done. Ship dist\inferno-test-env.tar.gz to the target machine and run scripts\restore-env.bat there.

popd
endlocal
