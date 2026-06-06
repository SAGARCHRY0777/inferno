"""Clock and timing helpers.

A single, swappable time source. Centralizing it means tests can freeze time and
every duration in the system is computed with consistent units (we standardize
on epoch *seconds* as floats on the wire, and expose millisecond helpers for the
timing breakdown surfaced in the UI).
"""

from __future__ import annotations

import time
from dataclasses import dataclass


def now() -> float:
    """Wall-clock epoch seconds. Used for cross-process timestamps (enqueue)."""

    return time.time()


def monotonic() -> float:
    """Monotonic seconds. Used for measuring durations within one process."""

    return time.monotonic()


def ms_between(start_s: float, end_s: float) -> float:
    """Milliseconds between two epoch-second timestamps, clamped at zero.

    Clock skew between the gateway and a worker can in theory produce a tiny
    negative delta; we clamp so the UI never shows a negative latency.
    """

    return max(0.0, (end_s - start_s) * 1000.0)


@dataclass
class Stopwatch:
    """A small monotonic stopwatch for attributing phase durations.

    Example:
        sw = Stopwatch.start()
        ... work ...
        elapsed_ms = sw.elapsed_ms()
    """

    _start: float

    @classmethod
    def start(cls) -> Stopwatch:
        return cls(_start=monotonic())

    def elapsed_ms(self) -> float:
        return (monotonic() - self._start) * 1000.0
