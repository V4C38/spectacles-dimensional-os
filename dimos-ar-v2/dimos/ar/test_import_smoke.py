"""Import smoke tests for dimos.ar."""

from __future__ import annotations

import importlib


def test_package_importable() -> None:
    importlib.import_module("dimos.ar")


def test_ar_module_importable() -> None:
    from dimos.ar.module import ARModule

    assert ARModule.__name__ == "ARModule"
