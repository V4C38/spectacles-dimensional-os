"""Linux dependency setup propagates apt policy and fails before later commands."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/install-ci-system-deps.sh"


@pytest.mark.parametrize("failure", [False, True])
def test_linux_dependency_policy(tmp_path: Path, failure: bool) -> None:
    tools = tmp_path / "bin"
    tools.mkdir()
    (tools / "uname").write_text("#!/bin/sh\necho Linux\n")
    sudo = tools / "sudo"
    sudo.write_text(
        "#!/usr/bin/env python3\n"
        "import json, os, pathlib, sys\n"
        "config = pathlib.Path(os.environ['APT_CONFIG'])\n"
        "with open(os.environ['COMMAND_LOG'], 'a') as log:\n"
        "    log.write(json.dumps({'args': sys.argv[1:], 'config': str(config), "
        "'policy': config.read_text()}) + '\\n')\n"
        "sys.exit(100 if os.environ['FAIL_APT'] == '1' else 0)\n"
    )
    for tool in tools.iterdir():
        tool.chmod(0o755)
    log = tmp_path / "commands.jsonl"
    result = subprocess.run(
        ["bash", str(SCRIPT), "webxr"],
        env={**os.environ, "PATH": f"{tools}:{os.environ['PATH']}",
             "COMMAND_LOG": str(log), "FAIL_APT": "1" if failure else "0"},
        capture_output=True, text=True, check=False,
    )
    rows = [json.loads(line) for line in log.read_text().splitlines()]
    assert result.returncode == (100 if failure else 0)
    assert len(rows) == (1 if failure else 3)
    for row in rows:
        assert row["args"][0] == "--preserve-env=APT_CONFIG"
        assert 'APT::Update::Error-Mode "any"' in row["policy"]
        assert 'Acquire::Retries "2"' in row["policy"]
        assert not Path(row["config"]).exists()
    if not failure:
        assert rows[-1]["args"][-2:] == ["install-deps", "chromium"]
