"""Atomic launcher-wide choices, kept separate from robot calibration."""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from dimos_config import dimos_config_path


def path() -> Path:
    return dimos_config_path().with_name("ar-launcher.json")


def read() -> dict[str, Any]:
    try:
        data = json.loads(path().read_text())
        if not isinstance(data, dict):
            raise TypeError("launcher preferences must be a JSON object")
        return data
    except FileNotFoundError:
        return {}


def save(values: dict[str, Any]) -> None:
    target = path()
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=target.parent, prefix=".ar-launcher-")
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(values, stream, allow_nan=False)
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)
