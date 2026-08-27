"""The result router — every delivered result goes through it.

It carries the trickiest concurrency in the repo and had no direct tests, even
though each behaviour below is a fix for a bug that had to be found by
inspection: register-before-check ordering, multiple waiters on one job,
per-waiter cleanup, and swallowing CancelledError during shutdown.

No Redis: the pubsub and the value store are faked, because what needs guarding
is the routing logic, not redis-py.
"""

from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest

from backend.core.enums import ResultStatus
from backend.core.schemas import InferenceResult, Timings
from backend.gateway.result_router import ResultRouter


def _result(job_id) -> InferenceResult:
    return InferenceResult(
        job_id=job_id,
        model_name="dummy-echo",
        status=ResultStatus.SUCCESS,
        predictions=[],
        timings=Timings(queue_ms=1.0, batch_wait_ms=1.0, inference_ms=1.0, total_ms=3.0),
        batch_size=1,
        worker_id="w1",
    )


class FakeRedis:
    """Just enough for the router: a GET over a dict of TTL'd result values."""

    def __init__(self, values: dict[str, str] | None = None) -> None:
        self.values = values or {}

    async def get(self, key: str):
        return self.values.get(key)

    def pubsub(self):  # pragma: no cover - start() is not exercised here
        raise NotImplementedError


@pytest.fixture
def router() -> ResultRouter:
    return ResultRouter(FakeRedis())


# --------------------------------------------------------------------------- #
async def test_a_result_published_before_wait_is_still_delivered(router) -> None:
    """Late-join safety: the TTL'd value covers the gap between the worker
    publishing and the client opening its socket."""

    job_id = uuid4()
    from backend.core import redis_keys as keys

    router._client.values[keys.result_value(job_id)] = _result(job_id).model_dump_json()

    got = await router.wait(job_id, timeout=1.0)
    assert got is not None and got.job_id == job_id


async def test_a_live_result_resolves_the_waiter(router) -> None:
    job_id = uuid4()
    task = asyncio.create_task(router.wait(job_id, timeout=2.0))
    await asyncio.sleep(0)  # let wait() register before dispatching

    from backend.core import redis_keys as keys

    router._dispatch(keys.result_channel(job_id), _result(job_id).model_dump_json())
    got = await task
    assert got is not None and got.job_id == job_id


async def test_two_waiters_on_one_job_both_resolve(router) -> None:
    """The same job opened in two tabs, or a reconnect racing teardown.

    Keying one future per job id made the second registration evict the first,
    so that client blocked for the full timeout on a job that had succeeded.
    """

    job_id = uuid4()
    a = asyncio.create_task(router.wait(job_id, timeout=2.0))
    b = asyncio.create_task(router.wait(job_id, timeout=2.0))
    await asyncio.sleep(0)

    from backend.core import redis_keys as keys

    router._dispatch(keys.result_channel(job_id), _result(job_id).model_dump_json())
    got_a, got_b = await a, await b
    assert got_a is not None and got_b is not None


async def test_one_waiter_timing_out_does_not_deregister_its_sibling(router) -> None:
    """Cleanup must discard only its own future, not pop the whole job id."""

    job_id = uuid4()
    slow = asyncio.create_task(router.wait(job_id, timeout=2.0))
    await asyncio.sleep(0)
    quick = await router.wait(job_id, timeout=0.01)  # times out first
    assert quick is None

    from backend.core import redis_keys as keys

    router._dispatch(keys.result_channel(job_id), _result(job_id).model_dump_json())
    assert (await slow) is not None, "the surviving waiter lost its registration"


async def test_timeout_returns_none_and_cleans_up(router) -> None:
    job_id = uuid4()
    assert await router.wait(job_id, timeout=0.01) is None
    assert str(job_id) not in router._waiters, "a timed-out waiter must not leak"


async def test_shutdown_returns_none_instead_of_raising(router) -> None:
    """stop() cancels pending waiters. Without the CancelledError guard that
    escaped into Starlette and the client got a bare close with no frame."""

    job_id = uuid4()
    task = asyncio.create_task(router.wait(job_id, timeout=5.0))
    await asyncio.sleep(0)
    await router.stop()
    assert await task is None


async def test_a_malformed_message_does_not_kill_the_waiter(router) -> None:
    job_id = uuid4()
    task = asyncio.create_task(router.wait(job_id, timeout=0.4))
    await asyncio.sleep(0)

    from backend.core import redis_keys as keys

    router._dispatch(keys.result_channel(job_id), "{not json")
    # The bad frame is dropped; the waiter simply times out rather than raising.
    assert await task is None


async def test_dispatch_for_an_unknown_job_is_harmless(router) -> None:
    from backend.core import redis_keys as keys

    router._dispatch(keys.result_channel(uuid4()), _result(uuid4()).model_dump_json())
