"""Thin FastAPI UI wrapper around launcher/scripts/setup.sh and start.sh."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from apriltag_assets import decode_marker_id, ensure_pdf, ensure_png
from armodule import ProcessManager
from config import env_path, merge_env, normalize_log_level, read_env, repo_root
from dimos_config import merge_armodule_config, read_armodule_config
from robot_profiles import RobotProfiles
from tag_config import (
    DEFAULT_MOUNT,
    PRESET_MARKER_IDS,
    armodule_config_from_ui,
    normalize_ui_mounts,
    ui_from_armodule_config,
)

STATIC_DIR = Path(__file__).resolve().parent / "static"
DIMOS_REMOTE = "https://github.com/dimensionalOS/dimos"
logger = logging.getLogger(__name__)
manager = ProcessManager()
robot_profiles = RobotProfiles()


def require_local_launcher(request: Request) -> None:
    """Reject non-loopback clients (server binds 127.0.0.1 only)."""
    client = request.client.host if request.client else ""
    if client not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(status_code=403, detail="launcher is localhost-only")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    check_task = asyncio.create_task(manager.ensure_check())
    try:
        yield
    finally:
        if not check_task.done():
            check_task.cancel()
            try:
                await check_task
            except asyncio.CancelledError:
                pass
        try:
            await manager.stop_armodule()
        except Exception:
            logger.exception("ARModule stop during launcher shutdown failed")


app = FastAPI(title="DimOS ARModule", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


class SetupBody(BaseModel):
    manipulation: bool = False
    mode: Literal["existing", "clone"] = "clone"
    dimos_python: str | None = None
    clone_dir: str | None = None
    dimos_ref: str | None = None


class StartBody(BaseModel):
    profile_id: str | None = None
    simulation: bool = False
    blueprint: Literal["unitree_go2_ar", "unitree_go2_ar_agentic", "openyam_ar_planner"]
    client: Literal["specs", "webxr"]
    robot_ip: str | None = None


class MountBody(BaseModel):
    marker_id: int = 0
    print_size_mm: float = 70.0
    forward_m: float = 0.18
    lateral_m: float = 0.0
    up_m: float = 0.06
    yaw_deg: float = -90.0
    pitch_deg: float = -15.0
    roll_deg: float = 0.0


class SettingsBody(BaseModel):
    profile_id: str | None = None
    openai_api_key: str | None = None
    multiset_client_id: str | None = None
    multiset_client_secret: str | None = None
    fiducial_marker: bool = False
    vps: bool = False
    vps_vendor: Literal["multiset"] = "multiset"
    map_code: str | None = None
    mounts: list[MountBody] | None = None
    dimos_log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] | None = None


def _blank_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def settings_payload() -> dict[str, Any]:
    stored = read_env(env_path())
    ui = ui_from_armodule_config(read_armodule_config())
    return {
        "openai_api_key": stored.get("OPENAI_API_KEY", ""),
        "multiset_client_id": stored.get("MULTISET_CLIENT_ID", ""),
        "multiset_client_secret": stored.get("MULTISET_CLIENT_SECRET", ""),
        "dimos_log_level": normalize_log_level(stored.get("DIMOS_LOG_LEVEL")),
        "fiducial_marker": ui["fiducial_marker"],
        "vps": ui["vps"],
        "vps_vendor": ui["vps_vendor"],
        "map_code": ui["map_code"],
        "mounts": ui["mounts"],
        "defaults": {
            "mounts": [dict(DEFAULT_MOUNT)],
            "preset_marker_ids": list(PRESET_MARKER_IDS),
        },
    }


def _parse_dimos_refs(raw: str) -> list[str]:
    refs: list[str] = []
    seen: set[str] = set()
    for line in raw.splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        name = parts[1]
        if name.endswith("^{}"):
            continue
        prefix = "refs/heads/"
        tag_prefix = "refs/tags/"
        if name.startswith(prefix):
            short = name[len(prefix) :]
        elif name.startswith(tag_prefix):
            short = name[len(tag_prefix) :]
        else:
            continue
        if short in seen:
            continue
        seen.add(short)
        refs.append(short)
    if "main" in seen:
        refs.remove("main")
        refs.insert(0, "main")
    return refs


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/status")
async def api_status() -> dict[str, Any]:
    return manager.snapshot()


@app.get("/api/dimos-refs", dependencies=[Depends(require_local_launcher)])
async def api_dimos_refs() -> dict[str, Any]:
    try:
        proc = await asyncio.create_subprocess_exec(
            "git",
            "ls-remote",
            "--heads",
            "--tags",
            DIMOS_REMOTE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=500, detail="git is required to list DimOS refs"
        ) from exc
    out, err = await proc.communicate()
    if proc.returncode != 0:
        detail = err.decode("utf-8", errors="replace").strip() or "git ls-remote failed"
        raise HTTPException(status_code=502, detail=detail)
    refs = _parse_dimos_refs(out.decode("utf-8", errors="replace"))
    return {"refs": refs, "default": "main"}


@app.post("/api/browse-dimos-install", dependencies=[Depends(require_local_launcher)])
async def api_browse_dimos_install(request: Request) -> dict[str, str | None]:
    """Open a native folder chooser for an existing DimOS installation."""
    if not await asyncio.to_thread(_has_display):
        raise HTTPException(
            status_code=409, detail="A desktop file chooser is unavailable"
        )

    body = await request.json()
    current = str(body.get("path", "")).strip()
    start_dir = Path(current).expanduser() if current else Path.home()
    if start_dir.is_file():
        start_dir = start_dir.parent
    if start_dir.name == ".venv":
        start_dir = start_dir.parent
    start_dir = start_dir if start_dir.is_dir() else Path.home()
    try:
        if sys.platform == "darwin":
            proc = await asyncio.create_subprocess_exec(
                "osascript",
                "-e",
                'POSIX path of (choose folder with prompt "Select DimOS installation")',
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        else:
            chooser = shutil.which("zenity")
            if not chooser:
                raise HTTPException(
                    status_code=501, detail="Install zenity to use the folder chooser"
                )
            proc = await asyncio.create_subprocess_exec(
                chooser,
                "--file-selection",
                "--directory",
                "--title=Select DimOS installation folder",
                f"--filename={start_dir}/",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=501, detail="A native folder chooser is unavailable"
        ) from exc
    out, _ = await proc.communicate()
    if proc.returncode != 0:
        return {"path": None}
    return {"path": out.decode("utf-8", errors="replace").strip() or None}


def _has_display() -> bool:
    return sys.platform == "darwin" or bool(
        os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")
    )


def _resolve_dimos_python(path: str) -> str:
    """Accept either a DimOS checkout folder or its Python executable."""
    selected = Path(path).expanduser()
    if selected.is_dir():
        roots = [selected]
        if selected.name == ".venv" or selected.name == "venv":
            candidates = [
                selected / "bin" / executable for executable in ("python3", "python")
            ]
            roots = [selected.parent]
        else:
            candidates = []
        candidates.extend(
            [
                root / env_dir / "bin" / executable
                for root in roots
                for env_dir in (".venv", "venv")
                for executable in ("python3", "python")
            ]
        )
        candidates.extend(
            root / "bin" / executable
            for root in roots
            for executable in ("python3", "python")
        )
    else:
        candidates = [selected]
    for candidate in candidates:
        if not candidate.is_file() or not os.access(candidate, os.X_OK):
            continue
        try:
            subprocess.run(
                [str(candidate), "-c", "import dimos"],
                check=True,
                capture_output=True,
                timeout=10,
            )
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
            continue
        else:
            # Keep the venv path itself; its Python executable is commonly a symlink
            # to a shared interpreter, and the venv location carries the environment.
            return str(candidate.absolute())
    raise ValueError(
        "Choose a DimOS install folder containing a .venv or venv, or its Python executable"
    )


@app.post("/api/setup", dependencies=[Depends(require_local_launcher)])
async def api_setup(body: SetupBody) -> dict[str, Any]:
    try:
        if body.mode == "existing":
            if not body.dimos_python or not body.dimos_python.strip():
                raise HTTPException(status_code=400, detail="dimos_python is required")
            dimos_python = await asyncio.to_thread(
                _resolve_dimos_python, body.dimos_python.strip()
            )
            await manager.run_setup(
                dimos_python=dimos_python,
                **({"manipulation": True} if body.manipulation else {}),
            )
        else:
            clone_dir = (body.clone_dir or "").strip() or str(
                (repo_root().parent / "dimos").resolve()
            )
            dimos_ref = (body.dimos_ref or "").strip() or "main"
            await manager.run_setup(
                clone_dir=clone_dir,
                dimos_ref=dimos_ref,
                **({"manipulation": True} if body.manipulation else {}),
            )
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return manager.snapshot()


@app.post("/api/check", dependencies=[Depends(require_local_launcher)])
async def api_check() -> dict[str, Any]:
    try:
        return await manager.run_check()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/api/settings", dependencies=[Depends(require_local_launcher)])
async def api_settings_get() -> dict[str, Any]:
    return settings_payload()


@app.get("/api/can/status", dependencies=[Depends(require_local_launcher)])
async def api_can_status() -> dict[str, Any]:
    return await manager.can_status()


@app.post("/api/can/setup", dependencies=[Depends(require_local_launcher)])
async def api_can_setup() -> dict[str, Any]:
    try:
        return await manager.setup_can()
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/api/planner/status", dependencies=[Depends(require_local_launcher)])
async def api_planner_status() -> dict[str, Any]:
    return await manager.planner_status()


@app.put("/api/settings", dependencies=[Depends(require_local_launcher)])
async def api_settings_put(body: SettingsBody) -> dict[str, Any]:
    phase = manager.status.phase.value
    if phase in ("starting", "running", "stopping"):
        raise HTTPException(
            status_code=409, detail="stop ARModule before editing settings"
        )
    try:
        mounts = normalize_ui_mounts(
            [item.model_dump() for item in body.mounts]
            if body.mounts is not None
            else None
        )
        if body.profile_id:
            robot_profiles.update(body.profile_id, settings=body.model_dump())
        else:
            merge_armodule_config(
                armodule_config_from_ui(
                    fiducial_marker=body.fiducial_marker,
                    vps=body.vps,
                    map_code=body.map_code,
                    mounts=mounts,
                )
            )
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    env_updates = {
        key: _blank_to_none(getattr(body, field))
        for field, key in (
            ("openai_api_key", "OPENAI_API_KEY"),
            ("multiset_client_id", "MULTISET_CLIENT_ID"),
            ("multiset_client_secret", "MULTISET_CLIENT_SECRET"),
        )
        if field in body.model_fields_set
    }
    if "dimos_log_level" in body.model_fields_set:
        env_updates["DIMOS_LOG_LEVEL"] = normalize_log_level(body.dimos_log_level)
    merge_env(
        env_updates,
        env_path(),
    )
    return {**manager.snapshot(), **settings_payload()}


@app.get("/api/apriltag/{tag_id}.png")
async def api_apriltag_png(tag_id: int) -> FileResponse:
    try:
        path = ensure_png(tag_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FileResponse(path, media_type="image/png")


@app.get("/api/apriltag/{tag_id}.pdf")
async def api_apriltag_pdf(tag_id: int, size_mm: float = 70.0) -> FileResponse:
    try:
        path = ensure_pdf(tag_id, print_size_mm=size_mm)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FileResponse(path, media_type="application/pdf")


@app.post("/api/apriltag/decode", dependencies=[Depends(require_local_launcher)])
async def api_apriltag_decode(file: Annotated[UploadFile, File()]) -> dict[str, Any]:
    filename = (file.filename or "").lower()
    if not filename.endswith(".png"):
        raise HTTPException(
            status_code=400, detail="upload a PNG of an AprilTag 36h11 marker"
        )
    data = await file.read()
    try:
        marker_id = decode_marker_id(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"marker_id": marker_id}


@app.post("/api/armodule/start", dependencies=[Depends(require_local_launcher)])
async def api_armodule_start(body: StartBody) -> dict[str, Any]:
    if body.blueprint == "openyam_ar_planner" and (
        not body.profile_id
    ):
        raise HTTPException(
            status_code=400,
            detail="OpenYAM requires an explicit robot profile",
        )
    robot_ip = (
        body.robot_ip.strip() if body.robot_ip and body.robot_ip.strip() else None
    )
    try:
        await manager.start_armodule(
            blueprint=body.blueprint,
            client=body.client,
            robot_ip=robot_ip,
            **(
                {
                    "armodule_config": robot_profiles.snapshot(
                        body.profile_id, body.blueprint
                    )
                }
                if body.profile_id
                else {}
            ),
            **({"simulation": True} if body.simulation else {}),
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return manager.snapshot()


@app.post("/api/armodule/stop", dependencies=[Depends(require_local_launcher)])
async def api_armodule_stop() -> dict[str, Any]:
    await manager.stop_armodule()
    return manager.snapshot()


@app.get("/api/events")
async def api_events() -> StreamingResponse:
    async def event_stream() -> AsyncIterator[str]:
        async for event in manager.subscribe():
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


class RobotProfileBody(BaseModel):
    name: str
    robot: Literal["unitree_go2", "openyam"] = "unitree_go2"
    source_id: str | None = None


@app.get("/api/robot-profiles")
async def api_robot_profiles() -> dict[str, Any]:
    return {
        "profiles": [
            {
                **profile,
                "settings": ui_from_armodule_config(
                    profile["armodule"],
                    default_mount={"marker_id": 0, "print_size_mm": 70}
                    if profile["robot"] == "openyam"
                    else None,
                ),
            }
            for profile in robot_profiles.all()
        ]
    }


@app.post("/api/robot-profiles", dependencies=[Depends(require_local_launcher)])
async def api_create_robot_profile(body: RobotProfileBody) -> dict[str, Any]:
    try:
        return robot_profiles.create(body.robot, body.name, body.source_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.put(
    "/api/robot-profiles/{profile_id}", dependencies=[Depends(require_local_launcher)]
)
async def api_rename_robot_profile(
    profile_id: str, body: RobotProfileBody
) -> dict[str, Any]:
    try:
        return robot_profiles.update(profile_id, name=body.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete(
    "/api/robot-profiles/{profile_id}", dependencies=[Depends(require_local_launcher)]
)
async def api_delete_robot_profile(profile_id: str) -> dict[str, bool]:
    try:
        robot_profiles.delete(profile_id)
        return {"deleted": True}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
