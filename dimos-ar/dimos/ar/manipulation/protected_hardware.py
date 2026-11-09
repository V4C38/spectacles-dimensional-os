from __future__ import annotations

import math
import time
from typing import Any

from dimos.ar.manipulation.limits import COMMAND_TRACKING_LEAD_RAD
from dimos.ar.manipulation.protection import MotorProtection, ProtectionPolicy
from dimos.hardware.whole_body.openyam_damiao.adapter import OpenYamDamiaoAdapter
from dimos.utils.logging_config import setup_logger

logger = setup_logger()


class ProtectedOpenYamAdapter(OpenYamDamiaoAdapter):  # type: ignore[misc]
    def __init__(
        self,
        *,
        safety_limits: dict[str, list[float]],
        protection_policy: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        self.safety_limits = safety_limits
        self.last_write: float | None = None
        self.last_diagnostic_at = 0.0
        self.velocity: dict[str, float] = {}
        self.guard = MotorProtection(ProtectionPolicy(**(protection_policy or {})))
        self.commands: dict[str, float] = {}
        self.latest: Any = None
        self.latest_at = 0.0
        self.last_motor_commands: Any = None
        self.stop_latched = False
        self.stop_commands: Any = None
        super().__init__(**kwargs)

    def read_motor_states(self) -> Any:
        try:
            states = super().read_motor_states()
        except Exception as exc:
            detail = str(exc)
            self.guard.state = "fault"
            self.guard.reason = (
                f"CAN connection error: {detail}"
                if any(
                    word in detail.lower() for word in ("send buffer", "bus-off", "network is down")
                )
                else detail
            )
            raise
        self.latest = states
        self.latest_at = time.monotonic()
        if self._active:
            rows = []
            for i, name in enumerate(self.kinematic_joint_names):
                motor = self._arms["arm"][name]
                rows.append(
                    {
                        "joint": name,
                        "position": states[i].q,
                        "velocity": states[i].dq,
                        "effort": states[i].tau,
                        "command": self.commands.get(name, states[i].q),
                        "temperature_mos": motor.temperature_mos,
                        "temperature_rotor": motor.temperature_rotor,
                        "fault": motor.fault,
                        "enabled": motor.is_enabled,
                    }
                )
            self.guard.observe(rows, time.monotonic())
            if self.guard.state == "paused" and not self.stop_latched:
                self.hold_current()
            if self.stop_latched:
                from dimos.hardware.whole_body.spec import MotorCommand

                hold = self.last_motor_commands
                if hold is None:
                    hold = [
                        MotorCommand(
                            q=state.q,
                            kp=80.0 if i < 3 else 10.0 if i < 6 else 0.0,
                            kd=5.0 if i < 3 else 1.5 if i < 6 else 0.0,
                        )
                        for i, state in enumerate(states)
                    ]
                self.write_motor_commands(hold)
        return states

    def hold_current(self) -> bool:
        from dataclasses import replace

        from dimos.hardware.whole_body.spec import MotorCommand

        self.stop_latched = True
        if self.guard.state == "fault":
            return False
        if self.latest is None or time.monotonic() - self.latest_at > 0.1:
            # This runs under the coordinator's hardware lock. Read fresh feedback
            # directly so a delayed RPC never sends the arm to an old pose.
            self.latest = super().read_motor_states()
            self.latest_at = time.monotonic()
        if any(not math.isfinite(state.q) for state in self.latest):
            return False
        base = self.last_motor_commands or [
            MotorCommand(
                q=s.q,
                kp=80 if i < 3 else 10 if i < 6 else 0,
                kd=5 if i < 3 else 1.5 if i < 6 else 0,
            )
            for i, s in enumerate(self.latest)
        ]
        self.stop_commands = [replace(c, q=self.latest[i].q, dq=0.0) for i, c in enumerate(base)]
        self.commands = {
            name: self.stop_commands[i].q for i, name in enumerate(self.kinematic_joint_names)
        }
        self.velocity.clear()
        return bool(super().write_motor_commands(self.stop_commands))

    def release_hold(self) -> None:
        self.stop_latched = False
        self.stop_commands = None
        self.commands = (
            {n: self.latest[i].q for i, n in enumerate(self.kinematic_joint_names)}
            if self.latest is not None
            else {}
        )
        self.velocity.clear()
        self.last_write = None

    def write_motor_commands(self, commands: Any) -> bool:
        if self.stop_latched:
            if self.guard.state == "fault":
                return False
            if self.stop_commands is None:
                return self.hold_current()
            # A stop is a measured hold, never a new soft-limit or parking target.
            return bool(super().write_motor_commands(self.stop_commands))
        if self.guard.state == "fault":
            return False
        if self.guard.state == "paused":
            if self.latest is None:
                return False
            from dataclasses import replace

            commands = [replace(c, q=self.latest[i].q, dq=0.0) for i, c in enumerate(commands)]
        from dataclasses import replace

        now = time.monotonic()
        dt = min(0.02, max(0.001, now - self.last_write)) if self.last_write is not None else 0.01
        self.last_write = now
        bounded = list(commands)
        diagnostics = []
        for i, name in enumerate(self.kinematic_joint_names):
            command = commands[i]
            if not math.isfinite(command.q):
                self.guard.state, self.guard.reason = "fault", "Non-finite motor command"
                return False
            lower, upper = self.safety_limits[name]
            measured = self.latest[i].q if self.latest is not None else command.q
            previous = self.commands.get(name, measured)
            target = max(lower, min(upper, command.q))
            scale = self.guard.scale
            if scale == 0:
                bounded[i] = replace(command, q=measured, dq=0.0)
                self.velocity[name] = 0
                continue
            acceleration = 2 * scale
            remaining = target - previous
            desired = math.copysign(
                min(scale, math.sqrt(2 * acceleration * abs(remaining)), abs(remaining) / dt),
                remaining,
            )
            old = self.velocity.get(name, 0.0)
            velocity = max(old - acceleration * dt, min(old + acceleration * dt, desired))
            value = previous + velocity * dt
            value = (
                max(lower, min(upper, value))
                if lower <= measured <= upper
                else max(min(previous, lower), min(max(previous, upper), value))
            )
            before_tracking = value
            value = max(
                measured - COMMAND_TRACKING_LEAD_RAD,
                min(measured + COMMAND_TRACKING_LEAD_RAD, value),
            )
            reasons = []
            if abs(target - command.q) > 1e-6:
                reasons.append("position_limit")
            if abs(before_tracking - target) > 1e-6:
                reasons.append("rate_limit")
            if abs(value - before_tracking) > 1e-6:
                reasons.append("tracking_envelope")
            if scale < 1:
                reasons.append("derated")
            diagnostics.append(
                {
                    "joint": name,
                    "requested": command.q,
                    "issued": value,
                    "measured": measured,
                    "limits": [lower, upper],
                    "reasons": reasons,
                }
            )
            bounded[i] = replace(command, q=value, dq=0.0)
            self.velocity[name] = (value - previous) / dt
        if now - self.last_diagnostic_at >= 1 and any(row["reasons"] for row in diagnostics):
            self.last_diagnostic_at = now
            logger.debug("Arm command envelope", motors=diagnostics)
        commands = bounded
        self.last_motor_commands = commands
        self.commands = {name: commands[i].q for i, name in enumerate(self.kinematic_joint_names)}
        return bool(super().write_motor_commands(commands))
