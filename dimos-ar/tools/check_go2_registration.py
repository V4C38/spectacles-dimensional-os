"""Read-only rejection check for a proposed per-packet odometry-scale translation.

This can reject an unsafe correction using repeated world geometry. It cannot
qualify metric scale, camera calibration, or exposure timing without a survey.
The input is a DimOS SQLite recording with LCM lidar and recorded robot poses.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sqlite3

import numpy as np
from numpy.typing import NDArray
from scipy.spatial import cKDTree


def compare_clouds(
    first: NDArray[np.float64],
    second: NDArray[np.float64],
    displacement_xy: NDArray[np.float64],
    *,
    factor: float,
) -> dict[str, float]:
    if (
        not np.isfinite(factor)
        or factor <= 0
        or first.ndim != 2
        or second.ndim != 2
        or first.shape[1] != 3
        or second.shape[1] != 3
        or not len(first)
        or not len(second)
        or not np.isfinite(first).all()
        or not np.isfinite(second).all()
        or displacement_xy.shape != (2,)
        or not np.isfinite(displacement_xy).all()
    ):
        raise ValueError("finite XYZ clouds, XY displacement and a positive factor are required")
    tree = cKDTree(first)
    unchanged = tree.query(second)[0]
    # Remove the common translation, retaining the proposed relative packet shift.
    shift = np.r_[(factor - 1) * displacement_xy, 0]
    candidate = tree.query(second + shift)[0]
    first_scaled, second_scaled = first.copy(), second.copy()
    first_scaled[:, :2] *= factor
    second_scaled[:, :2] *= factor
    fixed_scale = cKDTree(first_scaled).query(second_scaled)[0]
    return {
        "displacement_m": float(np.linalg.norm(displacement_xy)),
        "unchanged_overlap_2cm": float(np.mean(unchanged < 0.02)),
        "candidate_overlap_2cm": float(np.mean(candidate < 0.02)),
        "unchanged_median_m": float(np.median(unchanged)),
        "candidate_median_m": float(np.median(candidate)),
        "fixed_scale_overlap_2cm": float(np.mean(fixed_scale < 0.02)),
        "fixed_scale_median_m": float(np.median(fixed_scale)),
    }


def check_recording(path: Path, *, factor: float = 1.25) -> dict[str, object]:
    from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2

    with sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True) as db:
        config = json.loads(
            db.execute("SELECT config FROM _streams WHERE name='lidar'").fetchone()[0]
        )
        if config["codec_id"] != "lcm" or not config["payload_module"].endswith(".PointCloud2"):
            raise ValueError("recording must contain LCM PointCloud2 lidar")
        rows = db.execute("SELECT id,ts,pose_x,pose_y FROM lidar ORDER BY ts").fetchall()
        if len(rows) < 2 or any(row[2] is None or row[3] is None for row in rows):
            raise ValueError("at least two lidar frames with recorded robot poses are required")
        poses = np.asarray([row[2:] for row in rows], dtype=np.float64)
        if not np.isfinite(poses).all():
            raise ValueError("recorded poses must be finite")
        cache: dict[int, NDArray[np.float64]] = {}

        def points(index: int) -> NDArray[np.float64]:
            if index not in cache:
                raw = db.execute(
                    "SELECT data FROM lidar_blob WHERE id=?", (rows[index][0],)
                ).fetchone()[0]
                cloud = PointCloud2.lcm_decode(raw)
                if cloud.frame_id != "world":
                    raise ValueError("this check requires Go2 world-frame packets")
                xyz = np.asarray(cloud.points_f32(), dtype=np.float64)
                # Floor planes alone can conceal horizontal registration errors.
                cache[index] = xyz[
                    np.isfinite(xyz).all(axis=1) & (xyz[:, 2] > 0.15) & (xyz[:, 2] < 1.5)
                ]
            return cache[index]

        pairs = []
        for first in range(0, len(rows) - 1, 15):
            distance = np.linalg.norm(poses[first + 1 :] - poses[first], axis=1)
            candidates = np.flatnonzero((distance > 0.8) & (distance < 1.2))
            if not len(candidates):
                continue
            second = first + 1 + int(candidates[0])
            a, b = points(first), points(second)
            if min(len(a), len(b)) < 100:
                continue
            metrics = compare_clouds(a, b, poses[second] - poses[first], factor=factor)
            pairs.append({"frame_ids": [rows[first][0], rows[second][0]], **metrics})
    rejected = (
        sum(
            pair["unchanged_overlap_2cm"] >= 0.5
            and pair["candidate_overlap_2cm"] < pair["unchanged_overlap_2cm"] - 0.2
            for pair in pairs
        )
        >= 3
    )
    return {
        "recording": path.name,
        "factor": factor,
        "frames": len(rows),
        "status": "rejected" if rejected else "inconclusive",
        "proposal": "robot-relative packet translation",
        "note": "Fixed XY scaling is reported separately. Neither comparison qualifies physical scale.",
        "pairs": pairs,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recording", type=Path)
    parser.add_argument("--factor", type=float, default=1.25)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = check_recording(args.recording, factor=args.factor)
    text = json.dumps(report, indent=2) + "\n"
    if args.output:
        args.output.write_text(text)
    else:
        print(text, end="")
    return 2 if report["status"] == "rejected" else 0


if __name__ == "__main__":
    raise SystemExit(main())
