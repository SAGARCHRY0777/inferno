"""Percentile math: the foundation of the live latency dashboard."""

import pytest

from backend.core.metrics import percentile


def test_empty_returns_zero():
    assert percentile([], 50) == 0.0


def test_single_value():
    assert percentile([42.0], 99) == 42.0


def test_min_and_max_bounds():
    values = [1.0, 2.0, 3.0, 4.0, 5.0]
    assert percentile(values, 0) == 1.0
    assert percentile(values, 100) == 5.0


def test_median_odd_count():
    assert percentile([1.0, 2.0, 3.0], 50) == 2.0


def test_linear_interpolation_matches_numpy_method():
    # numpy.percentile([1..100], 90, method="linear") == 90.1
    values = [float(i) for i in range(1, 101)]
    assert percentile(values, 90) == pytest.approx(90.1, abs=1e-9)
    assert percentile(values, 50) == pytest.approx(50.5, abs=1e-9)


def test_unsorted_input_is_handled():
    assert percentile([5.0, 1.0, 3.0, 2.0, 4.0], 50) == 3.0
