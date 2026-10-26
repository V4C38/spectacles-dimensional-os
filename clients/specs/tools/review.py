#!/usr/bin/env python3
"""Record a native Lens Studio review using an isolated copy of the Specs project.

Run with a Python environment containing the official MCP SDK. The production
scene is copied verbatim; all harness attachment happens through Lens Studio MCP.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import contextlib
import fcntl
import json
import math
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Any, Iterator

from lens_studio import dismiss_welcome, resize_project_window
from integration_catalog import applicable_cases, case_filename, load_catalog, write_lens_catalog

SPECS_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SPECS_ROOT.parents[1]
DEFAULT_CLAD = Path("/Volumes/M2_EXT_1/CLAD")
EVENT_PREFIX = "SPECS_REVIEW "
PREVIEW_ID = "Snap.Plugin.Gui.PreviewPanel"
DEFAULT_SCENES = (
    "setup-connect", "setup-align", "setup-success", "runtime-manual", "robot-selected",
    "agent-recording", "agent-draft", "agent-response", "sensors-full", "sensors-obstacles",
    "settings", "diagnostics", "navigation-preview", "navigation-route", "navigation-stop",
    "navigation-success", "navigation-cancelled",
    "world-marker", "alignment-review", "disconnected", "setup-restart",
)


class ReviewError(RuntimeError):
    """A review could not produce trustworthy artifacts."""



def native_log_file() -> Path:
    paths = list((Path.home() / "Library/Preferences/Snap/Lens Studio/logs").glob("LensStudioLog-*.txt"))
    if not paths: raise ReviewError("No native Lens Studio log is available")
    return max(paths, key=lambda file: file.stat().st_mtime)

def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def complete_default_scenes(scenes: list[dict[str, Any]]) -> bool:
    """A comparison-only subset cannot establish the production state/world review."""
    return tuple(scene.get("name") for scene in scenes) == DEFAULT_SCENES


def validate_video_duration(duration: float, scenes: list[dict[str, Any]], captured_duration: float | None = None) -> None:
    required = max((scene["at"] + scene.get("durationS", 2.8) for scene in scenes), default=0)
    if not math.isfinite(duration) or duration < required - 0.05:
        raise ReviewError(f"Continuous video ends at {duration:.2f}s before the final checkpoint hold ({required:.2f}s)")
    if captured_duration is not None and abs(duration - captured_duration) > 0.2:
        raise ReviewError(f"Video duration {duration:.2f}s differs from capture clock {captured_duration:.2f}s")


def decode_result(value: Any) -> Any:
    """Unwrap JSON text content, including CLAD's nested content-array contract."""
    if isinstance(value, list):
        return [decode_result(item) for item in value]
    if not isinstance(value, dict):
        return value
    result = dict(value)
    if result.get("type") == "text" and isinstance(result.get("text"), str):
        with contextlib.suppress(ValueError):
            result["text"] = json.loads(result["text"])
    return {key: decode_result(item) for key, item in result.items()}


