"""Native agent adapters, loaded only by the optional agentic blueprint."""

from __future__ import annotations

from queue import Empty
import threading
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

from dimos_lcm.std_msgs import Bool
from reactivex.disposable import Disposable

from dimos.agents.annotation import skill
from dimos.agents.capabilities import CAP_MOVEMENT
from dimos.agents.mcp.mcp_client import McpClient
from dimos.agents.skills.person_follow import PersonFollowSkillContainer
from dimos.ar.robot.agent_control import (
    AgentTurnGate,
    ARAgentNavigationSpec,
    ARFollowingQuiescenceSpec,
)
from dimos.core.core import rpc
from dimos.core.stream import In, Out
from dimos.msgs.geometry_msgs.Twist import Twist
from dimos.navigation.base import NavigationState
from dimos.utils.logging_config import setup_logger

logger = setup_logger()


class _FollowingVelocityOutput(Out[Twist]):  # type: ignore[misc]
    """Keep late native inference results from publishing motion after Stop."""

    def __init__(self, owner: Any) -> None:
        super().__init__(Twist, "cmd_vel", owner)
        self._motion_lock = threading.Lock()
        self._halted = False
        self._generation = 0
        self._manual = False
        self._mode_generation = -1
        self._stop_ack_required = False

    @property
    def manual(self) -> bool:
        with self._motion_lock:
            return self._manual

    def set_manual(self, manual: bool, generation: int | None = None) -> bool:
        with self._motion_lock:
            if generation is not None:
                if type(generation) is not int or generation < self._mode_generation:
                    return False
                if not manual and self._stop_ack_required:
                    return False
                self._mode_generation = generation
            elif not manual:
                return False
            self._manual = manual
            if manual:
                self._stop_ack_required = generation is None
                self._halted = True
                self._generation += 1
                super().publish(Twist.zero())
            return True

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
            if self._manual or generation != self._generation:
                return False
            self._halted = False
            return True


