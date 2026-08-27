"""Worker process entrypoint.

A worker is an independent process that loads exactly one model and runs the
consume -> batch -> infer -> publish -> ack loop. Scaling is just launching more
of these; they share nothing but Redis. Run with::

    python -m backend.worker.main
    INFERNO_WORKER__MODEL_NAME=distilbert-sentiment python -m backend.worker.main
"""

from __future__ import annotations

import os
import socket
import sys
import time
import uuid

import redis

from backend.broker.base import WorkerBroker
from backend.broker.redis_broker import RedisWorkerBroker
from backend.core import sysinfo
from backend.core.cache import CacheWriter
from backend.core.config import get_settings
from backend.core.enums import ResultStatus, WorkerState
from backend.core.history import HistoryWriter, input_preview
from backend.core.logging import configure_logging, get_logger
from backend.core.metrics import MetricsWriter
from backend.core.redis_client import close as close_redis
from backend.core.redis_client import get_sync_redis
from backend.core.schemas import HistoryRecord, WorkerHeartbeat
from backend.core.timing import monotonic, now
from backend.core.tracing import configure_tracing, extract, get_tracer
from backend.models.base import BaseModel
from backend.models.registry import build_model
from backend.worker.batcher import BatchWindow
from backend.worker.lifecycle import GracefulShutdown
from backend.worker.runner import BatchItem, run_batch
from backend.worker.watchdog import InferenceWatchdog

#: Exit status used by the fault-injection crash point, distinct from 1 so a
#: test can tell a deliberate crash from an ordinary unhandled error.
CRASH_EXIT_CODE = 137

#: Set to "1" to make the worker die between reading a batch and publishing it.
#: Off unless explicitly exported; see ``Worker._maybe_crash``.
CRASH_AFTER_READ_ENV = "INFERNO_CRASH_AFTER_READ"


def _make_worker_id(prefix: str) -> str:
    """Stable-ish, human-readable, collision-resistant worker id."""

    return f"{prefix}-{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:6]}"


