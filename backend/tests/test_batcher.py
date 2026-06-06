"""The dynamic batching window -- the platform's centerpiece."""

import backend.worker.batcher as batcher_mod
from backend.core.enums import InputType
from backend.core.schemas import Job
from backend.tests.conftest import make_settings
from backend.worker.batcher import BatchWindow


def _jobs(n: int) -> list[Job]:
    return [Job(model_name="m", input_type=InputType.TEXT, payload=f"p{i}") for i in range(n)]


def _patch_settings(monkeypatch, *, max_size: int, wait_ms: int) -> None:
    s = make_settings(
        batching={
            "max_batch_size": max_size,
            "max_batch_wait_ms": wait_ms,
            "poll_interval_ms": 1.0,
        },
        queue={"block_ms": 50},
    )
    monkeypatch.setattr(batcher_mod, "get_settings", lambda: s)


def test_collects_up_to_max_batch_size(monkeypatch, fake_worker_broker):
    _patch_settings(monkeypatch, max_size=8, wait_ms=200)
    fake_worker_broker.preload(_jobs(20))  # more than the cap is available

    window = BatchWindow(fake_worker_broker, "m", "c1")
    items, closed = window.collect()

    assert len(items) == 8  # stops exactly at the size cap
    assert closed > 0
    # Each item carries its own pickup timestamp for batch_wait attribution.
    assert all(it.pickup_ts > 0 for it in items)


def test_returns_available_when_fewer_than_max(monkeypatch, fake_worker_broker):
    _patch_settings(monkeypatch, max_size=32, wait_ms=15)
    fake_worker_broker.preload(_jobs(3))

    items, _ = window_collect(fake_worker_broker)
    assert len(items) == 3  # window closes on time with what's there


def test_empty_when_no_jobs(monkeypatch, fake_worker_broker):
    _patch_settings(monkeypatch, max_size=32, wait_ms=5)
    items, closed = BatchWindow(fake_worker_broker, "m", "c1").collect()
    assert items == []
    assert closed > 0


def window_collect(broker):
    return BatchWindow(broker, "m", "c1").collect()
