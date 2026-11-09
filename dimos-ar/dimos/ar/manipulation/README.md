# AR manipulation

The `openyam-ar-planner` installed blueprint composes one official OpenYAM
hardware owner, one pose-capable control coordinator, the official manipulation
module with narrow AR RPC adapters, and ARModule. Navigation and manipulation
capabilities are independent. Both WebXR and Specs consume the shared ClientCore manipulation owners. Grasping,
pick/place, agentic manipulation, and mobile manipulation are outside this feature.

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

For the launcher, select **openyam_ar_planner**, **WebXR** or **Specs**, a named **OpenYAM**
profile, and **Simulated** for software development. Profiles are stored in
`~/.config/dimos/ar-profiles.json`; existing Go2 calibration is migrated into a
named Go2 profile. Names are editable; stable profile IDs are retained on rename.
New OpenYAM profiles copy the bundled OpenYAM Bench preset, including its enabled
fiducial provider and configured tag mount. Calibration belongs to the selected
robot instance and can be edited independently for each saved profile. The tag
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
Dragging requests seeded nonmoving IK at most every 50 ms. One evaluation/planning
request is allowed in flight; new targets replace the queued target. Release,
Preview and Execute request a collision-checked timed path for the exact target. Outdated replies cannot restore a
curve or authorize execution. Preview plays the trajectory once. Execute names
that exact reviewed plan; replacement or invalid start state rejects execution.

Servers advertising `independent_ik` evaluate the latest local aim without waiting
for its canonical snapshot acknowledgement. Results identify their sampled pose;
older results may advance the visual preview but never authorize a newer Execute.
An IK failure preserves the grab. User release restores the sphere to the latest
validated pose, or the measured grab-start pose if none was validated. This visual
reconciliation does not command a return movement.

With the arm unselected, grabbing the end effector handle acquires following.
Targets use absolute localized poses with a preserved grab offset. Normal release
frees editing authority immediately and hands the last validated target to a
server-owned finishing tail. Any new grab supersedes that generation. Input loss,
tracking loss, realignment, or disconnect before release terminates owned following;
disconnect after release cannot cancel the detached tail or a newer client's work. The default watchdog and feedback freshness limit
are 500 ms; targets are sent at up to 30 Hz. These are software settings, not
measured physical latency guarantees. Following uses official bounded Cartesian
IK; it has no claim to the planner's checked-path world-collision guarantee.
Advisory joint solutions do not replace Cartesian control direction. Released
following completes from fresh, settled measured TCP feedback; joint-space arrival
is used only when TCP feedback is unavailable. A stationary unreachable endpoint
reports failure instead of remaining in Moving until the absolute deadline.

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

The arm preview uses articulated mesh geometry in the shared world-line style.
The planning ghost is a bundled 251 KB simplified model; see the WebXR model
NOTICE for source and license. Geometry preparation happens once outside this repo.
The explicit `openyam` visual profile retains its existing root-mesh orientation correction. Joint topology and bounds come from the configured official model, and a
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

Run the maintained official mock contract in the selected Python 3.12 planning environment:

```sh
python dimos-ar/tools/run_mock_manipulation_contract.py
```

The runner isolates configuration, selects localhost and official mock hardware,
and verifies the simulated flag before dispatching motion. It covers exact checked
execution, held unreachable-target recovery, repeated reset, parking, and real native
scene changes. Use `--python /path/to/isolated/.venv/bin/python3` to select a different
planning environment. See the [compatibility baseline](../../../../docs/dimos-compatibility.md)
for supported DimOS and RoboPlan versions. On macOS, the Open3D wheel may additionally
require Homebrew `libusb`.

### WebXR controls

Select the robot to edit an end-effector target. The dotted target guide appears
immediately; **Execute** computes a checked trajectory and executes that exact
plan. **Preview** computes and animates the trajectory without moving hardware.
Changing the target or speed invalidates the previous preview. Deselecting drops
the target and returns the handle to the measured tool pose.

With the robot unselected, hold and drag the tool sphere to follow live; normal release
lets the arm finish reaching the final valid target. Grab capture persists outside the robot bounds. The controller's
secondary face button toggles the gripper during a drag. The tool's floating
Open/Close button appears below the marker while hovering either the sphere or the
button, with a short grace period for moving between them. It hides immediately
during an end-effector grab. Preview appears above a selected displaced marker and
also hides during the grab.

Robot settings and the arm base panel share a 5–100% manipulation speed slider, default 50%. It scales
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

### Specs and shared client behavior

