from __future__ import annotations

from collections.abc import Sequence

from dimos.ar.localization.types import LocalizedPose, Localizer, Observation


class _FixedLocalizer:
    def localize(self, observations: Sequence[Observation]) -> LocalizedPose | None:
        if not observations:
            return None
        raise AssertionError("unexpected observations")


def test_localize_empty_observations_returns_none() -> None:
    localizer: Localizer = _FixedLocalizer()

    assert localizer.localize([]) is None
