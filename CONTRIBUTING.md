# Contributing

## Start here

Use Python 3.12 and Node 22 (`nvm use`). Install Git LFS and ffmpeg/ffprobe. Follow the [README](README.md) for setup and choose the DimOS environment explicitly. Import installed DimOS; upstream changes belong in separate PRs.

## Ownership and structure

- `dimos-ar/dimos/ar/`: ARModule and platform-independent server collaborators; tests are colocated.
- `clients/core/src/`: portable ClientCore, consumed directly by WebXR and exported for Specs. Keep Lens/Three.js APIs out. Core tests live in `clients/core/tests/`.
- `clients/specs/Assets/Scripts/DimOSSpecsClient/`: Specs composition, input, and rendering. Keep tests outside Assets.
- `clients/webxr/src/`: WebXR composition, input, and rendering.
- `launcher/`: setup and owned-process lifecycle; profile calibration is independent of source selection.

Give each runtime concern one mutable owner. Expose facts through that owner and derive presentation; avoid mirrored lifecycle flags. Keep platform mechanisms in hosts. Use descriptive role names such as Controller, Presenter, View, and Renderer.

Group related helpers and classes in cohesive feature modules; a separate owner does not require a separate file. Name a class-owned file after its main class, or use the feature name for a multi-export module. Preserve independent instances, initialization order, and lifecycle boundaries when consolidating. Keep SDK-free geometry and resource helpers below platform views. Give Specs host modules distinct names from Core modules, and verify actual native startup after moves: TypeScript compilation and mocked host tests alone do not prove runtime import resolution. New script metadata must have unique defining metadata, asset-data, primary-asset and component IDs; checking only PrimaryAsset misses native importer collisions. Preserve every identity of existing assets.

Open Lens Studio from `clients/specs/spectacles-dimensional-os.esproj`. Manipulate scenes through Lens MCP, never hand edit them. Preserve asset metadata identities. The production Integration Test Harness must retain Auto Run false; native scenarios belong only in disposable editor projects.

The [protocol](dimos-ar/PROTOCOL.md) is canonical: update it, Python protocol, and Core protocol together when changing messages. DimOS owns hardware, planning, execution, and measured feedback; AR owns sessions, authority, coordinate conversion, and presentation. Keep native stop/feedback safeguards until tested upstream equivalents exist.

CI installs the exact source revision in `.dimos-revision`, rather than relying on package version metadata. Run the official mock manipulation contract before changing that baseline. Declare custom-model gripper joints explicitly; joint type alone does not identify a gripper.

## State and shared behavior

Keep observations recursively readonly, including tuple and array members. Owners may retain stable references; consumers copy only when they need mutable working data. Do not clone whole session views each frame or cast away readonly contracts.

ClientCore owns protocol/session facts, localization capture and submission, replicated authority, navigation intent, manipulation intent and shared presentation decisions. Hosts own SDK input, camera/media access, scene objects, materials and resource disposal. Native following tokens and collaboration leases are separate lifecycles; pending RPCs belong to the request ledger rather than mirrored flags in presentation.

Use shared spatial math, pose history and presentation projections instead of reimplementing them in each host. Keep units and coordinate conventions explicit at adapter boundaries. Optical world-basis transforms differ from object-pose basis changes. Preserve platform calibration and freshness policies as named inputs rather than hidden branches or copied algorithms.

Backend controllers own application policy; ARModule wires DimOS services and stream adapters. Native safety/admission checks remain at every trust boundary even when their pure validation primitives are shared. A timeout does not prove native work has stopped. Keep blocking hardware effects outside synchronized state transitions and fence completion by operation/source identity.

Launcher process sessions own their children, readiness and generated configuration. Async UI requests must check selection identity before publishing either success or failure. Shared blueprint/default metadata has one canonical source; frontend gating never replaces backend admission.

When extracting an owner, migrate its callers, teardown paths and test fixtures together. Prefer real owners with fake ports over partial objects populated through private fields. Cover valid overlapping lifecycles explicitly; a single phase enum must not erase independent safety, request, execution or presentation facts.

## Core package workflow

Edit Core only in `clients/core/src/`. Run `python3 clients/specs/tools/core_package.py sync` after changes to update `clients/specs/Packages/DimOSARClient.lspkg` through Lens Studio 5.15. Its authoring project lives outside the repo at `~/Library/Caches/dimos-clientcore-package/`. `check` verifies archive contents without an editor. Divergence fails Specs checks only; Core/WebXR continue testing raw source. Specs host tests consume extracted package code without a raw-source fallback.

## Validation

Follow [AGENTS.md](AGENTS.md#commit--pull-request-guidelines) for validation frequency and follow-up exceptions. Run `./launcher/scripts/run-ci.sh` once at the final checkpoint for the completed change set. It includes Python lint/type/unit checks, launcher checks, Core and Specs tests, WebXR tests/build, tooling tests, the official mock manipulation contract, and complete browser integration. Use an unrestricted terminal because DimOS logs outside the repository. Report the checks actually completed and any remaining limits.

For native changes, follow [native testing](clients/specs/tools/README.md). TypeScript compilation does not prove Preview rendering or scene wiring. Browser transport shims do not prove native Specs input. Keep evidence provenance intact and distinguish simulated results from physical tests. Restore production source, verify Auto Run false and no Review fixtures, and check compiler-cache correspondence before handing back for hardware validation.

## Pull requests

Describe the concrete problem and resulting behavior, link issues, report validation, and include images for visual changes. Keep changes organized by owning concern. Do not commit or push after a failed or unavailable gate unless explicitly authorized to skip it.
