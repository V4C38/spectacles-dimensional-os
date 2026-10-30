from __future__ import annotations

import math
import threading
from typing import Any

from pydantic import Field

from dimos.ar.manipulation.adapter import DimOSManipulationAdapter
from dimos.ar.manipulation.frames import ReferencePose
from dimos.ar.manipulation.runtime import ManipulationRuntime
from dimos.core.core import rpc
from dimos.manipulation.manipulation_module import ManipulationModule, ManipulationModuleConfig
from dimos.msgs.sensor_msgs.JointState import JointState
from dimos.utils.logging_config import setup_logger

logger = setup_logger()


class ARManipulationModuleConfig(ManipulationModuleConfig):  # type: ignore[misc]
    following_tasks: dict[str, str] = Field(default_factory=dict)
    model_asset_url: str | None = None
    model_visual_profile: str | None = None
    gripper_open_at_lower: list[str] = Field(default_factory=list)
    wire_from_world: ReferencePose = Field(default_factory=ReferencePose)
    feedback_max_age_s: float = Field(default=0.5, gt=0, allow_inf_nan=False)


class ARManipulationModule(ManipulationModule):  # type: ignore[misc]
    config: ARManipulationModuleConfig

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._adapter = DimOSManipulationAdapter(self)
        self._runtime = ManipulationRuntime(self._adapter)
        self._lifecycle_stop = threading.Event()
        self._lifecycle_thread: threading.Thread | None = None
        self._closing = False

    @rpc
    def build(self) -> None:
        self._adapter.check_compatibility()
        super().build()

    @rpc
    def start(self) -> None:
        self._closing = False
        self._adapter.configure_rpc()
        super().start()
        self._runtime.started = True
        self._lifecycle_stop.clear()
        self._lifecycle_thread = threading.Thread(
            target=self._advance, name="ar-manipulation-lifecycle", daemon=True
        )
        self._lifecycle_thread.start()

    def _advance(self) -> None:
        while not self._lifecycle_stop.wait(0.05):
            try:
                self._runtime.advance()
            except Exception:
                logger.exception("Manipulation lifecycle update failed")

    @rpc
    def stop(self) -> None:
        with self._runtime.lock:
            if self._closing:
                return
            self._closing = True
            self._runtime.started = False
            self._runtime.session.stopped = True
            self._runtime.retire()
        self._lifecycle_stop.set()
        if self._lifecycle_thread is not None:
            self._lifecycle_thread.join()
            self._lifecycle_thread = None
        if self._runtime.session.quiesced:
            self._adapter.prepare_teardown()
        super().stop()

    def _on_joint_state(self, msg: JointState) -> None:
        aliases = self.config.joint_state_aliases
        indices = {aliases.get(name, name): i for i, name in enumerate(msg.name)}
        names = self.config.model.joint_names
        if all(name in indices and indices[name] < len(msg.position) for name in names):
            values = [msg.position[indices[name]] for name in names]
            if all(math.isfinite(q) for q in values) and math.isfinite(msg.ts):
                super()._on_joint_state(msg)
                self._adapter.feedback = JointState(ts=msg.ts, name=list(names), position=values)

    @rpc
    def ar_manipulation_command(self, client_id: str, request: dict[str, Any]) -> dict[str, Any]:
        return self._runtime.dispatch(client_id, request)

    @rpc
    def ar_manipulation_snapshot(self) -> dict[str, Any]:
        return self._runtime.snapshot()

    @rpc
    def ar_manipulation_disconnect(self, client_id: str) -> None:
        self._runtime.disconnect(client_id)

    @rpc
    def ar_manipulation_stop(self) -> None:
        self._runtime.emergency_stop()
