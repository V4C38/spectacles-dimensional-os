"""AprilTag UI fields convert to DimOS FiducialMarkerMount JSON."""

from __future__ import annotations

import pytest

from tag_config import (
    DEFAULT_MOUNT,
    armodule_config_from_ui,
    black_size_m_from_print_mm,
    normalize_ui_mount,
    normalize_ui_mounts,
    ui_from_armodule_config,
    ui_mount_to_wire,
    wire_to_ui_mount,
    yaw_pitch_to_quat,
)


def test_default_mount_matches_go2_profile() -> None:
    wire = ui_mount_to_wire(DEFAULT_MOUNT)
    assert wire["marker_id"] == 0
    assert wire["position"] == [0.18, 0.0, 0.06]
    assert abs(wire["size_m"] - 0.056) < 1e-9
    quat = yaw_pitch_to_quat(-90.0, -15.0)
    assert abs(wire["orientation"][2] - quat[2]) < 1e-9
    assert "tag_id" not in wire


def test_accepts_leftover_tag_id_on_read() -> None:
    mount = normalize_ui_mount({"tag_id": 0, "print_size_mm": 70, "forward_m": 0.18})
    assert mount["marker_id"] == 0
    assert "tag_id" not in mount


def test_print_size_scales_black_square() -> None:
    assert abs(black_size_m_from_print_mm(100) - 0.08) < 1e-9


def test_yaw_pitch_to_quat_go2_convention() -> None:
    quat = yaw_pitch_to_quat(-90.0, -15.0)
    assert abs(quat[2] + 0.7010573846499779) < 1e-9
    assert abs(quat[3] - 0.7010573846499779) < 1e-9


def test_wire_roundtrip_preserves_pose() -> None:
    wire = ui_mount_to_wire(DEFAULT_MOUNT)
    ui = wire_to_ui_mount(wire)
    assert ui["marker_id"] == 0
    assert abs(ui["print_size_mm"] - 70.0) < 1e-6
    assert abs(ui["forward_m"] - 0.18) < 1e-9
    assert abs(ui["yaw_deg"] - (-90.0)) < 1e-4
    assert abs(ui["pitch_deg"] - (-15.0)) < 1e-4


def test_armodule_config_omits_mounts_when_apriltag_off() -> None:
    config = armodule_config_from_ui(
        fiducial_marker=False,
        vps=True,
        map_code="map-1",
        mounts=[DEFAULT_MOUNT],
    )
    assert config["localization"]["providers"] == [{"type": "vps", "map_code": "map-1"}]
    assert "fiducial_marker_mounts" not in config


def test_armodule_config_omits_vps_when_off() -> None:
    config = armodule_config_from_ui(
        fiducial_marker=True,
        vps=False,
        map_code="map-1",
        mounts=[DEFAULT_MOUNT],
    )
    assert config["localization"]["providers"] == [{"type": "fiducial_marker"}]
    assert config["fiducial_marker_mounts"][0]["marker_id"] == 0


def test_ui_from_armodule_config_reads_providers() -> None:
    ui = ui_from_armodule_config(
        {
            "localization": {
                "providers": [
                    {"type": "fiducial_marker"},
                    {"type": "vps", "map_code": "abc"},
                ]
            },
            "fiducial_marker_mounts": [ui_mount_to_wire(DEFAULT_MOUNT)],
        }
    )
    assert ui["fiducial_marker"] is True
    assert ui["vps"] is True
    assert ui["map_code"] == "abc"
    assert ui["mounts"][0]["marker_id"] == 0


def test_armodule_config_writes_multiple_mounts() -> None:
    second = dict(DEFAULT_MOUNT)
    second["marker_id"] = 2
    second["forward_m"] = 0.10
    config = armodule_config_from_ui(
        fiducial_marker=True,
        vps=False,
        map_code=None,
        mounts=[DEFAULT_MOUNT, second],
    )
    mounts = config["fiducial_marker_mounts"]
    assert [item["marker_id"] for item in mounts] == [0, 2]
    assert mounts[1]["position"][0] == 0.10


def test_normalize_ui_mounts_rejects_duplicate_ids() -> None:
    with pytest.raises(ValueError, match="unique"):
        normalize_ui_mounts([DEFAULT_MOUNT, dict(DEFAULT_MOUNT)])


def test_ui_from_armodule_config_reads_all_mounts() -> None:
    second = dict(DEFAULT_MOUNT)
    second["marker_id"] = 1
    ui = ui_from_armodule_config(
        {
            "localization": {"providers": [{"type": "fiducial_marker"}]},
            "fiducial_marker_mounts": [
                ui_mount_to_wire(DEFAULT_MOUNT),
                ui_mount_to_wire(second),
            ],
        }
    )
    assert [mount["marker_id"] for mount in ui["mounts"]] == [0, 1]
