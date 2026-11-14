"""GitHub and local CI share job dispatch and install audio before backend tests."""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]


@pytest.mark.parametrize("job,expected", [
    ("backend", ["deps planning", "preflight", "backend", "contract"]),
    ("core", ["preflight", "core"]),
    ("specs", ["preflight", "specs"]),
    ("launcher", ["preflight", "launcher"]),
    ("webxr", ["deps planning", "preflight", "webxr"]),
    ("all", ["deps planning", "preflight", "backend", "contract", "launcher",
             "core", "specs", "webxr"]),
])
def test_job_dispatch_installs_dependencies_before_checks(
    tmp_path: Path, job: str, expected: list[str],
) -> None:
    # Exercise the actual entrypoint with job bodies replaced by event recording.
    script = (ROOT / "launcher/scripts/run-ci.sh").read_text()
    entrypoint = script[script.index('CI_JOB="${1:-all}"'):]
    installer = tmp_path / "launcher/scripts/install-ci-system-deps.sh"
    installer.parent.mkdir(parents=True)
    installer.write_text('#!/bin/bash\necho "deps $1"\n')
    installer.chmod(0o755)
    stubs = ['set -euo pipefail', 'uname() { echo Linux; }',
             'check_runtime_tools() { echo preflight; }', 'run_timed() { "$@"; }']
    for function, event in [
        ("run_dimos_ar_job", "backend"), ("run_manipulation_contract_job", "contract"),
        ("run_launcher_job", "launcher"), ("run_client_core_job", "core"),
        ("run_client_specs_job", "specs"), ("run_client_webxr_job", "webxr"),
    ]:
        stubs.append(f'{function}() {{ echo {event}; }}')
    result = subprocess.run(
        ["bash", "-c", "\n".join(stubs) + "\n" + entrypoint, "ci-fixture", job],
        env={**os.environ, "ROOT": str(tmp_path), "CI_PLAYWRIGHT_SYSTEM_DEPS": "install"},
        capture_output=True, text=True, check=True,
    )
    assert result.stdout.splitlines()[:-2] == expected


def test_github_uses_only_shared_ci_jobs() -> None:
    workflow = (ROOT / ".github/workflows/ci.yml").read_text()
    commands = re.findall(r"^\s+run: (.+)$", workflow, re.MULTILINE)
    assert commands == [f"./launcher/scripts/run-ci.sh {job}"
                        for job in ("backend", "launcher", "core", "specs", "webxr")]
    assert "run: |" not in workflow
