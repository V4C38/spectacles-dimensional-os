# DimOS compatibility boundary

ARModule composes installed DimOS modules. Never edit upstream DimOS source here, copy its implementation, or treat a successful TypeScript/browser fixture run as proof of native planning compatibility.

The [CI baseline](../.dimos-revision) is pinned independently of the supported package range. Change it deliberately after running the official mock contract; `CI_DIMOS_REVISION` permits a local compatibility probe. The declared minimum includes `0.0.14b1`; official mock validation currently exercises DimOS `0.0.14` with RoboPlan `0.6.1`. Install the selected DimOS planning extra and `dimos-ar[manipulation,dev]` together. Run `python dimos-ar/tools/run_mock_manipulation_contract.py` before claiming support for another revision. The small launcher preflight is an availability check; the full contract checks actual module composition and commands.

## Ownership

AR owns client sessions, editing authority, wire conversion, coordinate/reference metadata, and presentation assets. DimOS owns hardware, planning scenes, kinematics, task execution, and physical feedback. The local manipulation adapter is the compatibility boundary to installed APIs. Required behavior includes nonmoving evaluation, exact-plan-ID execution, cancellation confirmation, fresh measured feedback, and watchdog-independent stop admission.

Some robot/control policies remain local because the selected upstream APIs do not
provide equivalent behavior. Keep these safeguards until tested replacements exist.
Small, actionable upstream opportunities are recorded beside the implementation in
[`manipulation/UPSTREAM.md`](../dimos-ar/dimos/ar/manipulation/UPSTREAM.md).
This repository does not patch upstream DimOS.

Scene snapshots supplied to planning workers must reflect the authoritative environment. A changed scene invalidates reviewed plans. Preserve all collision geometry; any self-contact exception must name specific link pairs and retain environment collision checks.

## Custom models

Declare `gripper_joint_names` explicitly in the AR manipulation module configuration. A bounded prismatic joint may be a linear arm axis; its joint type does not identify it as a gripper. Keep gripper direction metadata separate from kinematic classification.

## OpenYAM collision geometry

The validated DimOS 0.0.14 OpenYAM asset contains visual meshes but no collision elements. Actual RoboPlan 0.6.1 validation confirmed that every robot link had an empty collision-geometry ID list; an enclosing environment obstacle therefore could not reject a target. The former finger-geometry removal helper was a no-op on this asset.

Until upstream supplies a planning collision model, `manipulation/collision_model.py` materializes collision elements from the exact canonical visuals, preserving mesh files, scales, origins, package paths and joint limits. Existing upstream collision geometry is retained. The only additional self exception names the two opposing fingers; environment collisions remain enabled. The official mock gate checks native geometry presence, valid home, obstacle rejection in both planning workers, scene-change plan retirement, obstacle removal, and an isolated finger/environment collision. This software evidence does not establish physical collision accuracy or stopping distance.

## Reproducible CI installation

The published `0.0.14` artifact lacks `dimos/navigation/go2`, which this integration uses. CI therefore installs the exact source revision rather than relying on matching version metadata. `CI_DIMOS_SOURCE` may reuse a clean local checkout only when its HEAD equals the selected revision; it does not edit upstream source files.

CI installs the pinned source in editable mode. This also keeps model data tied to the same Git revision: upstream `dimos/utils/data.py` otherwise clones moving `main` when installed without its checkout. `GIT_LFS_SKIP_SMUDGE=1` skips eager downloads during installation; DimOS lazily fetches the model archives required by the tests. Editable installation does not require building DimOS's separate Cockpit web bundle (`setup.py`).

## Mock arm arrival timing

On 2026-11-09, the maintained `benchmark_mock_arm.py` completed three runs per mode
at each speed against the official simulated OpenYAM composition (DimOS 0.0.14,
RoboPlan 0.6.1). The target was 4 cm from home. Median elapsed arrival times were:

| Speed | Execute | Following | Following / Execute |
| --- | --- | --- | --- |
| 25% | 0.894 s | 1.332 s | 1.49 |
| 50% | 0.622 s | 1.195 s | 1.92 |
| 100% | 0.459 s | 1.160 s | 2.53 |

All 18 motions and orderly parking completed, but these ratios fail the existing
10% arrival-parity assertion. The benchmark prints measurements and exits nonzero;
this is an outstanding performance diagnostic, not a passing timing guarantee.
Tuning, the assertion, and the 500 ms input/feedback safety deadlines remain unchanged.
These host-dependent mock measurements do not establish hardware arrival timing;
record following and Execute separately during device validation.
