Investigation: Moving-Robot Re-alignment
Diagnostics Status
All instrumentation is confirmed in place and working:

OdomBuffer.speed_at() ✅
FrameResult rejection counters ✅
_maybe_log_moving_robot_diag() calling into both ✅
Root Cause (Code-Level Proof)
The culprit is line 422 in tag_tracker.py:


tag_tracker.py
Lines 421-423
        frame_age = float(header["send_ts"]) - float(header["ts"])
        odom_ts = recv_mono - max(0.0, frame_age)
        odom = odom_lookup(odom_ts)
frame_age = send_ts - ts is only the Lens-side encoding/send delay (image is captured at ts, frame is handed to the WebSocket at send_ts). The network one-way transit time L between the Lens sending and the bridge receiving is not subtracted. So odom_ts is too late by L:

True capture odom timestamp = recv_mono - frame_age - L
Used odom timestamp         = recv_mono - frame_age      (off by L)
For a stationary robot: v = 0 → bias = 0 → the odom lookup is exact → all math is perfect.

For a moving robot at speed v: the odom sample used is v × L too far ahead in the robot's trajectory. This contaminates every stored TagObservation.p_odom_tag. Let's trace the math:

In current_translation_solve:

t_world_odom = p_world_base - R_world_odom_keep @ p_odom_base
p_world_base = correct capture-time world position (from tag + camera pose, no odom dependency)
p_odom_base = biased odom position at t + L (robot already moved v × L forward in odom space)
The t_world_odom estimate is therefore shifted by ≈ v × L for every observation. This is systematic (not random) — it doesn't average out. At 0.5 m/s with 150ms latency: 7.5 cm per observation.

Why current_solve() (Kabsch) is somewhat more robust: Its 2D Kabsch minimises global MSE over (p_odom_tag_xy, p_world_tag_xz) pairs. If the robot moved in a consistent heading, all biased odom points shift together, and the Kabsch partially absorbs the bias into a translation term. If the motion direction changes between observations, biases are in different directions and partially cancel. In practice: Kabsch degrades gracefully, translation solve degrades monotonically.

Why the gates are not the bottleneck (verification):

The innovation gate computes:

implied_base[:3,3] ≈ T_world_tag @ inv(mount.T_base_tag)[:3,3] → robot world position from the tag at capture time t
committed_base[:3,3] = T_committed @ T_odom_base[:3,3] → robot world position from odom at t + L
innov ≈ v × L (how far the robot moved in the latency window)
At typical WiFi latency of 50–200ms, even a 1 m/s robot only creates 5–20 cm innovation. The gate is 1.5m — it won't trigger for any realistic speed. Similarly, the mount-residual gate is algebraically self-cancelling in the biased frame (the bias appears in both T_world_odom and T_odom_base and divides out). The gates are not rejecting observations.

The real failure mode: With the systematic per-observation bias, current_translation_solve returns a correction that is ≈ v × L off from the truth. This can be above the 5 cm deadband in the wrong direction, creating corrections that slowly worsen alignment rather than improve it while driving. The moving_robot_diag logs will confirm the exact values.

Proposed Solution
Three changes, in order of impact and complexity:

Fix 1 — Network latency correction in odom_ts (Bridge only, no protocol change)
Add a configurable network_one_way_latency_s to AlignmentController (defaulting to 0.12 — a typical value for local WiFi). Pass it into process_frame and subtract it from odom_ts:

odom_ts = recv_mono - max(0.0, frame_age) - self._network_one_way_latency_s
This eliminates the systematic bias. The parameter can be tuned from config/blueprint. This is the highest-ROI change.

Fix 2 — Ping/pong latency measurement at connect (Protocol + Bridge + Lens)
For automatic, accurate latency measurement replace the static config with a protocol measurement:

