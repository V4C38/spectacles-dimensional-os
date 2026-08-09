"""Import smoke tests — verify the v2 package loads without error."""

from __future__ import annotations

import importlib


def test_package_importable() -> None:
    importlib.import_module("dimos.ar")
