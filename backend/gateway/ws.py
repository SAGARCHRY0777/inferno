"""WebSocket endpoints + the live metrics hub.

Two streams:
  * ``/ws/{job_id}``  -- pushes exactly one result (or a timeout) for a job,
    correlated by id, then closes. Late-join safe via the broker's TTL'd result.
  * ``/ws/metrics``   -- the dashboard feed: every client receives the same ~1Hz
    cluster snapshot, produced once per tick by the :class:`MetricsHub` and
    fanned out (so N dashboards cost one aggregation, not N).
"""

from __future__ import annotations

import asyncio
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.broker.base import AsyncBroker
from backend.core import constants as C
from backend.core.config import get_settings
from backend.core.logging import get_logger
from backend.core.metrics import MetricsReader
from backend.core.schemas import MetricsSnapshot
from backend.gateway.dependencies import GatewayContext, ws_context

_log = get_logger("ws")
router = APIRouter()


def _envelope(msg_type: str, data) -> dict:
    """Uniform message envelope so the client switches on one ``type`` field."""

    return {"type": msg_type, "data": data}


# --------------------------------------------------------------------------- #
# Result WebSocket                                                             #
# --------------------------------------------------------------------------- #
@router.websocket("/ws/{job_id:uuid}")
async def result_ws(websocket: WebSocket, job_id: UUID) -> None:
    """Await and deliver a single job's result, or a timeout.

    The ``:uuid`` path converter means this route only matches real job ids, so
    the static ``/ws/metrics`` route below is never shadowed by it.
    """

    ctx = ws_context(websocket)
    await websocket.accept()
    timeout_s = get_settings().timeouts.job_timeout_s
    try:
        result = await ctx.result_router.wait(job_id, timeout=timeout_s)
        if result is None:
            _log.warning("result_timeout", **{C.LOG_JOB_ID: str(job_id)})
            await _safe_send(
                websocket,
                _envelope(C.WS_TYPE_TIMEOUT, {"job_id": str(job_id), "timeout_s": timeout_s}),
            )
        else:
            await _safe_send(
                websocket, _envelope(C.WS_TYPE_RESULT, result.model_dump(mode="json"))
            )
    except WebSocketDisconnect:
        _log.info("result_ws_client_disconnected", **{C.LOG_JOB_ID: str(job_id)})
    finally:
        await _safe_close(websocket)


# --------------------------------------------------------------------------- #
# Metrics WebSocket + hub                                                      #
# --------------------------------------------------------------------------- #
class MetricsHub:
    """Owns the metrics broadcast loop and the set of connected dashboards.

    The latest snapshot is cached so (a) a newly-connected client gets data
    immediately and (b) the Prometheus collector can read the same aggregate.
    """

    def __init__(
        self, broker: AsyncBroker, reader: MetricsReader, model_names: list[str]
    ) -> None:
        self._broker = broker
        self._reader = reader
        self._model_names = model_names
        self._clients: set[WebSocket] = set()
        self._latest: MetricsSnapshot | None = None
        self._task: asyncio.Task | None = None
        self._stopped = asyncio.Event()

    # -- lifecycle ---------------------------------------------------------- #
    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="metrics-broadcast")

    async def stop(self) -> None:
        self._stopped.set()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    def latest(self) -> MetricsSnapshot | None:
        """Most recent snapshot (used by the Prometheus collector)."""

        return self._latest

    # -- client registration ----------------------------------------------- #
    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._clients.add(websocket)
        if self._latest is not None:  # no blank first frame
            payload = _envelope(C.WS_TYPE_METRICS, self._latest.model_dump(mode="json"))
            await _safe_send(websocket, payload)

    def disconnect(self, websocket: WebSocket) -> None:
        self._clients.discard(websocket)

    # -- the loop ----------------------------------------------------------- #
    async def _run(self) -> None:
        interval = get_settings().metrics.snapshot_interval_s
        while not self._stopped.is_set():
            try:
                await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # never let the loop die on a transient error
                _log.error("metrics_tick_failed", error=str(exc))
            await asyncio.sleep(interval)

    async def _tick(self) -> None:
        depth, heartbeats = await asyncio.gather(
            self._broker.total_queue_depth(self._model_names),
            self._broker.list_heartbeats(),
        )
        snapshot = await self._reader.snapshot(queue_depth=depth, heartbeats=heartbeats)
        self._latest = snapshot
        await self._broadcast(snapshot)

    async def _broadcast(self, snapshot: MetricsSnapshot) -> None:
        if not self._clients:
            return
        payload = _envelope(C.WS_TYPE_METRICS, snapshot.model_dump(mode="json"))
        dead: list[WebSocket] = []
        # Iterate a snapshot, not the live set: `_safe_send` awaits, and any
        # dashboard connecting (connect -> _clients.add) or closing
        # (disconnect -> _clients.discard) during that suspension would otherwise
        # raise "Set changed size during iteration", aborting the tick partway so
        # the remaining clients silently miss the frame.
        for client in tuple(self._clients):
            if not await _safe_send(client, payload):
                dead.append(client)
        for client in dead:
            self.disconnect(client)


@router.websocket("/ws/metrics")
async def metrics_ws(websocket: WebSocket) -> None:
    """Subscribe a dashboard to the live cluster snapshot stream."""

    ctx: GatewayContext = ws_context(websocket)
    hub = ctx.metrics_hub
    await hub.connect(websocket)
    try:
        while True:
            # We don't expect client messages, but receiving keeps the socket
            # alive and lets us detect disconnects promptly.
            await websocket.receive_text()
    except WebSocketDisconnect:
        _log.info("metrics_ws_client_disconnected")
    finally:
        hub.disconnect(websocket)


# --------------------------------------------------------------------------- #
# Send/close helpers that never raise into the endpoint logic                 #
# --------------------------------------------------------------------------- #
async def _safe_send(websocket: WebSocket, payload: dict) -> bool:
    try:
        await websocket.send_json(payload)
        return True
    except (WebSocketDisconnect, RuntimeError):
        return False


async def _safe_close(websocket: WebSocket) -> None:
    try:
        await websocket.close()
    except (WebSocketDisconnect, RuntimeError):
        pass