Bridge sends {"type": "ping", "bridge_mono": time.monotonic()} on connection established
Lens responds immediately with {"type": "pong", "bridge_mono": <echoed>} (no Lens-side computation)
Bridge: one_way_latency = (recv_mono - echoed_bridge_mono) / 2, stored and used in Fix 1
This requires adding ping/pong to ProtocolTypes.ts, ProtocolParser.ts, and Protocol.ts on the Lens side, and protocol.py + ARBridge handler on the bridge side.

Fix 3 — Moving-robot observation strategy (current_solve preferred over current_translation_solve)
For moving robots, current_solve() (Kabsch over the full observation window) is more robust than current_translation_solve() because the biases are distributed across many robot-heading directions and partially cancel. The current code already tries current_solve() first:


alignment.py
Lines 696-726
    def _apply_tracker_update(self, *, ts: float | None = None) -> None:
        ...
        solve = self._tag_tracker.current_solve()
        if solve is None:
            ...
            solve = self._tag_tracker.current_translation_solve(T_reference)
The issue: current_solve() requires baseline >= min_baseline_m (0.15m). A moving robot will accumulate baseline quickly, but the observation window (window_max_age_s=120s, window_max_obs=40) may contain old observations from positions that now corrupt the Kabsch solve. Propose tightening window_max_age_s to 30s (config-level change) so the Kabsch only uses fresh, spatially coherent observations. This has zero protocol impact.

Feasibility Assessment
Yes — runtime re-alignment while moving is entirely feasible with these fixes. The architecture already supports it: observations accumulate, the Kabsch solve runs, corrections get committed. The only fundamental problem is the unmeasured network latency causing a systematic per-observation v × L bias. Fix 1 alone (static latency config 0.10–0.15s) will likely make it work acceptably. Fix 2 makes it precise. Fix 3 tightens convergence quality.

Recommended rollout:

Run the robot and collect moving_robot_diag logs → measure actual frame_age_s and robot_speed_ms to empirically estimate the needed latency correction
Implement Fix 1 with a static config value validated from those logs
Implement Fix 2 (ping/pong) to automate the measurement
Tune window_max_age_s per Fix 3 if the Kabsch quality is still low
Shall I implement Fix 1 first (and optionally Fix 2) or would you like to collect hardware logs first to confirm the bias magnitude before changing any alignment behavior?




Logs

================================================================================ SUMMARY
Overall: System mostly works on device (192.168.1.62). Main issues were:

Camera resolution / CameraStream startup (fixed → 756)
Runtime still captures dropping due to missing ImageFrame timestamps (18:34 session)
Intermittent WebSocket / bridge disconnects
Nav error codes 505 and 508
Lidar obstacle filter often removes all points (floor band likely wrong)
Mid-session Lens hot-reloads resetting setup/runtime state
Good reference session: 20:10–21:08 (tag align, nav, pose correction working) Broken session: 18:34–18:36 (runtime stills all dropped: timestamp_missing)

================================================================================ 18:00 — FIRST DEVICE SESSION (192.168.1.62)
18:00:05 SetupWizard start → enterSetup 18:00:51 Spectacles connected wirelessly to Lens Studio 18:01:12 Lens started on device

CONNECT 18:03:16 connect attempt 192.168.1.166 → WebSocket error, code 1011 (×4 retries) 18:03:28 connect attempt 192.168.1.62 → connected 18:03:28 bridge_status: registered=false robot_connected=true 18:03:29 connect step completed

CALIBRATION (tag + assist) 18:03:29 align_start method=tag assist=true 18:03:29 FrameCapture: mode off→setup, camera_info 1008×756 18:03:32–18:04:18 Tag detect + robot leg moves (legs 1/3→3/3) 18:03:39 bridge_status: robot_connected=false (mid-calibration) 18:04:18 bridge_status: registered=true robot_connected=false 18:04:18 aligned — "Alignment successful" 18:04:20 enterRuntime, placement enabled at (-55.9, -122.1, 163.6)

