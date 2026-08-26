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
import json

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
            await self._ensure_group(keys.express_stream(model))

    async def _ensure_group(self, stream: str) -> None:
        try:
            await self._client.xgroup_create(stream, self._group, id="0", mkstream=True)
        except redis.ResponseError as exc:  # group already exists -> fine
            if _BUSYGROUP not in str(exc):
                raise

    async def enqueue(self, job: Job) -> str:
        s = get_settings().queue
        # Priority is routing, not sorting: Redis Streams are append-only FIFO,
        # so a high-priority job goes onto a separate lane the workers drain
        # first (see redis_keys.express_stream).
        stream = (
            keys.express_stream(job.model_name)
            if job.priority >= s.express_priority_min
            else keys.job_stream(job.model_name)
        )
        return await self._client.xadd(
            stream,
            {C.FIELD_JOB: job.model_dump_json()},
            maxlen=s.max_stream_len,
            approximate=True,
        )

    async def queue_depth(self, model_name: str) -> int:
        # Both lanes count toward backpressure — a flood of express jobs is still
        # a saturated lane, and shedding must see it.
        pipe = self._client.pipeline(transaction=False)
        pipe.xlen(keys.job_stream(model_name))
        pipe.xlen(keys.express_stream(model_name))
        normal, express = await pipe.execute()
        return int(normal) + int(express)

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
        for stream in (keys.express_stream(model_name), keys.job_stream(model_name)):
            try:
                self._client.xgroup_create(stream, self._group, id="0", mkstream=True)
            except redis.ResponseError as exc:
                if _BUSYGROUP not in str(exc):
                    raise

    def _lanes(self, model_name: str) -> dict[str, str]:
        """Streams to read, **express first**.

        XREADGROUP returns results grouped per stream in the order requested, so
        listing express first is what actually delivers priority — in a single
        round trip, and without starving the normal lane (both are read).
        Python dicts preserve insertion order, which redis-py relies on here.
        """

        return {
            keys.express_stream(model_name): _NEW_MESSAGES,
            keys.job_stream(model_name): _NEW_MESSAGES,
        }

    def read_first(
        self, model_name: str, consumer: str, *, block_ms: int
    ) -> ConsumedEntry | None:
        resp = self._client.xreadgroup(
            self._group,
            consumer,
            self._lanes(model_name),
            count=1,
            block=block_ms,
        )
        entries = self._flatten(resp, model_name)
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
        return self._flatten(resp, model_name)

    # -- lane-tagged entry ids ---------------------------------------------- #
    # `ConsumedEntry`'s id is documented as a *broker-native* handle, opaque to
    # callers. With two lanes we must remember which stream an entry came from in
    # order to XACK it against the right one, so express ids carry a marker.
    # This keeps the WorkerBroker interface (and the batcher, the worker loop and
    # the test fakes) completely unchanged.
    _EXPRESS_TAG = "x|"

    @classmethod
    def _tag(cls, entry_id: str, express: bool) -> str:
        return f"{cls._EXPRESS_TAG}{entry_id}" if express else entry_id

    @classmethod
    def _untag(cls, entry_id: str) -> tuple[str, bool]:
        if entry_id.startswith(cls._EXPRESS_TAG):
            return entry_id[len(cls._EXPRESS_TAG) :], True
        return entry_id, False

    def _stream_for(self, model_name: str, express: bool) -> str:
        return keys.express_stream(model_name) if express else keys.job_stream(model_name)

    def _dead_letter(
        self, model_name: str, entry_id: str, fields, reason: str, *, express: bool = False
    ) -> None:
        """Park an unprocessable entry, then ack+delete it from the live lane.

        Acking is the whole point: without it the entry stays in the PEL forever,
        every reclaim sweep re-claims it, XLEN never falls, and once enough of
        them accumulate the lane's queue depth crosses ``high_watermark`` and the
        gateway 429s that model permanently with no way to recover.
        """

        try:
            payload = {
                "reason": reason,
                "entry_id": str(entry_id),
                # Preserve whatever we got so the entry can be inspected later.
                "fields": json.dumps(
                    {str(k): str(v) for k, v in (fields or {}).items()}, default=str
                ),
            }
            lane = self._stream_for(model_name, express)
            pipe = self._client.pipeline(transaction=False)
            pipe.xadd(keys.dead_letter_stream(model_name), payload, maxlen=1_000, approximate=True)
            pipe.xack(lane, self._group, entry_id)
            pipe.xdel(lane, entry_id)
            pipe.execute()
        except Exception as exc:  # noqa: BLE001 - never let cleanup kill the lane
            _log.error("dead_letter_failed", entry_id=entry_id, error=str(exc))

    def _flatten(self, resp, model_name: str) -> list[ConsumedEntry]:
        """Normalize XREADGROUP's [[stream, [(id, {fields}), ...]]] shape."""

        out: list[ConsumedEntry] = []
        if not resp:
            return out
        express_stream = keys.express_stream(model_name)
        for stream, entries in resp:
            # redis-py decodes responses to str here, but be defensive: a client
            # configured with decode_responses=False would hand back bytes and
            # every entry would silently be treated as normal-lane.
            name = stream.decode() if isinstance(stream, bytes) else stream
            express = name == express_stream
            for entry_id, fields in entries:
                try:
                    out.append((self._tag(entry_id, express), _decode_job(fields)))
                except (KeyError, ValueError) as exc:
                    # A corrupt entry must not stall the lane -- and must not be
                    # left pending either. Park it and ack it away.
                    _log.error("dropping_undecodable_entry", entry_id=entry_id, error=str(exc))
                    self._dead_letter(
                        model_name, entry_id, fields, f"undecodable: {exc}", express=express
                    )
        return out

    def ack(self, model_name: str, entry_ids: list[str]) -> None:
        if not entry_ids:
            return
        # A batch can mix both lanes (express jobs are read first, then the
        # window is topped up from the normal lane), so split by tag and ack each
        # entry against the stream it actually came from. Acking an express id
        # against the normal stream is a silent no-op that would leave the entry
        # pending forever and eventually poison the lane.
        by_lane: dict[bool, list[str]] = {True: [], False: []}
        for tagged in entry_ids:
            raw, express = self._untag(tagged)
            by_lane[express].append(raw)

        pipe = self._client.pipeline(transaction=False)
        for express, ids in by_lane.items():
            if not ids:
                continue
            stream = self._stream_for(model_name, express)
            pipe.xack(stream, self._group, *ids)
            pipe.xdel(stream, *ids)  # delete so XLEN stays an accurate backlog
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
        # Sweep BOTH lanes, express first — otherwise a high-priority job
        # abandoned by a dead worker would be the one thing never recovered.
        out: list[ConsumedEntry] = []
        for express in (True, False):
            out.extend(
                self._reclaim_lane(
                    model_name, consumer, express=express, min_idle_ms=min_idle_ms, count=count
                )
            )
        if out:
            _log.warning("reclaimed_stale_entries", model_name=model_name, count=len(out))
        return out

    def _reclaim_lane(
        self, model_name: str, consumer: str, *, express: bool, min_idle_ms: int, count: int
    ) -> list[ConsumedEntry]:
        stream = self._stream_for(model_name, express)
        # NOTE: XPENDING's IDLE filter is Redis 6.2+. To also run on Redis 5.x
        # (the portable Windows build), we read the pending range without IDLE
        # and filter by ``time_since_delivered`` client-side -- same effect,
        # broader compatibility.
        pending = self._client.xpending_range(
            stream, self._group, min="-", max="+", count=count
        )
        max_deliveries = get_settings().timeouts.max_deliveries
        ids: list[str] = []
        for p in pending:
            if p["time_since_delivered"] < min_idle_ms:
                continue
            # A payload that kills the *process* (segfault in onnxruntime, OOM
            # kill) is never caught by run_batch's `except Exception`, so without
            # a delivery cap one crafted job reclaim-loops the whole fleet
            # forever. Park it after N attempts instead of handing it out again.
            if p.get("times_delivered", 0) >= max_deliveries:
                _log.error(
                    "dead_lettering_poison_entry",
                    entry_id=p["message_id"],
                    times_delivered=p.get("times_delivered"),
                )
                self._dead_letter(
                    model_name,
                    p["message_id"],
                    None,
                    f"exceeded max_deliveries={max_deliveries}",
                    express=express,
                )
                continue
            ids.append(p["message_id"])
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
                out.append((self._tag(entry_id, express), _decode_job(fields)))
            except (KeyError, ValueError) as exc:
                _log.error("dropping_undecodable_reclaim", entry_id=entry_id, error=str(exc))
                self._dead_letter(
                    model_name, entry_id, fields, f"undecodable: {exc}", express=express
                )
        return out

    def heartbeat(self, hb: WorkerHeartbeat, ttl_s: int) -> None:
        self._client.set(keys.worker_heartbeat(hb.worker_id), hb.model_dump_json(), ex=ttl_s)

    def close(self) -> None:
        self._client.close()
