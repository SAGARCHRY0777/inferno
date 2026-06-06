"""The single home for fixed (non-tunable) literals.

Anything that is *not* an operator-tunable setting but still must not be
duplicated across the codebase lives here: Redis key namespaces, pub/sub channel
templates, HTTP header names, Prometheus metric names, WebSocket message types,
and structured-log field keys.

Rule of thumb:
  * If it changes per deployment  -> it is a setting (``core.config``).
  * If it is a fixed protocol/wire constant -> it lives here.

Nothing in the system should hardcode these values inline.
"""

from __future__ import annotations

from typing import Final

# --------------------------------------------------------------------------- #
# Redis key namespace                                                          #
# --------------------------------------------------------------------------- #
# All keys are built through ``core.redis_keys`` using these fragments so the
# layout is described in exactly one place and can be prefixed per environment.
KEY_SEPARATOR: Final[str] = ":"
NAMESPACE: Final[str] = "inferno"

STREAM_SEGMENT: Final[str] = "jobs"          # inferno:jobs:<model>  (one stream per model lane)
RESULT_SEGMENT: Final[str] = "result"        # inferno:result:<job_id> (pub/sub channel)
RESULT_VALUE_SEGMENT: Final[str] = "resultval"  # inferno:resultval:<job_id> (TTL'd, late-join safe)
HEARTBEAT_SEGMENT: Final[str] = "worker"     # inferno:worker:<worker_id> (heartbeat hash)
WORKERS_INDEX_SEGMENT: Final[str] = "workers"  # inferno:workers (set of live worker ids)
CACHE_SEGMENT: Final[str] = "cache"          # inferno:cache:<hash> (result cache, TTL'd)
RATELIMIT_SEGMENT: Final[str] = "ratelimit"  # inferno:ratelimit:<client>:<window> (quota counter)
HISTORY_SEGMENT: Final[str] = "history"      # inferno:history (durable capped stream of results)
FIELD_RECORD: Final[str] = "record"          # serialized HistoryRecord JSON in a history entry

METRICS_SEGMENT: Final[str] = "metrics"      # inferno:metrics:... (shared counters + samples)
METRICS_SAMPLES_SEGMENT: Final[str] = "samples"   # inferno:metrics:samples (capped sample stream)
METRICS_COUNTER_SEGMENT: Final[str] = "counter"   # inferno:metrics:counter:<name>:<labels>

# Field names inside a metrics sample stream entry.
SAMPLE_TS: Final[str] = "ts"
SAMPLE_LATENCY_MS: Final[str] = "latency_ms"
SAMPLE_BATCH_SIZE: Final[str] = "batch_size"
SAMPLE_MODEL: Final[str] = "model"
SAMPLE_STATUS: Final[str] = "status"

# --------------------------------------------------------------------------- #
# Redis Stream field names (the entry payload schema)                          #
# --------------------------------------------------------------------------- #
FIELD_JOB: Final[str] = "job"                # serialized Job JSON inside a stream entry

# --------------------------------------------------------------------------- #
# HTTP                                                                         #
# --------------------------------------------------------------------------- #
HEADER_RETRY_AFTER: Final[str] = "Retry-After"
HEADER_REQUEST_ID: Final[str] = "X-Request-ID"

# --------------------------------------------------------------------------- #
# Prometheus metric names (registered once in ``core.metrics``)               #
# --------------------------------------------------------------------------- #
METRIC_REQUESTS_TOTAL: Final[str] = "inference_requests_total"
METRIC_LATENCY_SECONDS: Final[str] = "inference_latency_seconds"
METRIC_BATCH_SIZE: Final[str] = "inference_batch_size"
METRIC_QUEUE_DEPTH: Final[str] = "inference_queue_depth"
METRIC_WORKERS_ACTIVE: Final[str] = "inference_workers_active"
METRIC_ERRORS_TOTAL: Final[str] = "inference_errors_total"

# --------------------------------------------------------------------------- #
# WebSocket message envelope types (client <-> gateway)                        #
# --------------------------------------------------------------------------- #
WS_TYPE_RESULT: Final[str] = "result"
WS_TYPE_METRICS: Final[str] = "metrics"
WS_TYPE_ERROR: Final[str] = "error"
WS_TYPE_TIMEOUT: Final[str] = "timeout"
WS_TYPE_PING: Final[str] = "ping"
WS_TYPE_PONG: Final[str] = "pong"

# --------------------------------------------------------------------------- #
# Structured-log field keys (so every module logs the same dimension names)    #
# --------------------------------------------------------------------------- #
LOG_JOB_ID: Final[str] = "job_id"
LOG_WORKER_ID: Final[str] = "worker_id"
LOG_MODEL: Final[str] = "model_name"
LOG_BATCH_SIZE: Final[str] = "batch_size"
LOG_EVENT: Final[str] = "event"
LOG_SERVICE: Final[str] = "service"
LOG_COMPONENT: Final[str] = "component"
