#!/usr/bin/env bash
# ===========================================================================
# Inferno — run the MCP server (exposes the models as agent-callable tools).
#
# The Windows counterpart is scripts/run-mcp.bat. This one works on macOS and
# Linux, and does not assume conda: it uses whatever `python3` is on PATH (or
# $PYTHON), so a plain venv works too.
#
#   ./scripts/run-mcp.sh              # stdio  — for a local MCP client
#   ./scripts/run-mcp.sh sse          # sse    — network service on :8200
#
# stdio speaks the MCP protocol over stdin/stdout, so run it FROM an MCP client
# (see mcp.example.json), not interactively. Requires the gateway to be up.
# ===========================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

PYTHON="${PYTHON:-python3}"
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "ERROR: '$PYTHON' not found. Set PYTHON=/path/to/python and retry." >&2
  exit 1
fi

export PYTHONPATH="${PYTHONPATH:-$PWD}"
export INFERNO_MCP_GATEWAY="${INFERNO_MCP_GATEWAY:-http://127.0.0.1:8000}"
export INFERNO_MCP_TRANSPORT="${1:-${INFERNO_MCP_TRANSPORT:-stdio}}"

# Log to stderr, never stdout: on the stdio transport stdout IS the protocol
# channel, and any stray byte corrupts the JSON-RPC stream.
echo "[Inferno] MCP server starting (${INFERNO_MCP_TRANSPORT}) -> ${INFERNO_MCP_GATEWAY}" >&2

exec "$PYTHON" -m backend.mcp_server.server
