# Lens development — Spectacles client

Read the repository root `README.md`, `ARCHITECTURE.md`, and `PROTOCOL.md`
first. This document covers **Spectacles-specific** Lens Studio work. It does
not belong in `dimos_ar/` Python code.

## Where the Lens lives

The Spectacles Lens Studio project lives in **`lens-studio/`** at the monorepo
root (sibling of this `dimos-ar/` folder):

| Path | Role |
|------|------|
| [`dimos-ar/`](.) | DimOS extension: `ARBridge`, WebSocket protocol, setup + marker tooling |
| [`lens-studio/`](../lens-studio/) | Lens Studio project (`spectacles-unitree.esproj`) |

The Python side stays platform-agnostic; Spectacles code stays under
`lens-studio/`. The **contract** is [`PROTOCOL.md`](PROTOCOL.md) — implement
that on the Lens; do not add Spectacles logic to `dimos_ar/`.

```text
Mac (dimos-ar blueprint)
    |  ws://host:8765  JSON protocol
lens-studio/ Lens
    |  world-anchored rendering, ArUco registration, navigation UI
User wearing Spectacles
```

For day-to-day bridge work, use `./start.sh --replay` plus the integration test
suite in `dimos-ar` before moving to device validation. Use the Lens when testing
world anchoring, device performance, or Spectacles-only APIs (SIK, UIKit, ASR, etc.).

## Reference sample: Agent Center

The primary UI reference is Snap's **[Agent Center](https://github.com/specs-devs/samples/tree/main/Agent%20Center)** sample (`specs-devs/samples`). It demonstrates production-grade **runtime-instantiated** Spectacles UI — no prefab-heavy menus wired only in the editor.

Key files to study (in order):

