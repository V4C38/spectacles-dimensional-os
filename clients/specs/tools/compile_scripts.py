#!/usr/bin/env python3
"""Compile current scripts with LS 5.15 in a disposable copy of its package cache.

This checks native TypeScript/component compilation; it does not validate runtime
rendering, shader compilation, scene wiring, or physical device behavior.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--app", type=Path, default=Path("/Applications/Lens Studio.app"))
    parser.add_argument("--include", type=Path, help="Additional standalone native diagnostic script")
    args = parser.parse_args()
    output = Path(tempfile.mkdtemp(prefix="specs-native-compile-"))
    cache = args.source / "Cache/TypeScript"
    compiler = args.app / "Contents/Plugins/Es_TypeScriptCompiler.bundle/lensifyts"
    if not compiler.is_file() or not (cache / "Src/Packages").is_dir():
        parser.error("Requires Lens Studio 5.15 and its existing Specs TypeScript package cache")
    shutil.copytree(cache / "Src", output / "Src")
    shutil.copytree(cache / "lib", output / "lib")
    shutil.rmtree(output / "Src/Assets/Scripts")
    shutil.copytree(args.source / "Assets/Scripts", output / "Src/Assets/Scripts")
    if args.include:
        review = output / "Src/Assets/Review"
        review.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(args.include, review / args.include.name)
    command = [str(compiler), "--parseDir", str(output / "Src"), "--componentsCompileDir", str(output / "Out/Components"),
               "--tsconfig", str(output / "Src/tsconfig.json"), "--declarations", str(output / "lib/LensifyTS/Declarations"),
               "--jsonLogs", "--generateUniqueCustomComponentTypeNames"]
    result = subprocess.run(command, text=True, capture_output=True, check=False)
    log = result.stdout + result.stderr
    (output / "compile.log").write_text(log)
    passed = result.returncode == 0 and '"type":"Error"' not in log and "Compilation steps finished" in log
    (output / "result.json").write_text(json.dumps({"passed": passed, "exitCode": result.returncode,
        "source": str(args.source.resolve()), "compiler": str(compiler), "runtimeVerified": False}, indent=2))
    print(f"{'PASS' if passed else 'FAIL'}: {output}")
    if not passed:
        print(log)
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
