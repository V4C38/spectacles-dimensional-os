#!/usr/bin/env python3
"""Generate 5.15 binary graphs from the checked-in readable shader sources.

Native templates come from the user's licensed 5.15 installation and an existing
project graph. This tool does not vendor Snap binaries, upgrade formats, or edit
scenes. Pass an explicit --out directory; native import/validation uses CLAD.
"""

from __future__ import annotations

import argparse
from copy import deepcopy
from pathlib import Path
import re
import struct
from typing import Any

import legacy_graph as graph

SPECS_ROOT = Path(__file__).resolve().parents[2]
SHADERS = SPECS_ROOT / "Assets/Materials/Shaders"
NAMES = ("VertexColor", "PoseIndicator", "LidarDot", "AdaptiveStroke", "BendyLaser", "ArmFresnel")
CUSTOM_METADATA = {
    "Code", "CustomCodeNodeAsset", "Description", "Examples", "ID", "LastChached3",
    "LastCodeFormatted3", "Locked", "Stage", "Title", "UseExternalFile", "ngs_Height",
    "ngs_Version",
}
FLAGS = {
    "CheckEnabled": False, "CheckExists": False, "CheckValue": True,
    "LockForPublic": False, "PreviewUseAlpha": False,
}


def find_node(value: Any, template: str) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    if value.get("TemplateID") and value["TemplateID"].value() == template:
        return value
    for child in value.values():
        found = find_node(child, template)
        if found is not None:
            return found
    return None


def add_node(children: dict[str, Any], key: str, node: dict[str, Any]) -> None:
    children[key] = node
    for suffix, value in FLAGS.items():
        children[key + suffix] = graph.boolean(value)
    children[key + "VirtualID"] = graph.string("")


def float_inputs(code: str) -> list[str]:
    return list(dict.fromkeys(re.findall(r"\binput_float\s+(\w+)\s*;", code)))


def code_node(template: dict[str, Any], level: int, title: str, code: str,
              inputs: dict[str, int], vertex: bool = False) -> dict[str, Any]:
    node = deepcopy(template)
    node["LevelID"] = graph.unsigned(level)
    node["Title1"] = graph.string(title)
    node["TemplateVersionMinor"] = graph.unsigned(2)
    ports = {key: value for key, value in node["Ports"].items() if key in CUSTOM_METADATA}
    node["Ports"] = ports
    for key, text in (("Code", code), ("Title", title),
                      ("LastChached3", ""), ("LastCodeFormatted3", "")):
        ports[key]["Property"]["Variables"]["String"] = graph.text_variable(text)
    ports["ID"]["Property"]["Variables"]["VariableX"] = graph.variable(
        struct.pack("<i", level), 2,
    )
    stage = ports["Stage"]["Property"]["Variables"]
    stage["ItemIndex"] = graph.variable(struct.pack("<i", 0 if vertex else 1), 2)
    stage["ItemName"] = graph.text_variable("Vertex" if vertex else "Pixel")
    ports["Position" if vertex else "Result"] = graph.port(
        "Position" if vertex else "Result", 3 if vertex else 4, output=True,
    )
    for name in float_inputs(code):
        ports[name] = graph.port(name, 1)
        graph.connect(ports[name], inputs[name], "Output")
    return node


def float_parameter(template: dict[str, Any], name: str, level: int) -> dict[str, Any]:
    node = deepcopy(template)
    node["LevelID"] = graph.unsigned(level)
    node["Title1"] = graph.string(name)
    ports = node["Ports"]
    for key, text in (("Title", name), ("ScriptName", name[0].lower() + name[1:])):
        ports[key]["Property"]["Variables"]["String"] = graph.text_variable(text)
    default = 1024 if name == "ViewportHeightPx" else 0.75 if name == "NearWidthScale" else 0
    ports["Default"]["Property"]["Variables"] = {"VariableX": graph.float_variable(default)}
    ports["Output"]["Property"]["Variables"] = {"VariableX": graph.float_variable(0)}
    for key in ("EnableMin", "EnableMax"):
        ports[key]["Property"]["Variables"]["VariableX"] = graph.variable(b"\0", 1)
    return node


def generate(base: dict[str, Any], custom: dict[str, Any], parameter: dict[str, Any],
             name: str, pixel: str, vertex: str | None) -> dict[str, Any]:
    tree = deepcopy(base)
    children = tree["Nodes"]["ChildNodes"]
    main = children["Node0"]
    inputs = {
        key: 7 + index for index, key in enumerate(float_inputs(pixel + "\n" + (vertex or "")))
    }
    add_node(children, "Node1", code_node(custom, 5, name, pixel, inputs))
    graph.connect(main["Ports"]["FinalColor"], 5, "Result")
    if vertex:
        add_node(children, "Node2", code_node(custom, 6, name + " Vertex", vertex, inputs, True))
        graph.connect(main["Ports"]["WorldPosition"], 6, "Position")
    parameter_keys = []
    for index, (key, level) in enumerate(inputs.items()):
        node_key = f"Node{(3 if vertex else 2) + index}"
        add_node(children, node_key, float_parameter(parameter, key, level))
        parameter_keys.append(node_key)
    ordered = parameter_keys + ["Node1"]
    if vertex:
        ordered.append("Node2")
    ordered.append("Node0")
    for dependency, key in enumerate(ordered):
        children[key]["DependencyIndex"] = graph.integer(dependency)
    tree["Nodes"]["NodeCount"] = graph.unsigned(len(ordered))
    return tree


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, required=True, help="Licensed Lens Studio 5.15 .app")
    parser.add_argument("--source-graph", type=Path, default=SHADERS / "AnimatedNoiseWaves.ss_graph")
    parser.add_argument("--sources", type=Path, default=SHADERS, help="Readable .customCode sources")
    parser.add_argument("--out", type=Path, required=True, help="Explicit output directory")
    args = parser.parse_args()
    base_path = args.app / "Contents/JsPlugins/PresetsRegistry/Assets/EmptyMaterial/Resources/Empty.ss_graph"
    for path in (base_path, args.source_graph):
        if graph.dumps(graph.load(path)) != path.read_bytes():
            raise ValueError(f"Template failed lossless roundtrip: {path}")
    base, source = graph.load(base_path), graph.load(args.source_graph)
    custom = find_node(source, "node_util_custom")
    parameter = find_node(source, "nodes_inputs_parameters_float")
    if custom is None or parameter is None:
        raise ValueError("Source graph must contain a custom-code node and float parameter")
    args.out.mkdir(parents=True, exist_ok=True)
    for name in NAMES:
        pixel = (args.sources / f"{name}.customCode").read_text(encoding="utf-8")
        vertex_file = args.sources / f"{name}Vertex.customCode"
        vertex = vertex_file.read_text(encoding="utf-8") if vertex_file.is_file() else None
        encoded = graph.dumps(generate(base, custom, parameter, name, pixel, vertex))
        if graph.dumps(graph.loads(encoded)) != encoded:
            raise ValueError(f"Generated graph failed lossless roundtrip: {name}")
        (args.out / f"{name}.ss_graph").write_bytes(encoded)
        print(args.out / f"{name}.ss_graph")


if __name__ == "__main__":
    main()
