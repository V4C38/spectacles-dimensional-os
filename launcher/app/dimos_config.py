"""Locate launcher-owned settings and freeze native configuration for each run."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def dimos_config_path() -> Path:
    xdg = os.environ.get("XDG_CONFIG_HOME")
    base = Path(xdg) if xdg else Path.home() / ".config"
    return base / "dimos" / "config"


def write_runtime_config(armodule: dict[str, Any]) -> Path:
    """Preserve native configuration while replacing AR settings for this run."""
    source = dimos_config_path()
    data = json.loads(source.read_text()) if source.is_file() else {}
    if not isinstance(data, dict):
        raise TypeError("DimOS configuration must contain a JSON object")
    data["armodule"] = armodule
    with tempfile.NamedTemporaryFile(mode="w", prefix="dimos-ar-run-", suffix=".json", delete=False) as stream:
        target = Path(stream.name)
        try:
            json.dump(data, stream, allow_nan=False)
        except BaseException:
            target.unlink(missing_ok=True)
            raise
    return target
