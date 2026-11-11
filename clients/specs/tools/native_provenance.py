"""Bind native evidence to selected production inputs and the actual disposable copy."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path


def project_files(root: Path) -> dict[str, str]:
    paths = list((root / "Assets").rglob("*")) + list(root.glob("*.esproj"))
    return {
        path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(paths)
        if path.is_file()
        and path.name != ".DS_Store"
        and not path.relative_to(root).as_posix().startswith("Assets/Review/")
        and path.relative_to(root).as_posix() != "Assets/Review.meta"
    }


def begin(source: Path, workspace: Path, canonical: Path) -> dict:
    marker = json.loads((workspace / ".specs-review.json").read_text())
    selected = project_files(source)
    tested = project_files(workspace)
    original = marker.get("productionFiles")
    expected = dict(original or tested)
    expected.update(marker.get("sceneOverlays", {}))
    return {
        "selectedRoot": str(source.resolve()),
        "workspaceRoot": str(workspace.resolve()),
        "selectedFiles": selected,
        "productionFiles": original,
        "workspaceFiles": tested,
        "publicationEligible": source.resolve() == canonical.resolve()
        and workspace.resolve() != source.resolve()
        and original == selected and expected == tested,
    }


def before_scene_overlay(provenance: dict) -> None:
    if (project_files(Path(provenance["selectedRoot"])) != provenance["selectedFiles"]
            or project_files(Path(provenance["workspaceRoot"])) != provenance["workspaceFiles"]):
        provenance["publicationEligible"] = False


def record_scene_overlay(provenance: dict) -> None:
    """Only editor-owned harness scene saves are allowed to change tested inputs."""
    workspace = Path(provenance["workspaceRoot"])
    scene = workspace / "Assets/Scene.scene"
    if not scene.is_file():
        return
    digest = hashlib.sha256(scene.read_bytes()).hexdigest()
    provenance["workspaceFiles"]["Assets/Scene.scene"] = digest
    marker_path = workspace / ".specs-review.json"
    marker = json.loads(marker_path.read_text())
    marker["sceneOverlays"] = {"Assets/Scene.scene": digest}
    marker_path.write_text(json.dumps(marker, indent=2) + "\n")


def matches(provenance: dict) -> bool:
    return (
        provenance.get("publicationEligible") is True
        and provenance["productionFiles"] == provenance["selectedFiles"]
        and project_files(Path(provenance["selectedRoot"])) == provenance["selectedFiles"]
        and project_files(Path(provenance["workspaceRoot"])) == provenance["workspaceFiles"]
    )
