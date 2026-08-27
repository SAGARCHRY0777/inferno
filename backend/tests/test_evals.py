"""Tests for the eval harness itself.

Two jobs. First, the scorers are pure functions and are unit-tested like any
other pure function -- a harness whose scorers are unverified is a ruler nobody
has checked against a known length. Second, the frozen dataset is validated
structurally, so a malformed or drifting golden item fails CI at the point it is
introduced rather than showing up later as an unexplained score change.

Everything here runs without the ML stack, so it belongs to the fast lane.
"""

from __future__ import annotations

import json

import pytest

from evals import scorers
from evals.corpus import corpus_hash, load_chunks, text_to_id
from evals.gate import GateResult, Thresholds, check
from evals.retrievers import LexicalRetriever
from evals.runner import (
    ABSTAIN_THRESHOLD,
    DEFAULT_K,
    UNANSWERABLE,
    load_dataset,
    run,
)

# --------------------------------------------------------------------------- #
# Scorers                                                                      #
# --------------------------------------------------------------------------- #


def test_hit_at_k_only_counts_the_top_k():
    assert scorers.hit_at_k(["a", "b", "c"], ["c"], k=3) == 1.0
    assert scorers.hit_at_k(["a", "b", "c"], ["c"], k=2) == 0.0


def test_hit_at_k_rejects_an_undefined_question():
    """No relevant chunk means the metric has no meaning; loudly, not as 0.0.

    Returning 0.0 would silently punish the retriever for an unanswerable item
    that was mis-bucketed, which is the sort of quiet bug that makes a whole
    suite untrustworthy.
    """

    with pytest.raises(ValueError):
        scorers.hit_at_k(["a"], [], k=1)


def test_recall_at_k_is_partial_for_multi_chunk_answers():
    assert scorers.recall_at_k(["a", "b"], ["a", "z"], k=2) == 0.5
    assert scorers.recall_at_k(["a", "z"], ["a", "z"], k=2) == 1.0


def test_recall_at_k_ignores_duplicate_references():
    assert scorers.recall_at_k(["a"], ["a", "a"], k=1) == 1.0


def test_reciprocal_rank_rewards_position():
    assert scorers.reciprocal_rank(["a", "b"], ["a"]) == 1.0
    assert scorers.reciprocal_rank(["a", "b"], ["b"]) == 0.5
    assert scorers.reciprocal_rank(["a", "b"], ["z"]) == 0.0


def test_groundedness_matches_across_punctuation_and_case():
    passages = ["Backpressure protects the system, from overload."]
    assert scorers.groundedness(passages, "protects the system from overload") == 1.0
    assert scorers.groundedness(passages, "protects the network from overload") == 0.0


def test_groundedness_requires_contiguity():
    """Bag-of-words matching would call almost anything grounded."""

    passages = ["the gateway never runs models and it validates input"]
    assert scorers.groundedness(passages, "gateway never runs models") == 1.0
    assert scorers.groundedness(passages, "gateway validates models") == 0.0


def test_groundedness_rejects_an_empty_span():
    with pytest.raises(ValueError):
        scorers.groundedness(["anything"], "   ")


def test_abstained_is_true_only_below_threshold():
    assert scorers.abstained([0.2, 0.1], threshold=0.5) == 1.0
    assert scorers.abstained([0.9], threshold=0.5) == 0.0
    assert scorers.abstained([], threshold=0.5) == 1.0


def test_wilson_interval_brackets_the_estimate_and_stays_in_range():
    low, high = scorers.wilson_interval(40, 50)
    assert low < 0.8 < high
    assert 0.0 <= low and high <= 1.0
    # The interval on 50 items is wide enough that a 4-point move is noise --
    # the fact this harness exists to make visible.
    assert (high - low) > 0.15


def test_wilson_interval_is_not_degenerate_at_the_boundary():
    """A perfect bucket still carries uncertainty; the normal approximation
    would claim a zero-width interval here."""

    low, high = scorers.wilson_interval(10, 10)
    assert low < 1.0
    assert high == 1.0


def test_wilson_interval_handles_zero_items():
    assert scorers.wilson_interval(0, 0) == (0.0, 0.0)


def test_mcnemar_counts_reports_both_directions():
    baseline = {"a": 1.0, "b": 0.0, "c": 1.0}
    candidate = {"a": 0.0, "b": 1.0, "c": 1.0}
    assert scorers.mcnemar_counts(baseline, candidate) == (1, 1)


def test_mcnemar_counts_only_compares_shared_items():
    assert scorers.mcnemar_counts({"a": 1.0}, {"b": 0.0}) == (0, 0)


# --------------------------------------------------------------------------- #
# Corpus                                                                       #
# --------------------------------------------------------------------------- #


def test_corpus_ids_are_unique_and_text_is_recoverable():
    chunks = load_chunks()
    assert len({c.id for c in chunks}) == len(chunks)
    # Recovering ids from text is how retrieved passages are mapped back; it
    # only works while passages are unique.
    assert len(text_to_id(chunks)) == len(chunks)


def test_corpus_hash_changes_when_the_corpus_changes():
    chunks = load_chunks()
    before = corpus_hash(chunks)
    mutated = list(chunks[:-1])
    assert corpus_hash(mutated) != before


# --------------------------------------------------------------------------- #
# The frozen dataset                                                           #
# --------------------------------------------------------------------------- #

ALLOWED_BUCKETS = {
    "architecture",
    "serving",
    "retrieval",
    "observability",
    "paraphrase",
    "multi_chunk",
    UNANSWERABLE,
}


@pytest.fixture(scope="module")
def dataset():
    return load_dataset()


