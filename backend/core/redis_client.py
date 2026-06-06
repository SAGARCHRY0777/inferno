"""Async and sync Redis client factories.

The gateway is fully async and uses ``redis.asyncio``; workers run a sync inner
loop and use the sync client. Both are built from the same
:class:`~backend.core.config.RedisSettings`, so connection tuning lives in one
place. Pools are created lazily and cached per process.
"""

from __future__ import annotations

from functools import lru_cache

import redis
import redis.asyncio as aredis

from backend.core.config import get_settings


def _common_kwargs() -> dict:
    s = get_settings().redis
    return {
        "max_connections": s.max_connections,
        "socket_timeout": s.socket_timeout_s,
        "socket_connect_timeout": s.socket_connect_timeout_s,
        "health_check_interval": s.health_check_interval_s,
        "decode_responses": True,  # we speak JSON strings on the wire, not bytes
    }


@lru_cache(maxsize=1)
def get_async_redis() -> aredis.Redis:
    """Return the process-wide async Redis client (gateway side).

    Uses a *blocking* pool: under a burst, a caller waits briefly for a free
    connection instead of erroring with "Too many connections". Combined with the
    single-connection result router, this keeps the gateway stable at high
    concurrency.
    """

    s = get_settings().redis
    pool = aredis.BlockingConnectionPool.from_url(
        str(s.url), timeout=s.socket_timeout_s, **_common_kwargs()
    )
    return aredis.Redis(connection_pool=pool)


@lru_cache(maxsize=1)
def get_sync_redis() -> redis.Redis:
    """Return the process-wide sync Redis client (worker side)."""

    url = str(get_settings().redis.url)
    return redis.Redis.from_url(url, **_common_kwargs())


async def aclose() -> None:
    """Close the async client and its pool (called on gateway shutdown)."""

    if get_async_redis.cache_info().currsize:
        client = get_async_redis()
        await client.aclose()
        get_async_redis.cache_clear()


def close() -> None:
    """Close the sync client and its pool (called on worker shutdown)."""

    if get_sync_redis.cache_info().currsize:
        client = get_sync_redis()
        client.close()
        get_sync_redis.cache_clear()
