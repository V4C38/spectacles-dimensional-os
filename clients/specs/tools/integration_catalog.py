"""Shared integration catalog access and disposable Lens module generation."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

CATALOG_PATH = Path(__file__).resolve().parents[3] / "tools/integration-tests/scenarios.json"


def load_catalog() -> dict[str, Any]:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    if catalog.get("schemaVersion") != 1:
        raise ValueError("Unsupported integration catalog schema")
    return catalog


def applicable_cases(group: str | None = None) -> list[dict[str, Any]]:
    return [row for row in load_catalog()["cases"] if "specs" in row["platforms"]
            and (group is None or (row["group"] == "golden") == (group == "golden"))]


def write_lens_catalog(directory: Path) -> None:
    catalog = load_catalog()
    code = "// Generated from tools/integration-tests/scenarios.json; disposable test fixture only.\n"
    code += "export const INTEGRATION_CATALOG = " + json.dumps(catalog, indent=2) + ";\n"
    (directory / "IntegrationCatalog.ts").write_text(code, encoding="utf-8")


def case_filename(case_id: str) -> str:
    ids = [row["id"] for row in applicable_cases()]
    if case_id not in ids:
        raise ValueError(f"Unknown Specs integration case: {case_id}")
    return f"{ids.index(case_id) + 1:02}_{case_id}"
