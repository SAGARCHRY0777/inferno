"""Cluster-wide metrics: writer (workers), reader/aggregator + Prometheus (gateway).

The workers do the inference, so the truth about throughput and latency lives in
the worker processes. Rather than guess from the gateway, workers publish two
things to Redis:
  * **atomic counters** (``requests_total``, ``errors_total``) -- cheap INCRs;
  * a **capped sample stream** of recent ``(ts, latency_ms, batch_size, ...)``.

The gateway aggregates these into a :class:`MetricsSnapshot` (req/s, p50/p90/p99,
recent batch sizes) and combines them with live worker heartbeats and queue
depth. The same aggregate backs both the live metrics WebSocket and the
pull-based Prometheus ``/metrics`` endpoint, so the two never disagree.
"""

from __future__ import annotations

from collections import defaultdict

import redis
import redis.asyncio as aredis
from prometheus_client.core import CounterMetricFamily, GaugeMetricFamily

from backend.core import constants as C
from backend.core import redis_keys as keys
from backend.core.config import get_settings
from backend.core.enums import ResultStatus
from backend.core.schemas import (
    GpuStats,
    LatencyPercentiles,
    MetricsSnapshot,
    ModelStats,
    WorkerHeartbeat,
)
from backend.core.timing import now

# Cap the sample stream so it never grows unbounded; the window read only ever
# needs the last few seconds of data.
_SAMPLE_STREAM_MAXLEN = 10_000


def percentile(values: list[float], q: float) -> float:
    """Linear-interpolated percentile of ``values`` for ``q`` in [0, 100].

    Pure and dependency-free so it is trivially unit-testable. Returns 0.0 for an
    empty input. Uses the same interpolation as ``numpy.percentile`` (method
    "linear") but without requiring numpy at call sites.
    """

    if not values:
        return 0.0
    if q <= 0:
        return float(min(values))
    if q >= 100:
        return float(max(values))
    ordered = sorted(values)
    rank = (q / 100.0) * (len(ordered) - 1)
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    frac = rank - low
    return float(ordered[low] + (ordered[high] - ordered[low]) * frac)


# --------------------------------------------------------------------------- #
# Worker side: writing                                                        #
# --------------------------------------------------------------------------- #
class MetricsWriter:
    """Worker-side metrics emitter (sync)."""

    def __init__(self, client: redis.Redis) -> None:
        self._client = client

    def record_job(
        self, *, model_name: str, status: ResultStatus, latency_ms: float, batch_size: int
    ) -> None:
        """Record one completed job: bump counters + append a telemetry sample."""

        pipe = self._client.pipeline(transaction=False)
        pipe.incr(keys.metric_counter(C.METRIC_REQUESTS_TOTAL, model_name, str(status)))
        if status is ResultStatus.ERROR:
            pipe.incr(keys.metric_counter(C.METRIC_ERRORS_TOTAL, model_name))
        pipe.xadd(
            keys.metrics_samples(),
            {
                C.SAMPLE_TS: repr(now()),
                C.SAMPLE_LATENCY_MS: repr(latency_ms),
                C.SAMPLE_BATCH_SIZE: str(batch_size),
                C.SAMPLE_MODEL: model_name,
                C.SAMPLE_STATUS: str(status),
            },
            maxlen=_SAMPLE_STREAM_MAXLEN,
            approximate=True,
        )
        pipe.execute()


# --------------------------------------------------------------------------- #
# Gateway side: reading + aggregation                                         #
# --------------------------------------------------------------------------- #
class MetricsReader:
    """Gateway-side reader that turns shared Redis state into a snapshot (async)."""

    def __init__(self, client: aredis.Redis) -> None:
        self._client = client

    async def _window_samples(self, window_s: float) -> list[dict]:
        # Stream entry ids are millisecond timestamps; bound the read by time so
        # we only ever pull the rolling window, not the whole stream.
        min_id = f"{int((now() - window_s) * 1000)}-0"
        rows = await self._client.xrange(keys.metrics_samples(), min=min_id, max="+")
        return [fields for _id, fields in rows]

    async def snapshot(
        self, *, queue_depth: int, heartbeats: list[WorkerHeartbeat]
    ) -> MetricsSnapshot:
        s = get_settings().metrics
        samples = await self._window_samples(s.rolling_window_s)

        latencies = [float(r[C.SAMPLE_LATENCY_MS]) for r in samples if C.SAMPLE_LATENCY_MS in r]
        batch_sizes = [int(r[C.SAMPLE_BATCH_SIZE]) for r in samples if C.SAMPLE_BATCH_SIZE in r]

        req_per_sec = len(samples) / s.rolling_window_s if s.rolling_window_s else 0.0
        cpu, ram, gpus = _aggregate_host_stats(heartbeats)
        per_model = _per_model_stats(samples, s.rolling_window_s)

        return MetricsSnapshot(
            requests_per_sec=round(req_per_sec, 2),
            latency_ms=LatencyPercentiles(
                p50=round(percentile(latencies, 50), 2),
                p90=round(percentile(latencies, 90), 2),
                p99=round(percentile(latencies, 99), 2),
            ),
            queue_depth=queue_depth,
            workers_active=len(heartbeats),
            recent_batch_sizes=batch_sizes[-50:],
            cpu_pct=cpu,
            ram_pct=ram,
            gpus=gpus,
            workers=heartbeats,
            per_model=per_model,
        )


