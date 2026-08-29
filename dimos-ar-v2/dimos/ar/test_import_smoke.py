"""Import smoke tests for dimos.ar."""

from __future__ import annotations

import importlib
import subprocess
import sys


def test_package_importable() -> None:
    importlib.import_module("dimos.ar")


def test_ar_module_importable() -> None:
    from dimos.ar.module import ARModule

    assert ARModule.__name__ == "ARModule"


def test_importing_ar_module_does_not_load_go2() -> None:
    script = (
        "import sys\n"
        "from dimos.ar.module import ARModule\n"
        "assert ARModule.__name__ == 'ARModule'\n"
        "assert 'dimos.ar.robot.go2' not in sys.modules\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
