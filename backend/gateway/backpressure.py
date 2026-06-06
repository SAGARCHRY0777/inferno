"""Backpressure with hysteresis.

When a model lane's queue depth crosses the high-water mark we *shed load* --
returning HTTP 429 with ``Retry-After`` -- instead of buffering work we can't
serve in time. We only resume accepting once depth drops back below the
low-water mark, so the system doesn't flap on/off around a single threshold.

Per-model state means a single saturated model never blocks traffic to a
healthy one.
"""

from __future__ import annotations

from backend.broker.base import AsyncBroker
from backend.core.config import get_settings
from backend.core.errors import BackpressureError
from backend.core.logging import get_logger

_log = get_logger("backpressure")


class BackpressureController:
    """Tracks per-model throttle state using high/low water-mark hysteresis."""

    def __init__(self, broker: AsyncBroker) -> None:
        self._broker = broker
        self._throttled: dict[str, bool] = {}

    @property
    def retry_after_s(self) -> int:
        return get_settings().queue.retry_after_s

    async def admit(self, model_name: str) -> None:
        """Allow or reject a new job for ``model_name``.

        Raises:
            BackpressureError: if the lane is currently shedding load. The error
                carries the configured ``Retry-After`` value for the response.
        """

        q = get_settings().queue
        depth = await self._broker.queue_depth(model_name)
        throttled = self._throttled.get(model_name, False)

        if not throttled and depth > q.high_watermark:
            self._throttled[model_name] = True
            _log.warning("backpressure_engaged", model_name=model_name, depth=depth)
            raise BackpressureError(self._message(model_name, depth))

        if throttled:
            if depth < q.low_watermark:
                self._throttled[model_name] = False
                _log.info("backpressure_released", model_name=model_name, depth=depth)
            else:
                raise BackpressureError(self._message(model_name, depth))

    @staticmethod
    def _message(model_name: str, depth: int) -> str:
        return f"queue for model {model_name!r} is saturated (depth={depth}); retry shortly"
