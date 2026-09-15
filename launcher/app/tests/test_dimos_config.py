"""DimOS config file merge for the armodule section."""

from __future__ import annotations

import json
from pathlib import Path

from dimos_config import dimos_config_path, load_dimos_config, merge_armodule_config
from tag_config import DEFAULT_MOUNT, armodule_config_from_ui


def test_merge_armodule_preserves_other_sections(tmp_path: Path) -> None:
    path = dimos_config_path()
    path.parent.mkdir(parents=True)
    path.write_text('{"g": {"robot_ip": "10.0.0.1"}, "other": {"x": 1}}\n', encoding="utf-8")
    merge_armodule_config(
        armodule_config_from_ui(
            fiducial_marker=True,
            vps=False,
            map_code=None,
            mounts=[DEFAULT_MOUNT],
        )
    )
    data = load_dimos_config()
    assert data["g"]["robot_ip"] == "10.0.0.1"
    assert data["other"]["x"] == 1
    assert data["armodule"]["localization"]["providers"] == [{"type": "fiducial_marker"}]
    mounts = data["armodule"]["fiducial_marker_mounts"]
    assert mounts[0]["marker_id"] == 0
    assert "tag_id" not in mounts[0]
    raw = json.loads(path.read_text(encoding="utf-8"))
    assert raw["g"]["robot_ip"] == "10.0.0.1"
