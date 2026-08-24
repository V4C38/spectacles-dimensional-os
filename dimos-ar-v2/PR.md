# Upstream DimOS PR — goal observation tap

This document records a small upstream change to DimOS. **No PR is filed in the
v2 learning phase.** File it when ARModule needs universal goal observation or
when agent/patrolling modules are added to the `unitree_go2_ar` blueprint.

## Problem

`GlobalPlanner.handle_goal_request` is the single funnel for every navigation
goal in DimOS:

- `goal_request` stream (WebSocket server, other modules)
- `target` stream
- `clicked_point` stream (via `MovementManager.goal`)
- `set_goal` RPC (`ReplanningAStarPlanner.set_goal` → `handle_goal_request`)

Nothing observable is emitted when a goal is accepted. `_current_goal` is
private behind a lock inside `GlobalPlanner`. `get_state()` returns only the
`NavigationState` enum (`IDLE`, `FOLLOWING_PATH`, `RECOVERY`) — not the goal
pose.

Any UI or ARModule that wants to **relay observed goals** (regardless of source)
has no clean hook today.

### Evidence

```python
# dimos/navigation/replanning_a_star/global_planner.py
def handle_goal_request(self, goal: PoseStamped) -> None:
    logger.info("Got new goal", goal=str(goal))
    with self._lock:
        self._current_goal = goal
        self._goal_reached = False
    self._replan_limiter.reset()
    self._plan_path()
```

```python
# dimos/navigation/replanning_a_star/module.py — wired inputs only
self.goal_request.subscribe(self._planner.handle_goal_request)
self.target.subscribe(self._planner.handle_goal_request)
```

`navigation_state: Out[String]` is declared on `ReplanningAStarPlanner` but
**never published** anywhere in DimOS (`# TODO: set it` in module.py). The v1
package subscribed to it in `navigation/nav_state.py` — that code never ran.

## Proposed change (~6 lines)

Follow the existing pattern used for `path` and `goal_reached`.

### 1. `GlobalPlanner` (`global_planner.py`)

Add a subject:

```python
goal_accepted: Subject[PoseStamped] = Subject()
```

Emit in `handle_goal_request`, after storing the goal:

```python
self.goal_accepted.on_next(goal)
```

### 2. `ReplanningAStarPlanner` (`module.py`)

Declare output port:

```python
goal_active: Out[PoseStamped]
```

Wire in `start()`:

```python
self.register_disposable(
    self._planner.goal_accepted.subscribe(self.goal_active.publish)
)
```

## Why this shape

- **Single choke point** — every goal path funnels through `handle_goal_request`,
  so one emit covers streams and RPC.
- **Matches existing exports** — same Subject → Out wiring as `path` and
  `goal_reached`.
- **Useful beyond AR** — any DimOS UI or logger that wants “goal accepted” gets
  it without subscribing to three input streams and guessing which fired.

## What ARModule does until this lands

Client overlay uses **`nav_goal`** (route + terminal pose) and **`pose`**
(robot). **`goal_reached`** drives `state.nav.outcome` for any navigation.
ARModule reads terminal position and orientation from the last pose on the DimOS
path (via `smooth_resample_path` / `_add_orientations_to_path` in
`dimos/mapping/occupancy/path_resampling.py`). ARModule does not subscribe to
planner input streams or record goal source.

`goal_active` remains useful if a future UI needs the accepted goal pose on the
DimOS bus (including `set_goal` RPC) without inferring it from `path`.

### Blind spot (observers only, not overlay)

Direct `set_goal` RPC calls bypass all streams. Known callers in DimOS:

- `agents/skills/navigation.py`
- `navigation/patrolling/module.py`
- `navigation/bbox_navigation.py`
- `navigation/frontier_exploration/`
- `robot/unitree/unitree_skill_container.py`

**None of these are composed in `unitree_go2_ar` today.** The RPC path still
plans and publishes `path`; only observers that need the accepted goal pose on a
stream would miss it until this PR lands.

### Nav status today

- **`nav_goal`** — outbound frame; `pose` terminal `[x, y, z, yaw]` plus `path_poses`
- **`goal_reached`** — terminal success/failure for any navigation
- **`state.nav.state`** — `following_path` / `resolved` / `idle` (`recovery` is
  not on the wire: DimOS declares `navigation_state` but never publishes it)

```python
# global_planner.py cancel_goal
self.path.on_next(Path())
if not but_will_try_again:
    self.goal_reached.on_next(Bool(arrived))
```

## PR description draft

**Title:** Add `goal_active` output to ReplanningAStarPlanner

**Summary:** Expose accepted navigation goals on a new `goal_active: Out[PoseStamped]`
port, emitted from `GlobalPlanner.handle_goal_request`. Enables observers (UIs,
bridges) to see goals regardless of whether they arrived via stream or RPC.

**Note:** `navigation_state: Out[String]` is declared but never published; consider
either wiring it or removing the port in a follow-up.

## After merge

Optional: subscribe to `goal_active` if ARModule needs to observe DimOS-originated
goals on a stream. Overlay clients can keep using `path` and `pose`.
