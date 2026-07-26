"""OPENAI_API_KEY is read from launcher/.env when starting the bridge."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from bridge import ProcessManager


@pytest.mark.asyncio
async def test_start_bridge_reads_openai_key_from_env(tmp_path: Path) -> None:
    (tmp_path / "launcher" / "scripts").mkdir(parents=True)
    (tmp_path / "launcher" / "scripts" / "start.sh").write_text("#!/bin/sh\n", encoding="utf-8")
    (tmp_path / "launcher" / "scripts" / "configure-system.sh").write_text(
        "#!/bin/sh\nexit 0\n", encoding="utf-8"
    )
    (tmp_path / "launcher" / ".env").write_text("OPENAI_API_KEY=sk-persisted\n", encoding="utf-8")

    mgr = ProcessManager(root=tmp_path)
    captured: dict[str, str] = {}

    async def fake_spawn(argv, *, env, parse_bridge):  # type: ignore[no-untyped-def]
        captured.update(env)

    with (
        patch.object(mgr, "port_in_use", return_value=False),
        patch.object(mgr, "_configure_system_if_needed", new=AsyncMock()),
        patch.object(mgr, "_spawn", new=fake_spawn),
    ):
        await mgr.start_bridge(stack="go2")

    assert captured["OPENAI_API_KEY"] == "sk-persisted"
