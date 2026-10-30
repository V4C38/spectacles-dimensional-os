# WebXR manipulation

The `openyam-ar-planner` installed blueprint composes one official OpenYAM
hardware owner, one pose-capable control coordinator, the official manipulation
module with narrow AR RPC adapters, and ARModule. Navigation and manipulation
capabilities are independent. Spectacles host interactions, grasping, pick/place,
agentic manipulation, and mobile manipulation are outside this feature.

## Runtime and development

The selected DimOS checkout must provide the planning-group APIs (execute by plan
ID and nonmoving IK), and its installed RoboPlan version must match that checkout's
planning extra. The launcher verifies dependency compatibility and constructs a
small planning world without contacting hardware. A DimOS import alone does not
establish readiness.

The OpenYAM checkout `f2945fad060082dae0023f4f00cade270b097c13` reports DimOS
0.0.14 and requires RoboPlan `>=0.6,<0.7`; it has been validated with RoboPlan
0.6.1. Source revisions matter more than the package version. Installing RoboPlan
0.7 into that checkout fails during scene construction. Setup preserves selected
editable DimOS installations and resolves their planning dependencies together,
removing incompatible split RoboPlan packages before a downgrade. No upstream
source patches are required.

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
Dragging requests collision-checked timed trajectories at most every 350 ms after
1 cm or 3 degrees of movement. One evaluation/planning request is allowed in flight;
new targets replace the queued target. A released target receives a final exact
plan regardless of the live movement threshold. Outdated replies cannot restore a
curve or authorize execution. Preview plays the trajectory once. Execute names
that exact reviewed plan; replacement or invalid start state rejects execution.

With the arm unselected, grabbing the end effector handle acquires following.
Targets use absolute localized poses with a preserved grab offset. Release, input
loss, tracking loss, realignment, owner disconnect, or the controller's target
watchdog terminates following. The default watchdog and feedback freshness limit
are 500 ms; targets are sent at up to 30 Hz. These are software settings, not
measured physical latency guarantees. Following uses official bounded Cartesian
IK; it has no claim to the planner's checked-path world-collision guarantee.

Ordinary Stop retires the target, plans, and tokens, clears following, and cancels
trajectories or reset. A confirmed ordinary stop permits a new gesture. Emergency
Stop additionally latches manipulation stopped while preserving the gripper
setting. Resume operation is explicit, requires fresh feedback and confirmed stop
handling, and restores no old motion.
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
WebXR applies the existing OpenYAM base visual quarter-turn to only the root
bounding box for the explicit `openyam` visual profile; mesh geometry and all other boxes retain
their established orientation. Joint topology and bounds come from the configured official model, and a
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

### WebXR controls

Select the robot to edit an end-effector target. The dotted target guide appears
immediately; **Execute** computes a checked trajectory and executes that exact
plan. **Preview** computes and animates the trajectory without moving hardware.
Changing the target or speed invalidates the previous preview. Deselecting drops
the target and returns the handle to the measured tool pose.

With the robot unselected, hold and drag the tool sphere to follow live; release
to stop following. Grab capture persists outside the robot bounds. The controller's
secondary face button toggles the gripper during a drag. The tool's floating
Open/Close button appears below the marker while hovering either the sphere or the
button, with a short grace period for moving between them. It hides immediately
during an end-effector grab. Preview appears above a selected displaced marker and
also hides during the grab.

Robot settings and the arm base panel share a 5–100% manipulation speed slider, default 20%. It scales
planned motion and the live IK joint velocity envelope. Reset plans a checked
joint-zero arm move and leaves the gripper unchanged. The base panel stacks Execute (selected mode), Reset, speed, Stop, and the wider
E-stop control. Once stopped, the bottom control becomes the white Resume operation
button in the same slot. It is available independently of selection.

Orderly OpenYAM shutdown through the launcher or `start.sh` first requests a
checked return to zero at no more than 20% speed. Fresh joint feedback must remain
within 0.02 radians of zero for 0.5 seconds to confirm parking. After a failed
attempt or a 60-second timeout, shutdown proceeds and logs that parking was not
confirmed. An active emergency stop skips automatic parking. A forced kill or
power loss cannot perform this sequence. Hardware parking must be validated in
an attended session; automated shutdown tests use simulated processes and joints.

### Shared presentation and target intent

