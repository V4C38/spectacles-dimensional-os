# Physical camera calibration

Quest 3 and Quest 3S use their device camera profiles directly. Selecting a headset chooses
its intrinsics and optical transform. No experimental runtime mode or calibration approval
step exists. Model-specific JSON files in `src/localization/profiles/` override these defaults.

## Device profiles

| Model | Left camera fx = fy | cx | cy at 1280×960 | Source |
| --- | ---: | ---: | ---: | --- |
| Quest 3 | 870.6005249023438 | 640.2453002929688 | 481.2428588867188 | [Camera2 calibration dump](https://github.com/tark146/UnrealAndroidCamera2Plugin/blob/f3b378fd83b1a2fc49ca9dfac01163d0bb5f3bce/Source/AndroidCamera2Plugin/Private/SimpleCamera2Test.cpp) |
| Quest 3S | 865.5078 | 639.85144 | 481.9739 | [Quest streamer device dump](https://github.com/LV-Robotics-Lab/quest_streamer/blob/942561ff4f19ac9c9a8c18b7b6cc4af35157bee8/quest_streamer/apriltag_fusion.py) |

Each model uses its own published translation and quaternion. Native calibration describes a
1280×1280 active array; the 1280×960 profile subtracts the 160-row top crop from `cy`.
If the browser supplies 1280×720, the profile subtracts a further 120 rows;
this assumes a centered sensor crop, **not a measured browser processing pipeline**. Focal
lengths and `cx` stay unchanged. Frames retain their full stream dimensions. Other resolutions,
frame rates, unidentified cameras and avatar cameras are rejected.

Camera2 rotation maps sensor axes into optical axes, so the normalized inverse supplies
optical-to-viewer rotation. See [Android's pose definitions](https://developer.android.com/reference/android/hardware/camera2/CameraCharacteristics#LENS_POSE_ROTATION).
The source translations reference the headset gyroscope frame, used as the WebXR viewer
reference. The offline workflow below can measure any device-specific correction.

The camera selector recognizes `camera 1, facing back`, `camera2 1, facing back`,
and `camera 2 1, facing back` as browser label variants for the left camera, native
camera 50 labels, or an explicitly named left camera. See this
[Quest Browser camera example](https://forum.babylonjs.com/t/webxr-camera-passthrough-support/58274/13)
for the index 1 / left and index 2 / right mapping. The `camera 1` variant was also observed
on the project's Quest headset. Selection uses the matching device's opaque `deviceId`,
never its position in the enumeration list. Right,
front, avatar and ambiguous cameras are never substituted. Exact selected device ID and
track label are checked again after opening. Custom camera labels require an exact match. Available camera labels and the actual opened stream are
forwarded to the launcher log as `camera-devices` and `camera-opened` diagnostics.


## Technician workflow

Record full-resolution video frames (1280×960 at 30 fps where supported) using the physical
environment camera, after granting permission. Retain the browser's exact camera label,
model, OS build, browser version, JPEG dimensions, capture timestamp, and viewer pose at
that timestamp in the same `local-floor` reference space. Reject the avatar camera.
Use surveyed fiducial corners in odom meters and an independently surveyed `T_odom_client`.
Do not use the transform being fitted as the survey reference.

Collect at least four distinct training views and four **independent held-out views**
(prefer more), spanning position, range, yaw, pitch and image coverage. Corner arrays must
have matching ordering. For each observation record:

```json
{
  "id": "quest3",
  "cameraLabel": "exact physical camera label from enumerateDevices",
  "device": { "os": "measured OS build", "browser": "measured browser version" },
  "stream": { "width": 1280, "height": 960, "frameRate": 30, "facingMode": "environment" },
  "training": [
    {
      "id": "unique-frame-id",
      "viewerPose": { "position": [0, 1.5, 0], "orientation": [0, 0, 0, 1] },
      "expectedOrigin": { "position": [0, 0, 0], "orientation": [0, 0, 0, 1] },
      "corners3d": [[2, -0.1, 0.4], [2, 0.1, 0.4], [2, 0.1, 0.6], [2, -0.1, 0.6]],
      "corners2d": [[600, 500], [680, 500], [680, 420], [600, 420]]
    }
  ],
  "validation": []
}
```

The numbers above illustrate the schema only; one view is deliberately insufficient for
acceptance. Viewer poses use WebXR coordinates. `corners3d` and `expectedOrigin` use protocol
coordinates. Quaternions are `[x,y,z,w]`. Intrinsics describe undistorted optical pixels:
+X right, +Y down, +Z forward. The current fitter uses a pinhole model; if residual distortion
exceeds the threshold, reject the profile rather than compensating with invented values.

Run with an environment containing NumPy, SciPy and OpenCV (the repository CI venv has them):

```bash
python tools/calibrate.py observations.json measured-profile.json
python -m pytest tools/test_calibrate.py
```

The utility jointly fits `fx/fy/cx/cy` and `T_viewer_optical` against training views only.
It then independently solves PnP on held-out observations, composes `T_odom_client`, and
checks **maximum 2 px reprojection, 5 cm origin, and 5° heading errors**. It rejects sparse,
reused, non-finite and unconstrained data. Numerical initialization is not calibration data.
A rejected output has `accepted: false` and the command exits unsuccessfully.

After review, copy an accepted artifact to `src/localization/profiles/quest3.json` or `quest3s.json`
and rebuild. The app loads these artifacts, checks their model and calibration values, then
requires a matching physical camera label, device ID and stream resolution/rate before
capture. Keep the observations and physical acceptance results with the calibration record.
Device IDs are origin-scoped; they are selected after permission and verified for each stream.

## Physical acceptance record

No devices were connected during this implementation (`adb devices` returned an empty list).
The following remain pending for **both** models; do not claim device parity until recorded.

| Model | OS / browser | Profile and held-out errors | Physical flow |
| --- | --- | --- | --- |
| Quest 3 | Pending | Device profile enabled | Pending |
| Quest 3S | Pending | Device profile enabled | Pending |

For each model, test with the mounted Go2 marker: connection and alignment, Skip, measured alignment
across viewpoints, drag navigation and arrival heading, server relocalization after 0.75 m,
manual realignment, palm and controller menus, emergency stop, joystick release, agent voice
or typed keyboard fallback, permission denial, XR suspension, reference reset, exit and reentry.
Record measured maximum errors, OS/browser versions, and any camera/speech restrictions.
The 0.75 m trigger and geometric gate remain owned by ARModule/ClientCore.

## Automated validation (2026-10-19)

`./launcher/scripts/run-ci.sh` passed: ARModule lint and mypy, 299 Python tests
(2 hardware blueprint tests skipped), 64 launcher tests, 268 Specs/ClientCore tests,
62 WebXR tests, 3 offline calibration regression tests, 2 browser flows with controller/hand
input through published-profile capture and automatic setup completion, and the production build.
The calibration recovery data is synthetic and does not qualify either device for release.
The local toolchain was Node v22.22.1 and Python 3.12.13. Device/browser versions remain
pending in the physical acceptance table. The detailed local run log is `/tmp/webxr-resumed-ci.log`.


## VPS timing and registration acceptance

The async backend and capture/result lifecycle checks do not establish physical
accuracy. For each Quest model, retain JPEG dimensions, camera label, profile,
browser/OS version, exposure/presentation timestamp provenance, and surveyed origin
errors with the acceptance record. Measure decode/transport delay before treating the
backend's provisional ±0.5-second robot stillness window as a measured bound.
Test robot translation and rotation, camera stalls, delayed responses, reference resets,
and emergency stop during a deliberately delayed VPS query.

Repeat stationary obstacle observations across robot movement before changing the
odometry correction. `dimos-ar/tools/check_go2_registration.py` rejects the proposed
robot-relative per-packet translation on the existing Go2 voxel-map recording.
The integrated 1.25 heuristic is a fixed XY mapping shared by robot pose, paths
and LiDAR, with native range calculations preserved separately. A physically
qualified correction still needs scan provenance or validated vendor-map registration;
the heuristic and published headset profiles are not that proof.
No runtime calibration approval screen is introduced by these backend checks.