Specs uses the existing PIN/IP setup and measured robot-profile calibration.
Select the arm through its mesh, root sphere, or menu. Selected dragging edits a full-pose
target; release requests a checked plan. Preview plays the articulated trajectory
once and retains its endpoint. Execute binds to that plan. Unselected dragging
follows while held and finishes toward its retained target after normal release;
input loss or tracking/session invalidation interrupts it. Both hosts
use ClientCore for grab offsets, pose smoothing, action dispatch, preview timing,
visual kinematics, trajectory sampling, and control-state derivation.

In hand-tracking mode, the Open/Close control stays beside the end-effector marker
during dragging. The other hand can press it without taking the dragging hand's
capture or ending following. Selected gripper edits with a displaced target remain deferred plan intent;
edits at the measured pose and unselected edits use immediate gripper control. WebXR retains its controller
shortcut. Specs exposes the same 5–100% speed range with a native SUK slider.

Specs draws the bundled arm using native MeshBuilder geometry generated from the
same canonical WebXR GLB and checks its visual signature before displaying meshes.
Run `python3 clients/specs/tools/export_manipulation_mesh.py` from the repository
root after updating that GLB. The generated geometry is visual only; measured
transforms and planning still come from ARModule. Attribution and MIT license are
in `clients/webxr/public/models/NOTICE.md` and `LICENSE.i2rt`.

Specs environment-depth occlusion is deferred. Its arm bounds and trajectories
remain unoccluded; WebXR retains its optional selective environment-depth adapter.
Neither desktop fixtures nor native Preview establish physical robot registration,
hand-tracking quality, stereo alignment, or on-device performance.

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
state. Simulated connection bypasses CAN setup but still needs a working planner.

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

Selected dragging retains the last valid arm configuration while one seeded IK
evaluation runs, with a 50 ms minimum interval and newest-target coalescing.
Only the exact current intent can execute. Activity labels are compact and derive
from shared interaction state; an offset selected target remains Planning between
requests. Execution remains latched until authoritative terminal feedback arrives.

Unselected dragging renders a movement-weighted articulated 3D mesh. Unreachable input preserves capture and the following lease,
holds motion, and can recover within the same gesture. Normal release retains the valid final target and completes motion toward it; an
invalid target returns to the last validated pose, and motion completes there. Joint-limit warnings use the last 5% of bounded joint ranges.

OpenYAM finger pads open as the independent prismatic joints move toward their
lower URDF limits (the meshes cross their joint origins). Selection uses mesh triangles,
including the gripper. When the installed OpenYAM model lacks collision elements,
the compatibility adapter supplies collision meshes from its exact visual geometry.
Only mutual finger self contact is excluded; fingers retain environment collision checks.
The GLB visual signature remains unchanged. No arm selection boxes are drawn.

The mini-menu uses the shared labeled speed slider. Ray capture follows its thumb
in either menu, independently of the ray-plane calculation that changes its value.
Orderly shutdown checks already-zero settling without another move, quiesces motion,
and drains cancellable RPC callbacks before services stop. Native source feedback
clocks establish freshness; snapshot publication does not count as a new measurement.

### Runtime and presentation owners

`ARManipulationModule` owns DimOS lifecycle and the lifecycle update thread.
`DimOSManipulationAdapter` is the installed-DimOS boundary; private upstream
collaborators and the quiesced teardown receipt stay there. It owns both planning
worker lifecycles. A transport failure fails that request and retires its process;
the next request builds a fresh worker and supplies the current scene. Shutdown
closes this owner permanently, including replacements still starting. `ManipulationRuntime`
uses the typed `ManipulationBackend` port and coordinates commands.
`InteractionCoordinator` owns the robot-wide editing lease and canonical targets.
`ManipulationSession` owns native following tokens and retirement generations;
`FollowingTail` owns detached completion of the last validated target;
`ManipulationOperation` owns reviewed-plan correlation and deferred gripper
completion; `JointZeroOperation` owns reset/parking settling. Official DimOS
continues to own measured joints and execution status. The lifecycle thread
expires leases and advances completion independently of snapshot polling and is
joined before native teardown. `ManipulationService` owns asynchronous delivery,
including emergency-stop dispatch. `NativeRPC` keeps timed-out native work
quarantined until actual completion, so polling cannot accumulate blocked native
calls. Stop and heartbeat use separate admission lanes.

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


### Arm presentation and selection feedback

The complete selected outlined mesh stays at normal strength independently of hover,
even at the measured pose. Displacement weighting controls only the unselected mesh. Hover and
selection visibility transitions fade smoothly using the shared presentation owner;
mesh picking remains enabled independently of opacity. Shape edges use 6 mm dashes
and 9 mm gaps. The small translucent sphere always marks the measured EE pose.
Following and execution paths use full opacity, while planning paths remain faint.
Below the hovered EE marker, selected mode offers Execute after release; unselected
mode offers Open/Close, including the independent second-hand action. Hover never
toggles selection: selecting a mesh/root sphere or pressing the near-EE action
requires a new pinch/press after release.