WebXR robot types share the robot label, bounding-box animation, marker Fresnel
material, styled buttons, slider capture policy, and notification pill. Hovering
one arm bound reveals all linked bounds using the same timing and widths as Go2.
Full-arm meshes appear only for a displaced selected target or during Preview.
Preview is a separate, single-play animation starting at trajectory time zero. Its
button turns off on completion. A gripper-only mesh stays anchored to the displaced
target pose in either mode. Measured mesh/bounds joints use a 50 ms visual filter;
raw feedback remains authoritative. Localization, model/group changes, reconnect,
and feedback gaps reset the filter.

Both modes show a smaller, translucent, noninteractive measured tip sphere while
the target is displaced. The fallback dotted connector uses 25% opacity; checked
planner paths use 70%, including genuinely straight planned paths. Execution trims
the completed portion using a forward-only measured joint-space projection, rather
than a wall-clock timer. The arm label shows name, state, and a smaller 50%-opacity
speed percentage on three separate lines. Gripper edits on that target are deferred intent, bound to the checked
plan and applied only after success and endpoint confirmation. Unselected
following retains immediate gripper control. Tool geometry includes only the
model's gripper subtree and derives finger articulation from joint limits.

Only rejected targets create the warning pill. One pill and one small rejected
position marker are shown at a time, for 1.5 seconds while the handle returns to
the last valid pose. Positive feasibility results do not generate warnings.

### Target controls and calibration

The arm menu stays below its marker and shares the runtime panel resize animation.
Selected dragging edits a target and requests checked trajectories continuously and on
release. Preview plays that trajectory once and leaves the model at its target.
Execute moves the hardware; its selected gripper opening is sent through the
coordinator only after successful arrival. Unselected dragging follows directly;
the controller squeeze button toggles the gripper. Both modes scale the model's
joint velocity limits with the same speed percentage.

The checked-in bench profile measures 120 mm from the arm axis to the tag center,
not the printed edge. The model root uses the configured planning base pose,
converted into wire odometry once. No tag offset belongs in the renderer. After
changing calibration, re-localize; an earlier tracking origin retains its earlier
calibration. With `DIMOS_LOG_LEVEL=DEBUG`, `Fiducial transform chain` records the
base, mount, camera, observed tag and solved tracking-origin translations to
separate a mounting error from camera calibration or model placement. Physical
alignment must be checked against the actual bench; browser fixtures cannot
establish that measurement.

### Shared interaction state and reset completion

ClientCore's ManipulationInteraction snapshot owns target-offset hysteresis,
dragging, planning, execution, reset, stopped state, freshness, and action
availability. Position changes above 1 cm or orientation changes above 3 degrees
enter the displaced state; changes below 5 mm and 1.5 degrees return to idle.
Open/Close actuates directly at the measured pose; with a displaced selected target
it executes the matching plan before actuating. Navigation
and arms use the same request-coalescing pattern and shared host controls, while
keeping their distinct motion/ownership lifecycles.

Reset waits until the planned nominal duration has elapsed, then requires newly
measured samples within 0.02 radians of zero for 0.5 seconds. It confirms stopping
and returns to idle through DimOS's reset API without waiting for the trajectory
executor to declare its exact endpoint complete. A settling deadline three seconds after nominal completion (within a 55-second
operation budget), or stale feedback, reports failure and releases ownership after a confirmed stop. An
unconfirmed stop remains latched. Stop/E-stop retire the reset operation; late
workers cannot dispatch motion or clean up a newer owner's operation. Shutdown
parking retains its 20% speed cap and never clears an active emergency stop.

### Launcher hardware readiness

Selecting OpenYAM shows a CAN setup card. The launcher checks Linux `can0` every
five seconds while visible: the interface must be UP at 1 Mbit/s, use a transmit
queue of 1000, and not be bus-off. `ERROR-ACTIVE` is CAN's normal operational
state. Mock hardware bypasses CAN setup but still needs a working planner.