RUNTIME 18:04:22 FrameCapture still: midpoint_fallback, dropped=true (latency 2055ms, head move 7.6°/46cm) 18:04:24 goal confirmed → nav following_path 18:04:27 still: dropped=false, camera_info 3200×2400 scale=3.175 18:04:32 nav lifecycle stale → resync requested 18:04:35 goal cancelled → idle 18:04:41 goal confirmed 18:04:44 placement disabled (emergency stop) → nav idle then goal_failed error_code=508 18:04:45 placement re-enabled 18:04:48 goal confirmed → goal_failed error_code=505, placement disabled 18:05:21 Spectacles disconnected from Lens Studio

================================================================================ 18:20 — SECOND SESSION (reconnect + longer runtime)
18:20:16 Lens restarted on device, enterSetup 18:20:18–18:20:29 connect: 192.168.1.166 fails, 192.168.1.62 succeeds 18:20:31–18:21:01 Tag calibration completes (legs 1/3→3/3), aligned 18:21:01 RX pose #1, pose_correction transDeltaM=0.026 solveQuality=0.923 18:21:03 enterRuntime, placement at (-3.1, -120.8, -89.8)

NAVIGATION (multiple goals, mostly successful) 18:21:06 goal → reached 18:21:34 goal → reached 18:21:48 goal → reached 18:22:05 goal → reached (after nav lifecycle stale ×2) 18:22:17 goal → following_path 18:22:27 bridge_status: robot_connected=false 18:22:42 robot_connected=true 18:22:43 nav goal_reached=true

FRAME CAPTURE (runtime stills — mostly dropped) Pattern: midpoint_fallback, latency ~1.5–2.3s, dropped=true on head movement 18:21:17 one accepted still (headAngular 2.8°, linear 0.95cm) 18:22:05 one accepted still

POSE CORRECTION (non-zero only) 18:21:37 trans=0.048 18:22:06 trans=0.184 yaw=8.65° yawCorrected=true solveMethod=tag 18:22:23 trans=0.063 yaw=1.73° 18:22:37 trans=0.015 yaw=1.21° 18:23:14 Spectacles USB connected

LIDAR 18:21:04+ Repeated: "obstacle filtered all 600–1500 points" floorWorldY≈-120cm band=0.5..155cm

PERF (sample) 18:22:19 fps=59.9 msgRxHz=0.0 poseRxHz=0.0 (bridge msgs not flowing yet) 18:22:49 fps=59.0 msgRxHz=0.6 poseRxHz=0.2 18:23:30 fps=58.8 msgRxHz=9.1 poseRxHz=7.7

================================================================================ 18:27–18:30 — HOT RELOAD + CAMERA/TIMESTAMP REGRESSION
18:27–18:30 Reimported: Protocol, BridgeClient, DimosManager, FrameCaptureController, PointCloudRenderer, UIManager 18:32:01 USB disconnect, lens sent wirelessly 18:32:34 NEW ERROR: "cannot send lidar_config before hello negotiates robot_id" (×2) 18:33:47 connect 192.168.1.62 → immediate success 18:34:26 Tag calibration completes, aligned, enterRuntime

RUNTIME STILL CAPTURE BROKEN (timestamp_missing) 18:34:30 "ImageFrame.timestampMillis unavailable — dropping runtime still" 18:34:30–18:36:39 ALL runtime stills dropped (dropReason=timestamp_missing) 18:34:30+ SetupWizard: "auto alignment: camera capture error" (repeated every ~5s) Note: Previously used midpoint_fallback; now strict drop on missing timestamp

NAV still partially works 18:34:33 goal → reached 18:34:49 goal → reached 18:35:06 goal → following_path 18:35:33 goal → reached 18:35:48 goal confirmed 18:35:58 goal_failed error_code=508 18:36:13 goal_failed error_code=505, placement disabled, emergency stop

18:36:32 bridge_status: robot_connected=false 18:37:00 Spectacles disconnected

================================================================================ 19:01–20:04 — CAMERASTREAM REFACTOR + COMPILE FIXES
19:01:58 NEW FILE: CameraStream.ts imported 19:02:01 COMPILE FAIL: EventRegistration not assignable to () => void (line 71) 19:03:12 Removed: LensStudioImageFrameAugments.ts 19:04:04–19:04:12 CameraStream.ts fixes (EventRegistration cleanup) → compile OK

