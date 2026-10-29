"""Named robot-instance calibration profiles, separate from robot-type defaults."""

from __future__ import annotations

import copy
import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Any
from uuid import uuid4

from dimos_config import dimos_config_path, read_armodule_config
from tag_config import armodule_config_from_ui

_LOCK = threading.RLock()
BLUEPRINT_ROBOTS = {
    "unitree_go2_ar": "unitree_go2",
    "unitree_go2_ar_agentic": "unitree_go2",
    "openyam_ar_planner": "openyam",
}


def profiles_path() -> Path:
    return dimos_config_path().with_name("ar-profiles.json")


class RobotProfiles:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or profiles_path()

    def all(self) -> list[dict[str, Any]]:
        with _LOCK:
            if not self.path.exists():
                legacy = read_armodule_config()
                self._save(
                    [
                        {
                            "id": uuid4().hex,
                            "robot": "unitree_go2",
                            "name": "UnitreeGo2",
                            "armodule": legacy,
                        }
                    ]
                )
            data = json.loads(self.path.read_text())
            if not isinstance(data, list):
                raise TypeError("robot profiles must contain a list")
            return copy.deepcopy(data)

    def get(self, profile_id: str) -> dict[str, Any]:
        return (
            next((p for p in self.all() if p["id"] == profile_id), None)
            or self._missing()
        )

    @staticmethod
    def _missing() -> Any:
        raise ValueError("unknown robot profile")

    def create(
        self, robot: str, name: str, source_id: str | None = None
    ) -> dict[str, Any]:
        if robot not in set(BLUEPRINT_ROBOTS.values()):
            raise ValueError("unknown robot type")
        with _LOCK:
            profiles = self.all()
            config = self.get(source_id)["armodule"] if source_id else {}
            if source_id and self.get(source_id)["robot"] != robot:
                raise ValueError("cannot duplicate a different robot type")
            if robot == "openyam" and not source_id:
                preset = Path(__file__).with_name("profiles") / "openyam.json"
                config = json.loads(preset.read_text(encoding="utf-8"))["armodule"]
            profile = {
                "id": uuid4().hex,
                "robot": robot,
                "name": self._name(name),
                "armodule": config,
            }
            self._save([*profiles, profile])
            return copy.deepcopy(profile)

    def update(
        self,
        profile_id: str,
        *,
        name: str | None = None,
        settings: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        with _LOCK:
            profiles = self.all()
            profile = next((p for p in profiles if p["id"] == profile_id), None)
            if profile is None:
                self._missing()
            assert profile is not None
            if name is not None:
                profile["name"] = self._name(name)
            if settings is not None:
                profile["armodule"].update(
                    armodule_config_from_ui(
                        fiducial_marker=settings["fiducial_marker"],
                        vps=settings["vps"],
                        map_code=settings.get("map_code"),
                        mounts=settings.get("mounts"),
                    )
                )
                if not settings["fiducial_marker"]:
                    profile["armodule"]["fiducial_marker_mounts"] = None
            self._save(profiles)
            return copy.deepcopy(profile)

    def delete(self, profile_id: str) -> None:
        with _LOCK:
            profiles = self.all()
            self.get(profile_id)
            self._save([p for p in profiles if p["id"] != profile_id])

    def snapshot(self, profile_id: str, blueprint: str) -> dict[str, Any]:
        profile = self.get(profile_id)
        if BLUEPRINT_ROBOTS.get(blueprint) != profile["robot"]:
            raise ValueError("robot profile is incompatible with blueprint")
        return {
            **copy.deepcopy(profile["armodule"]),
            "robot_display_name": profile["name"],
        }

    @staticmethod
    def _name(name: str) -> str:
        if not name.strip() or len(name) > 80:
            raise ValueError("profile name must contain 1 to 80 characters")
        return name.strip()

    def _save(self, profiles: list[dict[str, Any]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(dir=self.path.parent, prefix=".ar-profiles-")
        try:
            with os.fdopen(fd, "w") as stream:
                json.dump(profiles, stream, indent=2, allow_nan=False)
            os.replace(temporary, self.path)
        finally:
            Path(temporary).unlink(missing_ok=True)
