"""Boundary behavior shared by protocol and native-domain validation."""

import math

import pytest

from dimos.ar.numeric import (
    finite_number,
    finite_vector,
    measurement_is_fresh,
    nonnegative_integer,
    quaternion_yaw,
    required_identifier,
    wrapped_angle,
)


@pytest.mark.parametrize("value", [True, False, None, "1", math.nan, math.inf, -math.inf, 10**1000])
def test_finite_number_rejects_nonfinite_or_non_numeric_values(value):
    with pytest.raises(ValueError, match="^coordinate must be finite$"):
        finite_number(value, "coordinate")


@pytest.mark.parametrize("value", [0, -3, 1.25, -0.0])
def test_finite_number_preserves_valid_numbers(value):
    assert finite_number(value, "coordinate") == value


@pytest.mark.parametrize("value", [None, True, 1, "", " \t", "x" * 129])
def test_identifier_rejects_invalid_identity(value):
    with pytest.raises(ValueError, match="^id must contain 1 to 128 characters$"):
        required_identifier(value, "id")


@pytest.mark.parametrize("value", ["x", "x" * 128, " x "])
def test_identifier_preserves_identity_without_trimming(value):
    assert required_identifier(value, "id") == value


@pytest.mark.parametrize("value", [True, False, None, -1, 1.0, math.nan, math.inf, "1"])
def test_sequence_rejects_bool_negative_or_non_integer(value):
    with pytest.raises(ValueError, match="^sequence must be a nonnegative integer$"):
        nonnegative_integer(value, "sequence")


@pytest.mark.parametrize("value", [0, 1, 10**1000])
def test_sequence_retains_integer_precision(value):
    assert nonnegative_integer(value, "sequence") == value


@pytest.mark.parametrize("value", [None, (), (1, 2, 3), [], [1, 2], [1, 2, 3, 4]])
def test_vector_requires_wire_array_with_exact_length(value):
    with pytest.raises(ValueError, match="^position must contain 3 numbers$"):
        finite_vector(value, "position", 3)


@pytest.mark.parametrize("component", [True, None, "1", math.nan, math.inf, 10**1000])
def test_vector_applies_finite_component_validation(component):
    with pytest.raises(ValueError, match="^position must be finite$"):
        finite_vector([0, component, 2], "position", 3)


def test_vector_leaves_domain_quaternion_policy_to_caller():
    assert finite_vector([1, 2.5, -3], "position", 3) == (1.0, 2.5, -3.0)
    assert finite_vector([0, 0, 0, 0], "orientation", 4) == (0.0, 0.0, 0.0, 0.0)


@pytest.mark.parametrize("angle", [-math.pi, -1.2, 0, 0.75, math.pi])
def test_quaternion_yaw_is_invariant_to_quaternion_sign(angle):
    orientation = [0, 0, math.sin(angle / 2), math.cos(angle / 2)]
    assert quaternion_yaw(orientation) == pytest.approx(angle)
    assert quaternion_yaw([-value for value in orientation]) == pytest.approx(angle)


@pytest.mark.parametrize(
    ("angle", "expected"),
    [
        (0, 0),
        (2 * math.pi, 0),
        (-2 * math.pi, 0),
        (math.pi + 0.25, -math.pi + 0.25),
        (-math.pi - 0.25, math.pi - 0.25),
    ],
)
def test_wrapped_angle_preserves_shortest_signed_rotation(angle, expected):
    assert wrapped_angle(angle) == pytest.approx(expected, abs=1e-12)


@pytest.mark.parametrize(
    ("timestamp", "expected"),
    [
        (100, True),
        (99.5, True),
        (99.499999, False),
        (100.000001, False),
        (math.nan, False),
        (math.inf, False),
        (-math.inf, False),
    ],
)
def test_feedback_freshness_includes_expiry_and_rejects_future_or_nonfinite(timestamp, expected):
    assert measurement_is_fresh(timestamp, now=100, max_age=0.5) is expected
