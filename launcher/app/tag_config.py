"""Go2 AprilTag UI fields converted to DimOS FiducialMarkerMount JSON."""

from __future__ import annotations

import math
from typing import Any

DEFAULT_PRINT_SIZE_MM = 70.0
_BLACK_FRACTION = 8.0 / 10.0

DEFAULT_MOUNT: dict[str, Any] = {
    "marker_id": 0,
    "print_size_mm": DEFAULT_PRINT_SIZE_MM,
    "forward_m": 0.18,
    "lateral_m": 0.0,
    "up_m": 0.06,
    "yaw_deg": -90.0,
    "pitch_deg": -15.0,
}

PRESET_MARKER_IDS: tuple[int, ...] = (0, 1, 2)


def black_size_m_from_print_mm(print_size_mm: float) -> float:
    return (float(print_size_mm) / 1000.0) * _BLACK_FRACTION


def print_mm_from_black_size_m(size_m: float) -> float:
    return (float(size_m) / _BLACK_FRACTION) * 1000.0


def yaw_pitch_to_quat(yaw_deg: float, pitch_deg: float) -> tuple[float, float, float, float]:
    """Match Go2 profile convention: R = RotY(pitch) * RotZ(yaw), scipy (x,y,z,w)."""
    yaw = math.radians(yaw_deg)
    pitch = math.radians(pitch_deg)
    cy, sy = math.cos(yaw * 0.5), math.sin(yaw * 0.5)
    cp, sp = math.cos(pitch * 0.5), math.sin(pitch * 0.5)
    qy = (0.0, sp, 0.0, cp)
    qz = (0.0, 0.0, sy, cy)
    x = qy[3] * qz[0] + qy[0] * qz[3] + qy[1] * qz[2] - qy[2] * qz[1]
    y = qy[3] * qz[1] - qy[0] * qz[2] + qy[1] * qz[3] + qy[2] * qz[0]
    z = qy[3] * qz[2] + qy[0] * qz[1] - qy[1] * qz[0] + qy[2] * qz[3]
    w = qy[3] * qz[3] - qy[0] * qz[0] - qy[1] * qz[1] - qy[2] * qz[2]
    return (x, y, z, w)


def quat_to_yaw_pitch(orientation: list[float] | tuple[float, ...]) -> tuple[float, float]:
    x, y, z, w = (float(v) for v in orientation)
    r10 = 2.0 * (x * y + z * w)
    r11 = 1.0 - 2.0 * (x * x + z * z)
    r02 = 2.0 * (x * z + y * w)
    r22 = 1.0 - 2.0 * (x * x + y * y)
    yaw_deg = math.degrees(math.atan2(r10, r11))
    pitch_deg = math.degrees(math.atan2(r02, r22))
    return (yaw_deg, pitch_deg)


def normalize_ui_mount(raw: dict[str, Any] | None) -> dict[str, Any]:
    source = raw or DEFAULT_MOUNT
    marker_id = source.get("marker_id", source.get("tag_id", DEFAULT_MOUNT["marker_id"]))
    print_size_mm = float(source.get("print_size_mm", DEFAULT_PRINT_SIZE_MM))
    if print_size_mm <= 0:
        raise ValueError("print_size_mm must be positive")
    marker_id_int = int(marker_id)
    if marker_id_int < 0:
        raise ValueError("marker_id must be non-negative")
    return {
        "marker_id": marker_id_int,
        "print_size_mm": print_size_mm,
        "forward_m": float(source.get("forward_m", 0.0)),
        "lateral_m": float(source.get("lateral_m", 0.0)),
        "up_m": float(source.get("up_m", 0.0)),
        "yaw_deg": float(source.get("yaw_deg", 0.0)),
        "pitch_deg": float(source.get("pitch_deg", 0.0)),
    }


