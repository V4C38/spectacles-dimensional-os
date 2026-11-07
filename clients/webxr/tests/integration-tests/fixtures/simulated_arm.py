"""Deterministic hardware port behind the production manipulation runtime and RPC service."""

from __future__ import annotations

import time
from types import SimpleNamespace as Value
from typing import Any

from dimos.ar.manipulation.frames import ReferencePose
from dimos.ar.manipulation.runtime import ManipulationRuntime
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped


class SimulatedArm:
    def __init__(self) -> None:
        self.config = Value(
            feedback_max_age_s=0.5,
            following_tasks={"arm": "follow"},
            wire_from_world=ReferencePose(),
            model=None,
        )
        self.ready = True
        self.feedback = Value(ts=time.time(), name=["slide"], position=[0.0], velocity=[])
        self.position = 0.0
        self.target: float | None = None
        self.gripper_target = 0.0
        self.execution = "IDLE"
        self.plan: Any = None
        self.runtime = ManipulationRuntime(self)
        self.runtime.started = True
        self.runtime.descriptor = {
            "revision": "simulated-slide",
            "root": "base",
            "asset_url": None,
            "links": [{"name": "base", "bounds": None}, {"name": "tool", "bounds": None}],
            "joints": [
                {
                    "name": "slide",
                    "kind": "prismatic",
                    "parent": "base",
                    "child": "tool",
                    "axis": [1, 0, 0],
                    "origin": {"position": [0, 0, 0], "orientation": [0, 0, 0, 1]},
                    "lower": -2,
                    "upper": 2,
                    "mimic": None,
                }
            ],
        }

    def tick(self) -> None:
        with self.runtime.lock:
            if self.target is not None:
                self.position += max(-0.01, min(0.01, self.target - self.position))
                if abs(self.target - self.position) < 0.001 and self.execution == "EXECUTING":
                    self.execution = "COMPLETED"
            self.feedback.ts = time.time()
            self.feedback.position = [self.position]
            self.runtime.advance()

    def get_state(self) -> Any:
        return Value(
            groups={
                "arm": Value(
                    joints=self.feedback,
                    end_effector_pose=PoseStamped(position=[self.position, 0, 0]),
                    gripper_position=self.gripper_target,
                )
            },
            execution_status=Value(name=self.execution),
            error=None,
        )

    def list_planning_groups(self) -> list[Any]:
        return [
            Value(
                id="arm",
                joint_names=["slide"],
                base_frame="base",
                tip_frame="tool",
                has_gripper=True,
            )
        ]

    def task_invoke(self, _task: str, method: str, payload: dict[str, Any] | None = None) -> None:
        if method == "clear":
            self.target = None
        elif method == "set_target":
            self.target = payload["pose"].x

    def evaluate(self, _group: str, pose: Any) -> Any:
        return Value(
            success=True,
            message="validated",
            target_joints=Value(name=["slide"], position=[pose.x]),
            group_poses={"arm": pose},
        )

    def endpoint_pose(self, _group: str, values: dict[str, float]) -> Any:
        return PoseStamped(position=[values["slide"], 0, 0])

    def plan_to_poses(self, poses: dict[str, Any], **_kwargs: Any) -> Any:
        self.plan = Value(
            plan_id=f"plan-{time.monotonic_ns()}",
            trajectory=Value(
                joint_names=["slide"],
                duration=0.5,
                points=[
                    Value(time_from_start=0, positions=[self.position]),
                    Value(time_from_start=0.5, positions=[poses["arm"].x]),
                ],
            ),
        )
        return Value(succeeded=True, plan=self.plan)

    def execute(self, **_kwargs: Any) -> Any:
        self.target = self.plan.trajectory.points[-1].positions[0]
        self.execution = "EXECUTING"
        return Value(status=Value(name="ACCEPTED"), message="accepted")

    def clear_planned_path(self) -> None:
        self.plan = None

    def cancel(self) -> Any:
        self.target = None
        self.execution = "ABORTED"
        return Value(status=Value(name="ABORTED"), message="cancelled")

    def set_estop(self, value: bool) -> bool:
        if value:
            self.target = None
        return True

    def reset(self) -> Any:
        return Value(succeeded=True)

    def set_gripper_position(self, value: float, **_kwargs: Any) -> Any:
        self.gripper_target = value
        return Value(succeeded=True, message="completed")

    def quiesce(self) -> None:
        self.target = None

    def ar_manipulation_command(self, client: str, request: dict[str, Any]) -> dict[str, Any]:
        return self.runtime.dispatch(client, request)

    def ar_manipulation_evaluate_following(
        self, client: str, request: dict[str, Any]
    ) -> dict[str, Any]:
        return self.runtime.evaluate_following(client, request)

    def ar_manipulation_snapshot(self) -> dict[str, Any]:
        return self.runtime.snapshot(include_bulk=False)

    def ar_manipulation_asset(self, kind: str, revision: str) -> Any:
        return self.runtime.asset(kind, revision)

    def ar_manipulation_heartbeat(self, epoch: str, revision: int, deadline: float) -> None:
        self.runtime.heartbeat(epoch, revision, deadline)

    def ar_manipulation_revoke(self, epoch: str, lease: str, revision: int, reason: str) -> None:
        self.runtime.revoke_authority(epoch, lease, revision, reason)

    def ar_manipulation_disconnect(self, client: str) -> None:
        self.runtime.disconnect(client)

    def ar_manipulation_stop(self, epoch: str | None = None, revision: int | None = None) -> None:
        self.runtime.emergency_stop(epoch=epoch, revision=revision)
