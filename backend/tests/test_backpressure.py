"""Backpressure hysteresis: shed load past the high mark, resume below the low."""

import pytest

import backend.gateway.backpressure as bp_mod
from backend.core.errors import BackpressureError
from backend.gateway.backpressure import BackpressureController
from backend.tests.conftest import make_settings


@pytest.fixture
def controller(monkeypatch, fake_async_broker):
    s = make_settings(queue={"high_watermark": 5, "low_watermark": 2, "retry_after_s": 3})
    monkeypatch.setattr(bp_mod, "get_settings", lambda: s)
    return BackpressureController(fake_async_broker), fake_async_broker


async def test_admits_below_high_watermark(controller):
    ctrl, broker = controller
    broker.depths["m"] = 4
    await ctrl.admit("m")  # no raise


async def test_rejects_above_high_watermark(controller):
    ctrl, broker = controller
    broker.depths["m"] = 6
    with pytest.raises(BackpressureError):
        await ctrl.admit("m")


async def test_hysteresis_stays_throttled_between_marks(controller):
    ctrl, broker = controller
    broker.depths["m"] = 6
    with pytest.raises(BackpressureError):
        await ctrl.admit("m")  # engage

    # Depth drops to 3 (between low=2 and high=5): still throttled.
    broker.depths["m"] = 3
    with pytest.raises(BackpressureError):
        await ctrl.admit("m")

    # Falls below low watermark: throttle releases.
    broker.depths["m"] = 1
    await ctrl.admit("m")  # no raise -> released

    # And stays open just under the high mark afterward.
    broker.depths["m"] = 4
    await ctrl.admit("m")


async def test_per_model_isolation(controller):
    ctrl, broker = controller
    broker.depths["saturated"] = 99
    broker.depths["healthy"] = 1
    with pytest.raises(BackpressureError):
        await ctrl.admit("saturated")
    await ctrl.admit("healthy")  # unaffected by the other lane


def test_retry_after_value(controller):
    ctrl, _ = controller
    assert ctrl.retry_after_s == 3
