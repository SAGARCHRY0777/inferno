"""Tests for the wedged-inference watchdog.

The watchdog's real action is ``os._exit``, which would take the test runner
down with it, so the trigger path is verified by monkeypatching ``os._exit`` and
asserting the watchdog would have fired. The no-trigger paths are exercised for
real.
"""

from __future__ import annotations

import threading
import time

import pytest

from backend.worker import watchdog as wd


def test_guard_does_not_fire_for_a_fast_batch(monkeypatch: pytest.MonkeyPatch) -> None:
    """A batch well inside the deadline must never trip the watchdog."""

    fired: list[int] = []
    monkeypatch.setattr(wd.os, "_exit", lambda code: fired.append(code))

    dog = wd.InferenceWatchdog(timeout_s=5.0, worker_id="w-test")
    dog.start()
    try:
        with dog.guard(batch_size=4):
            time.sleep(0.05)
        time.sleep(0.7)  # let at least one poll tick elapse
    finally:
        dog.stop()

    assert fired == []


def test_guard_fires_when_a_batch_overruns(monkeypatch: pytest.MonkeyPatch) -> None:
    """A forward pass past the deadline must end the process."""

    fired: list[int] = []
    done = threading.Event()

    def fake_exit(code: int) -> None:
        fired.append(code)
        done.set()

    monkeypatch.setattr(wd.os, "_exit", fake_exit)

    dog = wd.InferenceWatchdog(timeout_s=0.2, worker_id="w-test")
    dog.start()
    try:
        with dog.guard(batch_size=32):
            # Simulates a wedged C call: we just wait for the watchdog to notice.
            assert done.wait(timeout=5.0), "watchdog did not fire before the deadline"
    finally:
        dog.stop()

    assert fired == [wd.WEDGED_EXIT_CODE]


def test_idle_worker_is_never_killed(monkeypatch: pytest.MonkeyPatch) -> None:
    """With no batch in flight the watchdog must stay silent indefinitely."""

    fired: list[int] = []
    monkeypatch.setattr(wd.os, "_exit", lambda code: fired.append(code))

    dog = wd.InferenceWatchdog(timeout_s=0.2, worker_id="w-test")
    dog.start()
    try:
        time.sleep(1.0)  # several poll intervals with no guard entered
    finally:
        dog.stop()

    assert fired == []


def test_guard_resets_between_batches(monkeypatch: pytest.MonkeyPatch) -> None:
    """Elapsed time must be measured per batch, not cumulatively."""

    fired: list[int] = []
    monkeypatch.setattr(wd.os, "_exit", lambda code: fired.append(code))

    dog = wd.InferenceWatchdog(timeout_s=1.0, worker_id="w-test")
    dog.start()
    try:
        # Five batches, each well under the deadline but summing past it.
        for _ in range(5):
            with dog.guard(batch_size=1):
                time.sleep(0.3)
    finally:
        dog.stop()

    assert fired == []
