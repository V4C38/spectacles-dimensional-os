"""Exclude only mutual contact between OpenYAM's opposing fingers."""

import xml.etree.ElementTree as ET

from dimos.manipulation.planning.spec.config import RobotModelConfig


def with_finger_self_collision_exclusion(config: RobotModelConfig) -> RobotModelConfig:
    root = ET.fromstring(config.model.load().xml)
    fingers = [
        child.attrib["link"]
        for joint in root.findall("joint")
        if joint.get("name") in {"joint7", "joint8"}
        and (child := joint.find("child")) is not None
    ]
    if len(fingers) != 2:
        raise ValueError("OpenYAM collision policy requires two opposing finger links")
    pair = tuple(sorted(fingers))
    pairs = list(config.collision_exclusion_pairs)
    if pair not in {tuple(sorted(value)) for value in pairs}:
        pairs.append((pair[0], pair[1]))
    return config.model_copy(update={"collision_exclusion_pairs": pairs})


def with_openyam_collision_geometry(config: RobotModelConfig) -> RobotModelConfig:
    """The upstream OpenYAM visual URDF currently supplies no collision geometry."""
    from copy import deepcopy
    import hashlib
    import os
    from pathlib import Path
    import tempfile

    from dimos.robot.assets.model import RobotModel

    loaded = config.model.load()
    root = ET.fromstring(loaded.xml)
    if any(link.findall("collision") for link in root.findall("link")):
        return config
    added = 0
    for link in root.findall("link"):
        for visual in link.findall("visual"):
            geometry = visual.find("geometry")
            if geometry is None:
                continue
            collision = ET.SubElement(link, "collision")
            origin = visual.find("origin")
            if origin is not None:
                collision.append(deepcopy(origin))
            collision.append(deepcopy(geometry))
            added += 1
    if not added:
        raise ValueError("OpenYAM planning requires collision geometry")
    xml = ET.tostring(root, encoding="unicode")
    cache = Path(tempfile.gettempdir()) / "dimos-ar-models"
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / (hashlib.sha256(xml.encode()).hexdigest() + ".urdf")
    if not path.exists():
        with tempfile.NamedTemporaryFile(mode="w", dir=cache, delete=False) as output:
            output.write(xml)
            temporary = output.name
        os.replace(temporary, path)
    model = RobotModel.from_file(path, package_paths=dict(loaded.package_paths))
    return config.model_copy(update={"model": model})
