@echo off
REM ===========================================================================
REM Inferno - regenerate the env RECIPE + the project WHEEL from the live conda
REM "test" env. Run this whenever you add/upgrade a dependency.
REM   Outputs:  environment.yml   requirements.lock.txt   dist\inferno-*.whl
REM ===========================================================================
setlocal
pushd "%~dp0.."

for /f "usebackq tokens=*" %%i in (`conda info --base 2^>nul`) do set CONDA_BASE=%%i
set PYEXE=%CONDA_BASE%\envs\test\python.exe
if not exist "%PYEXE%" (
  echo [Inferno] ERROR: conda env "test" not found. Run scripts\install-*.bat first.
  goto :end
)

echo [1/3] environment.yml  (conda export, prefix stripped, pytorch index injected)
conda env export -n test --no-builds > env-raw-tmp.yml
"%PYEXE%" scripts\fix_environment_yml.py
del env-raw-tmp.yml

echo [2/3] requirements.lock.txt  (exact pip freeze)
"%PYEXE%" -m pip freeze > requirements.lock.txt

echo [3/3] dist\inferno-*.whl  (project wheel)
if not exist dist mkdir dist
"%PYEXE%" -m pip wheel . --no-deps -w dist

echo [Inferno] Done. Committed recipe: environment.yml + requirements.lock.txt.
echo [Inferno] Build output: dist\ (gitignored). For a binary env copy: scripts\pack-env.bat

:end
popd
endlocal
