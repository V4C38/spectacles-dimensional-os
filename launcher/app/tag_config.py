"""Per-stack AprilTag mount config for the launcher UI."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Literal

from config import repo_root

StackId = Literal["go2", "g1"]
DEFAULT_PRINT_SIZE_MM = 70.0
# 36h11 assets: 10 modules total, 8-module black square → black = 80% of print size.
_BLACK_FRACTION = 8.0 / 10.0


def black_size_m_from_print_mm(print_size_mm: float) -> float:
    return (float(print_size_mm) / 1000.0) * _BLACK_FRACTION


# Keep defaults aligned with dimos-ar/dimos/ar/robot_profile/{go2,g1}.py
DEFAULT_TAGS: dict[str, list[dict[str, Any]]] = {
    "go2": [
        {
            "tag_id": 0,
            "print_size_mm": DEFAULT_PRINT_SIZE_MM,
            "forward_m": 0.18,
            "lateral_m": 0.0,
            "up_m": 0.06,
            "yaw_deg": -90.0,
            "pitch_deg": -15.0,
        }
    ],
    "g1": [
        {
            "tag_id": 0,
            "print_size_mm": DEFAULT_PRINT_SIZE_MM,
            "forward_m": 0.10,
            "lateral_m": 0.0,
            "up_m": 0.35,
            "yaw_deg": 0.0,
            "pitch_deg": -90.0,
        }
    ],
}


def tag_config_dir(root: Path | None = None) -> Path:
    return (root or repo_root()) / ".dimos-ar-launcher"


def tag_config_path(stack: str, root: Path | None = None) -> Path:
    if stack not in ("go2", "g1"):
        raise ValueError("stack must be 'go2' or 'g1'")
    return tag_config_dir(root) / f"tag_config_{stack}.json"


def _yaw_pitch_to_quat(yaw_deg: float, pitch_deg: float) -> tuple[float, float, float, float]:
    """Match Go2 profile convention: R = RotY(pitch) * RotZ(yaw), scipy (x,y,z,w)."""
    yaw = math.radians(yaw_deg)
    pitch = math.radians(pitch_deg)
    cy, sy = math.cos(yaw * 0.5), math.sin(yaw * 0.5)
    cp, sp = math.cos(pitch * 0.5), math.sin(pitch * 0.5)
    # Quaternion multiply q_pitch * q_yaw (x,y,z,w)
    qy = (0.0, sp, 0.0, cp)
    qz = (0.0, 0.0, sy, cy)
    x = qy[3] * qz[0] + qy[0] * qz[3] + qy[1] * qz[2] - qy[2] * qz[1]
    y = qy[3] * qz[1] - qy[0] * qz[2] + qy[1] * qz[3] + qy[2] * qz[0]
    z = qy[3] * qz[2] + qy[0] * qz[1] - qy[1] * qz[0] + qy[2] * qz[3]
    w = qy[3] * qz[3] - qy[0] * qz[0] - qy[1] * qz[1] - qy[2] * qz[2]
    return (x, y, z, w)


def _normalize_tag(raw: dict[str, Any]) -> dict[str, Any]:
    print_size_mm = float(raw.get("print_size_mm", DEFAULT_PRINT_SIZE_MM))
    if print_size_mm <= 0:
        raise ValueError("print_size_mm must be positive")
    return {
        "tag_id": int(raw["tag_id"]),
        "print_size_mm": print_size_mm,
        "forward_m": float(raw.get("forward_m", 0.0)),
        "lateral_m": float(raw.get("lateral_m", 0.0)),
        "up_m": float(raw.get("up_m", 0.0)),
        "yaw_deg": float(raw.get("yaw_deg", 0.0)),
        "pitch_deg": float(raw.get("pitch_deg", 0.0)),
    }


def default_tag_ids(stack: str) -> frozenset[int]:
    return frozenset(int(t["tag_id"]) for t in DEFAULT_TAGS[stack])


def _ensure_profile_defaults(tags: list[dict[str, Any]], *, stack: str) -> list[dict[str, Any]]:
    """Keep robot_profile default tag IDs present (cannot be deleted)."""
    present = {int(t["tag_id"]) for t in tags}
    missing = [dict(t) for t in DEFAULT_TAGS[stack] if int(t["tag_id"]) not in present]
    if not missing:
        return tags
    return missing + tags


def _normalize_stack_tags(raw: Any, *, stack: str) -> list[dict[str, Any]]:
    if not isinstance(raw, list) or not raw:
        return [dict(t) for t in DEFAULT_TAGS[stack]]
    normalized = [_normalize_tag(item) for item in raw]
    return _ensure_profile_defaults(normalized, stack=stack)


def default_tag_config() -> dict[str, list[dict[str, Any]]]:
    return {stack: [dict(t) for t in tags] for stack, tags in DEFAULT_TAGS.items()}


def _read_stack_file(path: Path, *, stack: str) -> list[dict[str, Any]] | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid tag config JSON ({path.name}): {exc}") from exc
    if isinstance(data, list):
        return _normalize_stack_tags(data, stack=stack)
    raise ValueError(f"tag config {path.name} must be a tag array")


def load_stack_tags(stack: str, root: Path | None = None) -> list[dict[str, Any]]:
    if stack not in ("go2", "g1"):
        raise ValueError("stack must be 'go2' or 'g1'")
    loaded = _read_stack_file(tag_config_path(stack, root), stack=stack)
    if loaded is not None:
        return loaded
    return [dict(t) for t in DEFAULT_TAGS[stack]]


def load_tag_config(root: Path | None = None) -> dict[str, list[dict[str, Any]]]:
    return {
        "go2": load_stack_tags("go2", root),
        "g1": load_stack_tags("g1", root),
    }


def tag_config_api_payload(root: Path | None = None) -> dict[str, Any]:
    """Persisted config plus profile defaults for the launcher UI."""
    cfg = load_tag_config(root)
    defaults = default_tag_config()
    return {
        "go2": cfg["go2"],
        "g1": cfg["g1"],
        "defaults": defaults,
        "default_tag_ids": {
            "go2": sorted(default_tag_ids("go2")),
            "g1": sorted(default_tag_ids("g1")),
        },
    }


def save_stack_tags(
    stack: str,
    tags: list[dict[str, Any]],
    root: Path | None = None,
) -> list[dict[str, Any]]:
    if stack not in ("go2", "g1"):
        raise ValueError("stack must be 'go2' or 'g1'")
    normalized = _normalize_stack_tags(tags, stack=stack)
    path = tag_config_path(stack, root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(normalized, indent=2) + "\n", encoding="utf-8")
    return normalized


def save_tag_config(
    config: dict[str, list[dict[str, Any]]],
    root: Path | None = None,
) -> dict[str, list[dict[str, Any]]]:
    return {
        "go2": save_stack_tags("go2", config.get("go2") or [], root),
        "g1": save_stack_tags("g1", config.get("g1") or [], root),
    }


def restore_tag_config(
    root: Path | None = None,
    *,
    stack: str | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """Reset to robot_profile defaults (one stack or both)."""
    defaults = default_tag_config()
    if stack is None:
        return save_tag_config(defaults, root)
    if stack not in ("go2", "g1"):
        raise ValueError("stack must be 'go2' or 'g1'")
    save_stack_tags(stack, defaults[stack], root)
    return load_tag_config(root)


def mounts_payload_for_env(tags: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Wire format consumed by dimos-ar ``DIMOS_AR_TAG_MOUNTS``."""
    mounts: list[dict[str, Any]] = []
    for tag in tags:
        t = _normalize_tag(tag)
        quat = _yaw_pitch_to_quat(t["yaw_deg"], t["pitch_deg"])
        mounts.append(
            {
                "tag_id": t["tag_id"],
                "size_m": black_size_m_from_print_mm(t["print_size_mm"]),
                "position": [t["forward_m"], t["lateral_m"], t["up_m"]],
                "orientation": [quat[0], quat[1], quat[2], quat[3]],
            }
        )
    return mounts


def mounts_env_json(stack: str, root: Path | None = None) -> str:
    return json.dumps(mounts_payload_for_env(load_stack_tags(stack, root)))
