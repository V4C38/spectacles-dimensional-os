# dimos-ar

`dimos-ar` is the bridge package in this monorepo that exposes a platform-agnostic
AR WebSocket interface on top of DimOS robot stacks. The Spectacles client that
implements the same contract lives in [`../lens-studio/`](../lens-studio/).

All platform-agnostic code is under `dimos/ar/`. The cross-platform API is
[`PROTOCOL.md`](PROTOCOL.md) (currently **v18**, port **8787**).

## Layout

| Path | Role |
|------|------|
| `dimos/ar/bridge/` | `ARBridge` composition root; telemetry, odom buffer, status, `MotionRouter`, safety |
| `dimos/ar/navigation/` | `NavigateGoalHandler`, world-frame goal transform |
| `dimos/ar/world_frame/` | Committed `WorldFrameState`, registry, runtime refinement |
| `dimos/ar/tag_tracking/` | Robot-mounted AprilTag detect + solve |
| `dimos/ar/registration/` | Setup wizard session (AprilTag + manual pose) |
| `dimos/ar/lidar/` | LiDAR height-band filtering for AR payloads |
| `dimos/ar/robot_profile/` | Per-robot handshake, tag geometry, capabilities (Go2, G1) |
| `dimos/ar/network/protocol.py` | Wire schema implementation |
| `dimos/ar/blueprints.py` | Monorepo entrypoint used by [`../launcher/scripts/start.sh`](../launcher/scripts/start.sh) |
| `assets/` | Printable AprilTag assets (see below) |

## AprilTag print assets

Per-tag files in [`assets/`](assets/):

| Tag ID | PNG | A4 PDF | Letter PDF |
|--------|-----|--------|------------|
| `0` | `apriltag_robot_0.png` | `apriltag_robot_0_a4.pdf` | `apriltag_robot_0_letter.pdf` |
| `1` | `apriltag_robot_1.png` | `apriltag_robot_1_a4.pdf` | `apriltag_robot_1_letter.pdf` |

Regenerate with:

```bash
cd dimos-ar
/path/to/dimos/.venv/bin/python3 scripts/generate_marker.py --ids 0 1
```

Mount geometry (`tag_id`, `size_m`, `position`, `orientation`) is configured per robot in `dimos/ar/robot_profile/go2.py` and `g1.py`.

<details>
<summary>Start</summary>

Use the DimOS `.venv`, then run from the monorepo root:

```bash
cd /path/to/spectacles-dimensional-os
./launcher/scripts/start.sh
```

`launcher/scripts/start.sh` prompts for the robot stack:

- `ar_go2` — Unitree Go2 (lightweight agentic)
- `ar_g1` — Unitree G1 via `unitree_g1_nav_simple` (pose goals; lightweight agentic)

Then starts the bridge. Wait for:

```text
Bridge ready — ws://0.0.0.0:8787
Spectacles: enter <your-mac-lan-ip> in the lens
```

Equivalent native DimOS commands (when blueprints are registered upstream):

```bash
dimos run ar-go2
dimos run ar-g1
```

Set `OPENAI_API_KEY` for agent mode on the lightweight stacks.

**Supported hardware** (see [main README](../README.md#prerequisites)):

- **Go2 pro/air** — primary development target; full navigation + AprilTag when onboard modules are available
- **G1** — supported in code, not field-tested; uses `unitree_g1_nav_simple` pose goals; needs Unitree DDS packages in the DimOS `.venv`

</details>

<details>
<summary>Runtime behavior</summary>

Handshake-driven — the Lens adapts to whatever the active robot profile advertises:

- `hello.robot` — display identity, body geometry, `tag_tracking_profile` (`tag_ids`, `tag_total_size_m`)
- `hello.capabilities` — flat map of feature availability + reasons
- `runtime_snapshot` — bridge + nav state + optional active path on connect / `get_status`
- World-frame goals via `nav_goal`; cancel with `cancel_nav_goal`
- Registration via `registration_command` (`april_tag` or `manual_pose`)

</details>

<details>
<summary>Registration</summary>

**AprilTag** — robot stays still; Spectacles user moves around the tag. Bridge auto-commits when the registration estimate is confident (or yaw is observable). Requires configured `TagMount` entries on the robot profile.

**Manual pose** — user places the robot marker in AR, streams `registration_pose`, sends `commit`. No camera frames consumed.

After commit, runtime drift correction continues from Spectacles camera frames via `WorldFrameRefiner` / `SimilarityAligner`. Corrections above the notification deadband (≥ 5 cm / ≥ 1°) emit `world_frame_correction`.

</details>

<details>
<summary>Tests</summary>

Run from the DimOS `.venv`:

```bash
cd /path/to/spectacles-dimensional-os/dimos-ar
/path/to/dimos/.venv/bin/python3 -m pytest
/path/to/dimos/.venv/bin/python3 -m ruff check .
/path/to/dimos/.venv/bin/python3 -m mypy dimos/ar
```

| Tier | Command | Requires |
|------|---------|----------|
| Unit | `pytest -m "not integration"` | DimOS `.venv` |
| Integration | `pytest dimos/ar/network/test_ws_integration.py -m integration` | Live bridge on :8787 |

Lens protocol tests: `cd ../lens-studio/Tests && npm test`.

Reproduce full CI from repo root: `./launcher/scripts/run-ci.sh`.

</details>

<details>
<summary>Protocol coupling</summary>

`PROTOCOL_VERSION = 18` in `dimos/ar/network/protocol.py`. If the wire contract changes, update together:

- `dimos/ar/network/protocol.py`
- `PROTOCOL.md`
- `../lens-studio/Assets/Scripts/ARBridge/Network/Protocol.ts`

</details>
