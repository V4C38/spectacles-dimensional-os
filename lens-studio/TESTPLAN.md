# Lens Studio On-Device Test Plan

This script covers every flow that must survive the refactor intact. Run it
after P1, P3, and P5 at minimum; record results and Logger output each time as
the reference for the next phase.

## Test cases

### 1. Tag calibration happy path
1. Launch lens.
2. Start → Connect (autoconnect fires) → Calibrate.
3. Look at the AprilTag on the robot.
4. Verify: progress bar fills (bridge-computed progress).
5. Tap Complete → runtime.
6. Verify: robot marker tracks pose; lidar obstacle layer renders.

**Expected:** clean wizard → runtime transition, no errors in Logger.

---

### 2. Manual calibration, bridge connected (B1 regression test)
1. Launch lens.
2. Start → Connect → Calibrate → tap "Align manually".
3. Place the robot marker on the floor.
4. Verify: status slot shows "Ready" (or equivalent ready state).
5. Tap Complete → commit → runtime.
6. Verify: marker stays anchored; bridge log shows manual commit.

**Expected:** status renders, commit succeeds.

---

### 3. Manual calibration, bridge connects *late* (the B1 bug scenario)
1. Launch lens **disconnected** (bridge not running).
2. Calibrate → tap "Align manually" → place marker.
3. Start the bridge / enable autoconnect.
4. Wait for autoconnect to complete.
5. Verify in bridge log: `align_start{method:"manual"}` sent after hello.
6. Verify: session re-arms → status shows ready → Complete.

**Expected (currently failing on `manual-mode` branch — this is the bug).**

---

### 4. Manual calibration, no odometry
1. Bridge connected but robot odometry stack not publishing.
2. Calibrate → "Align manually" → place marker.
3. Verify: status slot shows "Waiting for robot odometry" (not silent).

**Expected (currently silent — B3).**

---

### 5. Manual calibration, fully offline
1. Never connect (skip Connect step / no bridge).
2. Calibrate → "Align manually" → place marker → Complete.
3. Verify: local-only runtime with anchor pose applied; no crash.

**Expected:** offline fallback path works.

---

### 6. Mode toggling during calibration
1. Calibrate → toggle auto ↔ manual repeatedly (≥3 cycles).
2. Verify: no stuck sessions in bridge log (each toggle shows paired
   `align_start` / `align_stop` or equivalent).
3. Return to auto → tag session resumes cleanly.

**Expected:** no duplicate or leaked sessions.

---

### 7. Full runtime flow
1. After calibration (any method): place a goal → drag → confirm.
2. Verify: path renders → goal reached outcome flashes.
3. Cancel goal.
4. Trigger emergency stop (if supported by current robot stack); verify
   button disabled state on `unitree-g1` if applicable.
5. Cycle lidar mode (off → occupancy → … → off).
6. Switch operating mode.
7. Open robot menu.
8. Restart setup from main menu → full wizard again.

**Expected:** all controls respond correctly; no visual regressions.

---

### 8. Disconnect/reconnect during runtime
1. Runtime active → kill bridge connection.
2. Verify: marker behavior (freezes/hides appropriately), lidar clears,
   nav state resets, link-state text updates in both menus.
3. Reconnect bridge.
4. Verify: link-state text updates; robot marker resumes tracking.

**Expected:** clean recovery, no orphaned state.

---

### 9. Protocol version mismatch
1. Run a **v3 bridge** against the v4 Lens client.
2. Verify: clean error message surfaced in UI (or Logger); no silent
   weirdness, no crash.

**Expected:** graceful rejection, user-visible feedback.

---

## Baseline capture instructions

Run the full script on the `manual-mode` branch before beginning P1.
Record in `TESTPLAN_BASELINE.md` (git-ignored):

- Pass / Fail for each case.
- Relevant Logger lines for cases 2, 3, 4 (alignment session messages).
- Bridge-side log snippet for cases 2, 3 (align_start / align_stop).

This baseline is the regression reference for every subsequent phase.