def objects(value: Any) -> Iterator[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for item in value.values():
            yield from objects(item)
    elif isinstance(value, list):
        for item in value:
            yield from objects(item)


def tool_payload(value: Any) -> dict[str, Any]:
    candidates = list(objects(value))
    for item in candidates:
        if "returnValue" in item:
            if item.get("status") not in (None, "success", "Execution Succeeded"):
                raise ReviewError(f"Editor code failed: {item.get('error') or item.get('errors')}")
            returned = item["returnValue"]
            return returned if isinstance(returned, dict) else {"value": returned}
    for item in candidates:
        if "logFile" in item or "mode" in item or "errors" in item:
            return item
    for item in candidates:
        if "status" in item:
            return item
    return value if isinstance(value, dict) else {"value": value}


def extract_images(value: Any, destination: Path, stem: str) -> list[Path]:
    """Save binary content without exposing large payloads or false extensions."""
    saved: list[Path] = []
    for item in objects(value):
        if item.get("type") != "image" or not item.get("data"):
            continue
        extension = ".png" if item.get("mimeType") == "image/png" else ".jpg"
        path = destination / f"{stem}{'' if not saved else '-' + str(len(saved))}{extension}"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(base64.b64decode(item.pop("data"), validate=True))
        item["savedTo"] = str(path)
        saved.append(path)
    return saved


def parse_events(text: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    decoder = json.JSONDecoder()
    for line in text.splitlines():
        if EVENT_PREFIX not in line:
            continue
        payload = line.split(EVENT_PREFIX, 1)[1]
        try:
            event, _ = decoder.raw_decode(payload.lstrip())
        except ValueError:
            continue
        if isinstance(event, dict) and event.get("type") in {"scene", "result", "complete", "host"}:
            events.append(event)
    return events


def checkpoint(event: dict[str, Any], recording_started_ms: float,
               previous: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    name, unix_ms = event.get("name"), event.get("unixMs")
    if not isinstance(name, str) or not name.strip():
        raise ReviewError("A scene checkpoint is missing its name")
    if previous and any(scene["name"] == name for scene in previous):
        raise ReviewError(f"Native scenario restarted at {name!r}; rerun after compilation settles")
    if isinstance(unix_ms, bool) or not isinstance(unix_ms, (int, float)) or not math.isfinite(unix_ms):
        raise ReviewError(f"Checkpoint {name!r} is missing a finite unixMs timestamp")
    at = (unix_ms - recording_started_ms) / 1000
    if at < 0:
        raise ReviewError(f"Checkpoint {name!r} occurred before continuous recording started")
    # Native checkpoints announce the start of an action. Browser checkpoints
    # announce completed actions and use the shared renderer's usual lead-in.
    return {
        "name": name, "at": at, "unixMs": unix_ms, "leadInS": 0,
        "durationS": 1.4 if name in {"navigation-stop", "navigation-success", "navigation-cancelled"} else 2.8,
        "videoOnly": event.get("videoOnly") is True,
    }


def copy_project(source: Path, destination: Path, harness: Path) -> Path:
    if destination.exists():
        raise ReviewError(f"Disposable workspace already exists: {destination}")
    projects = list(source.glob("*.esproj"))
    if len(projects) != 1:
        raise ReviewError(f"Expected exactly one .esproj in {source}")
    if not harness.is_file():
        raise ReviewError(f"Review harness is missing: {harness}")
    destination.mkdir(parents=True)
    for name in ("Assets", "Packages", "Support"):
        directory = source / name
        if directory.is_dir():
            shutil.copytree(
                directory, destination / name,
                ignore=shutil.ignore_patterns(".DS_Store"), symlinks=True,
            )
    for file in [projects[0], source / "jsconfig.json", source / "tsconfig.json"]:
        if file.is_file():
            shutil.copy2(file, destination / file.name)
    write_json(destination / ".specs-review.json", {
        "kind": "dimos-specs-review", "source": str(source.resolve()), "project": projects[0].name,
    })
    prepare_harness(destination, harness)
    return destination / projects[0].name


def prepare_harness(destination: Path, harness: Path) -> None:
    review_dir = destination / "Assets" / "Review"
    review_dir.mkdir(exist_ok=True)
    # The harness owns no domain code. Rebase its production imports to the
    # location in the disposable Lens, keeping Vitest outside Assets.
    code = harness.read_text(encoding="utf-8")
    code = code.replace("../../Assets/Scripts/", "../Scripts/")
    (review_dir / "ReviewScenario.ts").write_text(code, encoding="utf-8")
    write_lens_catalog(review_dir)
    for helper in harness.parent.glob("Integration*.ts"):
        if helper != harness and helper.name != "IntegrationScenario.ts" and not helper.name.endswith("Probe.ts"):
            shutil.copy2(helper, review_dir / helper.name)
    for name in ("CameraFixture.png", "CameraFixture.png.meta"):
        fixture = harness.with_name(name)
        if fixture.is_file():
            shutil.copy2(fixture, review_dir / name)


class LensMcp:
    def __init__(self, config_path: Path, artifacts: Path):
        config = json.loads(config_path.read_text(encoding="utf-8"))
        self.url, self.token = config["url"], config["token"]
        self.artifacts = artifacts
        self.stack = contextlib.AsyncExitStack()
        self.session: Any = None
        self.count = 0

    async def __aenter__(self) -> LensMcp:
        try:
            import httpx2 as httpx
        except ImportError:
            import httpx
        try:
            from mcp import ClientSession
            from mcp.client.streamable_http import streamable_http_client
        except ImportError as error:
            raise ReviewError("Run this command with the CLAD tools venv containing mcp") from error
        http = await self.stack.enter_async_context(
            httpx.AsyncClient(headers={"Authorization": "Bearer " + self.token}, timeout=600)
        )
        read, write, *_ = await self.stack.enter_async_context(
            streamable_http_client(self.url, http_client=http)
        )
        self.session = await self.stack.enter_async_context(
            ClientSession(read, write, read_timeout_seconds=600)
        )
        await self.session.initialize()
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.stack.__aexit__(*args)

    async def call(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        self.count += 1
        result = await self.session.call_tool(name, arguments)
        value = decode_result(result.model_dump(mode="json", by_alias=True))
        extract_images(value, self.artifacts / "mcp" / "screenshots", f"mcp-{self.count:03}")
        write_json(self.artifacts / "mcp" / f"{self.count:03}-{name}.json", value)
        if value.get("isError", value.get("is_error", False)):
            detail = next((item.get("text") for item in objects(value)
                           if item.get("type") == "text" and isinstance(item.get("text"), str)), "")
            raise ReviewError(f"{name}: {detail or 'returned an error; see saved MCP result'}")
        # Lens ChatTool failures can be embedded in ordinary MCP text blocks.
        for item in objects(value):
            if item.get("error") and not item.get("logFile"):
                raise ReviewError(f"{name}: {item['error']}")
        return tool_payload(value)

    async def editor(self, code: str) -> dict[str, Any]:
        return await self.call("ExecuteEditorCode", {"code": code, "timeoutMs": 60000})


def script_attach_code(workspace: Path, start_delay: float, profile: str = "legacy") -> str:
    return f"""
const model = pluginSystem.findInterface(Editor.Model.IModel);
if (model.project.projectDirectory.toString() !== {json.dumps(str(workspace))}) {{
  throw new Error("Review attachment requires the disposable project");
}}
const project = model.project;
const script = project.assetManager.assets.find(a => a.name === "ReviewScenario" && a.getTypeName() === "TypeScriptAsset");
if (!script) throw new Error("ReviewScenario has not imported/compiled");
for (const object of project.scene.rootSceneObjects) {{
  if (["ReviewScenarioHost", "InterFontProbeHost", "ColorProbeHost"].includes(object.name)) object.destroy();
}}
const host = project.scene.createSceneObject("ReviewScenarioHost");
const component = host.addComponent("ScriptComponent") as Editor.Components.ScriptComponent;
component.scriptAsset = script as Editor.Assets.ScriptAsset;
(component as any).startDelayS = {start_delay};
if (component.inputNames.includes("profile")) (component as any).profile = {json.dumps(profile)};
// Native asset metadata can retain an earlier imported default after TS recompiles.
if (component.inputNames.includes("comparisonMode")) (component as any).comparisonMode = false;
if (component.inputNames.includes("restartProbeOnly")) (component as any).restartProbeOnly = false;
return {{ project: project.projectDirectory.toString(), host: host.id.toString(), inputs: component.inputNames,
  comparisonMode: (component as any).comparisonMode }};
"""


async def attach_scenario(mcp: LensMcp, workspace: Path, start_delay: float, profile: str = "legacy") -> None:
    attached = await mcp.editor(script_attach_code(workspace, start_delay, profile))
    if attached.get("comparisonMode") is True:
        raise ReviewError("Native harness retained comparisonMode; refusing an incomplete state/world review")
    # A newly copied texture can still be importing after TypeScript has compiled.
    # Retry only the documented transient save failure; never reattach the host.
    for attempt in range(60):
        try:
            await mcp.editor(
                "const model = pluginSystem.findInterface(Editor.Model.IModel);"
                f"if (model.project.projectDirectory.toString() !== {json.dumps(str(workspace))}) "
                'throw new Error("Review save requires the disposable project");'
                "model.project.save(); return {saved: true};"
            )
            return
        except ReviewError as error:
            if "Cannot save project while an asset operation is in progress" not in str(error):
                raise
            if attempt == 59:
                raise ReviewError("Assets did not finish importing before review save") from error
            await asyncio.sleep(1)


def screenshot_code(destination: Path) -> str:
    return f"""
const dock = pluginSystem.findInterface(Editor.Dock.IDockManager);
const panel: any = dock.panels.find(p => p.id.toString().includes({json.dumps(PREVIEW_ID)}));
if (!panel || typeof panel.screenshot !== "function") throw new Error("Native Preview screenshot unavailable");
if (panel.config?.input?.type === "Webcam") throw new Error("Select a non-webcam Preview source for review");
const captureStarted = Date.now();
const pixmap = await panel.screenshot();
const capturedAt = Date.now();
if (!pixmap) throw new Error("Preview did not return a frame");
pixmap.save(new Editor.Path({json.dumps(str(destination))}));
return {{ path: {json.dumps(str(destination))}, width: pixmap.width, height: pixmap.height,
  screenshotMs: capturedAt - captureStarted, saveMs: Date.now() - capturedAt }};
"""


async def capture(mcp: LensMcp, output: Path, name: str) -> Path:
    stem = re.sub(r"[^A-Za-z0-9._-]", "-", name).removesuffix(".png").removesuffix(".jpg")
    path = output / f"{stem}.png"
    path.parent.mkdir(exist_ok=True)
    try:
        await mcp.editor(screenshot_code(path))
        if not path.is_file() or path.read_bytes()[:8] != b"\x89PNG\r\n\x1a\n":
            raise ReviewError("Native Preview did not save a PNG")
        return path
    except ReviewError as error:
        print(f"Native PNG unavailable ({error}); using Preview JPEG", flush=True)
        fallback = mcp.artifacts / "mcp" / "screenshots"
        fallback.mkdir(parents=True, exist_ok=True)
        before = set(fallback.iterdir())
        await mcp.call("CapturePanelScreenshotTool", {"pluginId": PREVIEW_ID, "maxDimension": 1600})
        images = [file for file in fallback.iterdir() if file not in before and file.suffix == ".jpg"]
        if not images:
            raise ReviewError("Preview screenshot returned no image") from error
        jpeg = path.with_suffix(".jpg")
        images[0].rename(jpeg)
        return jpeg


async def compile_project(mcp: LensMcp, output: Path, workspace: Path, timeout: float = 600) -> None:
    """Wait for native completion, even when 5.15's compile tool times out early.

    The stock ChatTool can hold compilation notifications until its own timeout.
    Change a review-only TS module and observe the native compiler log afterward.
    A refreshed Preview or a successful MCP call is not compilation evidence.
    """
    path = native_log_file()
    offset = path.stat().st_size
    trigger = workspace / "Assets/Review/ReviewCompileTrigger.ts"
    trigger.write_text(f"export const reviewCompileTrigger = {time.time_ns()!r};\n", encoding="utf-8")
    deadline = time.monotonic() + timeout
    text = ""
    completed_at: float | None = None
    while time.monotonic() < deadline:
        if path.stat().st_size < offset:
            offset = 0
        with path.open("rb") as log:
            log.seek(offset)
            chunk = log.read()
            offset = log.tell()
        if chunk:
            text += chunk.decode("utf-8", errors="replace")
            (output / "compile.log").write_text(text, encoding="utf-8")
        success = text.rfind("TypeScript compilation succeeded!")
        failure = text.rfind("TypeScript compilation failed!")
        pending = max(text.rfind("Starting watched compilation cycle"),
                      text.rfind("Starting incremental components compilation"))
        completion = max(success, failure)
        if completion >= 0 and completion > pending:
            if completed_at is None:
                completed_at = time.monotonic()
            if time.monotonic() - completed_at >= 1:
                if failure > success:
                    diagnostics = [line for line in text.splitlines() if "error TS" in line]
                    raise ReviewError("Native TypeScript compilation failed: " + "\n".join(diagnostics[-8:]))
                return
        else:
            completed_at = None
        await asyncio.sleep(0.2)
    raise ReviewError("No native compilation completion was observed; see compile.log")


def app_pid(app: Path) -> int:
    result = subprocess.run(
        ["pgrep", "-f", str(app / "Contents" / "MacOS" / "Lens Studio")],
        check=False, capture_output=True, text=True,
    )
    candidates = result.stdout.split()
    if len(candidates) != 1:
        raise ReviewError("Start the chosen Lens Studio app and its MCP server before review")
    return int(candidates[0])


def recorder_binary(destination: Path, override: Path | None) -> Path:
    if override:
        if not override.is_file():
            raise ReviewError(f"Recorder executable is missing: {override}")
        return override
    source = Path(__file__).with_name("RecordPreview.swift")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.is_file() or source.stat().st_mtime > destination.stat().st_mtime:
        subprocess.run(
            ["xcrun", "swiftc", "-parse-as-library", str(source), "-o", str(destination)],
            check=True,
        )
    return destination


async def wait_json(path: Path, process: asyncio.subprocess.Process, timeout: float) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
        if process.returncode is not None:
            raise ReviewError("Recorder exited before recording started; see recorder.log")
        await asyncio.sleep(0.1)
    raise ReviewError("Recorder did not report a start time; see recorder.log")


async def run_pass(args: argparse.Namespace, output: Path, workspace: Path) -> dict[str, Any]:
    if args.prepared_project:
        marker = workspace / ".specs-review.json"
        if not marker.is_file() or json.loads(marker.read_text()).get("kind") != "dimos-specs-review":
            raise ReviewError("--prepared-project requires a disposable workspace created by this runner")
        if workspace.resolve() == args.source.resolve():
            raise ReviewError("Refusing to attach a review harness to the production project")
        project = args.prepared_project
        prepare_harness(workspace, args.harness)
    else:
        project = copy_project(args.source, workspace, args.harness)
    with (args.app / "Contents" / "Info.plist").open("rb") as stream:
        version = plistlib.load(stream).get("CFBundleShortVersionString", "")
    if not version.startswith("5.15."):
        raise ReviewError(f"Spectacles 2024 review requires Lens Studio 5.15.x, found {version}")
    profile = getattr(args, "profile", "legacy")
    pid = app_pid(args.app)
    dismiss_welcome(pid)
    recording_dir = output / "diagnostics"
    recording_dir.mkdir(parents=True, exist_ok=True)
    binary = recorder_binary(args.recorder_cache / "RecordPreview", args.recorder)
    manifest: dict[str, Any] = {"recording": "diagnostics/recording.mp4", "profile": profile, "client": "specs", "scenes": [], "source": "Lens Studio native Preview"}
    events: list[dict[str, Any]] = []
    seen: set[str] = set()
    completion: dict[str, Any] | None = None
    recorder: asyncio.subprocess.Process | None = None
    offset = 0
    logfile: Path | None = None
    original_window: dict[str, int] | None = None
    viewport_variants: list[dict[str, Any]] = []
    started = time.monotonic()
    try:
        async with LensMcp(args.mcp_config, output) as mcp:
            print(f"Opening disposable project: {project}", flush=True)
            await mcp.editor(
                "const model = pluginSystem.findInterface(Editor.Model.IModel);"
                f"if (model.project.projectDirectory.toString() !== {json.dumps(str(workspace))}) "
                f"model.openProject(new Editor.Path({json.dumps(str(project))})); return {{opening: true}};"
            )
            for _ in range(60):
                current = await mcp.editor(
                    "const model = pluginSystem.findInterface(Editor.Model.IModel);"
                    "return {project: model.project.projectDirectory.toString()};"
                )
                if Path(current.get("project", "")).resolve() == workspace.resolve():
                    break
                await asyncio.sleep(1)
            else:
                raise ReviewError("Lens Studio did not open the disposable project")
            print("Waiting for native TypeScript compilation", flush=True)
            await compile_project(mcp, output, workspace)
            print("Attaching review scenario through the editor API", flush=True)
            await attach_scenario(mcp, workspace, args.start_delay, profile)
            # The recorded start timestamp is emitted by ScreenCaptureKit only
            # after the first recording frame, never guessed from process spawn.
            with (recording_dir / "recorder.log").open("wb") as recorder_log:
                recorder = await asyncio.create_subprocess_exec(
                    str(binary), str(pid), str(recording_dir / "recording.mp4"), str(args.duration),
                    str(recording_dir / "recording.stop"),
                    stdout=recorder_log, stderr=recorder_log,
                )
                ready = await wait_json(recording_dir / "recording.ready.json", recorder, 20)
                manifest["startedAt"] = ready["startedAt"]
                if ready.get("captureCrop"):
                    manifest["captureCrop"] = ready["captureCrop"]
                elif profile == "golden":
                    raise ReviewError("Cannot locate the native Preview viewport for golden capture")
                logfile = native_log_file()
                offset = logfile.stat().st_size
                await mcp.editor(
                    "const panel:any=pluginSystem.findInterface(Editor.Dock.IDockManager).panels.find(p=>p.id.toString().includes(\"Snap.Plugin.Gui.PreviewPanel\"));"
                    "if(!panel)throw new Error(\"Native Preview panel missing\");panel.resume();panel.refresh();return {refreshed:true};"
                )
                deadline = time.monotonic() + args.duration
                partial = ""
                while time.monotonic() < deadline:
                    if recorder.returncode not in (None, 0):
                        raise ReviewError("Continuous recording failed; see recorder.log")
                    if logfile.is_file():
                        if logfile.stat().st_size < offset:
                            offset = 0
                        with logfile.open("rb") as log:
                            log.seek(offset)
                            chunk = log.read()
                            offset = log.tell()
                        if chunk:
                            with (output / "native.log").open("ab") as log_copy:
                                log_copy.write(chunk)
                            native_text = chunk.decode("utf-8", errors="replace")
                            if re.search(r"^E .*?(?:InternalError:|TypeError:|ReferenceError:|RangeError:|SyntaxError:)", partial + native_text, re.MULTILINE):
                                raise ReviewError("Native Preview stopped with a runtime error; see native.log")
                            partial += native_text
                            lines = partial.split("\n")
                            partial = lines.pop()
                            for event in parse_events("\n".join(lines)):
                                key = json.dumps(event, sort_keys=True)
                                if key in seen:
                                    continue
                                seen.add(key)
                                events.append(event)
                                write_json(output / "events.json", events)
                                if event["type"] == "scene":
                                    scene = checkpoint(event, ready["startedAt"], manifest["scenes"])
                                    scene["id"] = event.get("id", event["name"])
                                    if profile in {"golden", "regression"}:
                                        row = next((row for row in applicable_cases() if row["id"] == scene["id"]), None)
                                        if row is None:
                                            raise ReviewError(f"Unknown native catalog case: {scene['id']}")
                                        scene["durationS"] = float(event.get("durationS", row.get("holdS", 2.8)))
                                        scene["screenshotAt"] = scene["at"] + float(event.get("screenshotOffsetS", 0.55 if scene["id"] in {"navigation_success", "navigation_cancelled"} else 0.8))
                                    if event.get("captureBounds"):
                                        write_json(recording_dir / "recording.viewport.json", {
                                            "bounds": event["captureBounds"], "aspect": event.get("cameraAspect"),
                                        })
                                        scene["framing"] = {"bounds": event["captureBounds"], "cameraAspect": event.get("cameraAspect")}
                                    if profile == "golden": scene["videoOnly"] = True
                                    if scene["videoOnly"]:
                                        image = output / f"{scene['name']}.png"
                                        scene["screenshotSource"] = "continuous native application-window video"
                                    else:
                                        scene["screenshotSource"] = "native Preview render"
                                        await asyncio.sleep(0.4)
                                        image = await capture(mcp, output, case_filename(scene["id"]) if profile in {"golden", "regression"} else f"{len(manifest['scenes']) + 1:02}_{scene['name'].replace('-', '_')}")
                                    scene["screenshot"] = str(image.relative_to(output))
                                    manifest["scenes"].append(scene)
                                    write_json(output / "review-scenes.json", manifest)
                                    print(f"Captured {scene['name']} at {scene['at']:.2f}s", flush=True)
                                elif event["type"] == "host" and event.get("action") == "update_framing":
                                    write_json(recording_dir / "recording.viewport.json", {
                                        "bounds": event["bounds"], "aspect": event["aspect"],
                                    })
                                elif event["type"] == "host" and event.get("action") == "resize_viewport":
                                    if original_window is None:
                                        original_window = resize_project_window(pid)
                                    bounds = resize_project_window(pid, height=int(event["height"]), width=int(event["width"]))
                                    await asyncio.sleep(0.5)
                                    variant = str(event["variant"])
                                    image = await capture(mcp, recording_dir, f"viewport_aspect_{variant}")
                                    viewport_variants.append({"variant": variant, "window": bounds,
                                                              "image": str(image.relative_to(output))})
                                    write_json(output / "viewport-variants.json", viewport_variants)
                                elif event["type"] == "complete":
                                    completion = event
                    if completion:
                        break
                    await asyncio.sleep(0.2)
                # Keep continuous capture alive through the final outcome hold.
                if completion and recorder.returncode is None:
                    await asyncio.sleep(1)
                    (recording_dir / "recording.stop").touch()
                if recorder.returncode is None:
                    try:
                        await asyncio.wait_for(recorder.wait(), 15)
                    except asyncio.TimeoutError as error:
                        raise ReviewError("Recorder did not finalize the continuous video; see recorder.log") from error
                if recorder.returncode != 0:
                    raise ReviewError("Recorder failed; see recorder.log")
    finally:
        if original_window is not None:
            resize_project_window(pid, bounds=original_window)
        if recorder and recorder.returncode is None:
            recorder.terminate()
            with contextlib.suppress(ProcessLookupError, asyncio.TimeoutError):
                await asyncio.wait_for(recorder.wait(), 5)
        write_json(output / "review-scenes.json", manifest)
        write_json(output / "events.json", events)
    checks = [event for event in events if event["type"] == "result"]
    if viewport_variants:
        checks.append({"caseId": "viewport_aspect", "name": "host_viewport_resize", "passed":
                       len(viewport_variants) == 2 and len({(row["window"]["width"], row["window"]["height"]) for row in viewport_variants}) == 2})
    if len(viewport_variants) == 2:
        destination = output / (case_filename("viewport_aspect") + ".png")
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                        "-i", str(output / viewport_variants[0]["image"]),
                        "-i", str(output / viewport_variants[1]["image"]),
                        "-filter_complex", "[0:v]scale=640:900:force_original_aspect_ratio=decrease,pad=640:900:(ow-iw)/2:(oh-ih)/2[a];"
                        "[1:v]scale=640:900:force_original_aspect_ratio=decrease,pad=640:900:(ow-iw)/2:(oh-ih)/2[b];[a][b]hstack",
                        "-frames:v", "1", str(destination)], check=True)
        for scene in manifest["scenes"]:
            if scene["id"] == "viewport_aspect":
                scene["screenshot"] = destination.name
                scene["screenshotSource"] = "two native Preview renders after actual editor resizing"
    native_lines = (output / "native.log").read_text(encoding="utf-8", errors="replace").splitlines()
    runtime_errors = list(dict.fromkeys(
        line for line in native_lines
        if line.startswith(("E ", "F "))
        and re.search(r"(?:TypeError|ReferenceError|RangeError|SyntaxError|Error:)", line)
    ))
    passed = bool(completion and completion.get("passed") is True and checks)
    passed = passed and all(event.get("passed") is True for event in checks) and not runtime_errors
    default_harness = args.harness is not None and args.harness.resolve() == (SPECS_ROOT / "Tests/integration-tests/ReviewScenario.ts").resolve()
    full_scenario = not default_harness or complete_default_scenes(manifest["scenes"])
    if profile == "golden":
        expected = [chapter["id"] for chapter in load_catalog()["golden"]["chapters"]]
        full_scenario = [scene["id"] for scene in manifest["scenes"]] == expected
    passed = passed and full_scenario
    video_probe = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json",
        str(recording_dir / "recording.mp4"),
    ], text=True))
    video_duration = float(video_probe["format"]["duration"])
    completed_capture = json.loads((recording_dir / "recording.completed.json").read_text())
    validate_video_duration(video_duration, manifest["scenes"], float(completed_capture["elapsedS"]))
    for scene in manifest["scenes"]:
        if scene.get("videoOnly") and profile != "golden":
            destination = output / scene["screenshot"]
            destination.parent.mkdir(parents=True, exist_ok=True)
            # Navigation feedback lasts only 0.6s; account for its 0.1s fixture dispatch delay.
            offset = 0.55 if scene["name"] in {"navigation-success", "navigation-cancelled"} else 0.8
            scene.setdefault("screenshotAt", scene["at"] + offset)
            command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", str(scene["screenshotAt"]),
                       "-i", str(recording_dir / "recording.mp4")]
            crop = scene.get("captureCrop", manifest.get("captureCrop"))
            if crop:
                command += ["-vf", f"crop={crop['width']}:{crop['height']}:{crop['x']}:{crop['y']}"]
            subprocess.run(command + ["-frames:v", "1", "-y", str(destination)], check=True)
    write_json(output / "review-scenes.json", manifest)
    result = {
        "passed": passed, "completed": completion is not None,
        "lensStudioVersion": version, "workspace": str(workspace),
        "durationS": time.monotonic() - started, "checks": checks,
        "sceneCount": len(manifest["scenes"]), "nativeLog": str(logfile) if logfile else None,
        "videoDurationS": video_duration,
        "recordingScope": "Native Preview viewport only; live AX resize measurement; aspect-preserving content crop",
        "reusedWorkspace": args.prepared_project is not None,
        "runtimeErrors": runtime_errors,
    }
    write_json(output / "results.json", result)
    if not completion:
        raise ReviewError("Review scenario did not emit a completion event before the deadline")
    if not manifest["scenes"]:
        raise ReviewError("Review scenario did not emit visual checkpoints")
    if not full_scenario:
        raise ReviewError(f"Default review did not capture all {len(DEFAULT_SCENES)} state/world checkpoints in order")
    return result



