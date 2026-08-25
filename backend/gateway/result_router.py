"""Single-connection result fan-out.

Instead of one Redis Pub/Sub connection per connected client, the gateway opens
**one** pattern subscription (``inferno:result:*``) and dispatches each incoming
result to the in-process waiter registered for that job id. This keeps Redis
connection use constant as the number of concurrent result WebSockets grows into
the thousands.

Late-join safety is preserved: :meth:`wait` first checks the TTL'd result value
(in case the result landed before the client subscribed), and only then waits on
the live channel.
"""

from __future__ import annotations

import asyncio
from uuid import UUID

import redis.asyncio as aredis

from backend.core import redis_keys as keys
from backend.core.logging import get_logger
from backend.core.schemas import InferenceResult

_log = get_logger("result_router")


class ResultRouter:
    """Routes Pub/Sub result messages to per-job awaiters over one connection."""

    def __init__(self, client: aredis.Redis) -> None:
        self._client = client
        self._pubsub: aredis.client.PubSub | None = None
        self._task: asyncio.Task | None = None
        # A *set* of futures per job id, not a single future: two sockets can
        # legitimately await the same job (the result link opened in two tabs, or
        # a reconnect racing the old socket's teardown). Keying one future per id
        # made the second registration silently evict the first, so that client
        # blocked for the full job timeout on a job that had already succeeded.
        self._waiters: dict[str, set[asyncio.Future[InferenceResult]]] = {}
        self._shutting_down = False

    async def start(self) -> None:
        self._pubsub = self._client.pubsub()
        await self._pubsub.psubscribe(keys.result_channel_pattern())
        self._task = asyncio.create_task(self._run(), name="result-router")
        _log.info("result_router_started")

    async def stop(self) -> None:
        self._shutting_down = True
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._pubsub is not None:
            # punsubscribe talks to a live socket; when Redis is already gone this
            # raises, and an unguarded call here would skip aclose() and leave
            # every waiter hanging instead of being cancelled below.
            try:
                await self._pubsub.punsubscribe(keys.result_channel_pattern())
            except Exception as exc:  # noqa: BLE001 - shutdown must continue
                _log.warning("result_router_punsubscribe_failed", error=str(exc))
            try:
                await self._pubsub.aclose()
            except Exception as exc:  # noqa: BLE001 - shutdown must continue
                _log.warning("result_router_pubsub_close_failed", error=str(exc))
        for futures in self._waiters.values():
            for fut in futures:
                if not fut.done():
                    fut.cancel()
        self._waiters.clear()

    async def wait(self, job_id: UUID, timeout: float) -> InferenceResult | None:
        """Await the result for ``job_id``; return None on timeout.

        Registers the waiter *before* checking the cached value so there is no
        gap in which a just-published result could be missed.
        """

        key = str(job_id)
        loop = asyncio.get_running_loop()
        future: asyncio.Future[InferenceResult] = loop.create_future()
        self._waiters.setdefault(key, set()).add(future)
        try:
            cached = await self._client.get(keys.result_value(job_id))
            if cached is not None:
                return InferenceResult.model_validate_json(cached)
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError:
            return None
        except asyncio.CancelledError:
            # stop() cancels every pending waiter on gateway shutdown. Without
            # this, CancelledError escaped into Starlette's websocket handler and
            # the client got a bare close with no `result` or `timeout` frame.
            if self._shutting_down:
                return None
            raise
        finally:
            # Discard only *this* waiter. Popping the whole key would deregister
            # any sibling socket still waiting on the same job.
            siblings = self._waiters.get(key)
            if siblings is not None:
                siblings.discard(future)
                if not siblings:
                    self._waiters.pop(key, None)

    async def _run(self) -> None:
        # Poll with a short timeout instead of an open-ended ``listen()``: the
        # shared client carries a socket read timeout, so a blocking listen would
        # raise on an idle channel and kill the router. ``get_message(timeout=...)``
        # returns None on an idle tick, and we swallow transient errors so the
        # router survives for the gateway's whole lifetime.
        assert self._pubsub is not None
        while True:
            try:
                message = await self._pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=1.0
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - transient redis/socket hiccup
                _log.warning("result_router_poll_error", error=str(exc))
                await asyncio.sleep(0.1)
                continue
            if message is None or message.get("type") != "pmessage":
                continue
            self._dispatch(message["channel"], message["data"])

    def _dispatch(self, channel: str, data: str) -> None:
        job_id = keys.job_id_from_result_channel(channel)
        futures = self._waiters.get(job_id)
        if not futures:
            return  # no one waiting (already served via cache, or client gone)
        try:
            result = InferenceResult.model_validate_json(data)
        except ValueError as exc:
            _log.error("result_decode_failed", job_id=job_id, error=str(exc))
            return
        # Decode once, then fan out to every socket awaiting this job.
        for future in tuple(futures):
            if not future.done():
                future.set_result(result)
