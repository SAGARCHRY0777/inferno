# Inferno — convenience targets. On Windows, prefer the scripts\*.bat equivalents.
# Usage: make <target>
PY ?= python
CONDA_ENV ?= test
GATEWAY_PORT ?= 8000

.PHONY: help install install-gpu install-cpu redis gateway worker worker-text worker-image \
        frontend test lint typecheck loadtest fmt clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: install-cpu ## Default install (CPU stack)

install-gpu: ## Install core + CUDA 12.4 ML stack
	$(PY) -m pip install -r requirements.txt
	$(PY) -m pip install -r requirements-ml-gpu.txt

install-cpu: ## Install core + CPU-only ML stack
	$(PY) -m pip install -r requirements.txt
	$(PY) -m pip install -r requirements-ml-cpu.txt

redis: ## Run Redis via docker compose
	docker compose up redis

gateway: ## Run the FastAPI gateway
	$(PY) -m uvicorn backend.gateway.app:app --host 0.0.0.0 --port $(GATEWAY_PORT)

worker: ## Run a dummy worker (override: make worker MODEL=resnet-image)
	INFERNO_WORKER__MODEL_NAME=$(or $(MODEL),dummy-echo) $(PY) -m backend.worker.main

worker-text: ## Run a DistilBERT sentiment worker
	INFERNO_WORKER__MODEL_NAME=distilbert-sentiment $(PY) -m backend.worker.main

worker-image: ## Run a ResNet image worker
	INFERNO_WORKER__MODEL_NAME=resnet-image $(PY) -m backend.worker.main

frontend: ## Run the Vite dev server
	cd frontend && npm install && npm run dev

test: ## Run the pytest suite
	$(PY) -m pytest backend/tests

lint: ## Ruff lint (backend) + eslint (frontend)
	-$(PY) -m ruff check backend
	-cd frontend && npm run lint

typecheck: ## mypy (backend) + tsc (frontend)
	-$(PY) -m mypy backend
	-cd frontend && npm run typecheck

loadtest: ## Ramp load with Locust (web UI on :8089)
	locust -f loadtest/locustfile.py --host http://127.0.0.1:$(GATEWAY_PORT)

clean: ## Remove caches and build artifacts
	rm -rf .pytest_cache **/__pycache__ frontend/dist
