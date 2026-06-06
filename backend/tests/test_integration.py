"""End-to-end integration over real Redis (auto-skips when Redis is absent).

Isolated on Redis db 15 so it never collides with a running dev cluster (db 0).
Covers the consumer-group round trip, batching, result delivery, ack-based
backlog accounting, and -- critically -- graceful drain with zero job loss.
"""

from __future__ import annotations

import threading
import time

import pytest
import redis

from backend.broker.redis_broker import RedisWorkerBroker
from backend.core import constants as C
from backend.core import redis_keys as keys
from backend.core.config import get_settings
from backend.core.enums import InputType, ResultStatus
from backend.core.redis_client import get_sync_redis
from backend.core.schemas import InferenceResult, Job
from backend.models.registry import build_model
from backend.tests.conftest import requires_redis

MODEL = "dummy-echo"

pytestmark = requires_redis


@pytest.fixture(autouse=True)
def isolated_redis(monkeypatch):
    """Point all settings/clients at db 15 and flush it around each test."""

    monkeypatch.setenv("INFERNO_REDIS__URL", "redis://localhost:6379/15")
    monkeypatch.setenv("INFERNO_QUEUE__BLOCK_MS", "200")
    get_settings.cache_clear()
    get_sync_redis.cache_clear()
    client = get_sync_redis()
    client.flushdb()
    yield client
    client.flushdb()
    get_sync_redis.cache_clear()
    get_settings.cache_clear()


def _enqueue(client: redis.Redis, job: Job) -> None:
    client.xadd(keys.job_stream(job.model_name), {C.FIELD_JOB: job.model_dump_json()})


def _job(i: int) -> Job:
    return Job(model_name=MODEL, input_type=InputType.TEXT, payload=f"msg-{i}")


def test_round_trip_and_ack_drains_backlog(isolated_redis):
    client = isolated_redis
    broker = RedisWorkerBroker(client)
    broker.ensure_topology(MODEL)

    job = _job(0)
    _enqueue(client, job)
    assert client.xlen(keys.job_stream(MODEL)) == 1

    first = broker.read_first(MODEL, "c1", block_ms=500)
    assert first is not None
    entry_id, decoded = first
    assert decoded.job_id == job.job_id

    model = build_model(MODEL)
    model.ensure_loaded()
    from backend.worker.runner import BatchItem, run_batch

    results = run_batch(
        model,
        [BatchItem(entry_id, decoded, pickup_ts=decoded.enqueued_at)],
        worker_id="t",
        window_closed_ts=decoded.enqueued_at,
    )
    for r in results:
        broker.publish_result(r)
    broker.ack(MODEL, [entry_id])

    # Late-join safe result value is present, and ack+del drained the stream.
    cached = client.get(keys.result_value(str(job.job_id)))
    assert cached is not None
    assert InferenceResult.model_validate_json(cached).status is ResultStatus.SUCCESS
    assert client.xlen(keys.job_stream(MODEL)) == 0


def test_graceful_drain_zero_job_loss(isolated_redis):
    """SIGTERM-style stop mid-flight must drain in-flight work and lose nothing."""

    from backend.worker.main import Worker

    client = isolated_redis
    n = 25
    for i in range(n):
        _enqueue(client, _job(i))

    broker = RedisWorkerBroker(client)
    model = build_model(MODEL)
    worker = Worker(broker, model, worker_id="drain-test")

    thread = threading.Thread(target=worker.run, daemon=True)
    thread.start()

    # Let it process a bit, then request a graceful stop mid-stream.
    deadline = time.time() + 10
    while time.time() < deadline:
        done = client.xlen(keys.job_stream(MODEL))
        if done == 0:
            break
        time.sleep(0.05)
    worker._shutdown.request_stop()
    thread.join(timeout=10)

    assert not thread.is_alive(), "worker did not drain and exit"
    # Zero loss proof: the stream is fully drained (acked+deleted) and the
    # consumer group's pending-entries list is empty -- no job left behind.
    assert client.xlen(keys.job_stream(MODEL)) == 0
    pending = client.xpending(keys.job_stream(MODEL), get_settings().queue.consumer_group)
    assert pending["pending"] == 0
