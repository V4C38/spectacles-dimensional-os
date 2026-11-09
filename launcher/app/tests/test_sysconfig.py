"""System-config elevation gating."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

import armodule
from armodule import ProcessManager


def test_configure_noop_off_darwin(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(armodule.sys, "platform", "linux")
    mgr = ProcessManager(root=tmp_path)
    spawn = AsyncMock()
    monkeypatch.setattr(armodule.asyncio, "create_subprocess_exec", spawn)

    import asyncio

    # Must return without touching osascript / raising on non-macOS.
    asyncio.run(mgr._configure_system_if_needed())
    spawn.assert_not_awaited()
