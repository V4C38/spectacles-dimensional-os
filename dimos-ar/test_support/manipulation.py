from dataclasses import dataclass, field
import time
from types import SimpleNamespace
from typing import Any
from unittest.mock import Mock

from dimos.ar.manipulation.model import ReferencePose
from dimos.ar.manipulation.runtime import ManipulationRuntime


@dataclass
class ManipulationConfig:
    """Complete narrow config for deterministic native-port test doubles."""

    following_tasks: dict[str, str] = field(default_factory=lambda: {"arm": "follow"})
    feedback_max_age_s: float = 0.5
    wire_from_world: ReferencePose = field(default_factory=ReferencePose)
    model: Any = None
    model_asset_url: str | None = None
    model_visual_profile: str | None = None
    gripper_joint_names: list[str] = field(default_factory=list)
    gripper_open_at_lower: list[str] = field(default_factory=list)
    joint_arrival_tolerance_rad: float = 0.02


def runtime():
    config = ManipulationConfig(
        model=SimpleNamespace(model=SimpleNamespace(load=lambda: SimpleNamespace(xml="<robot/>"))),
    )
    adapter = SimpleNamespace(
        config=config, ready=False, feedback=SimpleNamespace(ts=time.time()),
        endpoint_holding=False, gripper_target=None, following_status={},
        following_status_at=0.0, protection={"state": "normal", "effective_speed_scale": 1.0},
    )
    module = ManipulationRuntime(adapter)
    module.started = True
    # Explicit fake control plane for domain-only native unit cases.
    module._control_epoch = "robot-reference"
    module._control_revision = 0
    module._control_deadline = time.monotonic() + 10000
    observed = SimpleNamespace(joints=SimpleNamespace(ts=time.time()), end_effector_pose=None)
    module.adapter.get_state = Mock(
        return_value=SimpleNamespace(
            groups={"arm": observed}, execution_status=SimpleNamespace(name="IDLE")
        )
    )
    module.adapter.endpoint_pose = Mock(return_value=None)
    module.adapter.task_invoke = Mock()
    module.adapter.set_estop = Mock()
    module.adapter.quiesce = Mock()
    module.adapter.clear_planned_path = Mock()
    module.adapter.cancel = Mock(
        return_value=SimpleNamespace(status=SimpleNamespace(name="ABORTED"), message="cancelled")
    )
    module.adapter.reset = Mock(
        return_value=SimpleNamespace(succeeded=True, status=SimpleNamespace(name="SUCCEEDED"))
    )
    module.wait_for_execution = Mock(
        return_value=SimpleNamespace(status=SimpleNamespace(name="COMPLETED"))
    )
    module.adapter.execute = Mock(
        return_value=SimpleNamespace(status=SimpleNamespace(name="ACCEPTED"), message="accepted")
    )
    return module


def command(module, action, client="a", **payload):
    return module.command(client, {"action": action, "group_id": "arm", **payload})


def _request(action: str, revision: int = 1, target: int = 7, lease: str | None = "grab-a", **body):
    return {
        "action": action,
        "group_id": "arm",
        "authority_epoch": "robot-reference",
        "authority_lease": lease,
        "authority_revision": revision,
        "target_revision": target,
        "authority_deadline": time.monotonic() + 1,
        **body,
    }
