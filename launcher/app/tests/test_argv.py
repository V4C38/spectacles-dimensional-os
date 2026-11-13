"""Argv construction for start.sh / setup.sh."""

from __future__ import annotations

from pathlib import Path

import pytest

from armodule import ProcessManager


def test_start_argv_discovers_when_no_robot_ip(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    (tmp_path / "launcher" / "scripts").mkdir(parents=True)
    (tmp_path / "launcher" / "scripts" / "start.sh").write_text("#!/bin/sh\n")
    argv = mgr.build_start_argv(blueprint="unitree_go2_ar")
    assert argv[-2:] == ["--blueprint", "unitree_go2_ar"]
    assert "--robot-ip" not in argv
    assert "--stack" not in argv


def test_start_argv_pins_robot_ip(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    (tmp_path / "launcher" / "scripts").mkdir(parents=True)
    (tmp_path / "launcher" / "scripts" / "start.sh").write_text("#!/bin/sh\n")
    argv = mgr.build_start_argv(
        blueprint="unitree_go2_ar_agentic",
        robot_ip="192.168.1.10",
    )
    assert argv[argv.index("--blueprint") + 1] == "unitree_go2_ar_agentic"
    assert argv[argv.index("--robot-ip") + 1] == "192.168.1.10"


def test_start_argv_rejects_unknown_blueprint(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    try:
        mgr.build_start_argv(blueprint="not-a-blueprint")
        raise AssertionError("expected ValueError for invalid blueprint")
    except ValueError as exc:
        assert "blueprint" in str(exc)


def test_setup_argv_clone_vs_python(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    (tmp_path / "launcher" / "scripts").mkdir(parents=True)
    (tmp_path / "launcher" / "scripts" / "setup.sh").write_text("#!/bin/sh\n")
    clone = mgr.build_setup_argv(clone_dir="/tmp/dimos", dimos_ref="main")
    assert "--yes" in clone
    assert "--stack" not in clone
    assert clone[clone.index("--clone-dir") + 1] == "/tmp/dimos"
    assert clone[clone.index("--dimos-ref") + 1] == "main"
    existing = mgr.build_setup_argv(dimos_python="/tmp/dimos/.venv/bin/python3")
    assert existing[existing.index("--dimos-python") + 1] == "/tmp/dimos/.venv/bin/python3"
    assert "--dimos-ref" not in existing




def test_parse_dimos_refs_prefers_main_and_skips_peeled_tags() -> None:
    from app import _parse_dimos_refs

    raw = (
        "aaa\trefs/heads/dev\n"
        "bbb\trefs/heads/main\n"
        "ccc\trefs/tags/v1.0\n"
        "ddd\trefs/tags/v1.0^{}\n"
    )
    refs = _parse_dimos_refs(raw)
    assert refs[0] == "main"
    assert "dev" in refs
    assert "v1.0" in refs
    assert all(not item.endswith("^{}") for item in refs)


@pytest.mark.parametrize("script, arguments, error", [
    ("setup.sh", ["--dimos-ref"], "--dimos-ref requires"),
    ("setup.sh", ["--dimos-python"], "--dimos-python requires"),
    ("setup.sh", ["--clone-dir"], "--clone-dir requires"),
    ("setup.sh", ["--stack"], "Unknown option: --stack"),
    ("start.sh", ["--blueprint"], "--blueprint requires"),
    ("start.sh", ["--robot-ip"], "--robot-ip requires"),
    ("start.sh", ["--stack"], "Unknown option: --stack"),
])
def test_shell_argument_errors_stop_before_runtime_or_installation(tmp_path, script, arguments, error):
    import shutil
    import subprocess

    scripts = tmp_path / "launcher" / "scripts"
    scripts.mkdir(parents=True)
    original = Path(__file__).resolve().parents[2] / "scripts" / script
    command = scripts / script
    shutil.copyfile(original, command)
    # Isolate runtime discovery from the host even if argument parsing regresses.
    (scripts / "dimos_lib.sh").write_text(
        'find_dimos_python() { touch "${BASH_SOURCE[0]}.invoked"; return 1; }\n'
        'find_bootstrap_python() { touch "${BASH_SOURCE[0]}.invoked"; return 1; }\n'
        'print_dimos_python_help() { :; }\n'
    )
    completed = subprocess.run(["/bin/bash", str(command), *arguments],
                               env={"PATH": "/usr/bin:/bin", "CI": "1"},
                               capture_output=True, text=True, timeout=5, check=False)
    assert completed.returncode == 1
    assert error in completed.stderr
    assert not (scripts / "dimos_lib.sh.invoked").exists()


def test_noninteractive_discovery_requires_an_explicit_robot_when_ambiguous(tmp_path):
    import shutil
    import subprocess
    import sys

    scripts = tmp_path / "launcher/scripts"
    scripts.mkdir(parents=True)
    source = Path(__file__).resolve().parents[2] / "scripts/start.sh"
    shutil.copyfile(source, scripts / "start.sh")
    registry = scripts.parent / "app" / "robot_sources.py"
    registry.parent.mkdir()
    shutil.copyfile(source.parents[1] / "app/robot_sources.py", registry)
    python = tmp_path / "bin/python3"
    python.parent.mkdir()
    python.write_text(
        '#!/bin/sh\nif [ "$2" = "--menu" ]; then exec "$REGISTRY_PYTHON" "$@"; fi\n'
        "printf 'robot-a\\t10.0.0.1\\nrobot-b\\t10.0.0.2\\n'\n"
    )
    python.chmod(0o755)
    (scripts / "dimos_lib.sh").write_text(
        'find_dimos_python() { printf "%s\\n" "$TEST_PYTHON"; }\n'
        'python_has_dimos_ar() { return 0; }\n'
        'detect_lan_ip() { echo 10.0.0.8; }\n'
        'print_color() { printf "%s\\n" "$3" >&2; }\n'
    )
    result = subprocess.run(
        ["/bin/bash", str(scripts / "start.sh"), "--blueprint", "unitree_go2_ar"],
        env={"PATH": "/usr/bin:/bin", "HOME": str(tmp_path), "CI": "1", "TEST_PYTHON": str(python),
             "DIMOS_AR_SKIP_SYSCONFIG": "1", "REGISTRY_PYTHON": sys.executable},
        capture_output=True, text=True, timeout=5, check=False,
    )
    assert result.returncode == 1
    assert "--robot-ip" in result.stderr
    assert "robot-a" in result.stderr and "robot-b" in result.stderr
    assert "using first" not in result.stderr
