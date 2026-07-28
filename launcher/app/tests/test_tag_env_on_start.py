"""Bridge start includes DIMOS_AR_TAG_MOUNTS from persisted tag config."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from bridge import ProcessManager
from tag_config import save_tag_config


@pytest.mark.asyncio
async def test_start_bridge_sets_tag_mounts_env(tmp_path: Path) -> None:
    (tmp_path / "launcher" / "scripts").mkdir(parents=True)
    (tmp_path / "launcher" / "scripts" / "start.sh").write_text("#!/bin/sh\n", encoding="utf-8")
    (tmp_path / "launcher" / "scripts" / "configure-system.sh").write_text(
        "#!/bin/sh\nexit 0\n", encoding="utf-8"
    )
    save_tag_config(
        {
            "go2": [
                {
                    "tag_id": 3,
                    "forward_m": 0.2,
                    "lateral_m": 0.0,
                    "up_m": 0.07,
                    "yaw_deg": -90,
                    "pitch_deg": -15,
                }
            ],
            "g1": [],
        },
        tmp_path,
    )

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

    assert "DIMOS_AR_TAG_MOUNTS" in captured
    mounts = json.loads(captured["DIMOS_AR_TAG_MOUNTS"])
    by_id = {m["tag_id"]: m for m in mounts}
    assert 0 in by_id  # profile default retained
    assert by_id[3]["position"] == [0.2, 0.0, 0.07]
