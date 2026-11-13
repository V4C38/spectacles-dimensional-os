"""Localization defaults shared with the launcher without importing runtime services."""

import json
from pathlib import Path
from typing import cast

LOCALIZATION_POLICY_DEFAULTS = cast(
    "dict[str, float]", json.loads(Path(__file__).with_suffix(".json").read_text(encoding="utf-8"))
)