def test_dataset_ids_are_unique(dataset):
    ids = [item.id for item in dataset]
    assert len(set(ids)) == len(ids)
    assert len(dataset) >= 50, "the golden set only ever grows"


def test_dataset_buckets_are_known(dataset):
    unknown = {i.bucket for i in dataset} - ALLOWED_BUCKETS
    assert not unknown, f"unknown buckets: {unknown}"


def test_dataset_references_only_real_chunks(dataset):
    valid = {c.id for c in load_chunks()}
    for item in dataset:
        missing = set(item.relevant_chunk_ids) - valid
        assert not missing, f"{item.id} references missing chunks: {missing}"


def test_answerable_items_have_references_and_unanswerable_do_not(dataset):
    for item in dataset:
        if item.is_unanswerable:
            assert item.relevant_chunk_ids == [], item.id
            assert item.answer_span is None, item.id
        else:
            assert item.relevant_chunk_ids, item.id
            assert item.answer_span, item.id


def test_every_answer_span_is_verbatim_in_its_own_chunk(dataset):
    """The reference must actually appear in the referenced passage.

    This is the guard against silent staleness: edit a corpus paragraph and any
    golden item whose span no longer appears in it fails here, at the commit
    that caused it, instead of quietly depressing the groundedness metric.
    """

    by_id = {c.id: c.text for c in load_chunks()}
    for item in dataset:
        if item.is_unanswerable:
            continue
        passages = [by_id[cid] for cid in item.relevant_chunk_ids]
        assert scorers.groundedness(passages, item.answer_span) == 1.0, (
            f"{item.id}: answer_span is not a verbatim run of words in "
            f"{item.relevant_chunk_ids}"
        )


def test_dataset_covers_every_chunk(dataset):
    """An unreferenced passage is an untested passage."""

    referenced = {cid for item in dataset for cid in item.relevant_chunk_ids}
    uncovered = {c.id for c in load_chunks()} - referenced
    assert not uncovered, f"no golden item covers: {sorted(uncovered)}"


def test_dataset_has_an_unanswerable_bucket(dataset):
    """Without it, a system that confidently answers everything scores well."""

    assert sum(1 for i in dataset if i.is_unanswerable) >= 5


# --------------------------------------------------------------------------- #
# Runner and gate                                                              #
# --------------------------------------------------------------------------- #


def test_runner_scores_every_item_and_reports_an_interval():
    report = run(LexicalRetriever(), load_dataset(), k=DEFAULT_K)
    assert report.n == len(load_dataset())
    assert len(report.per_item) == report.n
    low, high = report.interval["primary"]
    assert low <= report.metrics["primary"] <= high
    # The baseline is deliberately weak, but it must not be broken.
    assert 0.0 < report.metrics["primary"] < 1.0


def test_runner_report_is_json_serialisable():
    report = run(LexicalRetriever(), load_dataset()[:5])
    assert json.loads(report.to_json())["n"] == 5


def test_unanswerable_items_are_scored_on_abstention_not_retrieval():
    items = [i for i in load_dataset() if i.is_unanswerable][:3]
    report = run(LexicalRetriever(), items)
    for row in report.items:
        assert row["hit"] is None
        assert row["abstain"] in (0.0, 1.0)


def test_gate_fails_below_the_floor():
    report = run(LexicalRetriever(), load_dataset())
    strict = Thresholds(primary_floor=1.01, max_regression=1.0, bucket_floor=0.0)
    outcome = check(report, baseline=None, thresholds=strict)
    assert not outcome.passed
    assert any("below floor" in reason for reason in outcome.reasons)


def test_gate_fails_on_a_collapsed_bucket_even_when_the_aggregate_holds():
    """Aggregate blindness is the failure this check exists for."""

    report = run(LexicalRetriever(), load_dataset())
    report.metrics["primary"] = 0.95
    report.by_bucket["architecture"] = {"n": 9, "primary": 0.0}
    outcome = check(report, baseline=None, thresholds=Thresholds())
    assert not outcome.passed
    assert any("bucket 'architecture'" in reason for reason in outcome.reasons)


def test_gate_blocks_a_regression_beyond_the_allowance():
    report = run(LexicalRetriever(), load_dataset())
    baseline = {
        "retriever": report.retriever,
        "corpus_hash": report.corpus_hash,
        "dataset_hash": report.dataset_hash,
        "metrics": {"primary": report.metrics["primary"] + 0.30},
        "per_item": report.per_item,
    }
    outcome = check(report, baseline, Thresholds(primary_floor=0.0, bucket_floor=0.0))
    assert not outcome.passed
    assert any("regressed" in reason for reason in outcome.reasons)


def test_gate_refuses_to_compare_across_a_corpus_change():
    """A changed corpus means the two runs measured different things."""

    report = run(LexicalRetriever(), load_dataset())
    baseline = {
        "retriever": report.retriever,
        "corpus_hash": "0000000000000000",
        "dataset_hash": report.dataset_hash,
        "metrics": {"primary": 1.0},
        "per_item": {},
    }
    outcome = check(report, baseline, Thresholds(primary_floor=0.0, bucket_floor=0.0))
    assert outcome.passed
    assert any("corpus changed" in note for note in outcome.notes)


def test_gate_passes_with_no_baseline_but_still_enforces_floors():
    report = run(LexicalRetriever(), load_dataset())
    outcome = check(
        report, baseline=None, thresholds=Thresholds(primary_floor=0.0, bucket_floor=0.0)
    )
    assert isinstance(outcome, GateResult)
    assert outcome.passed
    assert any("no committed baseline" in note for note in outcome.notes)


def test_abstain_threshold_is_within_the_score_range():
    assert 0.0 < ABSTAIN_THRESHOLD < 1.0
