from dataclasses import dataclass
import time
from typing import Any, Literal

from dimos.ar.manipulation.ports import ManipulationBackend


@dataclass
class ManipulationOperation:
    plan: dict[str, Any] | None = None
    id: str | None = None
    kind: Literal["executing", "resetting", "parking"] | None = None
    final_gripper: tuple[str, float, dict[str, float]] | None = None
    gripper_completion_at: float | None = None
    gripper_error: str | None = None

    def clear(self) -> None:
        self.plan = None
        self.id = None
        self.kind = None
        self.final_gripper = None
        self.gripper_completion_at = None

    def advance(
        self, backend: ManipulationBackend, *, stopped: bool, feedback_max_age_s: float
    ) -> bool:
        if self.id is None or self.kind in {"resetting", "parking"}:
            return False
        state = backend.get_state()
        if state.execution_status.name in {"ACCEPTED", "EXECUTING"}:
            return False
        deferred = self.final_gripper
        waiting_for_endpoint = False
        if deferred and state.execution_status.name == "COMPLETED" and not stopped:
            group, value, endpoint = deferred
            now = time.monotonic()
            completion_at = self.gripper_completion_at
            if completion_at is None:
                completion_at = now
                self.gripper_completion_at = completion_at
            waiting_for_endpoint = now - completion_at < 2.0
            observed = state.groups.get(group)
            if (
                observed
                and observed.joints
                and 0 <= time.time() - observed.joints.ts <= feedback_max_age_s
            ):
                actual = dict(zip(observed.joints.name, observed.joints.position, strict=True))
                if all(abs(actual.get(j, float("inf")) - q) <= 0.02 for j, q in endpoint.items()):
                    command = backend.set_gripper_position(value, planning_group=group)
                    if command.status.name != "SUCCEEDED":
                        self.gripper_error = command.message
                    self.final_gripper = None
                    waiting_for_endpoint = False
        if deferred and not waiting_for_endpoint and self.final_gripper is not None:
            self.gripper_error = "Gripper action skipped: endpoint not confirmed"
        if not waiting_for_endpoint:
            self.final_gripper = None
            self.gripper_completion_at = None
            self.id = None
            self.plan = None
            self.kind = None
            return True
        return False
