"""Dependency-injection wiring for the gateway.

The application's collaborators (broker, backpressure controller, metrics reader,
metrics hub) are constructed once in the lifespan and stashed in a single typed
:class:`GatewayContext` on ``app.state``. Route handlers receive exactly what
they need via ``Depends`` accessors -- no globals, and every collaborator is
trivially swappable in tests.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from fastapi import Request, WebSocket

from backend.broker.base import AsyncBroker
from backend.core.cache import CacheReader
from backend.core.history import HistoryReader
from backend.core.metrics import MetricsReader
from backend.gateway.backpressure import BackpressureController
from backend.gateway.result_router import ResultRouter
from backend.gateway.security import RateLimiter

if TYPE_CHECKING:  # avoid a circular import (ws.py imports GatewayContext from here)
    from backend.gateway.ws import MetricsHub


@dataclass
class GatewayContext:
    """Everything the gateway needs at runtime, built once in the lifespan."""

    broker: AsyncBroker
    backpressure: BackpressureController
    metrics_reader: MetricsReader
    metrics_hub: MetricsHub  # forward ref; defined in ws.py
    result_router: ResultRouter
    history_reader: HistoryReader
    rate_limiter: RateLimiter
    cache: CacheReader
    model_names: list[str]


def _context(app) -> GatewayContext:
    ctx: GatewayContext | None = getattr(app.state, "ctx", None)
    if ctx is None:  # pragma: no cover - lifespan guarantees this
        raise RuntimeError("gateway context not initialized")
    return ctx


# --- HTTP dependency accessors --------------------------------------------- #
def get_context(request: Request) -> GatewayContext:
    return _context(request.app)


def get_broker(request: Request) -> AsyncBroker:
    return _context(request.app).broker


def get_backpressure(request: Request) -> BackpressureController:
    return _context(request.app).backpressure


# --- WebSocket dependency accessors (WebSocket has no `.app` on the param) -- #
def ws_context(websocket: WebSocket) -> GatewayContext:
    return _context(websocket.app)
