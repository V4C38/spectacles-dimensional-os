"""Real ARModule/WebSocket integration fixture; only native robot ports are simulated."""
from __future__ import annotations

import asyncio
from contextlib import closing
import signal
import socket
import threading
import time
from typing import Any

from dimos.ar.module import ARModule
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.nav_msgs.Path import Path


class RobotPort:
    def __init__(self, module: ARModule, goals: bool = False) -> None:
        self.module = module
        self.goals = goals

    def broadcast(self, _stream: Any, value: Any) -> None:
        if self.goals:
            path = Path(ts=time.time(), frame_id="odom", poses=[
                PoseStamped(position=[0, 0, 0]), value,
            ])
            asyncio.run_coroutine_threadsafe(self.module.handle_path(path), self.module._loop)

    def subscribe(self, _callback: Any, _stream: Any = None) -> Any:
        return lambda: None

    def stop(self) -> None:
        pass


def main() -> None:
    with closing(socket.socket()) as available:
        available.bind(("127.0.0.1", 0))
        port = available.getsockname()[1]
    module = ARModule(port=port, ip_relay_url=None)
    module.build()
    for stream in module.inputs.values():
        stream.transport = RobotPort(module)
    module.goal_request.transport = RobotPort(module, goals=True)
    module.stop_movement.transport = RobotPort(module)
    module.tele_cmd_vel.transport = RobotPort(module)
    # Deterministic native planner boundary; production request ownership is unchanged.
    module._previews._planner = type("Planner", (), {
        "plan": lambda _self, start, goal: [(start[0], start[1], 0), (goal[0], goal[1], 0)],
    })()
    stopped = threading.Event()
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda *_args: stopped.set())
    module.start()
    print(f"MULTI_CLIENT_READY={port}", flush=True)
    try:
        while not stopped.wait(0.05):
            future = asyncio.run_coroutine_threadsafe(module.handle_odom(
                PoseStamped(ts=time.time(), frame_id="odom", position=[0, 0, 0.33])), module._loop)
            future.result(timeout=1)
    finally:
        module.stop()


if __name__ == "__main__":
    main()
