"""Saving settings re-runs setup check without UI warnings."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from bridge import ProcessManager


@pytest.mark.asyncio
async def test_run_check_does_not_set_openai_warning(tmp_path: Path) -> None:
    scripts = tmp_path / "launcher" / "scripts"
    scripts.mkdir(parents=True)
    (scripts / "setup.sh").write_text("#!/bin/sh\n", encoding="utf-8")

    mgr = ProcessManager(root=tmp_path)

    async def fake_run(argv, *, env, on_line):  # type: ignore[no-untyped-def]
        await on_line("CHECK_OK_GO2=1")
        await on_line("OPENAI_API_KEY = false")
        return 0

    with patch.object(mgr, "_run_tracked", new=fake_run):
        snap = await mgr.run_check()

    assert snap["ready_go2"] is True
    assert snap["warning"] is None
