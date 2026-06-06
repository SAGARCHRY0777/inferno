"""All Pydantic v2 data contracts (Section 5 of the spec).

These models are the typed boundary between every component. Validation happens
here, once, at the edge -- a malformed request is rejected at the gateway with
422 and never reaches a worker. Internal models (``Job``, ``InferenceResult``)
are the wire format on Redis.
"""

from __future__ import annotations

import base64
import binascii
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from backend.core.enums import InputType, JobStatus, ResultStatus, TaskType
from backend.core.timing import now


class _Frozen(BaseModel):
    """Base for immutable value objects (results/timings don't mutate)."""

    model_config = ConfigDict(frozen=True)


# --------------------------------------------------------------------------- #
# Client -> Gateway                                                            #
# --------------------------------------------------------------------------- #
class InferenceRequest(BaseModel):
    """The request a client submits to ``POST /infer``."""

    model_config = ConfigDict(extra="forbid")

    model_name: str = Field(..., min_length=1, examples=["resnet-image"])
    input_type: InputType
    payload: str = Field(..., min_length=1, description="base64 image OR raw text")
    priority: int = Field(default=0, ge=0, le=9, description="Higher served sooner.")

    @model_validator(mode="after")
    def _validate_payload_for_type(self) -> InferenceRequest:
        """Ensure the payload is well-formed for its declared ``input_type``.

        Images must be valid base64; text must be non-blank. Rejecting here keeps
        the worker fault-isolation path for *model* failures, not malformed
        input -- bad input never even enqueues.
        """

        if self.input_type in (InputType.IMAGE, InputType.AUDIO):
            try:
                base64.b64decode(self.payload, validate=True)
            except (binascii.Error, ValueError) as exc:
                raise ValueError(
                    f"payload is not valid base64 for input_type={self.input_type}"
                ) from exc
        elif self.input_type is InputType.TEXT and not self.payload.strip():
            raise ValueError("payload must be non-empty text for input_type=text")
        return self


# --------------------------------------------------------------------------- #
# Internal queue entry                                                         #
# --------------------------------------------------------------------------- #
class Job(BaseModel):
    """A unit of work enqueued on Redis, derived from an ``InferenceRequest``."""

    job_id: UUID = Field(default_factory=uuid4)
    model_name: str
    input_type: InputType
    payload: str
    priority: int = 0
    enqueued_at: float = Field(default_factory=now, description="epoch seconds")
    trace: dict[str, str] = Field(
        default_factory=dict,
        description="W3C trace-context carrier for cross-process OpenTelemetry spans.",
    )

    @classmethod
    def from_request(cls, request: InferenceRequest) -> Job:
        """Stamp a request into an enqueued job (assigns id + enqueue time)."""

        return cls(
            model_name=request.model_name,
            input_type=request.input_type,
            payload=request.payload,
            priority=request.priority,
        )


# --------------------------------------------------------------------------- #
# Worker -> Gateway -> Client                                                  #
# --------------------------------------------------------------------------- #
class Prediction(_Frozen):
    """A single labeled prediction with a normalized confidence.

    For *detection* models, ``box`` carries the bounding box as normalized
    ``[x1, y1, x2, y2]`` in the 0..1 range (so the UI can scale it to whatever
    size the image is displayed at). Classification models leave it ``None``.
    """

    label: str
    score: float = Field(..., ge=0.0, le=1.0)
    box: list[float] | None = Field(
        default=None,
        description="Detection box [x1,y1,x2,y2] normalized to 0..1; None for classifiers.",
    )
    source: str | None = Field(
        default=None,
        description="Citation/source for this item (e.g. the document a RAG passage came from).",
    )


class Timings(_Frozen):
    """The full timing breakdown surfaced in the UI."""

    queue_ms: float = Field(..., ge=0.0, description="enqueue -> picked up by worker")
    batch_wait_ms: float = Field(..., ge=0.0, description="time inside the batch window")
    inference_ms: float = Field(..., ge=0.0, description="attributed batched forward pass")
    total_ms: float = Field(..., ge=0.0, description="enqueue -> result published")


