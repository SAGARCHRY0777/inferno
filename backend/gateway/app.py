"""FastAPI application factory and lifespan.

Builds the single :class:`GatewayContext`, wires routers, exposes Prometheus
``/metrics`` backed by the cluster-wide collector, and tears everything down
cleanly on shutdown. The gateway is stateless beyond live WebSocket connections,
so scaling it is just running more copies behind a load balancer.
"""

from __future__ import annotations

import inspect
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from prometheus_client import CollectorRegistry, generate_latest
from prometheus_client.exposition import CONTENT_TYPE_LATEST
from starlette.concurrency import run_in_threadpool

from backend.broker.redis_broker import RedisAsyncBroker
from backend.core.cache import CacheReader
from backend.core.config import get_settings
from backend.core.errors import InfernoError
from backend.core.history import HistoryReader
from backend.core.logging import configure_logging, get_logger
from backend.core.metrics import ClusterCollector, MetricsReader
from backend.core.redis_client import aclose as aclose_redis
from backend.core.redis_client import close as close_sync_redis
from backend.core.redis_client import get_async_redis, get_sync_redis
from backend.core.tracing import configure_tracing, instrument_fastapi
from backend.gateway import routes, ws
from backend.gateway.backpressure import BackpressureController
from backend.gateway.dependencies import GatewayContext
from backend.gateway.result_router import ResultRouter
from backend.gateway.security import RateLimiter
from backend.gateway.ws import MetricsHub
from backend.models.registry import list_specs

_log = get_logger("gateway")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Construct collaborators on startup; drain them on shutdown."""

    configure_logging(service="gateway")
    settings = get_settings()
    model_names = [s.name for s in list_specs()]

    broker = RedisAsyncBroker(get_async_redis())
    await broker.ensure_topology(model_names)
    reader = MetricsReader(get_async_redis())
    hub = MetricsHub(broker, reader, model_names)
    hub.start()
    result_router = ResultRouter(get_async_redis())
    await result_router.start()

    app.state.ctx = GatewayContext(
        broker=broker,
        backpressure=BackpressureController(broker),
        metrics_reader=reader,
        metrics_hub=hub,
        result_router=result_router,
        history_reader=HistoryReader(get_async_redis()),
        rate_limiter=RateLimiter(get_async_redis()),
        cache=CacheReader(get_async_redis()),
        model_names=model_names,
    )

    # Prometheus: a private registry holding the cluster collector, so /metrics
    # reflects the whole fleet and not just this process.
    registry = CollectorRegistry()
    registry.register(ClusterCollector(get_sync_redis(), hub.latest))
    app.state.prometheus_registry = registry

    _log.info("gateway_started", models=model_names, port=settings.server.port)
    try:
        yield
    finally:
        # Each teardown step is isolated. Redis is frequently torn down *before*
        # the gateway (docker compose down, a node drain that evicts the Redis
        # pod first), which makes ResultRouter.stop()'s punsubscribe raise — and
        # an unguarded chain would then skip hub.stop(), broker.aclose() and both
        # connection-pool closes, leaking sockets on every restart.
        for label, teardown in (
            ("result_router", result_router.stop),
            ("metrics_hub", hub.stop),
            ("broker", broker.aclose),
            ("async_redis", aclose_redis),
            ("sync_redis", close_sync_redis),
        ):
            try:
                outcome = teardown()
                if inspect.isawaitable(outcome):
                    await outcome
            except Exception as exc:  # noqa: BLE001 - shutdown must always continue
                _log.warning("shutdown_step_failed", step=label, error=str(exc))
        _log.info("gateway_stopped")


def create_app() -> FastAPI:
    """Application factory."""

    settings = get_settings()
    configure_tracing("gateway")
    app = FastAPI(
        title="Inferno",
        version="0.1.0",
        summary="Distributed ML inference platform",
        lifespan=lifespan,
    )
    instrument_fastapi(app)  # no-op unless OTel is enabled

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.server.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    prefix = settings.server.api_prefix
    app.include_router(routes.router, prefix=prefix)
    app.include_router(ws.router, prefix=prefix)

    @app.exception_handler(InfernoError)
    async def _inferno_error_handler(_request: Request, exc: InfernoError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.http_status,
            content={"code": exc.code, "message": exc.message},
        )

    @app.get(f"{prefix}/metrics", include_in_schema=False)
    @app.get("/metrics", include_in_schema=False)
    async def metrics_endpoint(request: Request) -> PlainTextResponse:
        # generate_latest() runs the cluster collector, which does *synchronous*
        # Redis SCAN/GET. Offload to a thread so a Prometheus scrape never blocks
        # the gateway's event loop (and every live WebSocket on it).
        registry: CollectorRegistry = request.app.state.prometheus_registry
        body = await run_in_threadpool(generate_latest, registry)
        return PlainTextResponse(body, media_type=CONTENT_TYPE_LATEST)

    # Single-container demo deploys can serve the built UI from the gateway so the
    # browser hits one origin — API + WebSockets need zero cross-origin/URL config.
    # API routes above are registered first, so they take precedence over the mount.
    frontend_dir = settings.server.serve_frontend_dir
    if frontend_dir and Path(frontend_dir).is_dir():
        app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
    else:

        @app.get("/", include_in_schema=False)
        async def root() -> dict:
            return {"service": settings.service_name, "docs": "/docs", "api": prefix}

    return app


# Uvicorn entrypoint: ``uvicorn backend.gateway.app:app``
app = create_app()
