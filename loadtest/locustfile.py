"""Locust load test — ramp concurrency and watch dynamic batching engage.

Run the stack (gateway + at least one worker per model), then:

    locust -f loadtest/locustfile.py --host http://127.0.0.1:8000

Open http://localhost:8089, set users/spawn-rate, and watch:
  * the gateway's live dashboard: batch sizes climb, p99 reported in real time;
  * 429s appear in Locust's failures if you push past the high-water mark
    (that's backpressure working, not a bug).

This file submits jobs over HTTP. To also measure round-trip-to-result latency,
the SubmitAndAwaitUser opens the result WebSocket and waits for the result.
"""

from __future__ import annotations

import base64
import json
import random
import string

import websocket  # provided by locust's dependency (gevent-friendly)
from locust import HttpUser, between, task

TEXT_SAMPLES = [
    "This is by far the best inference platform I have used.",
    "The latency was disappointing and the results felt off.",
    "Neutral observation about throughput and batching behavior.",
    "Absolutely love how fast the dynamic batching kicks in!",
]


def _rand_text() -> str:
    base = random.choice(TEXT_SAMPLES)
    return f"{base} {''.join(random.choices(string.ascii_lowercase, k=6))}"


def _tiny_image_b64() -> str:
    # A minimal valid-base64 blob; the gateway only validates base64 at submit.
    return base64.b64encode(random.randbytes(64)).decode()


class FireAndForgetUser(HttpUser):
    """Maximizes submit throughput to drive batch sizes up (HTTP only)."""

    wait_time = between(0.0, 0.05)

    @task(4)
    def submit_text(self) -> None:
        self.client.post(
            "/api/v1/infer",
            json={
                "model_name": "distilbert-sentiment",
                "input_type": "text",
                "payload": _rand_text(),
            },
            name="POST /infer (text)",
        )

    @task(1)
    def submit_dummy(self) -> None:
        self.client.post(
            "/api/v1/infer",
            json={"model_name": "dummy-echo", "input_type": "text", "payload": _rand_text()},
            name="POST /infer (dummy)",
        )


class SubmitAndAwaitUser(HttpUser):
    """Measures full round-trip latency: submit, then await the result over WS."""

    wait_time = between(0.1, 0.4)

    @task
    def round_trip(self) -> None:
        resp = self.client.post(
            "/api/v1/infer",
            json={"model_name": "dummy-echo", "input_type": "text", "payload": _rand_text()},
            name="POST /infer (round-trip)",
        )
        if resp.status_code != 202:
            return  # 429 backpressure etc. — recorded by Locust already
        result_ws = resp.json()["result_ws"]
        host = self.host.replace("http://", "ws://").replace("https://", "wss://")
        ws = websocket.create_connection(f"{host}{result_ws}", timeout=30)
        try:
            json.loads(ws.recv())
        finally:
            ws.close()
