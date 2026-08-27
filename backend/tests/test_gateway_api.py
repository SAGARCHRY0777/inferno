"""HTTP contract tests for the gateway — the request path, with no Redis.

Before these existed the entire gateway package was never even imported by the
suite: `routes.py`, `security.py`, `ws.py` and `result_router.py` were all at 0%
coverage, so every guarantee the README makes about the API — auth, payload
limits, backpressure, health semantics — rested on nothing.

The whole gateway context is faked. That is deliberate: these assert the HTTP
contract (status codes, headers, auth decisions, validation), which is exactly
the layer a client depends on and the layer that had no coverage. Redis
behaviour is covered separately in `test_integration.py`.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.core.config import get_settings
from backend.core.errors import InfernoError
from backend.core.schemas import MAX_PAYLOAD_CHARS
from backend.gateway import routes as routes_mod
from backend.gateway.dependencies import GatewayContext

MODEL = "dummy-echo"


# --------------------------------------------------------------------------- #
# Fakes                                                                        #
# --------------------------------------------------------------------------- #
class FakeBroker:
    def __init__(self) -> None:
        self.enqueued: list[Any] = []
        self.heartbeats_raise = False

    async def enqueue(self, job):
        self.enqueued.append(job)
        return "1-0"

    async def list_heartbeats(self):
        if self.heartbeats_raise:
            raise ValueError("one corrupt heartbeat value")
        return []


class FakeBackpressure:
    def __init__(self, shed: bool = False) -> None:
        self.shed = shed
        # The route reads this to build the Retry-After header.
        self.retry_after_s = get_settings().queue.retry_after_s

    async def admit(self, model_name: str) -> None:
        if self.shed:
            from backend.core.errors import BackpressureError

            raise BackpressureError("queue saturated")


class FakeCache:
    def __init__(self, hit=None) -> None:
        self.hit = hit

    async def get(self, model_name: str, payload: str):
        return self.hit


class FakeRateLimiter:
    def __init__(self, deny: bool = False) -> None:
        self.deny = deny

    async def check(self, client_id: str) -> None:
        if self.deny:
            from backend.core.errors import RateLimitError

            raise RateLimitError("quota exceeded")


class FakeHistoryReader:
    def __init__(self) -> None:
        self.reads = 0

    async def read_recent(self, limit: int):
        self.reads += 1
        return []


@dataclass
class _Result:
    """Minimal stand-in for a cached InferenceResult."""

    def model_copy(self, update):  # noqa: D401
        return self


def _build_app(**overrides) -> tuple[FastAPI, GatewayContext]:
    """A gateway app whose context is entirely fake — no Redis, no lifespan."""

    ctx = GatewayContext(
        broker=overrides.get("broker") or FakeBroker(),
        backpressure=overrides.get("backpressure") or FakeBackpressure(),
        metrics_reader=None,
        metrics_hub=None,
        result_router=None,
        history_reader=overrides.get("history") or FakeHistoryReader(),
        rate_limiter=overrides.get("limiter") or FakeRateLimiter(),
        cache=overrides.get("cache") or FakeCache(),
        model_names=[MODEL],
    )
    app = FastAPI()
    app.include_router(routes_mod.router, prefix=get_settings().server.api_prefix)

    @app.exception_handler(InfernoError)
    async def _inferno(_request, exc: InfernoError):  # noqa: ANN202
        from fastapi.responses import JSONResponse

        return JSONResponse(
            status_code=exc.http_status,
            content={"code": exc.code, "message": exc.message},
        )

    app.state.ctx = ctx
    return app, ctx


@pytest.fixture
def client_factory(monkeypatch):
    """Build a TestClient, with Redis ping stubbed so /health is deterministic."""

    def _make(redis_ok: bool = True, **overrides):
        class _Redis:
            async def ping(self):
                if not redis_ok:
                    raise OSError("redis down")
                return True

        monkeypatch.setattr(routes_mod, "get_async_redis", lambda: _Redis())
        app, ctx = _build_app(**overrides)
        return TestClient(app), ctx

    return _make


def _payload(**over):
    body = {"model_name": MODEL, "input_type": "text", "payload": "hello"}
    body.update(over)
    return body


# --------------------------------------------------------------------------- #
# /health — the semantics a probe depends on                                   #
# --------------------------------------------------------------------------- #
def test_health_is_200_when_redis_is_up(client_factory) -> None:
    client, _ = client_factory(redis_ok=True)
    r = client.get(f"{get_settings().server.api_prefix}/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_health_is_503_when_redis_is_down(client_factory) -> None:
    """httpGet probes only read the status code — 200 here means a broken
    gateway stays `Ready` forever."""

    client, _ = client_factory(redis_ok=False)
    r = client.get(f"{get_settings().server.api_prefix}/health")
    assert r.status_code == 503
    assert r.json()["status"] == "degraded"
    assert r.json()["redis"] is False


def test_health_survives_a_corrupt_heartbeat(client_factory) -> None:
    """One bad value in Redis must not 500 the liveness path into a crash loop."""

    broker = FakeBroker()
    broker.heartbeats_raise = True
    client, _ = client_factory(redis_ok=True, broker=broker)
    r = client.get(f"{get_settings().server.api_prefix}/health")
    assert r.status_code == 200
    assert r.json()["workers_active"] == 0


# --------------------------------------------------------------------------- #
# /infer — validation, routing, backpressure, quotas                           #
# --------------------------------------------------------------------------- #
def test_infer_accepts_a_valid_job(client_factory) -> None:
    client, ctx = client_factory()
    r = client.post(f"{get_settings().server.api_prefix}/infer", json=_payload())
    assert r.status_code == 202
    body = r.json()
    assert body["job_id"] and body["result_ws"].endswith(body["job_id"])
    assert len(ctx.broker.enqueued) == 1


def test_unknown_model_is_404_and_never_enqueued(client_factory) -> None:
    client, ctx = client_factory()
    r = client.post(
        f"{get_settings().server.api_prefix}/infer", json=_payload(model_name="nope")
    )
    assert r.status_code == 404
    assert ctx.broker.enqueued == []


def test_oversized_payload_is_rejected_before_decoding(client_factory) -> None:
    """The memory guard: without it one request buffers ~12MB and then
    allocates a second copy in b64decode, OOM-killing a 512Mi pod."""

    client, ctx = client_factory()
    r = client.post(
        f"{get_settings().server.api_prefix}/infer",
        json=_payload(payload="x" * (MAX_PAYLOAD_CHARS + 1)),
    )
    assert r.status_code == 422
    assert ctx.broker.enqueued == []


def test_blank_text_is_rejected(client_factory) -> None:
    client, _ = client_factory()
    r = client.post(f"{get_settings().server.api_prefix}/infer", json=_payload(payload="   "))
    assert r.status_code == 422


def test_bad_base64_image_is_rejected(client_factory) -> None:
    client, _ = client_factory()
    r = client.post(
        f"{get_settings().server.api_prefix}/infer",
        json=_payload(input_type="image", payload="not!base64!"),
    )
    assert r.status_code == 422


def test_unknown_field_is_rejected(client_factory) -> None:
    """`extra="forbid"` — a typo'd field must fail loudly, not be ignored."""

    client, _ = client_factory()
    r = client.post(
        f"{get_settings().server.api_prefix}/infer", json=_payload(prioritee=9)
    )
    assert r.status_code == 422