async def run_review(args: argparse.Namespace, output: Path, workspace: Path) -> dict[str, Any]:
    """Run uninterrupted golden footage separately from screenshot regressions."""
    if args.harness is not None:
        args.profile = "legacy"
        return await run_pass(args, output, workspace)
    harnesses = SPECS_ROOT / "Tests/integration-tests"
    project = args.prepared_project or copy_project(args.source, workspace, harnesses / "IntegrationScenario.ts")
    suites = ["golden", "regression"] if args.suite == "all" else [args.suite]
    passes = []
    for profile in suites:
        child = argparse.Namespace(**vars(args))
        child.profile = profile
        child.harness = harnesses / "IntegrationScenario.ts"
        child.prepared_project = project
        directory = output / profile
        directory.mkdir()
        result = await run_pass(child, directory, workspace)
        result["checks"].append({"caseId": "setup_entry" if profile == "golden" else "setup_navigation",
                                 "name": "native_pass_integrity", "passed": result["passed"]})
        write_json(directory / "results.json", result)
        passes.append(result)
    command = ["node", str(REPO_ROOT / "tools/integration-tests/finalize.mjs"),
               "--client", "specs", "--run", str(output), "--scope", args.suite]
    completed = subprocess.run(command, check=False)
    result = json.loads((output / "results.json").read_text(encoding="utf-8"))
    result["passed"] = result["passed"] and completed.returncode == 0 and all(row["passed"] for row in passes)
    write_json(output / "results.json", result)
    return result

