"""Python lifecycle adapter to the shared integration provenance policy."""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
BRIDGE = REPO_ROOT / "tools/integration-tests/provenance.mjs"


def query(operation: str, **arguments: Any) -> Any:
    return json.loads(subprocess.check_output(
        ["node", str(BRIDGE)], input=json.dumps({"operation": operation, **arguments}), text=True,
    ))


def source_identity(root: Path = REPO_ROOT) -> dict:
    return query("source-identity", root=str(root))


def project_files(root: Path) -> dict[str, str]:
    return query("project-files", root=str(root))


def begin(source: Path, workspace: Path, canonical: Path) -> dict:
    return query("begin", source=str(source), workspace=str(workspace), canonical=str(canonical))


def _update(value: dict, operation: str) -> None:
    updated = query(operation, value=value)
    value.clear()
    value.update(updated)


def before_scene_overlay(provenance: dict) -> None:
    _update(provenance, "before-overlay")


def record_scene_overlay(provenance: dict) -> None:
    """Record editor-owned harness saves without forgiving intervening source changes."""
    _update(provenance, "record-overlay")
    scene = provenance["workspaceFiles"].get("Assets/Scene.scene")
    if scene is None:
        return
    marker_path = Path(provenance["workspaceRoot"]) / ".specs-review.json"
    marker = json.loads(marker_path.read_text())
    marker["sceneOverlays"] = {"Assets/Scene.scene": scene}
    marker_path.write_text(json.dumps(marker, indent=2) + "\n")


def matches(provenance: dict) -> bool:
    # begin() established the selected canonical root. Publication independently
    # checks it against the repository's production root in artifacts.mjs.
    return query("matches", value=provenance, canonical=provenance["selectedRoot"])