class ARGuardedMcpClient(McpClient):  # type: ignore[misc]
    _navigation: ARAgentNavigationSpec
    _following: ARFollowingQuiescenceSpec

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._ar_gate = AgentTurnGate(self._lock)

    @rpc  # type: ignore[untyped-decorator]
    def ar_agent_set_manual(self, manual: bool) -> bool:
        if manual:
            if not self._ar_gate.set_manual(True, self._ar_motion_quiescent):
                return False
            return bool(self.ar_agent_takeover())
        generation = self._ar_gate.generation
        accepted = self._ar_gate.set_manual(False, lambda: self._ar_resume_native(generation))
        if not accepted and self._ar_gate.manual:
            # A concurrent Stop can retire a resume during its native RPCs.
            # Re-latch both outputs before reporting that resume was rejected.
            self.ar_agent_takeover()
        return accepted

    def _ar_discard_pending(self) -> None:
        while True:
            try:
                self._message_queue.get_nowait()
            except Empty:
                return

    def _ar_resume_native(self, generation: int) -> bool:
        if not self._ar_gate.same_generation(generation) or not self._ar_motion_quiescent():
            return False
        self._ar_discard_pending()
        self._history.clear()
        try:
            # Confirm both stop latches under this generation before opening
            # either lane. A delayed Bool Stop cannot force an extra UI retry.
            navigation_stopped = bool(self._navigation.ar_navigation_agent_manual(True, generation))
            following_stopped = bool(self._following.ar_following_set_manual(True, generation))
            navigation = (navigation_stopped and following_stopped
                          and self._ar_gate.same_generation(generation)
                          and bool(self._navigation.ar_navigation_agent_manual(False, generation)))
            following = (navigation and self._ar_gate.same_generation(generation)
                         and bool(self._following.ar_following_set_manual(False, generation)))
            if navigation and following and self._ar_gate.same_generation(generation):
                return True
        except Exception:
            logger.exception("Unable to resume native agent motion admission")
        # Attempt both compensating latches even if one RPC raises.
        for stop in (self._navigation.ar_navigation_agent_manual,
                     self._following.ar_following_set_manual):
            try:
                stop(True, self._ar_gate.generation)
            except Exception:
                logger.exception("Unable to re-latch native agent motion admission")
        return False

    @rpc  # type: ignore[untyped-decorator]
    def ar_agent_takeover(self) -> bool:
        generation = self._ar_gate.retire()
        self._ar_discard_pending()
        navigation = following = False
        try:
            navigation = bool(self._navigation.ar_navigation_agent_manual(True, generation))
        except Exception:
            logger.exception("Unable to stop native agent navigation")
        try:
            following = bool(self._following.ar_following_set_manual(True, generation))
        except Exception:
            logger.exception("Unable to stop native agent following")
        # A tool already executing elsewhere may own effects beyond navigation.
        # Reject uncertain admission while retaining every stop latch.
        return (navigation and following and self._ar_gate.effects_quiescent
                and self._ar_gate.same_generation(generation))

    def _mcp_tool_call(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        generation = self._ar_gate.generation

        def call() -> dict[str, Any]:
            params = dict(arguments)
            if isinstance(params.get("then"), dict):
                params["then"] = {**params["then"], "_ar_generation": generation}
            return dict(self._mcp_request("tools/call", {
                "name": name, "arguments": params,
                "_meta": {"progressToken": f"ar:{generation}:{uuid4().hex}"},
            }))

        return self._ar_gate.run_effect(generation, call)

    def _on_tool_stream_message(self, message: dict[str, Any]) -> None:
        token = (message.get("params") or {}).get("progressToken")
        if not isinstance(token, str) or not token.startswith("ar:"):
            return
        try:
            generation = int(token.split(":", 2)[1])
        except (ValueError, IndexError):
            return
        self._ar_gate.publish(generation, lambda: super(ARGuardedMcpClient, self)
                              ._on_tool_stream_message(message))

    @rpc  # type: ignore[untyped-decorator]
    def dispatch_continuation(
        self, continuation: dict[str, Any], continuation_context: dict[str, Any]
    ) -> None:
        generation = continuation.get("_ar_generation")
        if type(generation) is not int or not self._ar_gate.accepts(generation):
            return
        try:
            self._ar_gate.run_effect(generation, lambda: super(ARGuardedMcpClient, self)
                                    .dispatch_continuation(continuation, continuation_context))
        except RuntimeError:
            logger.debug("Retired agent continuation discarded")

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
            generation = self._ar_gate.generation
            try:
                message = self._message_queue.get(timeout=0.1)
            except Empty:
                continue

            def process(message: Any = message, generation: int = generation) -> None:
                if self._state_graph is None:
                    raise ValueError("No state graph initialized")
                graph = self._state_graph

                def stream(*args: Any, **kwargs: Any) -> Any:
                    for update in graph.stream(*args, **kwargs):
                        if not self._ar_gate.accepts(generation):
                            return
                        yield update

                try:
                    self._process_message(SimpleNamespace(stream=stream), message)
                except Exception:
                    if self._ar_gate.accepts(generation):
                        raise
                    logger.debug("Retired native agent turn discarded")
                finally:
                    # The turn lock also protects cleanup. Resume cannot
                    # enqueue a fresh command before old continuations drain.
                    if not self._ar_gate.accepts(generation):
                        self._ar_discard_pending()
                        self._history.clear()
                        self.agent_idle.publish(True)

            self._ar_gate.run_turn(process, generation)


class ARPersonFollowSkillContainer(PersonFollowSkillContainer):  # type: ignore[misc]
    stop_movement: In[Bool]

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._ar_worker_lock = threading.Lock()
        self._ar_threads: set[threading.Thread] = set()
        self._ar_velocity = _FollowingVelocityOutput(self)
        self.cmd_vel = self._ar_velocity
        self._ar_invocations = threading.local()
        self._ar_active_invocations = 0

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
            self._ar_velocity.set_manual(True)
            self.stop_following()

    @rpc  # type: ignore[untyped-decorator]
    def ar_following_quiescent(self) -> bool:
        with self._ar_worker_lock:
            self._ar_threads = {worker for worker in self._ar_threads if worker.is_alive()}
            return not getattr(self, "_ar_active_invocations", 0) and not self._ar_threads and (
                self._thread is None or not self._thread.is_alive()
            )

    @rpc  # type: ignore[untyped-decorator]
    def ar_following_set_manual(self, manual: bool, generation: int | None = None) -> bool:
        if not manual and not self.ar_following_quiescent():
            return False
        try:
            if not self._ar_velocity.set_manual(manual, generation):
                return False
            if manual:
                self._should_stop.set()
            return True
        except Exception:
            logger.exception("Unable to confirm following output is stopped")
            return False

    @skill(uses=[CAP_MOVEMENT], lifecycle="background")  # type: ignore[untyped-decorator]
    def follow_person(
        self, query: str, initial_bbox: list[float] | None = None,
        initial_image: str | None = None,
    ) -> str:
        """Follow a person; a Stop retires work already detecting that person."""
        generation = self._ar_velocity.generation
        if self._ar_velocity.manual:
            return "Following is paused for manual control."
        with self._ar_worker_lock:
            self._ar_active_invocations = getattr(self, "_ar_active_invocations", 0) + 1
        try:
            if self._ar_velocity.manual or generation != self._ar_velocity.generation:
                return "Following request was retired by Stop."
            self._ar_invocations.generation = generation
            return str(super().follow_person(query, initial_bbox, initial_image))
        finally:
            if hasattr(self._ar_invocations, "generation"):
                del self._ar_invocations.generation
            with self._ar_worker_lock:
                self._ar_active_invocations -= 1

    def _follow_person(self, *args: Any, **kwargs: Any) -> str:
        with self._ar_worker_lock:
            self._ar_threads = {worker for worker in self._ar_threads if worker.is_alive()}
            busy = bool(self._ar_threads) or getattr(self, "_ar_active_invocations", 0) > 1
        if busy or (self._thread is not None and self._thread.is_alive()):
            self._should_stop.set()
            return "Previous following worker is still stopping; retry after it exits."
        # Only a new follow invocation can resume this output after Stop.
        if not self._ar_velocity.resume(self._ar_invocations.generation):
            self._should_stop.set()
            return "Following request was retired by Stop."
        return str(super()._follow_person(*args, **kwargs))

    def _follow_loop(self, *args: Any, **kwargs: Any) -> None:
        with self._ar_worker_lock:
            self._ar_threads.add(threading.current_thread())
        try:
            super()._follow_loop(*args, **kwargs)
        finally:
            with self._ar_worker_lock:
                self._ar_threads.discard(threading.current_thread())
