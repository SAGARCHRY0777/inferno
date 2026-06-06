"""Verify dynamic batching + metrics under concurrency (dummy model, no ML deps).

Fires N concurrent jobs, collects each result's realized batch_size, then reads
one live snapshot off the metrics WebSocket. Proves batch_size climbs above 1
under load and that the cluster metrics stream works.
"""

import asyncio
import json

import httpx
import websockets

BASE = "http://127.0.0.1:8000/api/v1"
WS = "ws://127.0.0.1:8000"
N = 120


async def one(client: httpx.AsyncClient, i: int) -> int:
    r = await client.post(
        f"{BASE}/infer",
        json={"model_name": "dummy-echo", "input_type": "text", "payload": f"msg-{i}"},
    )
    r.raise_for_status()
    ws_url = f"{WS}{r.json()['result_ws']}"
    async with websockets.connect(ws_url) as ws:
        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=20))
    return msg["data"]["batch_size"]


async def metrics_snapshot() -> dict:
    async with websockets.connect(f"{WS}/api/v1/ws/metrics") as ws:
        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
        return msg["data"]


async def main() -> None:
    async with httpx.AsyncClient(timeout=30, limits=httpx.Limits(max_connections=200)) as client:
        sizes = await asyncio.gather(*(one(client, i) for i in range(N)))
    batched = [s for s in sizes if s > 1]
    print(f"jobs={N} max_batch={max(sizes)} avg_batch={sum(sizes)/len(sizes):.1f} "
          f"batched_share={len(batched)/N:.0%}")
    snap = await metrics_snapshot()
    lat = snap["latency_ms"]
    print(
        f"metrics: rps={snap['requests_per_sec']:.1f} "
        f"p50={lat['p50']:.1f} p90={lat['p90']:.1f} p99={lat['p99']:.1f} "
        f"depth={snap['queue_depth']} workers={snap['workers_active']} gpus={len(snap['gpus'])}"
    )
    print("recent_batch_sizes:", snap["recent_batch_sizes"][-15:])
    print("VERIFY OK" if max(sizes) > 1 else "VERIFY FAILED: no batching observed")


if __name__ == "__main__":
    asyncio.run(main())
