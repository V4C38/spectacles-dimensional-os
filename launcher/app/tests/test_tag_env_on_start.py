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
    assert "DIMOS_PYTHON" not in captured
    assert "--blueprint" in mgr.build_start_argv(blueprint="unitree_go2_ar")


@pytest.mark.asyncio
async def test_start_armodule_pins_checked_dimos_python(tmp_path: Path) -> None:
    _scripts(tmp_path)
    mgr = ProcessManager(root=tmp_path)
    mgr.status.dimos_python = "/tmp/dimos/.venv/bin/python3"
    captured: dict[str, str] = {}

    async def fake_spawn(argv, *, env, parse_armodule):  # type: ignore[no-untyped-def]
        captured.update(env)

    with (
        patch.object(mgr, "port_in_use", return_value=False),
        patch.object(mgr, "_configure_system_if_needed", new=AsyncMock()),
        patch.object(mgr, "_spawn", new=fake_spawn),
    ):
        await mgr.start_armodule(blueprint="unitree_go2_ar", client="specs")

    assert captured["DIMOS_PYTHON"] == "/tmp/dimos/.venv/bin/python3"


@pytest.mark.asyncio
async def test_start_armodule_drops_inherited_dimos_python(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _scripts(tmp_path)
    monkeypatch.setenv(
        "DIMOS_PYTHON",
        "/Users/me/.local/share/uv/python/cpython-3.12.12/bin/python3.12",
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

    assert "DIMOS_PYTHON" not in captured


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
async def test_start_clears_dimos_and_ports_before_spawn(tmp_path: Path) -> None:
    _scripts(tmp_path)
    mgr = ProcessManager(root=tmp_path)
    order: list[str] = []

    async def clear(*, client: str) -> None:
        order.append(f"clear:{client}")

    async def fake_spawn(argv, *, env, parse_armodule):  # type: ignore[no-untyped-def]
        order.append("spawn")

    with (
        patch.object(mgr, "_clear_before_start", new=clear),
        patch.object(mgr, "_configure_system_if_needed", new=AsyncMock()),
        patch.object(mgr, "_spawn", new=fake_spawn),
    ):
        await mgr.start_armodule(blueprint="unitree_go2_ar", client="specs")

    assert order == ["clear:specs", "spawn"]


@pytest.mark.real_clear
@pytest.mark.asyncio
async def test_clear_before_start_kills_dimos_then_ports(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    killed: list[int] = []

    async def dimos_pids() -> list[int]:
        return [111]

    async def kill_port(port: int) -> bool:
        killed.append(port)
        return True

    with (
        patch.object(mgr, "_running_dimos_pids", new=dimos_pids),
        patch.object(mgr, "_stop_pids", new=AsyncMock()) as stop_pids,
        patch.object(mgr, "_kill_port_listeners", new=kill_port),
        patch.object(mgr, "port_in_use", return_value=False),
    ):
        await ProcessManager._clear_before_start(mgr, client="webxr")

    stop_pids.assert_awaited_once_with([111], "existing DimOS process(es)")
    assert killed == [8787, 3030, 9877, 5173]
