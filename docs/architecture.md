# Architecture and native validation reference

This repository composes installed DimOS with one robot-facing ARModule, portable
ClientCore, two presentation hosts, and a local launcher. Import installed DimOS;
upstream fixes belong in separate upstream changes.

## Ownership and dependency boundaries

| Boundary | Owner | Responsibility |
|---|---|---|
| DimOS adaptation | `dimos-ar/dimos/ar/module.py` / `ARModule` | Declared ports, composition, RPC and skill entry points; delegates domain work |
| Robot reference | `robot/odometry.py` | Accepted native/corrected poses, source clock/reference generations, pose history and travel |
| Shared interaction | `replication/InteractionCoordinator` | Robot-wide editing authority, canonical targets, mode and revision fences |
| Native arm boundary | `manipulation/DimOSManipulationAdapter` | Installed planning/control APIs, workers and native observations |
| Arm lifecycle | `ManipulationRuntime`, `ManipulationSession`, `FollowingTail`, `ManipulationOperation`, `JointZeroOperation` | Command admission, held token retirement, detached completion, execution/gripper outcome and reset/parking settling |
| Async native delivery | `ManipulationService`, `NativeRPC`, `BoundedWorker` | Independent Stop/heartbeat admission, timeout quarantine and bounded off-loop work |
| Localization | `LocalizationRunner`, `MapLocalization`, `OdomMapTransform` | Capture scheduling, independent map/relative alignment and accepted robot correction |
| Navigation | `NavigationPreviewService`, native navigation admission/control service | Preview work/costmap freshness, correlated native goals and control-plane liveness |
| Agent | `ARAgentService` | Marker handles, assistant adaptation and active-turn client-pose freshness |
| Portable transport | ClientCore `ARModuleSession` | Control/bulk assembly and non-collaboration facts; navigation facts read through collaboration |
| Portable authority | `CollaborationController` | Canonical snapshots, local prediction, acknowledgement and observer interpolation |
| Portable localization | `ClientTrackingOriginStore`, `LocalizationCaptureEpisode`, `LocalizationTrackingReporter` | Accepted origins, capture/submission lifecycle and tracking reference/travel publication |
| Portable interaction | `NavigationInteraction`, `NavigationGoalLifecycle`, `ManipulationInteraction` | Input intent and terminal facts; derive UI actions from one snapshot |
| Host composition | `DimOSSpecsClient`, `DimOSWebXRClient` | Supply platform ports, tick portable owners, render snapshots and tear down resources |
| Launcher | `robot_sources.py`, `ProcessManager` | Source/CLI composition and owned child lifecycle; saved profiles own calibration |

Python paths above are relative to `dimos-ar/dimos/ar/`. Portable TypeScript lives
in [`DimOSARClient`](../clients/specs/Assets/Scripts/DimOSARClient/), imported directly
by both hosts. It imports only portable modules: no Lens, browser, Three.js,
XR Blocks or UIKit APIs. `clients/core/` stays empty until packaging as an `.lspkg`.
Never create a second copy of ClientCore.

Keep one mutable owner per concern. Store input/session facts and derive coupled
presentation once; hosts do not mirror execution, authority, origin or capture state.
Navigation and manipulation have distinct motion semantics. Shared pure validation
and math do not imply a universal lifecycle or host framework.

## Wire, authority and coordinates

