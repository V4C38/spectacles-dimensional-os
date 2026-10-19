"""Fit a physical headset camera offline; validate against held-out surveyed views.

See ../CALIBRATION.md for the JSON observation format. Requires numpy, scipy, opencv.
No capture, networking, or headset-specific calibration estimates are performed here.
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation

BASIS = np.array([[0, 0, -1], [-1, 0, 0], [0, 1, 0]], dtype=float)


def transform(pose: dict[str, Any]) -> np.ndarray:
    result = np.eye(4)
    result[:3, :3] = Rotation.from_quat(pose["orientation"]).as_matrix()
    result[:3, 3] = pose["position"]
    if not np.isfinite(result).all():
        raise ValueError("non-finite pose")
    return result


def camera_matrix(parameters: np.ndarray) -> np.ndarray:
    fx, fy, cx, cy = parameters[:4]
    return np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]])


def extrinsic(parameters: np.ndarray) -> np.ndarray:
    result = np.eye(4)
    result[:3, :3] = Rotation.from_rotvec(parameters[7:10]).as_matrix()
    result[:3, 3] = parameters[4:7]
    return result


def client_optical(parameters: np.ndarray, observation: dict[str, Any]) -> np.ndarray:
    # T_tracking_viewer x T_viewer_optical, then change only the world basis.
    basis4 = np.eye(4)
    basis4[:3, :3] = BASIS
    return basis4 @ transform(observation["viewerPose"]) @ extrinsic(parameters)


def project(parameters: np.ndarray, observation: dict[str, Any]) -> np.ndarray:
    odom_optical = transform(observation["expectedOrigin"]) @ client_optical(
        parameters, observation
    )
    points = np.asarray(observation["corners3d"], dtype=float)
    optical = (points - odom_optical[:3, 3]) @ odom_optical[:3, :3]
    # Keep the optimizer finite if a trial crosses the optical plane; final checks reject it.
    z = np.maximum(optical[:, 2:], 1e-6)
    return optical[:, :2] / z * parameters[:2] + parameters[2:4]


def validate_observations(observations: list[dict[str, Any]]) -> None:
    if len(observations) < 4:
        raise ValueError("need at least four observations in each independent split")
    signatures = set()
    for observation in observations:
        points = np.asarray(observation["corners3d"], dtype=float)
        pixels = np.asarray(observation["corners2d"], dtype=float)
        if points.ndim != 2 or points.shape[1] != 3 or points.shape[0] < 4:
            raise ValueError("need at least four 3D corners per observation")
        if (
            pixels.shape != (len(points), 2)
            or not np.isfinite(pixels).all()
            or not np.isfinite(points).all()
        ):
            raise ValueError("invalid pixel/corner data")
        transform(observation["viewerPose"])
        transform(observation["expectedOrigin"])
        signatures.add(json.dumps(observation["viewerPose"], sort_keys=True))
    if len(signatures) < 4:
        raise ValueError("need at least four distinct viewpoints")


def fit(dataset: dict[str, Any]) -> dict[str, Any]:
    training, validation = dataset["training"], dataset["validation"]
    validate_observations(training)
    validate_observations(validation)
    ids = [observation["id"] for observation in training + validation]
    if len(ids) != len(set(ids)):
        raise ValueError("training and validation must contain independent frame IDs")
    training_poses = {json.dumps(o["viewerPose"], sort_keys=True) for o in training}
    if any(
        json.dumps(o["viewerPose"], sort_keys=True) in training_poses
        for o in validation
    ):
        raise ValueError("validation must use held-out viewpoints")
    if dataset["id"] not in ("quest3", "quest3s"):
        raise ValueError("unknown headset")
    label = dataset["cameraLabel"]
    if not label or any(word in label.lower() for word in ("avatar", "virtual")):
        raise ValueError("physical camera label required")
    stream = dataset["stream"]
    width, height = stream["width"], stream["height"]
    if width <= 0 or height <= 0 or stream["facingMode"] != "environment":
        raise ValueError("invalid stream identity")
    # Numerical initialization only. No resulting profile is accepted without independent validation.
    initial = np.array([width, width, width / 2, height / 2, 0, 0, 0, np.pi, 0, 0])

    def residual(parameters: np.ndarray) -> np.ndarray:
        return np.concatenate(
            [
                (project(parameters, observation) - observation["corners2d"]).ravel()
                for observation in training
            ]
        )

    solution = least_squares(
        residual, initial, max_nfev=5000, x_scale="jac", loss="linear"
    )
    if (
        not solution.success
        or not np.isfinite(solution.x).all()
        or np.linalg.matrix_rank(solution.jac) < 10
    ):
        raise ValueError(
            "calibration is unconstrained or did not converge; collect varied views"
        )
    parameters = solution.x
    if np.any(parameters[:2] <= 0):
        raise ValueError("invalid focal lengths")
    reprojection, origins, headings = [], [], []
    for observation in validation:
        points = np.asarray(observation["corners3d"], dtype=np.float64)
        pixels = np.asarray(observation["corners2d"], dtype=np.float64)
        reprojection.extend(
            np.linalg.norm(project(parameters, observation) - pixels, axis=1).tolist()
        )
        ok, rvec, tvec = cv2.solvePnP(
            points,
            pixels,
            camera_matrix(parameters),
            None,
            flags=cv2.SOLVEPNP_ITERATIVE,
        )
        if not ok:
            raise ValueError("validation PnP failed")
        optical_odom = np.eye(4)
        optical_odom[:3, :3] = cv2.Rodrigues(rvec)[0]
        optical_odom[:3, 3] = tvec.ravel()
        local = points @ optical_odom[:3, :3].T + optical_odom[:3, 3]
        if np.any(local[:, 2] <= 0):
            raise ValueError("validation points behind camera")
        solved_origin = np.linalg.inv(optical_odom) @ np.linalg.inv(
            client_optical(parameters, observation)
        )
        expected = transform(observation["expectedOrigin"])
        origins.append(float(np.linalg.norm(solved_origin[:3, 3] - expected[:3, 3])))
        a, b = (
            np.arctan2(solved_origin[1, 0], solved_origin[0, 0]),
            np.arctan2(expected[1, 0], expected[0, 0]),
        )
        headings.append(
            float(np.degrees(abs(np.arctan2(np.sin(a - b), np.cos(a - b)))))
        )
    report = {
        "meanReprojectionPx": float(np.mean(reprojection)),
        "maxReprojectionPx": max(reprojection),
        "maxOriginErrorM": max(origins),
        "maxHeadingErrorDeg": max(headings),
        "observationCount": len(validation),
    }
    accepted = (
        report["maxReprojectionPx"] <= 2
        and report["maxOriginErrorM"] <= 0.05
        and report["maxHeadingErrorDeg"] <= 5
    )
    extra = extrinsic(parameters)
    return {
        "id": dataset["id"],
        "cameraLabel": label,
        "stream": stream,
        "intrinsics": {
            "fx": float(parameters[0]),
            "fy": float(parameters[1]),
            "cx": float(parameters[2]),
            "cy": float(parameters[3]),
            "width": width,
            "height": height,
            "distortion_model": "none",
            "distortion": [],
        },
        "T_viewer_optical": {
            "position": extra[:3, 3].tolist(),
            "orientation": Rotation.from_matrix(extra[:3, :3]).as_quat().tolist(),
        },
        "accepted": accepted,
        "measuredAt": datetime.now(UTC).isoformat(),
        "acceptance": {
            "maxReprojectionPx": 2,
            "maxOriginErrorM": 0.05,
            "maxHeadingErrorDeg": 5,
            "minObservations": 4,
        },
        "validation": report,
        "device": dataset["device"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("observations", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = fit(json.loads(args.observations.read_text()))
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    print(json.dumps(result["validation"], indent=2))
    if not result["accepted"]:
        raise SystemExit(
            "Calibration rejected; collect better observations. Do not install this profile."
        )


if __name__ == "__main__":
    main()
