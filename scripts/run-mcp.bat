@echo off
REM ===========================================================================
REM Inferno - run the MCP server (exposes the models as agent-callable tools).
REM
REM Normally an MCP client (e.g. Claude Desktop) launches this for you via its
REM config (see mcp.example.json). This script is for manual testing -- it speaks
REM the MCP protocol over stdio, so run it from an MCP client, not interactively.
REM Requires the gateway to be running (scripts\run-backend.bat).
REM ===========================================================================
setlocal
pushd "%~dp0.."

for /f "usebackq tokens=*" %%i in (`conda info --base 2^>nul`) do set CONDA_BASE=%%i
set PYEXE=%CONDA_BASE%\envs\test\python.exe
if not exist "%PYEXE%" goto :noenv

set PYTHONPATH=%CD%
if "%INFERNO_MCP_GATEWAY%"=="" set INFERNO_MCP_GATEWAY=http://127.0.0.1:8000

echo [Inferno] MCP server starting (stdio) -> gateway %INFERNO_MCP_GATEWAY%
"%PYEXE%" -m backend.mcp_server.server
goto :end

:noenv
echo [Inferno] ERROR: conda env "test" python not found. Run scripts\install-*.bat first.
pause

:end
popd
endlocal
