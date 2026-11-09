"""Bounded, non-actuating discovery through the selected DimOS environment."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any


async def run_json_probe(
    python: str, *arguments: str, timeout: float, error: str | None = None
) -> Any:
    proc = await asyncio.create_subprocess_exec(
        python, *arguments, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
        if proc.returncode and error:
            raise ValueError(err.decode(errors="replace")[-2000:] or error)
        lines = out.decode().splitlines()
        if not lines:
            raise ValueError(error or "Probe returned no JSON")
        return json.loads(lines[-1])
    finally:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()


async def discover_devices(python: str, robot: str) -> list[dict[str, Any]]:
    if robot not in {"unitree_go2", "openyam"}:
        raise ValueError("Unknown robot type")
    helper = Path(__file__).resolve().parents[1] / "scripts" / "robot_discovery.py"
    return await run_json_probe(python, str(helper), robot, timeout=8, error="Discovery failed")


async def validate_replay(python: str, path: str, robot: str = "unitree_go2", streams: dict[str, str] | None = None) -> dict[str, Any]:
    code = """import json,sys
from dimos.ar.replay import inspect_recording
print(json.dumps(inspect_recording(sys.argv[1], sys.argv[2], json.loads(sys.argv[3]))))
"""
    return await run_json_probe(
        python, "-c", code, path, robot, json.dumps(streams or {}),
        timeout=30, error="Replay validation failed",
    )
