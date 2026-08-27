"""The result cache must not outlive the model that produced its entries.

Keyed on `model_name + payload` alone, swapping a model's weights and
restarting the worker left the gateway serving the PREVIOUS model's answers for
up to `cache.ttl_s` — silently, and indistinguishable from a correct result.
The key now includes an artifact fingerprint derived from kind + params +
version, so a changed model simply misses.
"""

from __future__ import annotations

from backend.core.cache import make_key
from backend.models.registry import ModelSpec

PAYLOAD = "the same input every time"


def _spec(**over) -> ModelSpec:
    base = {"name": "m", "kind": "hf-text", "input_type": "text", "params": {"model_id": "a"}}
    base.update(over)
    return ModelSpec(**base)


def test_same_artifact_and_input_hit_the_same_key() -> None:
    a, b = _spec(), _spec()
    assert a.fingerprint() == b.fingerprint()


def test_changing_the_weights_changes_the_fingerprint() -> None:
    """The case that caused stale answers: same name, different weights."""

    before = _spec(params={"model_id": "distilbert-v1"}).fingerprint()
    after = _spec(params={"model_id": "distilbert-v2"}).fingerprint()
    assert before != after


def test_bumping_the_version_tag_changes_the_fingerprint() -> None:
    """An escape hatch for weights that change without params changing —
    a re-trained checkpoint at the same path."""

    assert _spec(version="").fingerprint() != _spec(version="2026-08-a").fingerprint()


def test_changing_the_kind_changes_the_fingerprint() -> None:
    assert _spec(kind="hf-text").fingerprint() != _spec(kind="onnx-image").fingerprint()


def test_param_order_does_not_affect_the_fingerprint() -> None:
    """Otherwise a harmless YAML reshuffle would invalidate the whole cache."""

    a = _spec(params={"model_id": "x", "top_k": 3}).fingerprint()
    b = _spec(params={"top_k": 3, "model_id": "x"}).fingerprint()
    assert a == b


def test_description_is_not_part_of_the_fingerprint() -> None:
    """Docs are not behaviour — editing one must not cost a cold cache."""

    assert _spec(description="old").fingerprint() == _spec(description="new").fingerprint()


def test_cache_keys_differ_per_model_and_per_payload() -> None:
    assert make_key("a", PAYLOAD) != make_key("b", PAYLOAD)
    assert make_key("a", "one") != make_key("a", "two")


def test_make_key_is_stable_for_the_same_inputs() -> None:
    assert make_key("dummy-echo", PAYLOAD) == make_key("dummy-echo", PAYLOAD)


def test_an_unregistered_model_still_produces_a_key() -> None:
    """Keying must never be the reason a request fails."""

    assert len(make_key("not-a-registered-model", PAYLOAD)) == 64
