# --------------------------------------------------------------------------- #
# Backend image (gateway + worker share one image; the command selects the role).
# CPU-only ML stack by default for portability. For GPU, base this on an
# nvidia/cuda:12.4 runtime image and install requirements-ml-gpu.txt instead.
# --------------------------------------------------------------------------- #
FROM python:3.10-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install deps first for better layer caching.
COPY requirements.txt requirements-ml-cpu.txt ./
RUN pip install --upgrade pip \
    && pip install -r requirements.txt \
    && pip install -r requirements-ml-cpu.txt

COPY backend ./backend

# Drop root. uid 10001 MUST match `runAsUser` in k8s/workers.yaml and
# k8s/gateway.yaml — those set `runAsNonRoot: true`, so a root image would be
# refused by the kubelet at startup rather than failing later.
#
# The model cache and the worker liveness file are the only paths written at
# runtime, so they are the only ones that need to be owned.
RUN useradd --create-home --uid 10001 inferno \
    && mkdir -p /app/artifacts /models \
    && chown -R inferno:inferno /app /models
USER inferno

# Gateway by default; workers override `command:` in compose.
EXPOSE 8000
CMD ["uvicorn", "backend.gateway.app:app", "--host", "0.0.0.0", "--port", "8000"]
