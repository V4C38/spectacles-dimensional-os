#!/usr/bin/env python3
"""Read-only proof that Lens Studio has returned to the current production source."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import time
from pathlib import Path

from review import DEFAULT_CLAD, SPECS_ROOT, LensMcp, capture, write_json

FIXTURES = ("ReviewScenario", "ReviewCompileTrigger", "ColorProbe", "InterFontProbe", "CameraFixture",
            "IntegrationScenario", "IntegrationInput", "IntegrationCatalog", "HeaderProbe")


async def wait_for_compiler(source: Path, output: Path, timeout: float = 600) -> str:
    """Wait for actual Source output, without creating any review assets there."""
    paths = list((source / "Assets/Scripts").rglob("*.ts"))
    logs = Path.home() / "Library/Preferences/Snap/Lens Studio/logs"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        latest = max(logs.glob("LensStudioLog-*.txt"), key=lambda path: path.stat().st_mtime)
        with latest.open("rb") as stream:
            stream.seek(max(0, latest.stat().st_size - 2_000_000))
            text = stream.read().decode("utf-8", errors="replace")
        success = text.rfind("TypeScript compilation succeeded!")
        pending = max(text.rfind("Starting TypeScript compilation..."),
                      text.rfind("Starting watched compilation cycle"),
                      text.rfind("Starting incremental components compilation"))
        failure = text.rfind("TypeScript compilation failed!")
        matches = paths and all((source / "Cache/TypeScript/Src" / path.relative_to(source)).is_file() and
                                (source / "Cache/TypeScript/Src" / path.relative_to(source)).read_bytes() == path.read_bytes()
                                for path in paths)
        if success > max(pending, failure) and matches:
            return next(line for line in reversed(text.splitlines()) if "TypeScript compilation succeeded!" in line)
        await asyncio.sleep(0.5)
    raise RuntimeError("Source compiler output did not match current production scripts within the deadline")


async def audit(args: argparse.Namespace) -> bool:
    args.output.mkdir(parents=True, exist_ok=True)
    compile_proof = await wait_for_compiler(args.source, args.output)
    async with LensMcp(args.mcp_config, args.output / "source-audit-mcp") as mcp:
        state = await mcp.editor(
            "const project=pluginSystem.findInterface(Editor.Model.IModel).project;"
            "return {project:project.projectDirectory.toString(),"
            "roots:project.scene.rootSceneObjects.map(o=>o.name),"
            f"fixtureAssets:project.assetManager.assets.filter(a=>{list(FIXTURES)!r}.includes(a.name)).map(a=>a.name)}};"
        )
        if Path(state.get("project", "")).resolve() != args.source:
            raise RuntimeError("Editor is not showing the production source; audit did not change projects")
        await mcp.editor('const panel:any=pluginSystem.findInterface(Editor.Dock.IDockManager).panels.find(p=>p.id.toString().includes("PreviewPanel"));if(!panel)throw new Error("Preview missing");panel.resume();panel.refresh();return {resumed:true};')
        await asyncio.sleep(1)
        screenshot = await capture(mcp, args.output, "source-preview")
    scripts = []
    for path in sorted((args.source / "Assets/Scripts").rglob("*.ts")):
        relative = path.relative_to(args.source)
        cached = args.source / "Cache/TypeScript/Src" / relative
        scripts.append({"path": str(relative), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                        "compilerMatches": cached.is_file() and cached.read_bytes() == path.read_bytes()})
    scene = (args.source / "Assets/Scene.scene").read_text(encoding="utf-8")
    fixture_hosts = [name for name in FIXTURES if name + "Host" in scene]
    logs = Path.home() / "Library/Preferences/Snap/Lens Studio/logs"
    latest = max(logs.glob("LensStudioLog-*.txt"), key=lambda path: path.stat().st_mtime)
    with latest.open("rb") as stream:
        stream.seek(max(0, latest.stat().st_size - 2_000_000))
        lines = stream.read().decode("utf-8", errors="replace").splitlines()
    completions = [line for line in lines if "TypeScript compilation succeeded!" in line]
    passed = (bool(scripts) and all(row["compilerMatches"] for row in scripts)
              and not state["fixtureAssets"] and not fixture_hosts
              and not (args.source / "Assets/Review").exists() and bool(completions))
    result = {"passed": passed, "editor": state, "fixtureHosts": fixture_hosts,
              "hasReviewAssetsDirectory": (args.source / "Assets/Review").exists(),
              "scripts": scripts, "lastNativeCompile": compile_proof,
              "screenshot": screenshot.name}
    write_json(args.output / "source-audit.json", result)
    print(f"{'PASS' if passed else 'FAIL'}: {len(scripts)} production scripts; {args.output / 'source-audit.json'}")
    return passed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SPECS_ROOT)
    parser.add_argument("--mcp-config", type=Path, default=DEFAULT_CLAD / "ls515-clad/state/mcp.json")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.source = args.source.expanduser().resolve()
    return 0 if asyncio.run(audit(args)) else 1


if __name__ == "__main__":
    raise SystemExit(main())
