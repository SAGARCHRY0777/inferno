# 🔍 Code review — Inferno

**Reviewed:** 26 August 2026 · commit `dcfa9e2` (`main`)
**Scope:** whole repository — backend (5.4k LOC Python), frontend (React + TS),
Docker, Kubernetes, CI, dependencies, documentation.

> **How to read this.** Everything under **Fixed** is already applied in the working
> tree and verified (tests + ruff + eslint + tsc + build, all green). Everything
> under **Open** is a real finding I deliberately did *not* change, with the reason.
> Each entry names the concrete failure it prevents, not just the rule it breaks.

---

## Verdict

This is a genuinely strong project — the batching core, the publish-before-ack
ordering, the graceful drain and the config spine are all correct, and the CI is
honest (no `|| true`, no `continue-on-error`, real Redis service container). The
defects worth fixing clustered in three places:

1. **Failure modes were inverted.** `/health` returned 200 with Redis down (no
   probe could ever fail) while one malformed heartbeat key could 500 it into a
   restart loop.
2. **Things advertised as working, silently weren't.** The KEDA autoscalers read
   a metric this system keeps permanently near zero; the live demo's chat URL was
   baked as `http://127.0.0.1:8100` into an HTTPS bundle.
3. **Recovery paths could amplify damage.** Stale-entry reclaim stole batches from
   *healthy* workers, and a payload that killed the worker process could
   crash-loop the whole fleet with no delivery cap.

**Confirmed correct** (checked specifically, no defect found): batch index
alignment between inputs and predictions — the classic severe bug in a batching
system — is sound end to end; publish-before-ack really does mean no lost work;
the batch window has no off-by-one; the gateway has no blocking calls on the
event loop; the zustand store caps every growing array; `lib/fleet.ts` routing is
exemplary (AbortController + timeout + cleanup).

---

## Fixed

### Correctness · backend

