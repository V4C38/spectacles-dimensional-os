"""Installed-runtime regression probe. Requires explicit mock on localhost:8799.

Refuses motion unless manipulation_state.simulated is true. Start the mock
with DIMOS_AR_SIMULATION=1 and ARMODULE__PORT=8799, then wait for runtime ready.
"""

import asyncio
import json
import math
import statistics
import time

import websockets


async def main():
    async with websockets.connect("ws://127.0.0.1:8799") as ws:
        replies = {}
        latest = {}
        counter = 0
        await ws.send(json.dumps({"type": "hello_request", "ts_client": time.time()}))

        async def read():
            async for raw in ws:
                for line in raw.splitlines():
                    frame = json.loads(line)
                    if frame["type"] == "manipulation_state":
                        latest.update(frame)
                    if frame["type"] == "manipulation_result":
                        replies[frame["request_id"]] = frame

        reader = asyncio.create_task(read())

        async def wait(predicate, timeout=30):
            async with asyncio.timeout(timeout):
                while not predicate():
                    await asyncio.sleep(0.01)

        await wait(lambda: latest.get("available"))
        assert latest.get("simulated") is True
        group = latest["groups"][0]["id"]

        async def cmd(action, **body):
            nonlocal counter
            counter += 1
            id = str(counter)
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
            await wait(lambda: id in replies)
            result = replies[id]
            if result["status"] in ("rejected", "infeasible"):
                raise RuntimeError(result)
            return result

        if latest.get("stopped"):
            await cmd("resume")
        home = latest["observations"][group]["pose"]
        target = dict(home, position=[home["position"][0] + 0.04, *home["position"][1:]])

        def error(p):
            actual = latest["observations"][group]["pose"]
            return math.dist(p["position"], actual["position"])

        async def move(p, speed):
            if error(p) < 0.002:
                return
            plan = await cmd("plan", **p, speed_scale=speed)
            await cmd("execute", plan_id=plan["plan_id"])
            await wait(lambda: error(p) < 0.002)
            await cmd("cancel")
            await asyncio.sleep(0.2)

        results = []
        for speed in (0.25, 0.5, 1) * 3:
            for mode in ("execute", "drag"):
                await move(home, 1)
                if mode == "execute":
                    plan = await cmd("plan", **target, speed_scale=speed)
                    start = time.monotonic()
                    await cmd("execute", plan_id=plan["plan_id"])
                    await wait(lambda: error(target) < 0.005, 15)
                else:
                    token = (await cmd("acquire"))["token"]
                    start = time.monotonic()
                    seq = 0
                    while error(target) >= 0.005:
                        if time.monotonic() - start > 15:
                            raise RuntimeError("drag timeout")
                        seq += 1
                        counter += 1
                        await ws.send(
                            json.dumps(
                                dict(
                                    type="manipulation_request",
                                    request_id=str(counter),
                                    action="update",
                                    group_id=group,
                                    token=token,
                                    sequence=seq,
                                    ts=time.time(),
                                    speed_scale=speed,
                                    **target,
                                )
                            )
                        )
                        await asyncio.sleep(1 / 30)
                results.append({"speed": speed, "mode": mode, "arrival": time.monotonic() - start})
                await cmd("cancel")
                await asyncio.sleep(0.2)
        comparisons = []
        for speed in (0.25, 0.5, 1):
            execute = statistics.median(
                r["arrival"] for r in results if r["speed"] == speed and r["mode"] == "execute"
            )
            drag = statistics.median(
                r["arrival"] for r in results if r["speed"] == speed and r["mode"] == "drag"
            )
            comparisons.append(
                {"speed": speed, "execute_s": execute, "drag_s": drag, "ratio": drag / execute}
            )
        print(json.dumps({"samples": results, "medians": comparisons}, indent=2))
        reader.cancel()
        assert all(0.9 <= result["ratio"] <= 1.1 for result in comparisons), comparisons


if __name__ == "__main__":
    asyncio.run(main())
