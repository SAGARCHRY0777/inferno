#!/bin/sh
# Boot the all-in-one demo: Redis -> dummy worker -> gateway (serving the UI).
set -e

# In-container Redis (ephemeral; fine for a stateless demo).
redis-server --daemonize yes --save "" --appendonly no

# Wait until Redis accepts connections so the gateway's startup (which connects
# immediately) never races ahead of it.
until redis-cli ping >/dev/null 2>&1; do sleep 0.2; done

# Dummy-echo worker in the background (the model the stress test + demo submit use).
python -m backend.worker.main &

# Gateway in the foreground on the host-provided port; it also serves the UI.
exec uvicorn backend.gateway.app:app --host 0.0.0.0 --port "${PORT:-8000}"
