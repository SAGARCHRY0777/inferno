"""The runner: execute a retriever over the frozen dataset and score it.

Per-item rows are the output, not just the aggregate. Six months from now the
question that matters is "when did rag-014 start failing?", and that cannot be
answered from a stored average.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

from evals.corpus import corpus_hash, load_chunks
from evals.retrievers import Retriever
from evals.scorers import (
    abstained,
    groundedness,
    hit_at_k,
    mean,
    recall_at_k,
    reciprocal_rank,
    wilson_interval,
)

DATASET = Path(__file__).resolve().parent / "datasets" / "golden_rag.jsonl"

#: Top-k used for the headline retrieval metrics. Matches the served model's
#: default ``top_k`` so the harness scores what production actually returns.
DEFAULT_K = 5

#: Fallback for a retriever that declares no threshold of its own. Each
#: retriever should set ``abstain_threshold`` instead -- see the note there on
#: why one constant cannot serve two different score scales.
ABSTAIN_THRESHOLD = 0.5

UNANSWERABLE = "unanswerable"


@dataclass(frozen=True)
class GoldenItem:
    """One frozen evaluation case."""

    id: str
    bucket: str
    question: str
    relevant_chunk_ids: list[str]
    answer_span: str | None

    @property
    def is_unanswerable(self) -> bool:
        return self.bucket == UNANSWERABLE


@dataclass
class ItemResult:
    """Scores for a single item, plus enough context to debug a failure."""

    id: str
    bucket: str
    question: str
    retrieved: list[str]
    top_score: float
    hit: float | None = None
    recall: float | None = None
    mrr: float | None = None
    grounded: float | None = None
    abstain: float | None = None

    @property
    def primary(self) -> float:
        """The one number this item contributes to the headline pass rate.

        Answerable items are judged on whether the answer was retrieved at all;
        unanswerable items on whether the system declined. Mixing them into one
        average is deliberate: a system that scores well by answering everything
        confidently should not be able to hide behind a good retrieval number.
        """

        return self.abstain if self.abstain is not None else (self.hit or 0.0)


@dataclass
class RunReport:
    """Everything a reviewer or a gate needs from one run."""

    retriever: str
    k: int
    n: int
    corpus_hash: str
    dataset_hash: str
    metrics: dict[str, float] = field(default_factory=dict)
    interval: dict[str, list[float]] = field(default_factory=dict)
    by_bucket: dict[str, dict[str, float]] = field(default_factory=dict)
    failures: list[str] = field(default_factory=list)
    per_item: dict[str, float] = field(default_factory=dict)
    items: list[dict] = field(default_factory=list)

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2, sort_keys=True) + "\n"


def load_dataset(path: Path = DATASET) -> list[GoldenItem]:
    """Read the frozen golden set."""

    if not path.exists():
        raise FileNotFoundError(f"golden set not found: {path}")
    items: list[GoldenItem] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = line.strip()
        if not line:
            continue
        try:
            raw = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{path}:{number}: invalid JSON: {exc}") from exc
        items.append(
            GoldenItem(
                id=raw["id"],
                bucket=raw["bucket"],
                question=raw["question"],
                relevant_chunk_ids=list(raw["relevant_chunk_ids"]),
                answer_span=raw["answer_span"],
            )
        )
    if not items:
        raise ValueError(f"golden set is empty: {path}")
    return items


def dataset_hash(items: list[GoldenItem]) -> str:
    """Content hash of the frozen set, so a silently edited dataset is visible.

    Committed into every report. Changing a question or a reference is a
    legitimate act, but it makes today's score incomparable with yesterday's --
    this makes that fact show up in the diff instead of in a confusing trend.
    """

    import hashlib

    digest = hashlib.sha256()
    for item in sorted(items, key=lambda i: i.id):
        digest.update(
            json.dumps(asdict(item), sort_keys=True, ensure_ascii=True).encode()
        )
    return digest.hexdigest()[:16]


def score_item(retriever: Retriever, item: GoldenItem, k: int) -> ItemResult:
    """Run one item and score it. No aggregation, no I/O."""

    hits = retriever.retrieve(item.question, k)
    ids = [h.chunk_id for h in hits]
    result = ItemResult(
        id=item.id,
        bucket=item.bucket,
        question=item.question,
        retrieved=ids,
        top_score=round(max((h.score for h in hits), default=0.0), 6),
    )

    if item.is_unanswerable:
        threshold = getattr(retriever, "abstain_threshold", ABSTAIN_THRESHOLD)
        result.abstain = abstained([h.score for h in hits], threshold)
        return result

    result.hit = hit_at_k(ids, item.relevant_chunk_ids, k)
    result.recall = recall_at_k(ids, item.relevant_chunk_ids, k)
    result.mrr = reciprocal_rank(ids, item.relevant_chunk_ids)
    if item.answer_span:
        result.grounded = groundedness([h.text for h in hits], item.answer_span)
    return result


def run(
    retriever: Retriever,
    items: list[GoldenItem] | None = None,
    k: int = DEFAULT_K,
) -> RunReport:
    """Score a retriever over the whole dataset and aggregate."""

    items = items if items is not None else load_dataset()
    results = [score_item(retriever, item, k) for item in items]

    answerable = [r for r in results if r.hit is not None]
    unanswerable = [r for r in results if r.abstain is not None]
    grounded = [r for r in results if r.grounded is not None]

    primary = [r.primary for r in results]
    successes = round(sum(primary))
    low, high = wilson_interval(successes, len(results))

    metrics = {
        f"hit@{k}": round(mean([r.hit for r in answerable]), 4),
        f"recall@{k}": round(mean([r.recall for r in answerable]), 4),
        "mrr": round(mean([r.mrr for r in answerable]), 4),
        "groundedness": round(mean([r.grounded for r in grounded]), 4),
        "abstention": round(mean([r.abstain for r in unanswerable]), 4),
        # Diagnostic, not a target. Abstention is only meaningful if the system
        # is measurably less confident on questions the corpus cannot answer;
        # a margin near zero means the abstention rate is an artefact of where
        # the threshold happens to sit, not evidence of judgement.
        "abstain_margin": round(
            mean([r.top_score for r in answerable])
            - mean([r.top_score for r in unanswerable]),
            4,
        ),
        "primary": round(mean(primary), 4),
    }

    by_bucket: dict[str, dict[str, float]] = {}
    for result in results:
        bucket = by_bucket.setdefault(result.bucket, {"n": 0, "primary": 0.0})
        bucket["n"] += 1
        bucket["primary"] += result.primary
    for name, bucket in by_bucket.items():
        bucket["primary"] = round(bucket["primary"] / bucket["n"], 4)
        by_bucket[name] = bucket

    return RunReport(
        retriever=retriever.name,
        k=k,
        n=len(results),
        corpus_hash=corpus_hash(load_chunks()),
        dataset_hash=dataset_hash(items),
        metrics=metrics,
        interval={"primary": [round(low, 4), round(high, 4)]},
        by_bucket=dict(sorted(by_bucket.items())),
        failures=sorted(r.id for r in results if r.primary < 1.0),
        per_item={r.id: r.primary for r in results},
        items=[asdict(r) for r in results],
    )
