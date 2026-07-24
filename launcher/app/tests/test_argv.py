"""Argv construction for start.sh / setup.sh."""

from __future__ import annotations

from pathlib import Path

from bridge import ProcessManager


def test_start_argv_discovers_when_no_robot_ip(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    (tmp_path / "launcher" / "scripts").mkdir(parents=True)
    (tmp_path / "launcher" / "scripts" / "start.sh").write_text("#!/bin/sh\n")
    argv = mgr.build_start_argv(stack="go2")
    assert argv[-2:] == ["--stack", "go2"] or (
        argv[1] == "--stack" and argv[2] == "go2" and "--robot-ip" not in argv
    )
    assert "--robot-ip" not in argv


def test_start_argv_pins_robot_ip(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    (tmp_path / "launcher" / "scripts").mkdir(parents=True)
    (tmp_path / "launcher" / "scripts" / "start.sh").write_text("#!/bin/sh\n")
    argv = mgr.build_start_argv(stack="g1", robot_ip="192.168.1.10")
    assert "--stack" in argv and "g1" in argv
    assert argv[argv.index("--robot-ip") + 1] == "192.168.1.10"
    assert "--spatial-memory" not in argv
    assert "--object-detection" not in argv


def test_setup_argv_clone_vs_python(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    (tmp_path / "launcher" / "scripts").mkdir(parents=True)
    (tmp_path / "launcher" / "scripts" / "setup.sh").write_text("#!/bin/sh\n")
    clone = mgr.build_setup_argv(clone_dir="/tmp/dimos")
    assert "--yes" in clone
    assert clone[clone.index("--stack") + 1] == "go2"
    assert clone[clone.index("--clone-dir") + 1] == "/tmp/dimos"
    existing = mgr.build_setup_argv(
        stack="g1",
        dimos_python="/tmp/dimos/.venv/bin/python3",
    )
    assert existing[existing.index("--stack") + 1] == "g1"
    assert existing[existing.index("--dimos-python") + 1] == "/tmp/dimos/.venv/bin/python3"


def test_setup_argv_requires_valid_stack(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    (tmp_path / "launcher" / "scripts").mkdir(parents=True)
    (tmp_path / "launcher" / "scripts" / "setup.sh").write_text("#!/bin/sh\n")
    try:
        mgr.build_setup_argv(stack="spot", clone_dir="/tmp/dimos")
        raise AssertionError("expected ValueError for invalid stack")
    except ValueError as exc:
        assert "stack" in str(exc)
