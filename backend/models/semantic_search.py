"""Semantic search (RAG-style): embed a query, retrieve nearest documents.

Demonstrates the modern embeddings + vector-search pattern in a self-contained
way: a sentence-transformer embeds a seeded corpus at load time (the "vector
DB", in-memory here), and each query is embedded and matched by cosine
similarity. Results map cleanly onto the prediction contract -- each hit is a
``Prediction`` whose ``label`` is the document and ``score`` is the similarity.

In production the in-memory matrix becomes a real vector DB (pgvector / Qdrant /
LanceDB); the model interface is identical.
"""

from __future__ import annotations

import numpy as np

from backend.core.errors import InferenceError, ModelLoadError
from backend.core.logging import get_logger
from backend.core.schemas import Prediction
from backend.models.base import BaseModel
from backend.models.registry import register_kind

_log = get_logger("model.search")

# A small, varied corpus so queries return sensible matches in the demo.
DEFAULT_CORPUS = [
    "Dynamic request batching groups pending inferences into one forward pass to maximize GPU throughput.",
    "Backpressure sheds load with HTTP 429 and Retry-After when the queue saturates.",
    "Redis Streams with consumer groups give at-least-once delivery and explicit acknowledgements.",
    "WebSockets stream inference results back to the client in real time, correlated by job id.",
    "Quantization to INT8 or FP8 shrinks models and speeds up inference with minimal accuracy loss.",
    "Speculative decoding accelerates large language model generation without changing the output.",
    "PagedAttention manages the key-value cache as paged memory for efficient LLM serving.",
    "YOLO performs real-time object detection and returns bounding boxes for each detected object.",
    "Whisper transcribes speech to text and supports many languages.",
    "Kubernetes with a horizontal pod autoscaler scales workers based on queue depth.",
    "Prometheus scrapes metrics and Grafana visualizes latency percentiles and throughput.",
    "OpenTelemetry propagates trace context so a request can be followed across services.",
    "Vector databases like Qdrant and pgvector enable fast nearest-neighbor search over embeddings.",
    "Retrieval-augmented generation grounds language models in external documents to reduce hallucination.",
    "A semantic cache returns a stored answer when a new query is similar to a previous one.",
    "GPUs accelerate matrix multiplication, the core operation of deep neural networks.",
    "Graceful shutdown drains in-flight work on SIGTERM so no job is lost during a deploy.",
    "Mount Everest is the highest mountain above sea level, located in the Himalayas.",
    "The Pacific Ocean is the largest and deepest of Earth's oceans.",
    "Photosynthesis converts sunlight, water, and carbon dioxide into glucose and oxygen.",
]


@register_kind("semantic-search")
class SemanticSearch(BaseModel):
    """Embedding-based nearest-neighbor search over a seeded corpus."""

    def load(self) -> None:
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:  # pragma: no cover - optional extra
            raise ModelLoadError(f"sentence-transformers required: {exc}") from exc

        from backend.models.runtime import resolve_torch_device

        self._top_k = int(self.params.get("top_k", 5))
        self._corpus: list[str] = self.params.get("corpus") or DEFAULT_CORPUS
        model_id = self.params.get("model_id", "sentence-transformers/all-MiniLM-L6-v2")
        self._model = SentenceTransformer(model_id, device=resolve_torch_device())
        # Pre-embed the corpus (normalized) so a query match is just a dot product.
        self._index = self._model.encode(
            self._corpus, normalize_embeddings=True, convert_to_numpy=True
        )
        _log.info("semantic_search_loaded", model_id=model_id, docs=len(self._corpus))

    def preprocess(self, payloads: list[str]) -> list[str]:
        return payloads

    def predict(self, batch: list[str]) -> np.ndarray:
        try:
            q = self._model.encode(batch, normalize_embeddings=True, convert_to_numpy=True)
        except Exception as exc:
            raise InferenceError(f"embedding failed: {exc}") from exc
        return q @ self._index.T  # cosine similarity (vectors are normalized)

    def postprocess(self, output: np.ndarray) -> list[list[Prediction]]:
        results: list[list[Prediction]] = []
        for row in output:
            top = np.argsort(row)[::-1][: self._top_k]
            results.append(
                [
                    Prediction(label=self._corpus[i], score=float(max(0.0, min(1.0, row[i]))))
                    for i in top
                ]
            )
        return results
