"""Retrieval-augmented search: chunk a corpus, retrieve, then rerank with citations.

The modern RAG retrieval pipeline, self-contained:
  1. **Ingest + chunk** a document corpus (markdown) into passages, tracking the
     source file for citations.
  2. **Retrieve** the top-N passages for a query with a fast bi-encoder
     (cosine similarity over precomputed embeddings -- the in-memory "vector DB").
  3. **Rerank** that shortlist with a cross-encoder, which reads the query and
     passage together for much better precision, and return the top-K with their
     source citations.

Each result is a :class:`Prediction` whose ``label`` is the passage, ``score`` is
the rerank confidence, and ``source`` is the document it came from. Swapping the
in-memory index for pgvector/Qdrant, or adding an LLM to generate a grounded
answer from these passages, are drop-in extensions -- the contract is unchanged.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from backend.core.errors import InferenceError, ModelLoadError
from backend.core.logging import get_logger
from backend.core.schemas import Prediction
from backend.models.base import BaseModel
from backend.models.registry import register_kind

_log = get_logger("model.rag")

_DEFAULT_CORPUS = Path(__file__).resolve().parent / "corpus"


def _chunk_markdown(text: str) -> list[str]:
    """Split a markdown doc into passages: non-heading paragraphs, trimmed."""

    chunks: list[str] = []
    for block in text.split("\n\n"):
        block = " ".join(block.split())  # collapse whitespace
        if not block or block.startswith("#"):
            continue
        chunks.append(block)
    return chunks


@register_kind("rag-search")
class RagSearch(BaseModel):
    """Retrieve-then-rerank search over a document corpus, with citations."""

    def load(self) -> None:
        try:
            from sentence_transformers import CrossEncoder, SentenceTransformer
        except ImportError as exc:  # pragma: no cover - optional extra
            raise ModelLoadError(f"sentence-transformers required for RAG: {exc}") from exc

        from backend.models.runtime import resolve_torch_device

        self._top_n = int(self.params.get("top_n", 12))
        self._top_k = int(self.params.get("top_k", 4))
        self._rerank = bool(self.params.get("rerank", True))
        device = resolve_torch_device()

        corpus_dir = Path(self.params.get("corpus_dir", _DEFAULT_CORPUS))
        if not corpus_dir.exists():
            raise ModelLoadError(f"corpus dir not found: {corpus_dir}")

        # Ingest + chunk the corpus, tracking the source file for each passage.
        self._passages: list[str] = []
        self._sources: list[str] = []
        for path in sorted(corpus_dir.glob("*.md")):
            for chunk in _chunk_markdown(path.read_text(encoding="utf-8")):
                self._passages.append(chunk)
                self._sources.append(path.name)
        if not self._passages:
            raise ModelLoadError(f"no passages found in corpus: {corpus_dir}")

        self._encoder = SentenceTransformer(
            self.params.get("bi_encoder", "sentence-transformers/all-MiniLM-L6-v2"),
            device=device,
        )
        # Precompute the passage embeddings = the in-memory vector index.
        self._index = self._encoder.encode(
            self._passages, normalize_embeddings=True, convert_to_numpy=True
        )
        self._reranker = (
            CrossEncoder(self.params.get("reranker", "cross-encoder/ms-marco-MiniLM-L-6-v2"))
            if self._rerank
            else None
        )
        _log.info(
            "rag_loaded",
            passages=len(self._passages),
            sources=len(set(self._sources)),
            rerank=self._rerank,
            device=device,
        )

    def preprocess(self, payloads: list[str]) -> list[str]:
        return payloads

    def predict(self, batch: list[str]) -> list[list[tuple[int, float]]]:
        """For each query: bi-encoder retrieve top-N, then cross-encoder rerank."""

        try:
            q = self._encoder.encode(batch, normalize_embeddings=True, convert_to_numpy=True)
        except Exception as exc:
            raise InferenceError(f"embedding failed: {exc}") from exc
        sims = q @ self._index.T  # cosine (normalized)

        out: list[list[tuple[int, float]]] = []
        for query, row in zip(batch, sims, strict=False):
            shortlist = np.argsort(row)[::-1][: self._top_n].tolist()
            if self._reranker is not None:
                scores = self._reranker.predict([[query, self._passages[i]] for i in shortlist])
                scores = 1.0 / (1.0 + np.exp(-np.asarray(scores)))  # sigmoid -> 0..1
                order = np.argsort(scores)[::-1][: self._top_k]
                out.append([(shortlist[j], float(scores[j])) for j in order])
            else:
                out.append(
                    [(i, float(max(0.0, min(1.0, row[i])))) for i in shortlist[: self._top_k]]
                )
        return out

    def postprocess(self, output: list[list[tuple[int, float]]]) -> list[list[Prediction]]:
        return [
            [Prediction(label=self._passages[i], score=s, source=self._sources[i]) for i, s in hits]
            for hits in output
        ]
