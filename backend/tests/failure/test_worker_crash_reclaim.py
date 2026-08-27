"""Failure injection: kill a worker mid-job and prove the job is not lost.

The platform claims at-least-once delivery with reclaim of abandoned work. That
claim is worth exactly as much as the test that tries to break it, so this file
attacks the one window where the claim can fail: after ``XREADGROUP`` has
delivered an entry (it is now pending against that consumer) and before anything
has been published or acked.

Verified to have power, not assumed to have it. Acking on read instead of after
publishing -- the classic version of this bug -- makes
``test_job_survives_worker_crash_and_is_delivered_once`` fail with::

    AssertionError: expected exactly one orphaned entry, got []
    assert 0 == 1

The ack removes the entry from the pending list while no result exists anywhere,
so the crash loses the job outright and there is nothing left for another worker
to reclaim. That red run was observed before this file was committed; a failure
test nobody has watched fail is decoration.
"""

from __future__ import annotations

import time

import pytest

from backend.core import redis_keys as keys
from backend.core.config import get_settings
from backend.core.schemas import InferenceResult
from backend.tests.failure.conftest import (
    MIN_IDLE_MS,
    MODEL,
    pending_entries,
    wait_for,
)
from backend.worker.main import CRASH_EXIT_CODE

pytestmark = [pytest.mark.failure, pytest.mark.slow]

#: Reclaim cannot begin until the entry has been idle for MIN_IDLE_MS, and the
#: rescuer sweeps every 200ms. Everything beyond that is process startup, which
#: dominates on a cold CI runner -- hence a generous ceiling on an assertion
#: whose point is "recovery is bounded", not "recovery is fast".
RECOVERY_BUDGET_S = MIN_IDLE_MS / 1000 + 20


def test_job_survives_worker_crash_and_is_delivered_once(
    isolated_redis, spawn_worker, submit_job
):
    """Kill a worker between read and publish; a healthy worker must recover it.

    Asserts all four properties the durability claim rests on: the entry is
    orphaned rather than lost, a second worker reclaims it, the client gets its
    result, and exactly one result exists despite the redelivery.
    """

    client = isolated_redis
    job = submit_job(payload="crash-me")
    result_key = keys.result_value(str(job.job_id))

    # -- 1. a worker reads the job, then dies without acking ------------------
    doomed = spawn_worker(crash_after_read=True, prefix="doomed")
    exit_code = doomed.wait(timeout=60)
    assert exit_code == CRASH_EXIT_CODE, (
        f"worker exited {exit_code}, not the crash point's {CRASH_EXIT_CODE}. "
        f"stderr: {doomed.stderr.read()[-2000:]}"
    )

    # -- 2. the entry is still pending, owned by the dead consumer ------------
    pending = pending_entries(client)
    assert len(pending) == 1, f"expected exactly one orphaned entry, got {pending}"
    assert pending[0]["consumer"].startswith("doomed"), pending[0]["consumer"]
    assert client.get(result_key) is None, "a result existed before the crash"

    # -- 3. a healthy worker reclaims it --------------------------------------
    started = time.monotonic()
    spawn_worker(prefix="rescuer")
    raw = wait_for(
        lambda: client.get(result_key),
        timeout=RECOVERY_BUDGET_S,
        what="reclaimed result",
    )
    recovery_s = time.monotonic() - started

    # -- 4. the four assertions ------------------------------------------------
    result = InferenceResult.model_validate_json(raw)
    assert str(result.job_id) == str(job.job_id)  # not lost, and the right job

    wait_for(
        lambda: not pending_entries(client),
        timeout=10,
        what="pending list drained by the rescuer",
    )

    # At-least-once permits the work being *done* twice; it does not permit the
    # client observing two results. The result key is written under the job id,
    # so the redelivery overwrites rather than appends -- one observable result.
    assert client.exists(result_key) == 1
    assert client.type(result_key) == "string"

    assert recovery_s < RECOVERY_BUDGET_S, f"recovery took {recovery_s:.2f}s"
    print(f"\nrecovered in {recovery_s:.2f}s with zero loss (MTTR under test)")


def test_crash_point_is_off_unless_asked(isolated_redis, spawn_worker, submit_job):
    """The fault-injection seam must be inert without its environment variable.

    Guards against the seam ever firing in a real deployment, and against the
    crash test passing because the worker was broken rather than killed.
    """

    client = isolated_redis
    job = submit_job(payload="normal")
    spawn_worker(prefix="healthy")

    raw = wait_for(
        lambda: client.get(keys.result_value(str(job.job_id))),
        timeout=60,
        what="result from an uninjected worker",
    )
    assert InferenceResult.model_validate_json(raw).job_id == job.job_id


def test_reclaim_leaves_no_pending_entry_behind(
    isolated_redis, spawn_worker, submit_job
):
    """After recovery the consumer group must be clean.

    A reclaimed-but-unacked entry is invisible in the happy path and surfaces
    later as an entry that is redelivered forever, so the pending list being
    empty is a stronger end state than the result key existing.
    """

    client = isolated_redis
    jobs = [submit_job(payload=f"batch-{i}") for i in range(3)]

    doomed = spawn_worker(crash_after_read=True, prefix="doomed")
    assert doomed.wait(timeout=60) == CRASH_EXIT_CODE

    assert pending_entries(client), "nothing was orphaned; the crash point missed"

    spawn_worker(prefix="rescuer")
    for job in jobs:
        wait_for(
            lambda j=job: client.get(keys.result_value(str(j.job_id))),
            timeout=RECOVERY_BUDGET_S,
            what=f"result for {job.job_id}",
        )

    wait_for(
        lambda: not pending_entries(client),
        timeout=15,
        what="empty pending-entries list",
    )
    group = get_settings().queue.consumer_group
    assert client.xpending(keys.job_stream(MODEL), group)["pending"] == 0
