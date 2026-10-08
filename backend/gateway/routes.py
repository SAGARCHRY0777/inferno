"""HTTP routes: submit jobs, list models, health.

The gateway never runs a model. It validates input (Pydantic, at the edge),
applies backpressure, enqueues a :class:`Job`, and hands back a 202 with the
WebSocket path the client should listen on for its result.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi import Request as HTTPRequest

from backend.core import constants as C
from backend.core.config import get_settings
from backend.core.enums import JobStatus, WorkerState
from backend.core.errors import (
    BackpressureError,
    ModelUnavailableError,
    RateLimitError,
    UnknownModelError,
)
from backend.core.logging import get_logger
from backend.core.redis_client import get_async_redis
from backend.core.schemas import (
    HealthResponse,
    HistoryRecord,
    InferAccepted,
    InferenceRequest,
    Job,
    ModelInfo,
    Timings,
)
from backend.core.timing import Stopwatch
from backend.core.tracing import get_tracer, inject
from backend.gateway.backpressure import BackpressureController
from backend.gateway.dependencies import GatewayContext, get_backpressure, get_context
from backend.gateway.security import identify_client
from backend.models.registry import list_specs

_log = get_logger("routes")
router = APIRouter()


@router.get("/health", response_model=HealthResponse, tags=["ops"])
async def health(
    response: Response, ctx: GatewayContext = Depends(get_context)
) -> HealthResponse:
    """Liveness + readiness: Redis reachability, models, and live worker count.

    Returns **503** when Redis is unreachable. ``httpGet`` probes only inspect the
    status code, so returning 200 with ``status="degraded"`` would leave a gateway
    that cannot serve a single inference marked ``Ready`` forever.
    """

    redis_ok = True
    try:
        await get_async_redis().ping()
    except Exception:  # broad on purpose: health must never raise
        redis_ok = False

    # Not inside the ping guard on purpose, but still guarded: a single truncated
    # or legacy heartbeat value makes model_validate_json raise, which would 500
    # the probe endpoint and turn one bad Redis key into a gateway restart loop.
    workers: list = []
    if redis_ok:
        try:
            workers = await ctx.broker.list_heartbeats()
        except Exception as exc:  # noqa: BLE001 - health must never raise
            _log.warning("health_heartbeats_failed", error=str(exc))

    if not redis_ok:
        response.status_code = 503

    return HealthResponse(
        status="ok" if redis_ok else "degraded",
        redis=redis_ok,
        models=ctx.model_names,
        workers_active=len(workers),
    )


def _serving_models(ctx: GatewayContext) -> set[str] | None:
    """Model names a live worker is currently reading for, or None if unknown.

    A worker loads exactly one model and reads only that model's stream, so a
    job enqueued to a lane with no live worker has no consumer at all -- and
    that is invisible to every failure path. Reclaim, ``max_deliveries`` and the
    watchdog all key off the consumer group's pending list, which only holds
    entries a worker has already read; an unclaimed entry is in none of them. So
    such a job is not late, it is unreachable: it sits in the stream forever
    while the caller waits on a result WebSocket that never delivers.

    Reads the snapshot ``MetricsHub`` already refreshes for the dashboard and
    the Prometheus collector, so this costs no extra Redis round trip -- its
    loop runs from the lifespan rather than on client connect, so the snapshot
    is fresh whether or not a dashboard is open.

    Returns ``None`` rather than an empty set before the first tick, so callers
    can tell "nothing is served" from "not known yet" and fail open on the
    second. A cold gateway rejecting all work would be a worse failure than the
    one this exists to prevent.

    Both ``/infer`` and ``/models`` derive availability from here, so the two
    endpoints cannot disagree about what is servable.
    """

    snapshot = ctx.metrics_hub.latest()
    if snapshot is None:
        return None
    return {
        worker.model_name
        for worker in snapshot.workers
        if worker.state not in (WorkerState.DRAINING, WorkerState.STOPPED)
    }


@router.get("/models", response_model=list[ModelInfo], tags=["models"])
async def models(ctx: GatewayContext = Depends(get_context)) -> list[ModelInfo]:
    """List models from the registry, each flagged with whether it can run now.

    The registry is config; whether a model is servable depends on a worker
    being up for its lane. Reporting both means a client can offer only what
    will actually produce a result, instead of advertising a model that
    ``/infer`` will reject with 503.
    """

    serving = _serving_models(ctx)
    return [
        ModelInfo(
            name=s.name,
            kind=s.kind,
            input_type=s.input_type,
            task=s.task,
            description=s.description,
            available=serving is None or s.name in serving,
        )
        for s in list_specs()
    ]


@router.get("/history", response_model=list[HistoryRecord], tags=["inference"])
async def history(
    http_request: HTTPRequest,
    limit: int = 50,
    ctx: GatewayContext = Depends(get_context),
) -> list[HistoryRecord]:
    """Recent completed inferences (newest first) from the durable history.

    Authenticated on the same terms as ``/infer``: history rows carry
    ``input_preview`` (raw user text), so leaving this endpoint open would make
    ``INFERNO_AUTH__ENABLED=true`` cosmetic — anyone could read every client's
    inputs. ``identify_client`` is a no-op when auth is disabled.
    """

    identify_client(http_request)
    limit = max(1, min(limit, 500))
    return await ctx.history_reader.read_recent(limit)


@router.post("/infer", response_model=InferAccepted, status_code=202, tags=["inference"])
async def infer(
    request: InferenceRequest,
    http_request: HTTPRequest,
    response: Response,
    ctx: GatewayContext = Depends(get_context),
    backpressure: BackpressureController = Depends(get_backpressure),
) -> InferAccepted:
    """Authenticate, enforce quota, apply backpressure, and enqueue a job.

    Returns 202 with the result WebSocket path. 401 if auth is required and the
    key is missing/invalid, 404 if the model is unknown, 429 (with
    ``Retry-After``) if the client is rate-limited or the lane is shedding load.
    """

    # 1) Auth (optional) -> client id, then 2) per-client quota.
    client_id = identify_client(http_request)
    try:
        await ctx.rate_limiter.check(client_id)
    except RateLimitError as exc:
        retry_after = get_settings().ratelimit.window_s
        raise HTTPException(
            status_code=exc.http_status,
            detail={"code": exc.code, "message": exc.message},
            headers={C.HEADER_RETRY_AFTER: str(retry_after)},
        ) from exc

    if request.model_name not in ctx.model_names:
        raise UnknownModelError(f"unknown model: {request.model_name!r}")

    # A job on a lane with no live worker would never fail -- see
    # _serving_models for why no timeout can reach it.
    serving = _serving_models(ctx)
    if serving is not None and request.model_name not in serving:
        raise ModelUnavailableError(
            f"no worker is serving {request.model_name!r}; "
            f"currently served: {sorted(serving) or 'none'}"
        )

    # 3) Result cache: identical (model, input) -> deliver instantly, skip the queue.
    sw = Stopwatch.start()
    cached = await ctx.cache.get(request.model_name, request.payload)
    if cached is not None:
        job = Job.from_request(request)
        result = cached.model_copy(
            update={
                "job_id": job.job_id,
                "worker_id": "cache",
                "cached": True,
                "timings": Timings(
                    queue_ms=0.0, batch_wait_ms=0.0, inference_ms=0.0,
                    total_ms=round(sw.elapsed_ms(), 3),
                ),
            }
        )
        await ctx.cache.deliver(result)
        _log.info("cache_hit", **{C.LOG_JOB_ID: str(job.job_id), C.LOG_MODEL: job.model_name})
        prefix = get_settings().server.api_prefix
        return InferAccepted(
            job_id=job.job_id,
            model_name=job.model_name,
            status=JobStatus.DONE,
            enqueued_at=job.enqueued_at,
            result_ws=f"{prefix}/ws/{job.job_id}",
        )

    try:
        await backpressure.admit(request.model_name)
    except BackpressureError as exc:
        response.headers[C.HEADER_RETRY_AFTER] = str(backpressure.retry_after_s)
        raise HTTPException(
            status_code=exc.http_status,
            detail={"code": exc.code, "message": exc.message},
            headers={C.HEADER_RETRY_AFTER: str(backpressure.retry_after_s)},
        ) from exc

    job = Job.from_request(request)
    with get_tracer("gateway.routes").start_as_current_span("infer.enqueue") as span:
        span.set_attribute("model_name", job.model_name)
        span.set_attribute("job_id", str(job.job_id))
        inject(job.trace)  # propagate trace context to the worker via the job
        await ctx.broker.enqueue(job)
    _log.info(
        "job_enqueued",
        **{C.LOG_JOB_ID: str(job.job_id), C.LOG_MODEL: job.model_name},
        priority=job.priority,
    )

    prefix = get_settings().server.api_prefix
    return InferAccepted(
        job_id=job.job_id,
        model_name=job.model_name,
        status=JobStatus.QUEUED,
        enqueued_at=job.enqueued_at,
        result_ws=f"{prefix}/ws/{job.job_id}",
    )