RUNTIME CRASHES (preview / early startup) 20:05:17 InternalError: Unable to access camera (getTrackingCameraForId in CameraStream:50) → Component is not yet awake (×4) 20:06:26 CameraStream fix reimported, compile OK

CAMERA RESOLUTION ERRORS 20:07:26 Preview: supported resolutions empty, request 1440 > max 682 → crash at requestCamera 20:09:20 Preview: 1440 > max 931 20:09:42 DEVICE: supported resolutions listed; 1440 > max 756 → Script Exception 20:10:25 FIX: CameraStream started imageSmallerDimension=756 20:10:30 Preview OK: first frame 756×1135 20:10:46 DEVICE: first frame 1008×756

================================================================================ 20:10–21:08 — GOOD DEVICE SESSION (post CameraStream fix)
20:10:48 connect 192.168.1.62 → connected 20:10:49–20:11:14 Tag calibration (legs 1/3→3/3) → aligned 20:11:14 RX pose #1, pose_correction trans=0.026 solveQuality=0.964 20:11:15 enterRuntime, placement at (-55.9, -122.1, 163.6) 20:11:19 camera_info 1008×756 (runtime) 20:11:19 goal → following_path → reached (20:11:23)

LIDAR: obstacle filtered all points (616–1500) throughout session

NAVIGATION: ~15+ goals, most reached; occasional cancel + stale lifecycle resync Notable failures: 21:02:31 goal_failed (no error code) 21:06:41 goal_failed error_code=508 21:07:01 goal_failed error_code=505

POSE CORRECTION (significant only) 20:12:06 trans=0.184 yaw=8.65° solveMethod=tag 20:16:57 trans=0.054 yaw=11.07° 20:22:08 trans=0.159 solveMethod=tag_translation 20:22:22 trans=0.102 yaw=18.43° solveMethod=tag 20:29:56 trans=0.195 solveMethod=tag_translation 20:30:47 trans=0.371 yaw=18.53° solveMethod=tag 21:07:50 trans=0.759 yaw=117.02° solveMethod=tag ← large correction

BRIDGE INSTABILITY 20:25:10 robot_connected=false → true (cycle repeats ~6× over 4 min) 21:04:15 socket closed 1001, bridge disconnected (lens sent to device mid-session) 21:08:08 socket closed 1011 "Connection failure while receiving message" 21:08:21 perf degraded fps=41.8 21:08:46 Spectacles disconnected

================================================================================ 20:44–21:17 — LENS STUDIO PREVIEW TESTING (no bridge / hot reload churn)
20:44–20:58 Multiple lens resets from editing NavigationMarkerView, PlacementController, RobotMarker Compile errors (fixed incrementally): RobotMarker: _setRealignmentVfx missing NavigationMarkerView: outcome reset animation helpers missing PlacementController: visualState, _resolveFallbackGroundY missing

20:58:23–20:58:43 Preview: manual alignment flow tested

User switched to manual mid-calibration, committed, enterRuntime
Goals placed/cancelled in preview (no robot)
21:01–21:03 NavigationMarkerView animation refactor; device test after wireless deploy Goals confirmed/cancelled; placement toggle spam at 21:03:01

21:15:03 PREVIEW REGRESSION: CameraStream 756 > max 682 (preview max lower than device) 21:15:04 connect skipped (bridge not running), manual local-only calibration → enterRuntime offline

21:15:33–21:16:35 SurfacePlacementStabilizer + PlacementController edits Brief compile fail: DIRECTION_SMOOTHING_RATE / _smoothedDragDirection missing → fixed

================================================================================ 21:20–21:26 — FINAL DEVICE SESSION
21:20:47 Lens on device, CameraStream 756, first frame 1008×756 21:22:30 connect 192.168.1.62 → connected 21:22:31–21:22:52 Tag calibration → aligned 21:22:53 enterRuntime, placement at (13.0, -123.7, 144.1)

