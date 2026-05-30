# Spectacles Lens — spectacles-unitree

Open **`spectacles-unitree.esproj`** in this folder (not the repo root).

## Quick links

| Doc | Contents |
|-----|----------|
| [docs/SCENE_SETUP.md](docs/SCENE_SETUP.md) | Scene hierarchy and `@input` wiring |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Common marker / tracking issues |
| [../dimos-ar/docs/LENS_DEVELOPMENT.md](../dimos-ar/docs/LENS_DEVELOPMENT.md) | Architecture, UI patterns, MCP |

## Scripts

```text
Assets/Scripts/
├── AppState.ts              # minimal app/runtime state model
├── DimosManager.ts          # public facade/orchestrator (on DimOS scene object)
├── Setup/
│   ├── SetupWizard.ts
│   ├── WizardConnectionController.ts
│   └── CalibrationPresenter.ts
├── UI/
│   ├── UIManager.ts
│   ├── HUD/
│   └── Shared/
├── Network/                 # BridgeClient, Protocol
├── Alignment/               # AlignmentController, ManualAlignmentController
├── Navigation/              # NavigationController, PlacementController
├── Rendering/               # LidarPointCloud, RobotMarker
```

Scene root object **RobotManager** hosts bridge/render children; **DimosManager** is the script component on the **DimOS** child object.

## Packages

Pinned under `Packages/` (SIK, SpectaclesUIKit, Utilities). `icon.png` for Lens publishing — add when ready.

## Dev tools

- `tools/create_debug_gizmo.py` — optional scene debug helper
- For Lens Studio verification, prefer the normal compile path first. Do not
  run compile-with-logs unless a compile/runtime error has already occurred and
  you need detailed diagnostics.
