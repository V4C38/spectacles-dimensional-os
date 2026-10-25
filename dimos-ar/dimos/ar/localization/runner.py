from __future__ import annotations

import asyncio
from collections.abc import Callable
import time

from dimos.ar.localization.coordinator import LocalizationCoordinator, LocalizationOutcome
from dimos.ar.localization.policy import EpisodeWork, LocalizationPolicy
from dimos.utils.logging_config import setup_logger

logger = setup_logger()
EPISODE_TIMEOUT_S = 12.0
RESULT_TIMEOUT_S = 15.0


class LocalizationRunner:
    """Bounded per-client episode lifecycle; all methods run on the module loop."""

    def __init__(
        self,
        *,
        coordinator: LocalizationCoordinator,
        policy: LocalizationPolicy,
        on_outcome: Callable[[EpisodeWork, LocalizationOutcome], None],
        on_prompt: Callable[[str], None],
        timeout_s: float = EPISODE_TIMEOUT_S,
    ) -> None:
        self._coordinator = coordinator
        self._policy = policy
        self._on_outcome = on_outcome
        self._on_prompt = on_prompt
        self._timeout_s = timeout_s
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._jobs: set[asyncio.Task[None]] = set()
        self._poll_task: asyncio.Task[None] | None = None
        self._closed = False

    def start(self) -> None:
        if self._poll_task is None and not self._closed:
            self._poll_task = asyncio.create_task(self._poll())

    def submit(self, work: EpisodeWork) -> None:
        if self._closed or work.client_id in self._tasks or not self._policy.is_current(work):
            return
        deadline = asyncio.get_running_loop().time() + self._timeout_s
        task = asyncio.create_task(self._run(work, deadline))
        self._tasks[work.client_id] = task
        self._jobs.add(task)
        task.add_done_callback(self._job_done)

    def _job_done(self, task: asyncio.Task[None]) -> None:
        self._jobs.discard(task)
        if not task.cancelled() and task.exception() is not None:
            logger.error("localization completion failed", error=type(task.exception()).__name__)

    def cancel(self, client_id: str) -> None:
        task = self._tasks.pop(client_id, None)
        if task is not None:
            task.cancel()

    def cancel_all(self) -> None:
        for client_id in tuple(self._tasks):
            self.cancel(client_id)

    async def close(self) -> None:
        self._closed = True
        tasks = tuple(self._jobs)
        self.cancel_all()
        if self._poll_task is not None:
            self._poll_task.cancel()
            tasks += (self._poll_task,)
            self._poll_task = None
        await asyncio.gather(*tasks, return_exceptions=True)
        await self._coordinator.close()

    async def _poll(self) -> None:
        while True:
            prompts, _ = self._policy.poll()
            for client_id in prompts:
                self._on_prompt(client_id)
            await asyncio.sleep(0.25)

    async def _run(self, work: EpisodeWork, deadline: float) -> None:
        task = asyncio.current_task()
        started = time.perf_counter()
        try:
            try:
                # Includes lock/worker admission, auth, token refresh, and both queries.
                async with asyncio.timeout_at(deadline):
                    outcome = await self._coordinator.run(
                        work.observations, client_id=work.client_id
                    )
            except Exception as exc:  # noqa: BLE001 -- provider failures must not kill the socket.
                logger.warning(
                    "localization episode failed",
                    client_id=work.client_id,
                    error=type(exc).__name__,
                )
                outcome = LocalizationOutcome()
            logger.info(
                "localization processing timing",
                client_id=work.client_id,
                observations=len(work.observations),
                processing_ms=round((time.perf_counter() - started) * 1000, 1),
                newest_capture_ts=max((item.ts_server for item in work.observations), default=None),
                result=outcome.result is not None,
                deferred=outcome.defer_vps,
            )
            if self._tasks.get(work.client_id) is task and self._policy.is_current(work):
                self._on_outcome(work, outcome)
        finally:
            if self._tasks.get(work.client_id) is task:
                self._tasks.pop(work.client_id, None)