INTERRUPTED BY HOT RELOAD 21:22:58 DimosManager.ts changed → lens reset → enterSetup (mid-runtime!) 21:22:58 bridge connection: disconnected, placement stopped/restarted 21:23:00 Re-connected, calibration restarted 21:23:12 calibration SKIPPED by user, enterRuntime anyway

RUNTIME 21:23:20 goal → reached 21:23:52 goal → reached 21:24:17 goal → reached 21:24:41 goal → reached 21:24:50 goal → reached 21:25:16 goal → reached

21:25:22 SetupWizard start again (user re-entered setup mid-session) 21:25:23 reconnected, calibration started 21:25:29 align_status: "Robot position estimated — press Continue" (paused before leg moves) 21:25:33 pose_correction trans=0.072 21:26:18 pose_correction trans=0.753 yaw=93.77° solveMethod=tag 21:26:43 Spectacles disconnected

================================================================================ KEY ERRORS / WARNINGS (deduplicated)
WebSocket 1011 "Failed to open WebSocket connection" — 192.168.1.166 unreachable 1000 "" — clean close (preview/no bridge) 1001 "" — device reconnect mid-session 1011 "Connection failure while receiving message" — 21:08:08

Navigation error_code=505 — goal failed (multiple times) error_code=508 — goal failed / emergency stop "nav lifecycle stale; requesting bridge status resync" — intermittent

Camera Unable to access camera — CameraStream init before component awake Requested dimension too large: 1440→682/931/756; fixed at imageSmallerDimension=756 Preview-only: 756 > 682 at 21:15:03

Frame capture midpoint_fallback + dropped=true — head moved during still window (18:04–18:22) timestamp_missing — ALL runtime stills dropped (18:34–18:36) after strict timestamp policy camera_info scales: 1.0 (setup 1008×756) and 3.175 (runtime 3200×2400) in early session; later sessions stay 1008×756 scale=1.0

Bridge / protocol cannot send lidar_config before hello negotiates robot_id — 18:32:34 robot_connected flapping false/true during long runtime sessions bridge_status registered=true but robot_connected=false common during calibration

Lidar PointCloudRenderer: obstacle filtered ALL points — floorWorldY≈-120cm, band 0.5–155cm

Compile (all resolved) CameraStream.ts EventRegistration type mismatch RobotMarker _setRealignmentVfx NavigationMarkerView outcome animation helpers PlacementController visualState / smoothing constants

================================================================================ DEBUGGING NOTES
Use 192.168.1.62 for bridge; .166 does not accept WebSocket.
CameraStream must cap to device max smaller dimension (756 on device, lower in preview).
Runtime auto-alignment needs ImageFrame.timestampMillis OR an approved fallback; strict drop policy broke all runtime stills at 18:34.
Hot-reloading TS during an active device session resets lens and drops bridge — expect enterSetup + disconnected bridge.
Nav 505/508 likely robot-side path failures; correlate with emergency stop / placement toggle.
Lidar showing zero obstacles is probably floor band/filter config, not missing data.
Large pose_correction (yaw 93–117°) suggests tag re-detection after head/robot movement.







XR bridge session log (cleaned) Host: MacBookAirM2 | XR client: 192.168.1.210 | Bridge WS :8787

