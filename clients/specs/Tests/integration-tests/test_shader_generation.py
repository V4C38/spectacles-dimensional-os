"""Native graph nodes must be contiguous, including fragment-only parameter nodes."""
import importlib.util
from pathlib import Path
import sys
import unittest

TOOLS = Path(__file__).resolve().parents[2] / "tools/shaders"
sys.path.insert(0, str(TOOLS))
import legacy_graph as graph

spec = importlib.util.spec_from_file_location("shader_generate", TOOLS / "generate.py")
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


class ShaderGenerationTests(unittest.TestCase):
    def test_parameter_nodes_are_contiguous_with_and_without_vertex_stage(self):
        shaders = Path(__file__).resolve().parents[2] / "Assets/Materials/Shaders"
        base = graph.load(shaders / "PoseIndicator.ss_graph")
        source = graph.load(TOOLS / "templates/AnimatedNoiseWaves.ss_graph")
        custom = generator.find_node(source, "node_util_custom")
        parameter = generator.find_node(source, "nodes_inputs_parameters_float")
        self.assertIsNotNone(custom)
        self.assertIsNotNone(parameter)
        for vertex in (None, "output_vec3 Position; void main() { Position = vec3(0.0); }"):
            with self.subTest(vertex=vertex is not None):
                result = generator.generate(base, custom, parameter, "Fixture",
                    "input_float Fill; input_float EdgeOpacity; input_float Power; output_vec4 Result; void main() { Result = vec4(Fill); }", vertex)
                children = result["Nodes"]["ChildNodes"]
                keys = [key for key in children if key.startswith("Node") and key[4:].isdigit()]
                self.assertEqual(set(keys), {f"Node{i}" for i in range(len(keys))})
                self.assertEqual(graph.dumps(graph.loads(graph.dumps(result))), graph.dumps(result))

    def test_checked_in_stroke_graphs_match_sources_and_have_all_nodes(self):
        shaders = Path(__file__).resolve().parents[2] / "Assets/Materials/Shaders"
        for name in ("AdaptiveStroke", "ArmStroke"):
            with self.subTest(shader=name):
                tree = graph.load(shaders / f"{name}.ss_graph")
                self.assertEqual(graph.dumps(tree), (shaders / f"{name}.ss_graph").read_bytes())
                nodes = tree["Nodes"]["ChildNodes"]
                count = tree["Nodes"]["NodeCount"].value()
                keys = [key for key in nodes if key.startswith("Node") and key[4:].isdigit()]
                self.assertEqual(set(keys), {f"Node{i}" for i in range(count)})
                self.assertEqual({nodes[key]["DependencyIndex"].value() for key in keys}, set(range(count)))
                for node, source in (("Node1", f"{name}.customCode"), ("Node2", f"{name}Vertex.customCode")):
                    code = nodes[node]["Ports"]["Code"]["Property"]["Variables"]["String"]["Data"].data.decode()
                    self.assertEqual(code, (shaders / source).read_text())
                    if name == "AdaptiveStroke" or node == "Node2":
                        self.assertIn("MinimumPixels", nodes[node]["Ports"])

    def test_arm_opacity_is_interpolated_from_vertex_stage_and_has_no_material_parameter(self):
        shaders = Path(__file__).resolve().parents[2] / "Assets/Materials/Shaders"
        for name in ("ArmSurface", "ArmStroke"):
            with self.subTest(shader=name):
                tree = graph.load(shaders / f"{name}.ss_graph")
                nodes = tree["Nodes"]["ChildNodes"]
                pixel, vertex, interpolate = (nodes[f"Node{i}"] for i in (1, 2, 3))
                self.assertEqual(interpolate["TemplateID"].value(), "nodes_main_interpolate")
                self.assertEqual(interpolate["Ports"]["Input0"]["Connection0"]["PortID"].value(), "PointOpacity")
                self.assertEqual(interpolate["Ports"]["Input0"]["Connection0"]["NodeLevelID"].value(), vertex["LevelID"].value())
                self.assertEqual(pixel["Ports"]["PointOpacity"]["Connection0"]["NodeLevelID"].value(), interpolate["LevelID"].value())
                self.assertEqual(set(interpolate["Ports"]["Input0"]["Property"]["Variables"]), {"VariableX"})
                self.assertEqual(interpolate["Ports"]["Flat"]["Property"]["Variables"]["VariableX"]["Data"].data, b"\0")
                ids = {node["LevelID"].value(): node for node in nodes.values() if isinstance(node, dict) and "LevelID" in node}
                self.assertEqual(len(ids), tree["Nodes"]["NodeCount"].value())
                parameter_names = set()
                for node in ids.values():
                    if node["TemplateID"].value() == "nodes_inputs_parameters_float":
                        parameter_names.add(node["Ports"]["Title"]["Property"]["Variables"]["String"]["Data"].data.decode())
                    for port in node["Ports"].values():
                        if "Connection0" in port:
                            connection = port["Connection0"]
                            self.assertIn(connection["PortID"].value(), ids[connection["NodeLevelID"].value()]["Ports"])
                self.assertNotIn("PointOpacity", parameter_names)
                self.assertIn("PointDelta00", parameter_names)
                self.assertIn("PointVisibility", parameter_names)
                vertex_source = (shaders / f"{name}Vertex.customCode").read_text()
                code = vertex["Ports"]["Code"]["Property"]["Variables"]["String"]["Data"].data.decode()
                self.assertEqual(code, vertex_source)
                # Spatial work remains out of the fragment shader.
                self.assertNotIn("armPointOpacity", (shaders / f"{name}.customCode").read_text())

    def test_arm_graph_generation_reproduces_checked_in_assets(self):
        shaders = Path(__file__).resolve().parents[2] / "Assets/Materials/Shaders"
        source = graph.load(TOOLS / "templates/AnimatedNoiseWaves.ss_graph")
        custom = generator.find_node(source, "node_util_custom")
        parameter = generator.find_node(source, "nodes_inputs_parameters_float")
        for name in ("ArmSurface", "ArmStroke"):
            tree = graph.load(shaders / f"{name}.ss_graph")
            interpolate = generator.find_node(tree, "nodes_main_interpolate")
            generated = generator.generate(tree, custom, parameter, name,
                (shaders / f"{name}.customCode").read_text(),
                (shaders / f"{name}Vertex.customCode").read_text(), interpolate)
            self.assertEqual(graph.dumps(generated), graph.dumps(tree))
