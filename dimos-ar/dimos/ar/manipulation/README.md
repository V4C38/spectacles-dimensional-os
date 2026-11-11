# AR manipulation

The `openyam-ar-planner` blueprint composes one official OpenYAM hardware owner,
a pose-capable coordinator, installed DimOS manipulation with narrow AR RPC adapters,
and ARModule. Both clients consume portable manipulation intent and presentation.
Navigation and manipulation capabilities are independent. Grasping, pick/place,
agentic manipulation and mobile manipulation are outside this interface.

## Runtime and setup

Use a selected DimOS environment with execute-by-plan-ID and nonmoving IK APIs.
Install its planning extra together with `dimos-ar[manipulation,dev]`; the launcher
checks planner construction without contacting hardware. A successful import alone
does not establish readiness. The [compatibility notes](../../../../docs/dimos-compatibility.md)
own the pinned source/dependency requirements and collision-model limitations.
Import installed DimOS; do not patch upstream source.

Select an OpenYAM profile and WebXR or Specs in the launcher. Use Simulated for
software development. Named profiles live in `~/.config/dimos/ar-profiles.json`;
renaming retains stable identity. New OpenYAM profiles copy the bundled bench preset;
existing profiles remain independent. The launcher creates a mode-0600 native config
snapshot per run, replacing its AR section and preserving unrelated configuration.
Editing a saved profile does not mutate a running process. Credentials remain in
`launcher/.env`.

Equivalent mock commands from the repository root:

```sh
DIMOS_PYTHON=/path/to/isolated/.venv/bin/python3 \
DIMOS_AR_SIMULATION=1 \
./launcher/scripts/start.sh --blueprint openyam_ar_planner
```

```sh
dimos --simulation=mock run dimos-ar.openyam-ar-planner
```

These select official in-memory hardware. Physical OpenYAM requires Linux CAN
readiness: `can0` UP at 1 Mbit/s, transmit queue 1000 and not bus-off. ERROR-ACTIVE
is normal. Launcher checks are read-only; Set up CAN explicitly invokes the selected
environment's `dimos hardware can setup can0` with `pkexec`, refuses setup while
DimOS runs, and does not ask for a browser password. Simulation bypasses CAN setup
but still requires the planner. Start checks readiness before touching processes.

### Calibration and frames

Follow the [OpenYAM bench profile](../../../../launcher/app/profiles/README.md):
the default tag center is **60 mm right of the arm axis**, measured center to center.
The profile guide owns print size, orientation and mounting procedure; the bundled
profile is the machine-readable default. Saved profiles require their own measurements.
Do not substitute the printed edge or add a renderer offset. Re-localize after changing
calibration. Physical registration remains an attended check.

Base `pose` and measured arm observations are independent. The adapter converts
planning `world` to wire `odom` through `wire_from_world`; `stationary_base` provides
`T_odom_base`. OpenYAM's initial world/base/odom frames coincide. Configure their
composition consistently if the actual base changes. Tag mounts are relative to that
base. Mount rotation is `Ry(pitch) Rx(roll) Rz(yaw)`. Hosts perform their basis
conversion once; visual FK never authorizes motion.

