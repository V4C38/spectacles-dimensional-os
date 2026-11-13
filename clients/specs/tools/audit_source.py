#!/usr/bin/env python3
"""Read-only proof that Lens Studio has returned to the current production source."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import time
from pathlib import Path

from core_package import compiler_sources
from ls_awake import KeepAwake
from review import (
    DEFAULT_CLAD,
    SPECS_ROOT,
    LensMcp,
    capture,
    runtime_error_lines,
    write_json,
)

FIXTURES = ("ReviewScenario", "ReviewCompileTrigger", "ColorProbe", "InterFontProbe", "CameraFixture",
            "IntegrationScenario", "IntegrationInput", "IntegrationCatalog", "HeaderProbe")


def production_sources(source: Path) -> dict[str, bytes]:
    scripts = {path.relative_to(source).as_posix(): path.read_bytes()
               for path in (source / "Assets/Scripts").rglob("*.ts")}
    scripts.update(compiler_sources(source))
    return scripts


async def wait_for_compiler(source: Path, output: Path, timeout: float = 600) -> str:
    """Wait for actual Source output, without creating any review assets there."""
    paths = production_sources(source)
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
        matches = paths and all((source / "Cache/TypeScript/Src" / path).is_file() and
                                (source / "Cache/TypeScript/Src" / path).read_bytes() == data
                                for path, data in paths.items())
        if success > max(pending, failure) and matches:
            return next(line for line in reversed(text.splitlines()) if "TypeScript compilation succeeded!" in line)
        await asyncio.sleep(0.5)
    raise RuntimeError("Source compiler output did not match current production scripts within the deadline")


def source_harness_is_idle(state: dict) -> bool:
    harness = state.get("harness", {})
    gates = harness.get("gates", [])
    return harness.get("hosts") == 1 and len(gates) == 1 and gates[0].get("autoRun") is False


def fresh_runtime_errors(logs: Path, offsets: dict[Path, int]) -> list[str]:
    errors: list[str] = []
    for path in logs.glob("LensStudioLog-*.txt"):
        offset = offsets.get(path, 0)
        if path.stat().st_size < offset:
            offset = 0
        with path.open("rb") as stream:
            stream.seek(offset)
            errors.extend(runtime_error_lines(stream.read().decode("utf-8", errors="replace")))
    return list(dict.fromkeys(errors))


async def audit(args: argparse.Namespace) -> bool:
    args.output.mkdir(parents=True, exist_ok=True)
    compile_proof = await wait_for_compiler(args.source, args.output)
    logs = Path.home() / "Library/Preferences/Snap/Lens Studio/logs"
    offsets = {path: path.stat().st_size for path in logs.glob("LensStudioLog-*.txt")}
    async with LensMcp(args.mcp_config, args.output / "source-audit-mcp") as mcp:
        state = await mcp.editor(
            "const project=pluginSystem.findInterface(Editor.Model.IModel).project;"
            'const hosts=project.scene.rootSceneObjects.flatMap(function visit(o){return [o,...o.children.flatMap(visit)]}).filter(o=>o.name==="Integration Test Harness");'
            'const gates=hosts.flatMap(h=>h.getComponents("ScriptComponent").filter(c=>c.inputNames.includes("autoRun")));'
            "return {project:project.projectDirectory.toString(),"
            'harness:{hosts:hosts.length,gates:gates.map(c=>({autoRun:(c as any).autoRun}))},'
            "roots:project.scene.rootSceneObjects.map(o=>o.name),"
            "sceneNames:project.scene.rootSceneObjects.flatMap(function names(o){return [o.name,...o.children.flatMap(names)]}),"
            f"fixtureAssets:project.assetManager.assets.filter(a=>{list(FIXTURES)!r}.includes(a.name)).map(a=>a.name)}};"
        )
        if Path(state.get("project", "")).resolve() != args.source:
            raise RuntimeError("Editor is not showing the production source; audit did not change projects")
        await mcp.editor('const panel:any=pluginSystem.findInterface(Editor.Dock.IDockManager).panels.find(p=>p.id.toString().includes("PreviewPanel"));if(!panel)throw new Error("Preview missing");panel.resume();panel.refresh();return {resumed:true};')
        await asyncio.sleep(1)
        screenshot = await capture(mcp, args.output, "source-preview")
    runtime_errors = fresh_runtime_errors(logs, offsets)
    scripts = []
    for relative, data in sorted(production_sources(args.source).items()):
        cached = args.source / "Cache/TypeScript/Src" / relative
        scripts.append({"path": str(relative), "sha256": hashlib.sha256(data).hexdigest(),
                        "compilerMatches": cached.is_file() and cached.read_bytes() == data})
    fixture_hosts = [name for name in FIXTURES if name + "Host" in state["sceneNames"]]
    logs = Path.home() / "Library/Preferences/Snap/Lens Studio/logs"
    latest = max(logs.glob("LensStudioLog-*.txt"), key=lambda path: path.stat().st_mtime)
    with latest.open("rb") as stream:
        stream.seek(max(0, latest.stat().st_size - 2_000_000))
        lines = stream.read().decode("utf-8", errors="replace").splitlines()
    completions = [line for line in lines if "TypeScript compilation succeeded!" in line]
    passed = (bool(scripts) and all(row["compilerMatches"] for row in scripts)
              and source_harness_is_idle(state) and not runtime_errors
              and not state["fixtureAssets"] and not fixture_hosts
              and not (args.source / "Assets/Review").exists() and bool(completions))
    result = {"passed": passed, "editor": state, "fixtureHosts": fixture_hosts,
              "hasReviewAssetsDirectory": (args.source / "Assets/Review").exists(),
              "scripts": scripts, "lastNativeCompile": compile_proof,
              "screenshot": screenshot.name, "runtimeErrors": runtime_errors}
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
    with KeepAwake():
        return 0 if asyncio.run(audit(args)) else 1


if __name__ == "__main__":
    raise SystemExit(main())
