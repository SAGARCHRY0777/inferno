"""Continuous load generator to populate the live dashboard for demos/screenshots.

Usage: python scripts/loadgen.py [seconds]
Fires concurrent text jobs (dummy + distilbert) so batch sizes climb and the
percentile/throughput charts fill with real data.
"""

import asyncio
import random
import sys
import time

import httpx

BASE = "http://127.0.0.1:8000/api/v1"
DURATION = float(sys.argv[1]) if len(sys.argv) > 1 else 30.0
TEXTS = [
    "This platform is incredibly fast and well engineered.",
    "The results were disappointing and slow.",
    "A neutral statement about batching and throughput.",
    "Absolutely love the dynamic batching behavior!",
]


async def fire(client: httpx.AsyncClient) -> None:
    model = random.choice(["dummy-echo", "dummy-echo", "distilbert-sentiment"])
    try:
        await client.post(
            f"{BASE}/infer",
            json={"model_name": model, "input_type": "text", "payload": random.choice(TEXTS)},
        )
    except Exception:
        pass


async def main() -> None:
    end = time.time() + DURATION
    async with httpx.AsyncClient(timeout=10, limits=httpx.Limits(max_connections=120)) as client:
        n = 0
        while time.time() < end:
            await asyncio.gather(*(fire(client) for _ in range(24)))
            n += 24
            await asyncio.sleep(0.05)
        print(f"loadgen: submitted ~{n} jobs over {DURATION:.0f}s")


if __name__ == "__main__":
    asyncio.run(main())