The [protocol](../dimos-ar/PROTOCOL.md) owns message shapes, binary layouts, budgets,
authority and timing. Update it with the Python and ClientCore protocol modules.
[Motion ownership](../dimos-ar/PROTOCOL.md#motion-ownership-and-completion) distinguishes
held following, selected drafts/checked plans, takeoverable server tails and accepted
Execute/reset/parking operations. Editing authority is separate from robot-owned
motion; a former owner cannot cancel a successor through late cleanup.
[Connection recovery](../dimos-ar/PROTOCOL.md#connection-identity-and-recovery)
defines fresh identity versus bounded token recovery. Do not replay discrete motion.

ARModule serves one robot on port 8787. Control carries small authority/operation
facts; the paired bulk socket carries images, LiDAR, models, routes and trajectories.
Bulk pairing grants no independent authority. Revisions fence immutable assets;
incomplete/retired assets cannot authorize execution. Native timeout does not free
an admission slot while the underlying operation is still running. Stop and heartbeat
have independent lanes. `worker.py` owns cancellation-safe `BoundedWorker` mechanics;
domain services retain coalescing, pending work and failure policy.

Wire geometry uses corrected odometry metres and XYZW quaternions. ARModule performs
no axis conversion. Each host converts through its one basis at its boundary:
`SpecsCoordinates` uses Lens centimetres; `WebXRCoordinates` uses browser metres.
Camera optical axes require the optical transform, not quaternion conjugation alone.
The fixed Go2 XY heuristic applies once at the server boundary, including LiDAR;
Core undoes it only for native-distance policy. See protocol coordinate conventions
and [recorded registration evidence](dimos-compatibility.md#recorded-go2-registration-check).

Hosts tint remotely owned markers warning yellow, retain heading/pose indicators
and exclude them from grabs. Emergency Stop remains available. Canonical collaboration
facts supply shared drafts, routes and observer poses; renderers do not infer robot
control from displayed/FK geometry.

## Localization and camera lifecycle

`LocalizationRunner` owns module-loop capture scheduling and cleanup. Worker jobs
use immutable pose history and retired generations cannot deliver results. VPS HTTP
admission counts actual query dispatches; tags remain usable while cloud work waits.
The [protocol localization sections](../dimos-ar/PROTOCOL.md#independent-map-localization)
own the query budget, timeouts, capture correlation and transform acceptance.

With VPS enabled, `MapLocalization` owns robot map correction independently of headset
map alignment. `OdomMapTransform` owns `T_odom_map`; Core owns accepted `T_map_client`
and composes `T_odom_client`. Robot corrections do not themselves require another
headset VPS query. Existing confirmed navigation goals retain native coordinates.

Mixed-mode setup tries VPS first and can accept a relative tag `T_odom_client` after
an initial VPS miss or unavailable runtime camera data. This ordinary result has no
map alignment/transform. Relative travel/heading baselines and tag/VPS ordering belong
to `MapLocalization`. Later correction prefers the tag gate for three seconds, including
explicit re-localization. The preference deadline belongs to the episode: LOS loss,
partial-batch restart and repeated waiting do not renew it. Without an origin, capture
cannot compute the geometric gate and proceeds directly. Failed correction preserves
the accepted origin. Tracking/source changes retire relative baselines. A later VPS
success may establish independent map alignment. VPS still requires its configured
map code and robot-camera extrinsic at startup; mixed OpenYAM support without those
prerequisites is not established by this fallback.

Core distinguishes explicit pause/reset from visibility suspension. Pause retires
submission acceptance; suspension discards partial capture but preserves a submitted
batch's deadline and matching result. Unmatched, expired and superseded results cannot
update origin. Hosts do not add their own acceptance cache or ACK mechanism.
Tracking-reference resets retire pose history and capture generations. Reconnect may
retain alignment only with compatible server and tracking references.

Specs has one camera owner, `SpecsCameraSource`, delegating stream lifecycle to
`SpecsCameraStream`. It pairs `timestampSeconds` with pose, applies optical calibration,
then uses `Base64.encodeTextureAsync`. Native encodes remain serialized across
cancellation. Geometry is checked before capture and again before encoding; stale
outputs cannot release a successor's gate. Runtime batches can stop the application
stream while waiting for results/retry; initial setup retains preview. This says
nothing about powering off the system tracking cameras.

WebXR's `HmdCameraSource` uses the same portable ports with the selected measured or
published camera profile. Exposure/presentation timestamps and stream identity must
match. See [camera calibration](../clients/webxr/CALIBRATION.md) for physical acceptance.
Replay preserves producer stream timing through one epoch; EOF retains the final
visible observation without turning it into a fresh measurement.

## Lens architecture and scene wiring

Open [`spectacles-dimensional-os.esproj`](../clients/specs/spectacles-dimensional-os.esproj),
not the repository root. The [workspace](../spectacles-dimensional-os.code-workspace)
contains this repository only. Read upstream DimOS through the selected installed
checkout. Lens Asset Browser automatic synchronization must be enabled.
Manipulate scenes through Lens MCP and preserve metadata identities.

`DimOSSpecsClient` is the scene composition root. Authored platform objects include
Camera Object, Lighting, SpectaclesInteractionKit and World Mesh. `RobotPresenter`
is the Specs-world robot transform and navigation reads it. LiDAR is not parented
or anchored to that transform. `NavigationTargetMarker.prefab` is wired through
`navGoalMarkerPrefab`. The production Integration Test Harness remains Auto Run false;
review fixtures belong only in disposable projects.

Specs hosts platform input/renderer mechanisms: native world-mesh floor resolution,
SIK target priority and gesture capture, SUK controls, camera/speech ports and Lens
resource lifecycle. `SpecsTargetPriority` temporarily delegates to SIK's chooser
without the robot box only for registered navigation/manipulation targets; teardown
restores the original chooser. Native ray-only targets retain SIK's own ray, and the
beam mirrors the rendered cursor without another hover or smoothing policy.

`SpecsConnectionController` owns bounded initial attempts, delayed retries, loaded-PIN
expiry and invalidation. Setup preserves the saved PIN field and idempotent submission;
editing or changing modes retires pending work. Established sessions reconnect to their
resolved backend. `WristMenuController` and its `PalmGestureGate` own palm summon intent;
SUK Frame owns ongoing following/grabbing. Runtime palm menus are suppressed during setup.
`UIPresenter` applies derived snapshots rather than a second setup machine.

Create and initialize UIKit Frames on an enabled host before hiding them. Button setters
depend on initialized native handlers; initialization can synchronously emit scaling and
translation events. Attach presenter callbacks only after content/configuration exists.
Native Preview is required to establish SDK lifecycle behavior beyond compilation.
Views remove subscriptions and generated UI on disposal while retaining authored hosts.

World line/control metrics live in Core presentation/style owners. Specs converts metres
and font metrics into Lens units and consumes native shader colors in display RGB.
Three.js handles its own color conversion. Arm surface/outline buffers upload once per
model revision; per-link displacement uses 15 uniforms, sampled at 10 Hz and smoothed
with a 0.12-second time constant. Vertex shaders interpolate point opacity without
rebuilding geometry for alpha changes. See [native arm rendering](../clients/specs/tools/README.md#specs-arm-rendering).

## WebXR architecture

`DimOSWebXRClient` composes portable services. `WebXRSessionController` owns immersive
events, stable reference spaces and tracking recovery; `WebXRInputController` owns
capture/dispatch and menu placement. Browser camera, speech, DOM, plane/depth, GPU and
clock adapters stay in the host. Portable selection, navigation, manipulation, agent
and notification owners determine user-facing state.

The shipped landing page connects through same-origin `/ar` and paired bulk routes.
The browser service and ARModule have independent lifetimes; global launcher Stop
still stops both. `server/PinGateway.ts` retains an explicit API for consumers, but
the shipped page has no remote PIN entry flow. Specs can resolve a PIN directly.

Input capture governs callbacks and gestures. Near targeting takes precedence and
retains its source until release. Grabbing/source loss pins panels; detached panels
stay in world space. Setup/tracking-review actions use Core `SetupFlow` and origin
acceptance. Emergency-stop notifications use visible-frame lifetime and cannot capture
rays. LiDAR server settings and local point budgets remain separate concerns.
Renderer resources are disposed by their owners; late loads are retired by generation.
Cached geometry is immutable and borrowed SDK hand state is restored on teardown.

## Runtime diagnostics and verification

Diagnostics are bounded summaries, not payload histories. Robot/source age and handler
timing, LiDAR processing, WebSocket backpressure and native capture frame/encode metrics
have distinct meanings. Producer receipt time is not hardware exposure time. Browser
warnings/errors remain visible without enabling development tracing; `?diagnostics=1`
enables traces, while `?debug=1` enables scene inspection separately. No images or
credentials belong in diagnostics.

Follow [CONTRIBUTING](../CONTRIBUTING.md) for setup and commands and
[AGENTS](../AGENTS.md#commit--pull-request-guidelines) for validation frequency.
[The integration contract](../tools/integration-tests/README.md) owns shared cases and
evidence; [native tooling](../clients/specs/tools/README.md) owns editor procedures,
focus-budget persistence, tested-source manifests and restoration. Static compilation
cannot prove rendering, scene wiring, SDK input or hardware performance. Retain failed
and incomplete evidence. [Hardware validation](hardware-validation.md) records physical
work remaining after software verification.
