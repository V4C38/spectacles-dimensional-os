"""Thin FastAPI UI wrapper around launcher/scripts/setup.sh and start.sh."""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Literal

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from apriltag_assets import ensure_pdf, ensure_png
from bridge import ProcessManager
from config import repo_root
from tag_config import restore_tag_config, save_tag_config, tag_config_api_payload

STATIC_DIR = Path(__file__).resolve().parent / "static"
LAUNCHER_HOSTS = frozenset({"127.0.0.1:8790", "localhost:8790", "[::1]:8790"})
manager = ProcessManager()


def require_local_launcher(request: Request) -> None:
    """Reject non-loopback clients and cross-origin Host spoofing."""
    client = request.client.host if request.client else ""
    if client not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(status_code=403, detail="launcher is localhost-only")
    host = (request.headers.get("host") or "").strip().lower()
    if host and host not in LAUNCHER_HOSTS:
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
            await manager.stop_bridge()
        except Exception:
            pass


app = FastAPI(title="DimOS AR Bridge", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


class SetupBody(BaseModel):
    mode: Literal["existing", "clone"] = "clone"
    dimos_python: str | None = None
    clone_dir: str | None = None


class StartBody(BaseModel):
    stack: Literal["go2", "g1"]
    robot_ip: str | None = None
    openai_api_key: str | None = None


class TagMountBody(BaseModel):
    tag_id: int
    print_size_mm: float = 70.0
    forward_m: float = 0.0
    lateral_m: float = 0.0
    up_m: float = 0.0
    yaw_deg: float = 0.0
    pitch_deg: float = 0.0


class TagConfigBody(BaseModel):
    go2: list[TagMountBody] = Field(default_factory=list)
    g1: list[TagMountBody] = Field(default_factory=list)


class RestoreTagConfigBody(BaseModel):
    stack: Literal["go2", "g1"] | None = None


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/status")
async def api_status() -> dict[str, Any]:
    return manager.snapshot()


@app.post("/api/setup/check", dependencies=[Depends(require_local_launcher)])
async def api_setup_check() -> dict[str, Any]:
    try:
        return await manager.run_check()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/setup", dependencies=[Depends(require_local_launcher)])
async def api_setup(body: SetupBody) -> dict[str, Any]:
    try:
        if body.mode == "existing":
            if not body.dimos_python or not body.dimos_python.strip():
                raise HTTPException(status_code=400, detail="dimos_python is required")
            await manager.run_setup(dimos_python=body.dimos_python.strip())
        else:
            clone_dir = (body.clone_dir or "").strip() or str(repo_root().parent / "dimos")
            await manager.run_setup(clone_dir=clone_dir)
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return manager.snapshot()


@app.post("/api/bridge/start", dependencies=[Depends(require_local_launcher)])
async def api_bridge_start(body: StartBody) -> dict[str, Any]:
    robot_ip = body.robot_ip.strip() if body.robot_ip and body.robot_ip.strip() else None
    try:
        await manager.start_bridge(
            stack=body.stack,
            robot_ip=robot_ip,
            openai_api_key=body.openai_api_key,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return manager.snapshot()


@app.post("/api/bridge/stop", dependencies=[Depends(require_local_launcher)])
async def api_bridge_stop() -> dict[str, Any]:
    await manager.stop_bridge()
    return manager.snapshot()


@app.get("/api/tag-config", dependencies=[Depends(require_local_launcher)])
async def api_tag_config_get() -> dict[str, Any]:
    return tag_config_api_payload()


@app.put("/api/tag-config", dependencies=[Depends(require_local_launcher)])
async def api_tag_config_put(body: TagConfigBody) -> dict[str, Any]:
    phase = manager.status.phase.value
    if phase in ("starting", "running", "stopping"):
        raise HTTPException(status_code=409, detail="stop the bridge before editing AprilTag config")
    try:
        return save_tag_config(
            {
                "go2": [t.model_dump() for t in body.go2],
                "g1": [t.model_dump() for t in body.g1],
            }
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/tag-config/restore", dependencies=[Depends(require_local_launcher)])
async def api_tag_config_restore(body: RestoreTagConfigBody | None = None) -> dict[str, Any]:
    phase = manager.status.phase.value
    if phase in ("starting", "running", "stopping"):
        raise HTTPException(status_code=409, detail="stop the bridge before editing AprilTag config")
    try:
        stack = body.stack if body is not None else None
        return restore_tag_config(stack=stack)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/apriltag/{tag_id}.png")
async def api_apriltag_png(tag_id: int) -> FileResponse:
    try:
        path = ensure_png(tag_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return FileResponse(path, media_type="image/png")


@app.get("/api/apriltag/{tag_id}.pdf")
async def api_apriltag_pdf(tag_id: int, size_mm: float = 70.0) -> FileResponse:
    try:
        path = ensure_pdf(tag_id, print_size_mm=size_mm)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return FileResponse(path, media_type="application/pdf", filename=path.name)


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