async def restore_source_project(args: argparse.Namespace, output: Path, workspace: Path) -> None:
    """Do not leave scripted fixtures in the editor after a review."""
    finder_metadata = args.source / "Cache/TypeScript/.DS_Store"
    if finder_metadata.is_file():
        backup = output / "diagnostics/cache-backup/TypeScript.DS_Store"
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(finder_metadata, backup)
    projects = sorted(args.source.glob("*.esproj"))
    if len(projects) != 1:
        raise ReviewError("Cannot restore source: expected one .esproj in the source directory")
    resume_preview = (
        "const dock = pluginSystem.findInterface(Editor.Dock.IDockManager);"
        f"const panel: any = dock.panels.find(p => p.id.toString().includes({json.dumps(PREVIEW_ID)}));"
        "if (panel) { panel.resume(); panel.refresh(); } return {resumed: !!panel};"
    )
    async with LensMcp(args.mcp_config, output / "restore") as mcp:
        state = await mcp.editor(
            "const model = pluginSystem.findInterface(Editor.Model.IModel);"
            "const current = model.project.projectDirectory.toString();"
            f"if (current === {json.dumps(str(args.source))}) return {{restored: true, alreadyOpen: true}};"
            f"if (current !== {json.dumps(str(workspace))}) "
            "return {skipped: true, reason: 'Editor project was changed outside the review'};"
            f"model.openProject(new Editor.Path({json.dumps(str(projects[0]))}));"
            "return {opening: true};"
        )
        if state.get("skipped") or state.get("alreadyOpen"):
            if state.get("alreadyOpen"):
                if hasattr(args, "app"): dismiss_welcome(app_pid(args.app))
                await mcp.editor(resume_preview)
            write_json(output / "editor-restoration.json", state)
            return
        for _ in range(60):
            state = await mcp.editor(
                "const model = pluginSystem.findInterface(Editor.Model.IModel);"
                "return {project: model.project.projectDirectory.toString()};"
            )
            if Path(state.get("project", "")).resolve() == args.source.resolve():
                await mcp.editor(resume_preview)
                if hasattr(args, "app"): dismiss_welcome(app_pid(args.app))
                write_json(output / "editor-restoration.json", {"restored": True, **state})
                return
            await asyncio.sleep(1)
        raise ReviewError("Lens Studio did not restore the source project after review")


