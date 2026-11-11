"""`.env` merge + permissions."""

from __future__ import annotations

import os
import stat
from pathlib import Path

import pytest

from config import merge_env, normalize_log_level, read_env


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


def test_normalize_log_level_defaults_and_uppercases() -> None:
    assert normalize_log_level(None) == "INFO"
    assert normalize_log_level("") == "INFO"
    assert normalize_log_level("debug") == "DEBUG"
    assert normalize_log_level("TRACE") == "INFO"


@pytest.mark.parametrize("separator", ["\n", "\r", "\v", "\f", "\x1c", "\x1d", "\x1e", "\x85", "\u2028", "\u2029", "\0"])
@pytest.mark.parametrize("existing", [False, True])
def test_merge_rejects_record_separators_before_writing(tmp_path, separator, existing):
    path = tmp_path / ".env"
    original = b"OPENAI_API_KEY=unchanged\nOTHER=keep\n" if existing else b""
    if existing:
        path.write_bytes(original)
    with pytest.raises(ValueError, match="one line"):
        merge_env({"OTHER": "new", "OPENAI_API_KEY": f"abc{separator}MULTISET_CLIENT_ID=changed"}, path)
    if existing:
        assert path.read_bytes() == original
    else:
        assert not path.exists()
