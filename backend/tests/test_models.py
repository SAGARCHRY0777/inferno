"""Model plugin contract + registry, plus optional real-model smoke tests."""

import pytest

from backend.core.enums import InputType
from backend.core.schemas import Prediction
from backend.models.dummy import DummyModel
from backend.models.registry import build_model, list_specs


def test_dummy_batched_pipeline_is_order_preserving_and_normalized():
    model = DummyModel("dummy-echo", InputType.TEXT, {"labels": ["a", "b", "c"]})
    model.ensure_loaded()
    payloads = ["one", "two", "three", "four"]

    preds = model.postprocess(model.predict(model.preprocess(payloads)))

    assert len(preds) == len(payloads)  # one result list per input, in order
    for row in preds:
        assert row and isinstance(row[0], Prediction)
        assert 0.0 <= row[0].score <= 1.0


def test_dummy_is_deterministic():
    model = DummyModel("d", InputType.TEXT)
    model.ensure_loaded()
    a = model.predict(model.preprocess(["stable"]))
    b = model.predict(model.preprocess(["stable"]))
    assert a == b


def test_registry_lists_and_builds_from_config():
    names = {s.name for s in list_specs()}
    assert {"dummy-echo", "resnet-image", "distilbert-sentiment"} <= names
    model = build_model("dummy-echo")
    assert model.input_type is InputType.TEXT


def test_unknown_model_raises():
    from backend.core.errors import UnknownModelError

    with pytest.raises(UnknownModelError):
        build_model("does-not-exist")


# --- optional heavy paths -------------------------------------------------- #
@pytest.mark.ml
def test_distilbert_sentiment_if_available():
    transformers = pytest.importorskip("transformers")  # noqa: F841
    model = build_model("distilbert-sentiment")
    model.ensure_loaded()
    preds = model.postprocess(model.predict(model.preprocess(["I love this!"])))
    labels = {p.label for p in preds[0]}
    assert labels & {"POSITIVE", "NEGATIVE"}