| # | File | Defect | Failure it prevents |
|---|---|---|---|
| 1 | `broker/redis_broker.py` | Undecodable entries were logged and dropped but **never acked**, despite the comment saying otherwise | A schema change poisons the lane permanently: entries stay in the PEL, `XLEN` never falls, reclaim re-claims them forever, and once they pass `high_watermark` the gateway 429s that model **with no self-healing path**. Now dead-lettered to `inferno:jobs:<model>:dead`, then acked + deleted |
| 2 | `broker/redis_broker.py` | Reclaim ignored `times_delivered`; no delivery cap, no DLQ | A payload that segfaults onnxruntime (or trips the OOM killer) kills worker A, is reclaimed by B, kills B, then C — crash-looping the fleet forever. Now capped by `timeouts.max_deliveries` (3) and dead-lettered |
| 3 | `core/config.py` | `reclaim_min_idle_ms` (30s) was shorter than a realistic batch | "Idle" for a stream entry means *time since delivery*, not *time since the owner died*. A whisper batch of a few 30s clips runs past 30s, so a **healthy** worker's in-flight batch was claimed and executed twice: double inference cost, duplicate history rows, double-counted metrics. Raised to 90s with the reasoning documented on the field |
| 4 | `worker/watchdog.py` *(new)* | No timeout around inference | A wedged forward pass (CUDA deadlock, stalled weight read) hung the worker forever — no publish, no ack, no heartbeat — and reclaim then spread the stall to the next worker. A daemon watchdog now ends the process past `inference_timeout_s` so the supervisor restarts it; entries stay pending and are reclaimed. **4 new tests** |
| 5 | `gateway/routes.py` | `/health` returned **200** when Redis was unreachable | `httpGet` probes only read the status code, so a gateway that could not serve a single inference stayed `Ready` and kept taking traffic indefinitely. Now returns **503** |
| 6 | `gateway/routes.py` | `list_heartbeats()` was outside the health try/except | One truncated heartbeat value → pydantic `ValidationError` → HTTP 500 on the liveness path → **gateway restart loop**. Now guarded |
| 7 | `gateway/app.py` | Shutdown chain had no error handling | Redis is often torn down *before* the gateway (compose down, node drain), making `punsubscribe` raise — which skipped `hub.stop()`, `broker.aclose()` and both pool closes, leaking sockets on every restart. Each step is now isolated |
| 8 | `core/redis_client.py` | `aclose()` never closed the async pool | redis-py sets `auto_close_connection_pool=False` when a pool is passed in, so the call was a **no-op** and `cache_clear()` dropped the last reference to up to 64 open sockets. Now `aclose(close_connection_pool=True)` |
| 9 | `gateway/ws.py` | `_broadcast` iterated the live client set across an `await` | Any dashboard opening or closing mid-broadcast raised `RuntimeError: Set changed size during iteration`, aborting the tick so later clients silently missed frames. Now iterates a snapshot |
| 10 | `gateway/result_router.py` | One waiter per job id; a second subscriber **evicted** the first | The result link open in two tabs, or a reconnect racing teardown, left one client blocked for the full timeout on a job that had already succeeded — and whichever finished first deleted the other's registration. Now a set of futures per job, fanned out |
| 11 | `gateway/result_router.py` | `CancelledError` escaped `wait()` on shutdown | Clients got a bare socket close with no `result` or `timeout` frame. Now returns cleanly during shutdown |
| 12 | `core/schemas.py` | `_no_predictions_on_error` was a validator whose body was `return v` | It validated nothing despite its name — a result claiming both `status=error` and predictions round-tripped, and the UI rendered stale predictions beside an error badge. Now actually enforced |
| 13 | `core/config.py` | `result_ttl_s >= job_timeout_s` was documented but unenforced | Raising `job_timeout_s` alone expired the result key **before** the client's deadline, losing a successfully computed result on late-join. Now validated; default raised 60 → 300 |
| 14 | `worker/main.py` | `STOPPED` and `RUNNING→IDLE` heartbeats were swallowed by the rate limiter | A dead worker read `running` for up to 6s after exit — inflated across every pod in a rolling deploy. Both now forced |

### Security · backend

| # | File | Defect | Failure it prevents |
|---|---|---|---|
| 15 | `gateway/routes.py` | **`GET /history` had no authentication** | `identify_client` was called in exactly one place (`/infer`). With auth *enabled*, an unauthenticated request still returned the last 500 inferences across **all** clients, each with up to 240 chars of raw user input. Now authenticated; the frontend sends the key (`App.tsx`, `HistoryModal.tsx`) |
| 16 | `core/schemas.py` | `payload` had **no maximum length** and no body-size middleware | One 500 MB `POST /infer` buffers in memory, then `b64decode` allocates a second copy — OOM-killing a 512Mi gateway pod. Now capped at `MAX_PAYLOAD_CHARS` (12 MB ≈ a 9 MB image/clip), rejected with 422 before decoding |
| 17 | `gateway/security.py` | Rate limiter keyed on `request.client.host` | Every deployment here puts nginx or a platform LB in front, so that is the **proxy's** IP for every request: enabling quotas collapsed the entire user base into one 120/min bucket. Now honours `X-Forwarded-For` behind the new `trust_proxy_headers` flag (off by default — the header is spoofable when unproxied), and `nginx.conf` actually sets it |
| 18 | `gateway/security.py` | Client id was `key[:8]` | Two keys sharing an 8-char prefix (`sk_live_…`) shared one quota bucket. Now a SHA-256 digest |
| 19 | `k8s/config.yaml` | **Plaintext API key committed to git** and applied by `kubectl apply -k` | Shipped a known credential. Worse, `INFERNO_AUTH__ENABLED` did not exist in the ConfigMap the comment told you to flip — so `/infer` was unauthenticated on any default deploy. Secret is now created out-of-band; the flip key exists |
| 20 | `docker-compose.yml` | Redis published as `6379:6379` (binds `0.0.0.0`) | `DEPLOY.md` tells you to run this on "any Docker host" — on a cloud VM that exposes an **unauthenticated Redis to the internet**. Now bound to `127.0.0.1` |
| 21 | `deploy/Dockerfile.core` | Ran as root, no healthcheck | Now a non-root uid 10001 plus a real `HEALTHCHECK` |

