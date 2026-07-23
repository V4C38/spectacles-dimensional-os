"""System-config elevation gating."""

from __future__ import annotations

from pathlib import Path

import bridge
from bridge import ProcessManager


def test_configure_noop_off_darwin(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(bridge.sys, "platform", "linux")
    mgr = ProcessManager(root=tmp_path)

    import asyncio

    # Must return without touching osascript / raising on non-macOS.
    asyncio.run(mgr._configure_system_if_needed())


def test_configure_helper_path_points_at_scripts(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    assert mgr.scripts.name == "scripts"
    assert mgr.scripts.parent.name == "launcher"


def test_real_helper_exists() -> None:
    mgr = ProcessManager()
    assert (mgr.scripts / "configure-system.sh").exists()
