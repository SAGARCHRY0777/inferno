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

# Gateway by default; workers override `command:` in compose.
EXPOSE 8000
CMD ["uvicorn", "backend.gateway.app:app", "--host", "0.0.0.0", "--port", "8000"]
