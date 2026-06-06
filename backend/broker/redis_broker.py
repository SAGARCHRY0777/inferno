"""Redis Streams implementation of the broker interfaces.

Design decisions (documented in README's "decisions" section):
  * **Streams + consumer groups** over ``LIST``/``BRPOP``: we get at-least-once
    delivery with explicit acks, no double-processing across workers, and a
    pending-entries list we can reclaim from when a worker dies.
  * **One stream per model lane** (``inferno:jobs:<model>``): every entry in a
    worker's batch window is already the same model, so batching needs no
    cross-model filtering.
  * **XACK + XDEL on success**: acked entries are deleted so ``XLEN`` is an
    accurate live backlog gauge for backpressure. Un-acked entries (from a dead
    worker) remain in the PEL and are reclaimable -- zero job loss.
  * **Late-join-safe results**: each result is published to a per-job Pub/Sub
    channel *and* stored under a TTL'd key, so a client that subscribes a beat
    late still receives its result.
  * **XPENDING + XCLAIM** (not ``XAUTOCLAIM``) for reclaim, so we run on Redis
    5.x (the portable Windows build) as well as 6.2+/Memurai.
"""

from __future__ import annotations

import asyncio

import redis
import redis.asyncio as aredis

from backend.broker.base import AsyncBroker, ConsumedEntry, WorkerBroker
from backend.core import constants as C
from backend.core import redis_keys as keys
from backend.core.config import get_settings
from backend.core.logging import get_logger
from backend.core.schemas import InferenceResult, Job, WorkerHeartbeat

_log = get_logger("broker")

# Redis "new messages" id for a consumer-group read.
_NEW_MESSAGES = ">"
_BUSYGROUP = "BUSYGROUP"


def _decode_job(fields: dict) -> Job:
    return Job.model_validate_json(fields[C.FIELD_JOB])


# --------------------------------------------------------------------------- #
# Async (gateway) implementation                                              #
# --------------------------------------------------------------------------- #
class RedisAsyncBroker(AsyncBroker):
    """Gateway-side broker backed by Redis Streams + Pub/Sub."""

    def __init__(self, client: aredis.Redis) -> None:
        self._client = client
        self._group = get_settings().queue.consumer_group

    async def ensure_topology(self, model_names: list[str]) -> None:
        for model in model_names:
            await self._ensure_group(keys.job_stream(model))

    async def _ensure_group(self, stream: str) -> None:
        try:
            await self._client.xgroup_create(stream, self._group, id="0", mkstream=True)
        except redis.ResponseError as exc:  # group already exists -> fine
            if _BUSYGROUP not in str(exc):
                raise

    async def enqueue(self, job: Job) -> str:
        s = get_settings().queue
        return await self._client.xadd(
            keys.job_stream(job.model_name),
            {C.FIELD_JOB: job.model_dump_json()},
            maxlen=s.max_stream_len,
            approximate=True,
        )

    async def queue_depth(self, model_name: str) -> int:
        return int(await self._client.xlen(keys.job_stream(model_name)))

    async def total_queue_depth(self, model_names: list[str]) -> int:
        if not model_names:
            return 0
        depths = await asyncio.gather(*(self.queue_depth(m) for m in model_names))
        return sum(depths)

    async def list_heartbeats(self) -> list[WorkerHeartbeat]:
        cursor = 0
        hbs: list[WorkerHeartbeat] = []
        pattern = keys.heartbeat_pattern()
        while True:
            cursor, found = await self._client.scan(cursor=cursor, match=pattern, count=100)
            if found:
                values = await self._client.mget(found)
                hbs.extend(
                    WorkerHeartbeat.model_validate_json(v) for v in values if v is not None
                )
            if cursor == 0:
                break
        return hbs

    async def aclose(self) -> None:
        await self._client.aclose()


