"""Installed-runtime regression probe. Requires explicit mock on localhost:8799.

Refuses motion unless manipulation_state.simulated is true. Start the mock
with DIMOS_AR_SIMULATION=1 and ARMODULE__PORT=8799, then wait for runtime ready.
"""

import asyncio
import itertools
import json
import time

import websockets


async def main():
    async with websockets.connect("ws://127.0.0.1:8799") as ws:
        await ws.send(json.dumps({"type": "hello_request", "ts_client": time.time()}))
        latest = {}
        replies = []
        stamps = []

        async def read():
            async for raw in ws:
                for line in raw.splitlines():
                    frame = json.loads(line)
                    if frame["type"] == "manipulation_state":
                        latest.update(frame)
                        stamps.append(time.monotonic())
                    if frame["type"] == "manipulation_result":
                        replies.append(frame)

        reader = asyncio.create_task(read())
        while not latest.get("available"):
            await asyncio.sleep(0.02)
        assert latest["simulated"] is True
        group = latest["groups"][0]["id"]
        pose = latest["observations"][group]["pose"]

        async def command(id, action, **body):
            await ws.send(
                json.dumps(
                    dict(
                        type="manipulation_request",
                        request_id=id,
                        action=action,
                        group_id=group,
                        **body,
                    )
                )
            )

        if latest.get("stopped"):
            await command("resume", "resume")
            while not any(r["request_id"] == "resume" for r in replies):
                await asyncio.sleep(0.01)
        await command("acquire", "acquire")
        while not any(r["request_id"] == "acquire" for r in replies):
            await asyncio.sleep(0.01)
        token = next(r["token"] for r in replies if r["request_id"] == "acquire")
        for i in range(90):
            target = pose if i < 15 or i >= 60 else dict(pose, position=[100.0, 0.0, 100.0])
            await command(
                "follow-" + str(i + 1),
                "update",
                token=token,
                sequence=i + 1,
                ts=time.time(),
                speed_scale=0.5,
                **target,
            )
            await asyncio.sleep(1 / 30)
        await asyncio.sleep(0.1)
        assert latest.get("following") is True, replies
        assert any(r.get("status") == "infeasible" for r in replies), replies
        assert any(r.get("status") == "feasible" and r.get("sequence", 0) >= 60 for r in replies), (
            replies
        )
        print(
            json.dumps(
                {
                    "responses": [
                        {k: r.get(k) for k in ("sequence", "status", "code", "message")}
                        for r in replies
                        if r.get("action") == "update"
                    ][-20:],
                    "following": latest.get("following"),
                    "max_state_gap": max([b - a for a, b in itertools.pairwise(stamps)] or [0]),
                },
                indent=2,
            )
        )
        await command("cancel", "cancel")
        await asyncio.sleep(0.2)
        reader.cancel()


if __name__ == "__main__":
    asyncio.run(main())
