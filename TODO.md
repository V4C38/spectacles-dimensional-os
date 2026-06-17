# TODO

Future work items that are known, researched, and worth doing — but not yet scheduled.

---

## Runtime yaw correction (A2)

**Context.** At runtime the bridge corrects the world←odom transform using robot-mounted AprilTag observations. The current path (`current_translation_solve`) preserves committed yaw and corrects translation only. If any residual drift is rotational the marker cannot fully settle.

**What we know.**

- `tag_tracker.current_solve()` already recovers yaw + translation when the robot has moved enough to build a baseline (≥ 0.15 m ground baseline, ≥ 2 observations). After the A1 snap fix, yaw from a full solve would snap alongside translation — no new yaw-sourcing mechanism is needed structurally.
- The stationary-robot fallback (`current_translation_solve`, method = `"tag_translation"`) preserves committed yaw by design. This is correct for stationary robots but means rotational residual accumulates silently.
- The A3 telemetry message includes `yaw_corrected` (passive read of `solve.method`) as an observability field, which will make it possible to see empirically how often full solves fire at runtime.

**Prerequisites before implementing.**

1. The high-res camera workstream (3200×2400 still frames) needs to be validated on-device so full runtime solves are reliably reachable.
2. Check `yaw_corrected = True` frequency in A3 telemetry logs to confirm baseline geometry is met at runtime.
3. Design a small-angle yaw guard (e.g. reject if `yaw_delta > 45°` on a full solve) as defense-in-depth beyond the existing innovation/reprojection gates.

**Files that would change.** `dimos-xr/dimos_xr/bridge/alignment.py` (one guard block in `_apply_tracker_update`), `dimos-xr/dimos_xr/bridge/test_alignment_session.py`.



E-STOP hanging

go2.py:255–280: cancel_goal and emergency_stop are both @rpc and both publish to the same stop_movement transport with no timeout. emergency_stop has an additional direct _go2_connection.publish_request(SPORT_MOD, StopMove) path, but if RPC dispatch is serialized and a prior call hangs, e-stop cannot be dispatched. Recommend a dedicated, timeout-bounded, non-@rpc e-stop path. Flagging only; out of scope for issues 1–2.