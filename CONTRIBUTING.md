# Contributing — Spectacles Lens Studio

Open the project from [`lens-studio/spectacles-dimensional-os.esproj`](lens-studio/spectacles-dimensional-os.esproj), not the repo root.

## Scene wiring

Wire cross-tree references on [`ARBridgeServices`](lens-studio/Assets/Scripts/App/ARBridgeServices.ts) (`bridgeSession`, `frameCaptureController`, `robotMarker`, `pointCloudRenderer`, `navigationMarkerPrefab`, `assistClearanceDiscPrefab`). Point `ARBridgeCoordinator` at `ARBridgeServices`; point `RegistrationWizard` and `UIManager` at `ARBridgeCoordinator`. On `UIManager`, also wire `mainUIFrame` and `registrationWizard`.

Do **not** edit `.scene` files by hand. Use the Lens Studio MCP tools for scene-object investigation and manipulation.

## App-layer naming (`lens-studio/Assets/Scripts/App/`)

Same suffix = same role across feature modules.

| Suffix | Role |
|--------|------|
| **`*Presenter`** | Domain/app state → scene visuals (prefab lifecycle, drives views/renderers) |
| **`*Flow`** | Multi-step wizard lifecycle (`RegistrationFlow`) |
| **`*Placement`** / feature **`*Controller`** | Ongoing feature shell: state machine, bridge I/O (`NavigationPlacement`) |
| **`*View`** / **`*UiView`** | HUD or prefab visual binding; no domain logic |
| **`*Renderer`** | World drawing (lines, point clouds) |
| **`*Controller`** (input) | User input only (`SurfacePlacementController`) |
| **`App/Utilities/`** | Cross-cutting helpers (`AnimationUtilities`, `Utilities.ts`) |

Wiring (no renames): [`ARBridgeServices.ts`](lens-studio/Assets/Scripts/App/ARBridgeServices.ts) = composition root; [`ARBridgeCoordinator.ts`](lens-studio/Assets/Scripts/App/ARBridgeCoordinator.ts) = phase orchestration.

## Protocol changes

When the WebSocket contract changes, update in the same change:

- `dimos-ar/dimos/ar/network/protocol.py`
- `dimos-ar/PROTOCOL.md`
- `lens-studio/Assets/Scripts/ARBridge/Network/Protocol.ts`

## Tests

```bash
cd lens-studio/Tests && npm test
```

Bridge tests run from the DimOS `.venv` under `dimos-ar/`.