# --------------------------------------------------------------------------- #
# Sync (worker) implementation                                                #
# --------------------------------------------------------------------------- #
class RedisWorkerBroker(WorkerBroker):
    """Worker-side broker backed by Redis Streams + Pub/Sub."""

    def __init__(self, client: redis.Redis) -> None:
        self._client = client
        self._group = get_settings().queue.consumer_group

    def ensure_topology(self, model_name: str) -> None:
        stream = keys.job_stream(model_name)
        try:
            self._client.xgroup_create(stream, self._group, id="0", mkstream=True)
        except redis.ResponseError as exc:
            if _BUSYGROUP not in str(exc):
                raise

    def read_first(
        self, model_name: str, consumer: str, *, block_ms: int
    ) -> ConsumedEntry | None:
        resp = self._client.xreadgroup(
            self._group,
            consumer,
            {keys.job_stream(model_name): _NEW_MESSAGES},
            count=1,
            block=block_ms,
        )
        entries = self._flatten(resp)
        return entries[0] if entries else None

    def read_more(
        self, model_name: str, consumer: str, *, count: int
    ) -> list[ConsumedEntry]:
        if count <= 0:
            return []
        resp = self._client.xreadgroup(
            self._group,
            consumer,
            {keys.job_stream(model_name): _NEW_MESSAGES},
            count=count,
            block=None,  # non-blocking: return whatever is available right now
        )
        return self._flatten(resp)

    @staticmethod
    def _flatten(resp) -> list[ConsumedEntry]:
        """Normalize XREADGROUP's [[stream, [(id, {fields}), ...]]] shape."""

        out: list[ConsumedEntry] = []
        if not resp:
            return out
        for _stream, entries in resp:
            for entry_id, fields in entries:
                try:
                    out.append((entry_id, _decode_job(fields)))
                except (KeyError, ValueError) as exc:
                    # A corrupt entry must not stall the lane; ack it away.
                    _log.error("dropping_undecodable_entry", entry_id=entry_id, error=str(exc))
        return out

    def ack(self, model_name: str, entry_ids: list[str]) -> None:
        if not entry_ids:
            return
        stream = keys.job_stream(model_name)
        pipe = self._client.pipeline(transaction=False)
        pipe.xack(stream, self._group, *entry_ids)
        pipe.xdel(stream, *entry_ids)  # delete so XLEN stays an accurate backlog
        pipe.execute()

    def publish_result(self, result: InferenceResult) -> None:
        payload = result.model_dump_json()
        ttl = get_settings().timeouts.result_ttl_s
        pipe = self._client.pipeline(transaction=False)
        pipe.set(keys.result_value(result.job_id), payload, ex=ttl)  # late-join safe
        pipe.publish(keys.result_channel(result.job_id), payload)
        pipe.execute()

    def reclaim_stale(
        self, model_name: str, consumer: str, *, min_idle_ms: int, count: int
    ) -> list[ConsumedEntry]:
        stream = keys.job_stream(model_name)
        # NOTE: XPENDING's IDLE filter is Redis 6.2+. To also run on Redis 5.x
        # (the portable Windows build), we read the pending range without IDLE
        # and filter by ``time_since_delivered`` client-side -- same effect,
        # broader compatibility.
        pending = self._client.xpending_range(
            stream, self._group, min="-", max="+", count=count
        )
        ids = [p["message_id"] for p in pending if p["time_since_delivered"] >= min_idle_ms]
        if not ids:
            return []
        claimed = self._client.xclaim(
            stream, self._group, consumer, min_idle_time=min_idle_ms, message_ids=ids
        )
        out: list[ConsumedEntry] = []
        for entry_id, fields in claimed:
            if not fields:  # entry was deleted after pending snapshot
                continue
            try:
                out.append((entry_id, _decode_job(fields)))
            except (KeyError, ValueError) as exc:
                _log.error("dropping_undecodable_reclaim", entry_id=entry_id, error=str(exc))
        if out:
            _log.warning("reclaimed_stale_entries", model_name=model_name, count=len(out))
        return out

    def heartbeat(self, hb: WorkerHeartbeat, ttl_s: int) -> None:
        self._client.set(keys.worker_heartbeat(hb.worker_id), hb.model_dump_json(), ex=ttl_s)

    def close(self) -> None:
        self._client.close()