### Correctness · frontend

| # | File | Defect | Failure it prevents |
|---|---|---|---|
| 22 | `hooks/useMetricsStream.ts` | Cleanup closed only the **first** socket; `closed`/`timer` were refs shared across effect runs | Every reconnect leaked a live socket still writing to the store, and under `<StrictMode>` the mount/cleanup/mount cycle opened a **second** metrics socket — double-rate samples, p50/p99 flipping between two snapshots each tick. Rewritten with effect-local state + a tracked current socket |
| 23 | `components/SubmitPanel.tsx` | `setBusy(false)` was not in a `finally` | Three unguarded throw/hang paths in `submit()` left the Submit button **permanently disabled** on "Submitting…" until reload |
| 24 | `components/AudioInput.tsx` | Microphone stream never released on unmount | Switching models mid-recording left `MediaRecorder` running, the browser's recording indicator lit, and Blob chunks accumulating for the life of the page |
| 25 | `hooks/useJobSubmit.ts` | `JSON.parse` in `onmessage` unguarded; no fetch timeout; WS constructor unguarded | A malformed frame skipped `finish()`, leaking socket + timers and then mislabelling a job "timed out" although a response arrived. Added a 15s submit `AbortController`, guarded `.json()`, guarded constructor, `try/finally` around the handler |
| 26 | `hooks/useChat.ts` | A mid-stream failure **replaced** the answer with "service unreachable" | 300 streamed tokens were wiped and the cause was misreported — the service *was* reachable. Now appends "Connection lost mid-response", skips a single malformed SSE line instead of aborting, and cancels the reader |
| 27 | `hooks/useStressTest.ts` | ⌘K and the dashboard each held their **own** instance | Running from the palette showed no progress anywhere, left the panel's buttons enabled so a second run could start concurrently, and neither `stop` could cancel the other. Now one shared singleton via `useSyncExternalStore`; bodies are drained so 500 responses don't hold connections |
| 28 | `components/FleetMap.tsx` | No sequence guard on route responses | Picking a new pair while an 8s OSRM request was in flight let the **stale** route land last and overwrite the map |
| 29 | `components/WorldFleet.tsx` | A fresh `L.DivIcon` per marker per tick | react-leaflet compares icons by identity and replaces marker DOM on change: ~2000 icon rebuilds/second at 240 markers — visible jank on pan/zoom. Now cached by domain + 5° heading |
| 30 | `components/FleetGames.tsx` | Three uncancelled `setTimeout`s | Closing Fleet Command mid-delivery still fired callbacks on an unmounted component and kicked off a pointless OSRM request |
| 31 | `components/HistoryModal.tsx` | `revokeObjectURL` raced `a.click()`; fetch had no `AbortController` | Empty CSV download in Firefox; two in-flight 500-record fetches with no ordering guarantee |
| 32 | `components/SubmitPanel.tsx` | Blob-URL cleanup effect captured render-1 values | Every guard was permanently `false` — the effect labelled "leak prevention" **revoked nothing** |

### Infrastructure, CI & docs

