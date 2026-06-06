"""Durable persistence of completed inferences (history / audit trail).

Two sinks, both optional via config:
  * a **capped Redis stream** (`inferno:history`) for fast recent-history reads
    by the gateway/UI — survives restarts, bounded in size;
  * an **append-only JSONL file** on disk for true, unbounded durability.

Workers write here after every batch; the gateway reads the recent window for
`GET /history`. Raw image bytes are never stored — only a short input preview.
"""

from __future__ import annotations

import redis
import redis.asyncio as aredis

from backend.core import constants as C
from backend.core import redis_keys as keys
from backend.core.config import get_settings
from backend.core.enums import InputType
from backend.core.logging import get_logger
from backend.core.schemas import HistoryRecord, Job

_log = get_logger("history")


def input_preview(job: Job) -> str:
    """A safe, truncated preview of a job's input (never raw image bytes)."""

    s = get_settings().history
    if not s.store_input:
        return ""
    if job.input_type is InputType.IMAGE:
        return f"<image · {len(job.payload)} b64 chars>"
    return job.payload[: s.input_preview_chars]


class HistoryWriter:
    """Worker-side durable writer (sync)."""

    def __init__(self, client: redis.Redis) -> None:
        self._client = client

    def write(self, records: list[HistoryRecord]) -> None:
        s = get_settings().history
        if not s.enabled or not records:
            return
        self._write_redis(records, s.redis_maxlen)
        if s.jsonl_enabled:
            self._write_jsonl(records, s.jsonl_path)

    def _write_redis(self, records: list[HistoryRecord], maxlen: int) -> None:
        try:
            pipe = self._client.pipeline(transaction=False)
            for rec in records:
                pipe.xadd(
                    keys.history_stream(),
                    {C.FIELD_RECORD: rec.model_dump_json()},
                    maxlen=maxlen,
                    approximate=True,
                )
            pipe.execute()
        except redis.RedisError as exc:  # history must never break serving
            _log.warning("history_redis_write_failed", error=str(exc))

    def _write_jsonl(self, records: list[HistoryRecord], path) -> None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as fh:
                for rec in records:
                    fh.write(rec.model_dump_json() + "\n")
        except OSError as exc:
            _log.warning("history_jsonl_write_failed", error=str(exc))


class HistoryReader:
    """Gateway-side reader (async)."""

    def __init__(self, client: aredis.Redis) -> None:
        self._client = client

    async def read_recent(self, limit: int) -> list[HistoryRecord]:
        rows = await self._client.xrevrange(keys.history_stream(), max="+", min="-", count=limit)
        out: list[HistoryRecord] = []
        for _id, fields in rows:
            try:
                out.append(HistoryRecord.model_validate_json(fields[C.FIELD_RECORD]))
            except (KeyError, ValueError):
                continue
        return out
