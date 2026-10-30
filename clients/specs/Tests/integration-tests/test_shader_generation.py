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
        source = graph.load(shaders / "AnimatedNoiseWaves.ss_graph")
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
