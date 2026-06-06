# Kubernetes deployment

Manifests to run Inferno on any Kubernetes cluster, with **queue-depth
autoscaling** of the model workers via KEDA. This mirrors the docker-compose
topology (Redis + gateway + 6 model workers + chat + frontend) but adds real
orchestration: health-gated rollouts, a CPU HPA for the gateway, and per-model
KEDA scalers that react to the actual Redis-stream backlog.

```
                 Ingress (inferno.local)
                          │
                     frontend (nginx)  ──/api,/metrics──▶ gateway (HPA on CPU)
                          │                                   │
                          └──────/chat──────▶ chat            ▼  XADD inferno:jobs:<model>
                                                Redis (StatefulSet + PVC)
                                                    ▲
                       worker-<model> Deployments ──┘  (KEDA scales each on stream lag)
```

| File | What |
| --- | --- |
| `namespace.yaml` | the `inferno` namespace |
| `config.yaml` | ConfigMap (`INFERNO_*` settings) + Secret (API keys placeholder) |
| `redis.yaml` | Redis StatefulSet + PVC + headless Service |
| `gateway.yaml` | gateway Deployment + Service + **CPU HPA** (2→6) |
| `workers.yaml` | one Deployment per model (dummy, distilbert, resnet, yolo, whisper, rag) |
| `chat.yaml` | streaming-chat Deployment + Service |
| `frontend.yaml` | nginx console Deployment + Service |
| `ingress.yaml` | single host → frontend (which proxies to gateway/chat) |
| `autoscaling-keda.yaml` | **KEDA ScaledObjects** — scale each worker on `inferno:jobs:<model>` depth |
| `kustomization.yaml` | applies the core stack in one shot |

## 1. Build & publish the images
CI builds these but doesn't push them, so push once (or `kind load` for local):
```bash
# from the repo root
docker build -t ghcr.io/sagarchry0777/inferno:latest -f Dockerfile .          # full ML backend
docker build -t ghcr.io/sagarchry0777/inferno-frontend:latest ./frontend
docker push ghcr.io/sagarchry0777/inferno:latest
docker push ghcr.io/sagarchry0777/inferno-frontend:latest
# …or for a local kind cluster, skip the registry:
#   kind load docker-image ghcr.io/sagarchry0777/inferno:latest ghcr.io/sagarchry0777/inferno-frontend:latest
```
> The full backend image is large (torch + OpenCV + Whisper + YOLO). For a lean
> demo, point the gateway/dummy worker at `deploy/Dockerfile.core` instead.

## 2. Deploy the core stack
```bash
kubectl apply -k k8s/
kubectl -n inferno rollout status deploy/gateway
kubectl -n inferno get pods
```

## 3. Add queue-depth autoscaling (KEDA)
```bash
helm repo add kedacore https://kedacore.github.io/charts && helm repo update
helm install keda kedacore/keda -n keda --create-namespace
kubectl apply -f k8s/autoscaling-keda.yaml
kubectl -n inferno get scaledobject
```
Now fire load at a model and watch its workers scale on backlog:
```bash
kubectl -n inferno get deploy worker-yolo -w
```

## 4. Reach the app
```bash
# Ingress (with an ingress controller + DNS/hosts entry for inferno.local):
open http://inferno.local
# …or just port-forward the frontend:
kubectl -n inferno port-forward svc/frontend 8080:80   # then http://localhost:8080
```

## Local cluster in one go (kind)
```bash
kind create cluster --name inferno
docker build -t ghcr.io/sagarchry0777/inferno:latest -f Dockerfile .
docker build -t ghcr.io/sagarchry0777/inferno-frontend:latest ./frontend
kind load docker-image ghcr.io/sagarchry0777/inferno:latest ghcr.io/sagarchry0777/inferno-frontend:latest --name inferno
kubectl apply -k k8s/
kubectl -n inferno port-forward svc/frontend 8080:80
```

## Notes
- **GPU nodes:** set `INFERNO_INFERENCE__DEVICE: "auto"` in `config.yaml`, add
  `nvidia.com/gpu` resource requests to the ML workers, and schedule them onto a
  GPU node pool with nodeSelectors/tolerations.
- **Redis is a single replica (SPOF).** For production use Redis Sentinel or a
  managed Redis, and point `INFERNO_REDIS__URL` at it.
- **Model cache:** workers use a per-pod `emptyDir` so weights download once per
  pod. For shared, persistent caching mount a `ReadWriteMany` PVC at `/models`.
- **Scale-to-zero:** set a ScaledObject's `minReplicaCount: 0` for rarely-used
  models — KEDA spins a worker up on the first queued job.
