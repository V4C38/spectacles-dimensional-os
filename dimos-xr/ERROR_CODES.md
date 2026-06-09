# XR Bridge Error Codes

Spectacles shows bridge client errors during setup on the Calibrate step as
**`Bridge Error (CODE): <description>`** on the status line (red) and the matching
**fix** text on the detail line below. The numeric codes are **XR bridge client
codes** — they are not HTTP response codes from a web server.

**When adding a new error code**, update together in one change:

1. [`dimos_xr/error_codes.py`](dimos_xr/error_codes.py) — add a `BridgeError` constant and register it in `BRIDGE_ERRORS`
2. This file — add a table row and a detailed section below
3. [`lens-studio/Assets/Scripts/Setup/BridgeErrorCodes.ts`](../lens-studio/Assets/Scripts/Setup/BridgeErrorCodes.ts) — mirror the numeric code
4. Assign the code in [`CalibrationSession.ts`](../lens-studio/Assets/Scripts/Setup/CalibrationSession.ts) / [`CalibrationPresenter.ts`](../lens-studio/Assets/Scripts/Setup/CalibrationPresenter.ts) where the failure is detected

---

## Quick reference

| Code | Name | Lens surface | Fix |
|------|------|--------------|-----|
| 400 | Manual pose invalid | Calibrate status + detail | Re-grab marker and retry Complete |
| 409 | Align commit — no candidate | Calibrate status + detail | Wait for bridge or restart robot & bridge |
| 500 | Alignment failed | Calibrate status + detail | Retry calibration; restart robot & bridge if needed |
| 502 | Bridge disconnected during commit | Calibrate status + detail | Reconnect and retry calibration |
| 503 | Align session unavailable | Calibrate status + detail | Restart robot & bridge |
| 504 | Manual pose confirm timeout | Calibrate status + detail | Restart robot & bridge |
| 505 | Nav goal stalled | Runtime robot marker (red) | Reconnect or restart robot & bridge |

---

## 400 — Manual pose invalid

**When:** Manual calibrate; Spectacles could not read the marker pose, finalize
offline placement, start manual placement, or failed to send `align_commit`.

**Description:** Spectacles could not read the manual robot marker pose, finalize
offline placement, start manual placement, or send the alignment commit to the
bridge.

**Fix:** Re-grab the marker below the panel and try **Complete** again.

---

## 409 — Align commit — no candidate

**When:** Bridge responds to `align_commit` with `align_status` `state: failed` and
message indicating no valid candidate.

**Description:** The bridge rejected `align_commit` because no valid calibration
candidate was available yet.

**Fix:** Wait for bridge confirmation or restart the robot and bridge (`./start.sh`).

---

## 500 — Alignment failed

**When:** Bridge reports `align_status` `state: failed` during marker or manual
alignment (other than the no-candidate case).

**Description:** Marker or manual alignment failed on the bridge.

**Fix:** Retry calibration; restart the robot and bridge (`./start.sh`) if it persists.

---

## 502 — Bridge disconnected during commit

**When:** WebSocket disconnects while calibrate is in the `pendingCommit` phase.

**Description:** The WebSocket disconnected while Spectacles was applying alignment.

**Fix:** Reconnect Spectacles to the bridge and retry calibration.

---

## 503 — Align session unavailable

**When:** Manual calibrate starts with bridge connected but `align_start` could not
be sent or accepted.

**Description:** The bridge could not start an alignment session after `align_start`.

**Fix:** Restart the robot and bridge (`./start.sh`), then reconnect Spectacles.

---

## 504 — Manual pose confirm timeout

**When:** Manual calibrate with bridge connected; status shows
`Waiting for bridge… N s` (yellow) and reaches **5 s** without the bridge setting
`has_candidate` on `align_status`.

**Description:** Spectacles sent manual placement updates but the bridge never
confirmed a calibration candidate within 5 seconds.

**Fix:** Restart the robot and bridge (`./start.sh`), then reconnect Spectacles.

---

## 505 — Nav goal stalled

**When:** Runtime navigation; the bridge exhausted automatic recovery attempts for a goal that never produced a path or robot motion.

**Description:** Navigation stopped responding after automatic recovery attempts. The robot did not start moving or publish a path for the goal.

**Fix:** Reconnect Spectacles to the bridge or restart the robot and bridge (`./start.sh`).
