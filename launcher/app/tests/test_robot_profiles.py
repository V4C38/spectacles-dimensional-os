import json

import pytest

from robot_profiles import RobotProfiles


def test_profile_identity_duplication_and_isolated_snapshot(tmp_path):
    saved = {
        "fiducial_marker_mounts": [{"marker_id": 7, "size_m": 0.056, "position": [0, 0, 0], "orientation": [0, 0, 0, 1]}],
        "localization": {"providers": []},
    }
    profiles = RobotProfiles(tmp_path / "profiles.json")
    original = profiles.all()[0]
    profiles.path.write_text(json.dumps([{**original, "armodule": saved}]))
    original = profiles.all()[0]
    assert original["armodule"] == saved
    renamed = profiles.update(original["id"], name="UnitreeGo2_Example1")
    assert renamed["id"] == original["id"]
    duplicate = profiles.create("unitree_go2", "UnitreeGo2_2", original["id"])
    assert duplicate["id"] != original["id"]
    snapshot = profiles.snapshot(original["id"], "unitree_go2_ar_agentic")
    snapshot["localization"]["providers"].append("test")
    assert profiles.get(original["id"])["armodule"] == saved
    with pytest.raises(ValueError, match="incompatible"):
        profiles.snapshot(original["id"], "openyam_ar_planner")
    profiles.delete(duplicate["id"])
    assert len(profiles.all()) == 1


def test_new_arm_never_inherits_go2_calibration(tmp_path):
    profiles = RobotProfiles(tmp_path / "profiles.json")
    arm = profiles.create("openyam", "OpenYAM_2")
    mount = arm["armodule"]["fiducial_marker_mounts"][0]
    assert mount == {
        "marker_id": 0,
        "size_m": 0.056,
        "position": [0.0, -0.06, 0.0],
        "orientation": [0.0, 0.0, 0.0, 1.0],
    }
    assert arm["armodule"]["localization"]["providers"] == [{"type": "fiducial_marker"}]
    from tag_config import armodule_config_from_ui, ui_from_armodule_config

    ui = ui_from_armodule_config(arm["armodule"])
    assert ui["mounts"][0]["print_size_mm"] == pytest.approx(70)
    restored = armodule_config_from_ui(
        fiducial_marker=ui["fiducial_marker"],
        vps=False,
        map_code=None,
        mounts=ui["mounts"],
    )["fiducial_marker_mounts"][0]
    assert restored["position"] == mount["position"]
    assert restored["orientation"] == mount["orientation"]
    assert restored["size_m"] == pytest.approx(mount["size_m"])


def test_optional_planning_install_is_explicit(tmp_path):
    from armodule import ProcessManager

    manager = ProcessManager(root=tmp_path)
    assert "--manipulation" not in manager.build_setup_argv()
    assert "--manipulation" in manager.build_setup_argv(manipulation=True)


def test_default_profile_ignores_global_config(tmp_path):
    from dimos_config import dimos_config_path

    target = dimos_config_path()
    target.parent.mkdir(parents=True)
    target.write_text(json.dumps({"armodule": {"stationary_base": {"position": [1, 2, 3]}}}))
    profiles = RobotProfiles(tmp_path / "profiles.json")
    assert profiles.all()[0]["armodule"] == {}
    assert "stationary_base" in json.loads(target.read_text())["armodule"]


@pytest.mark.asyncio
@pytest.mark.parametrize("client", ["specs", "webxr"])
async def test_openyam_start_accepts_either_client_with_explicit_profile(
    monkeypatch, client
):
    from unittest.mock import AsyncMock

    import app

    start = AsyncMock()
    monkeypatch.setattr(app.manager, "start_armodule", start)
    monkeypatch.setattr(app.manager, "snapshot", dict)
    monkeypatch.setattr(
        app.robot_profiles,
        "snapshot",
        lambda profile_id, blueprint: {"profile": profile_id},
    )
    await app.api_armodule_start(
        app.StartBody(blueprint="openyam_ar_planner", client=client, profile_id="arm", source=app.SourceBody(mode="simulated"))
    )
    assert start.await_args.kwargs["client"] == client


@pytest.mark.parametrize("blueprint", ["unitree_go2_ar", "openyam_ar_planner"])
def test_start_requires_current_source_and_profile(blueprint):
    from pydantic import ValidationError

    import app

    with pytest.raises(ValidationError):
        app.StartBody(blueprint=blueprint, source=app.SourceBody(mode="simulated"))
    with pytest.raises(ValidationError):
        app.StartBody(blueprint=blueprint, profile_id="arm", robot_ip="fake")


def test_profile_settings_preserve_policy_and_unrelated_config(tmp_path):
    saved = {
        "stationary_base": {"position": [0, 0, 0]},
        "localization": {
            "providers": [{"type": "vps", "map_code": "old"}],
            "travel_threshold_m": 3,
            "heading_threshold_deg": 60,
            "marker_preference_s": 4,
            "headset_travel_threshold_m": 12,
            "episode_timeout_s": 21,
        },
    }
    profiles = RobotProfiles(tmp_path / "profiles.json")
    profile = profiles.all()[0]
    profiles.path.write_text(json.dumps([{**profile, "armodule": saved}]))
    updated = profiles.update(
        profile["id"],
        settings={
            "fiducial_marker": False,
            "vps": True,
            "map_code": "new",
            "travel_threshold_m": 5,
        },
    )["armodule"]
    assert updated["stationary_base"] == saved["stationary_base"]
    assert updated["localization"] == {
        **saved["localization"],
        "providers": [{"type": "vps", "map_code": "new"}],
        "travel_threshold_m": 5,
    }