class InferenceResult(BaseModel):
    """The result delivered to the client over the result WebSocket."""

    job_id: UUID
    model_name: str
    status: ResultStatus
    predictions: list[Prediction] = Field(default_factory=list)
    error: str | None = None
    timings: Timings
    batch_size: int = Field(..., ge=1, description="jobs that ran in this batch")
    worker_id: str
    cached: bool = Field(default=False, description="True if served from the result cache.")

    @field_validator("predictions")
    @classmethod
    def _no_predictions_on_error(cls, v: list[Prediction], info):  # type: ignore[no-untyped-def]
        return v


# --------------------------------------------------------------------------- #
# Observability contracts                                                      #
# --------------------------------------------------------------------------- #
class LatencyPercentiles(_Frozen):
    p50: float
    p90: float
    p99: float


class GpuStats(_Frozen):
    """Optional GPU telemetry; absent on CPU-only hosts."""

    index: int
    name: str
    utilization_pct: float
    vram_used_mb: float
    vram_total_mb: float


class WorkerHeartbeat(BaseModel):
    """A worker's periodic self-report, aggregated by the gateway.

    Workers carry their own CPU/RAM/GPU readings here because *they* run the
    models -- so the dashboard reflects the machines doing real work, not the
    stateless gateway.
    """

    worker_id: str
    model_name: str
    state: str
    jobs_processed: int = 0
    last_batch_size: int = 0
    cpu_pct: float = 0.0
    ram_pct: float = 0.0
    gpus: list[GpuStats] = Field(default_factory=list)
    updated_at: float = Field(default_factory=now)


class HistoryRecord(BaseModel):
    """A durably-persisted record of one completed inference (the audit trail).

    Carries everything needed to reconstruct what happened: the result, a
    truncated input preview (never raw image bytes), and a wall-clock timestamp.
    """

    timestamp: float = Field(default_factory=now)
    job_id: UUID
    model_name: str
    input_type: InputType
    input_preview: str = ""
    status: ResultStatus
    predictions: list[Prediction] = Field(default_factory=list)
    error: str | None = None
    timings: Timings
    batch_size: int
    worker_id: str

    @classmethod
    def build(cls, result: InferenceResult, *, input_type: InputType, input_preview: str):
        return cls(
            job_id=result.job_id,
            model_name=result.model_name,
            input_type=input_type,
            input_preview=input_preview,
            status=result.status,
            predictions=list(result.predictions),
            error=result.error,
            timings=result.timings,
            batch_size=result.batch_size,
            worker_id=result.worker_id,
        )


class ModelInfo(_Frozen):
    """A servable model as advertised by ``GET /models``."""

    name: str
    kind: str
    input_type: InputType
    task: TaskType
    description: str


class InferAccepted(_Frozen):
    """The 202 response when a job is accepted for processing."""

    job_id: UUID
    model_name: str
    status: JobStatus
    enqueued_at: float
    result_ws: str = Field(..., description="WebSocket path to await this job's result.")


class HealthResponse(_Frozen):
    """Liveness/readiness payload for ``GET /health``."""

    status: Literal["ok", "degraded"]
    redis: bool
    models: list[str]
    workers_active: int


class ModelStats(_Frozen):
    """Per-model rolling stats for the dashboard breakdown."""

    model_name: str
    requests_per_sec: float
    p50_ms: float
    p99_ms: float
    errors: int
    avg_batch: float


class MetricsSnapshot(BaseModel):
    """The ~1Hz snapshot pushed over the metrics WebSocket to the dashboard."""

    timestamp: float = Field(default_factory=now)
    requests_per_sec: float = 0.0
    latency_ms: LatencyPercentiles
    queue_depth: int = 0
    workers_active: int = 0
    recent_batch_sizes: list[int] = Field(default_factory=list)
    cpu_pct: float = 0.0
    ram_pct: float = 0.0
    gpus: list[GpuStats] = Field(default_factory=list)
    workers: list[WorkerHeartbeat] = Field(default_factory=list)
    per_model: list[ModelStats] = Field(default_factory=list)
