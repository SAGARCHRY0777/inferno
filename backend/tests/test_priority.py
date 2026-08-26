"""Priority lanes: high-priority jobs are served before normal ones.

Redis Streams are strictly FIFO, so priority cannot be a sort key — it is
expressed as a separate *express* stream that workers drain first. These tests
cover the routing decision and the lane-tagged entry ids that let a mixed batch
be acked against the right stream, without needing a live Redis.
"""

from __future__ import annotations

import pytest

from backend.broker.redis_broker import RedisWorkerBroker
from backend.core import redis_keys as keys
from backend.core.config import get_settings
from backend.core.schemas import InferenceRequest, Job


def _job(priority: int) -> Job:
    return Job.from_request(
        InferenceRequest(
            model_name="dummy-echo", input_type="text", payload="hi", priority=priority
        )
    )


def test_express_and_normal_streams_are_distinct() -> None:
    assert keys.express_stream("m") != keys.job_stream("m")
    # The normal lane's key must not change: queue depth, the backpressure water
    # marks and the KEDA autoscalers are all keyed off it.
    assert keys.job_stream("m") == "inferno:jobs:m"


@pytest.mark.parametrize("priority", [0, 1, 4])
def test_low_priority_routes_to_the_normal_lane(priority: int) -> None:
    threshold = get_settings().queue.express_priority_min
    assert _job(priority).priority < threshold


@pytest.mark.parametrize("priority", [5, 7, 9])
def test_high_priority_routes_to_the_express_lane(priority: int) -> None:
    threshold = get_settings().queue.express_priority_min
    assert _job(priority).priority >= threshold


def test_lanes_are_read_express_first() -> None:
    """The express stream must be listed first in the XREADGROUP call.

    XREADGROUP returns results grouped per stream in the order requested, so this
    ordering *is* the priority mechanism. If it ever flips, priority silently
    stops working while every test that only checks routing still passes.
    """

    broker = RedisWorkerBroker.__new__(RedisWorkerBroker)  # no client needed
    lanes = list(broker._lanes("dummy-echo"))
    assert lanes == [keys.express_stream("dummy-echo"), keys.job_stream("dummy-echo")]


def test_entry_id_tagging_round_trips() -> None:
    broker = RedisWorkerBroker.__new__(RedisWorkerBroker)
    normal = broker._tag("1735-0", express=False)
    express = broker._tag("1735-0", express=True)

    assert normal == "1735-0", "normal ids must stay untouched"
    assert express != normal, "express ids must be distinguishable"
    assert broker._untag(normal) == ("1735-0", False)
    assert broker._untag(express) == ("1735-0", True)


def test_untag_is_safe_for_real_redis_ids() -> None:
    """A genuine Redis id must never be mistaken for a tagged one."""

    for entry_id in ("0-1", "1735689600000-0", "999999999999999-42"):
        assert RedisWorkerBroker._untag(entry_id) == (entry_id, False)


def test_ack_splits_a_mixed_batch_across_both_lanes() -> None:
    """A window can mix lanes; each id must be acked against its own stream.

    Acking an express id against the normal stream is a silent no-op — the entry
    would stay pending forever and eventually poison the lane.
    """

    calls: list[tuple[str, tuple[str, ...]]] = []

    class FakePipe:
        def xack(self, stream, _group, *ids):
            calls.append((f"xack:{stream}", ids))

        def xdel(self, stream, *ids):
            calls.append((f"xdel:{stream}", ids))

        def execute(self):
            return []

    class FakeClient:
        def pipeline(self, transaction=False):
            return FakePipe()

    broker = RedisWorkerBroker.__new__(RedisWorkerBroker)
    broker._client = FakeClient()
    broker._group = "g"

    broker.ack(
        "dummy-echo",
        [broker._tag("1-0", express=True), "2-0", broker._tag("3-0", express=True), "4-0"],
    )

    express_key = f"xack:{keys.express_stream('dummy-echo')}"
    normal_key = f"xack:{keys.job_stream('dummy-echo')}"
    express_acks = [ids for name, ids in calls if name == express_key]
    normal_acks = [ids for name, ids in calls if name == normal_key]

    assert express_acks == [("1-0", "3-0")]
    assert normal_acks == [("2-0", "4-0")]


def test_ack_of_empty_list_is_a_noop() -> None:
    class Boom:
        def pipeline(self, transaction=False):  # pragma: no cover - must not run
            raise AssertionError("ack([]) must not touch Redis")

    broker = RedisWorkerBroker.__new__(RedisWorkerBroker)
    broker._client = Boom()
    broker._group = "g"
    broker.ack("dummy-echo", [])