## Protection and continuity

OpenYAM AR intersects planning limits with the physical adapter's kinematic limits,
then reserves three degrees at each end for commanded goals. Measured feedback
continues to use the physical limits: a valid starting pose inside the command
buffer may recover inward without being declared invalid. Recovery trajectories
are checked for monotonic entry into the buffer; later points may not leave it.
Reset/parking resolve zeros to these safe
limits and log the applied joint angles. The local protected adapter bounds every
physical write and reads motor enabled/fault state and MOS/rotor temperatures.
A stationary tracking error above five degrees derates after 200 ms; tracking
error alone does not latch an emergency stop. A loaded PD controller can retain
this offset without a motor fault. 60°C for 500 ms derates, 70°C or a five-second
thermal warning pauses. Command lead uses the coordinator’s ten-degree tracking envelope in both direct
follow and the hardware boundary. Derating clears after a full second below three
degrees of tracking error. The physical joint limits and three-degree command
buffer remain separate from this tracking envelope.
Derating halves live speed and execution's virtual clock. Pausing holds fresh
measured positions with gravity compensation, independently of task activity.
Explicit Stop captures fresh feedback at the hardware boundary before cancelling
tasks; its held position bypasses command-margin adjustment so stopping cannot
introduce a new inward target. Resume explicitly releases this hardware hold.
Resume requires two healthy seconds, tracking error below two degrees and
temperatures below 55°C. Hard motor faults require reconnecting; they never clear
automatically. These configurable software defaults require physical sign-off.

Following retains one continuity-seeded validated joint endpoint across ordinary
hand samples. Continuity seeds are scoped to the control episode, not shared
between separate grabs. Arrival uses a 2 mm / 1° hold band with a 4 mm / 2° exit
band, and preserves acceleration limits while braking into the hold.

Selected and idle-hovered meshes share a 25% point-opacity floor. Selected hover
retains the inner fill and adds 10% opacity; unselected hover shows only the
outline with a 5% opacity boost. Hover leaves line thickness unchanged. Maximum displacement opacity occurs at 100 mm, with
a 5 mm dead zone. Failure tint remains yellow until the current request validates.
Both hosts use velocity-preserving critically damped joint presentation: 100 ms
settling for measured motion and 150 ms for preview targets. Selection, plan
updates, and rejection/recovery do not reset this motion. Debug frames
use raw measured joint angles; preview interpolation is never control feedback.

Parallel runtime probes must use a private discovery bus as well as a private
WebSocket port. For example:

```sh
dimos --simulation=mock --zenoh-scout-addr=224.0.0.225:17446 run dimos-ar.openyam-ar-planner --armodule.port=8799 --armodule.ip-relay-url=null
```

The arm controls panel moves and scales independently of the robot name/state/
speed badge. Its default scale is 0.7, with a 0.525 minimum and 1.4 maximum; Pin
restores its anchored position, rotation and default scale. A dedicated header
keeps Pin separate from the control rows.

Short feedback loss retains capture and the displayed arm for two seconds while
pausing Preview and all motion requests. The target still follows the hand. Recovery
revalidates plans and reacquires following leases without automatically clearing Stop.
The mini panel defaults to scale 0.875 (25% larger), bounded to 0.65625–1.75; its
separately anchored robot badge does not scale with it. Presentation uses Hermite
interpolation capped at 50 ms, finite measured velocities when available, and visual
prediction bounded to 30 ms. Execution uses raw feedback, with 30 mm / 8° arrival
settled for 500 ms; the deferred gripper must acknowledge before terminal completion.

## Multi-client protocol v2

Editing uses a 500 ms robot-wide lease, renewed every 100 ms. Selected checked
plans remain robot-owned after editing release and bind to the exact canonical
target revision. Ordinary following release starts a takeoverable server tail;
accepted execute/reset/parking remains non-takeoverable. The tail refreshes the
cached validated target at 10 Hz for at most 55 seconds and requires distinct,
fresh endpoint observations spanning 0.5 seconds to declare arrival. Failed or
stale feedback aborts it. Losing the last connected client stops native motion.

A separate native per-robot heartbeat gives ARModule a 500 ms control-plane lease.
Its expiry stops admitted arm motion even if the AR server process disappears.
The native Cartesian task watchdog stays enabled. This is software admission and
watchdog behavior; physical controller hangs and upstream agent continuations
still require their own backend guarantees.

Control snapshots contain model/plan references and compact operation facts.
Topology, checked trajectories, route points, LiDAR, and camera uploads use the
paired, byte-bounded bulk WebSocket. Native arm snapshots also transmit revisions
rather than repeating complete model/trajectory arrays at 10 Hz. See
[`PROTOCOL.md`](../../../PROTOCOL.md) for the wire contract and failure handling.
