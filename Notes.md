Issue 1 — Why runtime convergence is slow and stops short
The behavior you describe ("5+ observations, slow, never fully settles") falls directly out of the runtime correction logic in _apply_tracker_update, combined with the 3 s capture cadence.

a) Every correction is a fraction of the remaining error — it never snaps.


alignment.py
Lines 657-700
        if trans_delta > 0.5 or yaw_delta > math.radians(10.0):
            if solve.method == "tag_translation" and solve.quality >= 0.85:
                # ... fast first-step shrink ...
                t_blend = t_old + 0.65 * (t_new - t_old)
                ...
        else:
            dt = now - (self._last_smooth_mono or now)
            alpha = 1.0 - math.exp(-dt / self._tag_smoothing_tau_s)
            ...
            t_blend = t_old + alpha * (t_new - t_old)
Large drift (>0.5 m): each step moves 65% of the way → remaining error 0.35, 0.12, 0.04, 0.015… ≈ 5 observations to look "converged," and asymptotically never reaches the target.
Small drift (<0.5 m — the "almost there" regime you see it stall in): exponential smoothing with tag_smoothing_tau_s = 3.0. With dt ≈ 3 s per observation, alpha ≈ 0.63 — the same asymptotic crawl, by design.
b) Observations are ~3 s apart. RUNTIME_CAPTURE_INTERVAL_S = 3.0 in FrameCaptureController.ts, plus the camera spin-up window, plus dropped frames. So "5 observations" is 15–30 s of wall time. That's the "takes a long time" part.

c) It stops short because yaw is frozen at runtime. A stationary robot has ~0 baseline, so current_solve() returns None and the runtime path falls to current_translation_solve(), which preserves the committed yaw and only fixes translation:


tag_tracker.py
Lines 682-712
        ``current_solve()`` uses baseline across multiple odom-tag samples to
        recover yaw and translation; that geometry breaks down when the robot is
        stationary.  Here we preserve the committed gravity-levelled rotation
        from ``T_reference`` and solve only for translation ...
If any of the residual drift is rotational, a translation-only correction physically cannot remove it, so the marker settles "a bit before" the true pose.

d) Wasted observations make it worse. The bridge logged Tag frame skipped: no odom at capture time for seq 58, 62, 70, 90–97. Each skip is a lost correction sample (the camera spun up, encoded, transmitted — for nothing). That stretches the effective convergence time further. It happens because at_interpolated requires odom within ODOM_LOOKUP_MAX_GAP_S = 0.25 s of odom_ts = recv_mono − frame_age; the encode/transmit latency pushes odom_ts into the past, and any odom rate dip or robot_connected=false window (you had one at 22:15:45) drops the lookup.

Your instinct is correct. The fractional blend exists to reject noisy solves, but you now have strong validity gates upstream — reprojection ≤ 3 px, mount-residual ≤ 0.15 m, up-axis tilt ≤ 20°, and the innovation gate. A solve that passes all of those is trustworthy enough to snap (blend ≈ 1.0) or interpolate over a short fixed time (~0.2–0.4 s on the Lens). Because corrections are gated and only fire every ~3 s, snapping won't look jittery. To make it fully settle, it also needs an occasional yaw correction at runtime (via the world-anchor path or a constrained yaw update), not translation-only.

The diagnostics confirm the geometry is sound — late in the session residual was essentially zero (residual=[1.2e-05 8.5e-06 -4.4e-06] at 20:12:55), so the slowness is purely the blend/cadence policy, not bad solves.

Issue 2 — The lag is Lens/device-side, and camera churn is the prime suspect
The bridge is not the bottleneck. Every outbound log line is coalesce_pending=1..3 dropped_fifo=0 fifo_depth=0 for the entire session. No FIFO drops, no backlog growth. So the progressive lag is happening on the glasses, not in the network or bridge. The Lens pose path is also clean — it's latest-wins and applies once per frame:


DimosManager.ts
Lines 766-780
  private _applyPendingPose(): void {
    const msg = this._pendingPose;
    if (!msg) {
      return;
    }
    this._pendingPose = null;
    ...
The standout anomaly is 683 camera toggles in ~13 minutes — roughly one acquire/release every ~1.1 s. This is a side effect of the runtime camera-gating "thermal" change. The gate runs the camera ON for RUNTIME_CAMERA_WINDOW_S = 1.25 s, then tears it down until the next 3 s capture:


FrameCaptureController.ts
Lines 161-186
    if (this._mode === "runtime") {
      if (!this._shouldRunRuntimeCaptureWindow()) {
        ...
        this._stopCameraStream();
        return;
      }
      if (this._cameraTexture === null) {
        this._runtimeCameraWindowDeadline = now + RUNTIME_CAMERA_WINDOW_S;
        this._ensureCameraStream();
      } else if (... now >= this._runtimeCameraWindowDeadline ...) {
        this._stopCameraStream();
And the teardown relies on garbage collection to actually free the native stream:


FrameCaptureController.ts
Lines 258-266
  private _stopCameraStream(): void {
    // Spectacles has no explicit stopCamera; unsubscribe the handler and null refs.
    // The underlying stream will be GC'd when no references remain.
Calling requestCamera() and dropping the provider every ~3 s, while old stream objects sit waiting for GC, is a classic native-resource-churn pattern: it builds memory pressure and produces hitches that get worse the longer you run — exactly "lags after running for a long time." This likely traded steady-state power for worse sustained performance, because camera acquire/teardown is far more expensive than keeping one stream alive.

Notably, the captured perf samples still showed ~59 fps at 22:17, so this isn't a clean fps collapse in the logged window — it points to growing latency/memory pressure (and/or thermal beyond the sampled window) rather than a steady frame-rate drop.

Recommended next steps for the lag (need on-device validation)
Stop cycling the camera every 3 s. Test two alternatives against each other on-device: (a) keep one camera stream alive continuously during runtime, and (b) gate with a much longer duty cycle (e.g. a short capture burst every 20–30 s). The current 1.25 s-on / ~1.75 s-off cycle is the worst case — constant acquire/release, never a steady state.
Verify _stopCameraStream actually frees native resources rather than leaking until GC. Watch memory over a 10-min run; if it climbs in step with toggle count, that's the leak.
Eliminate the wasted "no odom at capture time" captures — they burn camera + JPEG + transmit cycles and also slow Issue 1. Either widen the runtime odom-lookup tolerance or confirm the odom publish rate sits comfortably above 4 Hz.
Run the stationary 10-min repro with debugMode on and watch the DimosManager: perf fps=… trend — that's the on-device validation that was never actually done, and it will confirm whether the symptom is fps, latency, or memory.
One side note unrelated to lag: the recurring gravity_level_transform: input up-axis far from world-up (angle=90/52/16 deg) warnings during alignment indicate the calibration input is sometimes far from level — worth watching separately for alignment quality, but it's not driving the runtime lag.




Logs:


Cleaned Lens Studio log (1105 raw -> condensed for agent context)
Session: 22:03:07 - 22:19:32 | Bridge ws://192.168.1.62:8787 | Robot unitree_go2
Stripped: file paths, Lens Studio IDE noise, Spectacles deploy chatter, duplicate startup logs
Collapsed: ~683 camera start/stop, ~56 lidar all-filtered, periodic pose/perf spam

=== TIMELINE ===

W 22:03:40 Spectacles couldn't connect to Lens Studio within 4 seconds. Please ensure that there is no problem with the USB port or USB cable and you have single instance of Lens Studio running.
I 22:04:27 DimosManager: enterSetup
I 22:04:27 SetupWizard: start
I 22:04:27-22:06:16 DimosManager: enterSetup (x2)
I 22:06:16 SetupWizard: start
I 22:06:16 DimosManager: enterSetup
I 22:06:23 SetupWizard: startup step completed
I 22:06:23 SetupWizard: step start -> connect
I 22:06:23 SetupWizard: connect attempt 192.168.1.62
I 22:06:23 BridgeClient: connecting to ws://192.168.1.62:8787
I 22:06:24 BridgeClient: connected
I 22:06:24 DimosManager: bridge connection: connected
I 22:06:24 SetupWizard: connect succeeded
I 22:06:24 BridgeClient: RX bridge_status registered=false robot_connected=true
I 22:06:24 BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 22:06:30 SetupWizard: connect step completed
I 22:06:30 SetupWizard: step connect -> calibrate
I 22:06:30 DimosManager: setOperatingMode: setup
I 22:06:30 BridgeClient: align_start TX robot=unitree_go2 bytes=100 sent=true
I 22:06:30 AlignmentSession: align_start{method:tag,assist:true} sent
I 22:06:30 FrameCaptureController: mode off -> setup
I 22:06:30 AlignmentSession: start method=tag assist=true
I 22:06:30 SetupWizard: align_status state=detecting method=tag progress=0 "Look at the AprilTag on your robot"
I 22:06:30 FrameCaptureController: camera_info sent 1008x756 scale=1.000x1.000
I 22:06:31 SetupWizard: align_status state=detecting method=tag progress=49 "Tag detected — collecting samples (1)"
I 22:06:32 SetupWizard: align_status state=detecting method=tag progress=100 "Tag detected — collecting samples (2)"
I 22:06:35 SetupWizard: align_status state=detecting method=tag progress=0 "Robot moving — leg 1/3"
I 22:06:46 SetupWizard: align_status state=detecting method=tag progress=33 "Tag detected — collecting samples (12)"
I 22:07:03 SetupWizard: align_status state=detecting method=tag progress=66 "Robot moving — leg 3/3 (returning to start)"
I 22:07:12 SetupWizard: align_status state=detecting method=tag progress=100 "Tag detected — collecting samples (26)"
I 22:07:12 BridgeClient: RX bridge_status registered=true robot_connected=true
I 22:07:12 SetupWizard: align_status state=aligned method=tag progress=100 "Alignment successful"
I 22:07:12 SetupWizard: alignment succeeded (progress=100%)
I 22:07:14 SetupWizard: finish connect=done calibration=done
I 22:07:14 BridgeClient: align_stop TX robot=unitree_go2 bytes=69 sent=true
I 22:07:14 FrameCaptureController: mode setup -> runtime
I 22:07:14 AlignmentSession: stop (marker)
I 22:07:14 DimosManager: enterRuntime
I 22:07:14 DimosManager: setOperatingMode: manual
I 22:07:14 DimosManager: robotInteractionMode: runtimeRobot
I 22:07:14 NavigationController: placement enabled
I 22:07:14 PlacementController: start at (-66.2, -116.0, 166.4)
I 22:07:26 DimosManager: setNavigationPlacementEnabled: false
I 22:07:26 NavigationController: placement disabled
I 22:07:26 PlacementController: stop
I 22:07:26 DimosManager: setNavigationPlacementEnabled: true
I 22:07:26 NavigationController: placement enabled
I 22:07:26 PlacementController: start at (-66.2, -116.0, 166.4)
I 22:08:06 DimosManager: setNavigationPlacementEnabled: false
I 22:08:06 NavigationController: placement disabled
I 22:08:06 PlacementController: stop
I 22:08:07 DimosManager: setNavigationPlacementEnabled: true
I 22:08:07 NavigationController: placement enabled
I 22:08:07 PlacementController: start at (-66.3, -116.0, 166.4)
I 22:08:09 DimosManager: setOperatingMode: agent
I 22:08:09 NavigationController: placement disabled
I 22:08:09 PlacementController: stop
I 22:08:09 Source file was changed, reimporting Assets/Scripts/Navigation/PlacementController.ts
I 22:08:12 DimosManager: setOperatingMode: manual
I 22:08:12 NavigationController: placement enabled
I 22:08:12 PlacementController: start at (-66.3, -116.0, 166.4)
I 22:08:15 DimosManager: enterSetup
I 22:08:15 SetupWizard: start
I 22:08:15 DimosManager: enterSetup
I 22:08:48-22:09:04 [runtime noise] camera cycling x20
I 22:09:04 Project saved /Users/johannestscharn/Repositories/spectacles-dimensional-os/lens-studio/spectacles-dimensional-os.esproj
I 22:09:06-22:09:12 [runtime noise] camera cycling x10
I 22:10:14 DimosManager: enterSetup
I 22:10:15 SetupWizard: start
I 22:10:15 DimosManager: enterSetup
I 22:10:16 SetupWizard: startup step completed
I 22:10:16 SetupWizard: step start -> connect
I 22:10:16 SetupWizard: connect attempt 192.168.1.62
I 22:10:16 BridgeClient: connecting to ws://192.168.1.62:8787
I 22:10:16 BridgeClient: connected
I 22:10:16 DimosManager: bridge connection: connected
I 22:10:16 SetupWizard: connect succeeded
I 22:10:16 BridgeClient: RX bridge_status registered=true robot_connected=true
I 22:10:16 BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 22:10:17 SetupWizard: connect step completed
I 22:10:17 SetupWizard: step connect -> calibrate
I 22:10:17 DimosManager: setOperatingMode: setup
I 22:10:17 BridgeClient: align_start TX robot=unitree_go2 bytes=99 sent=true
I 22:10:17 AlignmentSession: align_start{method:tag,assist:true} sent
I 22:10:17 FrameCaptureController: mode off -> setup
I 22:10:17 AlignmentSession: start method=tag assist=true
I 22:10:17 FrameCaptureController: camera_info sent 1008x756 scale=1.000x1.000
I 22:10:18 SetupWizard: align_status state=detecting method=tag progress=0 "Look at the AprilTag on your robot"
I 22:10:36 BridgeClient: align_stop TX robot=unitree_go2 bytes=70 sent=true
I 22:10:36 FrameCaptureController: mode setup -> runtime
I 22:10:36 AlignmentSession: stop (marker)
I 22:10:36 DimosManager: setOperatingMode: manual
I 22:10:36 SetupWizard: step calibrate -> connect
I 22:10:37 SetupWizard: connect step completed
I 22:10:37 SetupWizard: step connect -> calibrate
I 22:10:37 DimosManager: setOperatingMode: setup
I 22:10:37 BridgeClient: align_start TX robot=unitree_go2 bytes=99 sent=true
I 22:10:37 AlignmentSession: align_start{method:tag,assist:true} sent
I 22:10:37 FrameCaptureController: mode runtime -> setup
I 22:10:37 AlignmentSession: start method=tag assist=true
I 22:10:42 DimosManager: setOperatingMode: manual
I 22:10:42 SetupWizard: manual alignment enabled
I 22:10:42 BridgeClient: align_stop TX robot=unitree_go2 bytes=70 sent=true
I 22:10:42 FrameCaptureController: mode setup -> runtime
I 22:10:42 AlignmentSession: stop (marker)
I 22:10:42 AlignmentSession: beginManualPlacement pos=(9.0,-146.6,-80.0) rot=(-0.432,0.007,0.003,0.902)
I 22:10:42 DimosManager: robotInteractionMode: manualPlacement
I 22:10:42 BridgeClient: align_start TX robot=unitree_go2 bytes=89 sent=true
I 22:10:42 AlignmentSession: align_start{method:manual,assist:false} sent
I 22:10:42 FrameCaptureController: mode runtime -> off
I 22:10:42 AlignmentSession: start method=manual assist=false
I 22:10:42 SetupWizard: manual alignment placement started
I 22:10:42 BridgeClient: align_manual_pose TX robot=unitree_go2 bytes=210 sent=true
I 22:10:42 SetupWizard: align_status state=ready method=manual progress=100 "Manual robot pose ready — review and commit"
I 22:10:43 BridgeClient: align_manual_pose TX robot=unitree_go2 bytes=209 sent=true
I 22:10:44 SetupWizard: align_status state=ready method=manual progress=100 "Manual robot pose ready — review and commit"
I 22:10:44 BridgeClient: align_commit TX robot=unitree_go2 bytes=72 sent=true
I 22:10:44 AlignmentSession: align_commit sent
I 22:10:44 SetupWizard: manual calibration commit requested
I 22:10:44 SetupWizard: align_status state=aligned method=manual progress=100 "Manual alignment committed"
I 22:10:44 SetupWizard: alignment succeeded (progress=100%)
I 22:10:44 BridgeClient: RX bridge_status registered=true robot_connected=true
I 22:10:45 SetupWizard: finish connect=done calibration=done
I 22:10:45 BridgeClient: align_stop TX robot=unitree_go2 bytes=70 sent=true
I 22:10:45 FrameCaptureController: mode off -> runtime
I 22:10:45 AlignmentSession: stop (manual)
I 22:10:45 DimosManager: enterRuntime
I 22:10:45 DimosManager: robotInteractionMode: hidden
I 22:10:45 DimosManager: robotInteractionMode: runtimeRobot
I 22:10:45 NavigationController: placement enabled
I 22:10:45 PlacementController: start at (9.0, -179.6, -80.0)
I 22:10:47-22:10:51 [runtime noise] camera cycling x8
I 22:10:55 SetupWizard: start
I 22:10:55 DimosManager: enterSetup
I 22:10:55 DimosManager: bridge connection: disconnected
I 22:10:55 PlacementController: stop
I 22:10:55 NavigationController: placement enabled
I 22:10:55 PlacementController: start at (9.0, -201.6, -80.0)
I 22:10:55 PlacementController: stop
I 22:10:55 FrameCaptureController: mode runtime -> off
I 22:10:55 NavigationController: placement enabled
I 22:10:55 PlacementController: start at (9.0, -201.6, -80.0)
I 22:10:55 DimosManager: robotInteractionMode: hidden
I 22:10:55 NavigationController: placement disabled
I 22:10:55 PlacementController: stop
I 22:10:55 SetupWizard: step calibrate -> start
I 22:10:59 SetupWizard: startup step completed
I 22:10:59 SetupWizard: step start -> connect
I 22:10:59 SetupWizard: connect attempt 192.168.1.62
I 22:10:59 BridgeClient: connecting to ws://192.168.1.62:8787
I 22:10:59 BridgeClient: connected
I 22:10:59 DimosManager: bridge connection: connected
I 22:10:59 SetupWizard: connect succeeded
I 22:11:00 SetupWizard: connect step completed
I 22:11:00 SetupWizard: step connect -> calibrate
I 22:11:00 DimosManager: setOperatingMode: setup
I 22:11:00 BridgeClient: align_start TX robot=unitree_go2 bytes=99 sent=true
I 22:11:00 AlignmentSession: align_start{method:tag,assist:true} sent
I 22:11:00 FrameCaptureController: mode off -> setup
I 22:11:00 AlignmentSession: start method=tag assist=true
I 22:11:00 FrameCaptureController: camera_info sent 1008x756 scale=1.000x1.000
I 22:11:00 SetupWizard: align_status state=detecting method=tag progress=0 "Look at the AprilTag on your robot"
I 22:11:01 SetupWizard: align_status state=detecting method=tag progress=49 "Tag detected — collecting samples (1)"
I 22:11:04 SetupWizard: align_status state=detecting method=tag progress=100 "Tag detected — collecting samples (2)"
I 22:11:25 DimosManager: enterSetup
I 22:11:25 SetupWizard: start
I 22:11:25 DimosManager: enterSetup
I 22:11:27 SetupWizard: startup step completed
I 22:11:27 SetupWizard: step start -> connect
I 22:11:27 SetupWizard: connect attempt 192.168.1.62
I 22:11:27 BridgeClient: connecting to ws://192.168.1.62:8787
I 22:11:27 BridgeClient: connected
I 22:11:27 DimosManager: bridge connection: connected
I 22:11:27 SetupWizard: connect succeeded
I 22:11:27 BridgeClient: RX bridge_status registered=true robot_connected=true
I 22:11:27 BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 22:11:28 SetupWizard: connect step completed
I 22:11:28 SetupWizard: step connect -> calibrate
I 22:11:28 DimosManager: setOperatingMode: setup
I 22:11:28 BridgeClient: align_start TX robot=unitree_go2 bytes=99 sent=true
I 22:11:28 AlignmentSession: align_start{method:tag,assist:true} sent
I 22:11:28 FrameCaptureController: mode off -> setup
I 22:11:28 AlignmentSession: start method=tag assist=true
I 22:11:28 FrameCaptureController: camera_info sent 1008x756 scale=1.000x1.000
I 22:11:28 SetupWizard: align_status state=detecting method=tag progress=0 "Look at the AprilTag on your robot"
I 22:11:33 SetupWizard: align_status state=detecting method=tag progress=49 "Tag detected — collecting samples (1)"
I 22:11:36 SetupWizard: align_status state=detecting method=tag progress=100 "Tag detected — collecting samples (2)"
I 22:11:39 SetupWizard: align_status state=detecting method=tag progress=0 "Robot moving — leg 1/3"
I 22:11:40 NavigationController: requestEmergencyStop
I 22:11:40 SetupWizard: align_status state=detecting method=tag progress=100 "Emergency stop received"
I 22:11:41 SetupWizard: align_status state=detecting method=tag progress=0 "Robot moving — leg 1/3"
I 22:11:54 SetupWizard: align_status state=detecting method=tag progress=33 "Tag detected — collecting samples (11)"
I 22:12:10 SetupWizard: align_status state=detecting method=tag progress=66 "Tag detected — collecting samples (19)"
I 22:12:21 SetupWizard: align_status state=detecting method=tag progress=100 "Tag detected — collecting samples (24)"
I 22:12:21 BridgeClient: RX bridge_status registered=true robot_connected=true
I 22:12:21 SetupWizard: align_status state=aligned method=tag progress=100 "Alignment successful"
I 22:12:21 SetupWizard: alignment succeeded (progress=100%)
I 22:12:23 SetupWizard: finish connect=done calibration=done
I 22:12:23 BridgeClient: align_stop TX robot=unitree_go2 bytes=70 sent=true
I 22:12:23 FrameCaptureController: mode setup -> runtime
I 22:12:23 AlignmentSession: stop (marker)
I 22:12:23 DimosManager: enterRuntime
I 22:12:23 DimosManager: setOperatingMode: manual
I 22:12:23 DimosManager: robotInteractionMode: runtimeRobot
I 22:12:23 NavigationController: placement enabled
I 22:12:23 PlacementController: start at (-3.6, -156.4, -61.5)
I 22:12:27 NavigationController: goal confirmed at (-67.7, -147.6, -98.0)
I 22:12:28 BridgeClient: RX nav_status state=following_path goal_reached=false goal_failed=false error_code=-
I 22:12:31 BridgeClient: RX nav_status state=idle goal_reached=true goal_failed=false error_code=-
I 22:12:36-22:12:42 [runtime noise] camera cycling x10
I 22:12:43 NavigationController: goal confirmed at (-215.4, -148.7, -163.0)
I 22:12:44 BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 22:12:44 BridgeClient: RX nav_status state=following_path goal_reached=false goal_failed=false error_code=-
I 22:12:48 BridgeClient: RX nav_status state=idle goal_reached=true goal_failed=false error_code=-
I 22:12:48-22:12:55 [runtime noise] camera cycling x9
I 22:12:56 NavigationController: goal confirmed at (-228.2, -138.1, -239.8)
I 22:12:56 BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 22:12:57 BridgeClient: RX nav_status state=following_path goal_reached=false goal_failed=false error_code=-
I 22:12:58-22:13:02 [runtime noise] camera cycling x8
I 22:13:03 BridgeClient: RX nav_status state=idle goal_reached=true goal_failed=false error_code=-
I 22:13:06-22:13:16 [runtime noise] camera cycling x14
I 22:13:16 NavigationController: goal confirmed at (-205.6, -144.5, -420.9)
I 22:13:17 BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 22:13:17 BridgeClient: RX nav_status state=following_path goal_reached=false goal_failed=false error_code=-
I 22:13:17-22:13:57 [runtime noise] camera cycling x28; nav lifecycle stale resync x8
I 22:14:00 BridgeClient: RX nav_status state=idle goal_reached=true goal_failed=false error_code=-
I 22:14:00-22:14:57 [runtime noise] camera cycling x74
I 22:14:57 NavigationController: goal confirmed at (-194.4, -144.6, -417.4)
I 22:14:58 BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 22:14:58 BridgeClient: RX nav_status state=following_path goal_reached=false goal_failed=false error_code=-
I 22:15:02 BridgeClient: RX nav_status state=idle goal_reached=true goal_failed=false error_code=-
I 22:15:06-22:15:44 [runtime noise] camera cycling x34; lidar all-filtered x56
I 22:15:45 BridgeClient: RX bridge_status registered=true robot_connected=false
I 22:15:46 DimosManager: setNavigationPlacementEnabled: false
I 22:15:46 NavigationController: placement disabled
I 22:15:46 PlacementController: stop
I 22:15:47 DimosManager: setNavigationPlacementEnabled: true
I 22:15:47 NavigationController: placement enabled
I 22:15:47 PlacementController: start at (-179.9, -151.9, -420.8)
I 22:15:51 NavigationController: goal confirmed at (-216.3, -142.6, -276.6)
I 22:15:51 BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 22:15:52-22:15:59 [runtime noise] camera cycling x10
I 22:16:02 BridgeClient: RX nav_status state=idle goal_reached=true goal_failed=false error_code=-
I 22:16:02 BridgeClient: RX bridge_status registered=true robot_connected=true
I 22:16:06-22:16:21 [runtime noise] camera cycling x20
I 22:16:23 DimosManager: setNavigationPlacementEnabled: false
I 22:16:23 NavigationController: placement disabled
I 22:16:23 PlacementController: stop
I 22:16:25 DimosManager: setNavigationPlacementEnabled: true
I 22:16:25 NavigationController: placement enabled
I 22:16:25 PlacementController: start at (-217.8, -152.9, -261.7)
I 22:16:29 NavigationController: goal confirmed at (-50.8, -138.4, -81.5)
I 22:16:30 BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 22:16:30 BridgeClient: RX nav_status state=following_path goal_reached=false goal_failed=false error_code=-
I 22:16:40 NavigationController: goal cancelled
I 22:16:40 BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 22:16:44-22:16:53 [runtime noise] camera cycling x16
I 22:16:55 DimosManager: setNavigationPlacementEnabled: false
I 22:16:55 NavigationController: placement disabled
I 22:16:55 PlacementController: stop
I 22:17:06-22:17:43 [runtime noise] camera cycling x38; perf samples ~17 (~59fps)
I 22:17:47 DimosManager: setNavigationPlacementEnabled: true
I 22:17:47 NavigationController: placement enabled
I 22:17:47 PlacementController: start at (-14.3, -149.5, -15.8)
I 22:17:47-22:17:51 [runtime noise] camera cycling x8
I 22:17:52 NavigationController: goal confirmed at (12.6, -149.3, -44.1)
I 22:17:53 BridgeClient: RX nav_status state=following_path goal_reached=false goal_failed=false error_code=-
I 22:18:03 BridgeClient: RX nav_status state=idle goal_reached=true goal_failed=false error_code=-
I 22:18:08 DimosManager: setNavigationPlacementEnabled: false
I 22:18:08 NavigationController: placement disabled
I 22:18:08 PlacementController: stop
I 22:18:14-22:18:18 [runtime noise] camera cycling x8
I 22:18:49 DimosManager: setNavigationPlacementEnabled: true
I 22:18:49 NavigationController: placement enabled
I 22:18:49 PlacementController: start at (5.8, -149.1, -50.3)
I 22:18:52 NavigationController: goal confirmed at (60.9, -142.0, -71.8)
I 22:18:52 BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 22:18:53 BridgeClient: RX nav_status state=following_path goal_reached=false goal_failed=false error_code=-
I 22:18:57 BridgeClient: RX nav_status state=idle goal_reached=true goal_failed=false error_code=-
I 22:19:07-22:19:13 [runtime noise] camera cycling x10
W 22:19:32 Spectacles has disconnected from Lens Studio.

=== TOTALS (collapsed) ===
camera toggles: 683 | lidar all-filtered: 56 | pose logs: 24 | perf: 17 | nav stale: 8


20:00:42.111[inf][/visualization/rerun/bridge.py] bridge listening on LCM
20:00:42.783[deb][tocol/pubsub/impl/shmpubsub.py] SharedMemory PubSub starting (backend=auto)
20:06:24.178[inf][xr/network/websocket_server.py] XR client connected remote=('192.168.1.210', 40612)
20:06:24.283[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:06:24.443[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:06:25.507[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:06:26.634[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:06:27.770[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:06:28.865[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:06:29.319[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:06:29.942[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:06:30.216[inf][xr/network/websocket_server.py] XR inbound text message type=align_start
20:06:30.248[inf][s-xr/dimos_xr/bridge/assist.py] AssistDriver transition from_=idle msg=Scan the robot tag to estimate its position to=estimating
20:06:30.253[inf][r/dimos_xr/bridge/alignment.py] XR alignment started method=tag
20:06:30.516[inf][xr/network/websocket_server.py] XR inbound text message type=camera_info
20:06:30.522[inf][r/dimos_xr/bridge/alignment.py] XR camera intrinsics received device=spectacles resolution=1008x756
20:06:32.290[inf][s-xr/dimos_xr/bridge/assist.py] AssistDriver transition from_=estimating msg=Robot position estimated — press Continue to start assisted calibration to=awaiting_confirm
20:06:34.893[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:06:35.602[inf][xr/network/websocket_server.py] XR inbound text message type=assist_confirm
20:06:35.634[inf][s-xr/dimos_xr/bridge/assist.py] AssistDriver transition from_=awaiting_confirm msg=Robot moving — leg 1/3 to=move
20:06:36.152[war][imos_xr/tracking/transforms.py] gravity_level_transform diagnostic: translation=[-0.79  -0.577  1.734] up_world=[ 4.856e-01 -5.591e-04 -8.742e-01] input_rotation=[[-1.425e-01 -8.625e-01  4.856e-01]
 [-9.867e-01  1.627e-01 -5.591e-04]
 [-7.851e-02 -4.792e-01 -8.742e-01]]
20:06:36.154[war][imos_xr/tracking/transforms.py] gravity_level_transform: input up-axis far from world-up (angle=90.0 deg) — calibration input likely malformed; this warning is rate-limited to once per 30 s
20:06:40.091[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:06:46.147[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:06:51.353[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:06:57.428[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:07:03.611[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:07:06.277[war][imos_xr/tracking/transforms.py] gravity_level_transform: input up-axis far from world-up (angle=52.0 deg) — calibration input likely malformed; this warning is rate-limited to once per 30 s
20:07:08.774[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:07:12.601[inf][s-xr/dimos_xr/bridge/assist.py] AssistDriver transition from_=move msg=Baseline collection complete to=done
20:07:12.671[inf][r/dimos_xr/bridge/alignment.py] AssistDriver DONE — auto-committing alignment
20:07:12.683[deb][r/dimos_xr/bridge/alignment.py] TF publish_static not supported by current backend (PubSubTF) — skipping world→odom static TF broadcast
20:07:12.683[inf][r/dimos_xr/bridge/alignment.py] Alignment succeeded approximate=False method=tag quality=0.93
20:07:12.966[inf][r/dimos_xr/bridge/telemetry.py] LiDAR stream active binary=True hz=1.0
20:07:12.967[deb][r/dimos_xr/bridge/telemetry.py] LiDAR payload bytes=9005 hz=1.0 points=1500
20:07:14.202[inf][mos_xr/tracking/tag_tracker.py] tag_mount_offset diagnostic tag_id=0 measured_base_to_tag=[0.2071 0.0006 0.0375] configured_mount.position=[0.18 0.   0.06] residual=[ 0.0271  0.0006 -0.0225] p_world_tag=[-0.7034 -0.8084  1.8689] p_world_base_from_mount=[-0.6671 -0.8548  1.6886]
20:07:14.729[inf][xr/network/websocket_server.py] XR inbound text message type=align_stop
20:07:14.730[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:07:14.730[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
ERROR:asyncio:Exception in callback Transaction.__retry()
handle: <TimerHandle when=204728.283549541 Transaction.__retry()>
Traceback (most recent call last):
  File "/Users/johannestscharn/.local/share/uv/python/cpython-3.12.12-macos-aarch64-none/lib/python3.12/asyncio/events.py", line 88, in _run
    self._context.run(self._callback, *self._args)
  File "/Users/johannestscharn/Repositories/dimos/.venv/lib/python3.12/site-packages/aioice/stun.py", line 330, in __retry
    self.__future.set_exception(TransactionTimeout())
asyncio.exceptions.InvalidStateError: invalid state
20:08:09.263[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:08:09.306[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:08:12.803[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:08:13.661[deb][r/dimos_xr/bridge/telemetry.py] LiDAR payload bytes=9005 hz=1.0 points=1500
20:08:30.261[inf][mos_xr/tracking/tag_tracker.py] tag_mount_offset diagnostic tag_id=0 measured_base_to_tag=[0.1786 0.0127 0.0416] configured_mount.position=[0.18 0.   0.06] residual=[-0.0014  0.0127 -0.0184] p_world_tag=[-0.6985 -0.8023  1.8425] p_world_base_from_mount=[-0.6509 -0.8488  1.6648]
20:08:37.238[inf][mos_xr/tracking/tag_tracker.py] Tag frame skipped: no odom at capture time seq=58
20:08:51.670[inf][mos_xr/tracking/tag_tracker.py] Tag frame skipped: no odom at capture time seq=62
20:09:02.082[inf][mos_xr/tracking/tag_tracker.py] tag_mount_offset diagnostic tag_id=0 measured_base_to_tag=[ 0.1864 -0.0052  0.0498] configured_mount.position=[0.18 0.   0.06] residual=[ 0.0064 -0.0052 -0.0102] p_world_tag=[-0.6985 -0.8023  1.8425] p_world_base_from_mount=[-0.6509 -0.8488  1.6648]
20:09:13.982[deb][r/dimos_xr/bridge/telemetry.py] LiDAR payload bytes=9005 hz=1.0 points=1500
20:09:34.478[inf][mos_xr/tracking/tag_tracker.py] tag_mount_offset diagnostic tag_id=0 measured_base_to_tag=[0.1793 0.0056 0.0749] configured_mount.position=[0.18 0.   0.06] residual=[-0.0007  0.0056  0.0149] p_world_tag=[-0.6824 -0.7689  1.829 ] p_world_base_from_mount=[-0.6302 -0.8151  1.6526]
20:09:34.481[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:10:14.617[deb][r/dimos_xr/bridge/telemetry.py] LiDAR payload bytes=9005 hz=1.0 points=1500
20:10:16.646[inf][xr/network/websocket_server.py] XR client connected remote=('192.168.1.210', 51046)
20:10:16.730[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:10:16.868[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:10:18.006[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:10:18.007[inf][xr/network/websocket_server.py] XR inbound text message type=align_start
20:10:18.009[inf][s-xr/dimos_xr/bridge/assist.py] AssistDriver transition from_=idle msg=Scan the robot tag to estimate its position to=estimating
20:10:18.011[inf][r/dimos_xr/bridge/alignment.py] XR alignment started method=tag
20:10:18.012[inf][xr/network/websocket_server.py] XR inbound text message type=camera_info
20:10:18.014[inf][r/dimos_xr/bridge/alignment.py] XR camera intrinsics received device=spectacles resolution=1008x756
20:10:21.911[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:10:27.137[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:10:33.224[inf][mos_xr/tracking/tag_tracker.py] Tag frame skipped: no odom at capture time seq=10
20:10:33.225[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:10:36.486[inf][xr/network/websocket_server.py] XR inbound text message type=align_stop
20:10:36.487[inf][s-xr/dimos_xr/bridge/assist.py] AssistDriver transition from_=estimating msg=Alignment stopped to=awaiting_confirm
20:10:36.488[inf][r/dimos_xr/bridge/alignment.py] XR alignment stopped
20:10:36.805[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:10:37.320[inf][xr/network/websocket_server.py] XR inbound text message type=align_start
20:10:37.328[inf][s-xr/dimos_xr/bridge/assist.py] AssistDriver transition from_=idle msg=Scan the robot tag to estimate its position to=estimating
20:10:37.329[inf][r/dimos_xr/bridge/alignment.py] XR alignment started method=tag
20:10:39.030[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:10:42.882[inf][xr/network/websocket_server.py] XR inbound text message type=align_stop
20:10:42.889[inf][s-xr/dimos_xr/bridge/assist.py] AssistDriver transition from_=estimating msg=Alignment stopped to=awaiting_confirm
20:10:42.902[inf][r/dimos_xr/bridge/alignment.py] XR alignment stopped
20:10:42.903[inf][xr/network/websocket_server.py] XR inbound text message type=align_start
20:10:42.904[inf][r/dimos_xr/bridge/alignment.py] XR alignment started method=manual
20:10:42.904[inf][xr/network/websocket_server.py] XR inbound text message type=align_manual_pose
20:10:42.906[inf][r/dimos_xr/bridge/alignment.py] Manual alignment pose received position=[0.09, -1.466, -0.8]
20:10:42.908[inf][r/dimos_xr/bridge/alignment.py] Manual alignment candidate confirmed position=[0.09, -1.466, -0.8] quality=0.35
20:10:44.135[inf][xr/network/websocket_server.py] XR inbound text message type=align_manual_pose
20:10:44.480[inf][xr/network/websocket_server.py] XR inbound text message type=align_commit
20:10:44.481[inf][r/dimos_xr/bridge/alignment.py] Alignment succeeded approximate=True method=manual quality=0.35
20:10:44.482[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:10:45.990[inf][xr/network/websocket_server.py] XR inbound text message type=align_stop
20:10:45.991[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:10:48.053[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:10:49.398[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:10:59.779[inf][xr/network/websocket_server.py] XR client connected remote=('192.168.1.210', 38016)
20:10:59.783[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:10:59.939[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:11:00.899[inf][xr/network/websocket_server.py] XR inbound text message type=align_start
20:11:00.901[inf][s-xr/dimos_xr/bridge/assist.py] AssistDriver transition from_=idle msg=Scan the robot tag to estimate its position to=estimating
20:11:00.902[inf][r/dimos_xr/bridge/alignment.py] XR alignment started method=tag
20:11:00.903[inf][xr/network/websocket_server.py] XR inbound text message type=camera_info
20:11:00.903[inf][r/dimos_xr/bridge/alignment.py] XR camera intrinsics received device=spectacles resolution=1008x756
20:11:04.409[inf][s-xr/dimos_xr/bridge/assist.py] AssistDriver transition from_=estimating msg=Robot position estimated — press Continue to start assisted calibration to=awaiting_confirm
20:11:05.962[inf][r/dimos_xr/bridge/alignment.py] Alignment session cleared on XR client disconnect
20:11:06.029[inf][mos_xr/tracking/tag_tracker.py] tag_mount_offset diagnostic tag_id=0 measured_base_to_tag=[ 0.0012 -0.1346  0.207 ] configured_mount.position=[0.18 0.   0.06] residual=[-0.1788 -0.1346  0.147 ] p_world_tag=[ 0.1186 -1.2608 -0.6697] p_world_base_from_mount=[-0.0645 -1.3107 -0.6695]
20:11:07.872[inf][xr/network/websocket_server.py] XR inbound text message type=assist_confirm
20:11:07.873[deb][s-xr/dimos_xr/bridge/assist.py] assist_confirm ignored in state state=idle
20:11:08.534[inf][xr/network/websocket_server.py] XR inbound text message type=assist_confirm
20:11:08.535[deb][s-xr/dimos_xr/bridge/assist.py] assist_confirm ignored in state state=idle
20:11:13.335[inf][xr/network/websocket_server.py] XR inbound text message type=assist_confirm
20:11:13.337[deb][s-xr/dimos_xr/bridge/assist.py] assist_confirm ignored in state state=idle
20:11:14.370[inf][xr/network/websocket_server.py] XR inbound text message type=assist_confirm
20:11:14.370[deb][s-xr/dimos_xr/bridge/assist.py] assist_confirm ignored in state state=idle
20:11:15.156[inf][xr/network/websocket_server.py] XR inbound text message type=assist_confirm
20:11:15.157[deb][s-xr/dimos_xr/bridge/assist.py] assist_confirm ignored in state state=idle
20:11:15.642[deb][r/dimos_xr/bridge/telemetry.py] LiDAR payload bytes=9005 hz=1.0 points=1500
20:11:27.558[inf][xr/network/websocket_server.py] XR client connected remote=('192.168.1.210', 56294)
20:11:27.594[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:11:27.742[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:11:28.646[inf][xr/network/websocket_server.py] XR inbound text message type=align_start
20:11:28.648[inf][s-xr/dimos_xr/bridge/assist.py] AssistDriver transition from_=idle msg=Scan the robot tag to estimate its position to=estimating
20:11:28.649[inf][r/dimos_xr/bridge/alignment.py] XR alignment started method=tag
20:11:28.649[inf][xr/network/websocket_server.py] XR inbound text message type=camera_info
20:11:28.650[inf][r/dimos_xr/bridge/alignment.py] XR camera intrinsics received device=spectacles resolution=1008x756
20:11:33.041[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:11:36.357[inf][s-xr/dimos_xr/bridge/assist.py] AssistDriver transition from_=estimating msg=Robot position estimated — press Continue to start assisted calibration to=awaiting_confirm
20:11:39.491[inf][xr/network/websocket_server.py] XR inbound text message type=assist_confirm
20:11:39.505[inf][s-xr/dimos_xr/bridge/assist.py] AssistDriver transition from_=awaiting_confirm msg=Robot moving — leg 1/3 to=move
20:11:39.506[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:11:40.043[inf][xr/network/websocket_server.py] XR inbound text message type=emergency_stop
20:11:40.050[inf][s-xr/dimos_xr/bridge/assist.py] AssistDriver transition from_=move msg=Emergency stop received to=awaiting_confirm
20:11:41.209[inf][xr/network/websocket_server.py] XR inbound text message type=assist_confirm
20:11:41.213[inf][s-xr/dimos_xr/bridge/assist.py] AssistDriver transition from_=awaiting_confirm msg=Robot moving — leg 1/3 to=move
20:11:45.432[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:11:51.329[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:11:56.655[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:12:02.595[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:12:08.476[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:12:14.359[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:12:15.995[deb][r/dimos_xr/bridge/telemetry.py] LiDAR payload bytes=9005 hz=1.0 points=1500
20:12:20.219[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:12:21.819[inf][s-xr/dimos_xr/bridge/assist.py] AssistDriver transition from_=move msg=Baseline collection complete to=done
20:12:21.906[inf][r/dimos_xr/bridge/alignment.py] AssistDriver DONE — auto-committing alignment
20:12:21.907[inf][r/dimos_xr/bridge/alignment.py] Alignment succeeded approximate=False method=tag quality=0.94
20:12:23.688[inf][mos_xr/tracking/tag_tracker.py] tag_mount_offset diagnostic tag_id=0 measured_base_to_tag=[0.1821 0.0102 0.0861] configured_mount.position=[0.18 0.   0.06] residual=[0.0021 0.0102 0.0261] p_world_tag=[-0.082  -1.1614 -0.7976] p_world_base_from_mount=[-0.0469 -1.2089 -0.6173]
20:12:23.697[inf][xr/network/websocket_server.py] XR inbound text message type=align_stop
20:12:23.698[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:12:26.064[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:12:27.040[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:12:27.252[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:12:28.016[inf][xr/network/websocket_server.py] XR inbound text message type=nav_goal
20:12:28.135[inf][/dimos_xr/bridge/navigation.py] XR navigation goal published odom_goal=[0.847, 0.411, 0.04] odom_goal_yaw_deg=-0.0 world_goal=[-0.677, -1.476, -0.98] world_goal_yaw_deg=148.08
20:12:28.296[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.847, 0.411, 0.040], euler=[90.0, 0.0, 25.9])
20:12:28.375[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
20:12:28.572[inf][nning_a_star/global_planner.py] Found safe goal. x=0.83 y=0.38
20:12:28.675[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
20:12:28.692[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
20:12:30.031[inf][anning_a_star/local_planner.py] changed state state=path_following
20:12:31.676[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
20:12:31.676[inf][anning_a_star/local_planner.py] changed state state=final_rotation
20:12:31.676[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
20:12:31.677[inf][anning_a_star/local_planner.py] changed state state=arrived
20:12:31.779[inf][anning_a_star/local_planner.py] changed state state=idle
20:12:31.779[inf][nning_a_star/global_planner.py] Arrived at goal.
20:12:31.781[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
20:12:40.989[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:12:42.057[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:12:43.376[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:12:43.809[inf][xr/network/websocket_server.py] XR inbound text message type=nav_goal
20:12:43.817[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:12:43.864[inf][/dimos_xr/bridge/navigation.py] XR navigation goal published odom_goal=[2.098, 1.204, 0.077] odom_goal_yaw_deg=-0.0 world_goal=[-2.154, -1.487, -1.63] world_goal_yaw_deg=148.64
20:12:43.865[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.098, 1.204, 0.077], euler=[90.0, 0.0, 26.5])
20:12:43.869[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
20:12:43.870[inf][nning_a_star/global_planner.py] Found safe goal. x=2.08 y=1.18
20:12:43.905[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
20:12:43.918[inf][anning_a_star/local_planner.py] changed state state=path_following
20:12:47.546[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
20:12:47.547[inf][anning_a_star/local_planner.py] changed state state=final_rotation
20:12:48.168[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
20:12:48.168[inf][anning_a_star/local_planner.py] changed state state=arrived
20:12:48.270[inf][anning_a_star/local_planner.py] changed state state=idle
20:12:48.270[inf][nning_a_star/global_planner.py] Arrived at goal.
20:12:48.271[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
20:12:51.187[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:12:52.225[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:12:53.233[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:12:55.190[inf][mos_xr/tracking/tag_tracker.py] tag_mount_offset diagnostic tag_id=0 measured_base_to_tag=[1.8001e-01 8.5478e-06 5.9996e-02] configured_mount.position=[0.18 0.   0.06] residual=[ 1.2233e-05  8.5478e-06 -4.3599e-06] p_world_tag=[-0.9214 -1.2052 -0.9649] p_world_base_from_mount=[-0.7805 -1.2609 -0.8507]
20:12:56.160[inf][xr/network/websocket_server.py] XR inbound text message type=nav_goal
20:12:56.163[inf][/dimos_xr/bridge/navigation.py] XR navigation goal published odom_goal=[2.816, 0.904, 0.182] odom_goal_yaw_deg=-0.0 world_goal=[-2.282, -1.381, -2.398] world_goal_yaw_deg=120.3
20:12:56.164[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.816, 0.904, 0.182], euler=[90.0, 0.0, -1.9])
20:12:56.166[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
20:12:56.169[inf][nning_a_star/global_planner.py] Found safe goal. x=2.83 y=0.83
20:12:56.203[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:12:57.624[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
20:12:57.642[inf][anning_a_star/local_planner.py] changed state state=path_following
20:13:03.074[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
20:13:03.076[inf][anning_a_star/local_planner.py] changed state state=final_rotation
20:13:03.077[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
20:13:03.081[inf][anning_a_star/local_planner.py] changed state state=arrived
20:13:03.179[inf][anning_a_star/local_planner.py] changed state state=idle
20:13:03.179[inf][nning_a_star/global_planner.py] Arrived at goal.
20:13:03.180[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
20:13:03.183[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:13:07.644[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:13:08.947[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:13:10.548[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:13:11.885[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:13:13.019[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:13:14.799[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:13:16.047[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:13:16.786[inf][xr/network/websocket_server.py] XR inbound text message type=nav_goal
20:13:16.790[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:13:16.796[inf][/dimos_xr/bridge/navigation.py] XR navigation goal published odom_goal=[4.229, -0.252, 0.119] odom_goal_yaw_deg=0.0 world_goal=[-2.056, -1.445, -4.209] world_goal_yaw_deg=83.42
20:13:16.795[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.229, -0.252, 0.119], euler=[90.0, 0.0, -38.7])
20:13:16.798[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
20:13:16.949[inf][nning_a_star/global_planner.py] Found safe goal. x=4.23 y=-0.27
20:13:16.977[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
20:13:16.987[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
20:13:17.227[deb][r/dimos_xr/bridge/telemetry.py] LiDAR payload bytes=9005 hz=1.0 points=1500
20:13:18.865[inf][anning_a_star/local_planner.py] changed state state=path_following
20:13:23.988[war][imos_xr/tracking/transforms.py] gravity_level_transform: input up-axis far from world-up (angle=16.1 deg) — calibration input likely malformed; this warning is rate-limited to once per 30 s
20:13:25.195[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:13:25.197[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=2 dropped_fifo=0 fifo_depth=0
20:13:30.985[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:13:33.354[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:13:40.686[inf][nning_a_star/global_planner.py] Robot veered off track. Replanning. deviation=0.9 threshold=0.9
20:13:40.734[inf][nning_a_star/global_planner.py] Replanning. attempt=0
20:13:40.742[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
20:13:40.752[inf][anning_a_star/local_planner.py] changed state state=idle
20:13:40.752[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
20:13:40.753[inf][nning_a_star/global_planner.py] Found safe goal. x=4.23 y=-0.27
20:13:40.846[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:13:40.857[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
20:13:41.142[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
20:13:41.559[inf][anning_a_star/local_planner.py] changed state state=path_following
20:13:41.715[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:13:49.391[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
20:13:49.393[inf][anning_a_star/local_planner.py] changed state state=final_rotation
20:13:49.931[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:13:49.933[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=2 dropped_fifo=0 fifo_depth=0
20:13:50.952[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
20:13:50.953[inf][anning_a_star/local_planner.py] changed state state=arrived
20:13:51.006[inf][nning_a_star/global_planner.py] Close enough to goal. Accepting as arrived.
20:13:51.007[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
20:13:51.008[inf][anning_a_star/local_planner.py] changed state state=idle
20:13:58.303[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:13:51.009[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
20:14:00.316[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=3 dropped_fifo=0 fifo_depth=0
20:14:07.980[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:14:08.012[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:14:17.815[deb][r/dimos_xr/bridge/telemetry.py] LiDAR payload bytes=9005 hz=1.0 points=1500
20:14:23.158[inf][mos_xr/tracking/tag_tracker.py] Tag frame skipped: no odom at capture time seq=70
20:14:49.318[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:14:52.675[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:14:55.547[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:14:57.015[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:14:58.029[inf][xr/network/websocket_server.py] XR inbound text message type=nav_goal
20:14:58.127[inf][/dimos_xr/bridge/navigation.py] XR navigation goal published odom_goal=[3.535, -0.406, 0.05] odom_goal_yaw_deg=-180.0 world_goal=[-1.944, -1.446, -4.174] world_goal_yaw_deg=-95.73
20:14:58.131[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.535, -0.406, 0.050], euler=[90.0, 0.0, 149.3])
20:14:58.148[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
20:14:58.158[inf][nning_a_star/global_planner.py] Found safe goal. x=3.53 y=-0.42
20:14:58.256[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
20:14:58.275[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
20:14:58.400[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:14:59.691[inf][anning_a_star/local_planner.py] changed state state=path_following
20:15:01.841[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
20:15:01.845[inf][anning_a_star/local_planner.py] changed state state=final_rotation
20:15:01.947[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
20:15:01.947[inf][anning_a_star/local_planner.py] changed state state=arrived
20:15:02.058[inf][anning_a_star/local_planner.py] changed state state=idle
20:15:02.059[inf][nning_a_star/global_planner.py] Arrived at goal.
20:15:02.060[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
20:15:18.378[deb][r/dimos_xr/bridge/telemetry.py] LiDAR payload bytes=9005 hz=1.0 points=1500
20:15:19.290[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:15:33.703[inf][mos_xr/tracking/tag_tracker.py] Tag frame skipped: no odom at capture time seq=90
20:15:36.973[inf][mos_xr/tracking/tag_tracker.py] Tag frame skipped: no odom at capture time seq=91
20:15:40.193[inf][mos_xr/tracking/tag_tracker.py] Tag frame skipped: no odom at capture time seq=92
20:15:43.267[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:15:43.568[inf][mos_xr/tracking/tag_tracker.py] Tag frame skipped: no odom at capture time seq=93
20:15:44.339[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:15:46.810[inf][mos_xr/tracking/tag_tracker.py] Tag frame skipped: no odom at capture time seq=94
20:15:48.735[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:15:50.038[inf][mos_xr/tracking/tag_tracker.py] Tag frame skipped: no odom at capture time seq=95
20:15:50.039[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:15:50.055[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:15:51.323[inf][xr/network/websocket_server.py] XR inbound text message type=nav_goal
20:15:51.334[inf][/dimos_xr/bridge/navigation.py] XR navigation goal published odom_goal=[2.502, 0.789, 0.075] odom_goal_yaw_deg=-180.0 world_goal=[-2.163, -1.426, -2.766] world_goal_yaw_deg=-85.46
20:15:51.335[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.502, 0.789, 0.075], euler=[90.0, 0.0, 148.9])
20:15:51.336[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
20:15:51.339[inf][nning_a_star/global_planner.py] Found safe goal. x=2.48 y=0.78
20:15:51.511[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
20:15:51.609[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
20:15:52.569[inf][anning_a_star/local_planner.py] changed state state=path_following
20:15:54.652[inf][mos_xr/tracking/tag_tracker.py] Tag frame skipped: no odom at capture time seq=96
20:15:59.030[inf][mos_xr/tracking/tag_tracker.py] Tag frame skipped: no odom at capture time seq=97
20:15:59.372[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
20:15:59.377[inf][anning_a_star/local_planner.py] changed state state=final_rotation
20:15:59.378[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
20:15:59.378[inf][anning_a_star/local_planner.py] changed state state=arrived
20:15:59.474[inf][anning_a_star/local_planner.py] changed state state=idle
20:15:59.475[inf][nning_a_star/global_planner.py] Arrived at goal.
20:15:59.476[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
20:15:59.543[war][/dimos_xr/bridge/navigation.py] XR navigation goal stalled; attempting recovery attempt=1 max_attempts=2
20:15:59.551[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:15:59.688[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:16:19.287[deb][r/dimos_xr/bridge/telemetry.py] LiDAR payload bytes=9005 hz=1.0 points=1500
20:16:27.020[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:16:28.189[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:16:28.991[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:16:29.211[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:16:30.036[war][imos_xr/tracking/transforms.py] gravity_level_transform: input up-axis far from world-up (angle=17.8 deg) — calibration input likely malformed; this warning is rate-limited to once per 30 s
20:16:30.038[inf][xr/network/websocket_server.py] XR inbound text message type=nav_goal
20:16:30.140[inf][/dimos_xr/bridge/navigation.py] XR navigation goal published odom_goal=[-0.007, 0.487, 0.117] odom_goal_yaw_deg=180.0 world_goal=[-0.508, -1.384, -0.815] world_goal_yaw_deg=-27.45
20:16:30.142[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.007, 0.487, 0.117], euler=[90.0, 0.0, -152.4])
20:16:30.144[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
20:16:30.147[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.07 y=0.43
20:16:30.243[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
20:16:30.264[inf][anning_a_star/local_planner.py] changed state state=path_following
20:16:38.666[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:16:38.674[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=3 dropped_fifo=0 fifo_depth=0
20:16:40.589[inf][xr/network/websocket_server.py] XR inbound text message type=cancel_goal
20:16:40.599[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:16:40.607[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
20:16:40.621[inf][anning_a_star/local_planner.py] changed state state=idle
20:16:40.622[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
20:16:47.968[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:17:16.727[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:17:19.750[deb][r/dimos_xr/bridge/telemetry.py] LiDAR payload bytes=9005 hz=1.0 points=1500
20:17:46.936[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:17:47.963[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:17:49.328[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:17:50.727[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:17:51.838[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:17:52.772[inf][xr/network/websocket_server.py] XR inbound text message type=nav_goal
20:17:52.826[inf][/dimos_xr/bridge/navigation.py] XR navigation goal published odom_goal=[-0.116, -0.021, -0.023] odom_goal_yaw_deg=-0.0 world_goal=[0.126, -1.493, -0.441] world_goal_yaw_deg=84.9
20:17:52.827[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.116, -0.021, -0.023], euler=[90.0, 0.0, -37.7])
20:17:52.833[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
20:17:52.836[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.12 y=-0.02
20:17:52.913[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:17:52.936[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
20:17:52.980[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
20:17:55.991[inf][anning_a_star/local_planner.py] changed state state=path_following
20:18:00.375[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
20:18:00.377[inf][anning_a_star/local_planner.py] changed state state=final_rotation
20:18:01.302[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:18:01.305[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=3 dropped_fifo=0 fifo_depth=0
20:18:03.275[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
20:18:03.275[inf][anning_a_star/local_planner.py] changed state state=arrived
20:18:03.385[inf][anning_a_star/local_planner.py] changed state state=idle
20:18:03.387[inf][nning_a_star/global_planner.py] Arrived at goal.
20:18:03.388[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
20:18:12.427[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:18:20.456[deb][r/dimos_xr/bridge/telemetry.py] LiDAR payload bytes=9005 hz=1.0 points=1500
20:18:23.658[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:18:51.116[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:18:52.910[inf][xr/network/websocket_server.py] XR inbound text message type=nav_goal
20:18:52.959[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.137, -0.563, 0.050], euler=[90.0, -0.0, -81.2])
20:18:52.961[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
20:18:52.967[inf][/dimos_xr/bridge/navigation.py] XR navigation goal published odom_goal=[-0.137, -0.563, 0.05] odom_goal_yaw_deg=-0.0 world_goal=[0.609, -1.42, -0.718] world_goal_yaw_deg=41.64
20:18:52.969[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.17 y=-0.57
20:18:52.991[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
20:18:53.002[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
20:18:53.209[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=2 dropped_fifo=0 fifo_depth=0
20:18:54.455[inf][anning_a_star/local_planner.py] changed state state=path_following
20:18:56.934[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
20:18:56.936[inf][anning_a_star/local_planner.py] changed state state=final_rotation
20:18:57.251[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
20:18:57.253[inf][anning_a_star/local_planner.py] changed state state=arrived
20:18:57.351[inf][anning_a_star/local_planner.py] changed state state=idle
20:18:57.352[inf][nning_a_star/global_planner.py] Arrived at goal.
20:18:57.355[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
20:19:20.692[deb][r/dimos_xr/bridge/telemetry.py] LiDAR payload bytes=9005 hz=1.0 points=1500
