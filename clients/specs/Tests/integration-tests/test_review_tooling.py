"""Tests for review evidence parsing and the legacy shader container contract."""

from __future__ import annotations

import base64
import asyncio
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

TOOLS = Path(__file__).resolve().parents[2] / "tools"
sys.path.insert(0, str(TOOLS))
sys.path.insert(0, str(TOOLS / "shaders"))
import review
import legacy_graph as graph
import generate as shader_generator


class ReviewEvidenceTests(unittest.TestCase):
    def test_every_native_harness_uses_the_scene_auto_run_gate(self) -> None:
        gate = (TOOLS.parent / "Assets/Scripts/Integration Test Harness.ts").read_text()
        self.assertIn("@input autoRun: boolean = false;", gate)
        self.assertIn("if (!global.deviceInfoSystem.isEditor()) return false;", gate)
        for path in Path(__file__).parent.glob("*.ts"):
            source = path.read_text()
            if "export class ReviewScenario extends BaseScriptComponent" not in source:
                continue
            with self.subTest(harness=path.name):
                awake = source.split("onAwake(): void {", 1)[1]
                self.assertTrue(awake.lstrip().startswith(
                    "if (!integrationTestsEnabled(this.getSceneObject())) return;"))
        self.assertIn("autoRun = true", review.script_attach_code(Path("/tmp/review"), 5))

    def test_disposable_harness_includes_shared_host_with_rebased_production_import(self) -> None:
        from native_project import prepare_harness

        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)
            (destination / "Assets").mkdir()
            prepare_harness(destination, Path(__file__).with_name("IntegrationScenario.ts"))
            review_dir = destination / "Assets/Review"
            self.assertIn('from "./IntegrationHost"', (review_dir / "ReviewScenario.ts").read_text())
            host = (review_dir / "IntegrationHost.ts").read_text()
            self.assertIn('from "../Scripts/DimOSSpecsClient/DimOSSpecsClient"', host)
            self.assertNotIn("../../Assets/", host)

    def test_reused_native_project_scopes_helpers_to_selected_harness(self) -> None:
        from native_project import prepare_harness

        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)
            (destination / "Assets").mkdir()
            review_dir = destination / "Assets/Review"
            main = Path(__file__).with_name("IntegrationScenario.ts")
            prepare_harness(destination, main)
            main_helpers = {path.name for path in review_dir.glob("Integration*.ts")}
            self.assertIn("IntegrationRegressionCases.ts", main_helpers)
            self.assertIn("IntegrationArmFixture.ts", main_helpers)  # Transitive dependency.
            self.assertIn('from "./ReviewScenario"',
                          (review_dir / "IntegrationRegressionCases.ts").read_text())
            self.assertNotIn("IntegrationScenario.ts", main_helpers)

            prepare_harness(destination, main.with_name("ManipulationProbe.ts"))
            self.assertEqual({path.name for path in review_dir.glob("Integration*.ts")}, {
                "IntegrationHost.ts", "IntegrationArmFixture.ts", "IntegrationInput.ts",
                "IntegrationV2Fixture.ts", "IntegrationCatalog.ts",
            })
            self.assertIn('from "../Scripts/DimOSSpecsClient/DimOSSpecsClient"',
                          (review_dir / "IntegrationHost.ts").read_text())
            self.assertTrue((review_dir / "CameraFixture.png").is_file())
            prepare_harness(destination, main)
            self.assertEqual({path.name for path in review_dir.glob("Integration*.ts")},
                             main_helpers)

    def test_probe_preserves_a_real_main_scenario_dependency(self) -> None:
        from native_project import prepare_harness

        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)
            (destination / "Assets").mkdir()
            harness = destination / "StandaloneProbe.ts"
            harness.write_text('import { helper } from "./IntegrationHelper";')
            (destination / "IntegrationHelper.ts").write_text(
                'import type { ReviewScenario } from "./IntegrationScenario";')
            (destination / "IntegrationScenario.ts").write_text(
                'export class ReviewScenario {}')
            prepare_harness(destination, harness)
            review_dir = destination / "Assets/Review"
            self.assertTrue((review_dir / "IntegrationScenario.ts").is_file())
            self.assertIn('from "./IntegrationScenario"',
                          (review_dir / "IntegrationHelper.ts").read_text())

    def test_native_errors_and_sik_caught_errors_cannot_pass_a_review(self) -> None:
        lines = [
            'I Preview UpdateDispatcher: Error in event "SpecsLaserUpdate": InternalError: pass',
            'E Preview Error: fixture rejected',
            'W Expected warning: Error: unavailable transport',
            'I Preview ordinary diagnostic',
        ]
        self.assertEqual(review.runtime_error_lines("\n".join(lines)), lines[:2])

    def test_default_artifacts_and_disposable_projects_use_root_review_data(self) -> None:
        with mock.patch.object(sys, "argv", ["review.py"]):
            args = review.arguments()
        self.assertEqual(args.output_root, review.REPO_ROOT / "Review Data/specs")
        self.assertEqual(args.work_root, review.REPO_ROOT / "Review Data/specs-work")
        with mock.patch.object(sys, "argv", ["review.py", "--output-root", "/tmp/custom evidence",
                                            "--work-root", "/tmp/custom project"]):
            args = review.arguments()
        self.assertEqual(args.output_root, Path("/tmp/custom evidence").resolve())
        self.assertEqual(args.work_root, Path("/tmp/custom project").resolve())

    def test_native_still_is_saved_beside_the_video(self) -> None:
        class NativeMcp:
            async def editor(self, code: str) -> None:
                self.code = code
                (output / "setup-connect.png").write_bytes(b"\x89PNG\r\n\x1a\n")
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            path = asyncio.run(review.capture(NativeMcp(), output, "setup-connect"))
            self.assertEqual(path, output / "setup-connect.png")

    def test_jpeg_fallback_keeps_diagnostic_images_separate(self) -> None:
        class FallbackMcp:
            def __init__(self, artifacts: Path) -> None:
                self.artifacts = artifacts
            async def editor(self, _code: str) -> None:
                raise review.ReviewError("PNG unavailable")
            async def call(self, _name: str, _args: dict) -> None:
                (self.artifacts / "mcp/screenshots/fallback.jpg").write_bytes(b"jpeg")
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            path = asyncio.run(review.capture(FallbackMcp(output), output, "setup-connect"))
            self.assertEqual(path, output / "setup-connect.jpg")
            self.assertEqual(path.read_bytes(), b"jpeg")

    def test_nested_clad_images_keep_their_actual_format(self) -> None:
        content = {"content": [{"type": "text", "text": json.dumps([
            {"type": "image", "mimeType": "image/jpeg", "data": base64.b64encode(b"jpeg").decode()},
            {"type": "text", "text": json.dumps({"width": 640})},
        ])}]}
        decoded = review.decode_result(content)
        with tempfile.TemporaryDirectory() as directory:
            images = review.extract_images(decoded, Path(directory), "proof")
            self.assertEqual(images[0].suffix, ".jpg")
            self.assertEqual(images[0].read_bytes(), b"jpeg")
        self.assertNotIn("data", decoded["content"][0]["text"][0])
        self.assertEqual(decoded["content"][0]["text"][1]["text"]["width"], 640)

    def test_editor_errors_do_not_look_like_successful_empty_output(self) -> None:
        with self.assertRaises(review.ReviewError):
            review.tool_payload({"status": "error", "returnValue": None, "error": "compile failed"})
        self.assertEqual(
            review.tool_payload({"content": [{"text": {"status": "success", "returnValue": {"ready": True}}}]}),
            {"ready": True},
        )
        self.assertEqual(
            review.tool_payload({"status": "Execution Succeeded", "returnValue": {"native": True}}),
            {"native": True},
        )

    def test_scene_logs_allow_native_prefixes_and_suffixes(self) -> None:
        logs = '\n'.join([
            'I [Preview 1] file.ts SPECS_REVIEW {"type":"scene","name":"selected","unixMs":2500} (Line 10)',
            'I [Preview 1] SPECS_REVIEW {"type":"result","name":"selection","passed":true}',
            'I SPECS_REVIEW broken JSON',
            'I SPECS_REVIEW {"type":"unrelated"}',
        ])
        events = review.parse_events(logs)
        self.assertEqual(len(events), 2)
        self.assertEqual(review.checkpoint(events[0], 1000)["at"], 1.5)
        self.assertEqual(review.checkpoint(events[0], 1000)["leadInS"], 0)
        self.assertEqual(review.checkpoint(events[0], 1000)["durationS"], 2.8)
        self.assertEqual(review.checkpoint({**events[0], "name": "navigation-stop"}, 1000)["durationS"], 1.4)
        with self.assertRaisesRegex(review.ReviewError, "Native scenario restarted"):
            review.checkpoint({**events[0], "unixMs": 5000}, 1000, [review.checkpoint(events[0], 1000)])
        with self.assertRaises(review.ReviewError):
            review.checkpoint(events[0], 3000)
        with self.assertRaises(review.ReviewError):
            review.checkpoint({"name": "missing-timestamp"}, 1000)

    def test_copy_keeps_scene_verbatim_and_excludes_local_caches(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "production"
            (source / "Assets").mkdir(parents=True)
            (source / "Cache").mkdir()
            (source / "Assets/Scene.scene").write_bytes(b"native scene: untouched")
            (source / "Cache/local").write_text("not portable")
            (source / "example.esproj").write_text("project")
            harness = root / "IntegrationScenario.ts"
            harness.write_text('import { X } from "../../Assets/Scripts/X";\n'
                               'import { run } from "./IntegrationGoldenCases";')
            (root / "IntegrationGoldenCases.ts").write_text(
                'import type { ReviewScenario } from "./IntegrationScenario";\n'
                'import { X } from "../../Assets/Scripts/X";')
            (root / "CameraFixture.png").write_bytes(b"fixture-texture")
            target = root / "disposable"
            project = review.copy_project(source, target, harness)
            self.assertEqual(project.name, "example.esproj")
            self.assertEqual((target / "Assets/Scene.scene").read_bytes(), b"native scene: untouched")
            self.assertFalse((target / "Cache").exists())
            self.assertIn('"../Scripts/X"', (target / "Assets/Review/ReviewScenario.ts").read_text())
            helper = (target / "Assets/Review/IntegrationGoldenCases.ts").read_text()
            self.assertIn('"./ReviewScenario"', helper)
            self.assertIn('"../Scripts/X"', helper)
            self.assertEqual((target / "Assets/Review/CameraFixture.png").read_bytes(), b"fixture-texture")
            self.assertFalse((source / "Assets/Review").exists())
            with self.assertRaises(review.ReviewError):
                review.copy_project(source, target, harness)

    def test_video_assembly_ignores_older_failed_runs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old = root / "SpecsReview-failed"
            old.mkdir()
            (old / "review-scenes.json").write_text('{"recording":"recording.mp4","scenes":[]}')
            output = root / "SpecsReview-current"
            output.mkdir()
            (output / "recording.mp4").write_bytes(b"continuous-video")
            (output / "review-scenes.json").write_text('{"recording":"recording.mp4","scenes":[{"name":"ready","at":2}]}')

            def encode(command, **_kwargs):
                stage = Path(command[-1])
                self.assertEqual([entry.name for entry in stage.iterdir()], [output.name])
                run = stage / output.name
                self.assertEqual((run / "recording.mp4").read_bytes(), b"continuous-video")
                (run / "interaction-review.mp4").write_bytes(b"review-excerpts")

            with mock.patch.object(review.subprocess, "run", side_effect=encode):
                review.make_video(output)
            self.assertEqual((output / "interaction-review.mp4").read_bytes(), b"review-excerpts")


class MediaRetentionTests(unittest.TestCase):
    def test_success_cleanup_preserves_golden_and_failure_diagnostics(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            for name in ("golden", "regression"):
                suite = output / name
                suite.mkdir()
                (suite / "recording.mp4").write_bytes(b"video")
                (suite / "native.log").write_text("diagnostics")
                (suite / "review-scenes.json").write_text(json.dumps({"profile": name, "recording": "recording.mp4"}))
            review.prune_success_recordings(output)
            self.assertTrue((output / "golden/recording.mp4").is_file())
            self.assertFalse((output / "regression/recording.mp4").exists())
            self.assertTrue((output / "regression/native.log").is_file())



class ReviewLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_focus_abort_skips_source_restoration_and_requires_authorization(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / "focus-budget.aborted").write_text("focus lost")
            args = review.argparse.Namespace(keep_open=False, mcp_config=output / "unused")
            with mock.patch.object(review, "run_review", new_callable=mock.AsyncMock,
                                   side_effect=review.ReviewError("recorder failed")), \
                    mock.patch.object(review, "restore_source_project", new_callable=mock.AsyncMock) as restore, \
                    mock.patch.object(review, "LensMcp", side_effect=RuntimeError("offline")):
                with self.assertRaisesRegex(review.ReviewError, "recorder failed"):
                    await review.review_and_restore(args, output, Path("workspace"))
            restore.assert_not_awaited()
            self.assertTrue(json.loads((output / "editor-restoration.json").read_text())["requiresUserAuthorization"])

    async def test_focused_probe_restores_source_and_cannot_pass_before_handoff(self) -> None:
        args = review.argparse.Namespace(keep_open=False, harness=Path("probe.ts"))
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            with mock.patch.object(review, "run_review", new_callable=mock.AsyncMock, return_value={"passed": True}), \
                    mock.patch.object(review, "restore_source_project", new_callable=mock.AsyncMock) as restore:
                result = await review.review_and_restore(args, output, Path("workspace"))
            self.assertTrue(result["scenarioPassed"])
            self.assertFalse(result["passed"])
            self.assertEqual(result["sourceAuditState"], "pending")
            restore.assert_awaited_once_with(args, output, Path("workspace"))

    async def test_restores_source_after_a_failed_scenario(self) -> None:
        args = review.argparse.Namespace(keep_open=False)
        with mock.patch.object(review, "run_review", new_callable=mock.AsyncMock, side_effect=review.ReviewError("scenario failed")), \
                mock.patch.object(review, "restore_source_project", new_callable=mock.AsyncMock) as restore:
            with self.assertRaisesRegex(review.ReviewError, "scenario failed"):
                await review.review_and_restore(args, Path("output"), Path("workspace"))
        restore.assert_awaited_once()

    async def test_only_leaves_fixtures_open_when_explicitly_requested(self) -> None:
        args = review.argparse.Namespace(keep_open=True)
        with mock.patch.object(review, "run_review", new_callable=mock.AsyncMock, return_value={"passed": True}), \
                mock.patch.object(review, "restore_source_project", new_callable=mock.AsyncMock) as restore:
            await review.review_and_restore(args, Path("output"), Path("workspace"))
        restore.assert_not_awaited()


class IntegrationHandoffTests(unittest.IsolatedAsyncioTestCase):
    async def test_result_stays_pending_during_source_restore(self) -> None:
        args = review.argparse.Namespace(keep_open=False, suite="all", harness=None)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            async def restore(*_args):
                result = json.loads((output / "results.json").read_text())
                self.assertFalse(result["passed"])
                self.assertEqual(result["sourceAuditState"], "pending")
            with mock.patch.object(review, "run_review", new_callable=mock.AsyncMock, return_value={"passed": True}), \
                    mock.patch.object(review, "restore_source_project", side_effect=restore):
                result = await review.review_and_restore(args, output, Path("workspace"))
            self.assertTrue(result["scenarioPassed"])
            self.assertFalse(result["passed"])

    async def test_source_handoff_checks_only_fresh_preview_errors(self) -> None:
        import audit_source
        with tempfile.TemporaryDirectory() as directory:
            logs = Path(directory)
            previous = logs / "LensStudioLog-old.txt"
            previous.write_text("E Old TypeError: previous project failed\n")
            offsets = {previous: previous.stat().st_size}
            self.assertEqual(audit_source.fresh_runtime_errors(logs, offsets), [])
            with previous.open("a") as stream:
                stream.write("E New TypeError: Frame initialization failed\n")
            fresh = logs / "LensStudioLog-new.txt"
            fresh.write_text("I UpdateDispatcher: Error in event: startup failed\n")
            errors = audit_source.fresh_runtime_errors(logs, offsets)
            self.assertEqual(len(errors), 2)
            self.assertTrue(any("Frame initialization" in line for line in errors))
            self.assertTrue(any("UpdateDispatcher" in line for line in errors))

    async def test_source_handoff_requires_one_disabled_integration_gate(self) -> None:
        import audit_source
        self.assertTrue(audit_source.source_harness_is_idle({"harness": {"hosts": 1, "gates": [{"autoRun": False}]}}))
        for state in ({}, {"harness": {"hosts": 0, "gates": []}},
                      {"harness": {"hosts": 1, "gates": [{"autoRun": True}]}},
                      {"harness": {"hosts": 1, "gates": [{}]}},
                      {"harness": {"hosts": 2, "gates": [{"autoRun": False}]}},
                      {"harness": {"hosts": 1, "gates": [{"autoRun": False}, {"autoRun": False}]}}):
            self.assertFalse(audit_source.source_harness_is_idle(state), state)

    async def test_failed_source_audit_fails_the_overall_run(self) -> None:
        import audit_source
        args = review.argparse.Namespace(source=Path("source"), mcp_config=Path("mcp.json"))
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            audit_source, "audit", new_callable=mock.AsyncMock, return_value=False,
        ):
            result = await review.verify_source_handoff(args, Path(directory), {"passed": True})
            self.assertFalse(result["passed"])
            self.assertFalse(result["checks"][-1]["passed"])

    async def test_audit_success_does_not_mask_a_failed_case(self) -> None:
        import audit_source
        args = review.argparse.Namespace(source=Path("source"), mcp_config=Path("mcp.json"))
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            audit_source, "audit", new_callable=mock.AsyncMock, return_value=True,
        ):
            result = await review.verify_source_handoff(args, Path(directory), {"passed": False})
            self.assertFalse(result["passed"])
            self.assertTrue(result["checks"][-1]["passed"])

    async def test_every_native_catalog_case_has_a_scenario_handler(self) -> None:
        import re
        from integration_catalog import applicable_cases
        entry = Path(__file__).with_name("IntegrationScenario.ts").read_text()
        golden = Path(__file__).with_name("IntegrationGoldenCases.ts").read_text()
        regression = Path(__file__).with_name("IntegrationRegressionCases.ts").read_text()
        handlers = re.findall(r'case "([a-z_]+)":', golden + regression)
        self.assertEqual(len(handlers), len(set(handlers)), "Duplicate integration handlers")
        arm_source = Path(__file__).with_name("IntegrationArmGolden.ts").read_text()
        arm_handlers = re.findall(r'id === "([a-z_]+)"', arm_source)
        self.assertEqual(len(arm_handlers), len(set(arm_handlers)), "Duplicate arm handlers")
        self.assertIn('runGoldenCase(this, step.id)', entry)
        self.assertIn('runRegressionCase(this, step.id)', entry)
        self.assertIn('scenario.armGolden.chapter(id', golden)
        # Some UI handlers are reused as prerequisites inside compact chapters.
        required = {row["id"] for row in applicable_cases()}
        self.assertFalse(required - set(handlers) - set(arm_handlers), "Missing catalog handler")

    async def test_catalog_fixture_is_generated_from_the_shared_source(self) -> None:
        from integration_catalog import load_catalog, write_lens_catalog
        with tempfile.TemporaryDirectory() as directory:
            write_lens_catalog(Path(directory))
            text = (Path(directory) / "IntegrationCatalog.ts").read_text()
            value = json.loads(text.split(" = ", 1)[1].removesuffix(";\n"))
            self.assertEqual(value, load_catalog())
            self.assertEqual(len(value["golden"]["chapters"]), 16)


