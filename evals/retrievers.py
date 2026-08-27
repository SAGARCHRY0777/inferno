"""The systems under test.

The runner talks to a small protocol rather than to a model, for two reasons.
First, it lets the harness be exercised end to end in the fast CI lane with a
dependency-free retriever, so the runner and gate are tested even on PRs that
cannot afford the ML stack. Second, comparing a real retriever against a trivial
one is the only way to know whether a score is any good: 0.72 hit@3 means
nothing until you know a keyword-overlap baseline gets 0.55.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from evals.corpus import Chunk, load_chunks, text_to_id
from evals.scorers import normalise


@dataclass(frozen=True)
class Retrieved:
    """One retrieved passage, resolved back to its corpus id."""

    chunk_id: str
    text: str
    score: float


class Retriever(Protocol):
    """What the runner needs from a system under test."""

    name: str

    #: Score below which a result counts as "not confident enough to answer".
    #: This belongs to the retriever, not to the harness, because it is a
    #: property of the score's *scale*: a cross-encoder emits a sigmoid, a
    #: keyword matcher emits an overlap fraction, and one threshold cannot be
    #: meaningful for both. Applying the cross-encoder's 0.5 to the lexical
    #: baseline scored it a perfect 1.0 on abstention while it would also have
    #: "abstained" on 27 of 44 answerable questions -- a flattering number that
    #: measured nothing.
    abstain_threshold: float

    def retrieve(self, query: str, k: int) -> list[Retrieved]:
        """Top-k passages for a query, best first."""
        ...


class LexicalRetriever:
    """Keyword-overlap baseline. No model, no downloads, fully deterministic.

    Deliberately weak: it scores a passage by how many of the query's words it
    contains, normalised by passage length. It cannot match a paraphrase that
    shares no vocabulary, which is precisely the gap the embedding retriever is
    supposed to close — so the difference between the two on the `paraphrase`
    bucket is the clearest evidence that the embeddings are earning their cost.
    """

    name = "lexical-baseline"

    #: Just above the highest score this retriever gives an unanswerable query
    #: on the current set. Reported alongside ``abstain_margin``, which shows
    #: the honest picture: its answerable and unanswerable score distributions
    #: overlap heavily (0.13-0.80 against 0.27-0.46), so no threshold separates
    #: them well. The baseline cannot really support abstention, and that is one
    #: of the concrete things the embedding model is being asked to buy.
    abstain_threshold = 0.47

    def __init__(self, chunks: list[Chunk] | None = None) -> None:
        self._chunks = chunks if chunks is not None else load_chunks()
        self._tokens = [set(normalise(c.text)) for c in self._chunks]

    def retrieve(self, query: str, k: int) -> list[Retrieved]:
        wanted = set(normalise(query))
        scored: list[tuple[float, int]] = []
        for index, tokens in enumerate(self._tokens):
            if not wanted:
                overlap = 0.0
            else:
                overlap = len(wanted & tokens) / len(wanted)
            scored.append((overlap, index))
        # Sort by score, then by index so ties are broken deterministically
        # rather than by dict ordering -- a classic source of a flaky suite.
        scored.sort(key=lambda pair: (-pair[0], pair[1]))
        return [
            Retrieved(self._chunks[i].id, self._chunks[i].text, round(score, 6))
            for score, i in scored[:k]
        ]


class RagModelRetriever:
    """The real served model: bi-encoder retrieve, then cross-encoder rerank.

    Loads through the production registry, so the harness measures the same code
    path the platform serves. Importing this pulls in numpy and
    sentence-transformers, hence the deferred import: the fast lane must be able
    to import this module without the ML stack present.
    """

    name = "rag-search"

    #: Cross-encoder relevance is squashed through a sigmoid, so 0.5 is the
    #: model's own "more likely relevant than not" midpoint rather than a tuned
    #: constant.
    abstain_threshold = 0.5

    def __init__(self, model_name: str = "rag-search", top_k: int = 5) -> None:
        from backend.models.registry import build_model

        self._top_k = top_k
        self._model = build_model(model_name)
        self._model.ensure_loaded()
        self._to_id = text_to_id(load_chunks())

    def retrieve(self, query: str, k: int) -> list[Retrieved]:
        batch = self._model.preprocess([query])
        predictions = self._model.postprocess(self._model.predict(batch))[0]
        out: list[Retrieved] = []
        for prediction in predictions[:k]:
            chunk_id = self._to_id.get(prediction.label)
            if chunk_id is None:
                # The model returned a passage the harness cannot map to an id,
                # which means the corpus it loaded differs from the one indexed
                # here. Silently scoring that as a miss would look like a
                # quality regression instead of a configuration error.
                raise RuntimeError(
                    "retrieved passage is not in the indexed corpus -- the model "
                    "and the harness are reading different corpora"
                )
            out.append(Retrieved(chunk_id, prediction.label, float(prediction.score)))
        return out


def build_retriever(name: str) -> Retriever:
    """Resolve a retriever by CLI name."""

    if name == "lexical":
        return LexicalRetriever()
    if name == "rag":
        return RagModelRetriever()
    raise ValueError(f"unknown retriever {name!r}; expected 'lexical' or 'rag'")
