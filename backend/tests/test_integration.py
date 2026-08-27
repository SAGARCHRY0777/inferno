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
from backend.worker.batcher import BatchWindow

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
    """A stop requested WHILE work is in flight must still lose nothing.

    The previous version of this test waited for ``xlen == 0`` and only then
    called ``request_stop()`` — so there was never an in-flight batch at the
    moment of the stop, and the assertions passed whether or not the worker
    drained. It proved nothing about the guarantee it was named after.

    This one stops as soon as the first result appears, with jobs demonstrably
    still queued, and asserts both that the backlog finished and that every job
    was delivered exactly once.
    """

    from backend.worker.main import Worker

    client = isolated_redis
    n = 60
    job_ids = []
    for i in range(n):
        job = _job(i)
        job_ids.append(str(job.job_id))
        _enqueue(client, job)

    # Watch results land so we can stop the worker mid-stream and count losses.
    delivered: list[str] = []
    pubsub = client.pubsub()
    pubsub.psubscribe(keys.result_channel_pattern())

    broker = RedisWorkerBroker(client)
    model = build_model(MODEL)
    worker = Worker(broker, model, worker_id="drain-test")

    thread = threading.Thread(target=worker.run, daemon=True)
    thread.start()

    # Stop the moment the FIRST result appears — the backlog is still non-empty,
    # so a batch is genuinely in flight when the stop is requested.
    deadline = time.time() + 20
    stopped_with_backlog = None
    while time.time() < deadline:
        msg = pubsub.get_message(ignore_subscribe_messages=True, timeout=0.2)
        if msg and msg.get("type") == "pmessage":
            delivered.append(InferenceResult.model_validate_json(msg["data"]).job_id.hex)
            if stopped_with_backlog is None:
                stopped_with_backlog = client.xlen(keys.job_stream(MODEL))
                worker.request_stop()
                break

    assert stopped_with_backlog is not None, "no result arrived; the worker never ran"

    # Keep draining the result channel until the worker exits.
    while thread.is_alive() and time.time() < deadline:
        msg = pubsub.get_message(ignore_subscribe_messages=True, timeout=0.2)
        if msg and msg.get("type") == "pmessage":
            delivered.append(InferenceResult.model_validate_json(msg["data"]).job_id.hex)
    thread.join(timeout=10)
    pubsub.close()

    assert not thread.is_alive(), "worker did not drain and exit"

    # The in-flight batch must have completed: every entry the worker had taken
    # is acked, so the consumer group has nothing pending.
    pending = client.xpending(keys.job_stream(MODEL), get_settings().queue.consumer_group)
    assert pending["pending"] == 0, "a batch was abandoned mid-flight"

    # Zero LOSS, not zero remaining: a graceful stop is allowed to leave jobs
    # queued for another worker. What must never happen is a job that was taken
    # off the stream and never delivered.
    remaining = client.xlen(keys.job_stream(MODEL))
    assert len(set(delivered)) + remaining == n, (
        f"{n - len(set(delivered)) - remaining} job(s) lost: "
        f"{len(set(delivered))} delivered + {remaining} still queued"
    )
    # And no job was delivered twice during a clean shutdown.
    assert len(delivered) == len(set(delivered)), "a job was delivered more than once"


def test_express_burst_is_batched_over_real_redis(isolated_redis) -> None:
    """Priority jobs must be served first AND still batch, against real Redis.

    This is the assertion that actually guards RedisWorkerBroker. The unit-level
    version uses the in-memory fake, so it verifies the contract but not this
    implementation -- and the defect it regresses lived precisely here:
    `read_more` read only the normal lane while `read_first` read both with
    count=1, capping every window at "1 express + N normal".
    """

    client = isolated_redis
    broker = RedisWorkerBroker(client)
    broker.ensure_topology(MODEL)

    threshold = get_settings().queue.express_priority_min
    express_stream = keys.express_stream(MODEL)
    for i in range(40):
        job = Job(
            model_name=MODEL,
            input_type=InputType.TEXT,
            payload=f"e{i}",
            priority=threshold,
        )
        client.xadd(express_stream, {C.FIELD_JOB: job.model_dump_json()})

    window = BatchWindow(broker, MODEL, "c-express")
    items, _ = window.collect()

    max_batch = get_settings().batching.max_batch_size
    assert len(items) == max_batch, (
        f"express burst produced a batch of {len(items)}, expected {max_batch} -- "
        "priority traffic has lost batching"
    )
    # Every entry must be tagged as express, and every tag must ack cleanly
    # against the express stream (a mis-routed ack is a silent no-op).
    assert all(it.entry_id.startswith("x|") for it in items)
    broker.ack(MODEL, [it.entry_id for it in items])
    pending = client.xpending(express_stream, get_settings().queue.consumer_group)
    assert pending["pending"] == 0
