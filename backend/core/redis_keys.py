"""Centralized Redis key & channel builders.

The Redis keyspace layout is described in exactly one place. No module
concatenates key strings by hand -- they call these helpers, so renaming a
namespace or adding an environment prefix is a one-line change here.
"""

from __future__ import annotations

from uuid import UUID

from backend.core import constants as C


def _join(*parts: str) -> str:
    return C.KEY_SEPARATOR.join((C.NAMESPACE, *parts))


def job_stream(model_name: str) -> str:
    """Stream holding pending jobs for a single model lane.

    One stream per model keeps the batching window naturally homogeneous: a
    worker reads only its model's stream, so every entry in a window is already
    the same ``model_name`` (no cross-model filtering needed).
    """

    return _join(C.STREAM_SEGMENT, model_name)


def express_stream(model_name: str) -> str:
    """High-priority lane for a model.

    Redis Streams are strictly FIFO — entries cannot be reordered once appended —
    so priority is expressed as a *separate stream* that workers drain first,
    not as a sort key. Jobs with ``priority >= queue.express_priority_min`` land
    here; everything else stays on :func:`job_stream`.

    Keeping the normal lane's key unchanged matters: queue depth, backpressure
    water marks and the KEDA autoscalers all key off it.
    """

    return _join(C.STREAM_SEGMENT, model_name, "express")


def dead_letter_stream(model_name: str) -> str:
    """Stream holding entries that could not be processed and were given up on.

    An entry lands here when it is undecodable, or when it has been delivered
    more than ``timeouts.max_deliveries`` times (a payload that kills the worker
    process rather than raising). Parking it keeps the live lane draining while
    preserving the evidence for debugging.
    """

    return _join(C.STREAM_SEGMENT, model_name, "dead")


def result_channel(job_id: UUID | str) -> str:
    """Pub/Sub channel carrying the result for a single job."""

    return _join(C.RESULT_SEGMENT, str(job_id))


def result_value(job_id: UUID | str) -> str:
    """TTL'd key holding the serialized result.

    Pub/Sub is fire-and-forget: a result published before the gateway subscribes
    would be lost. We also SET the result here with a short TTL so a client that
    connects slightly late can fetch the already-computed result -- no lost work.
    """

    return _join(C.RESULT_VALUE_SEGMENT, str(job_id))


def result_channel_pattern() -> str:
    """PSUBSCRIBE pattern matching every job's result channel.

    Lets the gateway hold a single Pub/Sub connection for ALL result delivery
    (it dispatches each message to the right in-process waiter), instead of one
    connection per connected client -- O(1) Redis connections, not O(clients).
    """

    return _join(C.RESULT_SEGMENT, "*")


def job_id_from_result_channel(channel: str) -> str:
    """Extract the job id from a result channel name."""

    return channel.rsplit(C.KEY_SEPARATOR, 1)[-1]


def worker_heartbeat(worker_id: str) -> str:
    """Hash key holding a worker's last heartbeat snapshot (with TTL)."""

    return _join(C.HEARTBEAT_SEGMENT, worker_id)


def workers_index() -> str:
    """Set of currently-live worker ids."""

    return _join(C.WORKERS_INDEX_SEGMENT)


def heartbeat_pattern() -> str:
    """SCAN match pattern for discovering all worker heartbeats."""

    return _join(C.HEARTBEAT_SEGMENT, "*")


def cache(content_hash: str) -> str:
    """Result-cache key for a (model, input) content hash."""

    return _join(C.CACHE_SEGMENT, content_hash)


def ratelimit(client_id: str, window: int) -> str:
    """Per-client fixed-window quota counter key."""

    return _join(C.RATELIMIT_SEGMENT, client_id, str(window))


def history_stream() -> str:
    """Durable, capped stream of completed inferences (does not expire)."""

    return _join(C.HISTORY_SEGMENT)


def metrics_samples() -> str:
    """Capped stream of recent per-job samples (the cluster-wide telemetry feed).

    Workers append a compact sample per completed job; the gateway reads the
    window to compute req/s and latency percentiles for the whole fleet,
    independent of which clients happen to be connected.
    """

    return _join(C.METRICS_SEGMENT, C.METRICS_SAMPLES_SEGMENT)


def metric_counter(name: str, *labels: str) -> str:
    """Shared atomic counter key, e.g. requests_total for (model, status)."""

    return _join(C.METRICS_SEGMENT, C.METRICS_COUNTER_SEGMENT, name, *labels)


def metric_counter_pattern(name: str) -> str:
    """SCAN pattern over all label combinations of a counter."""

    return _join(C.METRICS_SEGMENT, C.METRICS_COUNTER_SEGMENT, name, "*")
