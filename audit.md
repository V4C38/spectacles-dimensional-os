# Repository audit — second complete review

## Snapshot and outcome

This audit reviews the complete current working tree captured at **2026-11-10T20:15:34.241353+00:00**, based on commit `047de38c55a509300fd32885bb451c50ecd71932` plus existing uncommitted feedback and implementation. It supersedes the previous audit as the active review. The previous document is preserved locally at `Review Data/re-audit/previous-audit.md`. Findings and line references below describe this audit snapshot; subsequent fixes are distinguished in the implementation disposition section.

**Six module leads completed 54 actual separate specialist reviews covering all 930 inventoried paths.** No P1 finding was established. Three P2 items survived evaluation: an existing mode-admission defect, a launcher CSS regression introduced during cleanup, and contradictory advisory-IK protocol prose. A P3 credential persistence defect also deserves correction. The remaining accepted items are small simplifications, test maintenance, or narrowly scoped validation gaps. No broad new framework, arbitrary file split, or wholesale test deletion is justified.

The implementation materially improved ownership and removed obsolete mechanisms. This audit nevertheless caught a real CSS regression, demonstrating why the earlier passing JavaScript/unit gate was insufficient evidence for launcher styling. A newly discovered issue is not automatically an implementation regression: the mode-admission block is unchanged from HEAD; the CSS damage is visible in the implementation diff. No runtime speed or memory improvement is inferred from code size.

## Method, hierarchy and limits

Each module lead spawned nine separate specialists: architecture/systems design/SOLID; bloat and duplication; logical errors/races/cancellation; unused code and assets; test gaps and unnecessary/brittle tests; naming; `.cursorrules`/AGENTS adherence; large-file cohesion; and state-machine complexity. Specialists reported to their module lead; each lead evaluated, deduplicated, qualified or rejected claims before reporting to root. Root independently sampled important source paths and rejected unsupported interpretations.

The live runtime permitted four active agents including root. One lead ran at a time with at most two concurrent specialists, completing all nine before the next module. Exhaustive full-text reads were partitioned across reviewers; each specialist also inspected its focus across the production subsystem using explicitly bounded searches/caller reads. This is **union file coverage**, not a claim that every specialist fully read every line.

Coverage comprises **887 full-text dispositions, 37 binary metadata/header/reference dispositions, and 6 generated-structure dispositions**, with no uncovered inventory path. The entire 3274-line production scene was read statically; all 173 definitions are distinct and all 172 owned edges resolve locally. Actual harness `ScriptInputs.autoRun` is false; its `ScriptInputsDefault` flag is not the runtime value. Historical audit prose was read; its generated inventory was structurally reviewed. Binary classification does not establish visual/font/rendering quality, and dependency locks/model literals do not imply a semantic review of every transitive implementation or number.

The static audit ran no tests, installs, servers, browser integration, native compilation, Lens Studio/MCP/UI actions, commits or pushes. Existing test suites were read; prior passing results were treated as historical evidence. Root compared all 930 source SHA-256 hashes during the audit and found no changes. Only ignored review evidence was written until all leads completed. The user subsequently authorized worthwhile implementation, full CI including Specs native verification, and commit/push only after all required checks pass. That later phase is separate from static audit verification.

## Coverage by module

| Module | Paths | Specialists | Full text | Binary/reference | Generated structure |
|---|---:|---:|---:|---:|---:|
| ARModule | 153 | 9 | 153 | 0 | 0 |
| ClientCore | 177 | 9 | 177 | 0 | 0 |
| client-specs | 244 | 9 | 230 | 13 | 1 |
| client-webxr | 144 | 9 | 143 | 0 | 1 |
| Tooling | 177 | 9 | 165 | 8 | 4 |
| Documentation and assets | 35 | 9 | 19 | 16 | 0 |

## Evaluated priority list

P2 means a concrete defect/contract contradiction worth addressing in this change set. P3 marks lower-risk cleanup, clarity, or validation work. Confidence and minimal preservation checks appear in the module reports. Optional ideas are not implied to be broken functionality.

| ID | Priority | Classification | Recommendation |
|---|---|---|---|
| AR2-01 | P2 | Confirmed control-state defect | Validate manual/agent mode admission before native side effects and reconcile asynchronous retirement. |
| T1 | P2 | Confirmed implementation regression | Restore launcher CSS selector grammar and focus/hover states; verify in a real browser. |
| DOC2-01 | P2 | Confirmed protocol prose contradiction | Separate independent advisory samples from canonical target geometry. |
| T2 | P3 | Confirmed persistence defect | Reject unsupported credential record separators before environment or profile mutation. |
| AR2-02 | P3 | Cleanup | Remove impossible constructor fallback retained solely for a mock. |
| AR2-03 | P3 | Test maintenance | Use completion events instead of short scheduling sleeps. |
| CC-R2-01 | P3 | Unused data/test | Remove retired forearm envelope and its volume-only test. |
| CC-R2-02 | P3 | API cleanup | Remove ignored presentation parameters and update both hosts. |
| SP2-01 | P3 | State simplification | Derive connection activity from the retained attempt. |
| SP2-02 | P3 | Validation gap | Directly protect shared NativeTextField scrolling and teardown behavior. |
| SP2-03 | P3 | Test maintenance | Reuse the camera encoding fixture without deleting distinct assertions. |
| SP2-04 | P3 | Micro-cleanup | Drop unused HUD session-view read while preserving initialization checks. |
| WX-R1 | P3 | Unused API | Delete three small unused browser API surfaces. |
| WX-R2 | P3 | Validation gap | Protect stereo environment-depth binding and invalid-eye fallback. |
| T3 | P3 | Optional duplication proposal | Share repeated native probe root lookup/event envelopes only if a small helper removes real duplication. |
| T4 | P3 | Validation gap | Add an independent fixed projection oracle. |
| DOC2-02 | P3 | Documentation clarity | Scope navigation and manipulation stop-latch behavior explicitly. |
| DOC2-03 | P3 | Documentation consistency | Qualify successful non-golden recording retention. |
| DOC2-04 | P3 | Discoverability | Document either-palm wrist-menu support. |

The Core deferred-asset resource-contract tests and abnormal launcher-leader/surviving-worker ownership test are separately qualified validation opportunities. The latter does not justify killing arbitrary listeners or changing process ownership without establishing the installed runtime contract. Tiny redundant clear writes/velocity conversion can be removed with adjacent backend work.

## Implementation disposition

<!-- IMPLEMENTATION_DISPOSITION_START -->
After all six static audits completed, the user authorized implementation and conditional commit/push. The selected follow-up fixes are implemented before the final validation checkpoint:

| Findings | Disposition |
|---|---|
| AR2-01 | Implemented coordinator-owned preflight for both mode directions, positive-acknowledgement commit/caching, durable same-epoch completion, source-retirement compensation and pending/uncertain admission fences. Refused recovery retains uncertainty. Added controlled asynchronous regressions. |
| AR2-02, AR2-03 | Removed mock-only fallback and redundant writes/conversion; replaced completion sleeps with event barriers while retaining real deadline tests. |
| CC-R2-01, CC-R2-02 | Removed retired envelope/volume-only test and ignored helper inputs, updating both hosts. Independent opacity oracle retained. |
| SP2-01–04 | Derived connection activity, added direct text-field behavior tests, reused camera fixture and removed unused HUD read. |
| WX-R1, WX-R2 | Removed three unused APIs and added two-eye depth binding/fallback coverage without changing GPU depth implementation. |
| T1, T2 | Restored intended shared selectors with a real-browser state regression; rejected malformed persisted credential records before profile/file mutation. |
| T3, T4 | Added plain 22-line probe mechanism helper replacing five copies, and independently computed projection oracle. Scenario gates/lifecycles remain local. |
| DOC2-01–04 | Corrected existing advisory/stop/retention/palm prose; no wire-schema change. |

No broad framework, arbitrary split, media/package deletion or new feature was introduced. The optional Core deferred-asset capacity tests are deferred because existing integration protections and this bounded fix scope did not require another helper-focused suite. Abnormal leader/surviving-worker cleanup remains a qualified future validation task; no speculative process killing was implemented. Explicit compatibility retentions remain.

Module owners ran focused checks; root performed an additional integration review. Static-audit conclusions above do not imply final CI/native success. Actual final commands/results, failures retained during development, source identity and native handoff evidence belong under the ignored `Review Data/re-audit/implementation/` directory and the final handoff. Commit and push are conditional on all required checks passing; Git metadata changes alone do not require another test run.
<!-- IMPLEMENTATION_DISPOSITION_END -->

## Detailed module evaluations

### ARModule


#### Executive assessment

The current ARModule is substantially simpler than the historical audit baseline: ownership now sits in explicit admission, worker, operation, session and localization collaborators. One confirmed P2 remains in native agent-mode admission. No P1 was established. Further complexity reduction should be small and local; splitting the large runtime, map workflow or transport by line count would distribute their invariants.

All 153 authoritative inventory paths have full-text union coverage. All nine required separate specialist subagents completed (no active children remain); full-text partitioning is complemented by whole-production focus reviews with bounded coverage recorded honestly. This is static review of the current mixed worktree, including retained implementation changes; historical validation is context, not current execution evidence.

#### Prioritized actionable findings

##### AR2-01 — P2: stale manual-mode requests mutate native mode before admission

**Confirmed defect; high confidence.** `dimos-ar/dimos/ar/module.py:740` prevalidates only requests entering agent mode. Requests entering manual mode go straight to `_change_native_mode`; native `ar_agent_set_manual(True)` runs at `module.py:860`, before the request epoch is checked at `module.py:866`. The native signature is boolean-only (`robot/agent_control.py:12`), and its gate actually clears the enabled event (`robot/agent_control.py:50`). No native epoch validation repairs this ordering.

While idle in agent mode, an old/absent-epoch manual request can pause native agent dispatch, then receive a stale reply while the coordinator remains in agent mode. Ordinary messages can subsequently queue behind the paused native gate, and a same-mode agent request does not invoke native resume. This is published/native mode divergence; a native pause is not evidence of uncontrolled motion. Root and lead independently traced the same path.

**Minimal improvement:** coordinator-owned nonmutating preflight for connection identity, epoch and request identity before either RPC, retaining positive quiescence before committing manual mode and the post-RPC epoch check. Avoid copying coordinator policy into the host or optimistically publishing manual state. Cover pending-RPC requester retirement in the same lifecycle fix.

**Protection:** add stale/absent-epoch manual regressions alongside `replication/test_module_interaction.py:197` and `:214`, asserting no RPC, unchanged mode/busy facts and stale response; preserve refusal, uncertain mode and quiescence cases. Use controlled Events for a pending RPC/disconnect test. Correctness and tests specialists report this once, not as two findings.

##### AR2-02 — P3: production task factory tolerates an impossible result solely for a mock

**Maintainability proposal; high confidence.** `manipulation/following.py:236` constructs an ordinary class, then returns if the result is `None` at `:237`. The test substitutes the constructor with `captured.update(...)`, which returns None (`manipulation/test_runtime.py:249`–252). Make the substitute return a lightweight task, remove the unreachable production branch, and retain guard/speed initialization and factory/following regressions. This is a small cleanup, not a runtime defect.

##### AR2-03 — P3: completion tests depend on short fixed sleeps

**Test maintainability proposal; high confidence in structure, no reproduced flake.** Handler tests wait 50ms before asserting delivery (`websocket/test_server.py:106`, `:128`); sender tests wait 10–50ms before stopping and checking frames (`websocket/test_send_queue.py:92`, `:113`, `:182`). Replace completion sleeps with callback Events or protocol barriers and a generous timeout. Preserve deliberate lease/timeout/backpressure timing tests. Existing held-cleanup race tests already demonstrate suitable local synchronization; no generic harness is needed.

##### Optional adjacent cleanup, not separate defects

`manipulation/runtime.py:392` calls `operation.clear()` then repeats its id/plan clearing at `:393`–394; `operation.py:48`–50 already owns those resets. Remove the two writes when touching that block. `manipulation/adapter.py:209` rebuilds the complete velocity map per selected joint; build it once alongside position values at `:196` and retain empty-velocity behavior. Existing observation/retirement tests protect both. These do not justify a dedicated refactor or performance claim.

#### Rejected or qualified reports

- Internal map-alignment dictionaries have one owner and colocated encoding. No demonstrated mutation/schema defect justifies a new record/serializer abstraction.
- Integer local `epoch` variables could read `generation`, but no behavioral bug was found; defer cosmetic renames to nearby work, keeping wire epoch spellings.
- Test-only references do not prove public Python APIs are dead. Retain `encode_client_pose` explicitly recorded for external compatibility and the small read-only marker_ids observation absent an external-consumer decision.
- Separate control fences, shared interaction state, native runtime, transport service, released following tail, held following and operation completion encode different contracts. Do not merge their timers or mutable owners merely because terms look similar.
- Large files are signals for inspection, not automatic extraction mandates. Meaningful ownership and local deletion take priority over adding classes/files.
- Full replay store/subscription cleanup through EOF was not exercised here; this is a validation gap rather than an asserted failure. Private-state assertions in safety/generation races and wire serializer fixtures are useful contract tests, not automatically implementation mirroring.
- Rules about teaching/pausing/design discussion govern authoring and cannot establish retroactive workflow violations from current source. No source was authored in this audit.

#### Improvements since the historical audit

Current code visibly routes cancellation-safe executor admission through `BoundedWorker`; ordinary finite-number conversion catches integer overflow; playback translates producer timestamps rather than replacing source timing. Canonical manipulation admission/error owners, typed backend observations, operation retirement, and busy derivation replace prior duplicate service/state responsibilities. WebSocket session retirement has one detach path for paired bulk resources. Localization no longer exposes a permanently empty work channel. These observations agree with the implementation ledger but are grounded in current source; they do not imply current test execution passed.

#### Retained compatibility and behavior

Retain mixed relative tag/VPS fallback and map-field omission for relative-only results, the three-second preferred-marker deadline, explicit saved configuration semantics, canonical shared target/following_tail, positive native stop uncertainty and lease deadlines, and read-only recording EOF retention. Optional agent adapters, dynamic following-task registration, replay entry points, robot profiles and protocol serializers have real callers or explicit external contracts. ARModule remains platform-independent and imports the installed DimOS package. No Lens Studio actions or device readiness claim were made.

#### Actual verification and limits

Read repository rules, all inventory source through specialist union plus lead reads, cross-module protocol references, current implementation disposition and historical handoff context. Lead independently verified the P2 admission path and concrete P3 source lines. No tests, CI, servers, installs, native compilation, Lens Studio, hardware interaction, source changes, staging, commits or pushes occurred. All new writes are ignored review artifacts in this module directory. Installed-runtime compatibility, physical stop behavior, network timing and native device acceptance remain unverified by this static audit.

Coverage accounting: 153/153 full-text dispositions; 0 binary, 0 generated, 0 uncovered. Nine actual specialists are recorded in specialists.json; individual bounded focus reviews are preserved in coverage.json assessments. Architecture, unused, adherence, naming, large-file and state reports found no additional independent actionable defect.

### ClientCore


#### Executive assessment

Static review of the current working tree establishes no new confirmed behavior defect and no P1/P2 finding. The most useful remaining change is small: remove retired robot-envelope data and its volume-only test. A second optional cleanup removes obsolete parameters from shared presentation helpers. Existing ownership extractions are substantive; further splitting the largest owners was not shown to reduce coupling or state.

This is an evaluated audit, not a runtime certification. Specialist focus scans were often bounded; exhaustive full-file reads were partitioned across the team. All nine actual specialist children completed, with at most two active concurrently. Union coverage is 177/177 inventoried files reviewed as full text (67 production TypeScript files, 67 metadata files, 42 tests and one empty packaging placeholder); 0 bounded-only, binary or generated dispositions remain. Individual whole-module focus scans remain bounded where recorded. Exact evidence and all child identities are in `coverage.json` and `specialists.json`.

#### Prioritized actionable findings

##### CC-R2-01 — P3: remove the unused forearm envelope and its obsolete test

Classification: maintainability/deletion proposal. Confidence: high for repository non-use.

`clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationVisuals.ts:45` exports `OPENYAM_FOREARM_BOXES`; the only repository consumer is the volume assertion at `clients/specs/Tests/DimOSARClient/manipulation/ArmToolKinematics.test.ts:55`. The test compares constant volumes against a fixture box, without exercising current renderer or kinematics behavior. Both specialist and lead reference searches confirmed this. Root independently confirmed the full-repository reference result.

Delete the constant, import and volume-only case. Keep the gripper/articulation cases at the same test file's lines 22 and 65. No published package contract for this plain export was established; future Core packaging is not itself evidence of an external compatibility obligation. Respect any specifically documented external consumer if discovered. Validate with focused manipulation tests; no native action is needed merely to remove unreferenced data.

##### CC-R2-02 — P3: remove obsolete presentation-helper inputs when touching these callers

Classification: minor maintainability proposal. Confidence: high.

`clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationPresentation.ts:26` ignores selected/stopped and returns fixed menu rows; `:42` ignores selected for the gripper action. Both hosts still pass these arguments (`clients/webxr/src/manipulation/ManipulationControlsView.ts:185,220`; `clients/specs/Assets/Scripts/DimOSSpecsClient/manipulation/ManipulationRenderer.ts:169,319`). The signature suggests policy variation that no longer exists.

Remove the unused arguments and update repository callers/tests together. Preserve menu contents, the `canManipulate` guard and selected/unselected gripper behavior protected by `clients/specs/Tests/DimOSARClient/manipulation/ManipulationPresentation.test.ts:19`. A new abstraction or broad host rewrite is unwarranted. Run the focused presentation suites if implementing this cleanup.

#### Validation gap, separate from defects

Optional P3 resource-contract protection: `websocket/DeferredAssetReplies.ts:34` caps correlations at 64 and `:43` caps hydration work at four attempts/two milliseconds. Existing session cases cover stale completions, missing assets, estop retirement and supersession; static searches did not find assertions for the helper's own capacity and fair bounded processing contracts. A focused test could cover replacement at capacity, removal/expiration freeing capacity, and eventual progress across bounded passes. BulkTransfer queue tests protect a different owner. This is not evidence the implementation violates its limits, and it should not become a numeric coverage mandate.

#### Rejected or qualified specialist observations

- The default-generation suspicion in `DeferredAssetReplies.current` is rejected. `arModuleSession.ts:399` invokes `observeAssetFacts` before hydration/defer; `:480` invalidates/initializes each stream. No reachable undefined-generation production path was shown.
- A queued stream update surviving a terminal release is not reported as a defect without defeating server lease/sequence authority. Isolated queue inspection is insufficient.
- `armPointWeight` is an intentionally retained independent mathematical oracle for prepared displacement math. Its tests are useful. Moving it to test support is optional organization, not an actionable duplication finding or removed-GPU-logic claim.
- `AgentSpeechSession.ts` contains a three-line stop-word predicate, not the retired wake-word lifecycle. Its filename is a low-value naming observation; standalone rename/extraction is rejected.
- `ManipulationInteraction` (1106 lines) and `protocol` (1059) are review burdens, but a safe deletion or extraction with fewer shared mutable dependencies was not established. Policy, request correlation, validation and presentation already have owners. Do not split by line count.
- Separate measured/proposed interpolation filters, local gesture drafts, shared authority, observer prediction, released tail and request correlation protect distinct concepts. They are not automatically mirrored truth.
- Calibrated physical dimension assertions and AST import-boundary tests are meaningful contracts. No broad test deletion is recommended.

#### Improvements since the historical audit

Current source confirms the ledger's useful changes without using its status as proof: wake-word lifecycle is gone; synthesis completion is generation-guarded; manipulation policy/request/validation collaborators are narrower; draft retirement is centralized; tracking publication and reference identity have an owner; localization retry distinguishes typed failure kinds; deferred asset replies have an explicit bounded owner; navigation execution uses a phase instead of parallel active/resolved/awaiting flags; v2 handshake metadata and explicit reference/travel tests are present. These are current code/test inspections, not rerun test results.

#### Retained behavior and compatibility

Preserve relative tag results without map fields, mixed tag/VPS fallback, preferred-marker deadlines including explicit zero and configured 1.5 values, canonical shared/observer drafts and `following_tail`, raw-feedback motion decisions, independent presentation smoothing, held-feedback retention versus interruption, Stop/Resume and lease deadlines, read-only recording EOF, explicit capture pause versus visibility suspension, PIN validation, heading and warning presentation. Specs GPU static buffers/uniform sampling remain host-owned and outside this module's complete semantic review. Portable Core must remain a single implementation imported by both hosts; `clients/core/.gitkeep` is intentional future packaging.

#### Actual verification and limits

Read repository rules and contribution guidance; inspected current Git status/diffs and implementation disposition ledger as context; verified actionable references/line numbers against current files and traced caller paths. All review writes are under ignored `Review Data/re-audit/client_core/`. No source changes, dependency installs, tests, CI, servers, browser integration, Lens Studio actions, native compilation, recordings, commits or pushes were performed. Existing tests were read, not rerun; this audit makes no native-ready, physical-safety, rendering or performance claim. Per-specialist reports and coverage retain bounded-search limits rather than equating a declaration scan with a full semantic read.

### client-specs


#### Executive assessment

Nine separate specialists completed the required architecture, duplication, correctness, unused code/assets, tests, naming, adherence, large-file and state reviews, at most two concurrently. No new confirmed P1/P2 runtime defect was established. Four small P3 improvements remain, two suitable only as opportunistic cleanup. Existing native resource guards and presentation caches generally represent distinct lifetimes rather than competing domain owners. Further subdivision of the current authored owners would mostly add plumbing.

All 244 inventoried paths are covered: 230 full-text, 13 binary-metadata-reference (11 shader containers and two fonts), one generated-structure (embedded OpenYAM geometry). This is union coverage, not a claim that every specialist read every body. Every specialist inspected its focus across the production subsystem and accurately qualified bounded reads. The lead additionally read connection/transport/uniform/priority/text-field owners and the entire 3274-line serialized scene in four untruncated chunks. Scene static review includes all object/component, transform, render/skin, script-input and UUID sections; a structural scan found 173 distinct definitions and 172 owned edges, all locally resolved. It does not establish native scene behavior.

#### Prioritized actionable findings

1. **SP2-01 — P3, high confidence, maintainability: derive bounded connection activity from its attempt.** `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/SpecsConnectionController.ts:23` mirrors `attempt` with `connecting`. The snapshot at line 40 can derive `attempt !== null`. Start retains the attempt at line 67; retry retains it; terminal failure clears both at line 96; cancel clears both at lines 103–105. Removing this field and its assignments eliminates one invariant while preserving true throughout the retry delay. Keep `started`, `target`, generation and resolution guards, which represent different facts. Protect lookup, retry delay, cancellation, ready and final exhaustion with the existing connection tests (`clients/specs/Tests/DimOSSpecsClient/specsConnectionController.test.ts`). This is no evidence of a current visible error.

2. **SP2-02 — P3, high confidence, host-unit validation gap: cover NativeTextField's shared adapter behavior directly.** `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/NativeTextField.ts:49` maps slider/window positions and prevents feedback; line 72 measures wrapping, sizes content and selects start/follow-end. `clients/specs/Tests/DimOSSpecsClient/mainMenuView.test.ts:9` replaces the shared field with spies. No inventoried host unit test directly covers the adapter. Add a small owner-level test for short/overflowing content, start/follow-end, slider/window round trips, feedback suppression and idempotent disposal. This protects both conversation and diagnostics, without a new production abstraction. It is specifically a unit gap, not a claim that integration scenarios never cover scrolling or that native font measurement is wrong.

3. **SP2-03 — P3, high confidence, opportunistic test cleanup:** `clients/specs/Tests/DimOSSpecsClient/specsCameraSource.test.ts:98` repeats the native encoding fixture already defined at line 113. Reuse that fixture for the stop-during-encoding case and invoke its first saved callback. Keep the rejection/ignored-success assertions at lines 107–110 and the separate cross-generation serialization case. This removes roughly nine setup lines, with this test file as focused verification; it does not justify deleting a test.

4. **SP2-04 — P3, high confidence, opportunistic cleanup:** `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/UIPresenter.ts:461` obtains dependencies only to read an unused session view at line 462. Remove the unused read while preserving the initialized-dependency precondition and the speech/post-wizard LiDAR effects. Existing UI logging/restart/shared-mode tests protect surrounding behavior. No measurable performance claim is made.

#### Rejected or qualified specialist reports

- Architecture's preview-playback consolidation trigger is deferred: current renderer hold/reset/sample actions are sequential presentation decisions, with no demonstrated divergence. A wrapper service now would add indirection.
- No arbitrary line-count split is recommended. UIPresenter (573 lines), SetupWizardController (497), composition (453) and ManipulationRenderer (379) already delegate distinct lifetimes; generated geometry and binary graphs are not handwritten complexity.
- Shared subscription bags, merged gesture adapters and deletion of superficially repeated PIN tests were rejected: lifetimes, per-source capture and asynchronous event-order guards differ.
- Native ABI geometry/uniform tests are intentionally coupled to buffers. Preserve their assertions instead of replacing them with broad snapshots or generic mocks.
- Cosmetic `navGoalPresenter`→`activeRoute` and old test filename changes are not standalone findings. Serialized `lidarPresenter`/`ARMarkerPrefab` names require identity/wiring care and do not warrant churn.
- No supported asset deletion candidate remains. Runtime requireAsset loads supplement UUID references. All 13 editable custom shader sources match content embedded in their packaged binary graphs. Font licensing, prefab metadata and authored hosts are retained.
- Scene `ScriptInputsDefault.autoRun: true` at line 3216 is a default-input flag. Actual `ScriptInputs.autoRun` at line 3221 is false. No enabled-test defect is reported.
- Python-scoped comment/banner rules do not retroactively ban TypeScript UIKit sections. Static source cannot establish earlier scene-editing workflow violations.

#### Improvements since the prior audit

Current source and specialist traces support the SP-01..11 ledger rather than simply trusting its status: obsolete placement/helper surfaces are removed; shared quaternion math and text resources are reused; settled marker geometry and hidden diagnostics avoid redundant work; ordered Blob queue processing guards socket/queue identity across awaits; animation tests now exercise retirement/restart; alignment review uses the wrist visibility owner. These are current static observations, not re-used prior test-pass evidence. Small remaining unused session-view work is separately reported above.

#### Retained compatibility and behavior

Preserve ClientCore policy ownership and shared observer drafts/following_tail; independent native input capture facts; rollback baseline identities; unabortable JPEG encoding serialization and callback generations; native CONNECTING-socket retirement; saved PIN, idempotent submissions, bounded initial attempts and established-session reconnect ownership. Keep remote-owner warning yellow and +X heading. Keep static arm mesh buffers, 15 scalar uniforms, 10 Hz target sampling, 0.12-second smoothing and read-only recording EOF. SurfacePlacement, editable shader sources, packaged binaries, font licenses and serialized asset identities are not cleanup candidates.

#### Actual verification and limits

Read-only source, metadata, binary header/reference and current-ledger inspection only. Nine actual child reports and per-file review dispositions are recorded in specialists.json and coverage.json; specialist-specific bounded coverage remains in their manifests. Lead verified accepted finding citations against current source and completed full serialized-scene reading after the initial bounded asset pass. No inventory paths are uncovered, and no authored production TypeScript file remains only bounded in the union; OpenYAM numeric literals receive generated-structure review.

No tests, installs, full CI, servers, browser integration, Lens Studio/MCP/UI actions, native compile/recording, source changes, commits or pushes occurred. Native shader rendering, physical input, package importer behavior, runtime scene wiring and compiler-cache correspondence remain unverified. This audit is not a device-readiness handoff.

### client-webxr


#### Executive assessment

Current source shows substantial simplification since the first audit. No new confirmed runtime defect or P1/P2 proposal survives this review. Two small P3 recommendations remain: delete three unused host API surfaces and strengthen stereo environment-depth binding coverage. These are optional cleanup/validation work, not evidence that current interaction or rendering fails.

The authoritative module inventory has 144 source/test/fixture files: 143 received union full-text coverage and the large generated OpenYAM.json model received parsed structure/reference coverage. All nine specialists completed; no child remains active. Nine separately spawned specialists reviewed architecture, duplication, correctness, unused code, tests, naming, rules adherence, large files and state. Their assigned full-read slices partition the inventory; each additionally traced its focus across production subsystems using explicitly bounded reads/searches. Coverage records distinguish those from full reads. The lead independently read key composition, lifecycle, transport, camera/profile, arm/route rendering and regression paths, verified proposed references and filtered the reports. No source was changed.

#### Prioritized actionable findings

##### WX-R1 — remove three small unused host API surfaces

**P3 · maintainability proposal · high repository-reference confidence.** `clients/webxr/src/presentation/GlassSurface.ts:120–123` exposes an uncalled `setTint`; `clients/webxr/src/presentation/WebXRUIPresenter.ts:303` exposes an uncalled `cycleLidar` wrapper; `clients/webxr/src/presentation/RobotPanelFrame.ts:67` accepts an ignored `_width`. Exact-name repository tracing found only the two `panelChrome` calls at `RobotPanelFrame.ts:16` and `MainMenuView.ts:288`. Production lidar buttons select explicit modes through `WebXRInputController.ts:150` and `setLidarMode`.

Minimal implementation: remove the two methods; remove the ignored width parameter and its two arguments. Preserve Core `LidarDisplayController.cycle`, GlassSurface constructor/material tint behavior and all actual radius/size values. No new abstraction or deletion-only test is needed. Validate type checking plus existing focused menu/panel tests. Private package metadata supports local API cleanup; external ad-hoc debug users cannot be disproved statically. This is a tiny opportunistic reduction, not a substantial architecture issue.

##### WX-R2 — exercise environment-depth per-eye binding

**P3 · validation gap · high confidence; no demonstrated rendering defect.** `clients/webxr/tests/EnvironmentDepthRenderer.test.ts:14–66` only supplies empty `views` lists. The stereo depth collection at `src/presentation/EnvironmentDepthRenderer.ts:64–83` and render callback's eye-specific texture/layer/transform/viewport binding at `:179–198` therefore have no focused coverage. Correctness and tests specialists independently identified this gap; lead verified it.

Minimal implementation: add a focused test with two distinct views/cameras/viewports and valid fake depth records; capture injected uniforms through `onBeforeCompile`, invoke the public `onBeforeRender` callback per eye and assert selected texture/layer/transform/viewport. Then invalidate one eye and assert selective depth is disabled for both passes. Preserve unmarked controls and reset/dispose hook restoration. Avoid full shader-string snapshots. This validates host binding policy, not actual GPU occlusion; headset/browser rendering remains separate evidence.

#### Rejected or qualified specialist observations