Set up CAN invokes the selected environment's official `dimos hardware can setup
can0` CLI directly, using the Linux native administrator prompt through `pkexec`.
There is no browser password field or implicit `uv run` environment synchronization.
Setup is a no-op if already ready and is refused while DimOS is running. Checks
never configure CAN, and neither setup nor dependency installation stops DimOS.
Start verifies CAN and planner readiness again before touching any processes.

The launcher waits for both the WebSocket listener and manipulation initialization
before building WebXR. A child failure or Stop can cancel an in-progress build;
a stale build cannot start Preview or publish a URL for a replacement runtime.
Expected cleanup exits do not overwrite the primary startup error. Loading these
backend changes requires restarting the launcher, which remains user-controlled.


### Continuous previews and live IK guides

Selected dragging retains the last valid path and arm configuration while one
replacement plan runs, with a 350 ms minimum interval and newest-target coalescing.
Only the exact current intent can execute. Activity labels are compact and derive
from shared interaction state; an offset selected target remains Planning between
requests. Execution remains latched until authoritative terminal feedback arrives.

Unselected dragging renders a movement-weighted dashed IK skeleton, while the tool
retains its 3D model. Unreachable input preserves capture and the following lease,
holds motion, and can recover within the same gesture. Release returns the marker
to measured pose. Joint-limit warnings use the last 5% of bounded joint ranges.

OpenYAM finger pads open as the independent prismatic joints move toward their
lower URDF limits (the meshes cross their joint origins). The visual-only forearm
profile uses two boxes; planner collision geometry and GLB signatures are unchanged.
Gripper bounds update their picking mesh independently from their instanced outline.
Stationary bounds reveal along their full longest axis, then expand crosswise.

The mini-menu uses the shared labeled speed slider. Ray capture follows its thumb
in either menu, independently of the ray-plane calculation that changes its value.
Orderly shutdown checks already-zero settling without another move, quiesces motion,
and drains cancellable RPC callbacks before services stop. Native source feedback
clocks establish freshness; snapshot publication does not count as a new measurement.

### Runtime and presentation owners

`ARManipulationModule` owns DimOS lifecycle and the lifecycle update thread.
`DimOSManipulationAdapter` is the installed-DimOS boundary; private upstream
collaborators and the quiesced teardown receipt stay there. `ManipulationRuntime`
uses the typed `ManipulationBackend` port and coordinates commands.
`ManipulationSession` owns connection/group leases and retirement generations;
`ManipulationOperation` owns reviewed-plan correlation and deferred gripper
completion; `JointZeroOperation` owns reset/parking settling. Official DimOS
continues to own measured joints and execution status. The lifecycle thread
expires leases and advances completion independently of snapshot polling and is
joined before native teardown. `ManipulationService` owns asynchronous delivery,
including emergency-stop dispatch; `ManipulationRPC` retires RPC callbacks.

`ManipulationInteraction` owns portable intent and hysteresis transitions. Its
immutable snapshot is read-only, and `deriveManipulationSnapshot` is the one
activity/action derivation. WebXR supplies that snapshot through a named
`ManipulationPresentation` input. `ManipulationRenderer` composes world visuals,
`ManipulationControlsView` owns controls and hover/layout animation, and
`ManipulationModelRenderer` owns model loading, bounds, ghosts and tool geometry.
Shared cloned resources are disposed once; late loads are retired by generation.
OpenYAM corrections live under WebXR `manipulation/profiles/`. Explicit model
metadata supplies gripper articulation and profile identity independently of URLs.

### Feature preservation checks

| Behavior | Automated evidence |
|---|---|
| Ownership, exact plan IDs, stale replies, cancellation and uncertain stops | Python `test_runtime.py`, ClientCore `ManipulationInteraction.test.ts` |
| Live coalesced planning, exact release target, retained valid previews | ClientCore interaction tests, browser `Manipulation.spec.ts` |
| Following, IK recovery, lease expiry without polling, input interruption | Python runtime tests, ClientCore interaction tests, browser manipulation scenarios |
| Immediate/deferred gripper actions and fresh endpoint confirmation | Python runtime tests, ClientCore interaction tests, WebXR kinematics tests |
| Reset/parking timing, already-zero settling, E-stop preservation and shutdown receipts | Python runtime/service tests and supervisor tests |
| Bounds, ghosts, measured/target handles, IK guides, preview playback and measured path trimming | WebXR renderer/motion tests and browser manipulation scenarios |
| Menu controls, speed, capture, selection and Stop/Resume | WebXR input/renderer tests and browser manipulation scenarios |
| Asset identity, relocation, signature validation and resource disposal | Python model tests, ClientCore codec tests, WebXR model/kinematics tests |
| Coordinate frames, calibration, depth and optional integrations | Frame tests, launcher suites, depth tests, opt-in official-runtime mock test |

Full repository CI includes browser integration and production build checks.
Physical registration, stopping latency, CAN hardware, headset input and depth
quality remain attended hardware checks; fixture and mock passes do not establish
their physical performance.
