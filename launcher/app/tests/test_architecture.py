"""Repository boundaries remain enforceable without importing the application or DimOS."""
from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("architecture_check", ROOT / "tools/architecture/check_python.py")
assert SPEC and SPEC.loader
CHECKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKER)


def test_production_python_boundaries_and_runtime_cycles() -> None:
    assert CHECKER.check_project(ROOT / "dimos-ar/dimos/ar", "dimos.ar") == []
    assert CHECKER.check_project(ROOT / "launcher/app") == []


def test_python_checker_understands_relative_type_and_dynamic_imports() -> None:
    source = '''
from typing import TYPE_CHECKING
from .ports import Value
if TYPE_CHECKING:
    from ..module import Root
import importlib
peer = importlib.import_module("test_support.peer")
# import tests.fake
example = "import tests.fake"
'''
    dependencies = CHECKER.dependencies(source, "dimos.ar.feature.worker")
    assert ("dimos.ar.feature.ports", True) in dependencies
    assert ("dimos.ar.module", False) in dependencies
    assert ("test_support.peer", True) in dependencies
    assert not any(name == "tests.fake" for name, _ in dependencies)


def test_checker_rejects_cycles_hosts_and_production_test_dependencies(tmp_path: Path) -> None:
    (tmp_path / "first.py").write_text("from .second import work\nimport clients.host\n")
    (tmp_path / "second.py").write_text("from .first import work\nimport test_support.peer\n")
    failures = CHECKER.check_project(tmp_path, "dimos.ar")
    assert any("runtime dependency cycle" in failure for failure in failures)
    assert any("imports a host" in failure for failure in failures)
    assert any("imports test code" in failure for failure in failures)
    assert CHECKER.runtime_cycles({"A": {"B", "C"}, "B": {"C"}, "C": set()}) == []


def test_type_only_and_lazy_imports_do_not_form_initialization_cycles(tmp_path: Path) -> None:
    (tmp_path / "first.py").write_text("from .second import work\n")
    (tmp_path / "second.py").write_text("def work():\n    from .first import work\n")
    assert CHECKER.check_project(tmp_path, "example") == []
    (tmp_path / "second.py").write_text("from typing import TYPE_CHECKING\nif TYPE_CHECKING:\n    from .first import work\n")
    assert CHECKER.check_project(tmp_path, "example") == []