- No mandatory extraction: MainMenuView (713 lines), InputController (676) and ManipulationRenderer (478) are below the approximate large-file signal and now delegate meaningful widgets/transitions/session/gesture/sampling owners. Line count alone does not justify more forwarding files.
- Keep primary gesture state and `InteractionCapture` authorization separate: SDK button release callbacks can arrive independently after host release. Combining them would remove authorization behavior.
- Keep distinct built-in usable-calibration and measured-profile acceptance checks. They encode intentionally different compatibility claims.
- Do not replace Three.js CPU per-point opacity with Specs GPU mechanics as a duplication fix. Shared Core sampling is already used; host presentation differs.
- Keep panel gesture admission at its callers; shared execution already lives in PanelGesture. A generic initializer would add policy arguments for little deletion.
- Do not generalize every disposal path. Imported model resource sharing and Troika's instance/shared ownership have different contracts.
- No meaningful rename or rule violation was established. Compressed existing formatting is an opportunistic readability note only; Python-specific teaching/comment rules were not applied retroactively to TypeScript.
- No unnecessary test suite deletion was justified. World-space geometry tests, material contracts, real model fixtures and jsdom launcher tests exercise distinct behavior. Private fixture access can be improved when touched without inventing production getters.
- No GPU leak is established from temporarily discarded ExternalTexture wrappers when a later eye is invalid: those wrappers have not reached upload/rendering. Do not promote this suspicion into a runtime defect without evidence.
- Integration-only accessors such as `WebXRRobotPresenter.worldPosition` are live under test scope and were retained.

#### Improvements since the prior audit

The implementation ledger records WX-01 through WX-14 as implemented; this report uses current source as evidence rather than treating the ledger as proof. Important corroborated improvements include visible route Group/ribbon/dash rendering without hidden auxiliary geometry; discriminated primary input capture with independent release authorization; shared arm presentation sampling; separated menu widget/transition ownership; shared text-resource disposal; session pumping before viewer sampling; explicit measured-profile acceptance; celebration getter and lazily built diagnostics; and retained loaded-mesh/EOF regressions.

`tests/SessionScheduling.test.ts:9` now exercises the real Core queued state, lease renewal and reconnect work without viewer poses or receive-triggered ticks. `InteractionCapture.test.ts:4` checks competing/cancelled/late button releases. `WebXRRouteRenderer.test.ts` inspects visible ribbon/dash behavior. These address prior verification weaknesses; they were read, not executed in this audit.

#### Retained compatibility and user-facing decisions

Preserve the Core/browser platform boundary and canonical composition names. Preserve session progress without viewer data, tracking/reference-space recovery distinctions, camera cancellation/profile/timestamp fencing, measured-profile rejection, primary and secondary gesture authorization, selection eligibility, visible route/goal heading/warning tint, WebXR CPU opacity, shared arm sampling, loaded-model and read-only EOF feedback retention. PIN gateway compatibility/tests remain meaningful even without a page entry flow. No Lens/native actions were needed for this WebXR static audit.

#### Verification and limits

Static source/rule/reference/test inspection only. No tests, build, server, browser integration, native compilation/recording, Lens Studio action, install, full CI, commit or push occurred. Existing dirty working-tree feedback/implementation was preserved. No claim of browser/GPU timing, physical calibration, native behavior or runtime performance is made. Review artifacts live only under the ignored `Review Data/re-audit/client_webxr/` directory. See coverage.json for the per-file union disposition and specialists.json for actual specialist identities/reports.

### Tooling


#### Executive assessment

Nine actual specialist children reviewed architecture, duplication, correctness, unused code/assets, tests, naming, adherence, large-file cohesion and state/lifecycle complexity. The authoritative 177-file inventory is covered in coverage.json; binary and generated artifacts have explicit structural dispositions. Review was static and read-only; no source changes, tests, installs, servers, browser/native integration, Lens/MCP/UI actions or compilation occurred.

Two confirmed issues deserve fixes: malformed shared launcher CSS selectors introduced during cleanup (P2), and multiline credential persistence corrupting environment record boundaries (P3). Existing owner extractions have substantially improved the tooling. No generic controller framework, arbitrary file split, bulk test deletion or dependency-archive deletion is justified.

#### Prioritized actionable findings

##### T1 — P2 confirmed regression: restore valid shared launcher selectors (high confidence)

`launcher/app/static/app.css:948` leaves its outer `:is(` unclosed; selectors at 961, 966 and 970 do likewise. These shared rules provide control metrics, border/color, keyboard-focus outlines and hover styling. `git diff HEAD -- launcher/app/static/app.css` confirms cleanup removed the outer closing delimiters when deleting retired `.tag-upload` alternatives, and also removed `:focus-visible` and `:hover:not(:disabled)`. This is a concrete implementation regression. The malformed first function can affect parsing of the remaining stylesheet suffix; no browser-measured extent is claimed.

Minimal fix: remove only the retired selector alternatives, restore balanced selectors and intended interaction pseudo-classes. Merely closing parentheses on the outline/hover rules would apply interaction styling unconditionally. Verify real browser CSS parsing and computed metrics, keyboard focus and enabled/disabled hover behavior, using the existing browser test infrastructure when implementation validation is authorized. Current static-module/MIME tests and pure JavaScript state tests do not validate stylesheet parsing. Root independently confirmed source and diff evidence. The adherence specialist rated P3; lead elevates to P2 because shared launcher interaction styling is affected by current cleanup.

##### T2 — P3 confirmed defect: reject credential record separators before any mutation (high confidence)

`launcher/app/app.py:133` accepts arbitrary credential strings. `_blank_to_none` at 144 only strips outer whitespace; `launcher/app/config.py:79` and 88 interpolate raw values into records, while `read_env` at 41 splits records on every newline. Thus `abc\nMULTISET_CLIENT_ID=changed` as a credential creates an unrelated setting on reread; a continuation without `=` truncates the credential. This is local malformed-input/configuration corruption, not a remote exploit or shell-execution finding.

Reject unsupported interior line separators/control characters in direct `merge_env` calls and validate API credentials before profile mutation at `launcher/app/app.py:414`. Preserve deliberate outer-whitespace normalization, blank-to-delete and existing ordinary/quoted credential behavior. Regression tests should show malformed direct writes leave previous bytes untouched and settings requests reject before either profile or environment state changes. Existing `launcher/app/tests/test_config_env.py` covers ordinary merge/removal/quote stripping, not this boundary.

##### T3 — P3 optional maintainability: share native probe host mechanisms (high confidence, optional)

Production-root DFS and `SPECS_REVIEW` timestamp envelopes repeat in `clients/specs/Tests/integration-tests/BendyLaserProbe.ts:32`, `LidarAlignmentProbe.ts:30`, `ManipulationProbe.ts:38`, `NavMarkerOverlapProbe.ts:45` and `IntegrationScenario.ts:67`. A small test-only Integration-prefixed helper could remove repeated traversal/emission while preserving explicit scenario gates, phases, assertions and cleanup. `clients/specs/tools/native_project.py:23` already copies Integration-prefixed helpers. Do this only if the deleted code outweighs the extra helper contract; no generic scenario framework or merged fixture peer is proposed. Focused preparation/import tests plus authorized native scenario verification protect this change.

##### T4 — P3 optional validation improvement: independent projection oracle (high confidence, optional)

`clients/webxr/tools/test_calibrate.py:31` generates all synthetic pixels with production `project()`, also used by fitting in `calibrate.py:116`. Existing recovery/held-out-error/reused-view/nonfinite tests remain useful. Add one independently hand-computed axis/transform projection case or separately authored fixed OpenCV fixture to catch shared basis/order/sign mistakes. This does not establish a present calibration defect or qualify physical calibration.

#### Rejected or qualified reports

- Surviving owned workers after leader exit remain a validation gap, not a confirmed production defect. `_stop_one` at `launcher/app/armodule.py:980` returns for an exited leader; `_finalize_exit` retires that process at 1199. A focused surviving-child test could define ownership after abnormal parent failure. Current installed DimOS behavior was not established; stdout inheritance and OpenYAM's intentional separate supervisor session matter. Never fix by indiscriminately killing port listeners.
- `app.js`, `armodule.py` and `review.py` are large but already delegate independent concerns. Broad splitting would add shared-state/callback interfaces without demonstrated deletion or behavior benefit. Process-tree traversal extraction alone relocates complexity.
- No worthwhile naming-only renames, dead-code/asset deletions or unnecessary test-suite removals found. Standalone CLI tools and optional native probes retain callers/documented uses; package archives are external dependencies. Tiny unused `legacy_graph.save` wrapper and stale marker wording are negligible churn.
- ImmediateAuthority/native fixture peers and arm golden/probe scenarios have different transport/behavior contracts; do not merge them wholesale. Generated arm geometry duplication is contract-checked compatibility data.
- Source-string harness checks are formatting-sensitive but protect an authoring invariant; retain alongside native verification. Do not infer historical workflow violations from current source.

#### Improvements since the prior audit

Current code provides `OwnedOperation` for cancellable dependency work, `LauncherEvents` for bounded fan-out, immutable source resolution, separated calibration/profiles/preferences, serialized captured settings writes, derived launcher presentation, native recorder ownership, pure evidence parsing, shared harness preparation, source provenance and shared media finalization/publication. Their actual callers were traced; architecture and state specialists found no worthwhile replacement abstraction.

Verified corrected contracts: persisted focus policy totals three restoration attempts spaced at least one second across recorder restarts; focus abort suppresses project restoration and pauses without raising a window; native manifest enumeration excludes `.DS_Store`; pre-scene-overlay invalidation latches unexpected edits; source/workspace identity and clean production handoff gate atomic golden publication, with a final source recheck. Failed/incomplete evidence retention and output overrides remain explicit. These are present improvements, not repeated findings.

#### Retained compatibility decisions

Retain explicit selected-interpreter fallback and venv path identity, dedicated replay/source resolution, bounded OpenYAM parking supervisor, and independent gateway/backend lifetimes. Preserve mixed tag/VPS fallback, default three-second preferred-marker deadline and explicit saved 0/1.5 values. Native guards remain editor plus Auto Run gates; normal production retains Auto Run false. Existing ClientCore reuse and portable/platform ownership boundaries remain unchanged. No finding warrants undoing GPU/static-buffer, observer-draft, PIN, tint/heading or read-only replay compatibility decisions.

#### Verification and limits

Specialists each fully read their assigned slice except explicit binary/generated dispositions and performed bounded focus searches/caller reads across all tooling subsystems. Lead independently read process/persistence/source-handoff/publication owners, verified important current lines and diff evidence, and evaluated specialist claims. coverage.json records every inventory path and actual reviewer/disposition; it does not claim transitive dependency implementation, visual asset semantics or unexecuted native/browser behavior. No tests were run. No secret-bearing local environment file contents were read. All artifacts were written only under ignored `Review Data/re-audit/tooling/`.

Final coverage: 177/177 inventory paths; 165 full-text, 4 generated-structure, 8 binary-metadata-reference. Nine of nine specialist children completed; no active children remain. No uncovered files required lead-only recovery.

### Documentation and assets


#### Executive assessment

All nine separate specialist agents completed, with at most two specialists active concurrently. Current ownership, setup, verification and compatibility guides have useful distinct audiences. No broad rewrite, new abstraction, arbitrary file split or asset deletion is justified. One P2 normative protocol contradiction and three P3 wording improvements remain. These are static documentation findings, not executed runtime failures.

#### Prioritized actionable findings

##### DOC2-01 — Advisory evaluate is incorrectly grouped with canonical geometry

**P2 · confirmed contract contradiction · high confidence.** `dimos-ar/PROTOCOL.md:1173` describes evaluate for the current target; `:1185–1188` says Plan/evaluate/following geometry comes from the matching canonical server target. The specific contract at `:1600–1609` correctly permits the owning client's latest local advisory sample without per-sample acknowledgement. Current `dimos-ar/dimos/ar/manipulation/admission.py:42–43` admits evaluate under ownership, `:52–58` checks whether its geometry is current, `:59–68` replaces geometry only for update/plan, and `:81–86` preserves advisory source revision/currentness. Root independently verified this path.

Narrow the action table and blanket geometry paragraph to distinguish nonmoving advisory samples from checked Plan/Execute and canonical following. Link the specific advisory contract; preserve canonical gripper settings and reliable operation acknowledgements. No schema or runtime change is needed. Existing advisory authority tests in `dimos-ar/dimos/ar/manipulation/test_replication_authority.py:309` onward protect behavior; no prose-mirroring test is warranted.

##### DOC2-02 — Scope Emergency Stop no-latch wording

**P3 · clarity inconsistency · high confidence.** `dimos-ar/PROTOCOL.md:1093` boldly says no latch must be released, followed by general anti-latch rationale; `:1098–1099` later qualifies manipulation Resume. Current `dimos-ar/dimos/ar/module.py:1017` handles Emergency Stop and `manipulation/runtime.py:981` sets its stopped latch. State directly that mobile navigation resumes through a new authorized goal while manipulation requires explicit Resume after confirmed stop. Keep current stop tests; no new text test is useful.

##### DOC2-03 — Qualify raw-recording retention

**P3 · prose inconsistency · high confidence.** `tools/integration-tests/README.md:63` says raw recordings remain, while `:102–103` correctly discards successful non-golden raw recordings unless extra media is requested. Current `tools/integration-tests/finalize.mjs:188–195` and `clients/specs/tools/review.py:760–771` implement the latter. Qualify the earlier sentence; preserve golden/failure footage, metadata and failed/incomplete diagnostics. Existing cleanup tests protect implementation.

##### DOC2-04 — Describe either-palm menu support

**P3 · optional discoverability improvement · high confidence.** `README.md:141` describes a left-palm wrist menu. Current `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/WristMenuController.ts:155–166` supports either palm with separate gates. Say the menu opens from either palm. Left palm remains valid, so this is not a broken flow. Existing controller tests protect both hands.

#### Rejected and qualified reports

Do not split the 1,639-line protocol simply to shorten it. Current architecture is 195 lines and the manipulation guide 246; historical bloat findings are addressed. Calibration's one-view JSON explicitly illustrates schema rather than accepted calibration. Minimum-data, held-out and geometry thresholds remain useful. Native focus, source-handoff, capture evidence, camera validation and physical acceptance protect distinct boundaries.

Historical `audit.md` and dated calibration counts are evidence snapshots, not current normative promises. Lead fully read historical authored prose; the generated historical inventory was structurally inspected rather than revalidated row by row. No historical finding or implementation ledger was treated as proof. Earlier specialist supporting counts/citations were inaccurate: lead checked actionable locations and corrected advisory heading to current `:1600`, architecture pause to `:95–100`, PIN path to `:166–169`, and architecture length to 195. Root fingerprints establish that source did not change concurrently.

#### Improvements since the historical audit

Fresh checks show one validation-frequency owner in AGENTS, useful Core/host/native boundaries, correct 60 mm bench calibration linked to its owner, explicit same-origin WebXR behavior with retained API consumers, current native evidence/source-handoff procedures, and coherent editing lease/tail/operation/reconnect descriptions. Pause and visibility suspension intentionally differ (`docs/architecture.md:95–100`; `localizationCaptureEpisode.ts:163–185`). These conclusions use current files.

#### Retained compatibility decisions

Retain live hero/walk/setup media, all nine printable markers, model attribution and profile guides. Fresh searches find no live references for drift/wrist/mount media or the unembedded launcher screenshot, but external repository-URL consumers cannot be excluded: retain pending an explicit consumer decision, without reopening DC-12. Retain SurfacePlacement pending editor dependency/reimport proof; imported metadata remains referenced and editor work was prohibited. Retain PIN APIs despite no browser entry flow. Preserve mixed tag/VPS fallback, three-second preference deadline, explicit saved zero/1.5, observer drafts, following tails, Specs static GPU buffers/15 uniforms/10 Hz smoothing, warning tint/heading, and read-only replay EOF.

#### Actual verification and limits

All **35 inventoried files** are covered: **19 text documents/rules** with union full authored-text reading (historical audit inventory structurally qualified), and **16 binaries** with metadata/header/reference inspection. Individual bounded reads remain explicit in specialist coverage. Lead read uncovered historical prose and reconciled `coverage.json`; `specialists.json` records all nine actual child agents. All children completed before handoff.

Only static reads, reference searches, header/metadata inspection and cited current code/test comparisons ran. No tests, builds, CI, installs, server/browser, Lens actions, native compilation, rendering, physical print checks, external URL/license verification, commits or pushes occurred. No source changed; only ignored audit artifacts were written. Future implementation validation must be reported separately.

## Independent root evaluation

Root independently confirmed the mode preflight/RPC ordering, absence of mode-block changes in the HEAD diff, retired forearm reference results, Specs connection-state duplication, unused HUD view read, exact saved harness input, stereo-depth test gap, multiline persistence/profile mutation ordering, CSS regression diff, and advisory-geometry prose/code mismatch. Source inspections and qualifications are retained in `Review Data/re-audit/root-verification.md`.

Rejected preliminary suspicion: DeferredAssetReplies generation comparison looks incomplete in isolation, but the real session initializes/invalidates stream generations before deferral. No reachable first-generation bug was established. Keep independent opacity math oracles, separate measured/proposed filters, source/camera retirement tokens, distinct release/SDK authorization, native stop uncertainty, and host-specific GPU/CPU mechanics. Do not remove explicit compatibility surfaces or public entry points solely because in-repository callers are sparse.

## Specialist identities and report hierarchy

All 54 identities below correspond to actual spawned specialists. Individual reports/manifests are local ignored evidence; complete evaluated module reports and union coverage are included here so the audit remains useful without those artifacts.

| Module lead | Focus | Specialist |
|---|---|---|
| ARModule | architecture | `/root/reaudit_armodule/architecture` |
| ARModule | duplication | `/root/reaudit_armodule/duplication` |
| ARModule | correctness | `/root/reaudit_armodule/correctness` |
| ARModule | unused | `/root/reaudit_armodule/unused` |
| ARModule | tests | `/root/reaudit_armodule/tests` |
| ARModule | naming | `/root/reaudit_armodule/naming` |
| ARModule | adherence | `/root/reaudit_armodule/adherence` |
| ARModule | largefiles | `/root/reaudit_armodule/largefiles` |
| ARModule | state | `/root/reaudit_armodule/state` |
| ClientCore | architecture | `/root/reaudit_client_core/architecture` |
| ClientCore | bloat | `/root/reaudit_client_core/bloat` |
| ClientCore | logic | `/root/reaudit_client_core/logic` |
| ClientCore | unused | `/root/reaudit_client_core/unused` |
| ClientCore | tests | `/root/reaudit_client_core/tests` |
| ClientCore | naming | `/root/reaudit_client_core/naming` |
| ClientCore | rules | `/root/reaudit_client_core/rules` |
| ClientCore | large | `/root/reaudit_client_core/large` |
| ClientCore | state | `/root/reaudit_client_core/state` |
| client-specs | architecture | `/root/reaudit_client_specs/architecture` |
| client-specs | duplication | `/root/reaudit_client_specs/duplication` |
| client-specs | correctness | `/root/reaudit_client_specs/correctness` |
| client-specs | unused | `/root/reaudit_client_specs/unused` |
| client-specs | tests | `/root/reaudit_client_specs/tests` |
| client-specs | naming | `/root/reaudit_client_specs/naming` |
| client-specs | adherence | `/root/reaudit_client_specs/adherence` |
| client-specs | largefiles | `/root/reaudit_client_specs/largefiles` |
| client-specs | state | `/root/reaudit_client_specs/state` |
| client-webxr | architecture | `/root/reaudit_client_webxr/architecture` |
| client-webxr | duplication | `/root/reaudit_client_webxr/duplication` |
| client-webxr | correctness | `/root/reaudit_client_webxr/correctness` |
| client-webxr | unused | `/root/reaudit_client_webxr/unused` |
| client-webxr | tests | `/root/reaudit_client_webxr/tests` |
| client-webxr | naming | `/root/reaudit_client_webxr/naming` |
| client-webxr | adherence | `/root/reaudit_client_webxr/adherence` |
| client-webxr | largefiles | `/root/reaudit_client_webxr/largefiles` |
| client-webxr | state | `/root/reaudit_client_webxr/state` |
| Tooling | architecture | `/root/reaudit_tooling/architecture` |
| Tooling | duplication | `/root/reaudit_tooling/duplication` |
| Tooling | correctness | `/root/reaudit_tooling/correctness` |
| Tooling | unused | `/root/reaudit_tooling/unused` |
| Tooling | tests | `/root/reaudit_tooling/tests` |
| Tooling | naming | `/root/reaudit_tooling/naming` |
| Tooling | adherence | `/root/reaudit_tooling/adherence` |
| Tooling | large | `/root/reaudit_tooling/large` |
| Tooling | state | `/root/reaudit_tooling/state` |
| Documentation and assets | architecture | `/root/reaudit_docs/architecture` |
| Documentation and assets | duplication | `/root/reaudit_docs/duplication` |
| Documentation and assets | correctness | `/root/reaudit_docs/correctness` |
| Documentation and assets | unused | `/root/reaudit_docs/unused` |
| Documentation and assets | tests | `/root/reaudit_docs/tests` |
| Documentation and assets | naming | `/root/reaudit_docs/naming` |
| Documentation and assets | rules | `/root/reaudit_docs/rules` |
| Documentation and assets | largefiles | `/root/reaudit_docs/largefiles` |
| Documentation and assets | state | `/root/reaudit_docs/state` |

## Per-file coverage and snapshot appendix

Each current tracked or untracked nonignored file belongs to exactly one module inventory. Deleted pre-existing paths are not current files. Generated evidence, caches, build products and dependency installations under ignored directories are excluded. A full-text disposition means at least one reviewer read the complete authored text; additional reviewer assessments may be bounded. Binary/structure limits remain explicit above. Hashes bind the audit to the reviewed pre-follow-up snapshot, not later edits. The historical audit.md input is replaced by this consolidated report.

