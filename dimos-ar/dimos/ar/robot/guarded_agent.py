"""Native agent adapters, loaded only by the optional agentic blueprint."""

from __future__ import annotations

from queue import Empty
import threading
from typing import Any

from reactivex.disposable import Disposable

from dimos.agents.annotation import skill
from dimos.agents.capabilities import CAP_MOVEMENT
from dimos.agents.mcp.mcp_client import McpClient
from dimos.agents.skills.person_follow import PersonFollowSkillContainer
from dimos.ar.robot.agent_control import AgentTurnGate, ARFollowingQuiescenceSpec
from dimos.core.core import rpc
from dimos.core.stream import In, Out
from dimos.msgs.geometry_msgs.Twist import Twist
from dimos.msgs.std_msgs.Bool import Bool
from dimos.navigation.base import NavigationState
from dimos.navigation.go2.replanning_a_star.spec import NavigationInterfaceSpec
from dimos.utils.logging_config import setup_logger

logger = setup_logger()


class _FollowingVelocityOutput(Out[Twist]):  # type: ignore[misc]
    """Keep late native inference results from publishing motion after Stop."""

    def __init__(self, owner: Any) -> None:
        super().__init__(Twist, "cmd_vel", owner)
        self._motion_lock = threading.Lock()
        self._halted = False
        self._generation = 0

    @property
    def generation(self) -> int:
        with self._motion_lock:
            return self._generation

    def publish(self, message: Twist) -> None:
        with self._motion_lock:
            super().publish(Twist.zero() if self._halted else message)

    def halt(self) -> None:
        with self._motion_lock:
            self._halted = True
            self._generation += 1
            super().publish(Twist.zero())

    def resume(self, generation: int) -> bool:
        with self._motion_lock:
            if generation != self._generation:
                return False
            self._halted = False
            return True


class ARGuardedMcpClient(McpClient):  # type: ignore[misc]
    _navigation: NavigationInterfaceSpec
    _following: ARFollowingQuiescenceSpec

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._ar_gate = AgentTurnGate(self._lock)

    @rpc  # type: ignore[untyped-decorator]
    def ar_agent_set_manual(self, manual: bool) -> bool:
        return self._ar_gate.set_manual(manual, self._ar_motion_quiescent)

    def _ar_motion_quiescent(self) -> bool:
        if not self._navigation or not self._following:
            return False
        try:
            return (
                self._navigation.get_state() == NavigationState.IDLE
                and bool(self._following.ar_following_quiescent())
            )
        except Exception:
            logger.exception("Unable to confirm native agent motion quiescence")
            return False

    def _thread_loop(self) -> None:
        while not self._stop_event.is_set():
            if not self._ar_gate.wait_enabled(0.1):
                continue
            try:
                message = self._message_queue.get(timeout=0.1)
            except Empty:
                continue

            def process(message: Any = message) -> None:
                if self._state_graph is None:
                    raise ValueError("No state graph initialized")
                self._process_message(self._state_graph, message)

            if not self._ar_gate.run_turn(process):
                self._message_queue.put(message)


class ARPersonFollowSkillContainer(PersonFollowSkillContainer):  # type: ignore[misc]
    stop_movement: In[Bool]

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._ar_worker_lock = threading.Lock()
        self._ar_workers = 0
        self._ar_threads: set[threading.Thread] = set()
        self._ar_velocity = _FollowingVelocityOutput(self)
        self.cmd_vel = self._ar_velocity
        self._ar_invocations = threading.local()

    @rpc  # type: ignore[untyped-decorator]
    def start(self) -> None:
        super().start()
        if self.stop_movement.transport is not None:
            self.register_disposable(
                Disposable(self.stop_movement.subscribe(self._on_ar_stop_movement))
            )

    def _on_ar_stop_movement(self, message: Bool) -> None:
        if message.data:
            # Latch output before the bounded native join. A blocked tracker may
            # finish later and publish once before its loop checks the stop event.
            self._ar_velocity.halt()
            self.stop_following()

    @rpc  # type: ignore[untyped-decorator]
    def ar_following_quiescent(self) -> bool:
        with self._ar_worker_lock:
            self._ar_threads = {worker for worker in self._ar_threads if worker.is_alive()}
            return not self._ar_threads and self._ar_workers == 0 and (
                self._thread is None or not self._thread.is_alive()
            )

    @skill(uses=[CAP_MOVEMENT], lifecycle="background")  # type: ignore[untyped-decorator]
    def follow_person(
        self, query: str, initial_bbox: list[float] | None = None,
        initial_image: str | None = None,
    ) -> str:
        """Follow a person; a Stop retires work already detecting that person."""
        self._ar_invocations.generation = self._ar_velocity.generation
        try:
            return str(super().follow_person(query, initial_bbox, initial_image))
        finally:
            del self._ar_invocations.generation

    def _follow_person(self, *args: Any, **kwargs: Any) -> str:
        if not self.ar_following_quiescent():
            self._should_stop.set()
            return "Previous following worker is still stopping; retry after it exits."
        # Only a new follow invocation can resume this output after Stop.
        if not self._ar_velocity.resume(self._ar_invocations.generation):
            self._should_stop.set()
            return "Following request was retired by Stop."
        result = super()._follow_person(*args, **kwargs)
        with self._ar_worker_lock:
            if self._thread is not None:
                self._ar_threads.add(self._thread)
        return str(result)

    def _follow_loop(self, *args: Any, **kwargs: Any) -> None:
        with self._ar_worker_lock:
            self._ar_workers += 1
        try:
            super()._follow_loop(*args, **kwargs)
        finally:
            with self._ar_worker_lock:
                self._ar_workers -= 1
                self._ar_threads.discard(threading.current_thread())
