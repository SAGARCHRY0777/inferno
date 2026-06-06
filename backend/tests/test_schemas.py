"""Boundary validation: bad input is rejected before it ever enqueues."""

import base64

import pytest
from pydantic import ValidationError

from backend.core.enums import InputType
from backend.core.schemas import InferenceRequest, Job


def test_valid_text_request():
    req = InferenceRequest(model_name="m", input_type=InputType.TEXT, payload="hello")
    assert req.input_type is InputType.TEXT


def test_valid_image_request_accepts_base64():
    payload = base64.b64encode(b"\x89PNGfake").decode()
    req = InferenceRequest(model_name="m", input_type=InputType.IMAGE, payload=payload)
    assert req.payload == payload


def test_image_rejects_non_base64():
    with pytest.raises(ValidationError):
        InferenceRequest(model_name="m", input_type=InputType.IMAGE, payload="not base64 !!!")


def test_text_rejects_blank():
    with pytest.raises(ValidationError):
        InferenceRequest(model_name="m", input_type=InputType.TEXT, payload="   ")


def test_unknown_field_is_rejected():
    with pytest.raises(ValidationError):
        InferenceRequest(
            model_name="m", input_type=InputType.TEXT, payload="x", surprise=1
        )


def test_job_from_request_stamps_id_and_time():
    req = InferenceRequest(model_name="m", input_type=InputType.TEXT, payload="hi")
    job = Job.from_request(req)
    assert job.job_id is not None
    assert job.enqueued_at > 0
    assert job.payload == "hi"