async def review_and_restore(args: argparse.Namespace, output: Path, workspace: Path) -> dict[str, Any]:
    failure: BaseException | None = None
    try:
        result = await run_review(args, output, workspace)
        if getattr(args, "suite", None) and getattr(args, "harness", None) is None and not args.keep_open:
            mark_source_pending(output, result)
        return result
    except BaseException as error:
        failure = error
        raise
    finally:
        if not args.keep_open:
            try:
                await restore_source_project(args, output, workspace)
            except Exception as error:
                write_json(output / "editor-restoration.json", {"restored": False, "error": str(error)})
                if failure is None:
                    raise


def mark_source_pending(output: Path, result: dict[str, Any]) -> None:
    result.setdefault("scenarioPassed", result["passed"])
    result["passed"] = False
    result["sourceAuditState"] = "pending"
    result["checks"] = [row for row in result.get("checks", []) if row.get("caseId") != "source_handoff"]
    result["checks"].append({"caseId": "source_handoff", "name": "source_editor_clean", "passed": False,
                              "state": "pending"})
    write_json(output / "results.json", result)


async def verify_source_handoff(args: argparse.Namespace, output: Path, result: dict[str, Any]) -> dict[str, Any]:
    """Gate overall success on restored, compiled production Source."""
    from audit_source import audit
    mark_source_pending(output, result)
    try:
        passed = await audit(argparse.Namespace(source=args.source, mcp_config=args.mcp_config,
                                               output=output / "diagnostics/source-audit"))
    except Exception as error:
        passed = False
        write_json(output / "diagnostics/source-audit/failure.json", {"error": str(error)})
    check = next(row for row in result["checks"] if row.get("caseId") == "source_handoff")
    check.update({"passed": passed, "state": "complete"})
    result["sourceAuditState"] = "passed" if passed else "failed"
    result["passed"] = result["scenarioPassed"] and passed
    write_json(output / "results.json", result)
    return result


