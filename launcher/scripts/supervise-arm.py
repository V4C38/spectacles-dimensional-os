"""Keep the coordinator alive while an orderly stop attempts to park the arm."""

from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
import time

from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed


async def prepare_shutdown() -> None:
    """Use compact v2 control facts; parking requires no visual model assets."""
    bulk_task: asyncio.Task[None] | None = None
    try:
        async with asyncio.timeout(60):
            async with connect("ws://127.0.0.1:8787", max_size=64 * 1024) as ws:
                await ws.send(
                    json.dumps({"type": "hello_request", "protocol_version": 2, "ts_client": time.time()})
                )
                hello = False
                state = None
                arm = None
                sent = False
                async for raw in ws:
                    if not isinstance(raw, str):
                        continue
                    for line in raw.splitlines():
                        message = json.loads(line)
                        if message.get("type") == "hello":
                            if message.get("protocol_version") != 2:
                                raise ValueError("shutdown requires protocol v2")
                            hello = True
                            from urllib.parse import urljoin

                            async def hold_bulk(info=message):
                                url = urljoin(
                                    "ws://127.0.0.1:8787/", info["bulk_url"]
                                )
                                async with connect(url, max_size=64 * 1024) as bulk:
                                    await bulk.send(
                                        json.dumps(
                                            {
                                                "type": "bulk_hello_request",
                                                "protocol_version": 2,
                                                "client_id": info["client_id"],
                                                "token": info["bulk_token"],
                                            }
                                        )
                                    )
                                    async for _record in bulk:
                                        pass  # Visual assets are not needed for parking.

                            bulk_task = asyncio.create_task(hold_bulk())
                        elif message.get("type") == "interaction_state":
                            state = message
                        elif message.get("type") == "manipulation_state":
                            arm = message
                        if hello and state and arm and not sent:
                            if arm.get("stopped"):
                                print(
                                    "Shutdown: E-stop active; zero-pose motion skipped.",
                                    flush=True,
                                )
                                return
                            if (
                                state.get("mode") != "manual"
                                or state.get("authority") is not None
                                or state.get("motion_busy")
                            ):
                                print(
                                    "Shutdown: robot busy; zero-pose motion skipped.",
                                    flush=True,
                                )
                                return
                            groups = arm.get("groups") or []
                            if not groups:
                                continue
                            sent = True
                            print(
                                "Shutdown: returning arm to zero (maximum 60 seconds)…",
                                flush=True,
                            )
                            await ws.send(
                                json.dumps(
                                    {
                                        "type": "manipulation_request",
                                        "request_id": "shutdown-zero",
                                        "action": "prepare_shutdown",
                                        "group_id": groups[0]["id"],
                                        "epoch": state["epoch"],
                                        "speed_scale": 0.2,
                                    }
                                )
                            )
                        if sent and message.get("request_id") == "shutdown-zero":
                            print(
                                "Shutdown zero result: "
                                + str(message.get("message") or message.get("status")),
                                flush=True,
                            )
                            return
    except (OSError, TimeoutError, ValueError, TypeError, KeyError, ConnectionClosed) as exc:
        print(
            f"Shutdown: zero pose not confirmed ({type(exc).__name__}: "
            f"{str(exc) or 'no parking response within 60 seconds'}); "
            "proceeding with requested shutdown.",
            flush=True,
        )
    finally:
        if bulk_task is not None:
            bulk_task.cancel()
            await asyncio.gather(bulk_task, return_exceptions=True)


async def main(command: list[str]) -> int:
    child = await asyncio.create_subprocess_exec(*command, start_new_session=True)
    requested = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, requested.set)
    exited = asyncio.create_task(child.wait())
    stopping = asyncio.create_task(requested.wait())
    await asyncio.wait({exited, stopping}, return_when=asyncio.FIRST_COMPLETED)
    if child.returncode is None:
        parking = asyncio.create_task(prepare_shutdown())
        await asyncio.wait({parking, exited}, return_when=asyncio.FIRST_COMPLETED)
        if child.returncode is not None:
            parking.cancel()
            await asyncio.gather(parking, return_exceptions=True)
            stopping.cancel()
            return child.returncode or 0
        await parking
        try:
            os.killpg(child.pid, signal.SIGINT)
        except ProcessLookupError:
            pass
        try:
            await asyncio.wait_for(asyncio.shield(exited), 60)
        except TimeoutError:
            print(
                "DimOS shutdown timed out; terminating its process group.", flush=True
            )
            os.killpg(child.pid, signal.SIGKILL)
            await exited
    stopping.cancel()
    return child.returncode or 0


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--":
        args.pop(0)
    raise SystemExit(asyncio.run(main(args)))
