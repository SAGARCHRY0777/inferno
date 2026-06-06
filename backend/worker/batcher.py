"""The dynamic batching window -- the platform's throughput/latency lever.

For each cycle a worker:
  1. blocks for the *first* job of a window (so an idle worker costs nothing);
  2. then keeps pulling same-model jobs until **either** ``MAX_BATCH_WAIT_MS``
     elapses **or** ``MAX_BATCH_SIZE`` is reached -- whichever comes first.

Because there is one stream per model lane, every job pulled is already the same
model, so no cross-model filtering is needed. The realized window size is the
``batch_size`` surfaced per result -- watch it climb as load rises.
"""

from __future__ import annotations

import time

from backend.broker.base import WorkerBroker
from backend.core.config import get_settings
from backend.core.logging import get_logger
from backend.core.timing import monotonic, now
from backend.worker.runner import BatchItem

_log = get_logger("batcher")


class BatchWindow:
    """Collects one batch per cycle according to the configured size/wait limits."""

    def __init__(self, broker: WorkerBroker, model_name: str, consumer: str) -> None:
        self._broker = broker
        self._model_name = model_name
        self._consumer = consumer

    def collect(self) -> tuple[list[BatchItem], float]:
        """Gather the next batch.

        Returns:
            (items, window_closed_ts): the jobs in the window (possibly empty if
            the blocking read timed out with no work) and the epoch-seconds
            instant the window closed (used for ``batch_wait_ms`` attribution).
        """

        b = get_settings().batching
        first = self._broker.read_first(
            self._model_name, self._consumer, block_ms=get_settings().queue.block_ms
        )
        if first is None:
            return [], now()

        items: list[BatchItem] = [BatchItem(first[0], first[1], pickup_ts=now())]
        deadline = monotonic() + (b.max_batch_wait_ms / 1000.0)
        poll_s = b.poll_interval_ms / 1000.0

        while len(items) < b.max_batch_size:
            remaining_window = deadline - monotonic()
            if remaining_window <= 0:
                break
            more = self._broker.read_more(
                self._model_name, self._consumer, count=b.max_batch_size - len(items)
            )
            if more:
                pickup = now()
                items.extend(BatchItem(eid, job, pickup_ts=pickup) for eid, job in more)
            else:
                # Nothing waiting yet; nap briefly so we don't busy-spin the CPU
                # while still honoring the remaining window budget.
                time.sleep(min(poll_s, max(remaining_window, 0.0)))

        window_closed_ts = now()
        _log.debug(
            "window_closed",
            model_name=self._model_name,
            batch_size=len(items),
            full=len(items) >= b.max_batch_size,
        )
        return items, window_closed_ts