def normalize_ui_mounts(raw: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    mounts = [normalize_ui_mount(item) for item in (raw or [DEFAULT_MOUNT])]
    if not mounts:
        mounts = [normalize_ui_mount(DEFAULT_MOUNT)]
    ids = [mount["marker_id"] for mount in mounts]
    if len(ids) != len(set(ids)):
        raise ValueError("fiducial marker IDs must be unique")
    return mounts


def ui_mount_to_wire(raw: dict[str, Any] | None) -> dict[str, Any]:
    mount = normalize_ui_mount(raw)
    quat = yaw_pitch_to_quat(mount["yaw_deg"], mount["pitch_deg"])
    return {
        "marker_id": mount["marker_id"],
        "size_m": black_size_m_from_print_mm(mount["print_size_mm"]),
        "position": [mount["forward_m"], mount["lateral_m"], mount["up_m"]],
        "orientation": [quat[0], quat[1], quat[2], quat[3]],
    }


def wire_to_ui_mount(raw: dict[str, Any] | None) -> dict[str, Any]:
    if not raw:
        return dict(DEFAULT_MOUNT)
    marker_id = raw.get("marker_id", raw.get("tag_id", DEFAULT_MOUNT["marker_id"]))
    position = raw.get("position") or [
        DEFAULT_MOUNT["forward_m"],
        DEFAULT_MOUNT["lateral_m"],
        DEFAULT_MOUNT["up_m"],
    ]
    orientation = raw.get("orientation")
    if orientation:
        yaw_deg, pitch_deg = quat_to_yaw_pitch(orientation)
    else:
        yaw_deg = float(raw.get("yaw_deg", DEFAULT_MOUNT["yaw_deg"]))
        pitch_deg = float(raw.get("pitch_deg", DEFAULT_MOUNT["pitch_deg"]))
    size_m = raw.get("size_m")
    if size_m is not None:
        print_size_mm = print_mm_from_black_size_m(float(size_m))
    else:
        print_size_mm = float(raw.get("print_size_mm", DEFAULT_PRINT_SIZE_MM))
    return normalize_ui_mount(
        {
            "marker_id": marker_id,
            "print_size_mm": print_size_mm,
            "forward_m": float(position[0]),
            "lateral_m": float(position[1]),
            "up_m": float(position[2]),
            "yaw_deg": yaw_deg,
            "pitch_deg": pitch_deg,
        }
    )


def localization_providers(
    *,
    fiducial_marker: bool,
    vps: bool,
    map_code: str | None,
) -> list[dict[str, Any]]:
    providers: list[dict[str, Any]] = []
    if fiducial_marker:
        providers.append({"type": "fiducial_marker"})
    if vps:
        provider: dict[str, Any] = {"type": "vps"}
        code = (map_code or "").strip()
        if code:
            provider["map_code"] = code
        providers.append(provider)
    return providers


def armodule_config_from_ui(
    *,
    fiducial_marker: bool,
    vps: bool,
    map_code: str | None,
    mounts: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    config: dict[str, Any] = {
        "localization": {
            "providers": localization_providers(
                fiducial_marker=fiducial_marker,
                vps=vps,
                map_code=map_code,
            )
        }
    }
    if fiducial_marker:
        config["fiducial_marker_mounts"] = [
            ui_mount_to_wire(mount) for mount in normalize_ui_mounts(mounts)
        ]
    return config


def ui_from_armodule_config(armodule: dict[str, Any] | None) -> dict[str, Any]:
    section = armodule or {}
    providers = (section.get("localization") or {}).get("providers") or []
    fiducial_marker = False
    vps = False
    map_code = ""
    if isinstance(providers, list):
        for provider in providers:
            if not isinstance(provider, dict):
                continue
            kind = provider.get("type")
            if kind == "fiducial_marker":
                fiducial_marker = True
            elif kind == "vps":
                vps = True
                map_code = str(provider.get("map_code") or "")
    mounts_raw = section.get("fiducial_marker_mounts")
    mounts: list[dict[str, Any]] = []
    if isinstance(mounts_raw, list):
        for item in mounts_raw:
            if not isinstance(item, dict):
                raise TypeError("fiducial_marker_mounts items must be objects")
            mounts.append(wire_to_ui_mount(item))
    if not mounts:
        mounts = [normalize_ui_mount(DEFAULT_MOUNT)]
    return {
        "fiducial_marker": fiducial_marker,
        "vps": vps,
        "vps_vendor": "multiset",
        "map_code": map_code,
        "mounts": mounts,
    }
