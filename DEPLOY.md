# Deploying Inferno (a clickable live demo)

> **Honest scope.** A recruiter-clickable demo runs the **frontend + gateway +
> Redis + a lightweight worker**. The heavy ML models (DistilBERT, ResNet, YOLO,
> Whisper, RAG, the chat LLM) need real RAM/CPU (and ideally a GPU) and won't run
> on free tiers — keep those **local** (`scripts\run-all.bat`) or scale a paid
> worker. The demo below shows the full architecture (batching, backpressure,
> WebSocket results, the live dashboard, 20 themes, the Fleet map) using the
> dependency-free **dummy** model, so it costs ~nothing to host.

You need your own hosting account; pick **one** path.

## Option A — Render (one blueprint, easiest)
1. Push this repo to GitHub.
2. Render → **New + → Blueprint** → select the repo. It reads
   [`deploy/render.yaml`](deploy/render.yaml) and provisions Redis + gateway +
   dummy worker + the static frontend.
3. After the gateway is live, set the frontend's `VITE_API_BASE` to the gateway
   URL (e.g. `https://inferno-gateway.onrender.com/api/v1`) and redeploy the
   static site.
4. Open the frontend URL. Submit a `dummy-echo` job, run the stress test, switch
   themes, open the Fleet map.

## Option B — Fly.io (gateway+worker) + Vercel (frontend)
```bash
# 1) Managed Redis
fly redis create                       # copy the redis:// URL

# 2) Gateway + dummy worker (uses deploy/fly.toml + deploy/Dockerfile.core)
fly launch --no-deploy                 # pick an app name
fly secrets set INFERNO_REDIS__URL="redis://default:...@...upstash.io:6379"
fly secrets set INFERNO_SERVER__CORS_ORIGINS='["https://YOUR-FRONTEND.vercel.app"]'
fly deploy
fly scale count gateway=1 worker=1

# 3) Frontend on Vercel (static)
#    Project settings -> Framework: Vite, Build: `npm run build`, Output: dist
#    Env var: VITE_API_BASE = https://YOUR-APP.fly.dev/api/v1
```

## Option C — Any Docker host (full stack, paid)
The repo's [`docker-compose.yml`](docker-compose.yml) brings up Redis + gateway +
the real model workers + frontend. Run it on a box with enough resources
(8GB+ RAM; a GPU for fast inference):
```bash
docker compose up --build
```

## Frontend-only (static) anywhere
The UI is a static build — host `frontend/dist` on Vercel / Netlify / GitHub
Pages / Cloudflare Pages. Point it at any reachable gateway with
`VITE_API_BASE` (HTTPS) and `VITE_WS_BASE` (WSS).

## Notes
- **CORS**: set `INFERNO_SERVER__CORS_ORIGINS` to your exact frontend origin in prod.
- **Auth/quotas**: enable `INFERNO_AUTH__ENABLED` + `INFERNO_RATELIMIT__ENABLED`
  before exposing `/infer` publicly.
- **Chat LLM**: the streaming chat service ([`backend/chat/`](backend/chat/)) is a
  separate deploy; it needs a box that can hold the model — host it apart and set
  the UI's `VITE_CHAT_URL`.
- CI already builds and (on `main`) pushes the gateway + frontend images to GHCR
  ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) — you can deploy those
  images directly.
