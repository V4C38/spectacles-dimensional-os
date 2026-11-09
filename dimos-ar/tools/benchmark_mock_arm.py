"""Compare mock arm drag and checked Execute arrival times at three speeds.

Requires an explicitly simulated official runtime on localhost (default port 8799).
The default three repetitions check median arrival-time parity within ten percent.
"""

import argparse
import asyncio
import json
import math
import statistics
import time

if __package__:
    from .mock_runtime_client import mock_runtime
else:
    from mock_runtime_client import mock_runtime


async def benchmark(url, repeats=3):
    async with mock_runtime(url, server_follow_stream=True) as (client, state):
        home = state["observations"][client.group]["pose"]
        target = {**home, "position": [home["position"][0] + 0.04, *home["position"][1:]]}

        def error(pose):
            actual = client.state["observations"][client.group]["pose"]
            return math.dist(pose["position"], actual["position"])

        async def execute(pose, speed):
            await client.acquire("manipulation_planning", pose, speed_scale=speed)
            plan = await client.command("plan", **pose, speed_scale=speed)
            assert plan["status"] == "planned", plan
            await client.release()
            started = time.monotonic()
            result = await client.command("execute", plan_id=plan["plan_id"])
            assert result["status"] == "accepted", result
            return started, result["operation_id"]

        async def finish_execution(operation_id):
            await client.wait(lambda: client.state.get("operation_id") == operation_id
                              and client.state.get("execution") == "completed")
            await client.wait(lambda: not client.shared["motion_busy"])

        results = []
        for speed in (0.25, 0.5, 1) * repeats:
            for mode in ("execute", "drag"):
                if error(home) >= 0.002:
                    _, operation = await execute(home, 1)
                    await finish_execution(operation)
                if mode == "execute":
                    started, operation = await execute(target, speed)
                    await client.wait(lambda: error(target) < 0.005, timeout=15)
                    arrival = time.monotonic() - started
                    await finish_execution(operation)
                else:
                    await client.acquire("manipulation_following", home, speed_scale=speed)
                    acquired = await client.command("acquire")
                    assert acquired["status"] == "acquired", acquired
                    started = time.monotonic()
                    while error(target) >= 0.005:
                        if time.monotonic() - started > 15:
                            raise TimeoutError("Mock following did not reach the target")
                        await client.update_target(target, speed_scale=speed)
                        await asyncio.sleep(1 / 30)
                    arrival = time.monotonic() - started
                    released = await client.command("release", token=acquired["token"])
                    assert released["status"] == "released", released
                    await client.release()
                    await client.wait(lambda: not client.shared["motion_busy"])
                results.append({"speed": speed, "mode": mode, "arrival": arrival})
        comparisons = []
        for speed in (0.25, 0.5, 1):
            execute_time = statistics.median(row["arrival"] for row in results
                                             if row["speed"] == speed and row["mode"] == "execute")
            drag_time = statistics.median(row["arrival"] for row in results
                                          if row["speed"] == speed and row["mode"] == "drag")
            comparisons.append({"speed": speed, "execute_s": execute_time,
                                "drag_s": drag_time, "ratio": drag_time / execute_time})
        parked = await client.command("prepare_shutdown", speed_scale=0.2)
        assert parked["status"] == "completed", parked
        print(json.dumps({"samples": results, "medians": comparisons}, indent=2))
        assert all(0.9 <= row["ratio"] <= 1.1 for row in comparisons), comparisons


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="ws://127.0.0.1:8799")
    parser.add_argument("--repeats", type=int, choices=range(1, 11), default=3)
    args = parser.parse_args()
    asyncio.run(benchmark(args.url, args.repeats))
