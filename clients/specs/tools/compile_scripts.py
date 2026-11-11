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

from native_project import prepare_harness
from ls_awake import KeepAwake


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--app", type=Path, default=Path("/Applications/Lens Studio.app"))
    parser.add_argument("--include", type=Path, help="Additional standalone native diagnostic script")
    parser.add_argument("--output-root", type=Path,
                        default=Path(__file__).resolve().parents[3] / "Review Data/native-compile",
                        help="Directory for disposable compilation projects and results")
    args = parser.parse_args()
    cache = args.source / "Cache/TypeScript"
    compiler = args.app / "Contents/Plugins/Es_TypeScriptCompiler.bundle/lensifyts"
    if not compiler.is_file() or not (cache / "Src/Packages").is_dir():
        parser.error("Requires Lens Studio 5.15 and its existing Specs TypeScript package cache")
    args.output_root = args.output_root.expanduser().resolve()
    args.output_root.mkdir(parents=True, exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix="compile-", dir=args.output_root))
    shutil.copytree(cache / "Src", output / "Src")
    shutil.copytree(cache / "lib", output / "lib")
    shutil.rmtree(output / "Src/Assets/Scripts")
    shutil.copytree(args.source / "Assets/Scripts", output / "Src/Assets/Scripts")
    shutil.rmtree(output / "Src/Assets/Review", ignore_errors=True)
    if args.include:
        prepare_harness(output / "Src", args.include)
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
    with KeepAwake():
        raise SystemExit(main())
