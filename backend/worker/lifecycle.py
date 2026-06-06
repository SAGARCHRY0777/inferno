"""Graceful-shutdown coordination for workers.

Traps SIGINT/SIGTERM and flips a flag the main loop checks between batches. The
worker never abandons an in-flight batch: it finishes processing, publishes
results, and acks before exiting -- so a shutdown drops zero jobs. Unacked work
(from a hard kill) is recovered by another worker via stream reclaim.

On Windows, SIGINT (Ctrl+C) and SIGBREAK (Ctrl+Break) are the reliable signals;
we register SIGTERM too where the platform delivers it.
"""

from __future__ import annotations

import signal

from backend.core.logging import get_logger

_log = get_logger("lifecycle")


class GracefulShutdown:
    """A latch set by termination signals; polled by the worker loop."""

    def __init__(self) -> None:
        self._stopping = False

    @property
    def stopping(self) -> bool:
        return self._stopping

    def request_stop(self) -> None:
        self._stopping = True

    def install(self) -> None:
        """Install handlers for every termination signal this OS exposes."""

        for name in ("SIGINT", "SIGTERM", "SIGBREAK"):
            sig = getattr(signal, name, None)
            if sig is None:
                continue
            try:
                signal.signal(sig, self._handle)
            except (ValueError, OSError):  # not in main thread / unsupported
                _log.debug("signal_not_installable", signal=name)

    def _handle(self, signum: int, _frame) -> None:
        _log.info("shutdown_signal_received", signal=signum)
        self._stopping = True
