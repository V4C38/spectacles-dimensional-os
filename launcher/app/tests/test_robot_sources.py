"""Source resolution and CLI composition never instantiate robot hardware."""

import os
import subprocess
import sys
from pathlib import Path

import pytest

from robot_sources import (
    ResolvedRobotSource,
    SourceBody,
    SourceSelectionRequired,
    resolve_robot_source,
)


@pytest.mark.parametrize("mode", ["auto", "device"])
def test_missing_devices_require_an_explicit_choice(mode):
    with pytest.raises(SourceSelectionRequired) as error:
        resolve_robot_source("unitree_go2", SourceBody(mode=mode, device_id="missing"))
    assert error.value.suggest_simulated is (mode == "auto")


def test_selected_device_resolves_to_its_native_transport():
    devices = [{"id": "arm", "address": "can2"}]
    source = resolve_robot_source("openyam", SourceBody(mode="device", device_id="arm"), devices)
    assert source.can_port == "can2"
    assert source.robot_ip is None
    assert not source.simulation


def test_conflicting_simulation_and_manual_source_fails():
    with pytest.raises(ValueError, match="Conflicting"):
        resolve_robot_source("unitree_go2", SourceBody(mode="manual", address="192.168.1.4"), simulation=True)


def test_arm_simulator_ignores_old_recording_selection():
    source = resolve_robot_source("openyam", SourceBody(mode="simulated", playback="simulator", replay="/old.db"))
    assert source.simulation
    assert source.replay is None
    assert source.cli_arguments("openyam_ar_planner") == ("--simulation=mock", "run", "dimos-ar.openyam-ar-planner")


def test_recording_selection_resolves_without_modifying_request(tmp_path):
    recording = tmp_path / "recording.db"
    recording.touch()
    request = SourceBody(mode="simulated", playback="recording", replay=str(recording))
    source = resolve_robot_source("openyam", request)
    assert source.replay == str(recording.resolve())
    assert source.cli_arguments("openyam_ar_planner") == ("run", "dimos-ar.openyam-ar-replay")
    assert request.streams == {}


@pytest.mark.parametrize("blueprint,source,expected", [
    ("unitree_go2_ar", ResolvedRobotSource(robot_ip="192.168.1.4"), ("run", "dimos-ar.unitree-go2-ar")),
    ("unitree_go2_ar_agentic", ResolvedRobotSource(), ("run", "dimos-ar.unitree-go2-ar-agentic")),
    ("unitree_go2_ar_agentic", ResolvedRobotSource(robot_ip="simulated"), ("run", "dimos-ar.unitree-go2-ar-replay")),
    ("openyam_ar_planner", ResolvedRobotSource(can_port="can0"), ("run", "dimos-ar.openyam-ar-planner")),
])
def test_runtime_arguments_preserve_supported_cli_modes(blueprint, source, expected):
    assert source.cli_arguments(blueprint) == expected


def test_start_script_uses_the_same_resolution_as_the_api(monkeypatch):
    monkeypatch.delenv("REPLAY_DB", raising=False)
    monkeypatch.setenv("DIMOS_AR_SIMULATION", "1")
    script = Path(__file__).parents[1] / "robot_sources.py"
    completed = subprocess.run([sys.executable, str(script), "openyam_ar_planner", "0"],
                               check=True, text=True, capture_output=True, env=os.environ.copy())
    source = resolve_robot_source("openyam", SourceBody(mode="simulated"))
    assert completed.stdout.splitlines() == list(source.cli_arguments("openyam_ar_planner"))
