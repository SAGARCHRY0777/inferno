"""End-to-end Phase-1 check: submit a job, await its result over WebSocket.

Assumes a gateway on :8000, at least one worker, and Redis are already running.
"""

import asyncio
import json
import sys

import httpx
import websockets

BASE = "http://127.0.0.1:8000/api/v1"
WS_BASE = "ws://127.0.0.1:8000"


async def main() -> int:
    async with httpx.AsyncClient(timeout=10) as client:
        health = (await client.get(f"{BASE}/health")).json()
        print("health:", health)

        resp = await client.post(
            f"{BASE}/infer",
            json={"model_name": "dummy-echo", "input_type": "text", "payload": "I love this!"},
        )
        resp.raise_for_status()
        accepted = resp.json()
        print("accepted:", accepted)

    ws_url = f"{WS_BASE}{accepted['result_ws']}"
    async with websockets.connect(ws_url) as ws:
        message = json.loads(await asyncio.wait_for(ws.recv(), timeout=15))
        print("ws message type:", message["type"])
        print("result:", json.dumps(message["data"], indent=2))
        ok = message["type"] == "result" and message["data"]["status"] == "success"
        print("E2E OK" if ok else "E2E FAILED")
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
