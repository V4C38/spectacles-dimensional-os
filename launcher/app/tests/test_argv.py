"""Argv construction for start.sh / setup.sh."""

from __future__ import annotations

from pathlib import Path

from armodule import BLUEPRINT_CLI, ProcessManager


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


def test_setup_sh_has_dimos_ref_and_no_stack() -> None:
    source = (Path(__file__).resolve().parents[2] / "scripts" / "setup.sh").read_text(
        encoding="utf-8"
    )
    assert "--dimos-ref" in source
    assert "DIMOS_VERSION=" in source
    assert "DIMOS_REF=" in source
    assert "--stack" not in source


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


def test_start_sh_maps_blueprint_to_cli() -> None:
    source = (Path(__file__).resolve().parents[2] / "scripts" / "start.sh").read_text(
        encoding="utf-8"
    )
    assert BLUEPRINT_CLI["unitree_go2_ar"] == "dimos-ar.unitree-go2-ar"
    assert BLUEPRINT_CLI["unitree_go2_ar_agentic"] == "dimos-ar.unitree-go2-ar-agentic"
    for python_name in BLUEPRINT_CLI:
        assert python_name in source
    assert 'CLI_BLUEPRINT="dimos-ar.${SELECTED_BLUEPRINT//_/-}"' in source
    assert "--replay" in source
    assert "Host IP:" in source
    assert "--stack" not in source
    assert "DIMOS_AR_TAG_MOUNTS" not in source
