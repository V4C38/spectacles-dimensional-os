"""Regression for solver latency being mistaken for missing held input."""

import asyncio
import json
import threading
import time

import pytest

from dimos.ar.manipulation.protocol import ManipulationRequest
from dimos.ar.manipulation.service import ManipulationService
from dimos.ar.manipulation.test_runtime import command, runtime


@pytest.mark.asyncio
async def test_slow_evaluation_does_not_starve_held_target_receipts():
    owner = runtime()
    owner.adapter.ready = True
    entered, release = threading.Event(), threading.Event()
    token = command(owner, "acquire")["token"]

    def evaluate(*args):
        entered.set()
        assert release.wait(3)
        raise ValueError("IK did not converge")

    owner.adapter.evaluate = evaluate
    owner.adapter.task_invoke.return_value = None

    class Port:
        def ar_manipulation_command(self, client, request):
            owner.adapter.feedback.ts = time.time()
            return owner.dispatch(client, request)

        def ar_manipulation_evaluate_following(self, client, request):
            return owner.evaluate_following(client, request)

        def ar_manipulation_stop(self):
            release.set()

    replies = []
    service = ManipulationService(
        Port(), lambda _, message: replies.append(json.loads(message)), lambda _: None
    )
    service.connect("a")
    try:
        for sequence in range(1, 26):
            service.submit(
                ManipulationRequest(
                    f"follow-{sequence}",
                    "update",
                    "arm",
                    {
                        "token": token,
                        "sequence": sequence,
                        "ts": time.time(),
                        "speed_scale": 0.5,
                        "position": [100, 0, 100],
                        "orientation": [0, 0, 0, 1],
                    },
                ),
                "a",
            )
            owner.advance()
            await asyncio.sleep(1 / 30)
        assert entered.is_set()
        assert owner.session.token == token
        assert owner.session.sequence >= 20
    finally:
        release.set()
        await service.close()
