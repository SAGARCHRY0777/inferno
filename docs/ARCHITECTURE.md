# Architecture

A deep dive into how Inferno works and the engineering decisions behind it. Every claim below maps to real files and functions in the codebase.

## The big picture

Inferno is a **distributed ML inference platform** built around one core idea: separate the I/O-bound edge (a stateless async FastAPI gateway holding thousands of WebSockets) from the CPU/GPU-bound compute tier (a pool of shared-nothing worker processes), and let **Redis** be the only thing they share — as message broker, result bus, metrics store, cache, and heartbeat registry. The throughput lever is **dynamic batching** in the workers; the latency lever is **WebSocket push** for results; the stability lever is **per-model backpressure with hysteresis**. Everything is wired through a single typed config/contract spine so the two processes can never drift on tunables, key names, or wire format.

End-to-end request lifecycle:

1. **Client → Gateway.** `POST /api/v1/infer` hits the FastAPI gateway (`backend/gateway/routes.py`). Pydantic validates the payload at the edge (`InferenceRequest._validate_payload_for_type`), so malformed input is a 422 and never enqueues.
2. **Admission control.** The handler runs a fixed pipeline: `identify_client()` → `RateLimiter.check()` (Redis `INCR`/`EXPIRE` fixed window) → unknown-model 404 → `CacheReader.get()` (instant `cached=True` short-circuit) → `BackpressureController.admit()` (sheds with 429 + `Retry-After` past the high-water mark).
3. **Enqueue.** `broker.enqueue(job)` does `XADD` onto the per-model stream `inferno:jobs:<model>`, inside an OTel span that injects a W3C `traceparent` into `Job.trace`. The gateway returns **HTTP 202** plus the `/ws/{job_id}` path. The gateway never runs a model.
4. **Worker batch.** A worker process (`backend/worker/main.py`) serving exactly one model does a **blocking** `XREADGROUP` for the first job, then **non-blocking** reads to grow the batch until `max_batch_size` (32) or `max_batch_wait_ms` (20ms) — whichever comes first (`batcher.py`).
5. **Inference.** `runner.run_batch()` runs `preprocess → predict → postprocess` once over the whole batch (one forward pass); on any exception it falls back to per-job isolated execution so one bad input yields one ERROR result, not a poisoned batch.
6. **Publish-then-ack.** The worker **publishes the result first** (`SET` TTL'd key + `PUBLISH` to `inferno:result:<job_id>`), records metrics, **then** acks (`XACK`+`XDEL`). A crash in the gap leaves the entry reclaimable — at-least-once, never lost.
7. **Result → Client.** The gateway's single-connection `ResultRouter` (`PSUBSCRIBE inferno:result:*`) dispatches the message to the in-process `Future` for that job; `/ws/{job_id}` delivers exactly one result and closes.
8. **Dashboard.** In parallel, `MetricsHub` aggregates a `MetricsSnapshot` once per ~1Hz tick and fans the same object to all `/ws/metrics` dashboard sockets and the Prometheus `/metrics` endpoint, so push and pull views never disagree.

## Subsystem by subsystem

### Core spine — centralized config + typed contracts (`backend/core`)

**What.** Four files every component depends on: `config.py` (a `pydantic-settings` tree of ~17 nested groups under one `Settings` root), `schemas.py` (the Pydantic v2 wire contracts: `InferenceRequest`, `Job`, `Prediction`, `InferenceResult`, `MetricsSnapshot`…), `enums.py` (every categorical value), and `constants.py`+`redis_keys.py` (fixed protocol literals and the key-builder functions).

**How.** Groups compose on a `BaseSettings` root with `env_prefix="INFERNO_"` and `env_nested_delimiter="__"`, so `INFERNO_BATCHING__MAX_BATCH_SIZE=64` binds to `settings.batching.max_batch_size`. Defaults make the system boot with zero env vars; validators (`QueueSettings._check_watermarks`) fail fast at startup. `get_settings()` is `@lru_cache(maxsize=1)` — an effectively-immutable process singleton parsed once across ~28 call sites; tests call `cache_clear()`. Every Redis key is built through `redis_keys._join(NAMESPACE, *parts)`, so the keyspace layout lives in one place.

**Why this (not that).** Scattered `os.getenv` gives no types/validation/defaults. Raw dicts have no schema, so a bad payload reaches a worker before failing. Plain dataclasses lack env loading and validators. Dynaconf/Hydra are heavier and don't produce typed objects that double as API/wire contracts — and `pydantic-settings` is already pulled in via FastAPI.

**Impressive detail.** A documented rule in `constants.py`: *"changes per deployment → it's a setting; fixed protocol/wire constant → it lives here."* The author drew a principled boundary between operator-tunable knobs and immutable protocol literals — and `result_ttl_s` carries an invariant (`>= job_timeout_s`) so the late-join result key can't expire before the job times out.

### Message broker — Redis Streams + consumer groups + pub/sub (`backend/broker`)

**What.** The transport moving jobs gateway→workers and results back. Jobs go onto per-model streams, consumed by a consumer group (work-sharing across N workers), explicitly acked, and reclaimed if a worker dies mid-batch. Results flow over per-job Pub/Sub channels plus a TTL'd key for late joiners. Gateway and worker depend only on the `AsyncBroker`/`WorkerBroker` ABCs, never on Redis directly.

**How.** `enqueue` does `XADD` with `maxlen`+approximate trimming. The worker's `read_first` is a blocking `XREADGROUP id=">" count=1`; `read_more` is the non-blocking drain. `ack` pipelines `XACK`+`XDEL` so `XLEN` stays an honest backlog gauge. `reclaim_stale` uses `XPENDING` + client-side idle filter + `XCLAIM`. `ResultRouter` holds one `PSUBSCRIBE inferno:result:*` and a `_waiters` dict of `job_id → Future`.

**Why this (not that).** Streams + consumer groups give at-least-once with a pending-entries list (PEL) for crash reclaim — a `LIST`/`BRPOP` pop deletes immediately, so a crash is silent loss. One stream per model lane keeps batch windows homogeneous and stops head-of-line blocking. Kafka/RabbitMQ/SQS add a second broker process or cloud latency; Redis already is the metrics/cache/heartbeat bus. Celery hides the queue and fights manual batch-window control.

**Impressive detail.** `XPENDING`+`XCLAIM` (not `XAUTOCLAIM`) with **client-side** idle filtering is a deliberate portability choice — `XAUTOCLAIM` and the server-side `IDLE` filter are Redis 6.2+, and the project must run on the Redis 5.x portable Windows/Memurai build.

### Gateway — async edge, backpressure, auth/quotas, WS delivery (`backend/gateway`)

**What.** The stateless async HTTP/WebSocket edge. It never runs a model. `create_app()` builds all collaborators once in `lifespan` and exposes them as `GatewayContext` on `app.state.ctx`.

**How.** `infer()` runs identify → rate-limit → 404 → cache → backpressure → enqueue. `RateLimiter.check()` does Redis `INCR` and sets `EXPIRE` only when `count == 1` (true fixed window). `BackpressureController` keeps a per-model `_throttled` bool with separate high/low water marks. `/ws/{job_id:uuid}` calls `ResultRouter.wait()`; `/ws/metrics` gets the shared `MetricsHub` snapshot.

**Why this (not that).** Async FastAPI fits an almost-entirely-I/O-bound tier holding thousands of idle WebSockets — a sync thread-per-request model (Flask/Django) exhausts threads and has no first-class WS story. Backpressure with hysteresis beats unbounded buffering (which turns a spike into latency collapse then OOM). Quotas live in Redis, not in-process, so they're shared across stateless replicas. WebSockets beat polling for instant push. LB-tier rate limiting can't see the authenticated per-key client id.

**Impressive detail.** `/ws/{job_id:uuid}` uses Starlette's `:uuid` converter specifically so it can never shadow the static `/ws/metrics` route — a pre-empted routing-precedence bug and a free input-validation win. And `/metrics` offloads `generate_latest()` to `run_in_threadpool` so a blocking Redis `SCAN` scrape doesn't stall every WebSocket on the event loop.

### Worker pool — dynamic batching, graceful drain, fault isolation (`backend/worker`)

**What.** Each worker is a standalone OS process loading exactly one model, running consume → batch → infer → publish → ack → cache → history against Redis Streams. Scale-out is just launching more processes; they share nothing but Redis.

**How.** `BatchWindow.collect()` blocks for the first job (idle worker costs nothing), then grows the batch via non-blocking polls until size 32 or 20ms — sleeping `min(poll_interval, remaining_window)` to avoid busy-spin. `run_batch()` runs the batched path, falling back to `_run_isolated()` on any exception. `Worker._process` publishes + records metrics **before** acking, then caches and writes `HistoryRecord`s. The loop wraps `redis.exceptions.RedisError` (log + sleep 1s) so a Redis restart retries instead of crashing. `GracefulShutdown.install()` traps SIGTERM/SIGINT and drains the in-flight batch.

**Why this (not that).** No batching wastes the GPU (full fixed overhead per call). Fixed-size-no-timeout makes light-load latency unbounded; the size-OR-wait window self-tunes. Threads lose to the GIL and share a crash domain — separate processes give true parallelism and OS-level isolation. One-worker-all-models multiplies VRAM and couples failure domains.

**Impressive detail.** The publish-before-ack ordering with an explicit comment spelling out the invariant, paired with `XACK`+`XDEL` (honest `XLEN`) and Redis-5.x-compatible reclaim — the author reasoned through crash-consistency *and* deployment portability, not just the happy path.

### Model plugin system — config-driven registry + runtime handling (`backend/models`)

**What.** Every model is a plugin implementing one ABC (`BaseModel`); the servable set is declared in `models.yaml`, not code. Seven reference kinds (dummy, onnx-image, hf-text, yolo-detect, faster-whisper-asr, semantic-search, rag-search). `runtime.py` centralizes all device/provider/optimization logic.

**How.** `BaseModel(ABC, Generic[Batch, RawOutput])` defines a three-stage pipeline `preprocess → predict → postprocess` so the expensive middle runs once per batch. `@register_kind("…")` populates a `_KINDS` dict at import; `build_model(name)` reads a validated `ModelSpec` and instantiates the class without loading weights. `_ensure_kinds_imported()` imports each model module in its own try/except, so a missing optional extra disables only that kind and the gateway never imports torch. `runtime.py` resolves device/ONNX providers with graceful CUDA→CPU fallback.

**Why this (not that).** Hardcoded if/else dispatch couples every model to core worker code. BentoML/TorchServe/Triton would own the batching/transport/metrics layers the project exists to demonstrate. One giant model class is untestable. Per-model inline device logic gets duplicated and inconsistent.

**Impressive detail.** Two kinds for one task — `whisper-asr` (HF transformers) and `faster-whisper-asr` (CTranslate2) implement the identical transcription contract and share a dependency-free `audio_decode.py` (hand-rolled linear resampler to avoid scipy/librosa), so swapping the ASR backend is a one-string change in YAML.

### Observability — Prometheus, OpenTelemetry, structlog (`backend/core` + gateway)

**What.** Workers own the source of truth (they run inference); the gateway aggregates and exposes it. One `MetricsSnapshot` backs both the ~1Hz dashboard WS and the pull-based `/metrics`, so push and pull never disagree. Tracing is guarded/off-by-default OTel; all logging is structlog JSON (no `print()`).

**How.** `MetricsWriter.record_job` pipelines an `INCR` plus an `XADD` of a compact sample to a stream capped at `maxlen=10_000`. `MetricsReader._window_samples` does a time-bounded `XRANGE` using millisecond entry-id timestamps to read only the last 10s. Percentiles use a pure unit-tested `percentile()`. `ClusterCollector.collect()` SCANs counters and reads `hub.latest()` for gauges. Tracing injects/extracts a W3C carrier across processes; `get_tracer` returns a `_NoopTracer` when disabled.

**Why this (not that).** `print`/stdlib logging can't be parsed/correlated. StatsD/Datadog add an agent and an extra hop. Always-on OTel adds latency and a hard dependency. Computing percentiles in the request path recomputes the same aggregate N times. Calling `generate_latest()` directly blocks the loop. The default global registry pollutes output with process collectors.

**Impressive detail.** `_window_samples` exploits Redis stream IDs being millisecond timestamps — `min_id = f"{int((now()-window)*1000)}-0"` makes the rolling-window read O(window) with a free time index. And `_aggregate_host_stats` averages CPU/RAM across workers but reduces per-GPU stats by **max** utilization keyed on GPU index, correctly handling multiple workers sharing one physical card.

### GenAI layer — RAG, MCP agent server, streaming chat (`backend/models/rag.py`, `backend/mcp_server`, `backend/chat`)

**What.** Three loosely-coupled features. RAG is a registered `BaseModel` kind that chunks a markdown corpus, retrieves top-N with a bi-encoder, reranks with a cross-encoder, and returns top-K passages tagged with source for citations. The MCP server exposes 8 agent-callable tools that are thin REST+WS clients of the gateway. The chat service streams a local Qwen2.5-0.5B answer token-by-token over SSE, optionally RAG-grounded.

**How.** `RagSearch.load()` pre-encodes all passages with `all-MiniLM-L6-v2` into an in-memory NumPy matrix. `predict()` computes cosine via normalized dot product `q @ self._index.T`, takes top_n=12, reranks with `ms-marco-MiniLM-L-6-v2`, applies a sigmoid to map logits to 0..1, returns top_k=4. The MCP `_infer()` POSTs `/infer` then awaits the result WS — the browser path. The chat engine runs blocking `model.generate` in a daemon thread feeding a `TextIteratorStreamer`, pulled by the async caller via `run_in_executor(next, streamer)`.

**Why this (not that).** A vector DB (Pinecone/FAISS/pgvector/Qdrant) is overkill when the index fits in a NumPy matrix — but it's a drop-in swap behind the unchanged `BaseModel` contract. Bi-encoder-only loses head-of-list precision. A hosted LLM API breaks the keyless clone-and-run demo. A bespoke HTTP tool API wouldn't plug into the agent ecosystem the way MCP does. Buffering the whole answer makes the slow CPU model feel frozen.

**Impressive detail.** RAG isn't bespoke — it implements the exact `BaseModel` contract as YOLO/DistilBERT, so it inherits dynamic batching, the result cache, per-model metrics, and a Redis-stream lane for free. The two-stage retrieve/rerank runs inside a single batched worker forward pass, and MCP/chat reach it via the identical `/infer` + result-WS path used for image classification.

### Frontend — React/TS/Vite ops dashboard + real-time streams + Fleet map (`frontend/src`)

**What.** "Inferno Console": submit jobs and watch them flow Queued→Batched→Running→Done in real time, stream live throughput/latency/batch charts off a metrics WS, run a one-click stress test, switch among 20 runtime themes, hold an SSE chat (RAG-grounded), and explore a Leaflet "Fleet Command" map of simulated vehicles on real-road geometry. State is centralized in Zustand; all endpoints live in `config.ts`.

**How.** `config.ts` derives every endpoint from `API_BASE` (relative `/api/v1`); Vite's dev proxy forwards `/api` and `/metrics` with `ws:true` to dodge CORS. `useMetricsStream` self-heals with fixed-backoff reconnect and clears timers on unmount. `useJobSubmit` POSTs, optimistically animates phases, opens a per-job result WS, and tears everything down via an idempotent `finish()` guard. `useChat` reads the SSE body off a `fetch` `ReadableStream`. `applyTheme()` writes "r g b" CSS variables onto `<html>` so Tailwind re-themes for free. `fleet.ts`'s pure `stepVehicle()` walks baked OSRM road polylines.

**Why this (not that).** Next.js's SSR adds nothing to a pure SPA; CRA is deprecated and slower. Redux's boilerplate is overkill for ~10 state pieces and scopes high-frequency updates poorly; Zustand gives selector subscriptions in a few lines. Google Maps needs a key and billing; Leaflet+OSM is keyless. Polling can't cheaply deliver token streaming.

**Impressive detail.** The OSRM `[lng,lat]` vs app `[lat,lng]` coordinate hazard is funneled through exactly two helpers (`osrmUrl()` / `osrmToLatLngs()`) with a comment that getting it wrong *"drops the vehicles in the ocean off Africa,"* and the build-time prefetch script mirrors the same swap. The optimistic lifecycle's `setJobPhase` refuses to regress a done/error job back to an interim phase — a deliberate guard against out-of-order timer/WS races.

## Key design decisions

The ten questions most worth answering about why this system is built the way it is:

1. **Why Redis Streams instead of a plain LIST/BRPOP?** Streams + consumer groups give at-least-once delivery with explicit acks and a pending-entries list. If a worker crashes between reading and acking, the entries stay in the PEL and another worker reclaims them via `XPENDING`+`XCLAIM` — zero job loss. `BRPOP` deletes on pop, so a crash there is silent data loss with no accounting.

2. **Why one stream per model instead of one shared queue?** Every entry in a batch window is then guaranteed to be the same model — no cross-model filtering — and a saturated model can't head-of-line-block a healthy one, since each lane fails, scales, and applies backpressure independently.

3. **Why publish the result before acking the stream entry?** At-least-once correctness. If you ack first and crash before publishing, the entry is gone but the client never got a result — silent loss. Publishing first means a crash in the gap leaves the entry reclaimable; the worst case is a duplicate publish (idempotent: same `job_id`, TTL'd key), never lost work.

4. **Why dynamic batching with a size-OR-wait window?** Batching amortizes fixed per-call overhead (kernel launch, dispatch, transfer) and keeps the device saturated. The size-OR-wait window self-tunes: under light load the 20ms wait expires with tiny batches (low latency); under heavy load the size-32 cap fills first (max throughput) — no manual tuning, tail latency capped at ~20ms.

5. **Why separate worker processes instead of threads?** Python's GIL serializes CPU-bound work, and shared memory means one model's OOM/segfault/CUDA fault kills the whole pool. Separate processes give true parallelism, OS-level memory isolation, and independent restart/scale — the "shared-nothing but Redis" design.

6. **Why async FastAPI for the gateway?** The gateway never runs a model — it's almost entirely I/O-bound, holding thousands of idle WebSockets waiting on Redis. A single event loop handles huge connection counts cheaply, whereas a sync thread-per-request model would exhaust threads and has no first-class WebSocket story.

7. **Why backpressure with two water marks (hysteresis)?** A single threshold makes the lane oscillate accept/reject as each admitted job nudges the queue around that exact depth. Separate high/low marks give stable on/off behavior, and per-model state means a hot model can't reject a healthy one's traffic. Shedding with 429 + `Retry-After` beats unbounded buffering, which turns a spike into latency collapse then OOM.

8. **Why a single-connection ResultRouter and a TTL'd result key?** The router holds one `PSUBSCRIBE inferno:result:*` and dispatches to in-process futures, so Redis connections stay O(1) regardless of WebSocket count (the naive per-client approach hit pool exhaustion at ~120 clients). The TTL'd key closes the publish-before-subscribe race: `wait()` registers its future first, then GETs the cached value before awaiting the channel.

9. **Why a config-driven `BaseModel` registry instead of a serving framework like Triton/BentoML?** The whole point is demonstrating the distributed-systems internals — Redis Streams batching, backpressure, WS fan-out — that a black-box server would hide and replace with its own batching/queueing model. Adding a model stays purely additive: a class, a `@register_kind` decorator, a YAML entry, zero core changes.

10. **Why an in-memory NumPy index for RAG instead of a vector DB?** The corpus is a handful of small markdown docs, so the entire embedding index fits in a matrix and retrieval is one normalized dot product. A real vector DB adds an external dependency and ANN infra for no benefit at this scale — and because RAG is just another `BaseModel`, swapping in pgvector/Qdrant is a drop-in change behind the unchanged contract once corpus size demands ANN.

## Limitations & future work

- **Single-node Redis is a SPOF and a scaling ceiling.** The entire transport, result bus, metrics store, cache, and heartbeat registry sit on one Redis instance. There's no Redis Cluster/Sentinel, so Redis dying takes the platform down. Next step: Sentinel for failover, or sharding streams across a cluster.

- **In-memory embeddings, not a vector DB.** RAG retrieval is `q @ self._index.T` over a NumPy matrix loaded per worker — fine for a small markdown corpus, but it's a linear scan with no ANN, no persistence, and no incremental indexing. At real corpus scale this needs pgvector/Qdrant/FAISS (intentionally a drop-in swap behind `BaseModel`).

- **Not deployed live, and models download at runtime.** This is a clone-and-run portfolio project: the first request to a model pays the HuggingFace/weights download and load cost, there's no warm model cache baked into an image, and nothing is running behind a public URL with real traffic.

- **Kubernetes manifests are provided but not yet battle-tested.** `k8s/` ships a Deployment per model, a gateway CPU HPA, and **KEDA queue-depth autoscalers** that scale each worker on its `inferno:jobs:<model>` Redis-stream backlog — built on the worker's SIGTERM graceful-drain. Still open: GPU node scheduling is documented but unproven, the autoscaler thresholds aren't load-tuned, and there are no NetworkPolicies / pod-security hardening yet.

- **At-least-once means duplicate delivery is possible.** The publish-before-ack design guarantees no lost work, but a crash between publish and ack causes the job to be reprocessed and published twice. It's idempotent at the result-key level (same `job_id`, TTL'd value), but a downstream consumer that isn't idempotent would see the duplicate — there's no exactly-once dedup table.

- **Redis-5.x portability tax and approximate accounting.** Staying compatible with the portable Windows/Memurai Redis 5.x build means `XPENDING`+`XCLAIM` with client-side idle filtering instead of `XAUTOCLAIM`, an extra client-side pass over the pending set. Stream trimming is `maxlen ~approximate`, and the metrics sample stream is capped at 10k, so under extreme burst the rolling window can miss a few samples — acceptable for a dashboard, not for billing-grade accounting.
