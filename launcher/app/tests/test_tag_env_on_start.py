"""Start injects CLI secret env names; incomplete VPS is rejected."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from armodule import Phase, ProcessManager
from config import env_path, merge_env
from dimos_config import merge_armodule_config
from tag_config import DEFAULT_MOUNT, armodule_config_from_ui


def _scripts(tmp_path: Path) -> None:
    (tmp_path / "launcher" / "scripts").mkdir(parents=True)
    (tmp_path / "launcher" / "scripts" / "start.sh").write_text("#!/bin/sh\n", encoding="utf-8")
    (tmp_path / "launcher" / "scripts" / "configure-system.sh").write_text(
        "#!/bin/sh\nexit 0\n", encoding="utf-8"
    )


@pytest.mark.asyncio
async def test_start_armodule_injects_secret_env(tmp_path: Path) -> None:
    _scripts(tmp_path)
    merge_env(
        {
            "OPENAI_API_KEY": "sk-persisted",
            "MULTISET_CLIENT_ID": "id-1",
            "MULTISET_CLIENT_SECRET": "secret-1",
            "DIMOS_LOG_LEVEL": "DEBUG",
        },
        env_path(tmp_path),
    )

    mgr = ProcessManager(root=tmp_path)
    captured: dict[str, str] = {}

    async def fake_spawn(argv, *, env, parse_armodule):  # type: ignore[no-untyped-def]
        captured.update(env)

    with (
        patch.object(mgr, "port_in_use", return_value=False),
        patch.object(mgr, "_configure_system_if_needed", new=AsyncMock()),
        patch.object(mgr, "_spawn", new=fake_spawn),
    ):
        await mgr.start_armodule(blueprint="unitree_go2_ar", client="specs")

    assert captured["OPENAI_API_KEY"] == "sk-persisted"
    assert captured["MULTISET_CLIENT_ID"] == "id-1"
    assert captured["MULTISET_CLIENT_SECRET"] == "secret-1"
    assert captured["DIMOS_LOG_LEVEL"] == "DEBUG"
    assert "DIMOS_AR_TAG_MOUNTS" not in captured
    assert "--blueprint" in mgr.build_start_argv(blueprint="unitree_go2_ar")


@pytest.mark.asyncio
async def test_start_armodule_defaults_log_level_to_info(tmp_path: Path) -> None:
    _scripts(tmp_path)
    mgr = ProcessManager(root=tmp_path)
    captured: dict[str, str] = {}

    async def fake_spawn(argv, *, env, parse_armodule):  # type: ignore[no-untyped-def]
        captured.update(env)

    with (
        patch.object(mgr, "port_in_use", return_value=False),
        patch.object(mgr, "_configure_system_if_needed", new=AsyncMock()),
        patch.object(mgr, "_spawn", new=fake_spawn),
    ):
        await mgr.start_armodule(blueprint="unitree_go2_ar", client="specs")

    assert captured["DIMOS_LOG_LEVEL"] == "INFO"


@pytest.mark.asyncio
async def test_start_armodule_rejects_incomplete_vps(tmp_path: Path) -> None:
    _scripts(tmp_path)
    merge_armodule_config(
        armodule_config_from_ui(
            fiducial_marker=False,
            vps=True,
            map_code="",
            mounts=[DEFAULT_MOUNT],
        )
    )
    mgr = ProcessManager(root=tmp_path)
    with pytest.raises(ValueError, match="VPS is enabled"):
        await mgr.start_armodule(blueprint="unitree_go2_ar", client="specs")


@pytest.mark.asyncio
async def test_start_webxr_composes_local_and_network_urls(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _scripts(tmp_path)
    monkeypatch.setattr("armodule.detect_lan_ip", lambda: "10.0.0.8")
    mgr = ProcessManager(root=tmp_path)

    async def fake_spawn(argv, *, env, parse_armodule):  # type: ignore[no-untyped-def]
        return None

    with (
        patch.object(mgr, "port_in_use", return_value=False),
        patch.object(mgr, "_configure_system_if_needed", new=AsyncMock()),
        patch.object(mgr, "_ensure_webxr_deps", new=AsyncMock()),
        patch.object(mgr, "_spawn_webxr", new=AsyncMock()),
        patch.object(mgr, "_spawn", new=fake_spawn),
    ):
        await mgr.start_armodule(blueprint="unitree_go2_ar", client="webxr")

    assert mgr.status.webxr_local_url == "https://localhost:5173"
    assert mgr.status.webxr_url == "https://10.0.0.8:5173"
    assert mgr.status.host_ip == "10.0.0.8"
    assert mgr.status.client == "webxr"


@pytest.mark.asyncio
async def test_webxr_exit_stops_armodule(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    mgr.status.phase = Phase.RUNNING
    mgr.status.check_ok = True
    mgr._proc = object()  # type: ignore[assignment]
    mgr._webxr_proc = object()  # type: ignore[assignment]

    with (
        patch.object(mgr, "_stop_one", new=AsyncMock(return_value=True)),
        patch.object(mgr, "_cancel_task", new=AsyncMock()),
    ):
        await mgr._finalize_exit("WebXR Vite exited")

    assert mgr.status.phase == Phase.ERROR
    assert mgr.status.error == "WebXR Vite exited"
    assert mgr.status.webxr_url is None
    assert mgr._proc is None
    assert mgr._webxr_proc is None


@pytest.mark.asyncio
async def test_start_webxr_rejects_occupied_port(tmp_path: Path) -> None:
    _scripts(tmp_path)
    mgr = ProcessManager(root=tmp_path)

    def ports(port: int = 8787) -> bool:
        return port == 5173

    with (
        patch.object(mgr, "port_in_use", side_effect=ports),
        pytest.raises(RuntimeError, match="5173"),
    ):
        await mgr.start_armodule(blueprint="unitree_go2_ar", client="webxr")