def make_video(output: Path) -> None:
    module = (REPO_ROOT / "tools" / "visual-review.mjs").as_uri()
    code = (
        f"import {{ makeVisualReviews }} from {json.dumps(module)};"
        "for (const path of await makeVisualReviews(process.argv[1])) console.log(path);"
    )
    # Older failed runs may intentionally have no recording. Assemble only this
    # run, while using the exact same shared renderer as browser reviews.
    with tempfile.TemporaryDirectory(prefix=".visual-review-", dir=output.parent) as staging:
        root = Path(staging)
        run = root / output.name
        run.mkdir()
        manifest = json.loads((output / "review-scenes.json").read_text())
        recording = Path(manifest.get("recording", "recording.mp4"))
        (run / recording).parent.mkdir(parents=True, exist_ok=True)
        (run / recording).symlink_to(output / recording)
        shutil.copy2(output / "review-scenes.json", run / "review-scenes.json")
        subprocess.run(["node", "--input-type=module", "-e", code, str(root)], check=True)
        result = run / "interaction-review.mp4"
        if not result.is_file():
            raise ReviewError("Shared review renderer did not produce interaction-review.mp4")
        shutil.move(result, output / result.name)


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SPECS_ROOT)
    parser.add_argument("--harness", type=Path, help="Optional standalone regression harness")
    parser.add_argument("--suite", choices=("all", "golden", "regression"), default="all")
    parser.add_argument("--app", type=Path, default=DEFAULT_CLAD / "LS 5.15 CLAD.app")
    parser.add_argument("--mcp-config", type=Path, default=DEFAULT_CLAD / "ls515-clad/state/mcp.json")
    parser.add_argument("--work-root", type=Path, default=Path(tempfile.gettempdir()) / "dimos-specs-review")
    parser.add_argument("--output-root", type=Path, default=SPECS_ROOT / "Tests/integration-tests/test-results")
    parser.add_argument("--duration", type=float, default=600, help="Continuous recording duration in seconds")
    parser.add_argument("--start-delay", type=float, default=5)
    parser.add_argument("--recorder", type=Path, help="Use a precompiled ScreenCaptureKit recorder")
    parser.add_argument("--recorder-cache", type=Path, default=Path.home() / "Library/Caches/dimos-specs-review")
    parser.add_argument("--prepare-only", action="store_true", help="Copy project/harness without using Lens Studio")
    parser.add_argument("--keep-open", action="store_true", help="Leave the disposable fixture project open for debugging")
    parser.add_argument("--prepared-project", type=Path, help="Retry an existing runner-created disposable .esproj")
    args = parser.parse_args()
    if args.duration <= args.start_delay + 5 or args.start_delay < 0:
        parser.error("duration must leave at least five seconds after the nonnegative start delay")
    for name in ("source", "harness", "app", "mcp_config", "work_root", "output_root", "recorder_cache"):
        value = getattr(args, name)
        if value is not None: setattr(args, name, value.expanduser().resolve())
    if args.prepared_project:
        args.prepared_project = args.prepared_project.expanduser().resolve()
        if args.prepare_only or not args.prepared_project.is_file():
            parser.error("--prepared-project must name an existing disposable .esproj")
    return args