| # | File | Defect | Failure it prevents |
|---|---|---|---|
| 33 | `k8s/autoscaling-keda.yaml` | Triggered on `pendingEntriesCount` | That is the **PEL** — entries already delivered but unacked. `ack()` XACKs+XDELs immediately, so it only ever holds the in-flight batch (≤32/replica). A 5,000-job backlog contributed **zero**: the autoscalers looked right and never fired. Switched to `streamLength` (which `XLEN` is deliberately kept accurate for) and added the two missing workers |
| 34 | `deploy/Dockerfile.demo` | `VITE_CHAT_URL` never set in the web stage | `config.ts` uses `?? "http://127.0.0.1:8100"`, and `??` only falls back on *undefined* — so the **live Render demo** shipped a localhost chat URL in an HTTPS bundle, blocked as mixed content. Now `ARG VITE_CHAT_URL=""` |
| 35 | `k8s/workers.yaml` | **No liveness or readiness probes on any worker** | A worker wedged on model load was never restarted, and `kubectl rollout status` reported success the instant the container started. Workers serve no HTTP, so added a heartbeat-file signal (`WorkerSettings.liveness_file`) + exec probes on all 7 |
| 36 | `k8s/pdb.yaml` *(new)* | No PodDisruptionBudget anywhere | `gateway` and `frontend` both run `replicas: 2`; one node drain could evict both, dropping every live WebSocket — the exact failure the SIGTERM drain exists to avoid |
| 37 | `k8s/ingress.yaml` | No `ingressClassName` | Unless the cluster has a default IngressClass, no controller claims it: `apply -k` reports success and **nothing routes** |
| 38 | `Makefile` | `-` prefixes on `lint` and `typecheck` | Make ignores the exit status, so both exited 0 on a wall of violations — or when ruff/mypy weren't installed at all. A false pass locally |
| 39 | `.github/workflows/ci.yml` | Unpinned `ruff`; demo image never built | A new ruff release turns CI red on an unrelated PR. And the image the **live demo** deploys was never built in CI, so a break surfaced only at deploy. Both fixed |
| 40 | `.gitignore`, `tools/` | **32 debug logs committed** (`*.err`/`*.out`) | Stack traces leaking another machine's absolute paths (`C:\Users\DSI-LPT-015\...`). Removed and ignored; `bus.jpg`/`mlk.flac` kept — they are real test fixtures |
| 41 | `frontend/tsconfig.node.json` | `tsc -b` emitted `vite.config.js` **next to** `vite.config.ts`, and it was committed | Vite resolves `.js` **before** `.ts`, so the generated file silently shadowed the real config — every edit to `vite.config.ts` was ignored until someone re-ran `tsc -b`. Emit redirected to `node_modules/.tmp`; both artifacts untracked (verified: a rebuild no longer recreates them) |
| 42 | `models.yaml` consumers | `semantic-search` was declared but **no deployment ran a worker for it** | `GET /models` advertised it and the UI offered it, so those jobs were enqueued, consumed by nobody, and failed after 30s. Worker added to compose, k8s and `run-all.bat` |
| 43 | `DEPLOY.md`, `README.md` | Claimed CI "pushes images to GHCR" | There is no push step, no registry login, and `permissions: contents: read`. Anyone following it would deploy a tag that was never published. Also refreshed "What I'd do next", which listed four already-shipped features |
| 44 | `.env.example` | Missing `SERVE_FRONTEND_DIR`, `CHAT__ENABLED`, the timeout knobs | README claims config is "documented field-by-field" here. `SERVE_FRONTEND_DIR` matters most — it is the mechanism the whole single-container demo rests on |

---

## Open — deliberately not changed

