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
    argv = mgr.build_start_argv(stack="g1", robot_ip="192.168.1.10", spatial_memory=True)
    assert "--stack" in argv and "g1" in argv
    assert argv[argv.index("--robot-ip") + 1] == "192.168.1.10"
    assert "--spatial-memory" in argv
    assert "--object-detection" not in argv


def test_setup_argv_clone_vs_python(tmp_path: Path) -> None:
    mgr = ProcessManager(root=tmp_path)
    (tmp_path / "launcher" / "scripts").mkdir(parents=True)
    (tmp_path / "launcher" / "scripts" / "setup.sh").write_text("#!/bin/sh\n")
    clone = mgr.build_setup_argv(clone_dir="/tmp/dimos")
    assert "--yes" in clone
    assert clone[clone.index("--clone-dir") + 1] == "/tmp/dimos"
    existing = mgr.build_setup_argv(dimos_python="/tmp/dimos/.venv/bin/python3")
    assert existing[existing.index("--dimos-python") + 1] == "/tmp/dimos/.venv/bin/python3"
