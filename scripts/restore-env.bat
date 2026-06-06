@echo off
REM ===========================================================================
REM Inferno - restore the conda "test" env from the conda-pack tarball on THIS
REM machine. No internet needed. The machine MUST match the OS/arch the tarball
REM was packed on (Windows x64). conda-unpack rewrites the absolute paths.
REM   Usage:  scripts\restore-env.bat [target_dir]
REM           (default target_dir = .\restored-test-env)
REM ===========================================================================
setlocal
set TARBALL=%~dp0..\dist\inferno-test-env.tar.gz
set TARGET=%1
if "%TARGET%"=="" set TARGET=%~dp0..\restored-test-env

if not exist "%TARBALL%" (
  echo [Inferno] ERROR: %TARBALL% not found. Run scripts\pack-env.bat first.
  goto :end
)

if not exist "%TARGET%" mkdir "%TARGET%"
echo [Inferno] Unpacking -^> %TARGET% ...
tar -xzf "%TARBALL%" -C "%TARGET%"

echo [Inferno] Finalizing (conda-unpack rewrites absolute paths)...
call "%TARGET%\Scripts\activate.bat"
"%TARGET%\Scripts\conda-unpack.exe"

echo [Inferno] Done. This shell now has the restored env active. To reactivate later:
echo [Inferno]   call "%TARGET%\Scripts\activate.bat"

:end
endlocal
