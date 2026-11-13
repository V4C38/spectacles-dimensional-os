#!/usr/bin/env python3
"""Verify or synchronize the Specs package with canonical portable Core source."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import time
import zipfile
from collections.abc import Awaitable, Callable
from pathlib import Path, PurePosixPath

REPO_ROOT = Path(__file__).resolve().parents[3]
CORE_ROOT = REPO_ROOT / "clients/core/src"
SPECS_ROOT = REPO_ROOT / "clients/specs"
PACKAGE = SPECS_ROOT / "Packages/DimOSARClient.lspkg"
ARCHIVE_PREFIX = "Package/Assets/Scripts/DimOSARClient/"
CACHE_PREFIX = "Packages/DimOSARClient.lspkg/Scripts/DimOSARClient/"


def source_files(source: Path) -> dict[str, bytes]:
    files = {p.relative_to(source).as_posix(): p.read_bytes() for p in sorted(source.rglob("*.ts"))}
    if not files:
        raise ValueError(f"No Core TypeScript files found in {source}")
    return files


def read_package_sources(package: Path) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    with zipfile.ZipFile(package) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Package contains duplicate archive members")
        if "Package/Assets/package.native" not in names:
            raise ValueError("Package has no native descriptor")
        descriptor = archive.read("Package/Assets/package.native").decode("utf-8")
        match = re.search(r"!<NativePackageDescriptor/([0-9a-f-]{36})>", descriptor)
        if not match:
            raise ValueError("Malformed native package descriptor")
        if "Package/Assets/package.native.meta" not in names:
            raise ValueError("Package has no native descriptor metadata")
        descriptor_meta = archive.read("Package/Assets/package.native.meta").decode("utf-8")
        if f"PrimaryAsset: !<reference> {match[1]}" not in descriptor_meta:
            raise ValueError("Descriptor metadata identity mismatch")
        for name in names:
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts or "\\" in name:
                raise ValueError(f"Unsafe package member: {name}")
            allowed = name in {"Package/Assets/package.native", "Package/Assets/package.native.meta"} or name.startswith(ARCHIVE_PREFIX) and name.endswith((".ts", ".ts.meta"))
            if not name.endswith("/") and not allowed:
                raise ValueError(f"Unexpected package payload: {name}")
            if not name.endswith(".ts"):
                continue
            meta_name = name + ".meta"
            if meta_name not in names or not re.search(rb"PrimaryAsset: !<reference> [0-9a-f-]{36}", archive.read(meta_name)):
                raise ValueError(f"Missing or invalid script metadata: {name}")
            if not name.startswith(ARCHIVE_PREFIX):
                raise ValueError(f"Unexpected script outside Core: {name}")
            files[name[len(ARCHIVE_PREFIX):]] = archive.read(name)
        if not files:
            raise ValueError("Package contains no Core scripts")
    return files


def differences(expected: dict[str, bytes], actual: dict[str, bytes]) -> dict[str, list[str]]:
    return {
        "missing": sorted(expected.keys() - actual.keys()),
        "extra": sorted(actual.keys() - expected.keys()),
        "changed": sorted(k for k in expected.keys() & actual.keys() if expected[k] != actual[k]),
    }


def primary_asset_id(metadata: bytes) -> str:
    match = re.search(rb"PrimaryAsset: !<reference> ([0-9a-f-]{36})", metadata)
    if not match:
        raise ValueError("Metadata has no primary asset identity")
    return match[1].decode("ascii")


def package_version(source: Path) -> tuple[int, int, int] | None:
    manifest = source.parent / "package.json"
    if not manifest.is_file():
        return None
    version = json.loads(manifest.read_text())["version"]
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError("Core package version must have major.minor.patch form")
    return tuple(int(part) for part in version.split("."))


def check_package(source: Path = CORE_ROOT, package: Path = PACKAGE) -> dict[str, object]:
    expected, actual = source_files(source), read_package_sources(package)
    diff = differences(expected, actual)
    metadata_changed = []
    fingerprint = hashlib.sha256()
    with zipfile.ZipFile(package) as archive:
        for name, data in expected.items():
            fingerprint.update(name.encode())
            fingerprint.update(b"\0")
            fingerprint.update(data)
            metadata = source / (name + ".meta")
            if metadata.is_file():
                source_id = primary_asset_id(metadata.read_bytes())
                fingerprint.update(source_id.encode("ascii"))
                if name in actual and source_id != primary_asset_id(archive.read(ARCHIVE_PREFIX + name + ".meta")):
                    metadata_changed.append(name)
        expected_version = package_version(source)
        version_changed = False
        if expected_version is not None:
            descriptor = archive.read("Package/Assets/package.native").decode("utf-8")
            fields = [re.search(rf"^  Version{part}: ([0-9]+)$", descriptor, re.MULTILINE)
                      for part in ("Major", "Minor", "Patch")]
            actual_version = tuple(int(field[1]) for field in fields if field is not None)
            version_changed = actual_version != expected_version
    return {"passed": not any(diff.values()) and not metadata_changed and not version_changed,
            "files": len(expected), "fingerprint": fingerprint.hexdigest(), **diff,
            "metadata_changed": sorted(metadata_changed), "version_changed": version_changed}


def extract_sources(package: Path, destination: Path) -> None:
    """Materialize verified archive paths for the Specs test/compiler toolchain."""
    files = read_package_sources(package)
    destination.mkdir(parents=True, exist_ok=True)
    # This directory is generated; remove stale modules as well as overwriting edits.
    for old in destination.rglob("*.ts"):
        old.unlink()
    for name, data in files.items():
        path = destination / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


def compiler_sources(source: Path = SPECS_ROOT, package: Path | None = None) -> dict[str, bytes]:
    package = package or source / "Packages/DimOSARClient.lspkg"
    return {CACHE_PREFIX + name: data for name, data in read_package_sources(package).items()}


def prepare_builder(source: Path, package: Path, workspace: Path, app: Path) -> Path:
    template = app / "Contents/Resources/ModelResources.bundle/ProjectTemplates/Default"
    if workspace.exists():
        shutil.rmtree(workspace)
    shutil.copytree(template, workspace)
    projects = list(workspace.glob("*.esproj"))
    if len(projects) != 1:
        raise ValueError("Installed Lens template must contain one project")
    stage = workspace / "Assets/DimOSARClient.lspkg"
    if package.exists():
        read_package_sources(package)
        with zipfile.ZipFile(package) as archive:
            for name in archive.namelist():
                if name.startswith("Package/Assets/") and not name.endswith("/"):
                    target = stage / name[len("Package/Assets/"):]
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(archive.read(name))
    # Unpacked native package reuses descriptor and per-script UUIDs from the prior export.
    target = stage / "Scripts/DimOSARClient" if package.exists() else workspace / "Assets/Scripts/DimOSARClient"
    expected = source_files(source)
    if target.exists():
        for old in target.rglob("*.ts"):
            if old.relative_to(target).as_posix() not in expected:
                old.unlink()
                old.with_suffix(old.suffix + ".meta").unlink(missing_ok=True)
    for name, data in expected.items():
        path = target / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        meta = source / (name + ".meta")
        if meta.exists():
            shutil.copy2(meta, path.with_suffix(path.suffix + ".meta"))
    return projects[0]


def log_offsets() -> dict[Path, int]:
    logs = Path.home() / "Library/Preferences/Snap/Lens Studio/logs"
    return {p: p.stat().st_size for p in logs.glob("LensStudioLog-*.txt")}


async def wait_compilation(project: Path, expected: dict[str, bytes], relative: str,
                           timeout: float, offsets: dict[Path, int]) -> None:
    deadline = time.monotonic() + timeout
    logs = Path.home() / "Library/Preferences/Snap/Lens Studio/logs"
    while time.monotonic() < deadline:
        matches = all((project / "Cache/TypeScript/Src" / relative / name).is_file()
                      and (project / "Cache/TypeScript/Src" / relative / name).read_bytes() == data
                      for name, data in expected.items())
        paths = list(logs.glob("LensStudioLog-*.txt"))
        if paths:
            latest = max(paths, key=lambda p: p.stat().st_mtime)
            with latest.open("rb") as stream:
                stream.seek(min(offsets.get(latest, 0), latest.stat().st_size))
                text = stream.read().decode("utf-8", errors="replace")
            success = text.rfind("TypeScript compilation succeeded!")
            pending = max(text.rfind("Starting TypeScript compilation..."),
                          text.rfind("Starting watched compilation cycle"),
                          text.rfind("Starting incremental components compilation"))
            if matches and success > max(pending, text.rfind("TypeScript compilation failed!")):
                return
        await asyncio.sleep(.5)
    raise RuntimeError("Native compilation did not match the staged Core source")


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as staging:
        temporary = Path(staging.name)
        staging.write(data)
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def validate_project_owner(current: Path, production: Path, authoring: Path) -> None:
    if current.resolve() not in {production.resolve(), authoring.resolve()}:
        raise ValueError("Another project is open; package sync only owns Specs and its authoring project")


async def publish_candidate(candidate: Path, package: Path,
                            verify: Callable[[], Awaitable[bool]],
                            restore_previous: Callable[[], Awaitable[None]]) -> None:
    previous = package.read_bytes() if package.exists() else None
    installed = False
    try:
        atomic_write(package, candidate.read_bytes())
        installed = True
        if not await verify():
            raise RuntimeError("Production source handoff failed")
    except BaseException as failure:
        rollback_succeeded = True
        if installed:
            try:
                if previous is None:
                    package.unlink(missing_ok=True)
                else:
                    atomic_write(package, previous)
            except BaseException as rollback_error:  # noqa: BLE001 -- retain the primary failure
                rollback_succeeded = False
                failure.add_note(f"Package rollback failed: {rollback_error}")
        if rollback_succeeded:
            try:
                await restore_previous()
            except BaseException as restore_error:  # noqa: BLE001 -- retain the primary failure
                failure.add_note(f"Previous production state was not verified: {restore_error}")
        raise


async def restore_production(args: argparse.Namespace, phase: str = "restore") -> bool:
    from audit_source import audit
    from review import LensMcp

    async with LensMcp(args.mcp_config, args.output / phase) as mcp:
        await mcp.editor(f'pluginSystem.findInterface(Editor.Model.IModel).openProject(new Editor.Path({json.dumps(str(SPECS_ROOT / "spectacles-dimensional-os.esproj"))}));return {{requested:true}};')
    if not args.package.exists():
        # Failed bootstrap restores absence; there is no prior package to validate.
        return False
    handoff = argparse.Namespace(source=SPECS_ROOT, mcp_config=args.mcp_config,
                                output=args.output / (phase + "-source-audit"))
    return bool(await audit(handoff))


async def synchronize(args: argparse.Namespace) -> bool:
    # Imported only for sync: check/extract work on Linux without the MCP SDK or macOS.
    import fcntl

    from ls_awake import KeepAwake
    from review import LensMcp

    args.output.mkdir(parents=True, exist_ok=True)
    workspace = args.cache / "authoring"
    args.cache.mkdir(parents=True, exist_ok=True)
    with KeepAwake(), args.mcp_config.with_suffix(".review.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        async with LensMcp(args.mcp_config, args.output / "preflight") as mcp:
            state = await mcp.editor('return {project:pluginSystem.findInterface(Editor.Model.IModel).project.projectDirectory.toString()};')
            validate_project_owner(Path(state["project"]), SPECS_ROOT, workspace)
            if Path(state["project"]).resolve() == workspace.resolve():
                offsets = log_offsets()
                await mcp.editor(f'pluginSystem.findInterface(Editor.Model.IModel).openProject(new Editor.Path({json.dumps(str(SPECS_ROOT / "spectacles-dimensional-os.esproj"))}));return {{requested:true}};')
                deadline = time.monotonic() + args.timeout
                while True:
                    state = await mcp.editor('return {project:pluginSystem.findInterface(Editor.Model.IModel).project.projectDirectory.toString()};')
                    if not Path(state["project"]).resolve().is_relative_to(args.cache):
                        break
                    if time.monotonic() >= deadline:
                        raise RuntimeError("Could not close authoring project before rebuilding")
                    await asyncio.sleep(.5)
        project = prepare_builder(args.source, args.package, workspace, args.app)
        expected = source_files(args.source)
        candidate = args.cache / "DimOSARClient.candidate.lspkg"
        candidate.unlink(missing_ok=True)
        handoff_started = False
        # Always restore the runnable Specs project, including failure and cancellation.
        try:
            async with LensMcp(args.mcp_config, args.output / "build") as mcp:
                offsets = log_offsets()
                await mcp.editor(f'pluginSystem.findInterface(Editor.Model.IModel).openProject(new Editor.Path({json.dumps(str(project))})); return {{requested:true}};')
                relative = "Assets/DimOSARClient.lspkg/Scripts/DimOSARClient" if args.package.exists() else "Assets/Scripts/DimOSARClient"
                await wait_compilation(workspace, expected, relative, args.timeout, offsets)
                if not args.package.exists():
                    offsets = log_offsets()
                    await mcp.editor(
                        f'const p=pluginSystem.findInterface(Editor.Model.IModel).project; if(p.projectDirectory.toString()!=={json.dumps(str(workspace.resolve()))}) throw new Error("Wrong authoring project");'
                        'const files=p.assetManager.assets.filter(a=>a.getTypeName()==="TypeScriptAsset"&&a.fileMeta.sourcePath.toString().includes("Scripts/DimOSARClient/"));'
                        f'if(files.length!=={len(expected)}) throw new Error("Incomplete staged source");'
                        'p.assetManager.createPackage(files.map(a=>a.fileMeta),new Editor.Model.SourcePath(new Editor.Path(""),Editor.Model.SourceRootDirectory.Assets),"DimOSARClient",Editor.Model.PackageOption.Unpacked);return {requested:true};'
                    )
                    await wait_compilation(workspace, expected, "Assets/DimOSARClient.lspkg/Scripts/DimOSARClient", args.timeout, offsets)
                await mcp.editor(
                    f'const p=pluginSystem.findInterface(Editor.Model.IModel).project;if(p.projectDirectory.toString()!=={json.dumps(str(workspace.resolve()))})throw new Error("Wrong authoring project");'
                    'const descriptor=p.assetManager.assets.find(a=>a.getTypeName()==="NativePackageDescriptor"&&a.fileMeta.sourcePath.toString().includes("DimOSARClient.lspkg"));if(!descriptor)throw new Error("Package descriptor not ready");'
                    f'descriptor.version=new Editor.Assets.Version({",".join(map(str, package_version(args.source) or (0, 2, 0)))});'
                    'const options=new Editor.Model.ExportOptions();options.packagePolicy=Editor.Assets.PackagePolicy.CanBeUnpacked;'
                    f'pluginSystem.findInterface(Editor.IPackageActions).exportPackage(descriptor as Editor.Assets.NativePackageDescriptor,new Editor.Path({json.dumps(str(candidate))}),options);return {{requested:true}};'
                )
            deadline = time.monotonic() + args.timeout
            while not candidate.is_file() and time.monotonic() < deadline:
                await asyncio.sleep(.5)
            result = check_package(args.source, candidate)
            if not result["passed"]:
                raise ValueError(f"Export differs from source: {result}")
            # Refuse a source edit made while the editor was exporting.
            if source_files(args.source) != expected:
                raise ValueError("Core source changed during package export")
            async def verify() -> bool:
                return await restore_production(args)

            async def rollback_handoff() -> None:
                verified = await restore_production(args, "rollback")
                if args.package.exists() and not verified:
                    raise RuntimeError("Previous package source handoff failed")

            handoff_started = True
            await publish_candidate(candidate, args.package, verify, rollback_handoff)
        except BaseException as failure:
            if not handoff_started:
                try:
                    verified = await restore_production(args)
                    if args.package.exists() and not verified:
                        raise RuntimeError("Production source handoff failed")
                except BaseException as restore_error:  # noqa: BLE001 -- retain the primary failure
                    failure.add_note(f"Production restoration failed: {restore_error}")
            raise
        return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("check", "extract", "sync"))
    parser.add_argument("--source", type=Path, default=CORE_ROOT)
    parser.add_argument("--package", type=Path, default=PACKAGE)
    parser.add_argument("--destination", type=Path)
    clad = Path(os.environ.get("DIMOS_CLAD_ROOT", Path.home() / ".local/share/ls515-clad"))
    parser.add_argument("--app", type=Path, default=clad / "LS 5.15 CLAD.app")
    parser.add_argument("--mcp-config", type=Path, default=clad / "ls515-clad/state/mcp.json")
    parser.add_argument("--cache", type=Path, default=Path.home() / "Library/Caches/dimos-clientcore-package")
    parser.add_argument("--output", type=Path, default=REPO_ROOT / "Review Data/core-package" / time.strftime("%Y%m%d-%H%M%S"))
    parser.add_argument("--timeout", type=float, default=600)
    args = parser.parse_args()
    for key in ("source", "package", "app", "mcp_config", "cache", "output", "destination"):
        if getattr(args, key) is not None:
            setattr(args, key, getattr(args, key).expanduser().resolve())
    try:
        if args.action == "sync" and args.cache.is_relative_to(REPO_ROOT):
            raise ValueError("Package authoring cache must be outside the repository")
        if args.action == "extract":
            if args.destination is None:
                parser.error("extract requires --destination")
            if args.destination.is_relative_to(REPO_ROOT) and not args.destination.is_relative_to(REPO_ROOT / "Review Data"):
                raise ValueError("Extraction destination inside the repository must be under Review Data")
            extract_sources(args.package, args.destination)
            return 0
        if args.action == "check":
            result = check_package(args.source, args.package)
            print(json.dumps(result, indent=2))
            if not result["passed"]:
                print("Core package is stale; run python3 clients/specs/tools/core_package.py sync.", file=sys.stderr)
            return 0 if result["passed"] else 1
        if args.package.exists() and check_package(args.source, args.package)["passed"]:
            print("Core package already matches source; no update required")
            return 0
        return 0 if asyncio.run(synchronize(args)) else 1
    except (OSError, ValueError, zipfile.BadZipFile, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        for note in getattr(error, "__notes__", []):
            print(note, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