class LegacyGraphTests(unittest.TestCase):
    def test_preserves_signed_and_unsigned_native_fields(self) -> None:
        tree = {"Nodes": {"LevelID": graph.unsigned(5), "DependencyIndex": graph.integer(-1)}}
        decoded = graph.loads(graph.dumps(tree))
        self.assertEqual(decoded["Nodes"]["LevelID"].type, 3)
        self.assertEqual(decoded["Nodes"]["DependencyIndex"].type, 2)
        self.assertEqual(decoded["Nodes"]["DependencyIndex"].value(), -1)
        port = graph.port("Color", 4, output=True)
        graph.connect(port, 5, "Result")
        self.assertEqual(port["IOType"].type, 3)
        self.assertEqual(port["ConnectionCount"].type, 3)
        self.assertEqual(port["Connection0"]["NodeLevelID"].type, 2)

    def test_existing_shader_graphs_roundtrip_losslessly(self) -> None:
        paths = list((TOOLS.parent / "Assets/Materials/Shaders").glob("*.ss_graph"))
        self.assertGreaterEqual(len(paths), 9)
        for path in paths:
            with self.subTest(shader=path.name):
                self.assertEqual(graph.dumps(graph.load(path)), path.read_bytes())

    def test_rejects_corrupt_graphs_instead_of_silently_truncating(self) -> None:
        data = graph.dumps({"NodeCount": graph.unsigned(1)})
        for invalid in (b"", data[:-1], data + b"extra", b"wrong-header"):
            with self.subTest(data=invalid[:10]), self.assertRaises(ValueError):
                graph.loads(invalid)

    def test_generated_world_graph_has_typed_inputs_and_deterministic_output(self) -> None:
        source = graph.load(TOOLS / "shaders/templates/AnimatedNoiseWaves.ss_graph")
        template = graph.load(TOOLS.parent / "Assets/Materials/Shaders/AdaptiveStroke.ss_graph")
        template["Nodes"]["ChildNodes"] = {
            key: value for key, value in template["Nodes"]["ChildNodes"].items()
            if key == "Node0" or key.startswith("Node0")
        }
        custom = shader_generator.find_node(source, "node_util_custom")
        parameter = shader_generator.find_node(source, "nodes_inputs_parameters_float")
        arguments = (
            template, custom, parameter, "Proof", "output_vec4 Result; void main() { Result = vec4(1.0); }",
            "input_float ViewportHeightPx; output_vec3 Position; void main() { Position = vec3(0.0); }",
        )
        first = shader_generator.generate(*arguments)
        second = shader_generator.generate(*arguments)
        self.assertEqual(graph.dumps(first), graph.dumps(second))
        children = first["Nodes"]["ChildNodes"]
        self.assertEqual(first["Nodes"]["NodeCount"].type, 3)
        self.assertEqual(children["Node2"]["LevelID"].type, 3)
        self.assertEqual(children["Node3"]["Ports"]["ScriptName"]["Property"]["Variables"]["String"]["Data"].data, b"viewportHeightPx")
        dependencies = [children[name]["DependencyIndex"].value() for name in ("Node0", "Node1", "Node2", "Node3")]
        self.assertEqual(len(set(dependencies)), 4)


    def test_laser_uniforms_share_nodes_across_vertex_and_fragment_stages(self) -> None:
        laser = graph.load(TOOLS.parent / "Assets/Materials/Shaders/BendyLaser.ss_graph")
        children = laser["Nodes"]["ChildNodes"]
        parameters = [value for value in children.values() if isinstance(value, dict)
                      and value.get("TemplateID")
                      and value["TemplateID"].value() == "nodes_inputs_parameters_float"]
        names = [node["Ports"]["ScriptName"]["Property"]["Variables"]["String"]["Data"].data
                 for node in parameters]
        self.assertEqual(len(names), 13)
        self.assertEqual(len(set(names)), 13)
        self.assertIn(b"startX", names)
        self.assertIn(b"controlX", names)
        self.assertIn(b"opacity", names)
        self.assertEqual(children["Node1"]["Ports"]["ControlX"]["Connection0"],
                         children["Node2"]["Ports"]["ControlX"]["Connection0"])


