"""`.env` merge + permissions."""

from __future__ import annotations

import os
import stat
from pathlib import Path

from config import merge_env, read_env


def test_merge_preserves_other_keys(tmp_path: Path) -> None:
    path = tmp_path / ".env"
    path.write_text("FOO=bar\nOPENAI_API_KEY=old\nBAZ=1\n", encoding="utf-8")
    merge_env({"OPENAI_API_KEY": "new-key", "ROBOT_IP": "10.0.0.1"}, path)
    values = read_env(path)
    assert values["FOO"] == "bar"
    assert values["BAZ"] == "1"
    assert values["OPENAI_API_KEY"] == "new-key"
    assert values["ROBOT_IP"] == "10.0.0.1"
    mode = stat.S_IMODE(os.stat(path).st_mode)
    assert mode == 0o600


def test_merge_removes_key_when_none(tmp_path: Path) -> None:
    path = tmp_path / ".env"
    path.write_text("OPENAI_API_KEY=secret\nROBOT_IP=1.2.3.4\n", encoding="utf-8")
    merge_env({"ROBOT_IP": None}, path)
    values = read_env(path)
    assert "ROBOT_IP" not in values
    assert values["OPENAI_API_KEY"] == "secret"


def test_read_strips_quotes(tmp_path: Path) -> None:
    path = tmp_path / ".env"
    path.write_text('OPENAI_API_KEY="abc123"\n', encoding="utf-8")
    assert read_env(path)["OPENAI_API_KEY"] == "abc123"
