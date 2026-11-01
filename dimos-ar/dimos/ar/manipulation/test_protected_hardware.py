"""Motor-command boundary tests use fake IO; no buses or motors are opened."""

import time
from types import SimpleNamespace

import pytest

pytest.importorskip("can_motor_control")
from dimos.ar.manipulation.protected_hardware import ProtectedOpenYamAdapter
from dimos.ar.manipulation.protection import MotorProtection
from dimos.hardware.whole_body.openyam_damiao.adapter import OpenYamDamiaoAdapter
from dimos.hardware.whole_body.spec import MotorCommand


def adapter(monkeypatch):
    device = object.__new__(ProtectedOpenYamAdapter)
    device.safety_limits = {name: [-1.0, 1.0] for name in device.kinematic_joint_names}
    device.last_write = None
    device.last_diagnostic_at = 0.0
    device.velocity = {}
    device.guard = MotorProtection()
    device.commands = {}
    device.latest = [SimpleNamespace(q=0.0) for _ in range(7)]
    device.latest_at = time.monotonic()
    device.last_motor_commands = None
    device.stop_latched = False
    device.stop_commands = None
    sent = []
    monkeypatch.setattr(
        OpenYamDamiaoAdapter,
        "write_motor_commands",
        lambda self, commands: sent.append(commands) or True,
    )
    return device, sent


def test_motor_boundary_bounds_outward_commands_without_connecting(monkeypatch):
    device, sent = adapter(monkeypatch)
    now = [0.0]
    monkeypatch.setattr("dimos.ar.manipulation.protected_hardware.time.monotonic", lambda: now[0])
    for _ in range(300):
        assert device.write_motor_commands([MotorCommand(q=10.0) for _ in range(7)])
        for i, command in enumerate(sent[-1][:6]):
            assert -1 <= command.q <= 1
            assert abs(command.q - device.latest[i].q) <= 0.010001
            device.latest[i].q = command.q
        now[0] += 0.01
    assert sent[-1][0].q == 1


def test_pause_holds_measurements_and_fault_rejects_writes(monkeypatch):
    device, sent = adapter(monkeypatch)
    device.guard.state = "paused"
    assert device.write_motor_commands([MotorCommand(q=0.5) for _ in range(7)])
    assert all(c.q == 0 for c in sent[-1])
    device.guard.state = "fault"
    assert not device.write_motor_commands([MotorCommand(q=0.5) for _ in range(7)])
    assert len(sent) == 1


def test_emergency_hold_does_not_push_a_valid_pose_into_the_margin(monkeypatch):
    device, sent = adapter(monkeypatch)
    device.safety_limits = {name: [0.05236, 1.0] for name in device.kinematic_joint_names}
    for state in device.latest:
        state.q = 0.0078
    device.last_motor_commands = [MotorCommand(q=0.5) for _ in range(7)]
    assert device.hold_current()
    assert all(command.q == 0.0078 for command in sent[-1])
    assert device.write_motor_commands([MotorCommand(q=0.8) for _ in range(7)])
    assert all(command.q == 0.0078 for command in sent[-1])
    assert device.stop_latched


def test_stop_refreshes_stale_feedback_before_holding(monkeypatch):
    device, sent = adapter(monkeypatch)
    device.latest_at = time.monotonic() - 1
    fresh = [SimpleNamespace(q=0.2) for _ in range(7)]
    monkeypatch.setattr(OpenYamDamiaoAdapter, "read_motor_states", lambda self: fresh)
    assert device.hold_current()
    assert all(command.q == 0.2 for command in sent[-1])
    device.release_hold()
    assert not device.stop_latched
    assert device.stop_commands is None
    assert all(value == 0.2 for value in device.commands.values())


def test_loaded_arm_can_overcome_five_degree_tracking_offset(monkeypatch):
    import math

    from dimos.ar.manipulation.limits import COMMAND_TRACKING_LEAD_RAD

    device, sent = adapter(monkeypatch)
    now = [0.0]
    moving = False
    monkeypatch.setattr("dimos.ar.manipulation.protected_hardware.time.monotonic", lambda: now[0])
    for _ in range(500):
        assert device.write_motor_commands([MotorCommand(q=0.6) for _ in range(7)])
        command = sent[-1][0].q
        error = command - device.latest[0].q
        assert abs(error) <= COMMAND_TRACKING_LEAD_RAD + 1e-9
        moving |= error > math.radians(6)
        if moving:
            for state in device.latest:
                state.q += max(-0.01, min(0.01, command - state.q))
        now[0] += 0.01
    assert moving
    assert abs(device.latest[0].q - 0.6) < 0.001


def test_can_transport_failure_is_a_connection_fault_and_blocks_writes(monkeypatch):
    device, sent = adapter(monkeypatch)

    def disconnected(_):
        raise OSError("send buffer full after retries")

    monkeypatch.setattr(OpenYamDamiaoAdapter, "read_motor_states", disconnected)
    with pytest.raises(OSError):
        device.read_motor_states()
    assert device.guard.state == "fault"
    assert "CAN connection error" in device.guard.reason
    assert not device.write_motor_commands([MotorCommand(q=0.5) for _ in range(7)])
    assert not sent
