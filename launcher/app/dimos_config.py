"""Read/write the DimOS JSON config file (`~/.config/dimos/config`)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def dimos_config_path() -> Path:
    xdg = os.environ.get("XDG_CONFIG_HOME")
    base = Path(xdg) if xdg else Path.home() / ".config"
    return base / "dimos" / "config"


def load_dimos_config(path: Path | None = None) -> dict[str, Any]:
    target = path or dimos_config_path()
    if not target.is_file():
        return {}
    try:
        data = json.loads(target.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid DimOS config JSON ({target}): {exc}") from exc
    if not isinstance(data, dict):
        raise TypeError(f"DimOS config {target} must contain a JSON object")
    return data


def read_armodule_config(path: Path | None = None) -> dict[str, Any]:
    data = load_dimos_config(path)
    section = data.get("armodule")
    return dict(section) if isinstance(section, dict) else {}


def merge_armodule_config(
    armodule: dict[str, Any],
    path: Path | None = None,
) -> dict[str, Any]:
    target = path or dimos_config_path()
    data = load_dimos_config(target)
    data["armodule"] = armodule
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return data
