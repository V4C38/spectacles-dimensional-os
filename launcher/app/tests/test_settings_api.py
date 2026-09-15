"""Settings persistence must read launcher/.env, not the repo directory."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

import app as launcher_app
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


@pytest.mark.asyncio
async def test_settings_put_does_not_run_dependency_check(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / "launcher").mkdir()
    target = env_path(tmp_path)
    monkeypatch.setattr(launcher_app, "env_path", lambda: target)
    monkeypatch.setattr(launcher_app.manager, "root", tmp_path)

    with patch.object(launcher_app.manager, "run_check", new=AsyncMock()) as mock_check:
        snap = await launcher_app.api_settings_put(
            launcher_app.SettingsBody(openai_api_key="sk-test"),
        )

    mock_check.assert_not_called()
    assert read_env(target)["OPENAI_API_KEY"] == "sk-test"
    assert snap["openai_api_key"] == "sk-test"
    assert snap["fiducial_marker"] is False
    assert snap["dimos_log_level"] == "INFO"


@pytest.mark.asyncio
async def test_settings_put_writes_dimos_log_level(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "launcher").mkdir()
    target = env_path(tmp_path)
    monkeypatch.setattr(launcher_app, "env_path", lambda: target)
    monkeypatch.setattr(launcher_app.manager, "root", tmp_path)

    snap = await launcher_app.api_settings_put(
        launcher_app.SettingsBody(dimos_log_level="DEBUG"),
    )

    assert read_env(target)["DIMOS_LOG_LEVEL"] == "DEBUG"
    assert snap["dimos_log_level"] == "DEBUG"


@pytest.mark.asyncio
async def test_settings_put_writes_dimos_armodule_section(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from dimos_config import load_dimos_config

    (tmp_path / "launcher").mkdir()
    target = env_path(tmp_path)
    monkeypatch.setattr(launcher_app, "env_path", lambda: target)
    monkeypatch.setattr(launcher_app.manager, "root", tmp_path)

    snap = await launcher_app.api_settings_put(
        launcher_app.SettingsBody(
            fiducial_marker=True,
            vps=True,
            map_code="map-9",
            mounts=[launcher_app.MountBody()],
            openai_api_key="sk-test",
        )
    )

    data = load_dimos_config()
    assert data["armodule"]["localization"]["providers"] == [
        {"type": "fiducial_marker"},
        {"type": "vps", "map_code": "map-9"},
    ]
    assert data["armodule"]["fiducial_marker_mounts"][0]["marker_id"] == 0
    assert snap["fiducial_marker"] is True
    assert snap["vps"] is True
    assert snap["map_code"] == "map-9"
    assert snap["mounts"][0]["marker_id"] == 0


@pytest.mark.asyncio
async def test_settings_put_writes_multiple_fiducial_mounts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from dimos_config import load_dimos_config

    (tmp_path / "launcher").mkdir()
    monkeypatch.setattr(launcher_app, "env_path", lambda: env_path(tmp_path))
    monkeypatch.setattr(launcher_app.manager, "root", tmp_path)

    snap = await launcher_app.api_settings_put(
        launcher_app.SettingsBody(
            fiducial_marker=True,
            mounts=[
                launcher_app.MountBody(marker_id=0),
                launcher_app.MountBody(marker_id=2, forward_m=0.1),
            ],
        )
    )

    data = load_dimos_config()
    assert [item["marker_id"] for item in data["armodule"]["fiducial_marker_mounts"]] == [0, 2]
    assert [item["marker_id"] for item in snap["mounts"]] == [0, 2]


@pytest.mark.asyncio
async def test_settings_put_rejects_duplicate_marker_ids(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from fastapi import HTTPException

    (tmp_path / "launcher").mkdir()
    monkeypatch.setattr(launcher_app, "env_path", lambda: env_path(tmp_path))
    monkeypatch.setattr(launcher_app.manager, "root", tmp_path)

    with pytest.raises(HTTPException) as exc_info:
        await launcher_app.api_settings_put(
            launcher_app.SettingsBody(
                fiducial_marker=True,
                mounts=[
                    launcher_app.MountBody(marker_id=0),
                    launcher_app.MountBody(marker_id=0),
                ],
            )
        )
    assert exc_info.value.status_code == 400
    assert "unique" in str(exc_info.value.detail)