| Finding | Why I left it |
|---|---|
| **`torch==2.5.1` is affected by CVE-2025-32434** (RCE via `torch.load`; fixed in 2.6.0). Reachable because `yolo-detect` loads a pickle-format `.pt` downloaded at runtime | Bumping torch changes the pinned, verified ML environment — that needs a real test pass on your GPU box, not a blind edit. **Recommended next action.** More useful than the single pin: there is no `dependabot.yml`, no `pip-audit`, no `npm audit`, so nothing in the repo can tell you about the *next* one |
| **No `USER` in the root `Dockerfile` / `Dockerfile.demo`; no `securityContext` in k8s** | I hardened `Dockerfile.core`. I left the demo image alone on purpose: it runs Redis in-container and **auto-deploys to your live demo** on push — not worth risking that for a portfolio demo. `docs/ARCHITECTURE.md:134` already discloses this |
| **`deploy/demo-entrypoint.sh` never supervises the backgrounded worker** | If the worker dies the gateway still answers health 200 and jobs hang silently. The fix (`wait -n` or a supervisor loop) changes the live demo's startup path — worth doing, but deliberately, not bundled into a large review commit |
| **`deploy/fly.toml`**: `[http_service]` has no `processes = ["gateway"]`, so Fly expects the socket-less worker machines to serve HTTP; `cors_origins = ["*"]` with `allow_credentials=True` | You deploy on Render, not Fly, so this is untested-path config. Both are one-line fixes when you next use Fly |
| **`locust` is in `requirements.txt` but in neither the lock nor `environment.yml`**; `README.md:171` documents `pip install -r requirements.lock.txt` without the `--extra-index-url` the `+cu124` pins require | Both are packaging decisions with a right answer only you can pick (drop locust from core deps vs add it to the lock). Note both Dockerfiles already `grep -ivE '^(pytest\|locust)'` it back out |
| **`mypy` is configured and exposed via `make typecheck` but installed by nothing** | Now that I removed the `-` prefix, `make typecheck` fails loudly instead of lying. Install with `pip install -e ".[dev]"`. I did **not** add mypy to CI — on a codebase that has never been type-checked that would likely turn CI red on unrelated work; run it locally first and fix incrementally |
| **~37 MB of media in git** (`inferno-demo.webm` 17 MB + 10 PNGs) | Legitimate portfolio assets. Git LFS or release assets would be conventional, but rewriting history on a live repo is not something to do inside a review |
| **Trace context**: every job in a batch inherits `items[0]`'s parent, so 31 of 32 client traces end at the gateway | Real, but cosmetic — the fix is OTel span links, a focused change better made while looking at a live trace |
| **Dead consumers accumulate** in the Redis consumer group (`XGROUP DELCONSUMER` is never called) | Genuinely unbounded but very slow growth (one entry per pod restart) and harmless until thousands. Recovery is unaffected — reclaim scans the whole PEL regardless of owner |
| **`redis_keys.workers_index()` has no callers** | Dead code, zero risk. Left for you to decide: delete, or wire it up |

---

## Round 2 — Fleet, models & the arcade

Follow-up work after the review, driven by three questions: *where does a user
run their own model?*, *why is A→B broken?*, and *can the fleet be a real game?*

### 🗺️ A→B routing was drawing fiction

The planner trusted OSRM's `code: "Ok"`. OSRM snaps every waypoint to the nearest
road **with no distance limit**, so a point with no road near it still yields a
confident route between two unrelated places. Measured against the live server:

| Input | What OSRM returned | Before | After |
|---|---|---|---|
| Bangalore → Mysore | snap 0 km, real 143 km route | accepted | accepted ✓ |
| Two mid-Atlantic points | both snapped to the **same street in Brazil** (500 km / 1,277 km away) → **0 m route** | accepted | rejected ✓ |
| London → New York | New York snapped **5,534 km** onto another continent → fake "2,149 km" road across the ocean | accepted | rejected ✓ |

`fleet.ts` now rejects any route whose waypoints were snapped more than 25 km, or
whose geometry collapsed to a single point, and the UI says *"no road route
between these points"* instead of the vague "routing unavailable".

### 🧱 The basemap was defaced

`basemaps.cartocdn.com/dark_all` returns **HTTP 200 with "API KEY REQUIRED"
stamped diagonally across every tile** — CARTO now requires a key, and because
the request still succeeds the map rendered defaced rather than failing. Switched
to OpenStreetMap's keyless tiles, darkened via the `.map-tiles-dark` CSS filter
(heavy desaturation, so the fleet markers stay the most saturated thing on
screen). This was visible on the **live demo**.