def main() -> int:
    args = arguments()
    run_id = "SpecsReview-" + time.strftime("%Y%m%d-%H%M%S") + f"-{os.getpid()}"
    workspace = args.prepared_project.parent if args.prepared_project else args.work_root / run_id
    output = args.output_root / run_id
    output.mkdir(parents=True)
    try:
        if args.prepare_only:
            project = copy_project(args.source, workspace, args.harness or SPECS_ROOT / "Tests/integration-tests/IntegrationScenario.ts")
            write_json(output / "prepared.json", {"project": str(project), "workspace": str(workspace)})
            print(project)
            return 0
        for command in ("node", "ffmpeg", "ffprobe", "xcrun", "pgrep"):
            if not shutil.which(command):
                raise ReviewError(f"Required command is missing: {command}")
        args.mcp_config.parent.mkdir(parents=True, exist_ok=True)
        with args.mcp_config.with_suffix(".review.lock").open("w") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise ReviewError("Another native review owns this MCP connection") from error
            result = asyncio.run(review_and_restore(args, output, workspace))
            if args.harness is None and not args.keep_open:
                result = asyncio.run(verify_source_handoff(args, output, result))
        if args.harness is not None: make_video(output)
        if result["passed"] and args.harness is None and args.suite == "all" and not args.keep_open:
            subprocess.run(["node", str(REPO_ROOT / "tools/integration-tests/cleanup.mjs"),
                            "--root", str(args.output_root), "--keep", output.name], check=True)
        print(f"{'PASS' if result['passed'] else 'FAIL'}: {output}")
        return 0 if result["passed"] else 1
    except (Exception, KeyboardInterrupt) as error:
        interrupted = isinstance(error, KeyboardInterrupt)
        # AnyIO/MCP wrap errors in task groups; surface the actual single cause.
        while len(getattr(error, "exceptions", ())) == 1:
            error = error.exceptions[0]
        message = "Review interrupted" if interrupted else str(error)
        if args.mcp_config.is_file():
            with contextlib.suppress(ValueError, OSError):
                token = json.loads(args.mcp_config.read_text(encoding="utf-8")).get("token")
                if token:
                    message = message.replace(token, "[redacted]")
        write_json(output / "failure.json", {"error": message, "workspace": str(workspace)})
        results_path = output / "results.json"
        results = json.loads(results_path.read_text()) if results_path.is_file() else {
            "completed": False, "workspace": str(workspace), "checks": [],
        }
        results.update(passed=False, error=message)
        write_json(results_path, results)
        print(f"Review failed: {message}\nArtifacts: {output}", file=sys.stderr)
        return 130 if interrupted else 1


if __name__ == "__main__":
    raise SystemExit(main())
