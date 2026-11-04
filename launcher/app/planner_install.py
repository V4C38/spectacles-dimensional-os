"""Preserve a selected editable DimOS checkout when installing its planning extra."""

from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
import tomllib
from importlib import metadata
from pathlib import Path
from urllib.parse import unquote, urlsplit


def source_checkout() -> Path | None:
    raw = metadata.distribution("dimos").read_text("direct_url.json")
    if not raw:
        return None
    direct = json.loads(raw)
    url = urlsplit(direct.get("url", ""))
    if not direct.get("dir_info", {}).get("editable") or url.scheme != "file":
        return None
    source = Path(unquote(url.path))
    project = source / "pyproject.toml"
    if (
        project.is_file()
        and tomllib.loads(project.read_text()).get("project", {}).get("name") == "dimos"
    ):
        return source
    return None


def conflicting_roboplan_packages() -> list[str]:
    from packaging.requirements import Requirement

    try:
        installed = metadata.version("roboplan")
    except metadata.PackageNotFoundError:
        return []
    requirements = [
        Requirement(raw)
        for raw in metadata.requires("dimos") or []
        if Requirement(raw).name == "roboplan"
    ]
    if all(installed in requirement.specifier for requirement in requirements):
        return []
    # 0.7's split native modules must not shadow 0.6's monolithic installation.
    return sorted(
        {
            str(dist.metadata["Name"])
            for dist in metadata.distributions()
            if str(dist.metadata["Name"])
            .lower()
            .replace("_", "-")
            .startswith("roboplan")
        }
    )


if __name__ == "__main__":
    if sys.argv[1:] == ["--source"]:
        source = source_checkout()
        if source is None:
            raise SystemExit(1)
        print(source)
    elif sys.argv[1:] == ["--clean-conflicts"]:
        packages = conflicting_roboplan_packages()
        if packages:
            if importlib.util.find_spec("pip") is not None:
                command = [sys.executable, "-m", "pip", "uninstall", "-y", *packages]
            elif shutil.which("uv"):
                command = [
                    "uv",
                    "pip",
                    "uninstall",
                    "--python",
                    sys.executable,
                    *packages,
                ]
            else:
                raise SystemExit(
                    "Install pip or uv before repairing planning dependencies"
                )
            subprocess.run(command, check=True)
    else:
        raise SystemExit("Use --source or --clean-conflicts")
