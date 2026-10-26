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
    def test_native_errors_and_sik_caught_errors_cannot_pass_a_review(self) -> None:
        lines = [
            'I Preview UpdateDispatcher: Error in event "SpecsLaserUpdate": InternalError: pass',
            'E Preview Error: fixture rejected',
            'W Expected warning: Error: unavailable transport',
            'I Preview ordinary diagnostic',
        ]
        self.assertEqual(review.runtime_error_lines("\n".join(lines)), lines[:2])

    def test_default_artifacts_match_webxr_client_structure(self) -> None:
        with mock.patch.object(sys, "argv", ["review.py"]):
            self.assertEqual(review.arguments().output_root, review.SPECS_ROOT / "Tests/integration-tests/test-results")

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
            harness = root / "ReviewScenario.ts"
            harness.write_text('import { X } from "../../Assets/Scripts/X";')
            (root / "CameraFixture.png").write_bytes(b"fixture-texture")
            target = root / "disposable"
            project = review.copy_project(source, target, harness)
            self.assertEqual(project.name, "example.esproj")
            self.assertEqual((target / "Assets/Scene.scene").read_bytes(), b"native scene: untouched")
            self.assertFalse((target / "Cache").exists())
            self.assertIn('"../Scripts/X"', (target / "Assets/Review/ReviewScenario.ts").read_text())
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


class ReviewLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_restores_source_after_success(self) -> None:
        args = review.argparse.Namespace(keep_open=False)
        with mock.patch.object(review, "run_review", new_callable=mock.AsyncMock, return_value={"passed": True}), \
                mock.patch.object(review, "restore_source_project", new_callable=mock.AsyncMock) as restore:
            result = await review.review_and_restore(args, Path("output"), Path("workspace"))
        self.assertTrue(result["passed"])
        restore.assert_awaited_once_with(args, Path("output"), Path("workspace"))

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
        source = Path(__file__).with_name("IntegrationScenario.ts").read_text()
        handlers = re.findall(r'case "([a-z_]+)":', source)
        self.assertEqual(len(handlers), len(set(handlers)), "Duplicate integration handlers")
        self.assertEqual(set(handlers), {row["id"] for row in applicable_cases()})

    async def test_catalog_fixture_is_generated_from_the_shared_source(self) -> None:
        from integration_catalog import load_catalog, write_lens_catalog
        with tempfile.TemporaryDirectory() as directory:
            write_lens_catalog(Path(directory))
            text = (Path(directory) / "IntegrationCatalog.ts").read_text()
            value = json.loads(text.split(" = ", 1)[1].removesuffix(";\n"))
            self.assertEqual(value, load_catalog())
            self.assertEqual(len(value["golden"]["chapters"]), 25)


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
        source = graph.load(TOOLS.parent / "Assets/Materials/Shaders/AnimatedNoiseWaves.ss_graph")
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
    def test_comparison_subset_cannot_pass_the_full_review(self) -> None:
        full = [{"name": name} for name in review.DEFAULT_SCENES]
        self.assertTrue(review.complete_default_scenes(full))
        self.assertFalse(review.complete_default_scenes([
            scene for scene in full if scene["name"] not in {"robot-selected", "agent-response"}
        ]))

    def test_video_must_include_the_final_checkpoint_hold(self) -> None:
        scenes = [{"at": 414.3, "durationS": 2.8}]
        with self.assertRaisesRegex(review.ReviewError, "before the final checkpoint"):
            review.validate_video_duration(375.1, scenes)
        review.validate_video_duration(420, scenes)
        with self.assertRaisesRegex(review.ReviewError, "differs from capture clock"):
            review.validate_video_duration(437, scenes, 420)

    async def test_rejects_a_retained_native_comparison_input(self) -> None:
        class Client:
            async def editor(self, _code):
                return {"comparisonMode": True}

        with self.assertRaisesRegex(review.ReviewError, "incomplete state/world review"):
            await review.attach_scenario(Client(), Path("/tmp/disposable"), 5)

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
        self.assertEqual(sum('createSceneObject("ReviewScenarioHost")' in code for code in codes), 1)
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
