"""Pre-built AprilTag assets and PNG decode for the launcher UI."""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest

from apriltag_assets import bundled_png, decode_marker_id, ensure_png


@pytest.mark.parametrize("marker_id", [0, 1, 2])
def test_preset_pngs_are_bundled(marker_id: int) -> None:
    path = bundled_png(marker_id)
    assert path is not None
    assert decode_marker_id(path.read_bytes()) == marker_id


def test_ensure_png_serves_bundled_id_0() -> None:
    path = ensure_png(0)
    assert path.name == "apriltag_robot_0.png"
    assert path.is_file()
    assert decode_marker_id(path.read_bytes()) == 0


def test_ensure_png_generates_uncached_id(tmp_path: Path) -> None:
    path = ensure_png(7, root=tmp_path)
    assert path.is_file()
    assert path.parent == tmp_path / ".dimos-ar-launcher" / "apriltag-cache"
    assert decode_marker_id(path.read_bytes()) == 7


def test_decode_rejects_unreadable_bytes() -> None:
    with pytest.raises(ValueError, match="readable PNG"):
        decode_marker_id(b"not-a-png")


def test_decode_rejects_image_without_marker() -> None:
    ok, buffer = cv2.imencode(".png", np.zeros((80, 80), dtype=np.uint8))
    assert ok
    with pytest.raises(ValueError, match="no AprilTag"):
        decode_marker_id(buffer.tobytes())
