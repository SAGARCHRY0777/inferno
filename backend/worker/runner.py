"""Batched execution: preprocess -> single forward pass -> per-job results.

Two guarantees live here:
  * **Fault isolation** -- if the fast batched path raises (e.g. one malformed
    image), we fall back to processing each job alone so a single bad input
    becomes one error result, never a crashed worker or a poisoned batch.
  * **Honest timing** -- each result carries the full breakdown (queue wait,
    time spent in the batch window, attributed inference time, total).
"""

from __future__ import annotations

from dataclasses import dataclass

from backend.core.enums import ResultStatus
from backend.core.errors import InfernoError
from backend.core.logging import get_logger
from backend.core.schemas import InferenceResult, Job, Prediction, Timings
from backend.core.timing import Stopwatch, ms_between, now
from backend.models.base import BaseModel

_log = get_logger("runner")


@dataclass
class BatchItem:
    """One job inside a batch window, with the instant the worker picked it up."""

    entry_id: str
    job: Job
    pickup_ts: float  # epoch seconds when this job was read from the stream


def run_batch(
    model: BaseModel, items: list[BatchItem], *, worker_id: str, window_closed_ts: float
) -> list[InferenceResult]:
    """Run a whole batch and return one result per job, in input order."""

    batch_size = len(items)
    payloads = [it.job.payload for it in items]

    sw = Stopwatch.start()
    try:
        predictions = _forward(model, payloads)
        inference_ms = sw.elapsed_ms()
        return [
            _success(it, preds, inference_ms, window_closed_ts, batch_size, worker_id)
            for it, preds in zip(items, predictions, strict=False)
        ]
    except Exception as exc:  # noqa: BLE001 - deliberately broad: isolate the fault
        _log.warning(
            "batched_path_failed_isolating", batch_size=batch_size, error=str(exc)
        )
        return _run_isolated(model, items, window_closed_ts, worker_id)


def _forward(model: BaseModel, payloads: list[str]) -> list[list[Prediction]]:
    """The fast path: one preprocess + one batched forward pass + postprocess."""

    batch = model.preprocess(payloads)
    raw = model.predict(batch)
    predictions = model.postprocess(raw)
    if len(predictions) != len(payloads):
        raise InfernoError(
            f"model returned {len(predictions)} results for {len(payloads)} inputs"
        )
    return predictions


def _run_isolated(
    model: BaseModel, items: list[BatchItem], window_closed_ts: float, worker_id: str
) -> list[InferenceResult]:
    """Slow path: process each job alone so one bad input can't sink the rest."""

    batch_size = len(items)
    results: list[InferenceResult] = []
    for it in items:
        sw = Stopwatch.start()
        try:
            preds = _forward(model, [it.job.payload])[0]
            results.append(
                _success(it, preds, sw.elapsed_ms(), window_closed_ts, batch_size, worker_id)
            )
        except Exception as exc:  # noqa: BLE001 - per-job error, keep serving
            _log.error(
                "job_failed",
                job_id=str(it.job.job_id),
                model_name=it.job.model_name,
                error=str(exc),
            )
            results.append(
                _error(it, str(exc), sw.elapsed_ms(), window_closed_ts, batch_size, worker_id)
            )
    return results


def _timings(it: BatchItem, inference_ms: float, window_closed_ts: float) -> Timings:
    published = now()
    return Timings(
        queue_ms=ms_between(it.job.enqueued_at, it.pickup_ts),
        batch_wait_ms=ms_between(it.pickup_ts, window_closed_ts),
        inference_ms=round(inference_ms, 3),
        total_ms=ms_between(it.job.enqueued_at, published),
    )


def _success(
    it: BatchItem,
    preds: list[Prediction],
    inference_ms: float,
    window_closed_ts: float,
    batch_size: int,
    worker_id: str,
) -> InferenceResult:
    return InferenceResult(
        job_id=it.job.job_id,
        model_name=it.job.model_name,
        status=ResultStatus.SUCCESS,
        predictions=preds,
        error=None,
        timings=_timings(it, inference_ms, window_closed_ts),
        batch_size=batch_size,
        worker_id=worker_id,
    )


def _error(
    it: BatchItem,
    message: str,
    inference_ms: float,
    window_closed_ts: float,
    batch_size: int,
    worker_id: str,
) -> InferenceResult:
    return InferenceResult(
        job_id=it.job.job_id,
        model_name=it.job.model_name,
        status=ResultStatus.ERROR,
        predictions=[],
        error=message,
        timings=_timings(it, inference_ms, window_closed_ts),
        batch_size=batch_size,
        worker_id=worker_id,
    )
