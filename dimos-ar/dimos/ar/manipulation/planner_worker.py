"""Hardware-free planning process; the control lease never shares its GIL or world lock."""

from __future__ import annotations

import pickle
import socket
import struct
import subprocess
import sys
import threading
from typing import Any


def receive(channel: socket.socket) -> Any:
    def read(size: int) -> bytes:
        data = bytearray()
        while len(data) < size:
            part = channel.recv(size - len(data))
            if not part:
                raise EOFError("Planning worker closed")
            data.extend(part)
        return bytes(data)

    (size,) = struct.unpack("!I", read(4))
    if size > 64 * 1024 * 1024:
        raise ValueError("Planning reply too large")
    return pickle.loads(read(size))


def send(channel: socket.socket, value: Any) -> None:
    data = pickle.dumps(value, protocol=5)
    channel.sendall(struct.pack("!I", len(data)) + data)


def synchronize_scene(monitor: Any, snapshot: bytes) -> None:
    obstacles = pickle.loads(snapshot)
    for obstacle in monitor.world.get_obstacles():
        if not monitor.remove_obstacle(obstacle.name):
            raise ValueError("Planning scene could not retire an obstacle")
    for obstacle in obstacles:
        if not monitor.add_obstacle(obstacle):
            raise ValueError("Planning scene could not install an obstacle")


class PlanningWorker:
    def __init__(self, config: Any) -> None:
        self.channel, child = socket.socketpair()
        self.channel.settimeout(60)
        self.lock = threading.Lock()
        self._closed = False
        self.process = subprocess.Popen(
            [sys.executable, "-m", __name__, str(child.fileno())],
            pass_fds=(child.fileno(),),
            stdin=subprocess.DEVNULL,
        )
        child.close()
        try:
            send(self.channel, config)
            reply = receive(self.channel)
        except BaseException:
            self.close()
            raise
        if reply is not True:
            self.close()
            raise RuntimeError(str(reply))

    @property
    def closed(self) -> bool:
        return self._closed

    def call(self, action: str, feedback: Any, *args: Any, **kwargs: Any) -> Any:
        with self.lock:
            if self._closed:
                raise RuntimeError("Planning worker retired")
            try:
                send(self.channel, (action, feedback, args, kwargs))
                ok, result = receive(self.channel)
            except (OSError, EOFError, ValueError, pickle.UnpicklingError, struct.error):
                # An unresolved reply cannot be attributed to a later target.
                self.close()
                raise
        if not ok:
            raise ValueError(result)
        return result

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self.channel.close()
        self.process.terminate()
        try:
            self.process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()


def main(fd: int) -> None:
    from dimos.ar.manipulation.limits import validate_soft_endpoint, validate_soft_trajectory
    from dimos.manipulation.manipulation_module import (
        ManipulationModule,
        ManipulationModuleConfig,
        ManipulationState,
    )
    from dimos.manipulation.planning.factory import create_planning_specs, create_world
    from dimos.manipulation.visualization.operator import ManipulationOperator, PoseTargetRequest

    channel = socket.socket(fileno=fd)
    try:
        config = receive(channel)
        module = ManipulationModule(
            **{
                key: value
                for key, value in config.model_dump().items()
                if key in ManipulationModuleConfig.model_fields and key != "instance_name"
            },
            instance_name="ARPlanningWorker",
        )
        world = create_world(backend=config.world_backend, visualization=config.visualization)
        specs = create_planning_specs(
            world=world,
            world_backend=config.world_backend,
            planner=config.planner,
            kinematics=config.kinematics,
            trajectory_parametrization=config.trajectory_parametrization,
        )
        module._world_monitor = specs.world_monitor
        module._planner = specs.planner
        module._kinematics = specs.kinematics
        module._trajectory_parametrizer = specs.trajectory_parametrizer
        module._world_monitor.load_model(config.model)
        module._world_monitor.finalize()
        send(channel, True)
        previous_solutions: dict[str, Any] = {}
        previous_context: Any = None
        previous_scene: bytes | None = None
        while True:
            action, feedback, args, kwargs = receive(channel)
            try:
                if feedback is None:
                    raise ValueError("No joint feedback")
                scene = kwargs.pop("scene", None)
                if scene is None:
                    raise ValueError("Planning requires an authoritative scene snapshot")
                if scene != previous_scene:
                    synchronize_scene(module._world_monitor, scene)
                    previous_scene = scene
                    previous_solutions.clear()
                world.sync_from_joint_state(feedback)
                module._state = ManipulationState.IDLE
                if action == "evaluate":
                    group, pose = args
                    context = kwargs.pop("seed_context", None)
                    if context != previous_context:
                        previous_solutions.clear()
                        previous_context = context
                    result = ManipulationOperator(
                        module, module._world_monitor
                    ).evaluate_pose_target(
                        PoseTargetRequest(
                            {group: pose}, seed=previous_solutions.get(group, feedback)
                        )
                    )
                    if result.success and result.target_joints is not None:
                        validate_soft_endpoint(
                            config.model,
                            dict(
                                zip(
                                    result.target_joints.name,
                                    result.target_joints.position,
                                    strict=True,
                                )
                            ),
                        )
                        previous_solutions[group] = result.target_joints
                else:
                    result = getattr(module, action)(*args, **kwargs)
                    if result.succeeded and result.plan is not None:
                        trajectory = result.plan.trajectory
                        validate_soft_trajectory(
                            config.model,
                            trajectory,
                            dict(zip(feedback.name, feedback.position, strict=True)),
                        )
                        validate_soft_endpoint(
                            config.model,
                            dict(
                                zip(
                                    trajectory.joint_names,
                                    trajectory.points[-1].positions,
                                    strict=True,
                                )
                            ),
                        )
                send(channel, (True, result))
            except Exception as exc:  # noqa: BLE001 — isolate native planning errors at the process boundary
                send(channel, (False, str(exc)))
    except EOFError:
        pass
    except Exception as exc:  # noqa: BLE001 — isolate native planning errors at the process boundary
        send(channel, str(exc))
    finally:
        channel.close()


if __name__ == "__main__":
    main(int(sys.argv[1]))
