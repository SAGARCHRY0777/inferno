"""Liveness watchdog for a wedged forward pass.

``run_batch`` already contains every *Python-level* failure: an exception in
``model.predict`` becomes an ERROR result for the affected jobs and the loop
continues. What it cannot contain is a call that never returns — a CUDA
deadlock, an ONNX Runtime spin, a stalled read of a network-mounted weight file.
In that case the worker never publishes, never acks, never heartbeats again, and
because the entries stay pending another worker eventually reclaims them and can
wedge identically, cascading the stall across the fleet.

A hung C-extension call cannot be interrupted from Python: ``KeyboardInterrupt``
and thread ``join(timeout=...)`` both require the GIL to be released back to the
interpreter, which is exactly what is not happening. The only reliable remedy is
to end the process and let the supervisor (Kubernetes, Compose, systemd) restart
it — the same reasoning behind a liveness probe, applied where a probe cannot
reach.

That is deliberately safe here:

* Results are published **before** the ack, so entries for a wedged batch are
  still pending and get reclaimed rather than lost.
* ``timeouts.max_deliveries`` caps how many times such a batch is retried before
  it is dead-lettered, so a genuinely poisonous payload cannot crash-loop the
  fleet forever.
"""

from __future__ import annotations

import os
import threading

from backend.core.logging import get_logger
from backend.core.timing import monotonic

_log = get_logger("watchdog")

#: Exit code used when the watchdog ends a wedged process. Distinct from 1 so
#: it is greppable in crash loops and orchestrator events.
WEDGED_EXIT_CODE = 87


class InferenceWatchdog:
    """Ends the process if a single batch runs past ``timeout_s``.

    Usage::

        with watchdog.guard(batch_size=len(items)):
            results = run_batch(...)

    The timer runs on a daemon thread, so it never keeps a healthy process alive.
    """

    def __init__(self, timeout_s: float, *, worker_id: str) -> None:
        self._timeout_s = timeout_s
        self._worker_id = worker_id
        self._lock = threading.Lock()
        self._started_at: float | None = None
        self._batch_size = 0
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(
            target=self._run, name="inference-watchdog", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def guard(self, *, batch_size: int) -> _Guard:
        return _Guard(self, batch_size)

    # -- internals ---------------------------------------------------------- #
    def _begin(self, batch_size: int) -> None:
        with self._lock:
            self._started_at = monotonic()
            self._batch_size = batch_size

    def _end(self) -> None:
        with self._lock:
            self._started_at = None
            self._batch_size = 0

    def _run(self) -> None:
        # Poll well inside the deadline so the overshoot stays small, but never
        # so often that an idle worker burns CPU.
        interval = max(0.5, min(5.0, self._timeout_s / 10.0))
        while not self._stop.wait(interval):
            with self._lock:
                started, size = self._started_at, self._batch_size
            if started is None:
                continue
            elapsed = monotonic() - started
            if elapsed < self._timeout_s:
                continue
            _log.error(
                "inference_wedged_exiting",
                worker_id=self._worker_id,
                elapsed_s=round(elapsed, 1),
                timeout_s=self._timeout_s,
                batch_size=size,
                detail=(
                    "a forward pass exceeded timeouts.inference_timeout_s and cannot be "
                    "interrupted from Python; exiting so the supervisor restarts this "
                    "worker. The batch's entries remain pending and will be reclaimed."
                ),
            )
            # os._exit, not sys.exit: the main thread is blocked inside a C call,
            # so an exception raised here would never unwind it, and atexit /
            # buffered-IO flushing could itself block on the wedged resource.
            os._exit(WEDGED_EXIT_CODE)


class _Guard:
    """Context manager marking the span of one batched forward pass."""

    __slots__ = ("_dog", "_batch_size")

    def __init__(self, dog: InferenceWatchdog, batch_size: int) -> None:
        self._dog = dog
        self._batch_size = batch_size

    def __enter__(self) -> _Guard:
        self._dog._begin(self._batch_size)
        return self

    def __exit__(self, *exc_info: object) -> None:
        self._dog._end()
