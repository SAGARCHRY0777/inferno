"""API-key authentication + per-client request quotas.

Both are **off by default** so local dev just works; enable them via
``INFERNO_AUTH__ENABLED`` / ``INFERNO_RATELIMIT__ENABLED``.

* **Auth**: when enabled, ``/infer`` requires a valid key in the configured
  header. The key (or, when auth is off, the client IP) becomes the *client id*
  used for quota accounting.
* **Quotas**: a fixed-window counter in Redis (``INCR`` + ``EXPIRE``) caps each
  client to N requests per window. Because the counter lives in Redis, the quota
  is shared correctly across multiple gateway replicas.
"""

from __future__ import annotations

import hashlib

import redis.asyncio as aredis
from fastapi import Request

from backend.core import redis_keys as keys
from backend.core.config import get_settings
from backend.core.errors import RateLimitError, UnauthorizedError
from backend.core.logging import get_logger
from backend.core.timing import now

_log = get_logger("security")


def _peer_ip(request: Request) -> str:
    """Best-effort caller IP, honouring a trusted reverse proxy's headers.

    Every deployment in this repo puts nginx (``frontend/nginx.conf``) or a
    platform LB in front of the gateway, so ``request.client.host`` is the proxy's
    IP for *every* request — which would collapse all callers into one quota
    bucket. Prefer ``X-Forwarded-For``'s left-most entry (the original client),
    falling back to ``X-Real-IP`` and then the socket peer.

    Only consulted when ``ratelimit.trust_proxy_headers`` is on, since these
    headers are client-supplied and trivially spoofed when nothing strips them.
    """

    if get_settings().ratelimit.trust_proxy_headers:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            first = fwd.split(",")[0].strip()
            if first:
                return first
        real = request.headers.get("x-real-ip")
        if real and real.strip():
            return real.strip()
    return request.client.host if request.client else "anonymous"


def identify_client(request: Request) -> str:
    """Authenticate (if enabled) and return a stable client id for quotas.

    Raises:
        UnauthorizedError: if auth is enabled and the key is missing/invalid.
    """

    auth = get_settings().auth
    if not auth.enabled:
        # No auth -> key requests by source IP so quotas still apply per-caller.
        return _peer_ip(request)

    key = request.headers.get(auth.header_name)
    if not key or key not in set(auth.api_keys):
        _log.warning("auth_rejected", has_key=bool(key))
        raise UnauthorizedError("missing or invalid API key")
    # Identify by a salted digest, not a raw prefix: two keys sharing the first
    # 8 chars (common with prefixed formats like ``sk_live_...``) would otherwise
    # share one quota bucket. The digest never leaks the secret into logs/keys.
    return f"key:{hashlib.sha256(key.encode()).hexdigest()[:16]}"


class RateLimiter:
    """Fixed-window per-client quota backed by Redis."""

    def __init__(self, client: aredis.Redis) -> None:
        self._client = client

    async def check(self, client_id: str) -> None:
        s = get_settings().ratelimit
        if not s.enabled:
            return
        window = int(now()) // s.window_s
        key = keys.ratelimit(client_id, window)
        count = await self._client.incr(key)
        if count == 1:
            # Set the TTL only when the window's counter is first created, so the
            # window expires a fixed window_s after it began (not after the last
            # request). A tiny race here at worst leaves a per-window key to
            # linger; it's harmless because the next window uses a new key.
            await self._client.expire(key, s.window_s)
        if count > s.requests_per_minute:
            retry_after = s.window_s - (int(now()) % s.window_s)
            _log.warning("rate_limited", client_id=client_id, count=count)
            raise RateLimitError(
                f"quota exceeded: {s.requests_per_minute}/{s.window_s}s — retry in {retry_after}s"
            )
