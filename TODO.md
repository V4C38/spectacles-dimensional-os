# TODO

Future work items that are known, researched, and worth doing — but not yet scheduled.

------------------------------
Issue #1 — Runtime yaw correction (A2)
------------------------------

**Context.** At runtime the bridge corrects the world←odom transform using robot-mounted AprilTag observations. The current path (`current_translation_solve`) preserves committed yaw and corrects translation only. If any residual drift is rotational the marker cannot fully settle.

**What we know.**

- `tag_tracker.current_solve()` already recovers yaw + translation when the robot has moved enough to build a baseline (≥ 0.15 m ground baseline, ≥ 2 observations). After the A1 snap fix, yaw from a full solve would snap alongside translation — no new yaw-sourcing mechanism is needed structurally.
- The stationary-robot fallback (`current_translation_solve`, method = `"tag_translation"`) preserves committed yaw by design. This is correct for stationary robots but means rotational residual accumulates silently.
- The A3 telemetry message includes `yaw_corrected` (passive read of `solve.method`) as an observability field, which will make it possible to see empirically how often full solves fire at runtime.

**Prerequisites before implementing.**

1. The high-res camera workstream (3200×2400 still frames) needs to be validated on-device so full runtime solves are reliably reachable.
2. Check `yaw_corrected = True` frequency in A3 telemetry logs to confirm baseline geometry is met at runtime.
3. Design a small-angle yaw guard (e.g. reject if `yaw_delta > 45°` on a full solve) as defense-in-depth beyond the existing innovation/reprojection gates.

**Files that would change.** `dimos-ar/dimos/ar/bridge/alignment.py` (one guard block in `_apply_tracker_update`), `dimos-ar/dimos/ar/bridge/test_alignment_session.py`.

------------------------------
Issue #2 — Nav cancel / e-stop RPC timeouts (508) and session degradation
------------------------------

**Context.** During a hardware run, Lens `cancel_goal` and `emergency_stop` both produced bridge error **508** (`CONTROL_RPC_TIMEOUT`) ~1 s after the command. Lens had already shown idle/cancelled; the timeout then set `goal_failed=true`, `error_code=508`, and `_nav_degraded=true`, bricking navigation for the rest of the session.

**Investigation summary (not a replan-thread block).**

- `Go2AdapterModule.cancel_goal` / `emergency_stop` (`dimos-ar/dimos/ar/adapters/go2.py`) are fast: they publish to `stop_movement` / `cancel_goal_signal` and return. They do **not** wait on the global planner replan loop.
- DimOS runs `@rpc` handlers in a thread pool; replanning runs in `GlobalPlanner._thread_entrypoint` on the nav module. Those paths do not share a blocking queue.
- `NavController` (`dimos-ar/dimos/ar/bridge/navigation.py`) wraps adapter calls with **`CONTROL_RPC_TIMEOUT_S = 1.0`**. The adapter is an **LCM RPCClient proxy** (ARBridge → Go2Adapter). Under load (stuck nav, runtime alignment, WebRTC dying), the round-trip can exceed 1 s even when the handler body is trivial.
- `on_cancel_goal` / `on_emergency_stop` already broadcast optimistic **idle / not failed**; `_mark_control_rpc_failure` then contradicts that with 508 and permanent degradation — wrong contract for fire-and-forget stop commands.
- `_recover_stuck_goal` also calls `_cancel_goal_async()`, which can overlap with user cancel (duplicate RPC load).
- `_go2_connection` is not wired today (always `None`), so e-stop in that run was `stop_movement` publish only. When wired, `emergency_stop` calls `_go2_connection.publish_request(StopMove)`, which in DimOS WebRTC uses **unbounded `future.result()`** — will block the RPC thread on a dying link unless fixed preemptively.
- Same pattern applies to `G1AdapterModule.emergency_stop` if `_g1_high_level.move()` can block.

**Proposed fix (dimos-ar only; do not edit DimOS).**

1. **`NavController` — command vs confirmation split (main fix).**
   - Keep optimistic local state + empty path + `nav_status` on cancel/e-stop (already correct).
   - Dispatch adapter RPC in a background thread; **do not** call `_mark_control_rpc_failure` / set `_nav_degraded` on slow or missing ack.
   - Log `warning` if ack exceeds ~1 s or raises; optional single retry.
   - Reserve 508 for a future case where stop transport is **unavailable** (adapter returns `False` synchronously), not “RPC was slow.”
   - Update `test_cancel_goal_timeout_marks_navigation_degraded` → assert session stays usable after slow cancel.

2. **`Go2Adapter.emergency_stop` — non-blocking WebRTC (defensive).**
   - Always publish `stop_movement` first (reaches `ReplanningAStarPlanner` via shared autoconnect transport).
   - Run `_go2_connection.publish_request(StopMove)` in a daemon thread with an explicit timeout (e.g. 2–3 s) when `_go2_connection` is wired.
   - Never block the `@rpc` handler on WebRTC.

3. **Do not** merely raise `CONTROL_RPC_TIMEOUT_S` while still degrading the session; **do not** call `ReplanningAStarPlanner.cancel_goal` RPC from ARBridge (couples bridge to DimOS nav internals).

**Files that would change.** `dimos-ar/dimos/ar/bridge/navigation.py`, `dimos-ar/dimos/ar/bridge/test_nav_lifecycle.py`, `dimos-ar/dimos/ar/adapters/go2.py` (and `g1.py` for parity if e-stop can block), optionally `dimos-ar/dimos/ar/network/error_codes.py` (508 description).

**Test plan after implementation.**

- Unit: slow `adapter.cancel_goal` (sleep 2 s) → not degraded, no 508 in `nav_status`.
- Adapter: mock blocking `_go2_connection.publish_request` → `emergency_stop()` returns quickly; WebRTC runs in background.
- Hardware: cancel + e-stop during stuck replan → planner idle, Lens stays navigable, no 508.
