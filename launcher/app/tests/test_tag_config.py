"""AprilTag launcher config persistence and wire payload."""

from __future__ import annotations

import json
from pathlib import Path

from tag_config import (
    DEFAULT_TAGS,
    _yaw_pitch_to_quat,
    load_tag_config,
    mounts_env_json,
    mounts_payload_for_env,
    restore_tag_config,
    save_tag_config,
    tag_config_api_payload,
    tag_config_path,
)


def test_defaults_when_missing(tmp_path: Path) -> None:
    cfg = load_tag_config(tmp_path)
    assert cfg["go2"][0]["forward_m"] == DEFAULT_TAGS["go2"][0]["forward_m"]
    assert cfg["g1"][0]["up_m"] == DEFAULT_TAGS["g1"][0]["up_m"]


def test_save_and_load_roundtrip(tmp_path: Path) -> None:
    custom = {
        "go2": [
            {
                "tag_id": 2,
                "print_size_mm": 80,
                "forward_m": 0.2,
                "lateral_m": 0.01,
                "up_m": 0.05,
                "yaw_deg": -90,
                "pitch_deg": -10,
            }
        ],
        "g1": DEFAULT_TAGS["g1"],
    }
    saved = save_tag_config(custom, tmp_path)
    by_id = {t["tag_id"]: t for t in saved["go2"]}
    assert 0 in by_id  # profile default retained
    assert by_id[2]["print_size_mm"] == 80
    assert by_id[2]["forward_m"] == 0.2
    loaded = load_tag_config(tmp_path)
    assert {t["tag_id"]: t for t in loaded["go2"]}[2]["forward_m"] == 0.2
    assert tag_config_path("go2", tmp_path).is_file()
    assert tag_config_path("g1", tmp_path).is_file()
    go2_raw = json.loads(tag_config_path("go2", tmp_path).read_text(encoding="utf-8"))
    assert isinstance(go2_raw, list)
    assert {t["tag_id"]: t for t in go2_raw}[2]["forward_m"] == 0.2


def test_api_payload_includes_defaults(tmp_path: Path) -> None:
    payload = tag_config_api_payload(tmp_path)
    assert payload["default_tag_ids"]["go2"] == [0]
    assert payload["default_tag_ids"]["g1"] == [0, 1]
    assert payload["defaults"]["go2"][0]["forward_m"] == DEFAULT_TAGS["go2"][0]["forward_m"]
    assert payload["defaults"]["g1"][0]["print_size_mm"] == 120.0
    assert len(payload["defaults"]["g1"]) == 2
    assert payload["go2"][0]["tag_id"] == 0


def test_mounts_env_json_includes_orientation(tmp_path: Path) -> None:
    save_tag_config(DEFAULT_TAGS, tmp_path)
    raw = mounts_env_json("go2", tmp_path)
    data = json.loads(raw)
    assert data[0]["tag_id"] == 0
    assert data[0]["position"] == [0.18, 0.0, 0.06]
    assert abs(data[0]["size_m"] - 0.056) < 1e-9
    assert len(data[0]["orientation"]) == 4


def test_print_size_scales_black_square(tmp_path: Path) -> None:
    custom = {
        "go2": [{**DEFAULT_TAGS["go2"][0], "print_size_mm": 100}],
        "g1": DEFAULT_TAGS["g1"],
    }
    save_tag_config(custom, tmp_path)
    data = json.loads(mounts_env_json("go2", tmp_path))
    assert abs(data[0]["size_m"] - 0.08) < 1e-9


def test_save_reinserts_missing_default_tag(tmp_path: Path) -> None:
    saved = save_tag_config(
        {
            "go2": [
                {
                    "tag_id": 2,
                    "print_size_mm": 70,
                    "forward_m": 0.0,
                    "lateral_m": 0.0,
                    "up_m": 0.0,
                    "yaw_deg": 0,
                    "pitch_deg": 0,
                }
            ],
            "g1": DEFAULT_TAGS["g1"],
        },
        tmp_path,
    )
    ids = {t["tag_id"] for t in saved["go2"]}
    assert 0 in ids
    assert 2 in ids


def test_restore_tag_config_resets_stack(tmp_path: Path) -> None:
    save_tag_config(
        {
            "go2": [
                {
                    "tag_id": 0,
                    "print_size_mm": 70,
                    "forward_m": 0.0,
                    "lateral_m": 0.0,
                    "up_m": 0.0,
                    "yaw_deg": 0,
                    "pitch_deg": 0,
                }
            ],
            "g1": [{**DEFAULT_TAGS["g1"][0], "up_m": 0.77}],
        },
        tmp_path,
    )
    restored = restore_tag_config(tmp_path, stack="go2")
    assert restored["go2"][0]["forward_m"] == DEFAULT_TAGS["go2"][0]["forward_m"]
    assert restored["go2"][0]["yaw_deg"] == DEFAULT_TAGS["go2"][0]["yaw_deg"]
    g1_by_id = {t["tag_id"]: t for t in restored["g1"]}
    assert g1_by_id[0]["up_m"] == 0.77
    assert 1 in g1_by_id


def test_yaw_pitch_to_quat_go2_convention() -> None:
    # Matches scipy RotY(pitch) * RotZ(yaw) for Go2 defaults.
    quat = _yaw_pitch_to_quat(-90.0, -15.0)
    assert abs(quat[2] + 0.7010573846499779) < 1e-9
    assert abs(quat[3] - 0.7010573846499779) < 1e-9


def test_g1_default_pitch_minus_90() -> None:
    payload = mounts_payload_for_env(DEFAULT_TAGS["g1"])[0]
    # Pure -90° about Y → (0, -√2/2, 0, √2/2)
    assert abs(payload["orientation"][1] + 0.7071067811865475) < 1e-9
    assert abs(payload["orientation"][3] - 0.7071067811865476) < 1e-9


def test_g1_defaults_are_two_120mm_chest_back_tags() -> None:
    assert len(DEFAULT_TAGS["g1"]) == 2
    by_id = {t["tag_id"]: t for t in DEFAULT_TAGS["g1"]}
    assert by_id[0]["print_size_mm"] == 120.0
    assert by_id[0]["forward_m"] == 0.12
    assert by_id[1]["print_size_mm"] == 120.0
    assert by_id[1]["forward_m"] == -0.12
    mounts = mounts_payload_for_env(DEFAULT_TAGS["g1"])
    assert abs(mounts[0]["size_m"] - 0.096) < 1e-9
    assert abs(mounts[1]["size_m"] - 0.096) < 1e-9