| File | Module | Union review | Snapshot lines | SHA-256 |
|---|---|---|---:|---|
| `.cursorignore` | Tooling | full-text | 16 | `c3070c20c526314088a5dde78cbda72f002034e89a4da949378ecfcd1729e75f` |
| `.cursorrules` | Documentation and assets | full-text | 211 | `d42fe49c19dfcbba197626704900a3f8126848377fad7a893d4369d445151efa` |
| `.dimos-revision` | Tooling | full-text | 1 | `72491b4c86c0d73457df4e2ebdc159e8207325ffce2d5b50e100655268dc5205` |
| `.gitattributes` | Tooling | full-text | 10 | `93775610cf9be4c3c30facf3cafd1b1033cf52aca1639dca1e7f06d9c4281237` |
| `.github/pull_request_template.md` | Documentation and assets | full-text | 11 | `1eae99e85f70a97d100f9d907761b3954bc3792f1e8e94f09461e5accbe5ed16` |
| `.github/workflows/ci.yml` | Tooling | full-text | 176 | `d926f6cd17f68160e9c7a16349667a5de2e41fdda325d7148c6ced415bd08ee6` |
| `.gitignore` | Tooling | full-text | 88 | `9faa32342aa982a9e89f31f467de0484483eceaf0b4e224cb02b7543f3e1006b` |
| `.nvmrc` | Tooling | full-text | 1 | `f14b4987904bcb5814e4459a057ed4d20f58a633152288a761214dcd28780b56` |
| `.python-version` | Tooling | full-text | 1 | `7b55f8e67b5623c4bef3fa691288da9437d79d3aba156de48d481db32ac7d16d` |
| `AGENTS.md` | Documentation and assets | full-text | 101 | `cf4097b7c296ec85b5b249539cc8d07ce74d27c52ab16fd67fd985d830126d81` |
| `CONTRIBUTING.md` | Documentation and assets | full-text | 29 | `ebeb441dd6284c348692dcb38ae401ce2efcef24d513a117caab7477eecc3490` |
| `LICENSE` | Tooling | full-text | 21 | `2b8c5ae53524c2f9b95eda3e42f5f9d59205d5463edfd5cba58eb5cf3c547737` |
| `README.md` | Documentation and assets | full-text | 232 | `40c02b6bfc7cc4631f439c426df212610af2d511d4b11259c1f422fbc0fc5e71` |
| `assets/markers/apriltag_robot_0.png` | Documentation and assets | binary-metadata-reference | binary | `019a1e38b09296659e2b47fc89329e9895642e869cd5b6fc8c42cea6192790e6` |
| `assets/markers/apriltag_robot_0_a4.pdf` | Documentation and assets | binary-metadata-reference | binary | `09e198df3414524b23a7a757e7bf96f8d2b920a76c8a30ae3271afbeb3cce0e8` |
| `assets/markers/apriltag_robot_0_letter.pdf` | Documentation and assets | binary-metadata-reference | binary | `8645576ca740d34a699e0d564440acba291660ad8de3d6dcefaf3bc688a69ff5` |
| `assets/markers/apriltag_robot_1.png` | Documentation and assets | binary-metadata-reference | binary | `61cec8afefa5ea36977f75271d6343c8701e3b305db9cd5adca67202857a5b41` |
| `assets/markers/apriltag_robot_1_a4.pdf` | Documentation and assets | binary-metadata-reference | binary | `da22a7beff7ad0f01b433de431e43f6c27e08c5b3713a9a4d3ecedf85a3cea43` |
| `assets/markers/apriltag_robot_1_letter.pdf` | Documentation and assets | binary-metadata-reference | binary | `cfefbfb8372d85c910823c0b91757a5f75083383bf306871dc75fa9d635952ce` |
| `assets/markers/apriltag_robot_2.png` | Documentation and assets | binary-metadata-reference | binary | `e1b24c4eaaaabe373071763c27af31b551842c5fb1e1bd991f12ca76c08dda65` |
| `assets/markers/apriltag_robot_2_a4.pdf` | Documentation and assets | binary-metadata-reference | binary | `4c068f472315a6ffab69f9c54cab38000575f8973671b805ff3488545c71cd9c` |
| `assets/markers/apriltag_robot_2_letter.pdf` | Documentation and assets | binary-metadata-reference | binary | `1e6b80dd8a846514f70f5e36c18ab5ae28bc2263e103da5da87238e0b20cade3` |
| `assets/markers/generate_marker.py` | Tooling | full-text | 150 | `16cae9d7e8335a97bf3e37a47fd5f9a742a8646240a3b6b3842aa96347f0c827` |
| `assets/specs_dimos_arwalk.gif` | Documentation and assets | binary-metadata-reference | binary | `58a5d48bae5da3ae558ffc4e4ee5fb199f87429f4611dd451ca164f98e93a09e` |
| `assets/specs_dimos_drift.gif` | Documentation and assets | binary-metadata-reference | binary | `34cbef8e9c9d025f64cb502baad1265c995522d87c7e81cbceecd255b9f1f6ac` |
| `assets/specs_dimos_go2tagmount.jpg` | Documentation and assets | binary-metadata-reference | binary | `937798235cff7b98394aeace17a473880736b7e38e155fc0a54cd1713f377e6e` |
| `assets/specs_dimos_hero.gif` | Documentation and assets | binary-metadata-reference | binary | `86988822acb4f5a95004dd48dc8d55c4deec1b86dbdabbe96096bbed31c8cebf` |
| `assets/specs_dimos_launcher.png` | Documentation and assets | binary-metadata-reference | binary | `97559ca02229d73b9421f014191a7a65b97d0fa88733a84d82eaa736fee67d46` |
| `assets/specs_dimos_setupwizard.gif` | Documentation and assets | binary-metadata-reference | binary | `ad8abfa1361f00103239e44cac5792b2e3785d8697954a6fc8c4754a5e94e477` |
| `assets/specs_dimos_wristui.gif` | Documentation and assets | binary-metadata-reference | binary | `03c8eacc3af7278d4da781b548edc771e415e20cdc7e5dec2921e5b818a2fcec` |
| `audit.md` | Documentation and assets | full-text | 1438 | `fcd4cd0cbf8b72c7a7cd749b60ddafe7a77e6ef3c6a45f32f0ea01f899cb12fd` |
| `clients/core/.gitkeep` | ClientCore | full-text | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `clients/specs/.gitattributes` | Tooling | generated-structure | 229 | `228dbc7cd2b20458a1155685a8ea7e5983f337c27d6fdf54868a4622470e65e3` |
| `clients/specs/.gitignore` | Tooling | full-text | 33 | `60317d6c47cdb96ffcc85ca5b1cd49cb59453e9d185c79cf79d5ed4603988285` |
| `clients/specs/Assets/DefaultAssets/Device Camera Texture.deviceCameraTexture` | client-specs | full-text | 2 | `19719f617e73e571f75a31159081bd60cee37a05acb2c4a3189a72b1a4ff3166` |
| `clients/specs/Assets/DefaultAssets/Device Camera Texture.deviceCameraTexture.meta` | client-specs | full-text | 16 | `1fca77753c5c9b587234e4047dd9cdb797d1238503a89db1e5d496e6cf70a0e7` |
| `clients/specs/Assets/DefaultAssets/Internet Module.internetModule` | client-specs | full-text | 2 | `5fb7214bc0c94a19a3efdd7230db7ee29c429261c215f30f04aee23768ccc054` |
| `clients/specs/Assets/DefaultAssets/Internet Module.internetModule.meta` | client-specs | full-text | 16 | `43372606e334e3202afc810e80b0f1469a7b09f09b1ecee4877d50d4d755c918` |
| `clients/specs/Assets/DefaultAssets/Render Target.renderTarget` | client-specs | full-text | 19 | `cb689fdf5c70267d37c154451418f914d54218d2737fccef15538e812cf1cab7` |
| `clients/specs/Assets/DefaultAssets/Render Target.renderTarget.meta` | client-specs | full-text | 16 | `ca4985ece8b0f133ce82a20683bda1b2a06485c79fc40a9e6a4c69724e5ec8c0` |
| `clients/specs/Assets/DefaultAssets/Text To Speech Module.textToSpeechModule` | client-specs | full-text | 2 | `1405241e4e65b60793ff9db1241cb0eb5c646b3f3437769ff3f75e6916b5711b` |
| `clients/specs/Assets/DefaultAssets/Text To Speech Module.textToSpeechModule.meta` | client-specs | full-text | 16 | `7aab06f8533c81af3175563165e83c9c9b7a9053b929c85e26e84686f3345f60` |
| `clients/specs/Assets/DefaultAssets/World Mesh.worldmesh` | client-specs | full-text | 4 | `0b2cc93e0d5f06581d75ec4aac8aec3628e8aa2f1220a5b4987a0224e6987e50` |
| `clients/specs/Assets/DefaultAssets/World Mesh.worldmesh.meta` | client-specs | full-text | 16 | `5fe74a2d3c4500f842fd7eb6fe6c7e944e6ae78b4145fd576e0dd4453bcb3d55` |
| `clients/specs/Assets/Fonts/Inter/Inter-Regular.ttf` | client-specs | binary-metadata-reference | binary | `b999cba32e622ffc8d2fea5be8df5a48a91e60d3ad96da8c2bf0816e47ff5ce5` |
| `clients/specs/Assets/Fonts/Inter/Inter-Regular.ttf.meta` | client-specs | full-text | 16 | `5b29e1b7a53c8b4a917c83de874399ff30bb55bb267e40957e92d973596b6b4c` |
| `clients/specs/Assets/Fonts/Inter/Inter-Semibold.ttf` | client-specs | binary-metadata-reference | binary | `1ec638c81e983c1e1b595fc4bd763245da3c27f2511e3c6d750f2e30467f5654` |
| `clients/specs/Assets/Fonts/Inter/Inter-Semibold.ttf.meta` | client-specs | full-text | 16 | `34d8d4b0f05687135048aafe0f6be41cd2adb2fd0437f6516a68fe03696262f1` |
| `clients/specs/Assets/Fonts/Inter/OFL.txt` | client-specs | full-text | 93 | `3b0a5fca3d17942cde889069889dedbbbd075e9b599968c82a95f4d944e9b345` |
| `clients/specs/Assets/Fonts/Inter/OFL.txt.meta` | client-specs | full-text | 16 | `bfbe6283c507e7a1ac6b92e4d6a8273bc37f6ae1c6a4de954a18376383cf1027` |
| `clients/specs/Assets/Materials/AdaptiveStroke.mat` | client-specs | full-text | 52 | `fd8cf5c9e44574c0b56548adfa6e6f886d79cbad748328feb411fec57a8f465e` |
| `clients/specs/Assets/Materials/AdaptiveStroke.mat.meta` | client-specs | full-text | 16 | `d786e9aa8d7a2b9d3a11751ed6024732baa78a6fa18326a92ef55c132e1a16d6` |
| `clients/specs/Assets/Materials/ArmFresnel.mat` | client-specs | full-text | 82 | `e6dfb1a110d76fc4561facb9d23843023ef9be31ac13cda61cfba7dc146adda9` |
| `clients/specs/Assets/Materials/ArmFresnel.mat.meta` | client-specs | full-text | 16 | `b337d77285dc29de20645d4556056801c81d4ba1d93c2e24594a993d315bac3d` |
| `clients/specs/Assets/Materials/ArmStroke.mat` | client-specs | full-text | 112 | `f386849670601ba77d71489a55f875945f63f9eb18b3da5592a0552d62c26c7a` |
| `clients/specs/Assets/Materials/ArmStroke.mat.meta` | client-specs | full-text | 16 | `858206a0d4d7709b2086b7e916ef78030ea2295053128d350a84de77cbf64481` |
| `clients/specs/Assets/Materials/ArmSurface.mat` | client-specs | full-text | 82 | `fed9df3c5a1d6a7879ff3585ecf696815fc3281668ab32c850e05a1771653372` |
| `clients/specs/Assets/Materials/ArmSurface.mat.meta` | client-specs | full-text | 16 | `c3b30b251559ccfcba268e5d80050eadf6edac859b428db15d17a48290169840` |
| `clients/specs/Assets/Materials/BendyLaser.mat` | client-specs | full-text | 64 | `c6e8f5dd0c8bd5fc0b9a2b0334073c770a4e47f6601e686ff90b0c6274ae6aa2` |
| `clients/specs/Assets/Materials/BendyLaser.mat.meta` | client-specs | full-text | 16 | `3d53cb15e7b4a236b860fe0b0f137010694e501f368bc505b04a9d354e20fdea` |
| `clients/specs/Assets/Materials/Box 2.mat` | client-specs | full-text | 108 | `5e6489a4eaca2f957a7a2ae73291ecd154805b2ecb2a4b6e64e5f9b2ae2df6b9` |
| `clients/specs/Assets/Materials/Box 2.mat.meta` | client-specs | full-text | 16 | `da29e8c73f2dd790751067c95b86d7f076a5dc7fc7b1cb549816628b68e6bfea` |
| `clients/specs/Assets/Materials/Gizmo_Blue.mat` | client-specs | full-text | 93 | `c74fe07f79a385ed3b1c5d8923b763432eac4f451c01b2ba01c3ea7cdb68054a` |
| `clients/specs/Assets/Materials/Gizmo_Blue.mat.meta` | client-specs | full-text | 16 | `1002b3bede05a9127b846cc32f910509dea773263cc92228bcb54c128882b96f` |
| `clients/specs/Assets/Materials/Gizmo_Green.mat` | client-specs | full-text | 93 | `7bd6aaf2c3bd26eb49c7a14c9fde6ecb82fc6918173b471d88d2454d3a145632` |
| `clients/specs/Assets/Materials/Gizmo_Green.mat.meta` | client-specs | full-text | 16 | `9c1061ea052db1f073568ee3e59e724526a10cc804d0ec2d8b82580b258b5621` |
| `clients/specs/Assets/Materials/Gizmo_Red.mat` | client-specs | full-text | 93 | `a308010aba2977eb8e39a9d265ed712274d04a57e014d675101b00403edc02a4` |
| `clients/specs/Assets/Materials/Gizmo_Red.mat.meta` | client-specs | full-text | 16 | `c1ecfcbb2782eab5767dfa7a1c8de79aa502f02ceebbacb232eefa0b961a9a60` |
| `clients/specs/Assets/Materials/LidarDot.mat` | client-specs | full-text | 28 | `b3ee24b3658b2a8fb09b44381da37c52fca3bd413d160ef001498cecd67b7407` |
| `clients/specs/Assets/Materials/LidarDot.mat.meta` | client-specs | full-text | 16 | `64ee1fc7d476a22c39a4f90c89b88a45d721c45dde30eb59bf41928b27c7731a` |
| `clients/specs/Assets/Materials/PoseIndicator.mat` | client-specs | full-text | 25 | `93e3096d5b4126afe3ca8875ddf0d03ee4bf0e8ab9789dce12cf99b2c7eef68d` |
| `clients/specs/Assets/Materials/PoseIndicator.mat.meta` | client-specs | full-text | 16 | `ba6394cf3cedc7cf2764b25e5ae79eb4f0c2ef7e787daa98f4bb479576ecadf8` |
| `clients/specs/Assets/Materials/Shaders/AdaptiveStroke.customCode` | client-specs | full-text | 62 | `cfd3fe9323b3336bdf0b3ff379fa30ba575153c2517ccecf62fca274fb7486c7` |
| `clients/specs/Assets/Materials/Shaders/AdaptiveStroke.customCode.meta` | client-specs | full-text | 16 | `9c77a98c066ecba6857f77b1a9892b5d2485f6adcdf8c062807891f0de064cb2` |
| `clients/specs/Assets/Materials/Shaders/AdaptiveStroke.ss_graph` | client-specs | binary-metadata-reference | binary | `0f47b47e644304559b748e3bce3f25e9e26556d777f82acaab91ce4986f7a678` |
| `clients/specs/Assets/Materials/Shaders/AdaptiveStroke.ss_graph.meta` | client-specs | full-text | 16 | `d488a533c9bc9451f4c88dcb7c8bc994c94b6a022de71cd9df8495453cdede27` |
| `clients/specs/Assets/Materials/Shaders/AdaptiveStrokeVertex.customCode` | client-specs | full-text | 41 | `828ef6ebabd3e28f9361eda6379390de764d19ce17365dab8117e036dfc2bf0e` |
| `clients/specs/Assets/Materials/Shaders/AdaptiveStrokeVertex.customCode.meta` | client-specs | full-text | 16 | `d36d2831abcaa48b45de985b8c51003a52868095178c24ab9ca2cfe8cdb43033` |
| `clients/specs/Assets/Materials/Shaders/ArmFresnel.customCode` | client-specs | full-text | 30 | `a47e70c8649fae88a9e0df50c5db05a612e410564f54ad02f3a2ca8df873b27d` |
| `clients/specs/Assets/Materials/Shaders/ArmFresnel.customCode.meta` | client-specs | full-text | 16 | `96627a1ee17f9064da94282b37280feba24a76b3c63dd2587914e0a4a0003048` |
| `clients/specs/Assets/Materials/Shaders/ArmFresnel.ss_graph` | client-specs | binary-metadata-reference | binary | `b8744309ad3e5aaee7426d9729102e189ac12455f1357996f866c1c5978948a4` |
| `clients/specs/Assets/Materials/Shaders/ArmFresnel.ss_graph.meta` | client-specs | full-text | 16 | `8f4d10adeebf6eb53b6b5b47a66642065ae3efbc9427fd78dcf42a5c02fb0826` |
| `clients/specs/Assets/Materials/Shaders/ArmStroke.customCode` | client-specs | full-text | 19 | `fb0cb4a4846c2c2db982bf54182f32d8797b1bb0d646373b3dbd40d0036e7105` |
| `clients/specs/Assets/Materials/Shaders/ArmStroke.customCode.meta` | client-specs | full-text | 16 | `953ac9a831fc11e532061a85007006d7075c021dca1fea48903f559bad76053a` |
| `clients/specs/Assets/Materials/Shaders/ArmStroke.ss_graph` | client-specs | binary-metadata-reference | binary | `3d757a907d2064d81cfbdfc0d5c0acc3ae02f19628bb8092aa7641c5cf64fd8a` |
| `clients/specs/Assets/Materials/Shaders/ArmStroke.ss_graph.meta` | client-specs | full-text | 16 | `67bae9191f408ae4d15847b5723d39e23712dcb40bc6174bea98492536049390` |
| `clients/specs/Assets/Materials/Shaders/ArmStrokeVertex.customCode` | client-specs | full-text | 83 | `959787cf1b8185484b450a467c16c7dd4a4d62fc697b8ad2de27e15c846fd376` |
| `clients/specs/Assets/Materials/Shaders/ArmStrokeVertex.customCode.meta` | client-specs | full-text | 16 | `0cfa6b7b1979fe6be509384e70bce6d8eb790e8d14ca211efe8cce9b9897503e` |
| `clients/specs/Assets/Materials/Shaders/ArmSurface.customCode` | client-specs | full-text | 7 | `38a22d983b17cb53512c504e6c88c59627154b4da3e22b5b459a0c44301f46dd` |
| `clients/specs/Assets/Materials/Shaders/ArmSurface.customCode.meta` | client-specs | full-text | 16 | `ff81f9a1bd1fb117d12b1f2d6220a4610ca32ed719e0f608d188e388bafcdb36` |
| `clients/specs/Assets/Materials/Shaders/ArmSurface.ss_graph` | client-specs | binary-metadata-reference | binary | `808a463a90ceba5952342825322bbced6ab702c22fc7f396aea18c0f1db9cd7f` |
| `clients/specs/Assets/Materials/Shaders/ArmSurface.ss_graph.meta` | client-specs | full-text | 16 | `d1270b991f511a0bb99ec05639d96e661bc2429ec38ed1f0fb74be13c7385da4` |
| `clients/specs/Assets/Materials/Shaders/ArmSurfaceVertex.customCode` | client-specs | full-text | 29 | `1f171b398a1226356e6048a9a6e3b27deecc892dd118655802e8367b1fddfd09` |
| `clients/specs/Assets/Materials/Shaders/ArmSurfaceVertex.customCode.meta` | client-specs | full-text | 16 | `b0203f4f1a960713487ddac10e370364e48ccf107fe240551df0d8e09f5da50f` |
| `clients/specs/Assets/Materials/Shaders/BendyLaser.customCode` | client-specs | full-text | 16 | `ae07a9e8792c7765ce561c85ec33ec292ba4672cfed750ebda1c228ae0584d6b` |
| `clients/specs/Assets/Materials/Shaders/BendyLaser.customCode.meta` | client-specs | full-text | 16 | `bde45af9c569ce318468e98cbb8f7982a8aed3ef24ba543ab15b9b4cc60798f3` |
| `clients/specs/Assets/Materials/Shaders/BendyLaser.ss_graph` | client-specs | binary-metadata-reference | binary | `06ba46fc0c3afc7daf2e2dc43763ffd7d3809e89d3037b91728481218a13bc92` |
| `clients/specs/Assets/Materials/Shaders/BendyLaser.ss_graph.meta` | client-specs | full-text | 16 | `b9ffcb07be152c77820351d85f0e29c90b4485353a34f405225ffd0f6f36352f` |
| `clients/specs/Assets/Materials/Shaders/BendyLaserVertex.customCode` | client-specs | full-text | 27 | `6b71442a6b48950780d052029656c74d304e83952e767fecb9e769563ef61a84` |
| `clients/specs/Assets/Materials/Shaders/BendyLaserVertex.customCode.meta` | client-specs | full-text | 16 | `4ff0a51711fd9862effb3b49a8a3fc7346e13590ac239a04a8554dfe2a2f9b06` |
| `clients/specs/Assets/Materials/Shaders/LidarDot.customCode` | client-specs | full-text | 9 | `b1707899c5b5474139becba041f885b14d884c94aca614dbe205712ce4c30f67` |
| `clients/specs/Assets/Materials/Shaders/LidarDot.customCode.meta` | client-specs | full-text | 16 | `b00bb0da6e3f40013e80753175fcdcda3045b08bbed8023ca66daaca1c5a57ed` |
| `clients/specs/Assets/Materials/Shaders/LidarDot.ss_graph` | client-specs | binary-metadata-reference | binary | `f58accb5d10496082a39f3e7c3015a1b02459cacbfef3c8a85071b2b156d827e` |
| `clients/specs/Assets/Materials/Shaders/LidarDot.ss_graph.meta` | client-specs | full-text | 16 | `89dbf7855b95ba7fbd7887c4eafcf9167c290e61dc9eb0a5634b0d752491b77e` |
| `clients/specs/Assets/Materials/Shaders/LidarDotVertex.customCode` | client-specs | full-text | 14 | `a49e6755cf5ec01ab7b6ba605d181a669f67b73d72e2007aec6c734a8b4891f5` |
| `clients/specs/Assets/Materials/Shaders/LidarDotVertex.customCode.meta` | client-specs | full-text | 16 | `08955efce6bae48e87618d95d31fe796393d612814ac86ec029ceb5db95575e3` |
| `clients/specs/Assets/Materials/Shaders/PoseIndicator.customCode` | client-specs | full-text | 9 | `f0f9ee3d94dce7731a28c9d18adc1b2776a038d2501c1963671ff09baf10c7ea` |
| `clients/specs/Assets/Materials/Shaders/PoseIndicator.customCode.meta` | client-specs | full-text | 16 | `c48f7c82d62cf845988de23bdd0f82b4ec587df6d2857cc428c0f45c69916046` |
| `clients/specs/Assets/Materials/Shaders/PoseIndicator.ss_graph` | client-specs | binary-metadata-reference | binary | `06edbdcfc09286a19274ade4688bfde2daa64ca61b0ba52747b084b2c01a7dd4` |
| `clients/specs/Assets/Materials/Shaders/PoseIndicator.ss_graph.meta` | client-specs | full-text | 16 | `0361dcd76608dd0c9fadb323c2e3bcd043414f1e1263c05e050949c12ee18b34` |
| `clients/specs/Assets/Materials/Shaders/RobotBoxOutline.ss_graph` | client-specs | binary-metadata-reference | binary | `6a82bb22e3746afa9642f00558853a1f1f4def3c9cd1fc8de8ab3ee871a2d24b` |
| `clients/specs/Assets/Materials/Shaders/RobotBoxOutline.ss_graph.meta` | client-specs | full-text | 16 | `dc083f99c71c4f6c62611b5d976456a26f4aa72a4d58cb1aa62f51a3bef8c901` |
| `clients/specs/Assets/Materials/Shaders/VertexColor.customCode` | client-specs | full-text | 2 | `a713b7ac7dcc982248e9f42003944a70cc3127e3cf8d397a5de3d8611054c688` |
| `clients/specs/Assets/Materials/Shaders/VertexColor.customCode.meta` | client-specs | full-text | 16 | `b8f09a87dfea692de6d2505af13aa800c9f172c23e28a4c2f7beb4fbb3e510a7` |
| `clients/specs/Assets/Materials/Shaders/VertexColor.ss_graph` | client-specs | binary-metadata-reference | binary | `f9fad78c2e0d7be0d9145c60a5eb13ecc210587dabb3424dfd745dcd7d08ba46` |
| `clients/specs/Assets/Materials/Shaders/VertexColor.ss_graph.meta` | client-specs | full-text | 16 | `8174319d03f94fa8d9258716471124feed7a87ad1a2365e44d2006d586dfd556` |
| `clients/specs/Assets/Materials/Shaders/WorldMesh_LocationHighlight.ss_graph` | client-specs | binary-metadata-reference | binary | `bb3477d14de24e6255a6006c08857ba9f74af69db0390e38c801742a62bcce14` |
| `clients/specs/Assets/Materials/Shaders/WorldMesh_LocationHighlight.ss_graph.meta` | client-specs | full-text | 16 | `333ba800c9c282e7ed9d29ab66cb9df9ad0c7d601fd654d6592920c735cd364f` |
| `clients/specs/Assets/Materials/Shaders/unlit_Base.ss_graph` | client-specs | binary-metadata-reference | binary | `5eff4b425dd5d47e4acc3ecf9cc120d4ecee66eacd9095a96764d537131d15ec` |
| `clients/specs/Assets/Materials/Shaders/unlit_Base.ss_graph.meta` | client-specs | full-text | 16 | `2c4035a705b1554a87ad4cf1b8d08dbdc69c3856d9419be142d0888dfa5e1e71` |
| `clients/specs/Assets/Materials/WorldMesh_LocationHighlight.mat` | client-specs | full-text | 150 | `3ac34ade8a1f623406739296630a5f2551eb5d6a394d1cb670eb5330beb8bd29` |
| `clients/specs/Assets/Materials/WorldMesh_LocationHighlight.mat.meta` | client-specs | full-text | 16 | `af8f540d7121034820adc67148787c0670c19a48203de9509e93116043b9cb36` |
| `clients/specs/Assets/Materials/WorldVertexColor.mat` | client-specs | full-text | 25 | `26539b3959ff55de099e08c995eb11bc09081227f0a62c79e1dcc602f5c53d83` |
| `clients/specs/Assets/Materials/WorldVertexColor.mat.meta` | client-specs | full-text | 16 | `368ff143caba5082fbc1b7e39ab972c31b68bf5346008c366c634d3d513149c2` |
| `clients/specs/Assets/Prefabs/AnnotationMarker.prefab` | client-specs | full-text | 27 | `30ea532cc3575fb6030b1fe9da66118ca0b6b3906187a00fd615f624b58d62e0` |
| `clients/specs/Assets/Prefabs/AnnotationMarker.prefab.meta` | client-specs | full-text | 197 | `cf2ec0b4495bf2707d8c524f54fa9c480cbb6bf3e23754cd9d5b2ec2f2184efe` |
| `clients/specs/Assets/Prefabs/NavigationTargetMarker.prefab` | client-specs | full-text | 372 | `4d7afb59ae6481048e2b370dab704da6a0aab50d29c53d2a4c5a72b359f51cde` |
| `clients/specs/Assets/Prefabs/NavigationTargetMarker.prefab.meta` | client-specs | full-text | 666 | `9afcc5727223f43da449a172f8ef4c8806f1a9a44308bd4900a2375342663887` |
| `clients/specs/Assets/Scene.scene` | client-specs | full-text | 3274 | `d34f5ec0cf0757af62bcb95936f35b3c1aed1f53df6a216835c7c99168ab66d1` |
| `clients/specs/Assets/Scene.scene.meta` | client-specs | full-text | 16 | `9b68c8f9352811334c5d16ac6b801533596dc5d0d5d1c0ac5ab92fa928ebde0c` |
| `clients/specs/Assets/Scripts/DimOSARClient/agent/AgentDraftSession.ts` | ClientCore | full-text | 181 | `524bbc900d8ec9069a470437bfc5f96ea4688ff57b6df935104fa84e7cb19be9` |
| `clients/specs/Assets/Scripts/DimOSARClient/agent/AgentDraftSession.ts.meta` | ClientCore | full-text | 45 | `a33da99e94eac1665859c9dcf69b8ec51e8b1e01912296e7de5ea07d8ea18fa9` |
| `clients/specs/Assets/Scripts/DimOSARClient/agent/AgentResponseClassification.ts` | ClientCore | full-text | 29 | `0c9a88c7398012baaa2b23abdf7084c3011c3557ec0ad471237a8f19a80855d8` |
| `clients/specs/Assets/Scripts/DimOSARClient/agent/AgentResponseClassification.ts.meta` | ClientCore | full-text | 45 | `adeae10ba1b29d6a5ece3e2638519d40181f1e40d5bd2d0df3f833b0fb2f9940` |
| `clients/specs/Assets/Scripts/DimOSARClient/agent/AgentSpeechSession.ts` | ClientCore | full-text | 3 | `6507fe9fe99f047d1b59cc2624e2ae411ebbab04b2ac3614cdab28a3e7558cd2` |
| `clients/specs/Assets/Scripts/DimOSARClient/agent/AgentSpeechSession.ts.meta` | ClientCore | full-text | 45 | `de1aaa208a84573e262c75e384e57f91fcca4c4a172ea1c05596fb98fe86917d` |
| `clients/specs/Assets/Scripts/DimOSARClient/agent/ClientPosePublisher.ts` | ClientCore | full-text | 18 | `c332bcc733f693ef394bf5334ba35206f4bd0f76dc3df90c51ec41a2be9005bb` |
| `clients/specs/Assets/Scripts/DimOSARClient/agent/ClientPosePublisher.ts.meta` | ClientCore | full-text | 45 | `9a5f914c501b9e50e6010863e9cbbd4dddaefcbf2d79212a640171d6bdb6595f` |
| `clients/specs/Assets/Scripts/DimOSARClient/agent/agentSkills.ts` | ClientCore | full-text | 77 | `b4e244cc0eed9cb57eb5015d444bdadd0e44c80c6740e7cd46e7411b91263795` |
| `clients/specs/Assets/Scripts/DimOSARClient/agent/agentSkills.ts.meta` | ClientCore | full-text | 45 | `130e2197a3bc609201e7f4595151cafc3ec0b90a8ed888509a2f94a51dd926cd` |
| `clients/specs/Assets/Scripts/DimOSARClient/agent/userMessageRequest.ts` | ClientCore | full-text | 7 | `87df86ac65a6e95c529726534c52fe6c0abf58a97a39ebb55f45fd2edaeee728` |
| `clients/specs/Assets/Scripts/DimOSARClient/agent/userMessageRequest.ts.meta` | ClientCore | full-text | 45 | `295d29741035b61477c8ad3f99d59c8dd2f597a888b3fd9aab1fc36df38e7ac9` |
| `clients/specs/Assets/Scripts/DimOSARClient/localization/HeadsetTravel.ts` | ClientCore | full-text | 27 | `efba0e7235d3798a978e054b80bb1c8e6a59e5eb998d66cea91af2e8a594ce06` |
| `clients/specs/Assets/Scripts/DimOSARClient/localization/HeadsetTravel.ts.meta` | ClientCore | full-text | 45 | `5b893628bb6bfe60cb0521b3f7f740002898ccda25dbe555d8c274ec416e5289` |
| `clients/specs/Assets/Scripts/DimOSARClient/localization/LocalizationTrackingReporter.ts` | ClientCore | full-text | 47 | `43ab327324210506613bb46950fbeafa961196e92a1a8e5c570405b4a4c8f7f4` |
| `clients/specs/Assets/Scripts/DimOSARClient/localization/LocalizationTrackingReporter.ts.meta` | ClientCore | full-text | 45 | `450b2aae0eef622e3880ed276548b1d41aebb7d277f2f320cdac2eef8d95beb0` |
| `clients/specs/Assets/Scripts/DimOSARClient/localization/clientTrackingOrigin.ts` | ClientCore | full-text | 105 | `19838f345d71b87841a284b296a3707287b8cc80099e5311cdafed707fbecee2` |
| `clients/specs/Assets/Scripts/DimOSARClient/localization/clientTrackingOrigin.ts.meta` | ClientCore | full-text | 45 | `1488202d85ffc64edf6522a2ba4e4b77f4e60a21690c9bf1c388c79b28c62e0e` |
| `clients/specs/Assets/Scripts/DimOSARClient/localization/clientTrackingTransforms.ts` | ClientCore | full-text | 188 | `b86e5b2965d4373390833739876e328c296c4e34de35498c45259dbc3dcfadc4` |
| `clients/specs/Assets/Scripts/DimOSARClient/localization/clientTrackingTransforms.ts.meta` | ClientCore | full-text | 45 | `57ba3cb9ce10180a7092d8ed4854b3435b8c1ab3d742c3570cca808867f86019` |
| `clients/specs/Assets/Scripts/DimOSARClient/localization/geometricGate.ts` | ClientCore | full-text | 32 | `6a83f25edcdfa0f03e6ee4480348f588be15a757a5dd77e5bfcac5bcab4f9887` |
| `clients/specs/Assets/Scripts/DimOSARClient/localization/geometricGate.ts.meta` | ClientCore | full-text | 45 | `113265d72441d2d83f9d2b6204bd072e3a2a3dab484311f48b24f3577fc3aa07` |
| `clients/specs/Assets/Scripts/DimOSARClient/localization/localizationCaptureEpisode.ts` | ClientCore | full-text | 583 | `935f25dab01a73916f4a942d34081de997d78e931a038b2a33b3c5daa9a0f98c` |
| `clients/specs/Assets/Scripts/DimOSARClient/localization/localizationCaptureEpisode.ts.meta` | ClientCore | full-text | 45 | `ff0a686318b6e24efc5930df58723983ceacf8ca33ed910d2e24121580aeaf9a` |
| `clients/specs/Assets/Scripts/DimOSARClient/localization/localizationCaptureStatus.ts` | ClientCore | full-text | 42 | `3fc13b12e899f8e1bd04cc43f68eaa9c7d6618a4e6f782de1dbe89c2546b79ab` |
| `clients/specs/Assets/Scripts/DimOSARClient/localization/localizationCaptureStatus.ts.meta` | ClientCore | full-text | 45 | `fde0effaa6b77a770eb335c223cd4b921cb53bfea72b8490d58da07985ffd5fe` |
| `clients/specs/Assets/Scripts/DimOSARClient/localization/localizationSubmission.ts` | ClientCore | full-text | 44 | `5b4eb60ba1acee61e6aebb108417cedc4139007fac7af80bda1899094e8da4ed` |
| `clients/specs/Assets/Scripts/DimOSARClient/localization/localizationSubmission.ts.meta` | ClientCore | full-text | 45 | `c981dd663aea6e0ef625683dfc522abfea0c560773dbd60b5c6a808b50fbecf2` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ArmJointFilter.ts` | ClientCore | full-text | 123 | `6508e0d12439e7ed256880d18584d5d06fb8bcf9757c894038d82e775f7cdc17` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ArmJointFilter.ts.meta` | ClientCore | full-text | 45 | `07816661b8cc5cec52739f46a668443d37ffeea5ca8d6876219ec1ce629494f3` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ArmPresentationSampler.ts` | ClientCore | full-text | 40 | `0d4875afcbc0b2f69b1cbd027a809ab7285560b5c49f613d87a845c9690f20cf` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ArmPresentationSampler.ts.meta` | ClientCore | full-text | 45 | `cbb3e45a586347a83bcb23ddf6805ba347df8a3e7a9df738ccc3d510b5467190` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ArmToolKinematics.ts` | ClientCore | full-text | 30 | `3296bf26d7e9d6bd2ca7ba451ad0641b7f96598902a73c000d15e4f57fb26472` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ArmToolKinematics.ts.meta` | ClientCore | full-text | 45 | `d8be74a3b3828ca751b8de3ebd99885b5ac7191ecf0ae227b233acaf65fd26c1` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ArmTrajectoryProgress.ts` | ClientCore | full-text | 63 | `4f0c8b6ef35054b5d83a82b06911ab8e802d7d2c26395f94aafbe403c463abaf` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ArmTrajectoryProgress.ts.meta` | ClientCore | full-text | 45 | `59e77ea7de5a4080194e23fad98171b451cffb134d1e1e93f830a89efded5492` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/EndEffectorStatus.ts` | ClientCore | full-text | 50 | `9ec39ef78945c22bba2e29c990c249039df5cc03835845ffc92869ec9b7d2b66` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/EndEffectorStatus.ts.meta` | ClientCore | full-text | 45 | `b9ec950057dbe415e4c06f23a73419bfec423a6bd101f7c1d4a215f72af75163` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/JointMotion.ts` | ClientCore | full-text | 4 | `44427e04d2c05194047cb528d31d3d0e1fbdab98341294c7d7644919846811a2` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/JointMotion.ts.meta` | ClientCore | full-text | 45 | `2294cbb85751826214911e5c3098a1a81354d0bd6484efbcc640dd176a041af9` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationController.ts` | ClientCore | full-text | 71 | `dda8f34ab13b494c6f50dc2f9fa68cfbcfddc52ba288b31e2e5dc26636571f04` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationController.ts.meta` | ClientCore | full-text | 45 | `5541dc2fdda5e59d8f3808ab873235e0188b2847fb2ff8c5ebd6265c5aea45cb` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationGesture.ts` | ClientCore | full-text | 21 | `c03bbae185b4460d38445a8b32ac2c411a2cf0e422639ba80eeca7c0f777833d` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationGesture.ts.meta` | ClientCore | full-text | 45 | `1f14ffd0d05342d214f88e44fa50beeec12611eb1935c0f435ace369983faa39` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationInputCapture.ts` | ClientCore | full-text | 42 | `b01a8f175c6e9a0cc54dad0fc7feb7be0a5c5770396b18396c6c607225fdeaa3` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationInputCapture.ts.meta` | ClientCore | full-text | 45 | `6f0d83432745027aba751ac1b8af1f4c4e37983fdd30ed0582a586c69610091c` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationInteraction.ts` | ClientCore | full-text | 1106 | `40fc382a179b2e42bdc759f75dd2f0501536f24a0face732808fbb808a06b439` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationInteraction.ts.meta` | ClientCore | full-text | 45 | `7f99fc707fe98cd4a7cfcb304bb84bc13f55d03e6c081093106df57d20ac5680` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationModelValidation.ts` | ClientCore | full-text | 96 | `090f4da50aa75755bfe68af134578a2386818fe70240884ae2eb9f71489f4cb5` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationModelValidation.ts.meta` | ClientCore | full-text | 45 | `a7c8856a6c4c8a448fad594a70388af0b7156cdb725fe7bc41605bc2bb52d90b` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationPolicy.ts` | ClientCore | full-text | 155 | `2dc9ae7c94711c5af82fd2ced21f25cf5dd957b52d32fe181b0d0120453f2daf` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationPolicy.ts.meta` | ClientCore | full-text | 45 | `05c51d97d609709c0b2682d147c31cef69025dd6242d496d791cd99eef2a1b06` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationPresentation.ts` | ClientCore | full-text | 95 | `8a9f0506f642007e9b6336a88c45aa8046e13b038faf44b23d7b7749f2dd0f1e` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationPresentation.ts.meta` | ClientCore | full-text | 45 | `86cd23bdb1091b78a29aa247e9e2f48d0e8a150689d11dc14017f831a2350052` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationProtocol.ts` | ClientCore | full-text | 222 | `7cb487c58c6610c8006dbf2cc03ea5d942e1f502b005393847993ae6afc43a85` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationProtocol.ts.meta` | ClientCore | full-text | 45 | `5ab430ef22514cf83187dc5ea548da5d371399bb2316944ec5505b1a96a04c4c` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationRequests.ts` | ClientCore | full-text | 85 | `3810bcfe84c103e6ba6456e271c8eb079a9422466680dd12df98b9e6c819e1a3` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationRequests.ts.meta` | ClientCore | full-text | 45 | `15f902b8f38886aa9512015b5c9f434f9eb8da577929b1a4fa8b1b96c846edfc` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationTypes.ts` | ClientCore | full-text | 112 | `cf135f9e15f762391231afebf9e4702176f6f0a16e8f9c9e664d7304b9d1a4d5` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationTypes.ts.meta` | ClientCore | full-text | 45 | `3a629a3fb9af597b47fcb2304c3e55acc16acbc811656e137787e776558b2ad7` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationValidation.ts` | ClientCore | full-text | 29 | `1e13668a44ff3c133067f21927eb4526889e23998510904fb9b94b5b0d329de6` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationValidation.ts.meta` | ClientCore | full-text | 45 | `871b9b7492d9107ba93d9d61117148f52a32251c00d4a586097e0393d1dc2d29` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationVisuals.ts` | ClientCore | full-text | 151 | `eb545b68abd4cdb84a9b8973b56bec8b0319f60cf40d389001ffec4f5f931f43` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationVisuals.ts.meta` | ClientCore | full-text | 45 | `5c63c5839843ab943fc6e75fed6ace2d7f804235310abb2132c852665fc3953e` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ModelKinematics.ts` | ClientCore | full-text | 119 | `991e6bebb1a9e0d6e458d9d22fe8f7d5a371b5cc79f7c641e658010ede450985` |
| `clients/specs/Assets/Scripts/DimOSARClient/manipulation/ModelKinematics.ts.meta` | ClientCore | full-text | 45 | `b95d117ba7c233ea01c2d203153870726c7d9c38628c56f270d957267432603f` |
| `clients/specs/Assets/Scripts/DimOSARClient/navigation/JoystickNavigationController.ts` | ClientCore | full-text | 72 | `df71f12f248bd32e0d34c15fea5b15dd7fd53096e735691c38b9bf9973a89485` |
| `clients/specs/Assets/Scripts/DimOSARClient/navigation/JoystickNavigationController.ts.meta` | ClientCore | full-text | 45 | `fd762bdf8e1f257f173f35ebac56417daa44f6527ef09001e8cec432efc0a995` |
| `clients/specs/Assets/Scripts/DimOSARClient/navigation/NavigationGoalLifecycle.ts` | ClientCore | full-text | 146 | `ef0a1c89ef26638dc504ca6e6933c32f7f4364447cc36d51ee08f42343ff1ca7` |
| `clients/specs/Assets/Scripts/DimOSARClient/navigation/NavigationGoalLifecycle.ts.meta` | ClientCore | full-text | 45 | `acdb2c824279c83cf4b666911f3be6c5f18b903e9ec2aedda9b57c82a1ffb660` |
| `clients/specs/Assets/Scripts/DimOSARClient/navigation/NavigationInteraction.ts` | ClientCore | full-text | 168 | `b34259dee1b4f072e9fbe9c401c45158ccad608d4735515771096a17856c66ed` |
| `clients/specs/Assets/Scripts/DimOSARClient/navigation/NavigationInteraction.ts.meta` | ClientCore | full-text | 45 | `57a13d23dee1a162a73d2fc5f47952a4d5f1afbba8aae46ac327039621e457ef` |
| `clients/specs/Assets/Scripts/DimOSARClient/navigation/NavigationPlacementSession.ts` | ClientCore | full-text | 52 | `ce5951507b5c7884eaa28f26492eac2cfc754a56615d73b42dd376c36580ae22` |
| `clients/specs/Assets/Scripts/DimOSARClient/navigation/NavigationPlacementSession.ts.meta` | ClientCore | full-text | 45 | `0284dc6cefe1881dcd663fde7233d4c3bcc8001ff9d4b28814b9ffe83d63eab9` |
| `clients/specs/Assets/Scripts/DimOSARClient/navigation/NavigationPolicy.ts` | ClientCore | full-text | 33 | `56feeeea15a959db4de718f34b10115f6c11c01f3cd982824807d9189f81648f` |
| `clients/specs/Assets/Scripts/DimOSARClient/navigation/NavigationPolicy.ts.meta` | ClientCore | full-text | 45 | `51174dc79c9b89e13029ffeafd49d85bbca3222cd589cbdf1058013c9933b146` |
| `clients/specs/Assets/Scripts/DimOSARClient/navigation/NavigationPreviewCoordinator.ts` | ClientCore | full-text | 113 | `06c9a4d3089908ee4273d90e1a0c07d6eba20155385261e459af15b56a6ec10a` |
| `clients/specs/Assets/Scripts/DimOSARClient/navigation/NavigationPreviewCoordinator.ts.meta` | ClientCore | full-text | 45 | `c14b266c0ac242133be5743c7ec9d10569b435300b5927231e0f59b0f926bc9d` |
| `clients/specs/Assets/Scripts/DimOSARClient/navigation/navGoalRequest.ts` | ClientCore | full-text | 26 | `82f8f72cf5760c94038f9bb90d8277a673534104b200ecef750539729186fe6a` |
| `clients/specs/Assets/Scripts/DimOSARClient/navigation/navGoalRequest.ts.meta` | ClientCore | full-text | 45 | `bd0383f4d19f6301ff1f656dc0fdad7a126a2404dc25159b0d196623c15f4e31` |
| `clients/specs/Assets/Scripts/DimOSARClient/navigation/navJoystickRequest.ts` | ClientCore | full-text | 14 | `3fc34ae64aab163ffc39cef379bdd1fc0129fcde190e23ff06cfa212165d944e` |
| `clients/specs/Assets/Scripts/DimOSARClient/navigation/navJoystickRequest.ts.meta` | ClientCore | full-text | 45 | `95761ed18cac9ca0d8fdf86b905f48ba70492b012b9b9f25b2a8f0649ace2b53` |
| `clients/specs/Assets/Scripts/DimOSARClient/presentation/CapabilityPresentation.ts` | ClientCore | full-text | 6 | `69cb1477d00a7e83316297c6682b9c72c6f5c914ff332e1722fe656bfb620bf6` |
| `clients/specs/Assets/Scripts/DimOSARClient/presentation/CapabilityPresentation.ts.meta` | ClientCore | full-text | 45 | `7005bf18bdbe3086b0865c5b132c46577dd5569587e664ef82ef5089fa22c5d2` |
| `clients/specs/Assets/Scripts/DimOSARClient/presentation/ControlPanelPresentation.ts` | ClientCore | full-text | 90 | `6355185ddcaafc0f3f6a3722f0910b7becef0dfd78b1fde841d9a36dc8921ffd` |
| `clients/specs/Assets/Scripts/DimOSARClient/presentation/ControlPanelPresentation.ts.meta` | ClientCore | full-text | 45 | `b60067c59b34094eed7e0aa45f02c5f7f46cec49d958c66651943815df85503e` |
| `clients/specs/Assets/Scripts/DimOSARClient/presentation/NotificationCenter.ts` | ClientCore | full-text | 60 | `abb2283074aa476341fac83059725ed255c65710f2f913f08250235327ecd150` |
| `clients/specs/Assets/Scripts/DimOSARClient/presentation/NotificationCenter.ts.meta` | ClientCore | full-text | 45 | `c8965acf3b5f9a804aa62990804c93e6ddaeabc753485e11308a45cf67da0c81` |
| `clients/specs/Assets/Scripts/DimOSARClient/presentation/PanelFrameStyle.ts` | ClientCore | full-text | 30 | `9992117528a55ca887b00ef9e4e05f90880444305bfb37293c7f83687b024178` |
| `clients/specs/Assets/Scripts/DimOSARClient/presentation/PanelFrameStyle.ts.meta` | ClientCore | full-text | 45 | `c521670d2c25b4b4a68a48bd1c53f78403ef1d576ef19d5e50aea39da392a8f0` |
| `clients/specs/Assets/Scripts/DimOSARClient/presentation/PanelHeightAnimation.ts` | ClientCore | full-text | 23 | `8a29c6967604f66bf12da8a92629fa240033ba1ce073f2c662024cfdff23fcdc` |
| `clients/specs/Assets/Scripts/DimOSARClient/presentation/PanelHeightAnimation.ts.meta` | ClientCore | full-text | 45 | `423f5fa75b61426c8d8e842231dd287b1229cc0e93892527904b65cdd9cbb77d` |
| `clients/specs/Assets/Scripts/DimOSARClient/presentation/RobotBoundsAnimation.ts` | ClientCore | full-text | 22 | `3506a33f3006b242ef4c60101780445a50515639b87e4abc30bb51c401673cc0` |
| `clients/specs/Assets/Scripts/DimOSARClient/presentation/RobotBoundsAnimation.ts.meta` | ClientCore | full-text | 45 | `6debd921396fc97e2bd187cc94d2144c1696673c8b9ab0d6cf2e59d32ea281f4` |
| `clients/specs/Assets/Scripts/DimOSARClient/presentation/RoutePathGeometry.ts` | ClientCore | full-text | 166 | `25690718a4adfbddaf52049b1833b12f8faf2a18ae242cd4cb7435f8c38dba7e` |
| `clients/specs/Assets/Scripts/DimOSARClient/presentation/RoutePathGeometry.ts.meta` | ClientCore | full-text | 45 | `de4e2d627657ac0283a8e50557a38fb82ac5ae66ff8e26e704872dfe7e27ba5c` |
| `clients/specs/Assets/Scripts/DimOSARClient/presentation/SetupFlow.ts` | ClientCore | full-text | 41 | `906b51b5917231ed9e29af5a9d650ee5f1b43cb636299942aeaa66da818b0cc0` |
| `clients/specs/Assets/Scripts/DimOSARClient/presentation/SetupFlow.ts.meta` | ClientCore | full-text | 45 | `60218e656a3b6545caac4db997862b56e3fb75b425a8e3c153e0a02487d1880f` |
| `clients/specs/Assets/Scripts/DimOSARClient/presentation/WorldVisualStyle.ts` | ClientCore | full-text | 102 | `ed7af838b5bdceb1ba21264e5f00fa9b8e23c9b04cc7cb46d728a5b8b71b90f6` |
| `clients/specs/Assets/Scripts/DimOSARClient/presentation/WorldVisualStyle.ts.meta` | ClientCore | full-text | 45 | `b4b465d1112d5317609118ad03500f194d1e3695e4f889e3265d40887ec343b0` |
| `clients/specs/Assets/Scripts/DimOSARClient/replication/CollaborationController.ts` | ClientCore | full-text | 308 | `9751643f3534cba323bdfb2ed39c92fa13558afcf08ea1c01c88d533c4382e60` |
| `clients/specs/Assets/Scripts/DimOSARClient/replication/CollaborationController.ts.meta` | ClientCore | full-text | 45 | `9ecae2c374b5861532b304041a52f6fed48c67b188412bc119a6afdebf870173` |
| `clients/specs/Assets/Scripts/DimOSARClient/replication/CollaborationTypes.ts` | ClientCore | full-text | 59 | `2c1c084a2a5ebae3bc7ff60984f70d325ab35370be4c970a8ac8ffe686d51327` |
| `clients/specs/Assets/Scripts/DimOSARClient/replication/CollaborationTypes.ts.meta` | ClientCore | full-text | 45 | `441fade1afc40bd6f39b6cb97be42cb4ddc4e0c343203ee0709d58ef42ecda51` |
| `clients/specs/Assets/Scripts/DimOSARClient/robot/RobotMarkerState.ts` | ClientCore | full-text | 71 | `2f7ecd2c104160d34631d7972c2b8ebad78fdf77cc91d2d7396e88cfbd8ec90d` |
| `clients/specs/Assets/Scripts/DimOSARClient/robot/RobotMarkerState.ts.meta` | ClientCore | full-text | 45 | `3efebd0adeca99ec86f2942d47543f064b3ea0ecf5fd6a238be073bfd2b1edc9` |
| `clients/specs/Assets/Scripts/DimOSARClient/robot/RobotSelection.ts` | ClientCore | full-text | 22 | `ca0669a22938bb711f3a70e77cee6ce3cff60ac8add443d53fa17f9b09b3a3c8` |
| `clients/specs/Assets/Scripts/DimOSARClient/robot/RobotSelection.ts.meta` | ClientCore | full-text | 45 | `cdfc21cfe562e68a3b0b550b3b1211cd9cb0df12373eec820e57ebaa4ddcbc38` |
| `clients/specs/Assets/Scripts/DimOSARClient/sensors/LidarDisplayController.ts` | ClientCore | full-text | 46 | `39e54fe68150b4d47b07f5a2ac44558c5942d953c5584d6f6512de041f543133` |
| `clients/specs/Assets/Scripts/DimOSARClient/sensors/LidarDisplayController.ts.meta` | ClientCore | full-text | 45 | `b273be057f1a6986ae43c89814f555e7bdd2f7cc05178636397bd961774d190b` |
| `clients/specs/Assets/Scripts/DimOSARClient/sensors/lidarColors.ts` | ClientCore | full-text | 26 | `c540ca3f6dbbddf1136cacd3d8545dec249b3e495d9facfea1080105aee94fd3` |
| `clients/specs/Assets/Scripts/DimOSARClient/sensors/lidarColors.ts.meta` | ClientCore | full-text | 45 | `171e6b06f59433132fff21bc08b0a38379d5dc7a3cf0d54eb05920382cba174c` |
| `clients/specs/Assets/Scripts/DimOSARClient/sensors/lidarDisplayPreferences.ts` | ClientCore | full-text | 14 | `619d4a40702539dbc4785311f88e1ed34a271688d903ef04dd50f385f0cec286` |
| `clients/specs/Assets/Scripts/DimOSARClient/sensors/lidarDisplayPreferences.ts.meta` | ClientCore | full-text | 45 | `7f0b7d1f2a8e638161a15f5617c8df18f2211037ff5e57462ab4784bf4502660` |
| `clients/specs/Assets/Scripts/DimOSARClient/sensors/lidarSettings.ts` | ClientCore | full-text | 61 | `1502508f5cad0e21ea6bc318a4a6b7d612905109d2cb416268720ef5a46f90b3` |
| `clients/specs/Assets/Scripts/DimOSARClient/sensors/lidarSettings.ts.meta` | ClientCore | full-text | 45 | `046d3cc7ebfdfeaa09e7f2dd1fdc4426f0719f8aef4bdd31d5ed3dcd59af578d` |
| `clients/specs/Assets/Scripts/DimOSARClient/websocket/BulkTransfer.ts` | ClientCore | full-text | 353 | `8c17af931d22134f2d2c92b58d9a8c53be94cb9eefadc268ec5ca0ed8fed59a1` |
| `clients/specs/Assets/Scripts/DimOSARClient/websocket/BulkTransfer.ts.meta` | ClientCore | full-text | 45 | `85b38c21e841125acd7be59507378fd67a4284a962d93826c2a4faffcafbea9b` |
| `clients/specs/Assets/Scripts/DimOSARClient/websocket/DeferredAssetReplies.ts` | ClientCore | full-text | 67 | `f498e7e019dac9069db1ee489cd4205e5edb996593b76e4ce8d1041a14f52904` |
| `clients/specs/Assets/Scripts/DimOSARClient/websocket/DeferredAssetReplies.ts.meta` | ClientCore | full-text | 45 | `da51b615a34662f3643fe41dba697a53a9a475e4ac745f8112d8cf4f2b34a0f0` |
| `clients/specs/Assets/Scripts/DimOSARClient/websocket/arModuleSession.ts` | ClientCore | full-text | 714 | `b450feff759df192ac6c24d86e7f5185084dcdf104a123fecd9965488190d370` |
| `clients/specs/Assets/Scripts/DimOSARClient/websocket/arModuleSession.ts.meta` | ClientCore | full-text | 45 | `967165e1967419849bc14a3d671e52ee2ba2c53e52ff6d9864d575d427440bee` |
| `clients/specs/Assets/Scripts/DimOSARClient/websocket/connectionPin.ts` | ClientCore | full-text | 1 | `862d30cfcf7d489b33da6ad4a64f27667bf4c72d2b44a222949090742708da66` |
| `clients/specs/Assets/Scripts/DimOSARClient/websocket/connectionPin.ts.meta` | ClientCore | full-text | 45 | `c2a8c8b8edc8ec454f8bc6cab93538daf509bfb9825a935637f8edf7f1e4e4d8` |
| `clients/specs/Assets/Scripts/DimOSARClient/websocket/hostNormalization.ts` | ClientCore | full-text | 65 | `05983a9db4ee807cf52264c401633f7323808b8c5ff5261a241cf4fc3fcc25d5` |
| `clients/specs/Assets/Scripts/DimOSARClient/websocket/hostNormalization.ts.meta` | ClientCore | full-text | 45 | `88e1fdd8579412ee49883ed1b7cd27821887cd2492f04ad9c3b37c863b3f2ef3` |
| `clients/specs/Assets/Scripts/DimOSARClient/websocket/hostPorts.ts` | ClientCore | full-text | 63 | `5b5100389017845e4989ca8d301347bf4dfb52ff32d774132815e7e6be8c6874` |
| `clients/specs/Assets/Scripts/DimOSARClient/websocket/hostPorts.ts.meta` | ClientCore | full-text | 45 | `875936d5ba3924da9dc6258303bbcb4ece01ef932769d66b5d85c3029f5b8cb6` |
| `clients/specs/Assets/Scripts/DimOSARClient/websocket/protocol.ts` | ClientCore | full-text | 1059 | `622e63027d936be304ee76ced501ec64abc8bd3a11adfe67fa50cc4e2e69e30f` |
| `clients/specs/Assets/Scripts/DimOSARClient/websocket/protocol.ts.meta` | ClientCore | full-text | 45 | `1270ecd3ce6d219932117b0f719b63e3637d5bb19f3e8e5456cda28e042ee405` |
| `clients/specs/Assets/Scripts/DimOSARClient/websocket/protocolTypes.ts` | ClientCore | full-text | 339 | `7dc5cbe3096e4adc5fdb9dc7b5b973710d669a8475be2988bcb43d1ff2b1fc64` |
| `clients/specs/Assets/Scripts/DimOSARClient/websocket/protocolTypes.ts.meta` | ClientCore | full-text | 45 | `c5fb2a2f43f3e341435708fbdec7d92fef25d42356b1351c5bd77ce1c7bf5dc0` |
| `clients/specs/Assets/Scripts/DimOSARClient/websocket/sessionLinkStatus.ts` | ClientCore | full-text | 98 | `a752d024b5084883c5cc0f0963274909a83e7391de749f49253cc2d64c18727f` |
| `clients/specs/Assets/Scripts/DimOSARClient/websocket/sessionLinkStatus.ts.meta` | ClientCore | full-text | 45 | `727669368cae6347d648bb24b357604a2d704a65d0bfddf010fc53d2c27e50cf` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/DimOSSpecsClient.ts` | client-specs | full-text | 453 | `3f554d2b09d09b990d49a653a4c0e12b1cd21fc14a04216706b930fd0bdc50d3` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/DimOSSpecsClient.ts.meta` | client-specs | full-text | 71 | `4c6777aa44872102a84b26ef6f00eb518dd65b0e73d74a2e841686995bca0209` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/IpRelayClient.ts` | client-specs | full-text | 66 | `cf367c6aef8bf4f9b511a9fab25a75d7731ef4da05963e067cc04457eb04ce50` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/IpRelayClient.ts.meta` | client-specs | full-text | 45 | `fcf3112c1696d90e732fd011dac279c3b1318219c1ad01a00dafad88e683ec14` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/agent/AgentSpeechController.ts` | client-specs | full-text | 108 | `38f2a005a5ab9d8291b716b8ad75dd00ffc022cf773ed9b38442e347e4656d3c` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/agent/AgentSpeechController.ts.meta` | client-specs | full-text | 45 | `1024b1e28ad0019dcfebc6816426780d96001b042891d062ad5868b7b27e4fbf` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/localization/SpecsCameraSource.ts` | client-specs | full-text | 253 | `e625460585d47339d79c6e03e4e285e8ca4ea8edbb4ba5bc2f88d1a996ade679` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/localization/SpecsCameraSource.ts.meta` | client-specs | full-text | 45 | `261fccf50fb1904358b2ee7bb639ac04890d97ed478849873b77bf71b6573301` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/localization/SpecsCameraStream.ts` | client-specs | full-text | 182 | `dc467c2a4b3df59777cb42cf42be465c785367470316d3f106883b824ebc2e4e` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/localization/SpecsCameraStream.ts.meta` | client-specs | full-text | 45 | `5408dc4444ed55f83b466099eb279bf95ad0206cdd35f802b2abf1c5cf853be9` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/manipulation/ArmControlsView.ts` | client-specs | full-text | 95 | `358ffb6725e37a17e5ade3dba2ec7d112fc450530e5ccc15a32fd5e4f898582b` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/manipulation/ArmControlsView.ts.meta` | client-specs | full-text | 45 | `164d915be66f1f0d2812da04af81365c2ab48cb7bf616bf503a16af17b1595f5` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/manipulation/ArmMaterial.ts` | client-specs | full-text | 80 | `793911973d4f592c6e416677aa290767362cd5fb415411509427894dc0580b11` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/manipulation/ArmMaterial.ts.meta` | client-specs | full-text | 45 | `7f243b46a13d20db476124db13f1af43f8ac76deba355442d059e338d7347e2f` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/manipulation/ArmStrokeRenderer.ts` | client-specs | full-text | 51 | `842998f498db9a0681a14ff84af6fc7bac20479d67dcc1ff432d3b822bbfcd25` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/manipulation/ArmStrokeRenderer.ts.meta` | client-specs | full-text | 45 | `86bf86e016e0e977441a4d482bedc428c3fc996088119a631087e35d0b055edb` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/manipulation/EndEffectorStatusPill.ts` | client-specs | full-text | 27 | `c2dc0d49e3c6987ef45e97573bdeb766c0acc68c22746b804c400f737f337114` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/manipulation/EndEffectorStatusPill.ts.meta` | client-specs | full-text | 45 | `52f1d8de706948e0781b4353d47eb508db0016b0de8d814724a18e16c4f969df` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/manipulation/ManipulationRenderer.ts` | client-specs | full-text | 379 | `1c0df9c56ca11fb6034ef10be4bdcc51cc3a04f68102def96038b26460f1c658` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/manipulation/ManipulationRenderer.ts.meta` | client-specs | full-text | 45 | `32807a1d72510eeae2ffaa67947540aabb1a94d71b6956710ad4ef617dc538b1` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/manipulation/OpenYAMMesh.ts` | client-specs | generated-structure | 13 | `1c5d5fdff93634032d7e2b6f9f83c74cf8bd298d476da8aff9695eb369f77b8c` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/manipulation/OpenYAMMesh.ts.meta` | client-specs | full-text | 45 | `67eec600978e8736df3587535b6477ff526a8eeb61191b6c8b9f79b566d95439` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/manipulation/SpecsArmPanelPresenter.ts` | client-specs | full-text | 82 | `81485b587c3379b6f1a3c488781e9f755529ea7a889da4ff9b8c82334c1001b7` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/manipulation/SpecsArmPanelPresenter.ts.meta` | client-specs | full-text | 45 | `0a85254608027a7a49efb202038f1a3e3ce8f253f0caaf205acdc48ef5225d90` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/manipulation/SpecsManipulationController.ts` | client-specs | full-text | 72 | `115ba567bc1ac2ab09204e96cf5ced5567846cb5ef05cf5368e534b6f749b0bd` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/manipulation/SpecsManipulationController.ts.meta` | client-specs | full-text | 45 | `dd7cab5f5522a78f3eb8fb2d83a0445c60003c374352d6686e2ecb6238e27ece` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/manipulation/SpecsManipulationInput.ts` | client-specs | full-text | 70 | `8078f7ed47b3d64bff37a5bf1ad719844026ce1e63233c2ecf178dfe930dd8c9` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/manipulation/SpecsManipulationInput.ts.meta` | client-specs | full-text | 45 | `74178cb6af283b01f24d4134429351130be74d4143d539f3a0ec2fa466c5da7d` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/navigation/GroundPlacement.ts` | client-specs | full-text | 77 | `684cede2f71257dd8a0288d0c796c5b9551e9a72c0b5c8b15026b3988358926b` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/navigation/GroundPlacement.ts.meta` | client-specs | full-text | 45 | `9aa7ce97591e1a8d147c0899888d9ed9fa29df33b316bd9e67020f9184b64ec2` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/navigation/NavGoalMarker.ts` | client-specs | full-text | 258 | `819305f72d5d25e9d22cf4fb9d6ff1c978441eb71b7032c4666b1e4f6a52d911` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/navigation/NavGoalMarker.ts.meta` | client-specs | full-text | 45 | `913972b7e4e7feaea791283a53cb36a28372c94749a65558cded3003d7acfce0` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/navigation/NavigationController.ts` | client-specs | full-text | 263 | `619356595d6025c0e63d5579511084b1470122447efb30771b8e41e98ca9d44f` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/navigation/NavigationController.ts.meta` | client-specs | full-text | 45 | `03979c2b9ae34cfcc869648a971626413871c115eb4fdc9171b493e5386eb370` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/navigation/NavigationMarkerRenderer.ts` | client-specs | full-text | 130 | `2cf8ddc467863c3cfdff1bda87bfa2f2c21d4843e89a4a287d106a405a64e4df` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/navigation/NavigationMarkerRenderer.ts.meta` | client-specs | full-text | 45 | `8924fe0c8623512bf0b8ebaca311dbd1b2516eaa76f09d13e7a5940c548e3d62` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/navigation/NavigationRouteRenderer.ts` | client-specs | full-text | 83 | `53e02d0c08844f1075cb485b0d4891565f4045911e70558e2389b5ed000f6787` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/navigation/NavigationRouteRenderer.ts.meta` | client-specs | full-text | 45 | `f72a6150ac5092d61297a530e5f4f47c4b719fda4bf14b0039dd2aefc11dabdc` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/navigation/SpecsNavigationInput.ts` | client-specs | full-text | 93 | `939a48a4748a61d4cbd672ead2d4520d2b73a0b00f51726f46b87f79f36556a3` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/navigation/SpecsNavigationInput.ts.meta` | client-specs | full-text | 45 | `c9b5347316d090a4b9208e2ab6654a4b34bd2a793563c41f5af36b7bba773e31` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/ARMarkerPresenter.ts` | client-specs | full-text | 125 | `4cd76a1d685e959036355a88f317550bf678556f496fad79c3eb0e2e74bfb2ef` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/ARMarkerPresenter.ts.meta` | client-specs | full-text | 45 | `0798dd4e8db84211b1b75e4c5ff1a526cc18f34757c437b1bcea251dcdcbaa86` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/AppState.ts` | client-specs | full-text | 6 | `3aff5e8bba7260648dc0e1594bb0eee61c30e530259d688f0a5642dc4e4dc6d5` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/AppState.ts.meta` | client-specs | full-text | 45 | `98cf3f48034092d4698cdf96cb03299309fb48d61e09563e56fa9c2d9498aa25` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/BendyLaserRenderer.ts` | client-specs | full-text | 89 | `f192d54c8e27a1f8666884c969352c348526b6065f53b8e9f4a237382437924e` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/BendyLaserRenderer.ts.meta` | client-specs | full-text | 45 | `3d82f920399e23ba502dd12b136cf17379dce5b8ec43add4012d8c6e43b454c3` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/CursorLaserGeometry.ts` | client-specs | full-text | 39 | `fe9fa357c7fee2df62ffd73672714573861e75a30eceda8714c985b6437c9a38` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/CursorLaserGeometry.ts.meta` | client-specs | full-text | 45 | `f4822598acc83a32be126f1000897a9d2cdabe7171d87d15cda15d9174cf3d1e` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/MainMenuView.ts` | client-specs | full-text | 396 | `bb56ffd51c354bf5865aa2647712c6f5deed213d9acc2d2662df6db907c94f84` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/MainMenuView.ts.meta` | client-specs | full-text | 45 | `d856999d2a71445b64271f856621b624989aabbe16257f1d56802c81652cfc7c` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/NativeTextField.ts` | client-specs | full-text | 85 | `b39b7debbd022a3580afa529c8006752c42d224ff044524248aefdb34874e547` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/NativeTextField.ts.meta` | client-specs | full-text | 45 | `a86d59877cdad93d9285cf07b82b7c028bb6428aaea4fc3e87bbcabaacadfa20` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/PanelHeightController.ts` | client-specs | full-text | 96 | `264b18132ee6571b797caa14fb8e295ba18fa11bfbc54c601adf826436c96a12` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/PanelHeightController.ts.meta` | client-specs | full-text | 45 | `d5dad94f49c168ac1ba9b35b1fbab56cd530337cdbb71b96bb23c1c94a22abd3` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/PanelLayout.ts` | client-specs | full-text | 36 | `e1672fd4237291785b2e379943167437f44a240119bbc2f29f1a9f3355d9c17c` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/PanelLayout.ts.meta` | client-specs | full-text | 45 | `5f7a40204b802a68315bda1db8d9b76a053f76baa2f89928aa599e3786c11200` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/RobotPresenter.ts` | client-specs | full-text | 371 | `e483d2ea05af509b79179ca353582235404c86500fc3fd48ff97053acf361e86` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/RobotPresenter.ts.meta` | client-specs | full-text | 44 | `2f8d5343571aef366bc154b540ac9e3b86378cb299cee3653c04031eb89005d6` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/RobotWorldRenderer.ts` | client-specs | full-text | 137 | `97553b0db2dcc4dcbaf87649f6e7922c81ee16f57a4b34e72b21831db8f47d04` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/RobotWorldRenderer.ts.meta` | client-specs | full-text | 45 | `8f6992ea0985fa887fcbcee9231abea9f977bc2e824b947deb6531d99af53982` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/SetupWizardController.ts` | client-specs | full-text | 497 | `fba31cb24a1a97433b2c2819d3b44903e4f1e8e08029a6d0a88c546754370561` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/SetupWizardController.ts.meta` | client-specs | full-text | 45 | `1272a5062d9eb31fd3c161952f3f4ce50eed9cc4615b4167bbad174c49bfa08a` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/SetupWizardView.ts` | client-specs | full-text | 398 | `374a434a1d64e90ce68b8d27b98a94f7c69f8dd8275b90cb93a2e484e69d8a84` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/SetupWizardView.ts.meta` | client-specs | full-text | 45 | `06fa8c105d994e8495464cb396d2b9d20986a7016a5e1799daa0d3006915fcdf` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/SpecsConnectionController.ts` | client-specs | full-text | 169 | `81a13f51f17b94029c0fc6783a4965ca5044911a4a226bde080d8807184fb30c` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/SpecsConnectionController.ts.meta` | client-specs | full-text | 45 | `cf3ccf82d13c3e11ac4352d75099559124a277cfd8d10ab7da26bb109cc4f2fa` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/SpecsLaserInput.ts` | client-specs | full-text | 37 | `f14df37f9b974702764245db4881e8d02f768368d920ff011479bc9db2e7001a` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/SpecsLaserInput.ts.meta` | client-specs | full-text | 45 | `c992898c9dcc8587bd8a00aa44b5d55d14357d21327a865a9433e314db7d5b9f` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/SpecsLaserPresenter.ts` | client-specs | full-text | 43 | `7da6003d43f51061b5775e3319dd9c289aae36445271c1479ef27da810d100bc` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/SpecsLaserPresenter.ts.meta` | client-specs | full-text | 45 | `46ce6689189ca2c2660f4b55451ae70493b83dc18c3e6516cddd22c2da8c5dab` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/SpecsTargetPriority.ts` | client-specs | full-text | 53 | `8ec164644b9df2c0944ad9d3fb02fc1abeaa5b242aaba85f7ab8b9d304680c76` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/SpecsTargetPriority.ts.meta` | client-specs | full-text | 45 | `a31bd981e97abcdc23c6175fd381e714f657d604ee0f68891abc485bc2b13ff5` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/SpecsTextToSpeech.ts` | client-specs | full-text | 112 | `3968415149683a59c972b39308a5b32011aa2a1bff8528ddf27ca1b414a56a61` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/SpecsTextToSpeech.ts.meta` | client-specs | full-text | 45 | `37d1a84855f1903706c14ce5a6d9b968f11d4f12f5729c45a7449fc29283db77` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/SpecsUISnapshot.ts` | client-specs | full-text | 34 | `bfc3998cf07d771e56889ee3d423b26ade5da5ea75355af56bd771fbc34c0907` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/SpecsUISnapshot.ts.meta` | client-specs | full-text | 45 | `c90b703baf1cdf62b72847c2c7c965ad5702e983ba252b3d399511f94a1e1b6b` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/UIKit.ts` | client-specs | full-text | 351 | `a8f059500be9ccb80e095336bf30e10ca37e3541cf31b6b466db930a7472b44d` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/UIKit.ts.meta` | client-specs | full-text | 45 | `2b689679cd33f19c1cc0f20de9af22780aec36d38ce8f2d6f4966e8c2e50a18d` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/UILogger.ts` | client-specs | full-text | 26 | `178e046911886158bd86f2a5f475abc6e839660af76547b07b5ebd9b17fb10e3` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/UILogger.ts.meta` | client-specs | full-text | 45 | `bea23a8c987d8a689eace1a33a1fdc9ee07fc82ffc4f6ed2bf5d37ace4d0cbce` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/UIPresenter.ts` | client-specs | full-text | 573 | `8219006be4758ee6fbb456a2fbafe62171607db2b2645b406d0dcf5ea2bf860b` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/UIPresenter.ts.meta` | client-specs | full-text | 50 | `3cd11f40c86d6842e72eff206a5fee9e21de450fbe0c8a4e9953a87a69168584` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/ViewerNotificationPresenter.ts` | client-specs | full-text | 73 | `7b61422c3f7b5384f878d2f6d6bb2b0e421cc507c87ecc87b97786574b1e846b` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/ViewerNotificationPresenter.ts.meta` | client-specs | full-text | 45 | `0f7e61082c585198dc96bb43e08a78219e333f766eb79eff518f8770d3ebf718` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/WorldMeshRenderer.ts` | client-specs | full-text | 180 | `92cabcdcdcca34b475136dcba1fd6eaff3907c75780c7d68938e57d824583115` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/WorldMeshRenderer.ts.meta` | client-specs | full-text | 45 | `80d0d850484e5f6b226ebd773643bffc9cb69fb5ce2644e7e4349b74d5b5dc25` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/WristMenuController.ts` | client-specs | full-text | 251 | `d7b4306627c4fd65218cb92ad4c5eecac25ab4ea696ecffe4dc274f147319340` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/presentation/WristMenuController.ts.meta` | client-specs | full-text | 45 | `6e8729f21358f4da036773674fd2897fabad8d98db73ca2a49e8885a5102e09a` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/sensors/PointCloudRenderer.ts` | client-specs | full-text | 117 | `34bca9f7b43234458cd89ae0c7c0a079767006009e3ee42e3c418d4e0ffce22c` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/sensors/PointCloudRenderer.ts.meta` | client-specs | full-text | 44 | `2230fd722ef1556286048d03c88a7d9d362e44fd56a9dc197bae222f202b5916` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/utilities/AnimationUtilities.ts` | client-specs | full-text | 129 | `78460a35a8baf30e2993f7f6b98012e3fc2a791a93e50c1d4db5e8f0bb78a571` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/utilities/AnimationUtilities.ts.meta` | client-specs | full-text | 45 | `71dafe00cfeaacab6251998102cfbe482494be77f79531547ada4c812d458e59` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/utilities/RuntimePoseSmoothing.ts` | client-specs | full-text | 55 | `a83982b5979d7821a63d311671e1139054c9897aa993c542ff9405fa8f9afdd3` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/utilities/RuntimePoseSmoothing.ts.meta` | client-specs | full-text | 45 | `709b818de30f65b06b00a1affab864282c1b1a7e16e13bf0b6237abca9041088` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/utilities/SpecsCoordinates.ts` | client-specs | full-text | 188 | `bd10020f325b985b522f7317501edac9e3e3b5708a18309add9f39e16f96a231` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/utilities/SpecsCoordinates.ts.meta` | client-specs | full-text | 45 | `b51c3b9a2a02a59b9b61a20f6ea7f1ab1572cd74a83a0263a633f67b2cd90745` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/utilities/SpecsUtilities.ts` | client-specs | full-text | 71 | `61a6a2975b7c11f38e3463dd01eea8438b733a99bf945a30fd277587dcc63c27` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/utilities/SpecsUtilities.ts.meta` | client-specs | full-text | 45 | `dfadebb88c9d7e3650f08b35b68a52f5156cc0cd743e479d8b265c211077692a` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/websocket/SpecsWebSocketTransport.ts` | client-specs | full-text | 321 | `22e1f311bfb1b937cdce9c198e798cc18ae36a32d618988481fdbc914d51dd7f` |
| `clients/specs/Assets/Scripts/DimOSSpecsClient/websocket/SpecsWebSocketTransport.ts.meta` | client-specs | full-text | 45 | `3469e2792946e917512bc17fd5a56a8e4df9d0033d188b3061535e12d3a120fa` |
| `clients/specs/Assets/Scripts/Integration Test Harness.ts` | client-specs | full-text | 14 | `f74a7689bcee6aa77cd9e014ce6c3cf55c9017ac84f0665387fb73da6b92190e` |
| `clients/specs/Assets/Scripts/Integration Test Harness.ts.meta` | client-specs | full-text | 44 | `4ae755f7a8303dfa2d9d8b4764cd4dc91373d2713c656ad367dbafafee92c0c6` |
| `clients/specs/Packages/SnapDecorators.lspkg` | Tooling | binary-metadata-reference | binary | `a2eec9859ef3763bfd3d0157dd1d2d83fd18b64607a15368a0df078894dfd6f4` |
| `clients/specs/Packages/SnapDecorators.lspkg.meta` | Tooling | full-text | 16 | `46dc1f76c83e8c8320490c7c886ba9310a26e45604db5d66891fd70aeea66b21` |
| `clients/specs/Packages/SpectaclesInteractionKit.lspkg` | Tooling | binary-metadata-reference | binary | `a04bfecd7c00b441065bdaeb7786df6a28533824549d9c26a060668558a51630` |
| `clients/specs/Packages/SpectaclesInteractionKit.lspkg.meta` | Tooling | full-text | 16 | `fa387dd74656b72dbcbb5139b32081266a1e78ab4538ce3be1777ecb762d7ae2` |
| `clients/specs/Packages/SpectaclesUIKit.lspkg` | Tooling | binary-metadata-reference | binary | `69b278148a0b96cc4963093798aef2cfbe66cf7b061284ed58041679fdc02f65` |
| `clients/specs/Packages/SpectaclesUIKit.lspkg.meta` | Tooling | full-text | 16 | `f62cc5ae6808f39d9a07de48b8cadef95f762fd273530df127fcf9f8c3a182e3` |
| `clients/specs/Packages/SurfacePlacement.lspkg` | Tooling | binary-metadata-reference | binary | `71007c585c4759208e3fc45e1350cf45311c17d556ea2aa177edf87d0765483c` |
| `clients/specs/Packages/SurfacePlacement.lspkg.meta` | Tooling | full-text | 26 | `1a06c1e11172d087d934842329d5aa7e5efa346b051ed4f6bb2e5d39dc1977a1` |
| `clients/specs/Packages/Utilities.lspkg` | Tooling | binary-metadata-reference | binary | `d2271416d5ad92b862556937dcc1290b7cd263631a5a1a284f3f915f7f169bb1` |
| `clients/specs/Packages/Utilities.lspkg.meta` | Tooling | full-text | 16 | `a7df9f5103a1a14b9d131610d2cfa3e77a98b16b7ce80a04186ac86a01461476` |
| `clients/specs/Tests/DimOSARClient/AgentDraftSession.test.ts` | ClientCore | full-text | 166 | `c6e0d4485a8e929953f3942668aa2a014c937953630f619f7c9d548f3c6d7c23` |
| `clients/specs/Tests/DimOSARClient/ControlPanelPresentation.test.ts` | ClientCore | full-text | 52 | `be6120eabb7620ec198b508d4945993a19748cc686745ada7f0091d63801c869` |
| `clients/specs/Tests/DimOSARClient/NavigationInteraction.test.ts` | ClientCore | full-text | 362 | `02a02b9887e906f0c29e7aa9dfe2083820e76f9a834ae94a6a6b094d8b5c2085` |
| `clients/specs/Tests/DimOSARClient/NavigationPreviewCoordinator.test.ts` | ClientCore | full-text | 88 | `a58593848cfcb8563af6dc9c0722f0da51fe2dcd9880e3cb71788c58aeb93a8c` |
| `clients/specs/Tests/DimOSARClient/PresentationPolicies.test.ts` | ClientCore | full-text | 86 | `4474008cf9b3b7701e7a91a332d340ec8f7d3927ea15dc41c21024f17a9c4f89` |
| `clients/specs/Tests/DimOSARClient/RobotSelection.test.ts` | ClientCore | full-text | 13 | `8aaa7d98e987a52f0f790790f9453bd65420cdd7c5e931bef92af80739854abc` |
| `clients/specs/Tests/DimOSARClient/agent/AgentResponseClassification.test.ts` | ClientCore | full-text | 32 | `1c1874292eb8ffa7288db96628398ccde71ac180469e6afc497c1edc9e57c1fd` |
| `clients/specs/Tests/DimOSARClient/agent/AgentSpeechSession.test.ts` | ClientCore | full-text | 6 | `37db7d9c9e1f03dfd9de3b047fa85352e7c3de9922875dce1aa968bbe1e0a6cc` |
| `clients/specs/Tests/DimOSARClient/agentSkills.test.ts` | ClientCore | full-text | 69 | `6cf6772646801589c8a3f5a347c9563fb3b3ef31bf6b71a2734490a3db507e1b` |
| `clients/specs/Tests/DimOSARClient/architecture.test.ts` | ClientCore | full-text | 72 | `a94e655af938c108bd50458112471e2f3a771e9767914b7e096c85a3fc9ab052` |
| `clients/specs/Tests/DimOSARClient/connectionResolution.test.ts` | ClientCore | full-text | 7 | `da2d758ced413d09d7a3611a76ebb57c25ff094681a81cc98411d34120121e86` |
| `clients/specs/Tests/DimOSARClient/lidarColors.test.ts` | ClientCore | full-text | 15 | `43a2c2f608a58f5457bc19c862b77cfdf98d3fea02f84acb372ea64775f4685c` |
| `clients/specs/Tests/DimOSARClient/localization.test.ts` | ClientCore | full-text | 1128 | `254114c3b9516bf508f853549c48001e5e0d392569c300addcb940a0e235dbda` |
| `clients/specs/Tests/DimOSARClient/localization/TrackingReferences.test.ts` | ClientCore | full-text | 135 | `5941caa20092e72083987a5b6878c4b9cdb0b6bb97fba21953c942eab2e79b94` |
| `clients/specs/Tests/DimOSARClient/localization/localizationCaptureStatus.test.ts` | ClientCore | full-text | 79 | `33d36912164f34549878cd2283f87ae557c0935964688cb9fcd30a53c24df5f9` |
| `clients/specs/Tests/DimOSARClient/localizationSubmission.test.ts` | ClientCore | full-text | 44 | `c583fb6e83286d2d44e3c0b3cd788499ee0940eb498188ec0b22d9fdc9b8a8b1` |
| `clients/specs/Tests/DimOSARClient/manipulation/ArmJointFilter.test.ts` | ClientCore | full-text | 108 | `dfaa8c0bdfbac635a95d12d4cbcca0a468c8a5b9b86a4189a1134277f54d7f5e` |
| `clients/specs/Tests/DimOSARClient/manipulation/ArmPresentationSampler.test.ts` | ClientCore | full-text | 31 | `06485f5c21e33927beb0f0eda68a82bf80fc35fe1fe5e06d903559ea163fcf68` |
| `clients/specs/Tests/DimOSARClient/manipulation/ArmToolKinematics.test.ts` | ClientCore | full-text | 70 | `a6d310bf2d64f4e7a5341838aef439c2b23abf239a96783ea430e9bb24b9d80b` |
| `clients/specs/Tests/DimOSARClient/manipulation/EndEffectorStatus.test.ts` | ClientCore | full-text | 29 | `773190c3014f5be4e9401fb91a1ea831996a6f73a290b0fdf0c9ad66143e90d3` |
| `clients/specs/Tests/DimOSARClient/manipulation/ManipulationController.test.ts` | ClientCore | full-text | 74 | `bbaa30e0e2f8f28ddfb6ad8fc707d22c5de5c96ce7f2ae0b2aa3dc25dcc99ad0` |
| `clients/specs/Tests/DimOSARClient/manipulation/ManipulationGesture.test.ts` | ClientCore | full-text | 19 | `da81f838ac24875bc8a840c2e5cd78d312a6606b698afd89633bff0a7c156526` |
| `clients/specs/Tests/DimOSARClient/manipulation/ManipulationInputCapture.test.ts` | ClientCore | full-text | 27 | `f875f99d218b3587047f88e939a1eb7da0c90b52f5f810a9f895b272e84d3e09` |
| `clients/specs/Tests/DimOSARClient/manipulation/ManipulationInteraction.test.ts` | ClientCore | full-text | 1176 | `ce7f7e12231c58248941335c4ef99a8a09966c1d48fccb27fbe9da309cd210ff` |
| `clients/specs/Tests/DimOSARClient/manipulation/ManipulationMotion.test.ts` | ClientCore | full-text | 76 | `e158c8704aec120867057b86be2852498941578edd7eacad3391a34d035e7492` |
| `clients/specs/Tests/DimOSARClient/manipulation/ManipulationPresentation.test.ts` | ClientCore | full-text | 65 | `02799c8eb3a3a21c10334869ae2b58b751cf0c3d36b880fab9952b84788ebfa8` |
| `clients/specs/Tests/DimOSARClient/manipulation/ManipulationRequests.test.ts` | ClientCore | full-text | 56 | `84cec127c2eba1f6efba134e479f9e07e3a28202686029720df950e24b000dcf` |
| `clients/specs/Tests/DimOSARClient/manipulation/ManipulationVisuals.test.ts` | ClientCore | full-text | 104 | `c0e738f1e518bc0152d82a0326965747973052587f27f211ee2762bbe2430e12` |
| `clients/specs/Tests/DimOSARClient/manipulation/ModelKinematics.test.ts` | ClientCore | full-text | 68 | `84b3309ccb446dff04b2fbe3e09146aca0a579ddac106a8bbc0702e68abcc2f5` |
| `clients/specs/Tests/DimOSARClient/navigation.test.ts` | ClientCore | full-text | 156 | `c25fab62938f2b4c2ab39757eefbe344afddec2c4ce49f1d6ac1f51b754b928e` |
| `clients/specs/Tests/DimOSARClient/presentation/PanelHeightAnimation.test.ts` | ClientCore | full-text | 43 | `a3afe4928f7ae1fce657e58098ef83e0f8f7183b36a1d292244ca3d91ef78d81` |
| `clients/specs/Tests/DimOSARClient/presentation/RoutePathGeometry.test.ts` | ClientCore | full-text | 40 | `00c088dad5d29c1017152f39418ab2be061f5b42bea0a5a69573f04c08499d3f` |
| `clients/specs/Tests/DimOSARClient/protocol.test.ts` | ClientCore | full-text | 749 | `ca691a780b7963aad0023b3d836571325eb49033ac9146b8be7fc01818b048f6` |
| `clients/specs/Tests/DimOSARClient/replication/CollaborationController.test.ts` | ClientCore | full-text | 283 | `10c566198bf4b4752373ac819cdfe342822845516021c99d6f835485002e530c` |
| `clients/specs/Tests/DimOSARClient/replication/ManipulationReplication.test.ts` | ClientCore | full-text | 486 | `a33447f997290f61553a5629c222804773b71dba0fe5b9260f70843c77e83f77` |
| `clients/specs/Tests/DimOSARClient/replication/NavigationReplication.test.ts` | ClientCore | full-text | 162 | `c2c227bdcf1912dda6d0acdfd271a763ab74b80f0cab6b00f4161b7e90e46a1e` |
| `clients/specs/Tests/DimOSARClient/sensors.test.ts` | ClientCore | full-text | 103 | `c9c7dd2bfe60978d184d4c68d61d1a45fb9708d4b6548fae2ac32843568d5b79` |
| `clients/specs/Tests/DimOSARClient/session.test.ts` | ClientCore | full-text | 786 | `1fe1200a18bb2b34353ae5ac19b1a20a832c826507e0160905f58406850ce405` |
| `clients/specs/Tests/DimOSARClient/userMessageRequest.test.ts` | ClientCore | full-text | 56 | `2e478ca5a27218d517fa297a67fed15aee712d9a2086750d6855a8450a6a1614` |
| `clients/specs/Tests/DimOSARClient/websocket/BulkTransfer.test.ts` | ClientCore | full-text | 317 | `b3bda55eaa717e93a284bc9116f49369cc7746b7cc1c5a721d10c4d678d95a72` |
| `clients/specs/Tests/DimOSARClient/websocket/hostNormalization.test.ts` | ClientCore | full-text | 35 | `ce9603424cf7664452f1582e2c76e86153cdb979a722584319e7da5b1ba6a289` |
| `clients/specs/Tests/DimOSARClient/websocket/sessionLinkStatus.test.ts` | ClientCore | full-text | 71 | `62e1b5091e05fed6cab441b9281368cb20190f571b14e98474a44908d3d6cbca` |
| `clients/specs/Tests/DimOSSpecsClient/animationUtilities.test.ts` | client-specs | full-text | 62 | `f5701df6c92a801fb59ffc2084660468c51cd29cc6477917783454f4bb825c4e` |
| `clients/specs/Tests/DimOSSpecsClient/appState.test.ts` | client-specs | full-text | 219 | `e5d068302b23dc65a26fdf813a263c5f5f7b17d441aaa2118ac2c6a069500f53` |
| `clients/specs/Tests/DimOSSpecsClient/arMarkerPresenter.test.ts` | client-specs | full-text | 116 | `35c67063a5fe0b15ca9b0521c35927ee2cfa5587b1bc17031ed91067bea87c49` |
| `clients/specs/Tests/DimOSSpecsClient/armControlsView.test.ts` | client-specs | full-text | 61 | `a7928a8c000dc51d33b9a1625da61dd3ad561460c621106ade243c37d68e225e` |
| `clients/specs/Tests/DimOSSpecsClient/armOpacity.test.ts` | client-specs | full-text | 142 | `aa56f887aa292796d8fbe0b43d332b246359a89fa27f794edcd4e20244934ad3` |
| `clients/specs/Tests/DimOSSpecsClient/assetMetadata.test.ts` | client-specs | full-text | 31 | `d482618351f9cea1e2b7cd6cd751162321b0314697e04ddd7f35bd7da5b8fcb0` |
| `clients/specs/Tests/DimOSSpecsClient/bendyLaser.test.ts` | client-specs | full-text | 75 | `9f5844386a249f8876cb457e01450baa299d0b6bacf98ef6aa3e1b29594ca855` |
| `clients/specs/Tests/DimOSSpecsClient/dragPlacementPlane.test.ts` | client-specs | full-text | 64 | `efcfc91e70295110c7971dd0486752742794d9915e52726c203bafc9b2ffae93` |
| `clients/specs/Tests/DimOSSpecsClient/endEffectorStatusPill.test.ts` | client-specs | full-text | 38 | `be4e3b1413d786a54e704b3c265c64c2addb84ff1e17ed0f96a6b5b347c0be2a` |
| `clients/specs/Tests/DimOSSpecsClient/feedbackGeometry.test.ts` | client-specs | full-text | 134 | `5576dad7ec787599c1ee14287ed7ee7e5336768d6d041a1e816853748d1f5c95` |
| `clients/specs/Tests/DimOSSpecsClient/integrationInput.test.ts` | client-specs | full-text | 32 | `97516ab0f1f82ee9d4b56aeeb6d8bddd97847c44096eaabe008d5d6a952674d0` |
| `clients/specs/Tests/DimOSSpecsClient/integrationV2Fixture.test.ts` | client-specs | full-text | 40 | `0076ecc21694526ae54ccbc0296124a1438acfd551308a359a6b82bf3f1b8c16` |
| `clients/specs/Tests/DimOSSpecsClient/ipRelayClient.test.ts` | client-specs | full-text | 63 | `74772df60836f84c4bcab588cbd3115e3e20ba2f11e7a6608821a85a50dbcce0` |
| `clients/specs/Tests/DimOSSpecsClient/mainMenuView.test.ts` | client-specs | full-text | 60 | `786f652fc8e1a689f07989cba42896e5f7060bf4ec8afbc7d65be5f3e516d97d` |
| `clients/specs/Tests/DimOSSpecsClient/manipulationCapabilities.test.ts` | client-specs | full-text | 66 | `6ce18603e662720b6778055aa257a5d7fe1a8ceb7bced3bd72b68907405864ac` |
| `clients/specs/Tests/DimOSSpecsClient/navGoalMarker.test.ts` | client-specs | full-text | 159 | `71a1a7f059bb24f4fcda3b418822d351d9585f8bf3d0f2263774241067d7f36d` |
| `clients/specs/Tests/DimOSSpecsClient/navGoalPresenter.test.ts` | client-specs | full-text | 72 | `0528e4d777479d4bf8e26773c864faa1789a8c0d4c2493eb3391c373b8996e9a` |
| `clients/specs/Tests/DimOSSpecsClient/navigationController.test.ts` | client-specs | full-text | 240 | `41ecd4225db750696f76fd79e87b6e45f13a2bee698b41e8efc222390d335e65` |
| `clients/specs/Tests/DimOSSpecsClient/navigationMarkerRenderer.test.ts` | client-specs | full-text | 37 | `d4dac439a4495e49d626e41440f83be3c715616ecef0aa6ca29dce1cc6058b74` |
| `clients/specs/Tests/DimOSSpecsClient/palmGestureGate.test.ts` | client-specs | full-text | 296 | `275e5a12e8659096ddadabd4da53d2dcd56aaea811392e2aec902be921404192` |
| `clients/specs/Tests/DimOSSpecsClient/panelHeightController.test.ts` | client-specs | full-text | 76 | `6ae9f5042a0cce219b6839dc7bb63d0754a0decec239098397dbea114425a652` |
| `clients/specs/Tests/DimOSSpecsClient/panelLayout.test.ts` | client-specs | full-text | 35 | `abcbd82c269cfa3d4112bc54424977431474050f0acdeb4074cbcaa43023a213` |
| `clients/specs/Tests/DimOSSpecsClient/pointCloudRenderer.test.ts` | client-specs | full-text | 83 | `e3a536099d992f431d02e066d481c0996eaaaa938d065e8ccbdb63fcedb9ede8` |
| `clients/specs/Tests/DimOSSpecsClient/robotPresenter.test.ts` | client-specs | full-text | 126 | `cb2f5fe45c75af6b0c3503eacbbc304ac94f4754cd0cdb0043f4c7d00300a49d` |
| `clients/specs/Tests/DimOSSpecsClient/robotWorldRenderer.test.ts` | client-specs | full-text | 18 | `31fd392c3659e5f05443499203693e3fa30b4e7a11dd8eaed25a5bcf46c447d4` |
| `clients/specs/Tests/DimOSSpecsClient/setupCapabilities.test.ts` | client-specs | full-text | 41 | `b56d604270ba89729344ee2ad8631d47cf54b392e9e67454db550d947f1503e6` |
| `clients/specs/Tests/DimOSSpecsClient/setupInputSubmission.test.ts` | client-specs | full-text | 55 | `b3b7106ceafb85ab99974b85a055a12efaf8ccbff6aba400a24fea4e0b832aef` |
| `clients/specs/Tests/DimOSSpecsClient/setupPreviewLifetime.test.ts` | client-specs | full-text | 15 | `2108c4e399eac475cb221f22c6f1fa0372bb9b240d665b3818a070e6969ce7af` |
| `clients/specs/Tests/DimOSSpecsClient/setupWizardController.test.ts` | client-specs | full-text | 396 | `28f6672da5ae4df104aa40f75a32837c61976c7f911f1d12122c59b718b4c893` |
| `clients/specs/Tests/DimOSSpecsClient/specsArmPanelPresenter.test.ts` | client-specs | full-text | 68 | `e35209798c334beed6d79a47d27e06d6575d0af60feafb236dc5a40b9d46cf32` |
| `clients/specs/Tests/DimOSSpecsClient/specsCameraSource.test.ts` | client-specs | full-text | 153 | `a3f1360f6180b58b1372fe7ec62893077ebedc4a3c367e4084b8aa4b93a90b1d` |
| `clients/specs/Tests/DimOSSpecsClient/specsCameraStream.test.ts` | client-specs | full-text | 52 | `49c094e10953999f2477c43cf79a5e36e6f3472b79d3c83fbd148fb9204c1bfc` |
| `clients/specs/Tests/DimOSSpecsClient/specsConnectionController.test.ts` | client-specs | full-text | 174 | `8b95471b1d614c2ef00a8133c9be7ba53b984d3c67d59ce496a2cd34cd49d1b8` |
| `clients/specs/Tests/DimOSSpecsClient/specsCoordinates.test.ts` | client-specs | full-text | 149 | `720ebd1cc51821c704325cd1d2bacb6e21a2f7b5a8cfa5957eefde5d74658b06` |
| `clients/specs/Tests/DimOSSpecsClient/specsLaserInput.test.ts` | client-specs | full-text | 80 | `4581c6967932cb0b3b0a377ffb3af4dce359c381680115404950d4a061dc09f0` |
| `clients/specs/Tests/DimOSSpecsClient/specsManipulationInput.test.ts` | client-specs | full-text | 75 | `a19c8ccdb39752f89b455f3c7d51a4d96a1f9e2c2aa474abb6ac207e9eb5a3db` |
| `clients/specs/Tests/DimOSSpecsClient/specsNavigationInput.test.ts` | client-specs | full-text | 173 | `6ff67b3c195515b7ad0c9246bf9e80d20daa5adb01515d9a35bf8750ede8e68d` |
| `clients/specs/Tests/DimOSSpecsClient/specsRecognition.test.ts` | client-specs | full-text | 49 | `2ac934e206085c9890ce565ca22ebfcfa5077b2e648c42a8b66d3c8edaf04cbe` |
| `clients/specs/Tests/DimOSSpecsClient/specsTargetPriority.test.ts` | client-specs | full-text | 68 | `7a07c45e1b3e35208ab5d9ad5d88f77242f539f24f77391df090b108ab845d43` |
| `clients/specs/Tests/DimOSSpecsClient/specsTextToSpeech.test.ts` | client-specs | full-text | 54 | `505f31261d1d2241358c029ccfedbcfdc80e1bf2efc220452e061a58470851ae` |
| `clients/specs/Tests/DimOSSpecsClient/specsWebSocketTransport.test.ts` | client-specs | full-text | 251 | `c60df396dd4e63dd76ce29225539609d7df0795a619b87156a5ba6fb0cf999bd` |
| `clients/specs/Tests/DimOSSpecsClient/uiPresenterLogging.test.ts` | client-specs | full-text | 236 | `f8b26969fccc63b7c826925c74ed4e0991356f891c568c642df82db31099e245` |
| `clients/specs/Tests/DimOSSpecsClient/uilogger.test.ts` | client-specs | full-text | 16 | `a8edfb79ad5e3e7a072277260e5cf0c1051a41aeebf90f4ae06404e2b8abf62e` |
| `clients/specs/Tests/DimOSSpecsClient/viewerNotificationPresenter.test.ts` | client-specs | full-text | 29 | `31db556d421293d6a1bdac2bc1ac1d1cdf0d9ae1effec8531d3b2bfb7fc07b9b` |
| `clients/specs/Tests/DimOSSpecsClient/worldMeshRenderer.test.ts` | client-specs | full-text | 65 | `a6a0edd6f7b41bb84e6073bc4a006901245cc278d1f5a9f0770e1aa310f92def` |
| `clients/specs/Tests/DimOSSpecsClient/wristMenuController.test.ts` | client-specs | full-text | 159 | `c727ce414e0cabb8d8ad99c7185109fd3913d1aa93856aadaa0bf0d25091ecfa` |
| `clients/specs/Tests/fixtures/ImmediateAuthority.ts` | Tooling | full-text | 106 | `f03ff5cf0c786f3bd68ed821e46303975f10578123182559e51d753843963f5f` |
| `clients/specs/Tests/fixtures/PairedBulk.ts` | Tooling | full-text | 44 | `1896464ea4a1ff92a81abb1d8b454b76cd397dccc6e1239b65db67c23a67f6a3` |
| `clients/specs/Tests/fixtures/SessionFixture.ts` | Tooling | full-text | 86 | `97725fdfb79858b6b35af64e4b44dc2771cc8329940a262a6720870b015af18b` |
| `clients/specs/Tests/integration-tests/.gitignore` | Tooling | full-text | 1 | `32dae3052f331ee34d628ef535709b301259a45df7c7522c4d35dcf49873f00b` |
| `clients/specs/Tests/integration-tests/BendyLaserProbe.ts` | Tooling | full-text | 144 | `691a7bb914c0ace6c7fdc77a0ad45a38561d115ef188f5db791133c3ba5f903f` |
| `clients/specs/Tests/integration-tests/CameraFixture.png` | Tooling | binary-metadata-reference | binary | `ce94432fae49c5109b806a45078e95b53c99075e73706142104fa7a53f99cb03` |
| `clients/specs/Tests/integration-tests/IntegrationArmFixture.ts` | Tooling | generated-structure | 1 | `e5ff436f7cebb0d646d891013644beaa2bae0ad0092d4e62e5ab1c769d764d5c` |
| `clients/specs/Tests/integration-tests/IntegrationArmGolden.ts` | Tooling | full-text | 164 | `b4787ec0d06e6d2fa9977fc0de78cef69cd4b608ef03e821146d137227b0f214` |
| `clients/specs/Tests/integration-tests/IntegrationGoldenCases.ts` | Tooling | full-text | 312 | `8f06bc30fd084ab460c96228a4ff2ca28531d98d2bb4a2e10b61d22ae06fa2db` |
| `clients/specs/Tests/integration-tests/IntegrationInput.ts` | Tooling | full-text | 111 | `cb72464c8ae3904e99b50cac1a4a08bf3fbc2e7e56cda850deba04c91c5ba464` |
| `clients/specs/Tests/integration-tests/IntegrationRegressionCases.ts` | Tooling | full-text | 345 | `6ff6f8caa500f9c4ee81221009187ef7a1507b5779aef739d347b1e5902b0b05` |
| `clients/specs/Tests/integration-tests/IntegrationScenario.ts` | Tooling | full-text | 406 | `ec61f9540551b4763a8410f98962310e28369595dcfe0232be787ec5bba36b8c` |
| `clients/specs/Tests/integration-tests/IntegrationV2Fixture.ts` | Tooling | full-text | 220 | `740030c82f87ac2d0a113a12864ebac956abc1ff958959fe3d203d7334110151` |
| `clients/specs/Tests/integration-tests/LidarAlignmentProbe.ts` | Tooling | full-text | 78 | `65937dabf75d0c22ce7f17f11a346a5a2d7b7f84e7d4d2721da8b0332eec6053` |
| `clients/specs/Tests/integration-tests/ManipulationProbe.ts` | Tooling | full-text | 349 | `2ddedf2e4be1c826c400a6a90328d3f3f5b150f5402cfbbe3a4d27696ef2d98b` |
| `clients/specs/Tests/integration-tests/NavMarkerOverlapProbe.ts` | Tooling | full-text | 251 | `f576e8cbd27099b0175b30e078995a019b1ad2c7d989ca08a185e72cdd3da346` |
| `clients/specs/Tests/integration-tests/test_focus_policy.py` | Tooling | full-text | 53 | `865d940289db50e67bb65b8e0b2d506442d7c0bb5317944f873e877929d6b07e` |
| `clients/specs/Tests/integration-tests/test_manipulation_assets.py` | Tooling | full-text | 41 | `31b16cb10da90b4c8f3a46c624dd5eb1a1c6900a94fdbb3ad596aac7a64e6823` |
| `clients/specs/Tests/integration-tests/test_native_provenance.py` | Tooling | full-text | 87 | `65366b8fbfc68eb2bc711263280690d9b12e406a09350d8481c444728f7ae6c1` |
| `clients/specs/Tests/integration-tests/test_native_recording.py` | Tooling | full-text | 70 | `8aa7c0e41604ef58b65ab07ecfd9e3a179ca9398a3b9deed20d67858d240a03e` |
| `clients/specs/Tests/integration-tests/test_review_tooling.py` | Tooling | full-text | 465 | `d53a9a7ca1435fec0e1aa74694a1b44e0d819fe22fe4d97f0a6d5f4aeb5abdc2` |
| `clients/specs/Tests/integration-tests/test_shader_generation.py` | Tooling | full-text | 94 | `96da9cb29129857c8879f71b5b26284441b873d71245c6bc4e337276d4ff051e` |
| `clients/specs/Tests/mocks/CursorControllerProvider.ts` | Tooling | full-text | 6 | `e619f533dba2ddf119e23f658caeac8d59d0668a21bd6c79b7c3ce92f1929a60` |
| `clients/specs/Tests/mocks/Frame.ts` | Tooling | full-text | 55 | `3049c4ca922b0903176412e25878f67b713294343465f671ebaf23b03719e0c4` |
| `clients/specs/Tests/mocks/HandInputData.ts` | Tooling | full-text | 39 | `4c3222ced3c0bb3c2122aa9909a40e9995176bc02ad07e1bfc3b33ecdbb73da8` |
| `clients/specs/Tests/mocks/Interactable.ts` | Tooling | full-text | 5 | `e7b4d3ed1cb79c2832225012286ac865e9f3a4b87b9a230e297421017138d19a` |
| `clients/specs/Tests/mocks/InteractionManager.ts` | Tooling | full-text | 5 | `860af6db5cbfec54a3bf8f296b5559ee1e1282ce6eb85f12b05a6e29905e995e` |
| `clients/specs/Tests/mocks/Interactor.ts` | Tooling | full-text | 4 | `8f562c8459bad1795950a9fda5ebb4d685645039417f099fbf4af96e46565b54` |
| `clients/specs/Tests/mocks/RoundButton.ts` | Tooling | full-text | 5 | `0825659ffce02a86c27fce2131440eadba67f4a3ff5335c2dde84ab20891bec9` |
| `clients/specs/Tests/mocks/UIKit.ts` | Tooling | full-text | 71 | `0dded9e47ac9539f67301de70a6df4acc3bec85480598761bad986371339b29a` |
| `clients/specs/Tests/mocks/animate.ts` | Tooling | full-text | 24 | `b224b59c2ad2343fb7dde80fae1e6956f9074e183ca4b35d7af026e74abb998c` |
| `clients/specs/Tests/naming.test.ts` | Tooling | full-text | 59 | `557e043c6038c14ea8eeb142c7abea9b1f9f9237647fa15a4842a11dcd1350df` |
| `clients/specs/Tests/package-lock.json` | Tooling | generated-structure | 2277 | `54c965f2435b9d283a6f4a6e5e9830d0588a147013db2dbd47e30fa3e7e68eed` |
| `clients/specs/Tests/package.json` | Tooling | full-text | 19 | `fe0b54e3db27665592e24390ad67206438c8be2645a41b8a67f0367f7b534d02` |
| `clients/specs/Tests/setup/lens-globals.ts` | Tooling | full-text | 18 | `84f4e737c5d5719dd74e59c7ab0edd36b49ecbeeb082810b680225186ba6c5b5` |
| `clients/specs/Tests/shims/lens-runtime.ts` | Tooling | full-text | 170 | `15cc26cd1de3c87dedafb0b36cc9211d9ac086075bfa1e1011d8f6f9d802262c` |
| `clients/specs/Tests/tsconfig.test.json` | Tooling | full-text | 19 | `70f8feeb064877f2ff9e6c10040d92c191659c42efc5b92a8e5fd2668ef419c1` |
| `clients/specs/Tests/vitest.config.ts` | Tooling | full-text | 106 | `737c38950fec60ea02edcf0b7275eddcc1b2f247a32aa7973fd80de620bca23b` |
| `clients/specs/spectacles-dimensional-os.esproj` | Tooling | full-text | 43 | `7629c7d6b916c6d508beb2362f1c591b0fa17242e38bc1259c9762911ff1fb05` |
| `clients/specs/tools/.gitignore` | Tooling | full-text | 2 | `b3341700a1b86cf0b445375dacc2baaf3eb3edb096c52bf9d94481368a401b81` |
| `clients/specs/tools/FocusPolicy.swift` | Tooling | full-text | 62 | `f3cdcc8e8ac9dc30ed54133123070a8023e01db54223feaa3cf01a4cd38d2c60` |
| `clients/specs/tools/README.md` | Documentation and assets | full-text | 211 | `7dda357eade43cb9a4d51c479455cc3e495d77d66cf89202957d676b9959d119` |
| `clients/specs/tools/RecordPreview.swift` | Tooling | full-text | 330 | `1cb3c4856858916cf1724ef9c7b2d91c613521d7415b5fb212d82b47114b4f70` |
| `clients/specs/tools/audit_source.py` | Tooling | full-text | 118 | `0ddd9db4e5000c7107c4a6f14d4f3e545417b4ce8e0f9b97732af15add5f289f` |
| `clients/specs/tools/compile_scripts.py` | Tooling | full-text | 58 | `a6b7a838e3023142dcabd1d5f56df89ae24cd410148182213f195c5c1471b9e3` |
| `clients/specs/tools/export_manipulation_mesh.py` | Tooling | full-text | 60 | `9f1c7a939a84e15d32b7e5a3b58fac15e841195fcf327fb34f6eb268c5025ac5` |
| `clients/specs/tools/integration_catalog.py` | Tooling | full-text | 33 | `0b9a58b3cf3a6c1d717d1d4d80c3dffeb0923c6cf52cb185eecac53d2285cf08` |
| `clients/specs/tools/lens_studio.py` | Tooling | full-text | 91 | `033b989e1a369f4dfb51a2e7adeffb09a38d409890ff9f77a738d03e1dc125c0` |
| `clients/specs/tools/native_project.py` | Tooling | full-text | 32 | `09c9d52fb504bd16bde3c1a48c31a7daf5b1cef82b4c8dc399c30cdfe1228812` |
| `clients/specs/tools/native_provenance.py` | Tooling | full-text | 66 | `52aabca230bd812a1939726da66cb49444a89916cd53592daa89fd1b6b537a6f` |
| `clients/specs/tools/native_recording.py` | Tooling | full-text | 61 | `c8effb43afaa9284a380c52045a5397e4554109157e979125f5aa2e7d100f9a9` |
| `clients/specs/tools/review.py` | Tooling | full-text | 874 | `67f8cb32e1a9df8c5a59a6b3ae0e4d23f4d1ca8aa3ed1a280e0266c575c4c127` |
| `clients/specs/tools/review_evidence.py` | Tooling | full-text | 85 | `4a7be98eed4cf06c7f214bf1e49bbdd470490f387ac02d42aadbee7f164d4670` |
| `clients/specs/tools/shaders/generate.py` | Tooling | full-text | 180 | `916f6df3b316b1b6ef4cf2ea2914d111aee0d4f2aed8a9b84ae95927ebbba63c` |
| `clients/specs/tools/shaders/legacy_graph.py` | Tooling | full-text | 149 | `d7a4074f66511d253d3ffd00c367683ca0a7fdb85c4201c467ec6f962f7f0c29` |
| `clients/specs/tools/shaders/templates/AnimatedNoiseWaves.ss_graph` | Tooling | binary-metadata-reference | binary | `d03cc956d1a71deb4e853d43e7b0b8f853b4d9e5228a4a6ed073d9f31b025db5` |
| `clients/webxr/CALIBRATION.md` | Documentation and assets | full-text | 142 | `b3b7c0d15c2adeee5442b09625767a1a5ff9e05fa1e42f48ee1246ef94fa601b` |
| `clients/webxr/README.md` | Documentation and assets | full-text | 14 | `33654761bf9b352e4d4ac47dbc3752d8f0652cfc0dd8a062b4e04b8c99f0295d` |
| `clients/webxr/index.html` | Tooling | full-text | 45 | `018be412be69c9ad2468f220f3edc11b713eb8cc3603eebf29dc9845676c09d8` |
| `clients/webxr/package-lock.json` | Tooling | generated-structure | 3406 | `e42dd016dab1bfc956961c9bc27872dd526c7ec0cb0f1cf325587be1da7b6f32` |
| `clients/webxr/package.json` | Tooling | full-text | 38 | `e98fc2e60f81b2ebf88cd60bac40814dc42ef514a6f655d44025f5da6ebb6a62` |
| `clients/webxr/playwright.config.ts` | Tooling | full-text | 25 | `b97e4099d6fde9f3322453bb3731f5a9db22894d7bcdfcef126791cf4ad3714b` |
| `clients/webxr/public/models/LICENSE.i2rt` | Tooling | full-text | 9 | `7cd0a0224a287ebd6c45703eb6623d264c7810f8958d65de8f99e87ccd9f4891` |
| `clients/webxr/public/models/NOTICE.md` | Documentation and assets | full-text | 13 | `08bb0658170b8e34c296db0d1cd44bf26cfb9574927f830cacb1a6f9d6bf9032` |
| `clients/webxr/public/models/openyam.glb` | Tooling | binary-metadata-reference | binary | `1e0de6b0ea43500c6de3449c6a682d9327a1e3e5a88f2764b69881f44dfb00d0` |
| `clients/webxr/server/PinGateway.ts` | Tooling | full-text | 160 | `16c5ab334dc2f4cdcad79b413954ca79310a82fb7e1d2246f9bd73c89ed18e01` |
| `clients/webxr/src/DimOSWebXRClient.ts` | client-webxr | full-text | 460 | `f23742f0cad7df1ba9152d4f18c9ec450d146a2593c5baff9ad54c7644637d40` |
| `clients/webxr/src/WebXRApp.ts` | client-webxr | full-text | 104 | `2946bd253e1e08ca1eefbe8fdd36faf44b2625a01005ad36acd4c95760b4ca5c` |
| `clients/webxr/src/WebXRRuntimeConfig.ts` | client-webxr | full-text | 12 | `a1ea8447994981fe98445daf688c1d63921a1081dceff99101cfd0df8ca6defc` |
| `clients/webxr/src/WebXRSessionController.ts` | client-webxr | full-text | 126 | `d780675901ff1c560644967019f5fbdb95d6c9642b3f51946d2bff9e1e5aa3fc` |
| `clients/webxr/src/agent/BrowserSpeechAdapters.ts` | client-webxr | full-text | 61 | `7833edc4a37509b877c794946eddd23d194735da1c99b2efb1187d80b4513b2e` |
| `clients/webxr/src/diagnostics/BrowserDiagnostics.ts` | client-webxr | full-text | 19 | `d64af04d367e5e6a8c618d2d5e8c6d1ec105143893941eb66eec955b012d4d12` |
| `clients/webxr/src/diagnostics/DiagnosticReporter.ts` | client-webxr | full-text | 33 | `044e717e2a5eba1595ae58cd4aacf785cf3d56463523a7f0fa28e3ba9b2fdb21` |
| `clients/webxr/src/input/AffordanceProximity.ts` | client-webxr | full-text | 67 | `9832b2f8d9d005ec24ef54ba8c6953d0146c1675ef0683c92a79313d734b6a42` |
| `clients/webxr/src/input/FingertipButtons.ts` | client-webxr | full-text | 83 | `33298e2c2d00dea3a575388d9c6210a9bbd8e2d13551d03005e67c16fef7c04b` |
| `clients/webxr/src/input/InteractionCapture.ts` | client-webxr | full-text | 22 | `f6e1984e62c7067e11447e53238366f66b772f1b3fb95c69209b296a37b96cbe` |
| `clients/webxr/src/input/MenuAnchorController.ts` | client-webxr | full-text | 36 | `21e23ae988c71025dcb8561135622e8534684af8729d4ba07ece8a31d631ee97` |
| `clients/webxr/src/input/PalmMenuGate.ts` | client-webxr | full-text | 32 | `ecdda974eec9e07675213f0a837fcdf3eadcb19b8e65f2e67275c5300c5de6d4` |
| `clients/webxr/src/input/WebXRDirectInteraction.ts` | client-webxr | full-text | 89 | `32787c4fd14672905da89a3f0177ea514fd5d5faa9d55d7809499de117207a03` |
| `clients/webxr/src/input/WebXRHandStyle.ts` | client-webxr | full-text | 93 | `170dd2f3459a144ed226fbf33a0816c7fa8ca1131e933453f586c3dbf4966f3e` |
| `clients/webxr/src/input/WebXRInputController.ts` | client-webxr | full-text | 676 | `9816978136ef085f7a6ff8316cea89636b9ec8e79ede3de6175f25625ed490f7` |
| `clients/webxr/src/input/XRBlocksRayInteraction.ts` | client-webxr | full-text | 367 | `fb15d82a3322173bf2226bd4829e2fa033ff6a02ec685651a697bb265cefb31b` |
| `clients/webxr/src/localization/BrowserJpegEncoder.ts` | client-webxr | full-text | 90 | `91d710ff9c9f040b16fd5fec6f00e7a617e7edd0b072434781c19defd88ff291` |
| `clients/webxr/src/localization/HmdCalibration.ts` | client-webxr | full-text | 136 | `2b2c82d5141cf65749da446ba9bc29d4a2d256fc719369f7a462b605aac4ef4e` |
| `clients/webxr/src/localization/HmdCameraSource.ts` | client-webxr | full-text | 439 | `e5d539328e1a9df3d21a9e01233a56471ea9c7ef805b80ed300ef333c941025a` |
| `clients/webxr/src/localization/HmdProfiles.ts` | client-webxr | full-text | 70 | `8d0f508a3809044c0b60c2a43cc19a96999cccd02180141710cdef4040e5c154` |
| `clients/webxr/src/localization/JpegWorker.ts` | client-webxr | full-text | 26 | `5699ec4603b996cad54e0ae6dba81b17a4bdbe812f0ced6389ec45579050345f` |
| `clients/webxr/src/localization/profiles/README.md` | Documentation and assets | full-text | 4 | `47c50898db79233c647aec31b5cb40f3e328d3963fc01a8f9f7fae7203c4a6ee` |
| `clients/webxr/src/main.ts` | client-webxr | full-text | 254 | `5c17767f0a746db3064949518c1d7c290486b3163a49deaf13076def05072557` |
| `clients/webxr/src/manipulation/ArmMaterial.ts` | client-webxr | full-text | 19 | `76e0274a02e76d7eef9b0aa363773bf8dfe3e2d5a1d9116479f2eac439b51e4a` |
| `clients/webxr/src/manipulation/EndEffectorHandleRenderer.ts` | client-webxr | full-text | 40 | `62624f12f7e0b8c032627073a2fa38f071a277244763141319247d2260ca8cce` |
| `clients/webxr/src/manipulation/EndEffectorStatusView.ts` | client-webxr | full-text | 36 | `9c5d75b7fad9368b0e25f885efccb2fe01fc594bcbf10aeb837681057ef661c9` |
| `clients/webxr/src/manipulation/ManipulationControlsView.ts` | client-webxr | full-text | 280 | `cd89e3dc06319f0408e2fa984da2f73af0826396a79e35b1718144147e7bbe31` |
| `clients/webxr/src/manipulation/ManipulationModelRenderer.ts` | client-webxr | full-text | 181 | `2064c4076214e76fbafcdd36563aada10652c9346c8ca9d54cddb0fb9392ea82` |
| `clients/webxr/src/manipulation/ManipulationRenderer.ts` | client-webxr | full-text | 478 | `17fde130d24d82bbc282898736930933fec7ec1e62fc9cf3386b9eb7a362a3c5` |
| `clients/webxr/src/manipulation/ObjectResources.ts` | client-webxr | full-text | 34 | `b7a8239021406a56f68a49ecdcaecc7a41eb1c1e98cd5cfd3e890c72943d35b3` |
| `clients/webxr/src/manipulation/WebXRManipulationController.ts` | client-webxr | full-text | 131 | `6025849e0c1735ae2a37bce1f7b9f40b7a81b5106a7d9e4c38c1283e3f284d4a` |
| `clients/webxr/src/manipulation/profiles/ManipulationVisualProfile.ts` | client-webxr | full-text | 7 | `4fff6432a709b9aa95812e5eba638173158a60379d55c852a2d66ce7c2c08c24` |
| `clients/webxr/src/navigation/WebXRGroundPlacement.ts` | client-webxr | full-text | 172 | `f84713ee20bf18adb06d873c3f417d84d26dd0032e94b7887deda598243191cf` |
| `clients/webxr/src/navigation/WebXRJoystickController.ts` | client-webxr | full-text | 4 | `821e19ca83b3d7578642c87486ba99e9c631c3617282ea2a00d0b93088c064cc` |
| `clients/webxr/src/navigation/WebXRNavGoalView.ts` | client-webxr | full-text | 380 | `1517fb7033188cb063984c1d0f29cc396855e83fc4f203bdac84dee102316451` |
| `clients/webxr/src/navigation/WebXRNavigationController.ts` | client-webxr | full-text | 94 | `af66ea1318261731df97647ee2924fe0bb20812782a16df4074d5bbfcdc23f09` |
| `clients/webxr/src/navigation/WebXRRouteRenderer.ts` | client-webxr | full-text | 81 | `f0ec76455690129d9ba6f85eb33ca30dc06725883ae85bfaaebf7004a757321f` |
| `clients/webxr/src/presentation/AdaptiveDashedLineRenderer.ts` | client-webxr | full-text | 106 | `5b545ef7bf6231ef356608bf04ab56d022a53a4953c8e48321439cdff16a85f3` |
| `clients/webxr/src/presentation/ButtonFootprint.ts` | client-webxr | full-text | 73 | `a2969fa530379a7a59d57a85c6b20940794ac9351707b50921df29142983a657` |
| `clients/webxr/src/presentation/DimOSARDesign.ts` | client-webxr | full-text | 29 | `d4b2f8ca261602b7628c848121720b4da560499e6d86c91a254c4a913e53174c` |
| `clients/webxr/src/presentation/EnvironmentDepthRenderer.ts` | client-webxr | full-text | 223 | `c24f6fbc67599a556e02c27916ba7084208720dd18ee9521059c82564989dc01` |
| `clients/webxr/src/presentation/GlassSurface.ts` | client-webxr | full-text | 139 | `132f9b0cc270a4b5b7a460709a872942e64b17a2c59ebc304d054d307ef4bd24` |
| `clients/webxr/src/presentation/InteractionSoundController.ts` | client-webxr | full-text | 79 | `c699c78505860dc2fc3a9f4ef11723fd0439ccd9cb1c5bb25adee3c3738f9b23` |
| `clients/webxr/src/presentation/LandingInfoPresenter.ts` | client-webxr | full-text | 47 | `89424e18cc1a4607bbe1a624d4af27091abedcc98d46d9461197b8e35208a41d` |
| `clients/webxr/src/presentation/LandingPage.css` | client-webxr | full-text | 42 | `3de3b2b719b4fff2356567908180f9170070a2d7f0ec3413c204698c3a3c03c3` |
| `clients/webxr/src/presentation/MainMenuView.ts` | client-webxr | full-text | 713 | `591bbc37a4ce4479046ae79ccc9aaf4b4e4a13727576820c5800bbddcbc8d6d4` |
| `clients/webxr/src/presentation/NotificationPill.ts` | client-webxr | full-text | 174 | `914027928c176081eab8ccb88ddf8c21c45b7a066b2bc144ef5eff65b714ae80` |
| `clients/webxr/src/presentation/PanelGesture.ts` | client-webxr | full-text | 40 | `0a3f394ca9f980679a2489cf6f96e468798d35d2dedac3e8bd4a7836909900ea` |
| `clients/webxr/src/presentation/PanelLayout.ts` | client-webxr | full-text | 41 | `ab28a1f722fd8c970c078932b4a83bed422fe3f33ccc0ddb3819f80696a3877c` |
| `clients/webxr/src/presentation/PanelPageTransitions.ts` | client-webxr | full-text | 56 | `cf7cf8162d42fa2e4ab551d66c5bcbac3aec799c18c5e37b615048195ad7cf1b` |
| `clients/webxr/src/presentation/PanelWidgets.ts` | client-webxr | full-text | 189 | `7387265248a3ed79b95ce5f156d4bc22810132f097d9116399575ec2e54b0b92` |
| `clients/webxr/src/presentation/PoseIndicatorMaterial.ts` | client-webxr | full-text | 47 | `92ebb0e46d516c6832ca381151c017392d61c2273594f2b6b9133ab8ab3d2b18` |
| `clients/webxr/src/presentation/RobotMarkerLabel.ts` | client-webxr | full-text | 103 | `643183d6bea13d1ac886b16514b3f050be10386043160fde6579174f49f528d0` |
| `clients/webxr/src/presentation/RobotPanelFrame.ts` | client-webxr | full-text | 76 | `9f349ce218e1ff26cfe463c1b6804f5dc39ed1ae39ff09cb06d023337a9cfd51` |
| `clients/webxr/src/presentation/RoundedSurfaceGeometry.ts` | client-webxr | full-text | 40 | `5fd43b6dc83012af72040b7243da1486df4ac3e69dadd1c8c2528b67f7bdd4bd` |
| `clients/webxr/src/presentation/ScrollableTextView.ts` | client-webxr | full-text | 137 | `db64068cfcfb097806b94b26e650a1ab6ec5ab5c2e6f60d002120489ba4e0152` |
| `clients/webxr/src/presentation/SetupCameraPreviewView.ts` | client-webxr | full-text | 64 | `f8d32a59a6480fbc54338dd26e335f7d9e1c912141f4688d1ac043d95aa5e7a5` |
| `clients/webxr/src/presentation/SpeedSlider.ts` | client-webxr | full-text | 84 | `e1ed6f8fc053f4ab6fdbd15b62ad5549ff8e5a0297e427b16ee408862e5f993e` |
| `clients/webxr/src/presentation/StatusTones.ts` | client-webxr | full-text | 18 | `49184ba124106f505c24ffa5a3c3cba477f8e3574965882dc043927851b9d3f8` |
| `clients/webxr/src/presentation/SurfaceButton.ts` | client-webxr | full-text | 168 | `103b63c64a51490836a191cac47a57666fcd3c3ad37c46593eed3fdd80513f10` |
| `clients/webxr/src/presentation/SurfaceText.ts` | client-webxr | full-text | 33 | `a9a243b8760bff8d7cd6517818c766fff85483bb6db9fa0fc0f636d688626d27` |
| `clients/webxr/src/presentation/TextResources.ts` | client-webxr | full-text | 23 | `cfaabe56feadf37d1ad405826a5db28b461793fb912b016b4258c02f4099badf` |
| `clients/webxr/src/presentation/UIFonts.ts` | client-webxr | full-text | 14 | `f348f168ca87500b1efe6a75c2fbb0930ec14efc6d79bbc42c912268118f042c` |
| `clients/webxr/src/presentation/ViewerNotificationPresenter.ts` | client-webxr | full-text | 62 | `5052aea6769480670cdd81d101214efdb0a90ab14724b3d6cdfab26c47fee58c` |
| `clients/webxr/src/presentation/ViewerPanelPlacement.ts` | client-webxr | full-text | 16 | `30e5653314b5ca868386548f1abdffca8bf69c0e8018d8c9f724cedba0c95a5f` |
| `clients/webxr/src/presentation/WebXRARMarkerPresenter.ts` | client-webxr | full-text | 138 | `ba6d0d25363ca66f443b4ad1961124483f28bb13e2c265248ae08cd99e4bb2ab` |
| `clients/webxr/src/presentation/WebXRRobotPresenter.ts` | client-webxr | full-text | 492 | `cd08f1b270741fb3422f87943c3431ed3a12121df0703721869932c9e2857e84` |
| `clients/webxr/src/presentation/WebXRUIPresenter.ts` | client-webxr | full-text | 362 | `4c864b6f8771fb5351b1e023306d555562e43042cc6dcb57f7671dde83736c6c` |
| `clients/webxr/src/sensors/WebXRLidarRenderer.ts` | client-webxr | full-text | 89 | `02eb486833778ae5b8ff1047a9bae1a648f1b70a22243823f2f75ecbfce32225` |
| `clients/webxr/src/sensors/WebXRLidarSettings.ts` | client-webxr | full-text | 9 | `4bab0eb26a1e3a6b1df494a23dafbcc4038427da6fd900a4b2c42c81918759a3` |
| `clients/webxr/src/troika-three-text.d.ts` | client-webxr | full-text | 17 | `dff5231fe186083398aacf477962b52788b25871efa22dc39f5db55868c58c51` |
| `clients/webxr/src/utilities/BrowserClientClock.ts` | client-webxr | full-text | 18 | `818820d580a26ea4f38efdc903c847eb3b7a6383d01ea28957ad7a57df553d40` |
| `clients/webxr/src/utilities/WebXRCoordinates.ts` | client-webxr | full-text | 192 | `e08c242adb51527d75a476409f9fa24f61cc22fc15c64cdb4ed04174aef12acd` |
| `clients/webxr/src/websocket/BrowserWebSocketTransport.ts` | client-webxr | full-text | 166 | `c882ea75a36e63a7da63691f3872291a2225cd0db63fb28b7c5f3b90a35b91cc` |
| `clients/webxr/tests/AdaptiveDashedLineRenderer.test.ts` | client-webxr | full-text | 24 | `9db265a6b80fbbb503f100254578092970607c0800212497e4ac36f19a5a618c` |
| `clients/webxr/tests/AdaptivePanel.test.ts` | client-webxr | full-text | 176 | `bb12e7704ff8a3e3b99336931a35d26695b19a6a7f4be3b8356940667807e7c9` |
| `clients/webxr/tests/AffordanceProximity.test.ts` | client-webxr | full-text | 23 | `861f210d2a6efdb9ff6452f823b279e080164611cffd24205004649aafd9d80a` |
| `clients/webxr/tests/Architecture.test.ts` | client-webxr | full-text | 34 | `e020301f13acf118dbe251a63b999cd38145a49d6fb202ac2044a55ab37a3733` |
| `clients/webxr/tests/ArmMaterial.test.ts` | client-webxr | full-text | 21 | `6f2f3a2a8c494a5287218e577cf69fd34d3d7d0758f936f3d4ee90ed2d92df91` |
| `clients/webxr/tests/BrowserClientClock.test.ts` | client-webxr | full-text | 10 | `da1977f6560e7eb8b7245a59206ac67ab25a06ed1d2ccc296ff712977df2cb20` |
| `clients/webxr/tests/BrowserJpegEncoder.test.ts` | client-webxr | full-text | 92 | `0ed3dedf05f721f825f8dfafe64bb80e0f13454c3fe3c177b0683a0a3b6904ae` |
| `clients/webxr/tests/BrowserSpeechAdapters.test.ts` | client-webxr | full-text | 34 | `b0f0acce7b4f0c89d74ee65f6c3a98b4e0825b14033fb4bf3ee45b8406ac8391` |
| `clients/webxr/tests/BrowserWebSocketTransport.test.ts` | client-webxr | full-text | 109 | `46445dfe123651687e39ea9344d592b6aa628e63d22035eeea14391e93dbbcd3` |
| `clients/webxr/tests/ButtonFootprint.test.ts` | client-webxr | full-text | 43 | `0a64ca1434b84c19b04f3822870c4622f37dece2e7d14e2061ade7135faae22f` |
| `clients/webxr/tests/DiagnosticReporter.test.ts` | client-webxr | full-text | 21 | `1231feb46d139afecc556e7f83dc878294caa513f1a65cc09a15db2a54b8dfda` |
| `clients/webxr/tests/DimOSWebXRClient.test.ts` | client-webxr | full-text | 61 | `cf3a1d816b2631d597da00fc6aa31faf59e6eaa7e460d4c4756a42956681623a` |
| `clients/webxr/tests/EnvironmentDepthRenderer.test.ts` | client-webxr | full-text | 57 | `56fdeac43e66d409b28f9c6dd8476474cca90006d599ecea3d41ecae17fcfb92` |
| `clients/webxr/tests/FingertipButtons.test.ts` | client-webxr | full-text | 66 | `b85b1545540948980bc1337a3bb33e1fb98a850201a109462ac694281aac2458` |
| `clients/webxr/tests/HmdCalibration.test.ts` | client-webxr | full-text | 75 | `9429108356d3480076cee6d60655a4bbcf0fd9a1effaf5e6f62cb9807c9bdac1` |
| `clients/webxr/tests/HmdCalibrationRunner.test.ts` | client-webxr | full-text | 73 | `9843abf0f211d8a38927166f25ac57b455c2e425cea4ed4a6f3b10ba1347281b` |
| `clients/webxr/tests/HmdCameraSource.test.ts` | client-webxr | full-text | 262 | `0960b600e4051bf26d1f1fcf9c155e6f8372db36e67302418687708b537315c1` |
| `clients/webxr/tests/HmdProfiles.test.ts` | client-webxr | full-text | 11 | `a56aec15293a7bced7c782955dc080666b222d0e4d774757e61d7336e44f549e` |
| `clients/webxr/tests/InteractionCapture.test.ts` | client-webxr | full-text | 16 | `7c20bca4b99264a7d676c06b46d296afb72f7d0922d02af4a9ba01ab4079bb67` |
| `clients/webxr/tests/InteractionSoundController.test.ts` | client-webxr | full-text | 39 | `cc3e48d41c6d188c8a426c6b7bd6a2ee558f05c2757a43c08f857ff4099e5429` |
| `clients/webxr/tests/LandingInfoPresenter.test.ts` | client-webxr | full-text | 23 | `272f94549c226adc8733293bd2f910764cb8824fea512604015878ca5d7d2ef6` |
| `clients/webxr/tests/LauncherConnection.test.ts` | client-webxr | full-text | 104 | `f274ac0f108e6f4d1f9b7fc8bc2c4e7ea79437134e933afdb6431e88d7893635` |
| `clients/webxr/tests/MainMenuView.test.ts` | client-webxr | full-text | 498 | `191fccefb9c6a24e4183867aa3a21c2d6ec8436101aec9f9a3f340f18c3cee60` |
| `clients/webxr/tests/ManipulationCapabilities.test.ts` | client-webxr | full-text | 66 | `d2655f3d4e5b9ad4f2fb2826375bb59ef77817171d7de7f9cb162e38cf6b5b35` |
| `clients/webxr/tests/ManipulationRenderer.test.ts` | client-webxr | full-text | 761 | `6c5e9fda9e130d6144e5e1b5d20f93131312c3e630ad21819e5357cb7ce0bcb5` |
| `clients/webxr/tests/MenuAnchorController.test.ts` | client-webxr | full-text | 45 | `40050d866cd28c9c591d03e73ff5a4bc5b17216d76fa9f6fd1d995ec067066fe` |
| `clients/webxr/tests/PalmMenuGate.test.ts` | client-webxr | full-text | 30 | `2b10bae9fdbda45537614ee520368896c9554db228767aa63cc07d60b9acb7d8` |
| `clients/webxr/tests/PanelLayout.test.ts` | client-webxr | full-text | 29 | `891105d7be6d7a9922544e71146818f56f0c1c5a44cce4042cd8d635a3cdd177` |
| `clients/webxr/tests/PinGateway.test.ts` | client-webxr | full-text | 166 | `d96404e850fd747746963ba159231ec864a8cc7f06661f8ce4e622f09abe3844` |
| `clients/webxr/tests/Realign.test.ts` | client-webxr | full-text | 21 | `23f924126f21c27da9f21dcc729afbf18dba28b7ab6cd6890ceefeb05721e61b` |
| `clients/webxr/tests/RecordedArm.test.ts` | client-webxr | full-text | 43 | `65a5c7f5563373c9a9edf7bad2e74877b80a7c8de87a94d04b731d4635c37134` |
| `clients/webxr/tests/RoundedSurfaceGeometry.test.ts` | client-webxr | full-text | 20 | `d572eb680836ec5111027009cbdbe390848dec06e62593ff52bafe3c2ade0f2f` |
| `clients/webxr/tests/SessionScheduling.test.ts` | client-webxr | full-text | 42 | `fbc5307b928c4af9481f6edc5e463cb4e148a17132a7f6c385de7e5ac72ec110` |
| `clients/webxr/tests/SetupCameraPreviewView.test.ts` | client-webxr | full-text | 25 | `5541f7e69ff7ab090e81dcc6de9931a7c48577646593481998f9dab0e6aeb329` |
| `clients/webxr/tests/TargetWarning.test.ts` | client-webxr | full-text | 44 | `2949d3f17620e646fd47a282e9003635aecddb59276bf7b260f010b065327f19` |
| `clients/webxr/tests/TextResources.test.ts` | client-webxr | full-text | 34 | `110e0a474c13439a6678340239d2ae8687332c0cbb7339f39503f63046869f4c` |
| `clients/webxr/tests/ViewerNotificationPresenter.test.ts` | client-webxr | full-text | 61 | `c57d8accca63c7597a2b2cbeb579f93be5e74176bb8f828a7a66cb2f7414015d` |
| `clients/webxr/tests/ViewerPanelPlacement.test.ts` | client-webxr | full-text | 40 | `2e5536840cb54133e36e8f7b2b7b883c9e5c43abcb5ede088f72bf84ecc484e0` |
| `clients/webxr/tests/WebXRARMarkerPresenter.test.ts` | client-webxr | full-text | 27 | `5fb2decaa31cd945d30d8219b52cb7416c47bf23c3612fa52305717dd95715de` |
| `clients/webxr/tests/WebXRCoordinates.test.ts` | client-webxr | full-text | 80 | `9e2824d27778a59bbb712fb315dc28b047f4963f4b47e31881691fa5bc7626ca` |
| `clients/webxr/tests/WebXRDirectInteraction.test.ts` | client-webxr | full-text | 61 | `90d60f3ce0a3d55f36961f8896b00e7f93c62bf6718db1e1da0ced521df04e7b` |
| `clients/webxr/tests/WebXRGroundPlacement.test.ts` | client-webxr | full-text | 92 | `9a5b2098d9a192a180815b76a7d8f3404b5fa239c65f4011c56bf5c9797ba9c4` |
| `clients/webxr/tests/WebXRHandStyle.test.ts` | client-webxr | full-text | 29 | `2b3797670c66eb23d4429c6e108d55b51b5ddb31c8041ab66849b30b562edd90` |
| `clients/webxr/tests/WebXRInputController.test.ts` | client-webxr | full-text | 97 | `5f95c5887b4c510293c7813ad5096698f977468606d0e2d1d7bfbbdddde427d8` |
| `clients/webxr/tests/WebXRJoystickController.test.ts` | client-webxr | full-text | 39 | `99f28beb851c69cafb9d2a00a495f0a58200e6b1377600cbfede8296b3f2d48c` |
| `clients/webxr/tests/WebXRLidarRenderer.test.ts` | client-webxr | full-text | 67 | `09f5889c0646eaf634fda06cdd51c17e800301fbf2188ca31f5985594509da11` |
| `clients/webxr/tests/WebXRNavGoalView.test.ts` | client-webxr | full-text | 250 | `9e44faa523474bd15768fa87ff2086584277b74bc7a42443f1eebcd32105e5fe` |
| `clients/webxr/tests/WebXRNavigationController.test.ts` | client-webxr | full-text | 468 | `2583dd70d731c6d19571d223545359931e9ce9724f6c548d09cae0dba913c944` |
| `clients/webxr/tests/WebXRRobotPresenter.test.ts` | client-webxr | full-text | 281 | `e4c556e415734fae8f3e571fd6f795f8d32fb70db74ce1bbefe275881481f89f` |
| `clients/webxr/tests/WebXRRouteRenderer.test.ts` | client-webxr | full-text | 51 | `2178f43e44d0a35d4280f6caa9adc5014b2180f073f55f0cc4cdc898252531e4` |
| `clients/webxr/tests/WebXRRuntimeConfig.test.ts` | client-webxr | full-text | 15 | `6c76b3e57e1e2b37c01cbfa00e6c5cf735d6dff5ea67f2c6f966f117e4d7e3f5` |
| `clients/webxr/tests/WebXRSession.test.ts` | client-webxr | full-text | 510 | `53110f3bee24ae385434edc0701456e306441d77a24e4a6473102048c0326d93` |
| `clients/webxr/tests/WebXRSessionController.test.ts` | client-webxr | full-text | 95 | `2b48d199863d020c6dcd05d7e1eefe919527eb5c6566a455c6a20c69b3d324c6` |
| `clients/webxr/tests/WebXRUIPresenter.test.ts` | client-webxr | full-text | 187 | `09711f7effbc793e164a9ab7f9981689c8e76db4e0ff1c9216d43953022298de` |
| `clients/webxr/tests/XRBlocksRayInteraction.test.ts` | client-webxr | full-text | 333 | `1a1655e594714049ba44c2ff2e902d6fd37440d669c2c9b61ac5c5ac7f193b55` |
| `clients/webxr/tests/fixtures/HmdCalibrationRunner.ts` | client-webxr | full-text | 163 | `ca76301d9bf6d3b3e4478faae8d4e47adc71b0b6c43bb99fc473287d17282f4a` |
| `clients/webxr/tests/fixtures/browserAudio.ts` | client-webxr | full-text | 6 | `63d25ae78f7d77c958d60352ab644b3f0fb0a00bd5fb5e75fe42dae04c5b250d` |
| `clients/webxr/tests/fixtures/camera.ts` | client-webxr | full-text | 37 | `4026dfff1448f109c94c88625320b835992e63a0e8f573076d4c0c5de56a3e82` |
| `clients/webxr/tests/fixtures/pairedBulkSocket.ts` | client-webxr | full-text | 22 | `76428c52154ec94c1c2df74d909c29c3ca29b4a11df01d2da0a8ae836c48764e` |
| `clients/webxr/tests/fixtures/xrEnvironment.ts` | client-webxr | full-text | 13 | `89c18723471ac1bfc0e12c8f5f431b2adf9d6a118adb7ae32ba03dacf02f45af` |
| `clients/webxr/tests/integration-tests/ControllerPath.spec.ts` | client-webxr | full-text | 91 | `f358cbc37f3fe7b6871a63ebb36a2abac0254d9ca97a6ff56623fabc541f0054` |
| `clients/webxr/tests/integration-tests/GoldenPath.spec.ts` | client-webxr | full-text | 217 | `14cf611f671be57ca79276eabc897b9dbb0b67edb8455e554074aca0f87b252c` |
| `clients/webxr/tests/integration-tests/fixtures/AdvisoryPreview.ts` | client-webxr | full-text | 7 | `b287a6564baa18ad5833a8dbb8b964cfa6bd3bdb00649dd7e4c37fc21b91f71d` |
| `clients/webxr/tests/integration-tests/fixtures/ArmInput.ts` | client-webxr | full-text | 64 | `06683752d7baf40efae0d7491ddcec5673253ed5bb993b3ace1e80754dea137b` |
| `clients/webxr/tests/integration-tests/fixtures/Flow.ts` | client-webxr | full-text | 123 | `46545f54f32b8c7fabae76b50210afd327f6a4b71666c57d70ee4b0c3fb47caf` |
| `clients/webxr/tests/integration-tests/fixtures/GoldenArmPeer.ts` | client-webxr | full-text | 189 | `da49ae4c8876130bebd03634a686092f778d978d672d65b22816d692d5d27ca9` |
| `clients/webxr/tests/integration-tests/fixtures/Input.ts` | client-webxr | full-text | 456 | `f1d084dc00af42194722d924203f0784f0c9f5c97f34807e420f693adc9dff79` |
| `clients/webxr/tests/integration-tests/fixtures/InteractionPeer.ts` | client-webxr | full-text | 84 | `6cb83c59358a8c348f97485248a137e8001728d9a18cf8cc68eec06182a956e7` |
| `clients/webxr/tests/integration-tests/fixtures/OpenYAM.json` | client-webxr | generated-structure | 441 | `d0acd59806801201a01823daa21a68c0a4078b3e54f6c9dd55f3502728cf991a` |
| `clients/webxr/tests/integration-tests/fixtures/Runtime.ts` | client-webxr | full-text | 345 | `1f4ecddcb96841b9d92ba356e01e272c627ed5fa9c825f0cb627523d08744bc8` |
| `clients/webxr/tests/integration-tests/fixtures/V2BulkPeer.ts` | client-webxr | full-text | 105 | `a300b2dbfd55bcd197957c062f926d673e8922e3c23fa4d5e829a7d990fb0dc2` |
| `clients/webxr/tools/calibrate.py` | Tooling | full-text | 224 | `2c9a402836cda9f28398610564d1f550536f93e6b396493e705ed41cfffc28b0` |
| `clients/webxr/tools/make-visual-review.mjs` | Tooling | full-text | 12 | `83f23b69f1d69b52537d502c6a95d88b79ec11a592e6de871db04f65659cac62` |
| `clients/webxr/tools/run-integration.mjs` | Tooling | full-text | 67 | `dd4faaf5493430ac1b11a50e5c44bec9032b465f5b60a21328ced2d0d5bfc0a2` |
| `clients/webxr/tools/test_calibrate.py` | Tooling | full-text | 80 | `61c9374a31a8b76edc098522ff56f4c38d693afb11b8ade2034b033d48ba0c80` |
| `clients/webxr/tsconfig.json` | Tooling | full-text | 41 | `dcf410079dc2cacff41921c11e9f66e58ba99eecbab56aa0c83819b968d22a67` |
| `clients/webxr/vite.config.ts` | Tooling | full-text | 119 | `3bf4196a74b3892111acb9c6f66932779b930dd7703515d4d841ea8a19f21d3d` |
| `dimos-ar/PROTOCOL.md` | Documentation and assets | full-text | 1639 | `820b84c16abc8d4d62f071ad3e14828da7c472721ed3f6c76ad70359d08a1dd9` |
| `dimos-ar/dimos/__init__.py` | ARModule | full-text | 3 | `a8415eab7cae7f7950295b1e00b98bf1a3ccf1fa424b9e01ff9a6bcb4d0cde19` |
| `dimos-ar/dimos/ar/__init__.py` | ARModule | full-text | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `dimos-ar/dimos/ar/blueprints.py` | ARModule | full-text | 96 | `0c3cb453b3f4d2043c9fcff71f7b530921046fad9eee524e25e159fb967eb8bc` |
| `dimos-ar/dimos/ar/localization/__init__.py` | ARModule | full-text | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `dimos-ar/dimos/ar/localization/coordinator.py` | ARModule | full-text | 91 | `8c98f5ef0a41171079883c579615bd04ba7ca94d7c0a78a8daeedb9854460707` |
| `dimos-ar/dimos/ar/localization/fiducial_marker/__init__.py` | ARModule | full-text | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `dimos-ar/dimos/ar/localization/fiducial_marker/localizer.py` | ARModule | full-text | 358 | `43834a54d5062c78b90fea595fbc840accce29080f3ac65267046ce90d7c7b22` |
| `dimos-ar/dimos/ar/localization/fiducial_marker/test_localizer.py` | ARModule | full-text | 628 | `49f425eb1c7d58c973b3e2ca47182cca13068fdd4ca1ff060ef90652d33cda0c` |
| `dimos-ar/dimos/ar/localization/map_localization.py` | ARModule | full-text | 826 | `3872cbb6691494c32336720d59678c65e4ca2396cda72b619f07c3c4cdee2ca4` |
| `dimos-ar/dimos/ar/localization/odom_map_transform.py` | ARModule | full-text | 96 | `7d5be3ddb2104bf24c69308d449b374e96c3226e56544550f40e5e9bf47a0829` |
| `dimos-ar/dimos/ar/localization/policy.py` | ARModule | full-text | 254 | `55ca78835567cc78590c4a395c0435962c09d6c37d0408f27f75a38630eb44ad` |
| `dimos-ar/dimos/ar/localization/pose_buffer.py` | ARModule | full-text | 256 | `2ce7daa9750a24a7fdbfe947ba6ce1fba257f811e3cd7773621fca5638655998` |
| `dimos-ar/dimos/ar/localization/runner.py` | ARModule | full-text | 173 | `7e138f251a2a738010bde60edda03215874a947dd52d61af197026defa1ec2f1` |
| `dimos-ar/dimos/ar/localization/source_clock.py` | ARModule | full-text | 30 | `4a2d31d18cd3c464ab894cf441c06e5ee87f8d61fbdcbea72dfe0322e2f29d57` |
| `dimos-ar/dimos/ar/localization/test_async_lifecycle.py` | ARModule | full-text | 262 | `ec8f1a44f23888e828e64d57d06fe408c0fbe3a951e121c72579e814280d2ba3` |
| `dimos-ar/dimos/ar/localization/test_coordinator.py` | ARModule | full-text | 75 | `795c0df2ced1b1177a6980192495598980be5b9a436212b1576b1a59df725a8f` |
| `dimos-ar/dimos/ar/localization/test_map_localization.py` | ARModule | full-text | 192 | `eb7095660e8addefd7011727974782c051b8b3085bee67c17c7a23b692b62ec2` |
| `dimos-ar/dimos/ar/localization/test_mixed_localization.py` | ARModule | full-text | 268 | `47452ea25ed08eea096423bc0e06b85ea3a23667b278d237315b832e6b5a7cd6` |
| `dimos-ar/dimos/ar/localization/test_odom_map_transform.py` | ARModule | full-text | 62 | `2417eed2aba6c0004d278d190e151dacd8298c90a5e9ee5f43f372490da4d7e6` |
| `dimos-ar/dimos/ar/localization/test_policy.py` | ARModule | full-text | 135 | `11db92c6df69af818f30371f609c98ae64d1d205d0d2ceb8b604017136579dc6` |
| `dimos-ar/dimos/ar/localization/test_pose_buffer.py` | ARModule | full-text | 99 | `e802c04bb416848726ac2efeedbbab78c846a4b50e6e9428d836e5e7d75befb4` |
| `dimos-ar/dimos/ar/localization/test_public_map_localization.py` | ARModule | full-text | 73 | `4f7c283038397d1c70773b545f98d0a31573f095eb9ecb52fcbb948aea872c3c` |
| `dimos-ar/dimos/ar/localization/test_source_clock.py` | ARModule | full-text | 30 | `f0a52bd0fe2c7e0368e5c0cf06e330bfa5b221e6d517beca36478319d79646a6` |
| `dimos-ar/dimos/ar/localization/test_transforms.py` | ARModule | full-text | 108 | `36840c4788588c7b8bc02b92b057ee5c0392478374b71774d8373dcf01d9e6bd` |
| `dimos-ar/dimos/ar/localization/test_undistort.py` | ARModule | full-text | 129 | `c83b567fd79324d9b3910fa00989d321617f30d370d50844e405e158210ee97e` |
| `dimos-ar/dimos/ar/localization/transforms.py` | ARModule | full-text | 142 | `36dbd8079ccb0b81ae11430836e932460eb8e2146222750c04b66894defc3bd1` |
| `dimos-ar/dimos/ar/localization/types.py` | ARModule | full-text | 64 | `fb66b265947a5dd64439872cc6d13642da16ac6d6a4c79700498b9291f1e89db` |
| `dimos-ar/dimos/ar/localization/undistort.py` | ARModule | full-text | 97 | `7dd7efefa89e66a78703ff442645e1c23741bdf14bc03b8693abee6e376ae7aa` |
| `dimos-ar/dimos/ar/localization/vps/__init__.py` | ARModule | full-text | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `dimos-ar/dimos/ar/localization/vps/admission.py` | ARModule | full-text | 39 | `59cf077c61e502deb2c042bb86da888095d3c22de08f3dc96940f781bd4e6e3b` |
| `dimos-ar/dimos/ar/localization/vps/localizer.py` | ARModule | full-text | 236 | `1dec7d5b96af6512142bfd47bf64ba60d29927d0830f2648206adfe55614d610` |
| `dimos-ar/dimos/ar/localization/vps/multiset_client.py` | ARModule | full-text | 363 | `ea2236a2777ebf7e480d22b3008e5f0a114e8c6721fbccf2a223e56603897f7f` |
| `dimos-ar/dimos/ar/localization/vps/robot_observation_buffer.py` | ARModule | full-text | 177 | `c1834ba687258675fa46abb92e42808e43906686fd625921659ac9647d527aec` |
| `dimos-ar/dimos/ar/localization/vps/test_admission.py` | ARModule | full-text | 21 | `9132cfb8844f114c173e6ddf6ebbf635159ac3a2a18fc849948004225b6ce4df` |
| `dimos-ar/dimos/ar/localization/vps/test_async_http.py` | ARModule | full-text | 166 | `25e7b4d912462d3b09378797254fedc7a10a26535f5233580fdf8a3105df03c4` |
| `dimos-ar/dimos/ar/localization/vps/test_localizer.py` | ARModule | full-text | 222 | `d436970bba1ce96ff167f997cc3fa131ed440014c3de80c8e81a8e66ffe81df6` |
| `dimos-ar/dimos/ar/localization/vps/test_multiset_client.py` | ARModule | full-text | 494 | `a9f06fd5051a20b9c327b100ee7b05a8bf6cf9753dd8757a51bb04e7429e955e` |
| `dimos-ar/dimos/ar/localization/vps/test_robot_observation_buffer.py` | ARModule | full-text | 185 | `d771bc0b20a9e2c37e79d6be323d5a72280e179cb70b544c3984196ed6f091a3` |
| `dimos-ar/dimos/ar/manipulation/README.md` | Documentation and assets | full-text | 246 | `271ab7a5c8617c4bdeaa29d02116dd9b702245cd29b7c6959091e4fda05f59fa` |
| `dimos-ar/dimos/ar/manipulation/UPSTREAM.md` | Documentation and assets | full-text | 19 | `72934ddee3145b677790e21ade473b45c242caa08d02e0b294754b2755a34fb7` |
| `dimos-ar/dimos/ar/manipulation/__init__.py` | ARModule | full-text | 1 | `c14c5f84c5745dcb9f5d5d1216fc82c849de7db03488d59a6a5910d0b8dc8f55` |
| `dimos-ar/dimos/ar/manipulation/adapter.py` | ARModule | full-text | 342 | `dcf9efb961b113923731759aa68a2ced83d794e2e9216f5a3d3e1bf49bc7d63d` |
| `dimos-ar/dimos/ar/manipulation/admission.py` | ARModule | full-text | 95 | `e7cbc9d20eed0b63cba65644f107deb519cd9da3f3c02d92ef08e324bf282d4e` |
| `dimos-ar/dimos/ar/manipulation/blueprints.py` | ARModule | full-text | 79 | `9d86d6956837935af01231ddfb014b1062aff93e23e6e0e6ec8dad702f67d164` |
| `dimos-ar/dimos/ar/manipulation/collision_model.py` | ARModule | full-text | 63 | `46afadee84d121e0d5bbee1cec4bc0ba6c1e93601677ec06bcb3079a7e9a20db` |
| `dimos-ar/dimos/ar/manipulation/errors.py` | ARModule | full-text | 45 | `dbf1a5cfa6658e32e0d8210d245d01695cbe8e3d893ea92eada92be6a2cdf83a` |
| `dimos-ar/dimos/ar/manipulation/following.py` | ARModule | full-text | 321 | `4983fcf5e858aded3c22fe4d98bf18bdbbaafc6cbb2ea0d1605ef48910841f96` |
| `dimos-ar/dimos/ar/manipulation/following_tail.py` | ARModule | full-text | 111 | `bd3892682df99e05da03a9bd38ac56f36743255866769d768bbd4368fb8ee86b` |
| `dimos-ar/dimos/ar/manipulation/frames.py` | ARModule | full-text | 45 | `cbc4e7b22e552678c093a828b3f791c734b19a6df22bd6d540c1cc56e8a96a2a` |
| `dimos-ar/dimos/ar/manipulation/limits.py` | ARModule | full-text | 93 | `aee1ea1ec0fb9946db9953941404c70d469501de1cc0318f0ea2fe466dfdc466` |
| `dimos-ar/dimos/ar/manipulation/model.py` | ARModule | full-text | 165 | `5a1aa79c632114c9b47b00b9ad2597541ed1a0674b43ece14174fb382962330c` |
| `dimos-ar/dimos/ar/manipulation/module.py` | ARModule | full-text | 173 | `cccd468a9e6fa6b389da852e7741faefb4bdad33b9eb8fcb18a8e792046c86a1` |
| `dimos-ar/dimos/ar/manipulation/operation.py` | ARModule | full-text | 224 | `2d96ded3a48c7cac6e825767c714381fe975ce700cd5c072ddab7b033b4987b6` |
| `dimos-ar/dimos/ar/manipulation/planner_worker.py` | ARModule | full-text | 208 | `f217e38720a57c79d62d707bcf922997620ba0d7cd157b357a2765e310208ac7` |
| `dimos-ar/dimos/ar/manipulation/ports.py` | ARModule | full-text | 58 | `9718f0754c67ececc77120951e66d4c369e17f7b4cfc16fc27e10142bc6736e5` |
| `dimos-ar/dimos/ar/manipulation/protected_hardware.py` | ARModule | full-text | 212 | `c97fa9dcff56a100ab9b43173860ea8fcc403eb46771142fe7779c0e9afd146f` |
| `dimos-ar/dimos/ar/manipulation/protection.py` | ARModule | full-text | 256 | `3d499b136cee76ac75abce87cda30b7675b1ca89af2ff628332c3f2719ccb43d` |
| `dimos-ar/dimos/ar/manipulation/protocol.py` | ARModule | full-text | 92 | `a09d2d0b514210260ebafb77041481487c5e827e2e72bc0015a58b4a1e155fc6` |
| `dimos-ar/dimos/ar/manipulation/runtime.py` | ARModule | full-text | 1115 | `1cab87f077c953537caace6bce949a1adac90283f88944adf2a7b9cc582cc3f3` |
| `dimos-ar/dimos/ar/manipulation/service.py` | ARModule | full-text | 479 | `22bd0d2ed05d4a91b03825596ba75a64c02df2d9acec8ecfcf5063908c49d234` |
| `dimos-ar/dimos/ar/manipulation/session.py` | ARModule | full-text | 34 | `839283ec66d87a9c0b0aa9dc0fd53636057af60a36a6d605703c1541a997ac49` |
| `dimos-ar/dimos/ar/manipulation/spec.py` | ARModule | full-text | 35 | `9411bfb85d1cf184a497daa8f1cdf11fc3b18c8c90afc98e0a80ed0bd50385a4` |
| `dimos-ar/dimos/ar/manipulation/test_advisory_ik.py` | ARModule | full-text | 87 | `6f973de3c31e1184460eb8064c97351433816c54b9c8efed93fd6e0978b15320` |
| `dimos-ar/dimos/ar/manipulation/test_arrival.py` | ARModule | full-text | 89 | `1345feeaf893a2a38312b2d50175a47f92529cad74555f0e37283049f2c8d3e8` |
| `dimos-ar/dimos/ar/manipulation/test_following_control.py` | ARModule | full-text | 145 | `311fc0351556d40498b86ab0500efe2b987061a2a2ed71dbb839916f605742a7` |
| `dimos-ar/dimos/ar/manipulation/test_following_latency.py` | ARModule | full-text | 71 | `45d154889a8a673ae0a963dc5da2ec7f6d41a09bcca3597dc8ee6b5e45e5cd13` |
| `dimos-ar/dimos/ar/manipulation/test_following_tail.py` | ARModule | full-text | 285 | `ed8bb274414a2541acb01562bd3d3f03ae88664ffb19549e145f0b3311830022` |
| `dimos-ar/dimos/ar/manipulation/test_frames.py` | ARModule | full-text | 45 | `aef729efb35e7cb12ee255e9c072e1a36eddc7f5abbfe06e770f38435dc962aa` |
| `dimos-ar/dimos/ar/manipulation/test_limits.py` | ARModule | full-text | 124 | `8a45d58b6bbe7cd61701fbd888fe65df7d5429b3fff8bde27e2c42c3801986c7` |
| `dimos-ar/dimos/ar/manipulation/test_model.py` | ARModule | full-text | 35 | `265a0b1bb9ae6b517aaf1673032b7ad335d614593a0ecf3d41522abf7b2752fa` |
| `dimos-ar/dimos/ar/manipulation/test_operation_cycles.py` | ARModule | full-text | 153 | `d3dad4d1d421948af2ca4984bd711437c527139fc05e936a79bd1978f1538190` |
| `dimos-ar/dimos/ar/manipulation/test_planner_worker.py` | ARModule | full-text | 324 | `bd5973fd80166156267154137384179b1bf2f804637c82eecfe96b5a75029050` |
| `dimos-ar/dimos/ar/manipulation/test_protected_hardware.py` | ARModule | full-text | 122 | `3ce885150a55c6b29a9d0a968044c3de0b95542929e227c94af4bb5d41f8033a` |
| `dimos-ar/dimos/ar/manipulation/test_protection.py` | ARModule | full-text | 272 | `5544f8c6f7816c70dd518049f703ee2b0a893f9f4c3ee3c923957c36c18fb043` |
| `dimos-ar/dimos/ar/manipulation/test_protocol.py` | ARModule | full-text | 61 | `5981c9ae112ace71e05135f4b74d67c219f226cda9994d12d9591948617bdbd0` |
| `dimos-ar/dimos/ar/manipulation/test_replication_authority.py` | ARModule | full-text | 365 | `8dba1334db31ba64b8f8868e4f456121755a67197f4c51fbe00e24a061214a40` |
| `dimos-ar/dimos/ar/manipulation/test_runtime.py` | ARModule | full-text | 1411 | `5d5e6ea9ca7a9eb3d97d4926638c5a21e462648f276a376f1f7baacfcdfb42e7` |
| `dimos-ar/dimos/ar/manipulation/test_service.py` | ARModule | full-text | 761 | `b559666ccf8a3707e72b61cf9952a5a8ad81359ff07c7dc4e22700b439b9e3d7` |
| `dimos-ar/dimos/ar/manipulation/zero.py` | ARModule | full-text | 139 | `ac02bf2dacafe31609a3a6cfb401d9c48b9e45d7c7e31229854e6803884cf0ab` |
| `dimos-ar/dimos/ar/module.py` | ARModule | full-text | 1430 | `191e705d46e5c1dc700ce7d09e2e55cae3dbd8ac929f9551ca76a52c959805d4` |
| `dimos-ar/dimos/ar/native_rpc.py` | ARModule | full-text | 99 | `42f92ec9d47dea4d2736d8d17a78a9172cf16c9532a9ce9fe630d68457fece16` |
| `dimos-ar/dimos/ar/navigation/__init__.py` | ARModule | full-text | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `dimos-ar/dimos/ar/navigation/control_fence.py` | ARModule | full-text | 115 | `733722a888bf3281f69466d688d0add57faf8b66f5336eede603bc85b47098fb` |
| `dimos-ar/dimos/ar/navigation/control_service.py` | ARModule | full-text | 130 | `f5429b9aca5dee4a4ce2a7d99d55e843612534d57e97fb317baad99dc6bdd2a2` |
| `dimos-ar/dimos/ar/navigation/control_spec.py` | ARModule | full-text | 15 | `28b271cb06837ae075cd01f219e487ac09c995237209b5ab9ecdb675083b7239` |
| `dimos-ar/dimos/ar/navigation/coordinator.py` | ARModule | full-text | 102 | `188a72eae8dd7a88e25a8da27bd9ff164b3ae97c4d469705a4a5cbc7770f7b30` |
| `dimos-ar/dimos/ar/navigation/native_planner.py` | ARModule | full-text | 224 | `60095a7ba996d11014809b303d4cc6de91519abf4d95a49a6cedfa703e5edecf` |
| `dimos-ar/dimos/ar/navigation/preview_planner.py` | ARModule | full-text | 84 | `0d489e468de01343f4749b3f036369d2a536de3a6a6c3d5aa1a7ab1d25064872` |
| `dimos-ar/dimos/ar/navigation/preview_service.py` | ARModule | full-text | 160 | `b016986ead26945ab2b1ed76d30952fc3254ac2b1708a02a34384e2b774a2873` |
| `dimos-ar/dimos/ar/navigation/tele_cmd_vel.py` | ARModule | full-text | 106 | `1ca223665ab9443a3f3c74bad38e835390dca2c796ad835f13754fbdad1458b3` |
| `dimos-ar/dimos/ar/navigation/test_control_fence.py` | ARModule | full-text | 60 | `1afab2a561a80772d230db36e7a5f73db0cdaec0e65133e815031fff033a2195` |
| `dimos-ar/dimos/ar/navigation/test_control_service.py` | ARModule | full-text | 106 | `c4bf1a39edd277885b5e6716fe09cc519345db3ea3498f5c8ea89d238d2e7084` |
| `dimos-ar/dimos/ar/navigation/test_coordinator.py` | ARModule | full-text | 206 | `c14e8924b18227a429fa47f68f120bdca0fdc42879f6097ade7fd9dca775a123` |
| `dimos-ar/dimos/ar/navigation/test_native_planner.py` | ARModule | full-text | 201 | `9956609697cb718b25cbea84399ee664aeb75b101032df52546322f10dc3fc6c` |
| `dimos-ar/dimos/ar/navigation/test_preview_planner.py` | ARModule | full-text | 56 | `514bdbb817cf3a76f299843bd32f19377d027ffd54fea5dd8f25501b0d604d96` |
| `dimos-ar/dimos/ar/navigation/test_preview_service.py` | ARModule | full-text | 118 | `2a0d0b3f9faad2a6990d438d1d1e4a2835affbb830c3006894c8d0a3ac61f6ba` |
| `dimos-ar/dimos/ar/navigation/test_tele_cmd_vel.py` | ARModule | full-text | 91 | `aa144543210492a32d776332d5692dafd4419a92d9a4ea647be02971cc0945cc` |
| `dimos-ar/dimos/ar/navigation/types.py` | ARModule | full-text | 44 | `868352979ce24e2202bd482725a585f4130b6daa9081044fbb110d52f617347b` |
| `dimos-ar/dimos/ar/numeric.py` | ARModule | full-text | 15 | `7fc8e38c486dc592c91c1b4614f246a3d1f6c67d6942673e8a43cab3d3d8ea5d` |
| `dimos-ar/dimos/ar/replay.py` | ARModule | full-text | 374 | `4efa4e4d26d88d2de6f64f9cbb1c175384c4c0109dd92598a85260330f5d701a` |
| `dimos-ar/dimos/ar/replication/__init__.py` | ARModule | full-text | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `dimos-ar/dimos/ar/replication/interaction.py` | ARModule | full-text | 716 | `c305aadca26480104dc037274d262d12a9c53a8b787e63a43affa364e8bf42a9` |
| `dimos-ar/dimos/ar/replication/manipulation_authority.py` | ARModule | full-text | 116 | `a923ade0edb1072d713ddab732f90e77ae5b60b1009516d2d89c170a8041c0ae` |
| `dimos-ar/dimos/ar/replication/protocol.py` | ARModule | full-text | 99 | `fcf634c13ed1ba73c856d07cebd7c3e36e4a5b5b99b6218a2637617eb112bb95` |
| `dimos-ar/dimos/ar/replication/test_interaction.py` | ARModule | full-text | 497 | `0821f3edcd8dbbebb305c76e090c6c8a402c41f11056049da88296728956fa26` |
| `dimos-ar/dimos/ar/replication/test_module_interaction.py` | ARModule | full-text | 359 | `4ed01650a5b6b0ab9de7c8d89e6c70215b908958234a8bf82df80a404ea39501` |
| `dimos-ar/dimos/ar/replication/test_server_integration.py` | ARModule | full-text | 231 | `380b7fa1776a373cc872c34cd6a34cbfdb504cdabdd1a1282227fbd1aee5e561` |
| `dimos-ar/dimos/ar/robot/agent_control.py` | ARModule | full-text | 64 | `068270e07e55be2439e242223da9daa1da43ae3e73efb293fac27a6c42738b7e` |
| `dimos-ar/dimos/ar/robot/agent_service.py` | ARModule | full-text | 249 | `51ee4191077ae7cca1ae25c1a830bf1c241567d2dd100b47e4d9bb54587a042e` |
| `dimos-ar/dimos/ar/robot/capabilities.py` | ARModule | full-text | 129 | `773d41c589a462011db81759073afdb7299385a9ce9baac7f6cdedea729cb092` |
| `dimos-ar/dimos/ar/robot/guarded_agent.py` | ARModule | full-text | 164 | `c1aa8c8fe9295cd8b8b6aa5c7d6d1da9569f0c65bfcaeabad44e44da503f1959` |
| `dimos-ar/dimos/ar/robot/odometry.py` | ARModule | full-text | 119 | `a9d15a2dde81e5f97a1c8fc37d2a5ea1104987d87813628d406b925ed22d87c0` |
| `dimos-ar/dimos/ar/robot/odometry_correction.py` | ARModule | full-text | 77 | `aa9bea332724d70b77b54d36940f4e949d4144e4952df1e9be4d5fc7024cca36` |
| `dimos-ar/dimos/ar/robot/profiles/__init__.py` | ARModule | full-text | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `dimos-ar/dimos/ar/robot/profiles/profile.py` | ARModule | full-text | 197 | `bb0ab298d8f9e1100e59373378256d30ce8e461875a99889c14fe661ca1e976e` |
| `dimos-ar/dimos/ar/robot/profiles/test_profile.py` | ARModule | full-text | 181 | `c29967355d82e64e1af507fea12a9e628aa45a0339538768dcf820f699a1cfa2` |
| `dimos-ar/dimos/ar/robot/profiles/test_unitree_go2.py` | ARModule | full-text | 48 | `3fca55d725a378229fa6685b9ddf3d99d2b4e74c0944c05dcaa5e61cab429404` |
| `dimos-ar/dimos/ar/robot/profiles/unitree_go2.py` | ARModule | full-text | 52 | `583bf2666fcdea09a1ad787b9acb8d5953b3aa9adc61990b1b9748054bbb5c31` |
| `dimos-ar/dimos/ar/robot/safety.py` | ARModule | full-text | 34 | `3fa46680652e4ec7cd22b13971197701563ee12cd396c0829d63c8fdc91a3969` |
| `dimos-ar/dimos/ar/robot/state_publisher.py` | ARModule | full-text | 209 | `1ce669b2e4d3d478f8690443598ffff7ac6f5b28106b55808b0f91951a2aa4f5` |
| `dimos-ar/dimos/ar/robot/test_agent_control.py` | ARModule | full-text | 68 | `505ac90da15233207813ced70d7f00f17d0ac80883ea3681e4ca8069db07d7b7` |
| `dimos-ar/dimos/ar/robot/test_agent_service.py` | ARModule | full-text | 111 | `705a4968949fabae6e4dde4953084056db7baab173a57d63a6e940216b1a63ef` |
| `dimos-ar/dimos/ar/robot/test_capabilities.py` | ARModule | full-text | 87 | `e7ae20717d9ed67667ef131e43a0c35d5a2a576c0b68d0e23bf911dba405a19c` |
| `dimos-ar/dimos/ar/robot/test_guarded_agent.py` | ARModule | full-text | 162 | `25ea57e8bf10e3a05e985f67cb37c35998600356f0c57015b8adeefb53a24411` |
| `dimos-ar/dimos/ar/robot/test_odometry.py` | ARModule | full-text | 72 | `63851537cd5a1e7b556f36ef959592d0a435f7d07018787b46c26735b0653820` |
| `dimos-ar/dimos/ar/robot/test_odometry_correction.py` | ARModule | full-text | 134 | `e10f486195df1f0eb8512e3418b3579e8dfe2b095f471b9cfe899dab4d178ab8` |
| `dimos-ar/dimos/ar/robot/test_safety.py` | ARModule | full-text | 43 | `448d4d000605879a755fab3ca1193f2131cade6c335c5d88c17c3584ecb04417` |
| `dimos-ar/dimos/ar/robot/test_state_publisher.py` | ARModule | full-text | 373 | `95fbe1c12754dcc79951283632e2185afac40590503cbb9794a00c410a278d29` |
| `dimos-ar/dimos/ar/sensors/lidar_filter.py` | ARModule | full-text | 148 | `62052b35d6e2abf541d69a428b0bb2c693482ec059c03fedb66e7a0c9d340559` |
| `dimos-ar/dimos/ar/sensors/lidar_settings.py` | ARModule | full-text | 19 | `b03ff90a9b9248e6211ba6cf01ddc9e58f2a920c7ffa6e6ca7f98d0184d98df4` |
| `dimos-ar/dimos/ar/sensors/test_lidar_filter.py` | ARModule | full-text | 153 | `7c916436fbde04c00f8e3fd5903b9552a5c79555b2e666df00e7062d9c3abd3a` |
| `dimos-ar/dimos/ar/test_blueprints.py` | ARModule | full-text | 66 | `f24b43b2e67f623f64f6de9bad128baea4df3681d74dfa121daef1780185dc86` |
| `dimos-ar/dimos/ar/test_module.py` | ARModule | full-text | 1215 | `8107ef39d4ccf9df59311033cc2b155b46a65e68a1cb292808d4ef062e0ab094` |
| `dimos-ar/dimos/ar/test_replay.py` | ARModule | full-text | 97 | `05793e01c5372843810be7b97aef79c2267d1096d518ad6ce1c242e24537a907` |
| `dimos-ar/dimos/ar/test_timing_diagnostics.py` | ARModule | full-text | 29 | `54380706e014753a92aa73bd6c36e9d1b044763946f70abcccac51ca45af58b4` |
| `dimos-ar/dimos/ar/timing_diagnostics.py` | ARModule | full-text | 45 | `1a7cb4a83a8626b8403a07dee4f75698d4457376154f248fd90c03ef40322fcf` |
| `dimos-ar/dimos/ar/websocket/bulk.py` | ARModule | full-text | 311 | `e893504b81d3a4e5ba22e72716cf937b1ffab25a2a6fc68d30f9f49afe42535c` |
| `dimos-ar/dimos/ar/websocket/ip_relay.py` | ARModule | full-text | 120 | `4c4c85dfff64a95ec7a218f0fa5f2cf9729603ac555a4fd5a8c1c9f693d72c12` |
| `dimos-ar/dimos/ar/websocket/performance.py` | ARModule | full-text | 40 | `90b2c91b4b1b6a072173a11c7af2aa19d6c0db2ebb71e0de7321828db3e235dd` |
| `dimos-ar/dimos/ar/websocket/protocol.py` | ARModule | full-text | 800 | `48442bdcd1367beb8c2ffdaf122ff12dc068ed6dd76807bbf36a25bbbd951101` |
| `dimos-ar/dimos/ar/websocket/send_queue.py` | ARModule | full-text | 222 | `aac3ed926bd14ae516be8ddcbd8b15c67e139a4412aa28e677c566426cd3ee92` |
| `dimos-ar/dimos/ar/websocket/server.py` | ARModule | full-text | 966 | `95e31138273473e0652beac638f2659d6333e6fb2ff352092045d300e1ab3c87` |
| `dimos-ar/dimos/ar/websocket/server_info.py` | ARModule | full-text | 19 | `5cc4620539cbfdb9cad9bd96140c0a9d41054c51d7aee079d1db0bd463ded14d` |
| `dimos-ar/dimos/ar/websocket/test_bulk.py` | ARModule | full-text | 496 | `03d5744a330e7bdcf7b9536f1315c6771e961fdc2102cb7f407968750754700c` |
| `dimos-ar/dimos/ar/websocket/test_ip_relay.py` | ARModule | full-text | 60 | `7fc21494fb6008af4e36902d588876b09338de8cf51d94a24cc31134e4b178ec` |
| `dimos-ar/dimos/ar/websocket/test_protocol.py` | ARModule | full-text | 747 | `457753f89e1c06d451abe2b0c64615fc80b5e1ca107475dd4019244b5241e8b8` |
| `dimos-ar/dimos/ar/websocket/test_send_queue.py` | ARModule | full-text | 238 | `18e635fcd3b63d0547c41d73ea50d03e08a52c26d6c182dda7f4df752bb61aa5` |
| `dimos-ar/dimos/ar/websocket/test_server.py` | ARModule | full-text | 971 | `a21ae8fdbd81b1126b5ac85552a69c2d0a523dcf6bc6d98bb011f9e132ee1bd6` |
| `dimos-ar/dimos/ar/websocket/test_server_info.py` | ARModule | full-text | 31 | `02ae3fd41e7b2e81adaa1e5bb795a1a9c6ca72352b11b2d8559c4cc3b0179abe` |
| `dimos-ar/dimos/ar/worker.py` | ARModule | full-text | 40 | `e80c18094337a0b68332b45c59a12b2d38a14a250312aa46fab667a751318c27` |
| `dimos-ar/pyproject.toml` | Tooling | full-text | 90 | `42dac497b4d2fed01c1958ea6d9db6922ca8a63b81fd91d18b4971407a85e3d2` |
| `dimos-ar/requirements-ci.txt` | Tooling | full-text | 7 | `440b79dabda64a99c1eeb9e64d4c98b6bacf6a5ed395a65af6653961f0b43ca3` |
| `dimos-ar/test_support/__init__.py` | ARModule | full-text | 1 | `f0657e2642a7b1cc9102e63904c6b050f0ac4796bcdd3c4f849881ca54ca017f` |
| `dimos-ar/test_support/localization.py` | ARModule | full-text | 102 | `20797da6530e34ee438b71d141b8e4c4f49b7b715d85d5050134d32a3ccda8b1` |
| `dimos-ar/test_support/manipulation.py` | ARModule | full-text | 81 | `d022210969c3908e1abc9e29d2808855a2cf397d810cfbc3d386f5c91f5395aa` |
| `dimos-ar/test_support/module.py` | ARModule | full-text | 159 | `d746d851a350a2b5311bfa74e0949ee8b6be9623c92e03ce060982dc6f2f9286` |
| `dimos-ar/test_support/websocket.py` | ARModule | full-text | 208 | `844c872bd810d6fbe973b09cebc481bef3a54e47acdbb3afca51d71af08c0f36` |
| `dimos-ar/tools/benchmark_mock_arm.py` | Tooling | full-text | 88 | `45f6072c62792fb2d40bc019f53b371cb6164300d8b859667fd47c4796a2a4bb` |
| `dimos-ar/tools/check_go2_registration.py` | Tooling | full-text | 141 | `1dea0d403c0826c85c5d9082d61e2dde2d3794f7c9baef6bc9502d43ccf7b980` |
| `dimos-ar/tools/check_manipulation_scene.py` | Tooling | full-text | 101 | `8dfa9b15f473510b47f728fae2de212c9b7d46a71e490d04f77f847f9dd6668d` |
| `dimos-ar/tools/mock_runtime_client.py` | Tooling | full-text | 202 | `700f29e97976fc66677411a93ca9e1aa497a53074db0cadebde7e58d5a0a1383` |
| `dimos-ar/tools/run_mock_manipulation_contract.py` | Tooling | full-text | 207 | `4cf73c6f7820dc84f2bab24057a28684979d826322d3200b694d9d2317c8be07` |
| `dimos-ar/tools/test_arm_supervisor.py` | Tooling | full-text | 90 | `fce3c67f492ddaf4bb28d31b85d37046256283a36d704096e5becfcc39780ca7` |
| `dimos-ar/tools/test_check_go2_registration.py` | Tooling | full-text | 28 | `714c9afe412436b43bd2e70732abc78d905dda2df182d19260883de1af261878` |
| `dimos-ar/tools/test_manipulation_runtime.py` | Tooling | full-text | 106 | `b3b822b6aee450f68d60db1ab0ddf3669c74d4c522e61dc02a442505af3b6949` |
| `dimos-ar/tools/test_mock_manipulation_contract_runner.py` | Tooling | full-text | 123 | `8dba5719e35c2b2e76d7531bd5a48aa55750319fd670ff272d8ea56bfd7f7b5a` |
| `dimos-ar/tools/test_mock_runtime_client.py` | Tooling | full-text | 140 | `d065e7fadc65fc3b64fc6b47322a8b3b06ca1ad695d0733aa2aa25b3af61ab13` |
| `docs/architecture.md` | Documentation and assets | full-text | 195 | `da5b9a45888fcfbbfd51db8f8a2d9314a3d8c03620b1dc13347bcffae555eee0` |
| `docs/dimos-compatibility.md` | Documentation and assets | full-text | 87 | `4810d428fce8f801b79a8dd1bc62e67139aaad32a2177d7198374d7d9c1c421b` |
| `docs/hardware-validation.md` | Documentation and assets | full-text | 19 | `609373887cde164dcfe6a5f56805fe59b10a08ecf7ac92eb58fba1deec9137ed` |
| `implementation-status.json` | Tooling | full-text | 401 | `4cee626d94acce868ea86d8a43aa9ac24c8a3d5a8fdd1629ab136784c9492763` |
| `launcher/Start Launcher.command` | Tooling | full-text | 4 | `ec819e4391c4ec12d8043012edda293fc3f8f670a0cc13ce27a8d5b1eb177928` |
| `launcher/app/app.py` | Tooling | full-text | 688 | `d60229b684de550c923a285904146864eb71ad6adbf649a90c6f442fbbf0a7b3` |
| `launcher/app/apriltag_assets.py` | Tooling | full-text | 107 | `330c20df6e7291ea28b5dfa7014bbe77ed9b943e44cbdf0096a209204f3fceb0` |
| `launcher/app/armodule.py` | Tooling | full-text | 1219 | `6eb616ceee5f65d5d4370ae2e70c00684e1d24a71692b168afa215aac3b8c723` |
| `launcher/app/can_setup.py` | Tooling | full-text | 131 | `e4fed49a298c6d42ce8140aec08ca9b54e1f6fcb5f60bd94b7e015b0e38dd179` |
| `launcher/app/config.py` | Tooling | full-text | 95 | `e7a46f3a25ed270fe94702d7c95b38694a3fbe3c027b99209503d59e6368ab80` |
| `launcher/app/dimos_config.py` | Tooling | full-text | 32 | `1cad1fdbf6d0638033b3528d1b77de98477b74cde1a9f7da121c73be6d24a305` |
| `launcher/app/discovery.py` | Tooling | full-text | 45 | `04534f3a8f2dc4e1d8ad68dd817e24022e303583e5de98d23ef4dabc149350e7` |
| `launcher/app/launcher_events.py` | Tooling | full-text | 91 | `ed46df6bf8e0128c626097cfc2f54f7bbb2a31177b2ef2863439b5f0c23fc550` |
| `launcher/app/owned_operation.py` | Tooling | full-text | 34 | `001c886b2829c5fa158cfb835843a5a52f3d23700532606cfe6b33c1816560c8` |
| `launcher/app/planner_check.py` | Tooling | full-text | 87 | `cb06b32ad59968abe4480aac74dd001dd8223fc638c33b5f346da19ba6dd1a3f` |
| `launcher/app/planner_install.py` | Tooling | full-text | 87 | `926cd75647f63051df4cac4490549546fb443360faa10692075c63eee6c3caf1` |
| `launcher/app/preferences.py` | Tooling | full-text | 36 | `7c05508969486bfada272c6bc6c7a04df07eb31172e99301a290c967d4ffc2b4` |
| `launcher/app/profiles/README.md` | Documentation and assets | full-text | 30 | `8d81ff0e0ea3cce3ee65be3e772f5937dd854bc826781797fb7677f5155701f0` |
| `launcher/app/profiles/openyam.json` | Tooling | full-text | 20 | `eda3f6295c8024c78c42b2eb7c364352c97ee251814673cf6686486ee041223a` |
| `launcher/app/pytest.ini` | Tooling | full-text | 5 | `eb766feeaef63acc06fc9bbddd78e10d6fec86cfd24712c2e7f32c305bcbe944` |
| `launcher/app/requirements-dev.txt` | Tooling | full-text | 6 | `28fa172c07c2b3f308b33b283225522912ad4b81179d4448ccb125b38072fdaa` |
| `launcher/app/requirements.txt` | Tooling | full-text | 6 | `a9401343c9caa4eb46af4ceda85618e367a493b49c7c0124309c01e79a634811` |
| `launcher/app/robot_profiles.py` | Tooling | full-text | 148 | `18c60a43c00a48cd3f8af9b757fc09c567ee5c7130d0c64bbc0ed0153f1e6086` |
| `launcher/app/robot_sources.py` | Tooling | full-text | 106 | `00c7e872257acd013d61c8b5bbd0aa3349aa281629e88305718e90313400b161` |
| `launcher/app/static/app.css` | Tooling | full-text | 1125 | `1cc869cdd10149e3af0c1be3891ef108faffb0d27c1535758d59257fe00211d7` |
| `launcher/app/static/app.js` | Tooling | full-text | 1412 | `57c717bd9ba696ab3967664305a0978d60b7db2767548fa8ee08ae5d9a618ea2` |
| `launcher/app/static/index.html` | Tooling | full-text | 355 | `1d42370f123dc6ef61fa222cbe067f3d46664a4d3f5203ff4dcdf3a3f014495d` |
| `launcher/app/static/log-console.mjs` | Tooling | full-text | 179 | `a2a9cb4a54f4ce68a6321a6427f6d776a90c8179a698a9028497866d701a3109` |
| `launcher/app/static/persistence.mjs` | Tooling | full-text | 42 | `06cf8104fd06f52ae63a371cae756985cbb63d3b68062aacfce758f20ce8f0f7` |
| `launcher/app/static/presentation.mjs` | Tooling | full-text | 19 | `dd0bd709a888fea8cc6bd2ec03625994466103b218d5e484e1691b2e344b69bb` |
| `launcher/app/static/source-selection.mjs` | Tooling | full-text | 17 | `1b85de232160a081aa9c8b9a7617cb6d3cd215a8b9c13efdf80d1b28f690d0f8` |
| `launcher/app/tag_config.py` | Tooling | full-text | 248 | `7a211886a98c3719a8a928f9478b01e6d5b9aa0e379e3161e47b0b505f552abf` |
| `launcher/app/tests/__init__.py` | Tooling | full-text | 1 | `858cde20334a1b989466803e5fd790942ddd2530b5d87bddf988c34aed60b35c` |
| `launcher/app/tests/conftest.py` | Tooling | full-text | 73 | `5b11dbd44ba2b342ff8d25e25791c6a2dc56e7fcaa920a2c08bcb6f1102a9567` |
| `launcher/app/tests/processes.py` | Tooling | full-text | 52 | `49d78e5609c03f38248ee406178f0bb0a155ccca42c250a6d7f24270795282a9` |
| `launcher/app/tests/static.test.mjs` | Tooling | full-text | 76 | `c3a2720d005fff2325661bfe8d47482e73cf6553b8aeaa383d16a7b84c0b2e3c` |
| `launcher/app/tests/test_apriltag_assets.py` | Tooling | full-text | 65 | `c8bcc41828c8c57c2f04fd2774c313abf2c4f0526c4d7539f28edccfe36c1134` |
| `launcher/app/tests/test_argv.py` | Tooling | full-text | 134 | `9fb99522db22e6a1b90867be609d8d0db33d72c2d312dab8ba971b2c6d01a7e8` |
| `launcher/app/tests/test_can_setup.py` | Tooling | full-text | 229 | `cdcbfc07d11f2f383fc01533f02c5e7a9815ad9c5db6a42b0b401e2d03220c36` |
| `launcher/app/tests/test_check_openai_key.py` | Tooling | full-text | 30 | `d60a9641870c5834da3f6a528b6aeae4b7dc5f09d878c5e7ca50994134ad7b77` |
| `launcher/app/tests/test_ci_lfs_hydration.py` | Tooling | full-text | 97 | `c3bc9fb58c974ef50cc877bfb3e51109dc4df676a242101116534363e1b54815` |
| `launcher/app/tests/test_config_env.py` | Tooling | full-text | 44 | `03c77e3e7d79136364b13e84c0fb6ba8f2e180e08db87b5b8b9bf3f249cf5693` |
| `launcher/app/tests/test_dependency_cancellation.py` | Tooling | full-text | 65 | `417e6a532c7453ed2e10da271c05986e6bbe5d6a19a244e3c16f6a54e7ae251d` |
| `launcher/app/tests/test_dimos_config.py` | Tooling | full-text | 65 | `4609cdae22e0bc67a60f6d9d4ab743a3cbf0c810d42d1b5dcc0ecb43ef924b97` |
| `launcher/app/tests/test_dimos_install_selection.py` | Tooling | full-text | 121 | `1d9d5dd29e62c9a866661b0d327f1ccbb8fca4476de3e6daa601acde7d115a21` |
| `launcher/app/tests/test_discovery.py` | Tooling | full-text | 162 | `9a4d3e1d5e67a10ff046e0c88f916a90722d8c404dbbce114a54fa6e6a4b7725` |
| `launcher/app/tests/test_lan_ip.py` | Tooling | full-text | 30 | `f8892601ad655cad251d41b1e2c2f60f0d96f3b7781291b4694ea23e3e43a853` |
| `launcher/app/tests/test_planner_check.py` | Tooling | full-text | 114 | `6b036b5a7b87b56155a1fb88394eb0df58414ed8170fe7dbe25f0613cf22f95c` |
| `launcher/app/tests/test_profile_names.py` | Tooling | full-text | 29 | `161237f7741f7ea8e901565961b2e05bbf1b5feae37025741bc7b9fcbae86925` |
| `launcher/app/tests/test_robot_profiles.py` | Tooling | full-text | 140 | `6fda8a6fe3abe898bf170bbabf48257a2a32b2c4f58bdd7e5058167d5eaf7919` |
| `launcher/app/tests/test_robot_sources.py` | Tooling | full-text | 72 | `9dd090ccbd0ab22e7b33ec229026c5960eeda4d150df4b751b4d2fd90e5cf7dc` |
| `launcher/app/tests/test_sensor_codec_diagnostics.py` | Tooling | full-text | 31 | `a4e9110abfb95fe72db529eb573e5107a57546958f34bf7fb6af92d2d22f9958` |
| `launcher/app/tests/test_settings_api.py` | Tooling | full-text | 282 | `cd36cf271b90de3bf89fd56c0f67661122e43c1ef708c260fc8d6b44b92aea76` |
| `launcher/app/tests/test_static_modules.py` | Tooling | full-text | 15 | `2efb43b71708cba7496840a5bc703f0d08e94ecb35004ae0d60fa9e052a6c5a9` |
| `launcher/app/tests/test_status_parse.py` | Tooling | full-text | 178 | `47b8115b90db63bbd17baa15d4643a8caf10561ca49bce35bf90a22c9861f196` |
| `launcher/app/tests/test_stop_grace.py` | Tooling | full-text | 101 | `e36d3035607be65735bbea71e9d53ddce236fdf3bbc6174ac48c0111040ecba9` |
| `launcher/app/tests/test_stop_orphans.py` | Tooling | full-text | 107 | `8651f79503f7424e6fd3cc91cd9eead68f0db8b3c5069fe4002a8f01fcf2cfa6` |
| `launcher/app/tests/test_sysconfig.py` | Tooling | full-text | 22 | `98d75d157a4a39caa9e9aba4d38877d3ce55578faeb975a392cffea2f9002a16` |
| `launcher/app/tests/test_tag_config.py` | Tooling | full-text | 152 | `3d08e41f53b255c0441364ead57be282cc93313371c61243f972b3689bdaf169` |
| `launcher/app/tests/test_tag_env_on_start.py` | Tooling | full-text | 135 | `bf558dbbd332b85adfb1604bfa32cb4dd1f1890fbc93acc418084295d384c93f` |
| `launcher/app/tests/test_webxr_startup.py` | Tooling | full-text | 432 | `d437be235f44f55d6e8d4f2672baa1362f0ebfc5e9158954465c7d51c762f067` |
| `launcher/scripts/configure-system.sh` | Tooling | full-text | 213 | `3d5b2d5050913104d1bfaaed1d8a3ed0725d9af1127e3a0bdc6de67160f3d934` |
| `launcher/scripts/diagnose-sensor-codecs.py` | Tooling | full-text | 98 | `5117462ae88a2f2bca7cd8cc043e8f60bdbc3a418f38cf8aa3e1ddb54cab213c` |
| `launcher/scripts/dimos_lib.sh` | Tooling | full-text | 242 | `f2f89f84c45453a190a8d749fa3017881d915692ec22c777a186a8029798e51d` |
| `launcher/scripts/robot_discovery.py` | Tooling | full-text | 43 | `88cca82a76bf888aa178c05dd487ccc80bcb76064662125a2c842eb823fa0eb1` |
| `launcher/scripts/run-ci.sh` | Tooling | full-text | 193 | `926581c70d9c395afd00bf15b302be2846b7f43b6a5907dc20e0f928d8f3b76a` |
| `launcher/scripts/setup.sh` | Tooling | full-text | 433 | `68693989b547b07825214a13274691a68c532810fc30dcbffab1162da1245914` |
| `launcher/scripts/start-launcher.sh` | Tooling | full-text | 79 | `13f1258b8940d9b4392d177d3a8af864e8cd53d93e21131724178e00d213bf7b` |
| `launcher/scripts/start.sh` | Tooling | full-text | 358 | `5b125f57808088e3cf4a13da6598ab976afbd3768aa5adbe6d10b887f0f61911` |
| `launcher/scripts/supervise-arm.py` | Tooling | full-text | 158 | `6c8300a11cd4bce6b61dbd09265638876911e7897993438fec80bb2a27928a87` |
| `spectacles-dimensional-os.code-workspace` | Tooling | full-text | 27 | `f4a5cfde12d9282dd14c9142c18684f06efdab534f1a075ac6ce534b3925785f` |
| `tools/integration-tests/README.md` | Documentation and assets | full-text | 114 | `737cbfb2763e528148916e08c9a7d0cd123866fa3db77e19016de63363799fe2` |
| `tools/integration-tests/artifacts.mjs` | Tooling | full-text | 314 | `54c0c1a9bd9f1ce9adaab9367c8cd692064049c821cb279ece5e9a402116365d` |
| `tools/integration-tests/catalog.mjs` | Tooling | full-text | 43 | `b6dcf47c1a26bdbf0fe93ea0f30fddb5f41987d69a7e53b64b80f86845a6d848` |
| `tools/integration-tests/cleanup.mjs` | Tooling | full-text | 9 | `f77a485ac86ad6f07cf22ad43aafc888b575caffdf6fa60da02f10dc7f1550a3` |
| `tools/integration-tests/finalize.mjs` | Tooling | full-text | 225 | `a603a8ee56c4984530524259257a861d70505b659799406569dcbf708721a496` |
| `tools/integration-tests/integration.test.mjs` | Tooling | full-text | 305 | `fbfb3fe942e41bef6698e1990c72d59103913502e16f461f9930f01268f1b987` |
| `tools/integration-tests/scenarios.json` | Tooling | full-text | 644 | `03e7ce7f4bb95caec4f296288a5913eabc729fee1cae8216dc1e1533aae72971` |
| `tools/reviews/benchmark_transport.py` | Tooling | full-text | 278 | `160d3fafa596935aaf07d9b8deec19599f2ad0fdfb191843ac8224512ef94be2` |
| `tools/visual-review.mjs` | Tooling | full-text | 173 | `539e4d18fc01ff706d5b95a2e8da61ad7bb6f281818d9395951b3691b10b80cb` |
| `tools/visual-review.test.mjs` | Tooling | full-text | 24 | `5c9f5039890522dcff5c3a32b37d5f080703d8357d7578d83ac122ba3c0dfe97` |
