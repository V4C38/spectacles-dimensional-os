"""Visual descriptors derived from the same materialized URDF as DimOS planning."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET

import numpy as np
from scipy.spatial.transform import Rotation


def _signature_values(value: Any) -> Any:
    if isinstance(value, float):
        return round(value, 9) or 0.0
    if isinstance(value, list):
        return [_signature_values(item) for item in value]
    if isinstance(value, dict):
        return {key: _signature_values(item) for key, item in value.items()}
    return value


def _triple(value: str | None, default: str = "0 0 0") -> list[float]:
    return [float(v) for v in (value or default).split()]


def _origin(element: ET.Element | None) -> dict[str, Any]:
    if element is None:
        return {"position": [0, 0, 0], "orientation": [0, 0, 0, 1]}
    return {
        "position": _triple(element.get("xyz")),
        "orientation": Rotation.from_euler("xyz", _triple(element.get("rpy"))).as_quat().tolist(),
    }


def describe_model(
    xml: str,
    asset_url: str | None = None,
    *,
    visual_profile: str | None = None,
    gripper_open_at_lower: list[str] | None = None,
) -> dict[str, Any]:
    import trimesh

    root = ET.fromstring(xml)
    links = []
    joints: list[dict[str, Any]] = []
    for link in root.findall("link"):
        points = []
        for visual in link.findall("visual"):
            geometry = visual.find("geometry")
            if geometry is None:
                continue
            origin = _origin(visual.find("origin"))
            mesh = geometry.find("mesh")
            if mesh is not None:
                path = Path(mesh.attrib["filename"])
                vertices = np.asarray(trimesh.load_mesh(path).bounding_box.vertices) * np.asarray(
                    _triple(mesh.get("scale"), "1 1 1")
                )
            elif geometry.find("box") is not None:
                box = geometry.find("box")
                assert box is not None
                vertices = trimesh.creation.box(_triple(box.get("size"))).vertices
            elif geometry.find("cylinder") is not None:
                cylinder = geometry.find("cylinder")
                assert cylinder is not None
                vertices = trimesh.creation.cylinder(
                    float(cylinder.attrib["radius"]), float(cylinder.attrib["length"]), sections=12
                ).vertices
            elif geometry.find("sphere") is not None:
                sphere = geometry.find("sphere")
                assert sphere is not None
                vertices = trimesh.creation.icosphere(
                    subdivisions=1, radius=float(sphere.attrib["radius"])
                ).vertices
            else:
                continue
            points.extend(
                Rotation.from_quat(origin["orientation"]).apply(vertices) + origin["position"]
            )
        bounds = None
        if points:
            vertices = np.asarray(points)
            lower, upper = vertices.min(axis=0), vertices.max(axis=0)
            bounds = {
                "center": ((lower + upper) / 2).tolist(),
                "size": np.maximum(upper - lower, 0.001).tolist(),
            }
        links.append({"name": link.attrib["name"], "bounds": bounds})
    for joint in root.findall("joint"):
        parent, child = joint.find("parent"), joint.find("child")
        assert parent is not None and child is not None
        axis = joint.find("axis")
        mimic = joint.find("mimic")
        limit = joint.find("limit")
        joints.append(
            {
                "name": joint.attrib["name"],
                "kind": joint.attrib["type"],
                "limits": (
                    {
                        "lower": float(limit.get("lower", "0")),
                        "upper": float(limit.get("upper", "0")),
                    }
                    if limit is not None
                    else None
                ),
                "parent": parent.attrib["link"],
                "child": child.attrib["link"],
                "origin": _origin(joint.find("origin")),
                "axis": _triple(axis.get("xyz") if axis is not None else None, "1 0 0"),
                "mimic": None
                if mimic is None
                else {
                    "joint": mimic.attrib["joint"],
                    "multiplier": float(mimic.get("multiplier", "1")),
                    "offset": float(mimic.get("offset", "0")),
                },
            }
        )
    children = {j["child"] for j in joints}
    roots = [link["name"] for link in links if link["name"] not in children]
    if len(roots) != 1:
        raise ValueError("visual model requires exactly one root")
    signature = hashlib.sha256(
        json.dumps(
            _signature_values(
                {
                    "links": links,
                    "joints": [{k: v for k, v in j.items() if k != "limits"} for j in joints],
                }
            ),
            sort_keys=True,
        ).encode()
    ).hexdigest()
    reversed_joints = set(gripper_open_at_lower or [])
    articulated = {
        j["name"]: j
        for j in joints
        if j["kind"] == "prismatic" and j["limits"] is not None and j["mimic"] is None
    }
    if not reversed_joints.issubset(articulated):
        raise ValueError("Gripper articulation requires independent bounded prismatic joints")
    gripper_joints = {
        name: {
            "closed": joint["limits"]["upper" if name in reversed_joints else "lower"],
            "open": joint["limits"]["lower" if name in reversed_joints else "upper"],
        }
        for name, joint in articulated.items()
    }
    return {
        "visual_signature": signature,
        "revision": hashlib.sha256(xml.encode()).hexdigest(),
        "root": roots[0],
        "links": links,
        "joints": joints,
        "asset_url": asset_url,
        **({"visual_profile": visual_profile} if visual_profile is not None else {}),
        "gripper_joints": gripper_joints,
    }
