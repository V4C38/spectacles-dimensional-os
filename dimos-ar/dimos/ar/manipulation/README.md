# WebXR manipulation

The `openyam-ar-planner` installed blueprint composes one official OpenYAM
hardware owner, one pose-capable control coordinator, the official manipulation
module with narrow AR RPC adapters, and ARModule. Navigation and manipulation
capabilities are independent. Both WebXR and Specs consume the shared ClientCore manipulation owners. Grasping,
pick/place, agentic manipulation, and mobile manipulation are outside this feature.

## Runtime and development

The tested source baseline is official DimOS
`76ffe6ead7be4387b91c3d89c795faf51089d31f` with RoboPlan 0.7. Newer compatible
versions are allowed. DimOS reports package version `0.0.15` across multiple source
revisions, so package metadata alone cannot guarantee these APIs. Use a dedicated
Python 3.12 environment, install a compatible official DimOS with its `planning`
extra, then install this checkout's `dimos-ar[manipulation,dev]`. Do not replace the
main workspace's editable installation or patch upstream source.

For the launcher, select **openyam_ar_planner**, **WebXR** or **Specs**, a named **OpenYAM**
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

### WebXR controls

Select the robot to edit an end-effector target. The dotted target guide appears
immediately; **Execute** computes a checked trajectory and executes that exact
plan. **Preview** computes and animates the trajectory without moving hardware.
Changing the target or speed invalidates the previous preview. Deselecting drops
the target and returns the handle to the measured tool pose.

With the robot unselected, hold and drag the tool sphere to follow live; release
to stop following. Grab capture persists outside the robot bounds. The controller's
secondary face button toggles the gripper during a drag. The tool's floating
Open/Close button remains visible while hovering either the sphere or the button.

Robot settings expose a 5–100% manipulation speed slider, default 20%. It scales
planned motion and the live IK joint velocity envelope. Reset plans a checked
joint-zero arm move and leaves the gripper unchanged. Emergency Stop remains next
to the base marker independently of selection; it is distinct from Reset and
fault recovery.

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
The selected arm mesh uses measured joints; Preview is a separate, single-play
animation starting at trajectory time zero. Its button turns off on completion.

Selected mode has a noninteractive measured tip sphere and a lighter movable
target. Gripper edits on that target are deferred intent, bound to the checked
plan and applied only after success and endpoint confirmation. Unselected
following retains immediate gripper control. Tool geometry includes only the
model's gripper subtree and derives finger articulation from joint limits.

Only rejected targets create the warning pill. One pill and one small rejected
position marker are shown at a time, for 1.5 seconds while the handle returns to
the last valid pose. Positive feasibility results do not generate warnings.

### Target controls and calibration

The arm menu stays below its marker and shares the runtime panel resize animation.
Selected dragging edits a target and automatically requests a checked trajectory on
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
Select the arm through its bounds or menu. Selected dragging edits a full-pose
target; release requests a checked plan. Preview plays the articulated trajectory
once and retains its endpoint. Execute binds to that plan. Unselected dragging
follows until release, input loss, or tracking/session invalidation. Both hosts
use ClientCore for grab offsets, pose smoothing, action dispatch, preview timing,
visual kinematics, trajectory sampling, and control-state derivation.

In hand-tracking mode, the Open/Close control stays beside the end-effector marker
during dragging. The other hand can press it without taking the dragging hand's
capture or ending following. Selected gripper edits remain deferred plan intent;
unselected edits use immediate gripper control. WebXR retains its controller
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
