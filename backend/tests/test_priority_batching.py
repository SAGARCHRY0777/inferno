"""Priority jobs must still be BATCHED, not just served first.

Regression guard for a real defect: ``read_more`` read only the normal lane
while ``read_first`` read both with ``count=1``. Every batch was therefore
capped at "1 express job + N normal jobs", so a burst of express traffic ran as
N batches of one instead of a few full batches — raising a job's priority made
it *slower*, by costing it batching entirely.

The existing priority tests all passed throughout: they cover lane ordering,
entry-id tagging and ack routing, none of which is wrong. The gap was that
nothing asserted how many express jobs land in one window.
"""

from __future__ import annotations

from backend.core.config import get_settings
from backend.core.schemas import InferenceRequest, Job
from backend.worker.batcher import BatchWindow

MODEL = "dummy-echo"


def _jobs(n: int, priority: int) -> list[Job]:
    return [
        Job.from_request(
            InferenceRequest(
                model_name=MODEL, input_type="text", payload=f"j{i}", priority=priority
            )
        )
        for i in range(n)
    ]


def _express_count(items) -> int:
    return sum(1 for it in items if it.entry_id.startswith("x|"))


def test_a_burst_of_express_jobs_fills_one_batch(fake_worker_broker) -> None:
    """The whole point of the express lane: priority AND throughput."""

    fake_worker_broker.preload(_jobs(40, priority=9))
    items, _ = BatchWindow(fake_worker_broker, MODEL, "c1").collect()

    max_batch = get_settings().batching.max_batch_size
    assert len(items) == max_batch, (
        f"express burst produced a batch of {len(items)}, expected {max_batch} — "
        "priority traffic has lost batching"
    )
    assert _express_count(items) == max_batch


def test_express_jobs_are_served_before_normal_ones(fake_worker_broker) -> None:
    fake_worker_broker.preload(_jobs(5, priority=0))
    fake_worker_broker.preload(_jobs(5, priority=9))

    items, _ = BatchWindow(fake_worker_broker, MODEL, "c1").collect()

    assert _express_count(items[:5]) == 5, "express entries must lead the batch"


def test_a_window_can_span_both_lanes(fake_worker_broker) -> None:
    """A partial express burst is topped up from the normal lane, not padded."""

    fake_worker_broker.preload(_jobs(3, priority=9))
    fake_worker_broker.preload(_jobs(20, priority=0))

    items, _ = BatchWindow(fake_worker_broker, MODEL, "c1").collect()

    assert _express_count(items) == 3
    assert len(items) > 3, "the window should have been topped up from the normal lane"


def test_normal_traffic_is_unaffected(fake_worker_broker) -> None:
    fake_worker_broker.preload(_jobs(40, priority=0))
    items, _ = BatchWindow(fake_worker_broker, MODEL, "c1").collect()

    assert len(items) == get_settings().batching.max_batch_size
    assert _express_count(items) == 0
