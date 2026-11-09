import json

from robot_profiles import RobotProfiles


def test_generated_names_and_duplicate_suffixes_preserve_custom_renames(tmp_path):
    profiles = RobotProfiles(tmp_path / "profiles.json")
    assert profiles.all()[0]["name"] == "UnitreeGo2_1"
    assert profiles.create("unitree_go2")["name"] == "UnitreeGo2_2"
    arm = profiles.create("openyam")
    assert arm["name"] == "OpenYAM_1"
    duplicate = profiles.create("openyam", source_id=arm["id"])
    assert duplicate["name"] == "OpenYAM_2"
    profiles.update(arm["id"], name="Desk")
    assert profiles.get(arm["id"])["name"] == "Desk"
    assert profiles.create("openyam", source_id=arm["id"])["name"] == "Desk_1"


def test_saved_profile_names_and_calibration_are_preserved(tmp_path):
    path = tmp_path / "profiles.json"
    original = [{"id": "arm", "robot": "openyam", "name": "OpenYAM", "armodule": {"calibration": 42}},
                {"id": "custom", "robot": "openyam", "name": "My arm", "armodule": {}}]
    path.write_text(json.dumps(original))
    profiles = RobotProfiles(path)
    assert profiles.get("arm")["name"] == "OpenYAM"
    assert profiles.get("arm")["armodule"] == {"calibration": 42}
    assert profiles.get("custom")["name"] == "My arm"
    profiles.update("arm", name="OpenYAM")
    assert profiles.get("arm")["name"] == "OpenYAM"