================================================================================ SESSION 1 — Initial alignment (19:22:30–19:22:54)
19:22:30 XR client connected (57416) 19:22:30 get_status, set_lidar_mode(obstacles) → set_lidar_mode(off) 19:22:31 align_start method=tag 19:22:31 Assist: idle → estimating ("Scan the robot tag...") 19:22:31 camera intrinsics: spectacles 1008x756 19:22:34 Assist: estimating → awaiting_confirm ("Robot position estimated — press Continue") 19:22:38 WARN gravity_level_transform: input up-axis 38.3° from world-up (calibration input likely malformed) 19:22:40 assist_confirm 19:22:40 Assist: awaiting_confirm → move ("Robot moving — leg 1/3") 19:22:52 Assist: move → done ("Baseline collection complete") 19:22:52 AssistDriver DONE — auto-committing alignment 19:22:52 DEB TF publish_static not supported (PubSubTF) — skipping world→odom static broadcast 19:22:52 Alignment succeeded approximate=False method=tag quality=0.963 19:22:52 moving_robot_diag: bias=0.0034m speed=0.028 obs=0 rej=0 odom_gap=0.097s 19:22:54 tag_mount_offset tag_id=0 residual=[0.047,-0.009,-0.027] configured=[0.18,0,0.06] measured=[0.227,-0.009,0.033] 19:22:54 Runtime correction: trans_delta=0.055m yaw=0° quality=0.969 (tag_translation, 1 obs) base [-0.130,-0.906,1.441] → [0.126,-0.936,1.486] 19:22:54 align_stop, set_lidar_mode(obstacles), get_status 19:22:54 LiDAR stream active binary=True hz=1.0 (initial payload: 0 points)

================================================================================ SESSION 2 — Re-align interrupted (19:23:00–19:23:13)
19:23:00 XR client connected (57762) — second connection while first may still be active 19:23:01 align_start method=tag 19:23:01 Assist: idle → estimating 19:23:01 camera intrinsics received 19:23:06 moving_robot_diag: rej_up_tilt=1 speed=0.0 19:23:08 Alignment session cleared on XR client disconnect 19:23:09 Runtime correction: trans_delta=0.017m quality=0.975 (tag_translation) 19:23:12 align_stop, set_lidar_mode(obstacles)

Note: Assist never reached confirm/move — session ended on disconnect before assisted calibration.

================================================================================ SESSION 3 — Navigation + runtime tracking (19:23:15–19:25:20)
[WebSocket backlog coalescing occurred periodically throughout; no FIFO drops.]

--- Nav goal 1 --- 19:23:20 nav_goal world=[-0.783,-1.148,1.445] yaw=75° → odom=[0.156,-0.775,0.078] yaw=-180° 19:23:20 Planner: safe goal (0.12,-0.83), path found 19:23:22 Local planner: initial_rotation → path_following 19:23:23 Runtime correction: trans_delta=0.075m quality=0.833 (speed=0.313, bias=0.028) base [0.038,-0.921,1.398] → [0.055,-0.918,1.471] 19:23:26 Reached goal position → final_rotation 19:23:27 tag_mount_offset: measured matches configured (residual ~0) 19:23:28 Goal reached, planner idle

--- Nav goal 2 --- 19:23:52 nav_goal world=[0.153,-1.186,2.028] → odom=[0.568,0.400,0.029] 19:23:54 path_following 19:23:58 Goal reached

--- Nav goal 3 --- 19:24:17 nav_goal world=[0.545,-1.197,1.321] → odom=[-0.143,0.645,0.022] 19:24:20 path_following 19:24:22 Goal reached (fast final rotation)

--- Runtime corrections while idle/moving (non-zero only) --- 19:23:34 trans=0.113m yaw=3.66° quality=0.864 (tag, 2 obs, baseline=0.716m) 19:23:37 trans=0.037m yaw=0.16° quality=0.882 (3 obs) 19:23:44 trans=0.015m yaw=0.22° quality=0.901 (4 obs) 19:23:51 trans=0.011m yaw=0.10° quality=0.907 (5 obs) 19:24:02 trans=0.040m yaw=2.60° quality=0.910 (6 obs, baseline=1.504m) 19:24:27 trans=0.030m yaw=0.61° quality=0.908 (7 obs) 19:24:30 trans=0.022m yaw=0.34° quality=0.917 (8 obs) 19:24:38 trans=0.018m yaw=0.23° quality=0.913 (9 obs)

--- Nav goal 4 --- 19:24:33 set_lidar_mode(full) 19:24:37 set_lidar_mode(off) 19:24:41 nav_goal world=[-0.322,-1.173,1.160] → odom=[-0.172,-0.291,0.051] 19:24:43 path_following → arrived 19:24:45