| File | Why |
|------|-----|
| [`UIManager.ts`](https://github.com/specs-devs/samples/blob/main/Agent%20Center/Assets/Scripts/UI/UIManager.ts) | Orchestrates all UI; creates scene objects and components in code |
| [`AgentManagerController.ts`](https://github.com/specs-devs/samples/blob/main/Agent%20Center/Assets/Scripts/AgentManagerController.ts) | Entry point; wires store, services, and `UIManager` — **not** individual widgets |
| [`AgentStore.ts`](https://github.com/specs-devs/samples/blob/main/Agent%20Center/Assets/Scripts/State/AgentStore.ts) | Central reactive state |
| [`UI/Shared/DirtyComponent.ts`](https://github.com/specs-devs/samples/blob/main/Agent%20Center/Assets/Scripts/UI/Shared/DirtyComponent.ts) | Deferred layout/state updates |
| [`UI/Shared/UIBuilders.ts`](https://github.com/specs-devs/samples/blob/main/Agent%20Center/Assets/Scripts/UI/Shared/UIBuilders.ts) | Factory helpers for buttons, text, scroll bars |
| [`UI/Shared/UIConstants.ts`](https://github.com/specs-devs/samples/blob/main/Agent%20Center/Assets/Scripts/UI/Shared/UIConstants.ts) | Layout and color constants |

Agent Center is **not** a drop-in dependency for dimos-ar. Copy **patterns**, not
the whole app. Our Lens needs WebSocket + lidar rendering, not Supabase or agent
CLI bridges.

## Architecture pattern: DimosManager → SetupWizard / UIManager (Reachy-style)

This Lens follows [spectacles-reachy-mini](https://github.com/V4C38/spectacles-reachy-mini):
`DimosManager` orchestrates rendering; `SetupWizard` and `UIManager` handle UX;
`BridgeClient` speaks `PROTOCOL.md`.

```text
DimosManager (@component on DimOS scene object)
    ├── SetupWizard / UIManager   (wizard + HUD; runtime UI via UIBuilders)
    ├── BridgeClient              (WebSocket; onHello/onLidar/onPose event arrays)
    ├── AlignmentController       (marker tracking during Calibrate step)
    └── LidarPointCloud / RobotMarker
```

**DimosManager** (`ReachyMiniManager` analogue):

- Top-level orchestrator after the setup wizard completes.
- Subscribes to `BridgeClient` events; forwards lidar/pose to render components.
- Does **not** embed WebSocket parsing — that stays in `BridgeClient`.

**BridgeClient** (state + transport):

- Holds connection state, parses inbound JSON, exposes typed event arrays
  (`onHello`, `onLidar`, `onPose`, `onBridgeStatus`, …).
- UI and rendering subscribe here instead of a separate `DimosStore` class.
  A dedicated store module is optional if state complexity grows.

**UIManager** ([Agent Center `UIManager.ts`](https://github.com/specs-devs/samples/blob/main/Agent%20Center/Assets/Scripts/UI/UIManager.ts)):

- Hybrid model:
  - `SetupWizard` inner content stays runtime-instantiated via `UI/Shared/UIBuilders.ts`
  - `MainUI` title/status/top-row controls plus the mode-based submenu are authored scene objects under the `MainUI` frame
  - the Manual / Agent selector is part of the runtime app state boundary, not just local HUD presentation
  - robot-local menu `Frame`, 3D toggle, and dedicated manual-placement handle are authored under `RobotMarkerRoot`
- Outer frames (`SetupWizard`, `MainUI`) are scene-placed UIKit Frame objects.
  - the live scene currently binds its wizard logic to `Assets/Scripts/Setup/SetupWizard.ts`

Scene object **RobotManager** is the hierarchy root in `Scene.scene`; the
**DimosManager** script lives on the **DimOS** child object — see
`lens-studio/docs/SCENE_SETUP.md`.

Agent Center runtime UI example:

```typescript
const panelObj = global.scene.createSceneObject("AgentManagerPanel");
panelObj.setParent(root);
this.agentManagerPanel = panelObj.createComponent(
  AgentManagerPanel.getTypeName(),
) as AgentManagerPanel;
```

Panel toggle logic lives in `UIManager`, not the controller:

```typescript
this.handDockedMenu.onMenuButtonTapped.add(() => {
  if (this.agentManagerPanel.isShowing()) {
    this.agentManagerPanel.hide();
    this.handDockedMenu.setPanelActive(false);
  } else {
    this.agentManagerPanel.show();
    this.handDockedMenu.setPanelActive(true);
  }
});
```

For dimos-ar, mirror this: connection status / calibration UI in `UIManager`;
WebSocket parse logic in a service; frame alignment math stays on the Mac.
The current alignment flow is session-based: the Lens opens `align_start`,
streams either `align_marker` or `align_manual_pose`, and finalizes with
`align_commit`.

## Runtime UI fundamentals

### 1. Instantiate in code, not only in the Scene panel

Spectacles UIKit and SIK components are designed to be created at runtime:

1. `global.scene.createSceneObject(name)` — new node.
2. `obj.setParent(parent)` — hierarchy under a stable `root` (usually the
   controller's scene object or a dedicated `UI_Root`).
3. `obj.createComponent("Component.Text")` or
   `obj.createComponent(RectangleButton.getTypeName())` — attach behavior.
4. Call `.initialize()` on UIKit components **after** properties are set (see
   `UIBuilders.createIconButton`).

Use **prefabs** only for assets that are expensive or artist-authored (robot
mesh, particle effects). Agent Center still uses `requireAsset(...)` for SFX and
shader prefabs, but the **layout tree** is code-driven.

### 2. Factory helpers (`UIBuilders`)

Do not duplicate `createSceneObject` + `createComponent` + default sizing in
every file. Centralize in `UI/Shared/UIBuilders.ts`-style modules:

- `createText`, `createIconButton`, `createSettingsTile`
- Shared typography via `TextSizes.ts` / `styleText`
- Shared colors and spacing via `UIConstants.ts`

This keeps panel code readable and makes Cursor/MCP-assisted edits safer (one
place to fix button sizing).

### 3. Deferred updates (`DirtyComponent`)

UI that reacts to streaming data (lidar Hz, pose updates) must not relayout on
every message. Agent Center's `DirtyComponent` coalesces work:

- Subclasses call `markDirty(LAYOUT_DIRTY | STATE_DIRTY)`.
- A single lazy `UpdateEvent` runs `onFlush(flags)` once per frame when needed.
- Optional `setTracking(true)` for continuous per-frame follow (e.g. robot
  marker tracking camera).

Use this for point-cloud mesh updates and HUD stats — not for WebSocket I/O.

### 4. Overlay render layer

Notifications and HUD elements that must draw on top use a **child camera** on a
unique layer ([`UIManager.ts` overlay setup](https://github.com/specs-devs/samples/blob/main/Agent%20Center/Assets/Scripts/UI/UIManager.ts)):

- `LayerSet.makeUnique()` for overlay content.
- Child `Camera` parented to the main world camera, same `renderTarget`, higher
  `renderOrder`, `enableClearDepth = true`, `enableClearColor = false`.

Use the same pattern for connection warnings or calibration prompts so they are
never occluded by world-space lidar geometry.

### 5. Event wiring conventions

- **Store → UI:** store events update model; UI components `markDirty` or swap
  visible state.
- **UI → Store/Controller:** buttons emit on component events; controller or
  store methods handle side effects (e.g. send `register` JSON).
- **UI ↔ UI:** coordinate inside `UIManager` (input bar hides agent button bar,
  settings tab toggles input mode) — avoids spaghetti in the controller.

### 6. Packages to expect

Agent Center relies on (install from Lens Studio Asset Library as `.lspkg`):

- **SpectaclesInteractionKit (SIK)** — interactables, hand input, animation utils.
- **SpectaclesUIKit** — `RectangleButton`, `ScrollWindow`, `Tooltip`, etc.

Import paths look like:

```typescript
import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton";
import { setTimeout } from "SpectaclesInteractionKit.lspkg/Utils/FunctionTimingUtils";
```

Pin package versions in the Lens project; document upgrades in
`lens-studio/` when SIK/UIKit APIs shift.

## Protocol implementation on the Lens

Implement the same message types documented in [`PROTOCOL.md`](PROTOCOL.md):

| Direction | Messages |
|-----------|----------|
| Inbound (Lens → Mac) | `register`, `get_status`, `align_start`, `align_marker`, `align_manual_pose`, `align_commit`, `align_stop`, `nav_goal`, `cancel_goal`, `emergency_stop` |
| Outbound (Mac → Lens) | `hello`, `bridge_status`, `lidar`, `pose`, `registered`, `align_status`, `path`, `nav_status` |

Rules:

- Connect to `ws://<mac-lan-ip>:8765` (server is always the Mac).
- Parse `hello` first; gate UI on `capabilities`.
- Read `bridge_status` (pushed after `hello`) for robot model, live vs replay, and
  stream health; call `get_status` via `BridgeClient.requestStatus()` to refresh.
- Ignore unknown message types and fields (forward-compatible).
- Send `robot_id: "go2"` unless configured otherwise.
- Alignment: use the shared `align_*` session flow whenever the bridge is
  connected. Auto alignment streams `align_marker`; connected manual alignment
  submits `align_manual_pose` and finalizes with `align_commit`.
- Offline/manual fallback: if the bridge is not connected, the Lens still
  supports Reachy-style mock placement. Spawn the robot-local marker once below
  the setup wizard panel, let the user grab the dedicated
  `RobotPlacementHandle` to place `RobotMarkerRoot` on the robot, and preserve
  that local pose until live bridge pose data arrives.

WebSocket has **no authentication** today — use only on trusted LANs (see
`ARCHITECTURE.md`).

## Suggested `lens-studio/` layout

```text
lens-studio/
├── spectacles-unitree.esproj
├── Assets/
│   ├── Scene.scene              # minimal root; controller component attached
│   ├── Visuals/                 # textures, materials, marker images
│   │   └── aruco_marker.png
│   └── Scripts/
│       ├── DimosManager.ts      # orchestrator (@component on DimOS object)
│       ├── SetupWizard.ts       # 3-step setup wizard (@component)
│       ├── UIManager.ts         # runtime UI (@component)
│       ├── Network/
│       │   ├── BridgeClient.ts  # WebSocket + event arrays (@component)
│       │   └── Protocol.ts      # mirror docs/PROTOCOL.md
│       ├── Alignment/
│       │   └── AlignmentController.ts  # MarkerTracking + WS alignment
│       ├── Rendering/
│       │   ├── LidarPointCloud.ts
│       │   └── RobotMarker.ts
│       └── UI/
│           └── Shared/
│               ├── DirtyComponent.ts
│               ├── UIBuilders.ts
│               └── UIConstants.ts
└── Packages/                    # SIK, UIKit .lspkg
```

Keep `Cache/` out of git (Lens Studio generated output).

## Runtime instantiation vs scene-wired `@input` — when to use which

Two patterns exist in production Spectacles Lenses:

**Pattern A — Scene-wired `@input` (Reachy Mini style)**
Every UI element is a pre-built SceneObject in Lens Studio's scene hierarchy.
Scripts reference them via `@input` decorators; the Inspector wires them.

For this project, the outer `SetupWizard` / `MainUI` containers are UIKit
`Frame` scene objects, but world-space placement should still be derived from a
one-shot sampled transform. Do not keep robot placement tethered to a
follow-enabled Frame after the initial spawn under the wizard.

**Pattern B — Runtime instantiation (Agent Center style)**
UI is built in code: `global.scene.createSceneObject()` + `createComponent()`.
Plain TypeScript classes (not `@component`) take a `parent: SceneObject` in their
constructor and build their subtree. Factory functions (`createText`,
`createIconButton`) abstract common boilerplate. Assets are loaded via top-level
`requireAsset()` instead of `@input`.

### Key differences

- **Git-friendliness**: Pattern B wins. UI layout lives in `.ts` files that
  diff/merge cleanly. Pattern A buries layout in binary `.scene` files that
  produce opaque merge conflicts.
- **Visual preview**: Pattern A wins. You see your UI in Lens Studio's viewport
  immediately. Pattern B requires running the Lens to see anything.
- **Iteration speed**: Pattern A is faster for very simple, static layouts (a few
  buttons). Pattern B is faster once the UI grows beyond ~5-10 elements, because
  adding a new element is a code change vs. a manual create → position → wire →
  name cycle in the Inspector.
- **Refactoring**: Pattern B wins. Renaming, reordering, or restructuring is a
  code change with type checking. Pattern A requires editing the scene AND the
  code, plus re-wiring `@input` references that silently break.
- **Reusability**: Pattern B wins via factory functions. Pattern A requires
  copy-pasting scene hierarchies.
- **Designer access**: Pattern A wins if a non-programmer needs to tweak layouts.
  Not applicable for dimos-ar.

### What to use in lens-studio

Use a **hybrid** of Pattern A and Pattern B:

**Keep runtime instantiation (Pattern B) for:**
- `SetupWizard` steps and their inner content
- temporary / future workflow UI that is easier to iterate in code

**Use scene-authored objects (Pattern A) for:**
- `MainUI` title/status/restart/debug/emergency-stop objects
- the mode-based submenu frame, Manual/Agent toggles, and Manual-mode execute toggle
- the robot-local `Frame`, text/buttons, and dedicated placement handle under `RobotMarkerRoot`
- the Reachy-style 3D sphere toggle under `RobotMarkerRoot`

This means `SetupWizard.ts` still builds its own UI tree in `onAwake()`, but
`UIManager.ts` now binds the authored HUD objects by scene name instead of
creating them at runtime. Likewise, `RobotMenuView.ts` binds the authored robot
menu subtree instead of creating it with `global.scene.createSceneObject()`.

**Use `@input` scene references only for top-level anchors and things that must exist in the scene:**
- `MarkerTrackingComponent` (Image Tracking object — requires scene-level setup)
- `InternetModule` (platform service)
- `Camera` references
- frame roots like `MainUI`
- 3D assets such as the robot marker root / Reachy toggle sphere
- Audio assets that cannot use `requireAsset`

**Use `requireAsset()` at module scope for static assets:**
- Textures (icons, marker images)
- Materials
- Audio tracks
- Prefabs

**Use `require("LensStudio:...")` for native Spectacles modules:**
- `WorldQueryModule`
- `GestureModule`
- other built-in `*Module` APIs

Do not expose those as Inspector asset inputs. The navigation implementation
resolves them directly in code.

Example — wizard text creation with factory vs `@input`:

```typescript
// Pattern A (Reachy-style) — requires manual scene wiring
@input private textStepStatus: Text | null = null;
// 10+ @input lines, each wired in Inspector

// Pattern B (Agent Center-style) — self-contained
private statusText: Text;

onAwake() {
  this.statusText = createText({
    parent: this.getSceneObject(),
    name: "StepStatus",
    text: "",
    size: TextSize.M,
    position: new vec3(0, -8, Z_CONTENT),
  });
}
```

### Shared UI utilities to create

Adapt from Agent Center (do NOT copy the entire `UI/Shared/` directory —
cherry-pick what we need):

- **`UIBuilders.ts`**: `createText()`, `createIconButton()`, `createImage()` —
  same signatures as Agent Center, simplified for our needs.
- **`UIConstants.ts`**: Panel width, padding, Z offsets, status colors. Load
  textures via `requireAsset()`.
- **`DirtyComponent.ts`**: Copy directly — the deferred dirty-flag pattern is
  useful for lidar rendering.
- **`UIAnimations.ts`**: `scaleIn`/`scaleOut` for panel show/hide. Skip the
  wipe transitions (Agent Center's are for multi-panel navigation we don't need
  yet).

### The `@component` boundary

Top-level scripts that attach to scene objects remain `@component` classes:
`DimosManager`, `SetupWizard`, `UIManager`, `BridgeClient`,
`AlignmentController`. These are the scene-entry points.

Sub-views built inside these components can be **plain classes** (like Agent
Center's `AuthView`, `AgentsEmptyView`, `TabBar`). They take a parent
SceneObject in their constructor and build their UI tree. This reduces the
number of scene objects that need manual setup.

```typescript
// Plain class — no @component, no scene wiring needed
export class WizardStepView {
  readonly sceneObject: SceneObject;
  private titleText: Text;
  private statusText: Text;

  constructor(parent: SceneObject, title: string) {
    this.sceneObject = global.scene.createSceneObject("WizardStep");
    this.sceneObject.setParent(parent);
    // ... build UI tree with createText(), createIconButton(), etc.
  }
}
```

## Using MCP in Cursor (vs VS Code)

If you have used MCP in VS Code (Blender, Roblox, etc.), the concepts are the
same — only the config file location and UI differ slightly.

### Same everywhere

| Concept | Meaning |
|---------|---------|
| **MCP server** | A program that exposes **tools** (actions), **resources** (read-only data), and sometimes **prompts** |
| **Transport** | How the IDE talks to the server: **stdio** (spawn a local process) or **HTTP** (connect to a URL) |
| **Agent / Chat** | The model decides when to call MCP tools based on your request |

Lens Studio uses **HTTP** transport (localhost URL + Bearer token). Blender and
Roblox in VS Code often use **stdio** (a command like `npx …` or a local binary).
The JSON shape differs; Cursor’s HTTP config is just `url` + `headers`.

### Lens Studio config: Snap format → Cursor format

Lens Studio **Copy MCP Config** gives Snap’s format:

```json
{
  "servers": {
    "lens-studio": {
      "type": "http",
      "url": "http://localhost:8732/mcp",
      "headers": { "Authorization": "Bearer …" }
    }
  }
}
```

**Cursor** expects `mcpServers` (not `servers`) and omits `type` when using `url`:

```json
{
  "mcpServers": {
    "lens-studio": {
      "url": "http://localhost:8732/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      }
    }
  }
}
```

Use **one** config location — **`~/.cursor/mcp.json` (global)** so Lens Studio MCP
works in every project. Do **not** also add `lens-studio/.cursor/mcp.json`;
Cursor merges workspace roots and you will see **two** `lens-studio` entries.

Copy the `lens-studio` block from `lens-studio/.cursor/mcp.json.example`
into your existing global `mcpServers` object (merge with other servers like
`context7`).

### Step-by-step in Cursor

1. **Start Lens Studio** and open `lens-studio/spectacles-unitree.esproj`.
2. **Start MCP in Lens Studio:** menu **AI Assistant → AI Model Context Protocol (MCP) → Configure Server → Start Server**.
3. **Copy MCP Config** (token + port).
4. **Edit global config:** `~/.cursor/mcp.json` — add or update the `lens-studio`
   entry only (no project-level `.cursor/mcp.json` in `lens-studio/`).
5. **Enable the server:** **Cursor Settings → Tools & MCP** (or command palette
   → “MCP”). You should see **one** `lens-studio`. Toggle it **on** if disabled.
6. **Reload if needed:** if tools do not appear, run **Developer: Reload Window**
   from the command palette once after editing `mcp.json`.
8. **Use Agent mode** (not plain Ask): MCP tools are available to the Agent when
   it plans edits. Example prompts:
   - “What objects are in my Lens Studio scene?”
   - “Add a script component to the selected object”
   - “Search the Asset Library for Spectacles UIKit”

### VS Code habits → Cursor equivalents

| VS Code | Cursor |
|---------|--------|
| MCP extension + `settings.json` or extension UI | **Tools & MCP** settings or `.cursor/mcp.json` |
| GitHub Copilot Chat + MCP | **Cursor Agent** (Chat with Agent enabled) |
| Workspace vs user scope | **Project:** `.cursor/mcp.json` in repo root; **global:** `~/.cursor/mcp.json` |
| stdio server: `"command": "…", "args": [...]` | Same under `mcpServers.<name>` in `mcp.json` |

Project config wins over global when both define the same server name.

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| `lens-studio` not listed | Confirm `lens-studio` is in `~/.cursor/mcp.json` |
| **Two `lens-studio` servers** | Remove `lens-studio/.cursor/mcp.json`; keep global config only |
| Server listed but red / disconnected | Lens Studio not running, or MCP server stopped — click **Start Server** again |
| **`Unsupported protocol version` (-32602)** | **Known issue:** Cursor sends MCP `2025-11-25`; older Lens Studio builds only accept `2025-06-18` and reject negotiation. **Update Lens Studio to 5.17.2+** (Snap shipped a fix for protocol negotiation). Then restart MCP, recopy config, reload Cursor. See verification below. |
| 401 / auth errors | Token expired after Lens Studio restart — **Copy MCP Config** again and update `mcp.json` |
| Tools never used | Use **Agent** mode; ask explicitly (“use Lens Studio MCP to list scene objects”) |
| Wrong port | URL port must match Lens Studio MCP dialog (often `8732`, can change) |

**Verify Lens Studio MCP is running** (independent of Cursor):

```bash
curl -s -X POST "http://localhost:8732/mcp" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}'
```

- **Success:** JSON with `"serverInfo": { "name": "Lens Studio MCP Server" }` — Lens side is fine; if Cursor still fails, it is a client protocol mismatch → update Lens Studio.
- **Connection refused:** MCP server not started in Lens Studio.
- **`Unsupported protocol version` with `2025-06-18`:** Very old Lens Studio build — update from [ar.snap.com/download](https://ar.snap.com/download).

Related: [Snap/Lens Studio MCP protocol fix discussion](https://github.com/anthropics/claude-code/issues/17169) (Snap released patches 5.17.2 / 5.15.3 for negotiation).

**Security:** Bearer tokens are secrets. Do not commit tokens. Global
`~/.cursor/mcp.json` is outside git; the repo only tracks
`lens-studio/.cursor/mcp.json.example` with a placeholder.

Official Snap guide: [Developer Mode with Cursor IDE](https://developers.snap.com/lens-studio/features/lens-studio-ai/developer-mode-with-cursor).

## Lens Studio MCP server (reference)

Snap ships a **built-in MCP server inside Lens Studio** — not a separate npm
package. It exposes tools so an external agent can inspect and modify the open
project (scene objects, components, Asset Library search, script generation).

**Start the server (Lens Studio):**

1. **AI Assistant → AI Model Context Protocol (MCP) → Configure Server**
2. Click **Start Server**
3. Click **Copy MCP Config** (HTTP URL + Bearer token)

See **Using MCP in Cursor** above for full Cursor setup. **Lens Studio must stay
open** with the MCP server running while you use Agent in Cursor.

**Notes:**

- Token and port change when you restart the MCP server — recopy config.
- Requires **Chat Tool Package** from the Asset Library (see Snap docs).
- Useful prompts: scene inspection, create objects, add components, search Asset
  Library, generate TypeScript scripts.
- MCP complements but does not replace reading Agent Center patterns for UI
  architecture.

## Development workflow

1. **Bridge + protocol:** run `blueprints/go2_ar.py` with replay; verify
   with `pytest tests/test_ws_integration.py -m integration`.
2. **Lens networking:** implement `WebSocketClient` + `Protocol.ts`; log
   `hello` / `lidar` / `pose` before any rendering.
3. **World rendering:** point cloud + robot marker using world-frame coordinates
   (already transformed by the Mac).
4. **Calibration:** ArUco detection → `register` message → confirm `registered`.
5. **Device test:** deploy to Spectacles; Mac and glasses on same Wi‑Fi; use Mac
   LAN IP in the Lens (not `127.0.0.1`).

Do not port Agent Center's Supabase/bridge/agent features — they are unrelated to dimos-ar.

## Validation order

When validating features, keep the order strict:

1. **Replay + integration test first**
   - run `blueprints/go2_ar.py`
   - confirm `hello` capabilities, `bridge_status`, `lidar`, `pose`, `path`, and `nav_status`
2. **Lens compile + scene wiring**
   - Lens compiles without TypeScript errors
   - `placementRayOrigin` is wired in the scene
   - native modules resolve through `require("LensStudio:...")`
3. **Setup + alignment**
   - auto alignment still completes through `align_start` -> `align_commit`
   - manual alignment submits `align_manual_pose` and commits through the same session
4. **Placement + rendering**
   - pin-drop mode shows a live preview
   - pinch confirms one goal
   - `execute=false` or no bridge connection still switches the marker into the local executing/cancel state for UI debugging, but does not send `nav_goal`
   - `execute=true` with bridge + calibration available sends `nav_goal`
5. **Robot-local controls**
   - robot menu follows the moving marker
   - approximate/manual status is visible there
   - both HUD and robot-local emergency-stop paths are exercised

## Lens Studio TypeScript gotchas

### `quat` constructor order — `(w, x, y, z)`

The Lens Studio `quat` constructor takes **(w, x, y, z)**, not `(x, y, z, w)`.
Source: [Lens Scripting API — quat](https://developers.snap.com/lens-studio/api/lens-scripting/classes/Built-In.quat)

```typescript
// Y-axis rotation (yaw) by angle θ:
//   w = cos(θ/2),  x = 0,  y = sin(θ/2),  z = 0
new quat(Math.cos(halfYaw), 0, Math.sin(halfYaw), 0)  // ✓ correct

new quat(0, Math.sin(halfYaw), 0, Math.cos(halfYaw))  // ✗ wrong — sets w=0 → 180° rotation
```

When converting a protocol quaternion from DimOS/ROS (`[x, y, z, w]` array), reorder explicitly:
```typescript
const rotation = new quat(q[3], q[0], q[1], q[2]);  // w=q[3], x=q[0], y=q[1], z=q[2]
```

## Framerate and performance

Agent Center uses `FramerateManager` (30 fps idle, 60 fps when animating). For
lidar:

- Cap mesh updates to ~10 Hz to match the bridge (`lidar_max_hz` default).
- Subsample or bucket points on device if needed; the Mac already filters to
  ~1–3k points.
- Prefer `DirtyComponent` + dirty flags over per-point scene objects.

## Checklist before opening a PR (Lens side)

- [ ] No robot/DimOS imports in `dimos-ar` — protocol-only coupling
- [ ] `Protocol.ts` matches `docs/PROTOCOL.md`
- [ ] UI built via `UIManager` + shared builders (Agent Center pattern)
- [ ] WebSocket + registration tested against replay blueprint
- [ ] Tested on Spectacles hardware for world lock and performance
