"""Atomic launcher-wide choices, kept separate from robot calibration."""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from config import env_path, read_env
from dimos_config import dimos_config_path


def path() -> Path:
    return dimos_config_path().with_name("ar-launcher.json")


def read() -> dict[str, Any]:
    try:
        data = json.loads(path().read_text())
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        address = read_env(env_path()).get("ROBOT_IP", "").strip()
        if address in {"simulated", "fake", "mock", "replay"}:
            return {"go2_source": "simulated"}
        return {"go2_source": "manual", "manual_ip": address} if address else {}
    except ValueError:
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