### 🚚 Vehicle categories — 86 → 160 vehicles

`CarType` grew to 40+ body types grouped into 10 **categories**, with filter chips
in the picker and the type dropdown narrowing to the chosen category (so an empty
combination like "Trucks + jet" is impossible).

| | | | |
|---|---|---|---|
| 🚗 Cars 59 | 🚛 Trucks & Freight 25 *(was 2)* | ✈️ Aircraft 19 | 🚢 Ships 14 |
| 🚆 Trains 12 *(new `rail` domain)* | 🏍️ Motorcycles 7 *(new)* | 🛥️ Boats 6 | 🤿 Underwater 6 |
| 🚌 Buses 6 *(new)* | 🚑 Emergency 6 *(new)* | | |

Each new type has its own speed, range and cargo description in `world.ts`.

### 🎮 The arcade now uses the catalogue

Previously all three modes drove one generic green arrow at a fixed speed — the
whole catalogue was cosmetic. Added a **garage** (`lib/vehicleStats.ts`) where the
choice is a real trade-off: **the faster you move, the less each delivery pays.**

| Class | Speed | Payout | Plays like |
|---|---|---|---|
| 🏍️ Motorcycles | ×1.45 | ×0.65 | many small fares |
| 🚑 Emergency | ×1.30 | ×0.95 | fast, near-normal pay |
| 🚗 Cars | ×1.00 | ×1.00 | balanced |
| 🚌 Buses | ×0.80 | ×1.70 | slow, high volume |
| 🚛 Trucks | ×0.62 | ×2.40 | sluggish, big payouts |

Per-type nudges keep vehicles distinct inside a class (a Supra is 1.22×, a Hilux
0.65×). The pick persists in `localStorage`, rides on the map marker, and shows in
the HUD. **Only road vehicles are playable** — every mode routes on OSRM's driving
profile, so offering a container ship would reproduce the exact straight-line
fiction fixed above.

### 🪦 The fleet map was frozen — and empty

Two compounding bugs made Fleet Command look dead on arrival:

1. **`WorldFleet.cull()` only stepped vehicles already inside the viewport.** The
   entire world off-screen was frozen, so no vehicle could ever drive *into*
   view — you saw only whatever happened to spawn on screen at load. Now every
   vehicle steps (a few arithmetic ops each) and culling applies to **rendering**
   only, which is the expensive part and still capped at `CAP = 240`.
2. **The map opens on San Francisco at zoom 13**, while the fleet travels between
   ~96 *global* airports/ports/cities. Those routes essentially never cross a
   city-sized viewport, so the honest count was `0 in view / 1400 total`.
   `spawnLocal()` now seeds short local trips around wherever you are looking,
   bounded at 400 so panning cannot grow the fleet without limit.

Verified in a browser: **11 in view (was 0), and all 11 moved** over 4 seconds.

### 🔗 YOLO → Fleet: the dead constant, finished

`VEHICLE_CLASSES` sat in `fleet.ts` with **zero usages** — the fossil of an
unfinished idea. It is now the join that connects the inference platform to
Fleet Command, which was otherwise a beautiful toy bolted onto an ML product:

```
submit street.jpg → yolo-detect → 3 car · 1 bus · 2 truck
        → "Send 6 detected to Fleet map"
        → real Toyotas / Volvos / Citaros driving your city
```

YOLO's COCO labels map onto the vehicle categories added above
(`car`→car, `truck`→truck, `bus`→bus, `motorcycle`/`bicycle`→bike), and
`randomCarOfCategory()` picks an actual catalogue vehicle for each detection.
Non-vehicle classes (person, traffic light…) are skipped.

Verified end to end in a browser: 9 labels including one `person` → the fleet
grew by **exactly 8**, with the person skipped and no page errors.

### ⚡ `priority` stopped being a lie

The API accepted `priority: 0-9`, carried it all the way into Redis, and then
**ignored it** — the queue was pure FIFO, so every client setting a priority got
nothing. The README admitted this in a footnote; the API did not.

