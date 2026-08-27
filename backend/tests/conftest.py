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
from backend.core.config import Settings, get_settings
from backend.core.schemas import InferenceResult, Job, WorkerHeartbeat


class FakeWorkerBroker(WorkerBroker):
    """In-memory worker broker for batcher/runner tests.

    Models the **two lanes** the real broker has (express + normal), because a
    single queue cannot express the bug it needs to catch: ``read_more`` once
    read only the normal lane, so every batch was capped at "1 express job + N
    normal" and raising a job's priority silently cost it batching. A
    laneless fake made that invisible to every unit test.

    Draining rules mirror ``RedisWorkerBroker``: express is served first, and a
    single read may span both lanes.
    """

    def __init__(self) -> None:
        self.express: deque[ConsumedEntry] = deque()
        self.normal: deque[ConsumedEntry] = deque()
        self.acked: list[str] = []
        self.published: list[InferenceResult] = []
        self.heartbeats: list[WorkerHeartbeat] = []
        self._ids = itertools.count(1)

    @property
    def pending(self) -> deque[ConsumedEntry]:
        """Everything still queued, express first (kept for existing tests)."""

        return deque(list(self.express) + list(self.normal))

    def _lane_for(self, job: Job) -> deque[ConsumedEntry]:
        threshold = get_settings().queue.express_priority_min
        return self.express if job.priority >= threshold else self.normal

    def preload(self, jobs: list[Job]) -> None:
        for job in jobs:
            # Express ids carry the same marker prefix the real broker uses, so
            # tests can assert which lane an entry came from.
            prefix = "x|" if self._lane_for(job) is self.express else ""
            self._lane_for(job).append((f"{prefix}{next(self._ids)}-0", job))

    def _drain(self, count: int) -> list[ConsumedEntry]:
        out: list[ConsumedEntry] = []
        for lane in (self.express, self.normal):  # express first
            while lane and len(out) < count:
                out.append(lane.popleft())
        return out

    # -- WorkerBroker interface -------------------------------------------- #
    def ensure_topology(self, model_name: str) -> None:  # noqa: D401
        pass

    def read_first(self, model_name, consumer, *, block_ms):
        got = self._drain(1)
        return got[0] if got else None

    def read_more(self, model_name, consumer, *, count):
        return self._drain(count)

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