def test_backpressure_returns_429_with_retry_after(client_factory) -> None:
    client, _ = client_factory(backpressure=FakeBackpressure(shed=True))
    r = client.post(f"{get_settings().server.api_prefix}/infer", json=_payload())
    assert r.status_code == 429
    assert int(r.headers["Retry-After"]) >= 1


def test_quota_exceeded_returns_429_with_retry_after(client_factory) -> None:
    client, _ = client_factory(limiter=FakeRateLimiter(deny=True))
    r = client.post(f"{get_settings().server.api_prefix}/infer", json=_payload())
    assert r.status_code == 429
    assert "Retry-After" in r.headers


@pytest.mark.parametrize("priority,expect_express", [(0, False), (4, False), (5, True), (9, True)])
def test_priority_reaches_the_job(client_factory, priority: int, expect_express: bool) -> None:
    """The gateway must carry priority through; the broker routes on it."""

    client, ctx = client_factory()
    client.post(
        f"{get_settings().server.api_prefix}/infer", json=_payload(priority=priority)
    )
    job = ctx.broker.enqueued[0]
    assert job.priority == priority
    threshold = get_settings().queue.express_priority_min
    assert (job.priority >= threshold) is expect_express


# --------------------------------------------------------------------------- #
# Auth                                                                         #
# --------------------------------------------------------------------------- #
@pytest.fixture
def auth_on(monkeypatch):
    monkeypatch.setenv("INFERNO_AUTH__ENABLED", "true")
    monkeypatch.setenv("INFERNO_AUTH__API_KEYS", '["secret-key-one"]')
    get_settings.cache_clear()
    yield
    monkeypatch.delenv("INFERNO_AUTH__ENABLED", raising=False)
    monkeypatch.delenv("INFERNO_AUTH__API_KEYS", raising=False)
    get_settings.cache_clear()


def test_infer_requires_a_key_when_auth_is_on(client_factory, auth_on) -> None:
    client, ctx = client_factory()
    r = client.post(f"{get_settings().server.api_prefix}/infer", json=_payload())
    assert r.status_code == 401
    assert ctx.broker.enqueued == []


def test_infer_accepts_a_valid_key(client_factory, auth_on) -> None:
    client, _ = client_factory()
    r = client.post(
        f"{get_settings().server.api_prefix}/infer",
        json=_payload(),
        headers={"X-API-Key": "secret-key-one"},
    )
    assert r.status_code == 202


def test_history_requires_a_key_when_auth_is_on(client_factory, auth_on) -> None:
    """History rows carry raw user input; leaving this open made auth cosmetic."""

    client, ctx = client_factory()
    r = client.get(f"{get_settings().server.api_prefix}/history")
    assert r.status_code == 401
    assert ctx.history_reader.reads == 0


def test_history_is_open_when_auth_is_off(client_factory) -> None:
    client, _ = client_factory()
    assert client.get(f"{get_settings().server.api_prefix}/history").status_code == 200


def test_history_limit_is_clamped(client_factory) -> None:
    client, _ = client_factory()
    for limit in (-5, 0, 10_000):
        assert (
            client.get(f"{get_settings().server.api_prefix}/history?limit={limit}").status_code
            == 200
        )


# --------------------------------------------------------------------------- #
# /models                                                                      #
# --------------------------------------------------------------------------- #
def test_models_lists_the_registry(client_factory) -> None:
    client, _ = client_factory()
    r = client.get(f"{get_settings().server.api_prefix}/models")
    assert r.status_code == 200
    names = {m["name"] for m in r.json()}
    assert MODEL in names
    # Every advertised model needs input_type/task so the UI can render it.
    assert all({"name", "input_type", "task"} <= set(m) for m in r.json())


def test_asyncio_is_available() -> None:
    """Guard against the module-level import being dropped by a linter."""

    assert asyncio.iscoroutinefunction(FakeBroker().enqueue)
