"""Import smoke tests — verify that key modules load without error.

These tests exist to prevent regressions where a bad import path (e.g. a
renamed upstream module) silently breaks the entire package at load time.
"""

from __future__ import annotations

import importlib


def test_blueprints_importable() -> None:
    """dimos_xr.blueprints must be importable (exercises tag_tracker, adapters, etc.)."""
    importlib.import_module("dimos_xr.blueprints")


def test_tag_tracker_importable() -> None:
    """dimos_xr.tracking.tag_tracker must be importable (exercises fiducial helper imports)."""
    importlib.import_module("dimos_xr.tracking.tag_tracker")


def test_xr_bridge_module_importable() -> None:
    """dimos_xr.bridge.module must be importable (replaces the old xr_bridge_module check)."""
    importlib.import_module("dimos_xr.bridge.module")
