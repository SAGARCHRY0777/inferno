"""Scorers: pure functions from (system output, reference) to a number.

Pure is the whole point. Every function here is deterministic, dependency-free
and unit-tested in ``backend/tests/test_evals_scorers.py`` — an eval harness
whose scorers are themselves untested is measuring with an unverified ruler.

Nothing in this module imports the model stack, so it runs in the fast CI lane.
"""

from __future__ import annotations

import math
import re

# --------------------------------------------------------------------------- #
# Retrieval metrics                                                            #
# --------------------------------------------------------------------------- #


def hit_at_k(retrieved: list[str], relevant: list[str], k: int) -> float:
    """1.0 if any relevant chunk appears in the top-k, else 0.0.

    The headline "did we find it at all" number. Coarse by design: it says
    nothing about ranking, which is what ``mrr`` is for.
    """

    if not relevant:
        raise ValueError("hit_at_k is undefined with no relevant chunks")
    return float(bool(set(retrieved[:k]) & set(relevant)))


def recall_at_k(retrieved: list[str], relevant: list[str], k: int) -> float:
    """Fraction of the relevant chunks that appear in the top-k.

    Differs from ``hit_at_k`` only for multi-chunk answers, which is exactly
    where a retriever that finds one supporting passage and misses the other
    should not score full marks.
    """

    if not relevant:
        raise ValueError("recall_at_k is undefined with no relevant chunks")
    found = set(retrieved[:k]) & set(relevant)
    return len(found) / len(set(relevant))


def reciprocal_rank(retrieved: list[str], relevant: list[str]) -> float:
    """1/rank of the first relevant chunk, or 0.0 if none was retrieved.

    Rank-sensitive, so a change that moves the right passage from position 4 to
    position 1 shows up here while ``hit_at_k`` stays flat. That matters when a
    generator only reads the first passage or two.
    """

    if not relevant:
        raise ValueError("reciprocal_rank is undefined with no relevant chunks")
    wanted = set(relevant)
    for position, chunk_id in enumerate(retrieved, start=1):
        if chunk_id in wanted:
            return 1.0 / position
    return 0.0


# --------------------------------------------------------------------------- #
# Groundedness                                                                 #
# --------------------------------------------------------------------------- #

_WORD = re.compile(r"[a-z0-9]+")


def normalise(text: str) -> list[str]:
    """Lowercase word tokens, so punctuation and spacing never decide a score."""

    return _WORD.findall(text.lower())


def groundedness(passages: list[str], answer_span: str) -> float:
    """1.0 if the reference answer span is present in the retrieved passages.

    This system retrieves rather than generates, so "groundedness" is asked one
    step earlier than usual: not *did the model stay faithful to its context*,
    but *does the context actually contain the answer at all*. If it does not,
    no downstream generator could answer without inventing something.

    Matching is on normalised word sequences rather than raw substrings, so a
    passage is not judged ungrounded over a comma or a line wrap.
    """

    if not answer_span.strip():
        raise ValueError("groundedness needs a non-empty answer_span")
    needle = normalise(answer_span)
    if not needle:
        raise ValueError("answer_span contains no comparable tokens")
    for passage in passages:
        haystack = normalise(passage)
        if len(needle) > len(haystack):
            continue
        for start in range(len(haystack) - len(needle) + 1):
            if haystack[start : start + len(needle)] == needle:
                return 1.0
    return 0.0


def abstained(scores: list[float], threshold: float) -> float:
    """1.0 if the system declined to answer confidently.

    Scored only on the ``unanswerable`` bucket, where the corpus genuinely does
    not contain the answer. A retriever always returns its top-k — the question
    is whether it returns them with low enough confidence that a caller can
    reject them. Without this bucket a harness rewards a system that answers
    everything, which is the one behaviour that produces confident fiction.
    """

    if not scores:
        return 1.0
    return float(max(scores) < threshold)


# --------------------------------------------------------------------------- #
# Aggregation and uncertainty                                                  #
# --------------------------------------------------------------------------- #


def mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def wilson_interval(successes: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """95% Wilson score interval for a proportion.

    Reported next to every rate because a rate without an interval invites the
    mistake this harness exists to prevent: reading a 4-point move on 50 items
    as an improvement. At n=50, p=0.8 the interval is roughly +/-11 points, so
    such a move is indistinguishable from noise.

    Wilson rather than the normal approximation because the latter misbehaves
    badly near 0 and 1 — and a good bucket sitting at 1.0 is exactly where a
    naive interval would claim zero uncertainty.
    """

    if n <= 0:
        return (0.0, 0.0)
    p = successes / n
    denominator = 1 + z**2 / n
    centre = (p + z**2 / (2 * n)) / denominator
    margin = z * math.sqrt(p * (1 - p) / n + z**2 / (4 * n**2)) / denominator
    return (max(0.0, centre - margin), min(1.0, centre + margin))


def mcnemar_counts(
    baseline: dict[str, float], candidate: dict[str, float]
) -> tuple[int, int]:
    """Discordant pair counts between two runs over the *same* items.

    Returns ``(fixed, broken)``: items the candidate passes that the baseline
    failed, and items it fails that the baseline passed. Comparing two aggregate
    numbers from separate runs hides both; comparing per-item outcomes on shared
    items cancels the variance the two runs have in common, which is why this is
    the number to look at when a change moves the headline rate slightly.
    """

    shared = baseline.keys() & candidate.keys()
    fixed = sum(1 for i in shared if candidate[i] > baseline[i])
    broken = sum(1 for i in shared if candidate[i] < baseline[i])
    return fixed, broken