Mixed tag/VPS fallback can accept a relative tag origin after an initial VPS miss
when the configured runtime is admitted. It does not fabricate a VPS registration.
VPS still requires a map code and configured robot-camera extrinsic at startup;
this does not establish mixed OpenYAM support without those prerequisites. The
[protocol](../../../PROTOCOL.md#independent-map-localization) owns the three-second
preference deadline and map-versus-relative result distinction.

## Select, Preview and Execute

Select the mesh/root sphere to edit a full-pose end-effector target. Preserve its
grab offset. While dragging, Core coalesces seeded nonmoving IK at most every 50 ms.
Advisory IK and checked full planning have independent single-request lanes, each
retaining newest intent. Release, Preview and Execute request a checked timed path;
obsolete replies cannot restore intent or authorize Execute. Execute names the exact
reviewed plan and target revision; invalid start state or changed pose/speed/gripper
intent invalidates it. Preview animates once from time zero and retains its endpoint.
The immediate dotted guide is advisory, not a checked trajectory.

An IK failure preserves the grab and latest valid model pose. Only manual release
reconciles a failed handle to the last validated pose, or measured grab-start pose
if none was validated. This changes the draft without commanding a return movement.
A selected displaced target remains Planning between requests. Execution stays active
until its authoritative terminal outcome; reconcile a timed-out response instead of
retrying motion.

## Follow and release

With the arm unselected, hold and drag the end-effector sphere for live following.
Canonical shared targets feed the native stream; clients do not send a second stream.
Unreachable input holds motion while preserving capture so reachable input can recover
within the same gesture. Following uses bounded Cartesian IK and does not provide the
planner's checked-path collision guarantee.

Normal release frees editing authority and starts a server-owned tail toward the last
validated endpoint. A new grab supersedes that generation. Former-owner disconnect
cannot cancel the detached tail or a successor. Input/tracking loss before release
retires owned following. Last-client loss, Stop, stale feedback, faults and native
control-plane expiry retain their stop semantics. See the single normative
[motion lifecycle](../../../PROTOCOL.md#motion-ownership-and-completion) and
[connection recovery](../../../PROTOCOL.md#connection-identity-and-recovery)
for arrival thresholds, timeouts, takeover and bounded recovery.

Short feedback/connection loss retains local capture and displayed intent for up to
one second while pausing Preview and motion requests. Recovery revalidates plans and
reacquires native following only under current shared authority. It never clears Stop.
Rendered interpolation is not measured feedback or authority.

### Gripper and speed

Both clients use 5–100% speed controls with 50% default. Speed scales checked motion
and the live IK velocity envelope. Unselected Open/Close is immediate, including an
independent second-hand action during following; WebXR retains its controller shortcut.
Selected gripper edits at a displaced target are deferred plan intent. Execute applies
that intent once after measured arrival; gripper acknowledgement precedes terminal
success. A rejected gripper action fails the operation. At the measured pose, the
control can actuate directly. Cancel, failure, replacement and Stop discard deferred
intent. Measured opening and accepted gripper target remain separate facts.

## Stop, Resume, Reset and shutdown

Ordinary Stop retires target/plans/tokens and cancels following, trajectory or reset.
Confirmed ordinary stop permits a new gesture. Emergency Stop additionally latches
manipulation stopped, preserving the gripper. Explicit Resume requires fresh feedback,
confirmed stopping and healthy protection state; it restores no prior motion.
Every client retains Emergency Stop independently of editing authority.

Reset plans a collision-checked safe-zero joint move, preserving the gripper. OpenYAM
uses its configured 0.05 rad zero tolerance and 0.5 seconds of fresh settled feedback.
Already-zero settling does not dispatch another trajectory. Otherwise nominal duration
and a three-second settling window remain within the 55-second operation budget.
Failure releases ownership only after confirmed stopping; uncertainty remains latched.
Late workers cannot dispatch motion or clean up a successor's operation.

Orderly shutdown attempts parking at no more than 20% speed, never clears emergency
stop, and uses the supervisor's 60-second response deadline. Shutdown proceeds with
an explicit failure log if parking fails or times out. Only a `quiescent:true` receipt
confirms the native teardown handshake; successful parking alone is insufficient.
Forced stop, power loss and SIGKILL cannot supply orderly parking. Physical shutdown
must be validated in an attended session.

## Runtime owners

| Owner | Responsibility |
|---|---|
| `ARManipulationModule` | DimOS lifecycle/update thread and joined teardown |
| `DimOSManipulationAdapter` | Installed native API boundary, planning workers and observations |
| `ManipulationRuntime` | Typed backend admission and owned lifecycle transitions |
| `ManipulationSession` / `FollowingTail` | Held native tokens / detached release completion |
| `ManipulationOperation` / `JointZeroOperation` | Reviewed-plan/deferred-gripper outcomes / reset and parking settling |
| `ManipulationService` / `NativeRPC` | Async delivery, Stop/heartbeat lanes and timeout quarantine |
| `InteractionCoordinator` | Robot-wide editing lease and canonical targets |
| Core `ManipulationInteraction` / `ManipulationPolicy` | Portable intent, hysteresis and one derived action snapshot |
| Host renderers/views | Coordinates, input, articulated geometry, controls and resource disposal |

Native lease expiry and completion advance without snapshot polling. Measurement time
comes from source feedback; publication does not refresh it. Timed-out native work
holds its admission slot until actual completion. Planning workers receive authoritative
scene snapshots; scene changes retire checked plans. A failed transport retires its
worker and a replacement receives the current scene. Shutdown permanently closes the
owner, including replacements still starting. Stop/heartbeat remain independent.

## Visual assets and platform presentation

The bundled planning ghost derives from canonical per-link OpenYAM visuals, with source
revision and license in the [model notice](../../../../clients/webxr/public/models/NOTICE.md).
Configured topology/bounds and a normalized visual signature prevent incompatible
models from using it. Core supports revolute, continuous, prismatic, fixed and mimic
joints. The `openyam` visual profile and explicit gripper metadata are independent of
asset URLs. Gripper articulation affects its subtree, never controlled arm joints.

Specs generates native geometry from the same GLB. After replacing it, run
`python3 clients/specs/tools/export_manipulation_mesh.py` from the repository root.
Preserve the GLB notice/license and source-generated parity. Native arm GPU opacity
and buffers are documented in the [native guide](../../../../clients/specs/tools/README.md#specs-arm-rendering).
WebXR optionally applies environment depth to bounds/paths; controls, handles and
mesh ghosts remain excluded. Specs depth occlusion is deferred.

Shared visual policy lives in `ManipulationVisuals.ts`, `ManipulationPresentation.ts`
and `PanelFrameStyle.ts`. Selection/picking is independent of mesh fade. Selected
meshes remain visible; unselected visibility follows displacement/hover policy.
Invalid meshes retain validated joints with warning tint and attributed failed links.
The measured translucent tip, draft handle, advisory guide and checked path represent
different facts. Execution trims paths from raw measured progress, never animation time.
Hermite interpolation, bounded visual prediction and hover effects never affect
control/completion. Keep numeric style values in these owners rather than prose copies.

The arm panel is independently movable/scalable from its badge. Pin restores the
anchored pose/default scale. Specs `SpecsArmPanelPresenter` owns its native Frame,
attached/pinned state and arm-base anchoring; missing base pose hides it. Controls
remain under Frame.content. See the architecture's
[Frame construction invariant](../../../../docs/architecture.md#lens-architecture-and-scene-wiring).

## Protection and continuity

The protected adapter intersects planning and physical joint limits, reserving a
three-degree command buffer. Measured feedback uses physical limits; valid starting
poses in the buffer can recover inward. Recovery trajectories enter monotonically
and cannot leave the buffer later. Safe-zero resolves against these command limits.
Collision geometry derived from missing native collision assets preserves exact visual
origins/scales; only opposing finger self-contact is excepted. Environment collisions
remain checked. See [compatibility](../../../../docs/dimos-compatibility.md#openyam-collision-geometry).

Physical writes remain bounded. A stationary tracking error above five degrees derates
after 200 ms; tracking error alone does not latch Stop. Thermal defaults derate at
60°C for 500 ms and pause at 70°C or after a five-second thermal warning. The command
lead envelope is ten degrees in direct following and the hardware boundary. Derating
halves live speed/execution clock and clears after one second below three degrees
tracking error. Pausing holds fresh measured positions with gravity compensation.
Explicit Stop captures measured position before task cancellation and bypasses margin
adjustment, avoiding a new inward stop target. Resume requires two healthy seconds,
tracking error below two degrees and temperatures below 55°C. Hard motor faults require
reconnection and never automatically enable motors. These defaults require hardware sign-off.

Following retains a continuity seed per control episode; separate grabs do not share it.
Its hold/exit bands and acceleration limits differ from detached-tail and Execute
arrival. Keep those distinct. The protocol owns operation-specific completion criteria.

## Verification

Follow [AGENTS validation policy](../../../../AGENTS.md#commit--pull-request-guidelines).
Python/Core tests cover authority, exact IDs, stale replies, cancellation, completion,
gripper, reset/parking and continuity. Host tests cover input/rendering/resource ownership.
Browser/native fixtures remain distinct from installed DimOS mock planning evidence.

Run the official contract in the selected Python 3.12 planning environment:

```sh
python dimos-ar/tools/run_mock_manipulation_contract.py
```

It chooses official mock hardware, localhost and temporary configuration, validates
simulation before motion, and owns cleanup. It covers unreachable-target recovery,
exact checked execution, reset/parking and scene changes. Native compilation/review
and the mock contract run sequentially to avoid desktop contention triggering valid
control lease failure. Parallel probes also require a private discovery bus:

```sh
dimos --simulation=mock --zenoh-scout-addr=224.0.0.225:17446 run dimos-ar.openyam-ar-planner --armodule.port=8799 --armodule.ip-relay-url=null
```

The maintained mock timing benchmark currently fails its 10% arrival-parity assertion;
see [measurements](../../../../docs/dimos-compatibility.md#mock-arm-arrival-timing).
No tuning or deadlines are loosened by documentation cleanup. Physical registration,
CAN, stopping distance/latency, hand input, stereo, depth and sustained performance
remain [hardware acceptance](../../../../docs/hardware-validation.md) work. Software
fixtures and mock passes do not establish those outcomes.
