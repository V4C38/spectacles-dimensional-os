"""Settings tests must never write outside their temporary stores."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import app
import preferences
from config import env_path


def test_app_global_stores_are_rebound_after_collection(tmp_path: Path) -> None:
    assert app.manager.root == tmp_path
    assert app.robot_profiles.path == tmp_path / "xdg-config/dimos/ar-profiles.json"
    assert preferences.path() == tmp_path / "xdg-config/dimos/ar-launcher.json"
    assert env_path() == tmp_path / "launcher/.env"


def test_settings_suite_preserves_preexisting_user_files(tmp_path: Path) -> None:
    """The child imports app during collection, before any autouse fixture runs."""
    user_config = tmp_path / "user-config/dimos"
    user_config.mkdir(parents=True)
    sentinels = {
        user_config / "ar-profiles.json": json.dumps([{
            "id": "keep-identity", "name": "User robot", "robot": "unitree_go2",
            "armodule": {"localization": {"providers": [
                {"type": "vps", "map_code": "USER_MAP"},
            ]}},
        }]).encode(),
        user_config / "config": b'{"keep":"native config"}',
        user_config / "ar-launcher.json": b'{"keep":"preferences"}',
    }
    for path, value in sentinels.items():
        path.write_bytes(value)
    root = Path(__file__).resolve().parents[1]
    repository_env = root.parent / ".env"
    original_env = repository_env.read_bytes() if repository_env.exists() else None
    child = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "tests/test_settings_api.py"],
        check=False,
        cwd=root, env={**os.environ, "XDG_CONFIG_HOME": str(user_config.parent)},
        capture_output=True, text=True, timeout=60,
    )
    assert child.returncode == 0, child.stdout + child.stderr
    for path, value in sentinels.items():
        assert path.read_bytes() == value, f"Settings test modified {path.name}"
    assert (repository_env.read_bytes() if repository_env.exists() else None) == original_env