def _per_model_stats(samples: list[dict], window_s: float) -> list[ModelStats]:
    """Group the rolling samples by model and compute per-model stats."""

    by_model: dict[str, dict[str, list]] = defaultdict(lambda: {"lat": [], "batch": [], "err": 0})
    for r in samples:
        model = r.get(C.SAMPLE_MODEL, "?")
        bucket = by_model[model]
        if C.SAMPLE_LATENCY_MS in r:
            bucket["lat"].append(float(r[C.SAMPLE_LATENCY_MS]))
        if C.SAMPLE_BATCH_SIZE in r:
            bucket["batch"].append(int(r[C.SAMPLE_BATCH_SIZE]))
        if r.get(C.SAMPLE_STATUS) == str(ResultStatus.ERROR):
            bucket["err"] += 1

    out: list[ModelStats] = []
    for model, b in by_model.items():
        lat, batch = b["lat"], b["batch"]
        out.append(
            ModelStats(
                model_name=model,
                requests_per_sec=round(len(lat) / window_s, 2) if window_s else 0.0,
                p50_ms=round(percentile(lat, 50), 1),
                p99_ms=round(percentile(lat, 99), 1),
                errors=b["err"],
                avg_batch=round(sum(batch) / len(batch), 1) if batch else 0.0,
            )
        )
    return sorted(out, key=lambda m: m.requests_per_sec, reverse=True)


def _aggregate_host_stats(
    heartbeats: list[WorkerHeartbeat],
) -> tuple[float, float, list[GpuStats]]:
    """Average CPU/RAM across workers; per-GPU take the max (workers may share a card)."""

    if not heartbeats:
        return 0.0, 0.0, []
    cpu = round(sum(h.cpu_pct for h in heartbeats) / len(heartbeats), 1)
    ram = round(sum(h.ram_pct for h in heartbeats) / len(heartbeats), 1)
    by_index: dict[int, GpuStats] = {}
    for hb in heartbeats:
        for g in hb.gpus:
            cur = by_index.get(g.index)
            if cur is None or g.utilization_pct > cur.utilization_pct:
                by_index[g.index] = g
    return cpu, ram, [by_index[i] for i in sorted(by_index)]


# --------------------------------------------------------------------------- #
# Prometheus: a custom collector over the cluster aggregate                    #
# --------------------------------------------------------------------------- #
class ClusterCollector:
    """Prometheus collector that reflects the whole fleet, not one process.

    On each scrape it reads the shared counters from Redis (sync) and the latest
    in-memory snapshot the gateway already computes for the WS stream, so the
    pull and push views are always consistent.
    """

    def __init__(self, sync_client: redis.Redis, latest_snapshot) -> None:
        self._client = sync_client
        self._latest_snapshot = latest_snapshot  # zero-arg callable -> MetricsSnapshot | None

    def collect(self):  # noqa: C901 - a flat list of metric emissions
        yield from self._counter_family(
            C.METRIC_REQUESTS_TOTAL, "Total inference requests", ("model", "status")
        )
        yield from self._counter_family(
            C.METRIC_ERRORS_TOTAL, "Total inference errors", ("model",)
        )

        snap: MetricsSnapshot | None = self._latest_snapshot()
        if snap is None:
            return
        g_depth = GaugeMetricFamily(C.METRIC_QUEUE_DEPTH, "Pending jobs across all lanes")
        g_depth.add_metric([], snap.queue_depth)
        yield g_depth

        g_workers = GaugeMetricFamily(C.METRIC_WORKERS_ACTIVE, "Live workers")
        g_workers.add_metric([], snap.workers_active)
        yield g_workers

        g_lat = GaugeMetricFamily(
            "inference_latency_ms", "Rolling latency percentiles (ms)", labels=["quantile"]
        )
        g_lat.add_metric(["0.5"], snap.latency_ms.p50)
        g_lat.add_metric(["0.9"], snap.latency_ms.p90)
        g_lat.add_metric(["0.99"], snap.latency_ms.p99)
        yield g_lat

        g_rps = GaugeMetricFamily("inference_requests_per_second", "Rolling throughput")
        g_rps.add_metric([], snap.requests_per_sec)
        yield g_rps

    def _counter_family(self, name: str, doc: str, label_names: tuple[str, ...]):
        family = CounterMetricFamily(name, doc, labels=list(label_names))
        pattern = keys.metric_counter_pattern(name)
        prefix = keys.metric_counter(name) + C.KEY_SEPARATOR
        cursor = 0
        found: list[str] = []
        while True:
            cursor, batch = self._client.scan(cursor=cursor, match=pattern, count=200)
            found.extend(batch)
            if cursor == 0:
                break
        for key in found:
            labels = key[len(prefix):].split(C.KEY_SEPARATOR)
            if len(labels) != len(label_names):
                continue
            value = self._client.get(key)
            family.add_metric(labels, float(value or 0))
        yield family