--- Nav goal 5 --- 19:24:50 nav_goal world=[0.514,-1.139,1.306] → odom=[-0.107,0.554,0.085] 19:24:52 path_following 19:24:55 Runtime correction during motion: bias=0.036m speed=0.380 19:24:56 Goal reached

--- Nav goal 6 --- 19:24:59 WARN gravity_level_transform: up-axis 19.2° from world-up 19:24:59–19:25:06 Small runtime drift corrections (0.010–0.017m, yaw ≤0.65°) 19:25:15 nav_goal world=[-0.160,-1.148,1.587] → odom=[0.257,-0.129,0.075] 19:25:18 path_following → arrived 19:25:19

Overall session 3: tracking mostly stable; corrections typically 1–11 cm; quality 0.83–0.92.

================================================================================ SESSION 4 — Re-align failed / stuck (19:25:23–19:26:25)
19:25:23 XR client connected (42878) 19:25:24 align_start method=tag, LiDAR off 19:25:24 Assist: idle → estimating 19:25:29 WARN gravity_level_transform: up-axis 15.3° from world-up 19:25:29 Assist: estimating → awaiting_confirm 19:25:32 Alignment session cleared on XR client disconnect ← disconnect before confirm

19:25:33 tag_mount_offset: residual=[0.065,-0.013,-0.027] (mount mismatch) 19:25:33 Runtime correction: trans_delta=0.072m quality=0.925 (tag_translation) base [-0.215,-0.914,1.614] → [-0.272,-0.942,1.647]

19:25:36–19:25:44 Tag-only translation corrections converging (~7cm total drift): 0.026 → 0.015 → 0.012 → 0.003 → 0.016 → 0.005m

19:25:41–19:25:56 assist_confirm ×12 — ALL IGNORED (AssistDriver state=idle) User pressing Continue but assist session already cleared on disconnect.

19:26:04 tag_mount_offset: residual=[-0.016,0.003,0.030]

19:26:12 Sudden position jump during idle tracking: base [-0.259,-0.810,1.638] (speed=0.296, bias=0.027)

19:26:17–19:26:24 ODOM LOST — tag frames skipped: "Tag frame skipped: no odom at capture time" seq=108–114 odom_bracket_gap_s grows: 1.0 → 3.4 → 5.7 → 8.1

19:26:18 CRITICAL runtime correction spike: trans_delta=0.754m yaw=93.77° quality=0.934 (tag solve, 19 obs) base [-0.216,-0.884,1.631] → [-0.495,-0.878,1.597] marker_jump=0.281m baseline=0.157m

19:26:20–19:26:24 Corrections frozen at bad pose; odom still missing 19:26:25 set_lidar_mode(full)

================================================================================ KEY FINDINGS
First full alignment (session 1) succeeded cleanly (quality 0.963).
Session 2 & 4: XR client disconnects mid-alignment clear the AssistDriver session; subsequent assist_confirm taps are ignored (state=idle).
Navigation (session 3) worked; runtime tag tracking applied small corrections during/after moves.
gravity_level_transform warnings (15–38°) suggest malformed calibration/gravity input from Lens.
tag_mount_offset residuals ~4–6 cm vs configured [0.18, 0, 0.06] — possible mount config or tag pose error.
Session 4 failure chain: disconnect → assist dead → user spamming confirm → odom dropout → 94° yaw / 75 cm correction spike when odom briefly returns.
================================================================================ SUPPRESSED AS NOISE (present in raw log)
Rerun viewer connection banner, graphviz missing
~25× "XR WebSocket outbound backlog coalesce_pending=1" (no drops)
Repeated get_status / set_lidar_mode toggles
~40× no-op runtime corrections (trans_delta=0, yaw=0)
~15× plan_path without associated nav_goal
~10× duplicate camera_info receipts
11× individual "assist_confirm ignored" lines (summarized above)