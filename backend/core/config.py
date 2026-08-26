"""The single source of truth for every operator-tunable value.

All configuration is declared here as typed, validated ``pydantic-settings``
groups. Nothing elsewhere in the codebase reads ``os.environ`` directly and no
module hardcodes a tunable -- they call :func:`get_settings` and read a typed
field. Each group maps to an environment-variable namespace using a double
underscore delimiter, e.g. ``INFERNO_BATCHING__MAX_BATCH_SIZE=32``.

Why nested groups instead of a flat bag of fields?
  * Cohesion: related knobs travel together and are documented as a unit.
  * Reuse: workers and the gateway import the same typed objects.
  * Safety: validators reject impossible combinations at startup, not at 2am.

Every field has a default that yields a runnable system out of the box; every
field is overridable via env / ``.env`` (see ``.env.example``).
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, RedisDsn, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve repository paths once, relative to this file, so nothing is tied to a
# particular checkout location or current working directory.
_CORE_DIR = Path(__file__).resolve().parent
BACKEND_DIR = _CORE_DIR.parent
REPO_ROOT = BACKEND_DIR.parent
DEFAULT_MODELS_CONFIG = BACKEND_DIR / "models" / "models.yaml"
DEFAULT_ARTIFACT_DIR = REPO_ROOT / "artifacts"


class RedisSettings(BaseModel):
    """Connection parameters for the Redis broker/bus."""

    url: RedisDsn = Field(
        default="redis://localhost:6379/0",
        description="Full Redis DSN. Point this at Memurai / Docker / WSL in prod.",
    )
    max_connections: int = Field(default=64, ge=1, description="Connection pool ceiling.")
    socket_timeout_s: float = Field(default=5.0, gt=0)
    socket_connect_timeout_s: float = Field(default=5.0, gt=0)
    health_check_interval_s: int = Field(default=15, ge=0)


class QueueSettings(BaseModel):
    """Job-queue topology and backpressure water marks."""

    consumer_group: str = Field(default="inferno-workers", min_length=1)
    block_ms: int = Field(
        default=2000, ge=1,
        description="Blocking read timeout for the first job of a batch window.",
    )
    max_stream_len: int = Field(
        default=100_000, ge=1,
        description="Approximate cap (XADD MAXLEN ~) so the stream can't grow unbounded.",
    )
    high_watermark: int = Field(
        default=5_000, ge=1,
        description="Above this queue depth the gateway returns 429.",
    )
    low_watermark: int = Field(
        default=2_500, ge=0,
        description="Backpressure releases once depth falls back below this (hysteresis).",
    )
    retry_after_s: int = Field(
        default=2, ge=1,
        description="Value of the Retry-After header sent with a 429.",
    )
    express_priority_min: int = Field(
        default=5, ge=1, le=9,
        description=(
            "Jobs with InferenceRequest.priority >= this go to the model's express "
            "lane, which workers drain before the normal lane. Set to 10 to disable "
            "priority routing entirely (nothing can reach it, since priority maxes at 9)."
        ),
    )

    @model_validator(mode="after")
    def _check_watermarks(self) -> QueueSettings:
        if self.low_watermark > self.high_watermark:
            raise ValueError("queue.low_watermark must be <= queue.high_watermark")
        return self


class BatchingSettings(BaseModel):
    """The latency/throughput lever: the dynamic batching window."""

    max_batch_size: int = Field(
        default=32, ge=1,
        description="Hard cap on jobs per batched forward pass.",
    )
    max_batch_wait_ms: int = Field(
        default=20, ge=0,
        description="How long to hold the window collecting same-model jobs.",
    )
    poll_interval_ms: float = Field(
        default=1.0, gt=0,
        description="Re-poll cadence inside the window when no jobs are immediately ready.",
    )


class TimeoutSettings(BaseModel):
    """Reliability deadlines and stale-entry reclaim policy."""

    job_timeout_s: float = Field(
        default=30.0, gt=0,
        description="If no result within this window the job is failed as timeout.",
    )
    reclaim_min_idle_ms: int = Field(
        default=90_000, ge=0,
        description=(
            "Pending entries idle longer than this are reclaimed by another worker. "
            "'Idle' means time since DELIVERY, not time since the owner died, so this "
            "must exceed the slowest realistic batch or a healthy worker's in-flight "
            "batch gets stolen and executed twice."
        ),
    )
    reclaim_interval_s: float = Field(
        default=15.0, gt=0,
        description="How often a worker sweeps for reclaimable stale entries.",
    )
    max_deliveries: int = Field(
        default=3, ge=1,
        description=(
            "How many times an entry may be delivered before it is dead-lettered. "
            "Bounds the blast radius of a payload that kills the worker process "
            "(which run_batch's exception handling cannot catch)."
        ),
    )
    inference_timeout_s: float = Field(
        default=120.0, gt=0,
        description=(
            "Watchdog for a single batched forward pass. A wedged model (CUDA "
            "deadlock, stalled weight read) otherwise hangs the worker forever: it "
            "never publishes, never acks and never heartbeats again."
        ),
    )
    result_ttl_s: int = Field(
        default=300, ge=1,
        description="TTL for the late-join-safe result value key (>= job_timeout_s).",
    )

    @model_validator(mode="after")
    def _check_deadlines(self) -> TimeoutSettings:
        """Enforce the deadline invariant the field docs already promised.

        ``result_ttl_s >= job_timeout_s`` was documented but unvalidated, so
        raising ``job_timeout_s`` alone made the result key expire *before* the
        client's deadline — a successfully computed result the client could no
        longer late-join to.

        Note that ``reclaim_min_idle_ms`` is deliberately *larger* than
        ``job_timeout_s``: you cannot safely conclude a worker is dead until well
        past the slowest batch, so reclaim protects queue durability (the job is
        recomputed and cached for a late-joining client), not the original
        socket, which will already have timed out.
        """

        if self.result_ttl_s < self.job_timeout_s:
            raise ValueError(
                "timeouts.result_ttl_s must be >= timeouts.job_timeout_s "
                f"(got {self.result_ttl_s} < {self.job_timeout_s})"
            )
        return self


class ServerSettings(BaseModel):
    """Gateway HTTP/WS server binding."""

    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8000, ge=1, le=65_535)
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"],
        description="Allowed browser origins for the dev UI.",
    )
    api_prefix: str = Field(default="/api/v1")
    serve_frontend_dir: str = Field(
        default="",
        description="If set to a built frontend directory, the gateway serves it "
        "at / (same-origin). Used for single-container demo deploys; empty in dev.",
    )


class MetricsSettings(BaseModel):
    """Observability cadence and rolling-window sizing."""

    snapshot_interval_s: float = Field(
        default=1.0, gt=0,
        description="How often the metrics WebSocket pushes a snapshot.",
    )
    rolling_window_s: float = Field(
        default=10.0, gt=0,
        description="Sliding window for req/s and latency percentiles.",
    )
    enable_gpu: bool = Field(
        default=True,
        description="Attempt pynvml GPU stats. Calls are still guarded if unavailable.",
    )


class WorkerSettings(BaseModel):
    """Per-worker identity and the model it serves."""

    model_name: str = Field(
        default="dummy-echo",
        description="Which registered model THIS worker process loads and serves.",
    )
    id_prefix: str = Field(
        default="worker",
        description="Human-readable prefix for the generated worker id.",
    )
    heartbeat_interval_s: float = Field(default=2.0, gt=0)
    heartbeat_ttl_s: int = Field(
        default=6, ge=1,
        description="Heartbeat key TTL; if a worker dies its presence expires.",
    )
    liveness_file: str = Field(
        default="/tmp/inferno-worker-alive",  # noqa: S108 - container-local, non-secret
        description=(
            "Touched on every heartbeat so an orchestrator can probe worker liveness. "
            "A worker serves no HTTP, so there is nothing for an httpGet probe to hit; "
            "the file's mtime is the signal (see the exec probes in k8s/workers.yaml). "
            "It is first written only after the model has loaded and warmed up, so it "
            "doubles as a readiness signal. Set to \"\" to disable."
        ),
    )


class ModelSettings(BaseModel):
    """Where model definitions come from and where artifacts are cached."""

    config_path: Path = Field(default=DEFAULT_MODELS_CONFIG)
    artifact_dir: Path = Field(default=DEFAULT_ARTIFACT_DIR)


class CacheSettings(BaseModel):
    """Result cache: skip recompute on repeated (model, input) pairs."""

    enabled: bool = Field(default=True, description="Serve identical requests from cache.")
    ttl_s: int = Field(default=300, ge=1, description="How long a cached result stays valid.")


class AuthSettings(BaseModel):
    """Optional API-key authentication (disabled by default for local dev)."""

    enabled: bool = Field(default=False, description="Require a valid API key on /infer.")
    api_keys: list[str] = Field(
        default_factory=list,
        description="Accepted API keys. Set via INFERNO_AUTH__API_KEYS as a JSON array.",
    )
    header_name: str = Field(default="X-API-Key", description="Header carrying the key.")


class RateLimitSettings(BaseModel):
    """Per-client request quota (token-bucket via a Redis fixed window)."""

    enabled: bool = Field(default=False, description="Enforce per-client request quotas.")
    requests_per_minute: int = Field(
        default=120, ge=1, description="Max requests per client per window."
    )
    window_s: int = Field(default=60, ge=1, description="Quota window length in seconds.")
    trust_proxy_headers: bool = Field(
        default=False,
        description=(
            "Read the caller IP from X-Forwarded-For / X-Real-IP instead of the socket "
            "peer. Enable ONLY when a proxy you control sets those headers (nginx, k8s "
            "ingress, Render/Fly). Without it, every request behind a proxy shares one "
            "quota bucket; with it on an unproxied gateway, clients can spoof the header."
        ),
    )


class HistorySettings(BaseModel):
    """Durable persistence of completed inferences (history/audit trail)."""

    enabled: bool = Field(default=True, description="Persist every completed inference.")
    redis_maxlen: int = Field(
        default=5_000, ge=1,
        description="How many recent inferences to keep in the Redis history stream.",
    )
    jsonl_enabled: bool = Field(
        default=True,
        description="Also append every inference to a JSONL file on disk (true durability).",
    )
    jsonl_path: Path = Field(
        default=DEFAULT_ARTIFACT_DIR / "inferences.jsonl",
        description="Where the append-only JSONL inference log is written.",
    )
    store_input: bool = Field(
        default=True,
        description="Include a truncated input preview in each record (no raw image bytes).",
    )
    input_preview_chars: int = Field(default=240, ge=0)


class InferenceSettings(BaseModel):
    """Compute-device selection for model execution (centralized, not hardcoded).

    ``auto`` prefers CUDA when a usable device is present and transparently falls
    back to CPU otherwise, so the same image runs on a GPU box or a laptop.
    """

    device: Literal["auto", "cpu", "cuda"] = Field(
        default="auto",
        description="Torch device + ONNX provider preference.",
    )
    onnx_providers: list[str] | None = Field(
        default=None,
        description="Explicit ONNX Runtime provider list; None = derive from `device`.",
    )
    compile: bool = Field(
        default=False,
        description="Apply torch.compile to torch models (faster after warmup).",
    )
    quantize: Literal["none", "int8", "fp16"] = Field(
        default="none",
        description="Quantize torch models: int8 dynamic (CPU) or fp16 (GPU).",
    )


class ChatSettings(BaseModel):
    """Streaming chat service: a local generative LLM, grounded by RAG.

    Runs as its own service (the gateway never loads models). Generation is
    streamed token-by-token over SSE.
    """

    enabled: bool = Field(default=True)
    model_id: str = Field(
        default="Qwen/Qwen2.5-0.5B-Instruct",
        description="A small local instruct model (runs on CPU; slow but self-contained).",
    )
    max_new_tokens: int = Field(default=256, ge=1, le=2048)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    port: int = Field(default=8100, ge=1, le=65_535)
    gateway_url: str = Field(
        default="http://127.0.0.1:8000",
        description="Where the chat service reaches the platform for RAG retrieval.",
    )


class OtelSettings(BaseModel):
    """OpenTelemetry distributed tracing (optional; off by default)."""

    enabled: bool = Field(default=False, description="Emit spans across gateway + workers.")
    endpoint: str = Field(
        default="",
        description="OTLP/HTTP collector endpoint; empty = print spans to the console.",
    )


class LoggingSettings(BaseModel):
    """Structured-logging behavior."""

    level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    render_json: bool = Field(
        default=True,
        description="JSON logs for prod; set false for colorized console in dev.",
    )


class Settings(BaseSettings):
    """Root settings object composing every group.

    Access via :func:`get_settings` (cached). Construct directly only in tests
    that need a bespoke configuration.
    """

    model_config = SettingsConfigDict(
        env_prefix="INFERNO_",
        env_nested_delimiter="__",
        env_file=(REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    environment: Literal["dev", "test", "prod"] = "dev"
    service_name: str = Field(default="inferno")

    redis: RedisSettings = Field(default_factory=RedisSettings)
    queue: QueueSettings = Field(default_factory=QueueSettings)
    batching: BatchingSettings = Field(default_factory=BatchingSettings)
    timeouts: TimeoutSettings = Field(default_factory=TimeoutSettings)
    server: ServerSettings = Field(default_factory=ServerSettings)
    metrics: MetricsSettings = Field(default_factory=MetricsSettings)
    worker: WorkerSettings = Field(default_factory=WorkerSettings)
    models: ModelSettings = Field(default_factory=ModelSettings)
    inference: InferenceSettings = Field(default_factory=InferenceSettings)
    history: HistorySettings = Field(default_factory=HistorySettings)
    cache: CacheSettings = Field(default_factory=CacheSettings)
    auth: AuthSettings = Field(default_factory=AuthSettings)
    ratelimit: RateLimitSettings = Field(default_factory=RateLimitSettings)
    chat: ChatSettings = Field(default_factory=ChatSettings)
    otel: OtelSettings = Field(default_factory=OtelSettings)
    logging: LoggingSettings = Field(default_factory=LoggingSettings)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings singleton.

    Cached so configuration is parsed exactly once and the same immutable object
    is shared everywhere. Tests can call ``get_settings.cache_clear()`` to reload
    after mutating the environment.
    """

    return Settings()
