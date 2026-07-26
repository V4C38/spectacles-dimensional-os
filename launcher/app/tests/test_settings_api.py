"""Settings persistence must read launcher/.env, not the repo directory."""

from __future__ import annotations

from pathlib import Path

from config import env_path, merge_env, migrate_legacy_env, read_env


def test_settings_read_uses_launcher_env_file(tmp_path: Path) -> None:
    merge_env({"OPENAI_API_KEY": "sk-test"}, env_path(tmp_path))

    assert read_env(env_path(tmp_path))["OPENAI_API_KEY"] == "sk-test"
    assert read_env(tmp_path).get("OPENAI_API_KEY") is None


def test_migrate_legacy_repo_env(tmp_path: Path) -> None:
    (tmp_path / "launcher").mkdir()
    (tmp_path / ".env").write_text("OPENAI_API_KEY=sk-legacy\nROBOT_IP=1.2.3.4\n", encoding="utf-8")

    migrate_legacy_env(tmp_path)

    values = read_env(env_path(tmp_path))
    assert values["OPENAI_API_KEY"] == "sk-legacy"
    assert values["ROBOT_IP"] == "1.2.3.4"
