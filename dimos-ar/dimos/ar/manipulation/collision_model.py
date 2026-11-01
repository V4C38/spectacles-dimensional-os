"""Local collision policy; the installed URDF and its visual geometry stay intact."""

import hashlib
import os
from pathlib import Path
import tempfile
import xml.etree.ElementTree as ET

from dimos.manipulation.planning.spec.config import RobotModelConfig
from dimos.robot.assets.model import RobotModel


def without_finger_collisions(config: RobotModelConfig) -> RobotModelConfig:
    root = ET.fromstring(config.model.load().xml)
    disabled = set()
    for joint in root.findall("joint"):
        if joint.get("name") in {"joint7", "joint8"}:
            child = joint.find("child")
            if child is not None:
                disabled.add(child.attrib["link"])
    for _ in range(len(root.findall("joint"))):
        for joint in root.findall("joint"):
            parent, child = joint.find("parent"), joint.find("child")
            if parent is not None and child is not None and parent.attrib["link"] in disabled:
                disabled.add(child.attrib["link"])
    for link in root.findall("link"):
        if link.attrib["name"] in disabled:
            for collision in link.findall("collision"):
                link.remove(collision)
    # Materialize the already-resolved model using the standard RobotModel
    # schema. Blueprint CLI validation reconstructs that base type and rejects
    # additional subclass fields; pickle-only tests do not exercise that path.
    xml = ET.tostring(root, encoding="unicode")
    cache = Path(tempfile.gettempdir()) / "dimos-ar-models"
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / (hashlib.sha256(xml.encode()).hexdigest() + ".urdf")
    if not path.exists():
        with tempfile.NamedTemporaryFile(mode="w", dir=cache, delete=False) as output:
            output.write(xml)
            temporary = output.name
        os.replace(temporary, path)
    model = RobotModel.from_file(path, package_paths=dict(config.model.load().package_paths))
    return config.model_copy(update={"model": model})
