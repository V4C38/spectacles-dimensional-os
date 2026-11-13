from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
import native_provenance as provenance
import review


class NativeProvenanceTests(unittest.TestCase):
    def test_packaged_core_changes_invalidate_native_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "production"
            (source / "Assets").mkdir(parents=True)
            (source / "Packages").mkdir()
            package = source / "Packages/DimOSARClient.lspkg"
            package.write_bytes(b"package v1")
            (source / "project.esproj").write_text("project")
            harness = root / "Scenario.ts"
            harness.write_text("fixture")
            workspace = root / "workspace"
            review.copy_project(source, workspace, harness)
            value = provenance.begin(source, workspace, source)
            self.assertTrue(provenance.matches(value))
            package.write_bytes(b"package v2")
            self.assertFalse(provenance.matches(value))
            package.write_bytes(b"package v1")
            (workspace / "Packages/DimOSARClient.lspkg").write_bytes(b"stale tested package")
            self.assertFalse(provenance.matches(value))

    def test_prepared_copy_cannot_validate_newer_or_alternate_production(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "production"
            (source / "Assets/Scripts").mkdir(parents=True)
            (source / "Assets/Scripts/Main.ts").write_text("old source")
            (source / "Assets/Scene.scene").write_text("production scene")
            (source / "Assets/.DS_Store").write_bytes(b"Finder metadata")
            (source / "Assets/Scripts/.DS_Store").write_bytes(b"nested Finder metadata")
            (source / "project.esproj").write_text("project")
            harness = root / "Scenario.ts"
            harness.write_text("fixture")
            workspace = root / "workspace"
            review.copy_project(source, workspace, harness)
            value = provenance.begin(source, workspace, source)
            self.assertTrue(provenance.matches(value))
            (workspace / "Assets/Review/extra.ts").write_text("allowed fixture")
            provenance.before_scene_overlay(value)
            (workspace / "Assets/Scene.scene").write_text("harness attached by editor")
            self.assertFalse(provenance.matches(value))
            provenance.record_scene_overlay(value)
            self.assertTrue(provenance.matches(value))
            self.assertTrue(provenance.matches(provenance.begin(source, workspace, source)))
            (source / "Assets/Scripts/Main.ts").write_text("new production")
            stale = provenance.begin(source, workspace, source)
            self.assertFalse(stale["publicationEligible"])
            self.assertFalse(provenance.matches(value))
            self.assertFalse(provenance.matches(stale))
            (source / "Assets/Scripts/Main.ts").write_text("old source")
            self.assertFalse(provenance.matches(provenance.begin(source, workspace, root / "canonical")))

    def test_cleanup_cannot_legitimize_a_scene_changed_during_recording(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "production"
            (source / "Assets").mkdir(parents=True)
            (source / "Assets/Scene.scene").write_text("source")
            (source / "project.esproj").write_text("project")
            harness = root / "Scenario.ts"
            harness.write_text("fixture")
            workspace = root / "workspace"
            review.copy_project(source, workspace, harness)
            value = provenance.begin(source, workspace, source)
            provenance.before_scene_overlay(value)
            (workspace / "Assets/Scene.scene").write_text("authorized harness attach")
            provenance.record_scene_overlay(value)
            self.assertTrue(provenance.matches(value))
            (workspace / "Assets/Scene.scene").write_text("unexpected edit while recording")
            provenance.before_scene_overlay(value)
            (workspace / "Assets/Scene.scene").write_text("cleanup saved editor state")
            provenance.record_scene_overlay(value)
            self.assertFalse(provenance.matches(value))

    def test_legacy_marker_and_workspace_edits_remain_diagnostic(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            (source / "Assets").mkdir(parents=True)
            (source / "project.esproj").write_text("project")
            (source / "Assets/Scene.scene").write_text("scene")
            harness = root / "Scenario.ts"
            harness.write_text("fixture")
            workspace = root / "workspace"
            review.copy_project(source, workspace, harness)
            marker = workspace / ".specs-review.json"
            value = json.loads(marker.read_text())
            del value["productionFiles"]
            marker.write_text(json.dumps(value))
            self.assertFalse(provenance.matches(provenance.begin(source, workspace, source)))
            value["productionFiles"] = provenance.project_files(source)
            marker.write_text(json.dumps(value))
            (workspace / "Assets/Unexpected.ts").write_text("unrecorded change")
            self.assertFalse(provenance.matches(provenance.begin(source, workspace, source)))
