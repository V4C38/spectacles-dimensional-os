# WebXR manipulation

The `openyam-ar-planner` installed blueprint composes one official OpenYAM
hardware owner, one pose-capable control coordinator, the official manipulation
module with narrow AR RPC adapters, and ARModule. Navigation and manipulation
capabilities are independent. Spectacles host interactions, grasping, pick/place,
agentic manipulation, and mobile manipulation are outside this feature.

## Runtime and development

The tested source baseline is official DimOS
`76ffe6ead7be4387b91c3d89c795faf51089d31f` with RoboPlan 0.7. Newer compatible
versions are allowed. DimOS reports package version `0.0.15` across multiple source
revisions, so package metadata alone cannot guarantee these APIs. Use a dedicated
Python 3.12 environment, install a compatible official DimOS with its `planning`
extra, then install this checkout's `dimos-ar[manipulation,dev]`. Do not replace the
main workspace's editable installation or patch upstream source.

For the launcher, select **openyam_ar_planner**, **WebXR**, a named **OpenYAM**
profile, and **Mock hardware** for software development. Profiles are stored in
`~/.config/dimos/ar-profiles.json`; existing Go2 calibration is migrated into a
named Go2 profile. Names are editable; stable profile IDs are retained on rename.
A new arm profile deliberately has no enabled localization provider or assumed tag
mount. Configure the measured tag mount before enabling tag localization. The tag
rotation preserves Go2's existing convention and adds roll:
`R = Ry(pitch) Rx(roll) Rz(yaw)`. Print size includes the border; the existing
8/10 conversion supplies the black-square fitting size.

Equivalent mock CLI (replace the interpreter path with your isolated environment):

```sh
DIMOS_PYTHON=/path/to/isolated/.venv/bin/python3 \
DIMOS_AR_SIMULATION=1 \
./launcher/scripts/start.sh --blueprint openyam_ar_planner
```

This chooses official in-memory hardware, including the configured home pose.
It does not contact arm hardware. For direct DimOS CLI use,
`dimos --simulation=mock run dimos-ar.openyam-ar-planner`.
The launcher exports an immutable per-run snapshot of the selected profile through
module configuration environment variables; editing a saved profile does not
modify an existing process. API keys remain in the existing credential settings.

## Ownership and interactions

Selecting the arm makes its end effector handle a full-pose planning target.
Dragging only evaluates collision-aware endpoint IK. Plan creates a timed
trajectory, shown by an articulated mesh ghost and sampled path. Execute names
that exact reviewed plan; replacement or invalid start state rejects execution.

With the arm unselected, grabbing the end effector handle acquires following.
Targets use absolute localized poses with a preserved grab offset. Release, input
loss, tracking loss, realignment, owner disconnect, or the controller's target
watchdog terminates following. The default watchdog and feedback freshness limit
are 500 ms; targets are sent at up to 30 Hz. These are software settings, not
measured physical latency guarantees. Following uses official bounded Cartesian
IK; it has no claim to the planner's checked-path world-collision guarantee.

Stop retires plans and tokens, clears following, cancels trajectories, and latches
manipulation stopped while preserving the gripper setting. Resume is explicit,
requires fresh feedback and confirmed stop handling, and restores no old motion.
A timed-out execution response is reconciled through observed state, never retried.

## Frames and visual assets

Base `pose` retains its existing meaning. Manipulation observations have independent
measurement timestamps, joint names, TCP poses, and outcomes. The optional adapter
converts between planning `world` and wire `odom` using `wire_from_world`;
`stationary_base` explicitly supplies `T_odom_base` for localization. The initial
OpenYAM composition uses coincident world/base/odom frames. If those transforms are
changed, configure their composition consistently with the actual model base.
Tag mounts are relative to that base. Host basis conversion happens once.

The measured arm uses oriented per-link bounds in the shared world-line style.
The planning ghost is a bundled 251 KB simplified model; see the WebXR model
NOTICE for source and license. Geometry preparation happens once outside this repo.
Joint topology and bounds come from the configured official model, and a
numerically normalized visual signature prevents using the bundled ghost with a
mismatched model. ClientCore FK is visual only and supports revolute, continuous,
prismatic, fixed, and mimic joints. It is never used to authorize motion.

WebXR's environment-depth renderer attaches only to bounds and path visuals.
Markers, end effector handles, controls, and mesh ghosts are excluded. Depth is an
optional host-local projected GPU texture; unsupported or missing depth leaves
visuals unoccluded. No model-based occlusion or server depth stream exists.
Quest Browser device validation is still required for actual depth quality.

## Verification

Python tests cover codec validation, transformed tool poses, ownership, exact-plan
binding, uncertain cancellation, and stop dispatch during pending planning.
ClientCore tests cover delayed/obsolete replies, gesture modes, and visual FK on
an alternate prismatic/mimic fixture. WebXR tests cover selective depth injection;
the Playwright manipulation scenario exercises controller selection, target dragging,
mesh loading, planning, exact execution binding, following, and release. Its server
is a fixture, so it is separate from official-runtime mock-hardware evidence.

Run `./launcher/scripts/run-ci.sh` before implementation PRs. Keep physical
registration, release latency, tracking error, and hardware outcomes separate from
software evidence. This feature's software tests start no physical robot.

For the opt-in official-runtime test, first start the mock blueprint on an unused
port with `ARMODULE__PORT=8799 ARMODULE__IP_RELAY_URL=null`, then run:

```sh
cd dimos-ar
DIMOS_AR_TEST_MANIPULATION_URL=ws://127.0.0.1:8799 \
  /path/to/isolated/.venv/bin/python3 -m pytest tools/test_manipulation_runtime.py
```

The test verifies the runtime's simulated flag before dispatching motion. On macOS,
the Open3D wheel may additionally require Homebrew `libusb`. The experimental
validation environment uses an isolated official-source installation and RoboPlan
0.7; no upstream Python source was patched.
