"""Import smoke tests — verify that key modules load without error.

These tests exist to prevent regressions where a bad import path (e.g. a
renamed upstream module) silently breaks the entire package at load time.
"""

from __future__ import annotations

import importlib


def test_blueprints_importable() -> None:
    """dimos.ar.blueprints must be importable (exercises tag_tracker, adapters, etc.)."""
    importlib.import_module("dimos.ar.blueprints")


def test_registration_importable() -> None:
    importlib.import_module("dimos.ar.registration.session")


def test_tag_tracker_importable() -> None:
    """dimos.ar.registration.tracker must be importable."""
    importlib.import_module("dimos.ar.registration.tracker")


def test_ar_bridge_module_importable() -> None:
    """dimos.ar.bridge.module must be importable."""
    importlib.import_module("dimos.ar.bridge.module")
