"""Keep native visual data and manipulation fixtures tied to their canonical sources."""
import importlib.util
import json
import math
import re
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[4]


class ManipulationAssetsTests(unittest.TestCase):
    def test_native_mesh_is_the_canonical_glb_export(self):
        path = ROOT / "clients/specs/tools/export_manipulation_mesh.py"
        spec = importlib.util.spec_from_file_location("export_manipulation_mesh", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        expected = module.export(ROOT / "clients/webxr/public/models/openyam.glb")
        source = (ROOT / "clients/specs/Assets/Scripts/DimOSSpecsClient/manipulation/OpenYAMMesh.ts").read_text()
        actual = json.loads(source.split(" = ", 1)[1].removesuffix(";\n"))
        self.assertEqual(actual, expected)
        for link in actual["links"].values():
            self.assertEqual(len(link["indices"]) % 3, 0)
            self.assertLess(max(link["indices"]), len(link["positions"]) // 3)
            self.assertEqual(len(link["normals"]), len(link["positions"]))
            for index in set(link["indices"]):
                self.assertAlmostEqual(math.hypot(*link["normals"][index * 3:index * 3 + 3]), 1, places=6)

    def test_native_arm_fixture_matches_webxr(self):
        source = (ROOT / "clients/specs/Tests/integration-tests/IntegrationArmFixture.ts").read_text()
        actual = json.loads(source.removeprefix("export const ARM_FIXTURE = ").removesuffix(";\n"))
        expected = json.loads((ROOT / "clients/webxr/tests/integration-tests/fixtures/OpenYAM.json").read_text())
        self.assertEqual(actual, expected)


    def test_arm_material_uses_the_imported_fresnel_pass(self):
        materials = ROOT / "clients/specs/Assets/Materials"
        metadata = (materials / "Shaders/ArmFresnel.ss_graph.meta").read_text()
        identity = re.search(r"PrimaryAsset: !<reference> ([0-9a-f-]+)", metadata).group(1)
        source = (materials / "ArmFresnel.mat").read_text()
        self.assertIn("Pass: !<reference> " + identity, source)
