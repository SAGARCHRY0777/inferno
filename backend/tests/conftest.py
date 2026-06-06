"""Shared test fixtures: in-memory broker fakes and a Redis-availability gate.

Unit tests run with zero external services by substituting the broker
interfaces with deterministic in-memory fakes. Integration tests auto-skip when
Redis isn't reachable.
"""

from __future__ import annotations

import itertools
from collections import deque

import pytest

from backend.broker.base import AsyncBroker, ConsumedEntry, WorkerBroker
from backend.core.config import Settings
from backend.core.schemas import InferenceResult, Job, WorkerHeartbeat


class FakeWorkerBroker(WorkerBroker):
    """In-memory worker broker for batcher/runner tests."""

    def __init__(self) -> None:
        self.pending: deque[ConsumedEntry] = deque()
        self.acked: list[str] = []
        self.published: list[InferenceResult] = []
        self.heartbeats: list[WorkerHeartbeat] = []
        self._ids = itertools.count(1)

    def preload(self, jobs: list[Job]) -> None:
        for job in jobs:
            self.pending.append((f"{next(self._ids)}-0", job))

    # -- WorkerBroker interface -------------------------------------------- #
    def ensure_topology(self, model_name: str) -> None:  # noqa: D401
        pass

    def read_first(self, model_name, consumer, *, block_ms):
        return self.pending.popleft() if self.pending else None

    def read_more(self, model_name, consumer, *, count):
        out: list[ConsumedEntry] = []
        while self.pending and len(out) < count:
            out.append(self.pending.popleft())
        return out

    def ack(self, model_name, entry_ids):
        self.acked.extend(entry_ids)

    def publish_result(self, result):
        self.published.append(result)

    def reclaim_stale(self, model_name, consumer, *, min_idle_ms, count):
        return []

    def heartbeat(self, hb, ttl_s):
        self.heartbeats.append(hb)

    def close(self):
        pass


class FakeAsyncBroker(AsyncBroker):
    """In-memory async broker for backpressure/gateway tests."""

    def __init__(self) -> None:
        self.depths: dict[str, int] = {}
        self.enqueued: list[Job] = []

    async def ensure_topology(self, model_names):
        pass

    async def enqueue(self, job):
        self.enqueued.append(job)
        self.depths[job.model_name] = self.depths.get(job.model_name, 0) + 1
        return "1-0"

    async def queue_depth(self, model_name):
        return self.depths.get(model_name, 0)

    async def total_queue_depth(self, model_names):
        return sum(self.depths.get(m, 0) for m in model_names)

    async def list_heartbeats(self):
        return []

    async def aclose(self):
        pass


@pytest.fixture
def fake_worker_broker() -> FakeWorkerBroker:
    return FakeWorkerBroker()


@pytest.fixture
def fake_async_broker() -> FakeAsyncBroker:
    return FakeAsyncBroker()


def make_settings(**overrides) -> Settings:
    """Build a Settings object with nested overrides for injection in tests."""

    return Settings(**overrides)


def redis_available() -> bool:
    """True if a Redis is reachable at the configured URL."""

    try:
        import redis

        from backend.core.config import get_settings

        client = redis.Redis.from_url(str(get_settings().redis.url), socket_connect_timeout=1)
        client.ping()
        client.close()
        return True
    except Exception:
        return False


requires_redis = pytest.mark.skipif(not redis_available(), reason="Redis not reachable")
