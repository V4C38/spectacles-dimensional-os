"""Read-only SocketCAN inspection and construction of the official setup command."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any

INTERFACE = "can0"
BITRATE = 1_000_000
TX_QUEUE_LENGTH = 1_000


def unavailable(state: str, message: str) -> dict[str, Any]:
    return {"interface": INTERFACE, "ready": False, "state": state, "message": message}


def inspect_link(links: list[dict[str, Any]]) -> dict[str, Any]:
    link = next((item for item in links if item.get("ifname") == INTERFACE), None)
    if link is None:
        return unavailable("missing", "Connect the CAN adapter; can0 was not found.")
    info = link.get("linkinfo", {})
    data = info.get("info_data", {})
    bitrate = data.get("bittiming", {}).get("bitrate")
    queue = link.get("txqlen")
    result = {
        "interface": INTERFACE,
        "bitrate": bitrate,
        "txqueuelen": queue,
        "bus_state": data.get("state"),
        "ready": False,
    }
    if info.get("info_kind") != "can":
        return {
            **result,
            "state": "error",
            "message": "can0 is not a SocketCAN interface.",
        }
    if "UP" not in link.get("flags", []):
        return {
            **result,
            "state": "down",
            "message": "can0 is down. Set up CAN to continue.",
        }
    if bitrate != BITRATE or queue != TX_QUEUE_LENGTH:
        return {
            **result,
            "state": "unconfigured",
            "message": "can0 needs 1 Mbit/s and a transmit queue of 1000.",
        }
    if data.get("state") in {"BUS-OFF", "STOPPED", "SLEEPING"}:
        return {
            **result,
            "state": "bus_off",
            "message": "CAN bus is not operational. Check the adapter and arm connection.",
        }
    return {
        **result,
        "ready": True,
        "state": "ready",
        "message": "can0 ready · 1 Mbit/s",
    }


async def check_can() -> dict[str, Any]:
    if sys.platform != "linux":
        return {
            **unavailable(
                "not_required", "SocketCAN setup is not required on this platform."
            ),
            "ready": True,
        }
    executable = shutil.which("ip")
    if executable is None:
        return unavailable("error", "Install iproute2 to check and configure CAN.")
    proc = None
    try:
        proc = await asyncio.create_subprocess_exec(
            executable,
            "-details",
            "-json",
            "link",
            "show",
            "type",
            "can",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, err = await asyncio.wait_for(proc.communicate(), timeout=3)
        if proc.returncode:
            return unavailable(
                "error",
                err.decode(errors="replace").strip()
                or "Cannot inspect CAN interfaces.",
            )
        links = json.loads(out)
        if not isinstance(links, list):
            raise TypeError("Expected an interface list")
        return inspect_link(links)
    except (OSError, TimeoutError, ValueError, TypeError, AttributeError) as exc:
        return unavailable("error", f"Cannot inspect CAN: {exc}")
    finally:
        if proc is not None and proc.returncode is None:
            proc.kill()
            await proc.wait()


def setup_command(python: str) -> list[str]:
    if sys.platform != "linux":
        raise ValueError("SocketCAN configuration is only available on Linux")
    if not Path(python).is_file():
        raise ValueError("Select an installed DimOS environment first")
    command = [
        python,
        "-c",
        "from dimos.cli.dimos import cli_main; cli_main()",
        "hardware",
        "can",
        "setup",
        INTERFACE,
    ]
    if os.geteuid() != 0:
        pkexec = shutil.which("pkexec")
        if pkexec is None:
            raise ValueError("Install polkit (pkexec) to use the administrator prompt")
        command.insert(0, pkexec)
    return command
