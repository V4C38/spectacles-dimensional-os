from __future__ import annotations

from unittest.mock import MagicMock

from dimos.ar.adapters.base import BaselineMotionRecipe, DEFAULT_BASELINE_MOTION_RECIPE
from dimos.ar.bridge.module import _resolve_baseline_motion_recipe


def test_resolve_baseline_motion_recipe_uses_adapter_value() -> None:
    recipe = BaselineMotionRecipe(
        strafe_speed=0.25,
        leg_duration_s=(2.0, 4.0, 2.0),
        leg_directions=(1.0, -1.0, 1.0),
        leg_distance_multipliers=(1.0, 2.0, 1.0),
    )
    adapter = MagicMock()
    adapter.baseline_motion_recipe.return_value = recipe
    assert _resolve_baseline_motion_recipe(adapter) == recipe


def test_resolve_baseline_motion_recipe_defaults_on_failure() -> None:
    adapter = MagicMock()
    adapter.baseline_motion_recipe.side_effect = RuntimeError("rpc failed")
    assert _resolve_baseline_motion_recipe(adapter) == DEFAULT_BASELINE_MOTION_RECIPE