Redis Streams are append-only FIFO, so entries cannot be reordered once written.
Priority is therefore **routing, not sorting**: jobs at or above
`queue.express_priority_min` (default 5) go to `inferno:jobs:<model>:express`,
and workers read both lanes in one `XREADGROUP` with express listed first —
which is what actually delivers the ordering, in a single round trip and without
starving the normal lane.

Design notes worth keeping:

* **The normal lane's key is unchanged**, so queue depth, the backpressure water
  marks and the KEDA autoscalers all keep working untouched.
* **`queue_depth` sums both lanes** — a flood of express jobs is still a
  saturated lane, and load shedding has to see it.
* **Entry ids carry their lane.** `ConsumedEntry`'s id is documented as a
  *broker-native* handle, so express ids get a marker prefix. A batch can mix
  lanes, and acking an express id against the normal stream is a silent no-op
  that would leave the entry pending forever. This kept `WorkerBroker`, the
  batcher, the worker loop and the test fakes completely unchanged.
* **Reclaim sweeps both lanes, express first** — otherwise a high-priority job
  abandoned by a dead worker would be the one thing never recovered.

Exposed in the UI as a **Normal / ⚡ Express** toggle, so it is demonstrable:
queue a burst with the stress test, submit one express job, watch it jump ahead.
Covered by 12 new tests, including a guard that fails if the express-first lane
ordering is ever flipped — without it, priority would silently stop working while
every routing test still passed.

### 🚀 Auto-deploy that actually fires

Render's "Auto-Deploy: On Commit" was enabled but **never fired** — the Events
tab showed only a June deploy and a manual one, with commit `621f799` sitting
undeployed for hours. `.github/workflows/deploy.yml` now calls Render's Deploy
Hook after CI passes on `main`, so deploys are triggered by something visible,
loggable and re-runnable. Needs a `RENDER_DEPLOY_HOOK` secret; without it the
workflow skips cleanly rather than failing red.

### 🧩 Bring your own model

There was no upload path *and no documentation at all*. Now in
[`docs/BRING-YOUR-OWN-MODEL.md`](docs/BRING-YOUR-OWN-MODEL.md): Hugging Face,
YOLO and Whisper weights already worked from a local path (undocumented), but
**`onnx-image` was hardcoded to ResNet-18** — a user's own ONNX model was
impossible without editing code. It now accepts `weights` + `labels` params and
**fails loudly** if they're missing, rather than silently serving ResNet-18
predictions from what you believe is your model.

---

## Verification

Everything below was run against the modified tree:

```
pytest backend/tests -m "not ml"    30 passed, 2 skipped (Redis not reachable locally)
ruff check backend                  All checks passed!
npm run lint                        clean (--max-warnings 0)
npm run build                       tsc -b && vite build — clean
python -c "yaml.safe_load_all(...)" all k8s manifests + compose + ci.yml parse
```

Test count went 26 → 30: `backend/tests/test_watchdog.py` covers the new watchdog
(fires on overrun, silent when idle, silent on fast batches, resets between
batches — so cumulative time can't kill a healthy worker).

The 2 skips are environmental: `conftest.py` skips the integration tests when no
Redis is reachable, and there is no local Redis here. **CI runs them against a
real Redis service container**, so they will execute on push.

> Worth knowing: those tests skip *silently* and CI still reports green. If the
> Redis service container ever fails to start, the two most valuable tests —
> round-trip and graceful-drain/zero-job-loss — vanish with no signal. A
> `--strict-markers`-style guard or a minimum-test-count assertion would close that.

### Environment note

The pinned dependencies do not install on **Python 3.14** (`pydantic-core` has no
wheel and its Rust build fails). This is expected — `requirements.txt` documents
Python 3.10 — but worth knowing before someone tries a modern interpreter. I
verified on **3.11**, where everything installs and passes.