class McpSdkContractTests(unittest.IsolatedAsyncioTestCase):
    def test_video_must_include_the_final_checkpoint_hold(self) -> None:
        scenes = [{"at": 414.3, "durationS": 2.8}]
        with self.assertRaisesRegex(review.ReviewError, "before the final checkpoint"):
            review.validate_video_duration(375.1, scenes)
        review.validate_video_duration(420, scenes)
        with self.assertRaisesRegex(review.ReviewError, "differs from capture clock"):
            review.validate_video_duration(437, scenes, 420)

    async def test_pending_texture_import_retries_only_save(self) -> None:
        codes = []

        class Client:
            async def editor(self, code):
                codes.append(code)
                if len(codes) == 2:
                    raise review.ReviewError("Cannot save project while an asset operation is in progress")
                return {"saved": True}

        with mock.patch.object(review.asyncio, "sleep", new_callable=mock.AsyncMock):
            await review.attach_scenario(Client(), Path("/disposable"), 5)
        self.assertEqual(len(codes), 3)
        self.assertEqual(sum('createSceneObject("Integration Test Harness")' in code for code in codes), 1)
        self.assertNotIn("project.save()", codes[0])

    async def test_supports_sdk_snake_case_model_and_json_aliases(self) -> None:
        class Result:
            is_error = False

            def model_dump(self, **_kwargs):
                return {"isError": False, "content": [{"type": "text", "text": json.dumps({
                    "status": "success", "returnValue": {"ready": True},
                })}]}

        class Session:
            async def call_tool(self, _name, _arguments):
                return Result()

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "config.json"
            config.write_text(json.dumps({"url": "http://localhost", "token": "test-secret"}))
            client = review.LensMcp(config, root / "artifacts")
            client.session = Session()
            self.assertEqual(await client.call("ExecuteEditorCode", {}), {"ready": True})

    async def test_compile_waits_for_a_new_native_completion(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            native_log = root / "native.log"
            native_log.write_text("TypeScript compilation failed!\nold failure\n")
            (root / "Assets/Review").mkdir(parents=True)

            class Client:
                async def call(self, _name, _arguments):
                    raise AssertionError("Compilation waits on the native log without a blocking MCP tool")

            async def append_completion():
                await asyncio.sleep(0.05)
                with native_log.open("a") as stream:
                    stream.write("Starting watched compilation cycle\n")
                    stream.write("TypeScript compilation succeeded!\n")
            asyncio.create_task(append_completion())
            with mock.patch.object(review, "native_log_file", return_value=native_log):
                await review.compile_project(Client(), root, root, timeout=3)
            self.assertTrue((root / "Assets/Review/ReviewCompileTrigger.ts").is_file())
            self.assertNotIn("old failure", (root / "compile.log").read_text())


if __name__ == "__main__":
    unittest.main()
