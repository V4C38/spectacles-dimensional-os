# Device validation handoff

Run the established device/robot validation procedure after the full repository CI gate and native editor suites pass. Record the source fingerprint, robot profile, client versions and captured diagnostics with the results.

| Area | Confirm on hardware |
| --- | --- |
| Production Lens | Correct source project deployed; Integration Test Harness Auto Run false; no Review assets or scripted scenario hosts |
| Localization | Capture/localization, tracking-reference reset, sensor alignment and cross-headset registration |
| Navigation | Valid placement, invalid release, cancellation and a second client's authority acquisition |
| Shared sessions | Specs joining by PIN and WebXR using its same-origin backend, observer interpolation, late joining and brief reconnection |
| Manipulation | Following, selection, checked Execute, gripper control during following, measured arrival and takeover |
| Stop behavior | Physical stop response, liveness loss, confirmed resume and orderly parking under the established hardware procedure |
| Device performance | Camera gate open/closed, LiDAR on/off, repeated localization misses, thermal/memory behavior and frame-time diagnostics over a sustained session |

For manipulation arrival, record Following and Execute separately at each speed.
The [mock benchmark currently fails its 10% timing assertion](dimos-compatibility.md#mock-arm-arrival-timing)
with Following/Execute ratios of 1.49, 1.92 and 2.53; tuning and thresholds remain unchanged.

Preserve failing logs and recordings. Report physical observations separately from browser fixtures, native Preview results and simulated robot contracts. Desktop tests cannot establish physical stopping distance, stereo alignment or headset thermal performance.
