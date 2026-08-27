"""Result cache: skip recompute on repeated (model, input) pairs.

Workers write every successful result keyed by a hash of ``model_name + payload``.
The gateway checks the cache before enqueueing: on a hit it re-issues the cached
result under a fresh ``job_id`` and delivers it over the normal result channel,
so the client experience is identical -- just instant.

This is an *exact-match* cache (content hash). It composes with the embedding
model to become a *semantic* cache (nearest-neighbor lookup) -- see the
``semantic-search`` model and the README's "what's next".
"""

from __future__ import annotations

import hashlib

import redis
import redis.asyncio as aredis

from backend.core import redis_keys as keys
from backend.core.config import get_settings
from backend.core.enums import ResultStatus
from backend.core.logging import get_logger
from backend.core.schemas import InferenceResult

_log = get_logger("cache")


def _model_fingerprint(model_name: str) -> str:
    """Artifact identity for a model, or "" if it isn't registered here.

    Looked up lazily and defensively: the cache must never be the reason a
    request fails, so an unknown model degrades to a name-only key rather than
    raising.
    """

    try:
        from backend.models.registry import load_specs

        spec = load_specs().get(model_name)
        return spec.fingerprint() if spec else ""
    except Exception:  # noqa: BLE001 - cache keying must not break the request path
        return ""


def make_key(model_name: str, payload: str) -> str:
    """Stable content hash for a (model, ARTIFACT, input) triple.

    The fingerprint is what makes this safe across a weights swap. Keyed on
    `model_name + payload` alone, changing `params.model_id` or a weights file
    and restarting the worker left the gateway serving the PREVIOUS model's
    answers for up to `cache.ttl_s` — silently, with no way to tell from the
    result. A new artifact now simply misses the cache.
    """

    fp = _model_fingerprint(model_name)
    return hashlib.sha256(f"{model_name}\x00{fp}\x00{payload}".encode()).hexdigest()


class CacheReader:
    """Gateway-side cache lookup + re-delivery (async)."""

    def __init__(self, client: aredis.Redis) -> None:
        self._client = client

    async def get(self, model_name: str, payload: str) -> InferenceResult | None:
        if not get_settings().cache.enabled:
            return None
        raw = await self._client.get(keys.cache(make_key(model_name, payload)))
        if raw is None:
            return None
        try:
            return InferenceResult.model_validate_json(raw)
        except ValueError:
            return None

    async def deliver(self, result: InferenceResult) -> None:
        """Publish a (cached) result so the client's result WebSocket delivers it."""

        payload = result.model_dump_json()
        ttl = get_settings().timeouts.result_ttl_s
        pipe = self._client.pipeline(transaction=False)
        pipe.set(keys.result_value(result.job_id), payload, ex=ttl)
        pipe.publish(keys.result_channel(result.job_id), payload)
        await pipe.execute()


class CacheWriter:
    """Worker-side cache population (sync)."""

    def __init__(self, client: redis.Redis) -> None:
        self._client = client

    def write(self, model_name: str, payload: str, result: InferenceResult) -> None:
        s = get_settings().cache
        if not s.enabled or result.status is not ResultStatus.SUCCESS:
            return
        try:
            self._client.set(
                keys.cache(make_key(model_name, payload)),
                result.model_dump_json(),
                ex=s.ttl_s,
            )
        except redis.RedisError as exc:  # cache is best-effort, never fatal
            _log.debug("cache_write_failed", error=str(exc))
