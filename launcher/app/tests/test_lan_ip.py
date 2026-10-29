"""Route discovery fallbacks run against fake OS tools, without changing networking."""

import os
import subprocess
from pathlib import Path

import pytest


@pytest.mark.parametrize("platform", ["ubuntu", "macos"])
def test_shell_lan_ip_native_fallback(tmp_path: Path, platform: str) -> None:
    scripts = {
        "python3": "exit 1",
        "ip": 'echo "8.8.8.8 via 192.168.1.1 dev wlan0 src 192.168.1.42 uid 1000"'
        if platform == "ubuntu" else "exit 1",
        "route": 'echo "interface: en0"' if platform == "macos" else "exit 1",
        "ipconfig": 'test "$1" = getifaddr && test "$2" = en0 && echo 192.168.1.42',
    }
    for name, body in scripts.items():
        command = tmp_path / name
        command.write_text(f"#!/bin/sh\n{body}\n")
        command.chmod(0o755)
    library = Path(__file__).resolve().parents[2] / "scripts" / "dimos_lib.sh"
    result = subprocess.run(
        ["/bin/bash", "-c", 'set -euo pipefail; source "$1"; detect_lan_ip', "bash", str(library)],
        env={**os.environ, "PATH": f"{tmp_path}:/usr/bin:/bin",
             "DIMOS_PYTHON": str(tmp_path / "python3")},
        capture_output=True, text=True, check=True,
    )
    assert result.stdout.strip() == "192.168.1.42"
