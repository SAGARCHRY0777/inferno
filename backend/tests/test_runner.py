"""Batched execution: fault isolation + timing attribution."""

from backend.core.enums import InputType, ResultStatus
from backend.core.errors import InferenceError
from backend.core.schemas import Job, Prediction
from backend.models.base import BaseModel
from backend.worker.runner import BatchItem, run_batch


class FlakyModel(BaseModel):
    """Raises whenever the payload 'BAD' is in the batch -- to test isolation."""

    def load(self):
        pass

    def preprocess(self, payloads):
        return payloads

    def predict(self, batch):
        if "BAD" in batch:
            raise InferenceError("poisoned batch")
        return batch

    def postprocess(self, output):
        return [[Prediction(label="ok", score=1.0)] for _ in output]


def _item(payload: str) -> BatchItem:
    job = Job(model_name="m", input_type=InputType.TEXT, payload=payload)
    return BatchItem(entry_id="1-0", job=job, pickup_ts=job.enqueued_at)


def test_one_bad_input_does_not_sink_the_batch():
    model = FlakyModel("m", InputType.TEXT)
    model.ensure_loaded()
    items = [_item("good1"), _item("BAD"), _item("good2")]

    results = run_batch(model, items, worker_id="w1", window_closed_ts=items[0].pickup_ts)

    by_payload = {r.job_id: r for r in results}
    assert len(results) == 3
    statuses = sorted(r.status for r in results)
    assert statuses.count(ResultStatus.SUCCESS) == 2
    assert statuses.count(ResultStatus.ERROR) == 1
    # The error result names the failure and carries no predictions.
    err = next(r for r in results if r.status is ResultStatus.ERROR)
    assert "poisoned" in (err.error or "")
    assert err.predictions == []
    assert by_payload  # silence unused


def test_happy_path_reports_batch_size_and_timings():
    model = FlakyModel("m", InputType.TEXT)
    model.ensure_loaded()
    items = [_item("a"), _item("b")]

    results = run_batch(model, items, worker_id="w1", window_closed_ts=items[0].pickup_ts)

    assert all(r.status is ResultStatus.SUCCESS for r in results)
    assert all(r.batch_size == 2 for r in results)
    for r in results:
        assert r.timings.total_ms >= 0
        assert r.worker_id == "w1"
