"""Fixtures for failure injection against real Redis and real worker processes.

These tests deliberately use subprocesses rather than threads. A thread cannot
be killed the way a machine dies -- there is no way to stop one mid-operation
without its cleanup running -- and cleanup running is precisely what the crash
must not do. Only a separate process can be made to vanish without acking.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
import redis

from backend.core import constants as C
from backend.core import redis_keys as keys
from backend.core.config import get_settings
from backend.core.enums import InputType
from backend.core.redis_client import get_sync_redis
from backend.core.schemas import Job
from backend.tests.conftest import requires_redis

#: db 15, matching the existing integration suite, so a dev cluster on db 0 is
#: never touched.
REDIS_URL = "redis://localhost:6379/15"

#: Short enough that a test does not wait 90 seconds for the production default,
#: long enough that a healthy worker's in-flight batch is never stolen. The
#: production value is 90s for exactly that reason; this is the same trade-off
#: scaled down, not a different policy.
MIN_IDLE_MS = 400

MODEL = "dummy-echo"

REPO_ROOT = Path(__file__).resolve().parents[3]

pytestmark = requires_redis


@pytest.fixture
def isolated_redis(monkeypatch) -> redis.Redis:
    """Point settings and clients at db 15, flushed around each test."""

    monkeypatch.setenv("INFERNO_REDIS__URL", REDIS_URL)
    monkeypatch.setenv("INFERNO_QUEUE__BLOCK_MS", "200")
    get_settings.cache_clear()
    get_sync_redis.cache_clear()
    client = get_sync_redis()
    client.flushdb()
    yield client
    client.flushdb()
    get_sync_redis.cache_clear()
    get_settings.cache_clear()


@pytest.fixture
def worker_env() -> dict[str, str]:
    """Environment shared by every spawned worker."""

    return {
        **os.environ,
        "INFERNO_REDIS__URL": REDIS_URL,
        "INFERNO_WORKER__MODEL_NAME": MODEL,
        "INFERNO_QUEUE__BLOCK_MS": "200",
        "INFERNO_TIMEOUTS__RECLAIM_MIN_IDLE_MS": str(MIN_IDLE_MS),
        # Sweep often: the production default of 15s would dominate the measured
        # recovery time and tell us nothing about the reclaim itself.
        "INFERNO_TIMEOUTS__RECLAIM_INTERVAL_S": "0.2",
        "INFERNO_WORKER__HEARTBEAT_INTERVAL_S": "0.5",
        # Keep the batch window short so a single job is picked up promptly.
        "INFERNO_BATCHING__MAX_WAIT_MS": "50",
        "PYTHONUNBUFFERED": "1",
    }


@pytest.fixture
def spawn_worker(worker_env) -> Any:
    """Start real worker processes, and make sure none outlive the test."""

    started: list[subprocess.Popen] = []

    def _spawn(*, crash_after_read: bool = False, prefix: str = "w") -> subprocess.Popen:
        env = {**worker_env, "INFERNO_WORKER__ID_PREFIX": prefix}
        if crash_after_read:
            env["INFERNO_CRASH_AFTER_READ"] = "1"
        proc = subprocess.Popen(
            [sys.executable, "-m", "backend.worker.main"],
            env=env,
            cwd=str(REPO_ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        started.append(proc)
        return proc

    yield _spawn

    for proc in started:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=10)


@pytest.fixture
def submit_job(isolated_redis) -> Any:
    """Enqueue one job the way the gateway does, and return it."""

    def _submit(payload: str = "hello") -> Job:
        job = Job(model_name=MODEL, input_type=InputType.TEXT, payload=payload)
        isolated_redis.xadd(
            keys.job_stream(MODEL), {C.FIELD_JOB: job.model_dump_json()}
        )
        return job

    return _submit


def wait_for(
    predicate: Callable[[], Any],
    *,
    timeout: float,
    what: str,
    interval: float = 0.05,
) -> Any:
    """Poll until truthy or fail with a message naming what was awaited.

    Polling rather than sleeping: a fixed sleep either flakes on a slow runner
    or wastes the difference on a fast one, and its failure message tells you
    nothing. The last observed value is included so a red run is diagnosable
    without a rerun.
    """

    deadline = time.monotonic() + timeout
    last: Any = None
    while time.monotonic() < deadline:
        last = predicate()
        if last:
            return last
        time.sleep(interval)
    raise AssertionError(f"{what} not met within {timeout:.1f}s; last value: {last!r}")


def pending_entries(client: redis.Redis, model: str = MODEL) -> list[dict]:
    """The consumer group's pending-entries list for the normal lane."""

    return client.xpending_range(
        keys.job_stream(model),
        get_settings().queue.consumer_group,
        min="-",
        max="+",
        count=100,
    )
