from copy import deepcopy

import pytest

import robot_profiles
from robot_profiles import RobotProfiles


def test_migration_identity_duplication_and_isolated_snapshot(tmp_path, monkeypatch):
    legacy = {
        "fiducial_marker_mounts": [{"marker_id": 7}],
        "localization": {"providers": []},
    }
    monkeypatch.setattr(
        robot_profiles, "read_armodule_config", lambda: deepcopy(legacy)
    )
    profiles = RobotProfiles(tmp_path / "profiles.json")
    original = profiles.all()[0]
    assert original["armodule"] == legacy
    renamed = profiles.update(original["id"], name="UnitreeGo2_Example1")
    assert renamed["id"] == original["id"]
    duplicate = profiles.create("unitree_go2", "UnitreeGo2_2", original["id"])
    assert duplicate["id"] != original["id"]
    snapshot = profiles.snapshot(original["id"], "unitree_go2_ar_agentic")
    snapshot["localization"]["providers"].append("test")
    assert profiles.get(original["id"])["armodule"] == legacy
    with pytest.raises(ValueError, match="incompatible"):
        profiles.snapshot(original["id"], "openyam_ar_planner")
    profiles.delete(duplicate["id"])
    assert len(profiles.all()) == 1


def test_new_arm_never_inherits_go2_calibration(tmp_path, monkeypatch):
    monkeypatch.setattr(robot_profiles, "read_armodule_config", dict)
    profiles = RobotProfiles(tmp_path / "profiles.json")
    arm = profiles.create("openyam", "OpenYAM_2")
    mount = arm["armodule"]["fiducial_marker_mounts"][0]
    assert mount == {
        "marker_id": 0,
        "size_m": 0.056,
        "position": [0.0, -0.12, 0.0],
        "orientation": [0.0, 0.0, 0.0, 1.0],
    }
    assert arm["armodule"]["localization"]["providers"] == [{"type": "fiducial_marker"}]
    from tag_config import armodule_config_from_ui, ui_from_armodule_config

    ui = ui_from_armodule_config(arm["armodule"])
    assert ui["mounts"][0]["print_size_mm"] == pytest.approx(70)
    restored = armodule_config_from_ui(
        fiducial_marker=ui["fiducial_marker"], vps=False,
        map_code=None, mounts=ui["mounts"],
    )["fiducial_marker_mounts"][0]
    assert restored["position"] == mount["position"]
    assert restored["orientation"] == mount["orientation"]
    assert restored["size_m"] == pytest.approx(mount["size_m"])


def test_optional_planning_install_is_explicit(tmp_path):
    from armodule import ProcessManager

    manager = ProcessManager(root=tmp_path)
    assert "--manipulation" not in manager.build_setup_argv()
    assert "--manipulation" in manager.build_setup_argv(manipulation=True)


def test_selected_profile_is_the_localization_source(tmp_path, monkeypatch):
    import armodule
    from armodule import ProcessManager

    monkeypatch.setattr(armodule, "read_armodule_config", lambda: {"localization": {"providers": [{"type": "vps", "map_code": "legacy"}]}})
    manager = ProcessManager(root=tmp_path)
    manager._require_vps_credentials({"localization": {"providers": []}})