class Worker:
    """The worker's lifecycle and main loop, broken out for testability."""

    def __init__(self, broker: WorkerBroker, model: BaseModel, worker_id: str) -> None:
        self._broker = broker
        self._model = model
        self._worker_id = worker_id
        self._model_name = model.name
        self._metrics = MetricsWriter(get_sync_redis())
        self._history = HistoryWriter(get_sync_redis())
        self._cache = CacheWriter(get_sync_redis())
        self._window = BatchWindow(broker, self._model_name, worker_id)
        self._shutdown = GracefulShutdown()
        self._log = get_logger("worker", worker_id=worker_id, model_name=self._model_name)
        self._jobs_processed = 0
        self._last_batch_size = 0
        self._last_heartbeat = 0.0
        self._last_reclaim = 0.0
        self._watchdog = InferenceWatchdog(
            get_settings().timeouts.inference_timeout_s, worker_id=worker_id
        )

    # -- public ------------------------------------------------------------- #
    def run(self) -> None:
        self._shutdown.install()
        self._broker.ensure_topology(self._model_name)
        self._model.ensure_loaded()
        self._model.warmup()
        self._heartbeat(WorkerState.IDLE)
        self._log.info("worker_ready")

        self._watchdog.start()

        try:
            self._loop()
        finally:
            self._watchdog.stop()
            # force=True: the rate limiter would otherwise swallow this write
            # (the last heartbeat is almost always < heartbeat_interval_s old on
            # exit), leaving the key reading "running" until its TTL expires so
            # /health and the dashboard count a dead worker as live for seconds.
            self._heartbeat(WorkerState.STOPPED, force=True)
            self._log.info("worker_drained", jobs_processed=self._jobs_processed)

    # -- internals ---------------------------------------------------------- #
    def _loop(self) -> None:
        while not self._shutdown.stopping:
            try:
                self._maybe_reclaim()
                items, window_closed_ts = self._window.collect()
                if not items:
                    self._heartbeat(WorkerState.IDLE)
                    continue
                self._maybe_crash(len(items))
                self._process(items, window_closed_ts)
                # force=True: _process just wrote a forced RUNNING heartbeat, so
                # an unforced write here is always inside the rate-limit window
                # and the RUNNING -> IDLE transition never reaches Redis.
                self._heartbeat(WorkerState.IDLE, force=True)
            except redis.exceptions.RedisError as exc:
                # Redis hiccup or restart -> don't crash. redis-py reconnects on
                # the next command; back off briefly and retry the loop.
                self._log.warning("redis_error_retrying", error=str(exc))
                time.sleep(1.0)

    def _process(self, items: list[BatchItem], window_closed_ts: float) -> None:
        self._heartbeat(WorkerState.RUNNING, force=True)
        # Continue the distributed trace started by the gateway (no-op if OTel off).
        parent = extract(items[0].job.trace) if items else None
        with get_tracer("worker").start_as_current_span(
            "infer.batch", context=parent
        ) as span:
            span.set_attribute("model_name", self._model_name)
            span.set_attribute("batch_size", len(items))
            # Guarded: a forward pass that never returns would otherwise hang this
            # worker forever (no publish, no ack, no heartbeat).
            with self._watchdog.guard(batch_size=len(items)):
                results = run_batch(
                    self._model,
                    items,
                    worker_id=self._worker_id,
                    window_closed_ts=window_closed_ts,
                )
        # Publish results FIRST, then ack: a crash in between leaves the entries
        # pending (reclaimable) rather than acked-but-unpublished -> no lost work.
        for result in results:
            self._broker.publish_result(result)
            self._metrics.record_job(
                model_name=result.model_name,
                status=result.status,
                latency_ms=result.timings.total_ms,
                batch_size=result.batch_size,
            )
        self._broker.ack(self._model_name, [it.entry_id for it in items])

        # Populate the result cache so identical future requests skip recompute.
        for it, result in zip(items, results, strict=False):
            self._cache.write(it.job.model_name, it.job.payload, result)

        # Durably persist the inferences (Redis history stream + JSONL on disk).
        self._history.write(
            [
                HistoryRecord.build(
                    result,
                    input_type=it.job.input_type,
                    input_preview=input_preview(it.job),
                )
                for it, result in zip(items, results, strict=False)
            ]
        )

        self._jobs_processed += len(items)
        self._last_batch_size = len(items)
        errors = sum(1 for r in results if r.status is ResultStatus.ERROR)
        self._log.info(
            "batch_processed", batch_size=len(items), errors=errors,
            total=self._jobs_processed,
        )

    def _maybe_crash(self, batch_size: int) -> None:
        """Fault-injection seam: die after reading a batch, before publishing it.

        This is the exact window the durability claim rests on. The entries have
        been delivered by ``XREADGROUP`` so they are pending against this
        consumer, but nothing has been published or acked yet -- a crash here
        must leave the work reclaimable rather than lost. Killing the process
        from outside at the right instant is a race; a deterministic crash point
        makes the test reproducible.

        ``os._exit`` and not ``sys.exit``: ``sys.exit`` raises ``SystemExit``,
        which the loop's ``finally`` would catch on the way out, running the
        drain heartbeat and potentially an ack. The test would then pass for the
        wrong reason. ``os._exit`` skips ``finally`` blocks, ``atexit`` handlers
        and buffer flushes, which is what an OOM kill or a lost node looks like.

        Guarded by an environment variable that nothing sets in production.
        """

        if os.environ.get(CRASH_AFTER_READ_ENV) != "1":
            return
        self._log.error("crash_point_fired", batch_size=batch_size)
        # Flush explicitly: os._exit will not, and the log line is the only clue
        # in the test output that the crash was deliberate.
        sys.stderr.flush()
        sys.stdout.flush()
        os._exit(CRASH_EXIT_CODE)

    def _maybe_reclaim(self) -> None:
        t = get_settings().timeouts
        if monotonic() - self._last_reclaim < t.reclaim_interval_s:
            return
        self._last_reclaim = monotonic()
        claimed = self._broker.reclaim_stale(
            self._model_name,
            self._worker_id,
            min_idle_ms=t.reclaim_min_idle_ms,
            count=get_settings().batching.max_batch_size,
        )
        if claimed:
            pickup = now()
            items = [BatchItem(eid, job, pickup_ts=pickup) for eid, job in claimed]
            self._process(items, window_closed_ts=pickup)

    def _touch_liveness_file(self) -> None:
        """Refresh the mtime an orchestrator's exec probe reads.

        A worker exposes no HTTP port, so there is nothing for an ``httpGet``
        probe to hit; without this a wedged worker is never restarted and a
        rollout reports success the instant the container starts, long before the
        model has finished loading.
        """

        path = get_settings().worker.liveness_file
        if not path:
            return
        try:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(self._worker_id)
        except OSError as exc:  # a read-only /tmp must never kill the worker
            self._log.warning("liveness_file_write_failed", path=path, error=str(exc))

    def _heartbeat(self, state: WorkerState, *, force: bool = False) -> None:
        w = get_settings().worker
        if not force and monotonic() - self._last_heartbeat < w.heartbeat_interval_s:
            return
        self._last_heartbeat = monotonic()
        self._touch_liveness_file()
        cpu, ram = sysinfo.collect_cpu_ram()
        hb = WorkerHeartbeat(
            worker_id=self._worker_id,
            model_name=self._model_name,
            state=str(state),
            jobs_processed=self._jobs_processed,
            last_batch_size=self._last_batch_size,
            cpu_pct=cpu,
            ram_pct=ram,
            gpus=sysinfo.collect_gpus(),
        )
        try:
            self._broker.heartbeat(hb, ttl_s=w.heartbeat_ttl_s)
        except redis.exceptions.RedisError as exc:
            self._log.debug("heartbeat_skipped", error=str(exc))


def main() -> None:
    configure_logging(service="worker")
    configure_tracing("worker")
    settings = get_settings()
    worker_id = _make_worker_id(settings.worker.id_prefix)
    broker = RedisWorkerBroker(get_sync_redis())
    model = build_model(settings.worker.model_name)
    try:
        Worker(broker, model, worker_id).run()
    finally:
        broker.close()
        close_redis()


if __name__ == "__main__":
    main()
