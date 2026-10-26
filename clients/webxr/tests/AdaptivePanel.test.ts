// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => {
  class AudioContextStub {
    destination = {};
    createGain() { return { connect() {}, gain: { value: 1 } }; }
  }
  Object.defineProperty(window, "AudioContext", { value: AudioContextStub, configurable: true });
});
import * as THREE from "three";
import * as xb from "xrblocks";
import { MainMenuView } from "../src/presentation/MainMenuView";
import { PanelHeightController } from "../src/presentation/PanelHeightController";
import { RUNTIME_FOOTER_GAP, RUNTIME_LAYOUTS, SETUP_LAYOUTS } from "../src/presentation/PanelLayout";
import type { WebXRUISnapshot } from "../src/presentation/WebXRUIPresenter";
import type { GlassSurface } from "../src/presentation/GlassSurface";

const views: MainMenuView[] = [];
afterEach(() => { for (const view of views) view.dispose(); views.length = 0; });
function harness() {
  const noop = () => {};
  const estop = vi.fn();
  const view = new MainMenuView({ onSetup: noop, onBack: noop, onRetry: noop, onRestart: noop, onMenu: noop, onMode: noop,
    onRobot: noop, onDebug: noop, onLidar: noop, onLocalize: noop, onRealign: noop, onEstop: estop, onDraft: noop, onAgentText: () => true });
  views.push(view);
  const snap: WebXRUISnapshot = {
    setupCompleted: true, menuOpen: true, wizardStep: "connect", robotName: "Go2", robotSelected: true, robotSelectable: true,
    robotConnectionText: "Connected", connectionText: "Connected", connectionTone: "success", operatingMode: "manual", debugEnabled: false,
    agentAvailable: true, lidarAvailable: true, estopAvailable: true, estopReason: null, activity: "Idle", hasTrackingOrigin: true, lidarMode: "off", debugText: "Diagnostics",
    wizardTitle: "", wizardDescription: "", wizardCardTitle: "Connected", wizardCardBody: "Ready", nextLabel: "Continue", localizationIssue: null,
    captureText: "", captureTone: "muted", backVisible: false, agentMessage: null, hudText: null, hudTone: null,
  };
  const internals = view as unknown as { heightController: PanelHeightController; plate: GlassSurface; hud: xb.TextView; cardTitle: xb.TextView; chat: THREE.Group;
    manualHelp: THREE.Group; wizardBody: THREE.Group; wizardFooter: THREE.Group; header: THREE.Group; estop: xb.TextButton;
    settingsOpen: boolean; sensorsOpen: boolean; detailsOpen: boolean; appearanceRoot: THREE.Group };
  const apply = (overrides: Partial<WebXRUISnapshot> = {}) => view.apply({ ...snap, ...overrides });
  const settle = () => view.updateHover([], 0.28);
  const top = () => internals.plate.localToWorld(new THREE.Vector3(0, internals.heightController.height / 2, 0));
  return { view, snap, internals, apply, settle, top, estop };
}

it("keeps the world top and header stationary while resizing a rotated, scaled panel", () => {
  const f = harness(); f.apply(); f.settle();
  f.view.panel.position.set(0.3, 1.2, -1);
  f.view.panel.quaternion.setFromEuler(new THREE.Euler(0.2, 0.5, 0));
  f.view.panel.scale.multiplyScalar(1.3);
  f.settle(); // Normalize physical control depth after the external scale change.
  const top = f.top();
  const title = f.view.panel.getObjectByName("Global settings")!;
  const header = title.getWorldPosition(new THREE.Vector3());
  f.apply({ operatingMode: "agent" });
  expect(f.internals.chat.visible).toBe(false);
  expect(f.internals.chat.userData.rayDisabled).toBe(true);
  for (let i = 0; i < 4; i++) {
    f.view.updateHover([], 0.07);
    expect(f.top().distanceTo(top)).toBeLessThan(1e-7);
    expect(title.getWorldPosition(new THREE.Vector3()).distanceTo(header)).toBeLessThan(1e-7);
    expect(f.internals.estop.position.y * 0.76 - 0.032).toBeCloseTo(0.38 - f.internals.heightController.height + 0.05);
  }
  expect(f.internals.heightController.height).toBe(RUNTIME_LAYOUTS.agent.height);
  expect(f.internals.chat.visible).toBe(true);
  f.internals.estop.onTriggered(0); expect(f.estop).toHaveBeenCalledOnce();
  f.apply(); f.view.updateHover([], 0.14);
  expect(f.top().distanceTo(top)).toBeLessThan(1e-7);
  expect(f.internals.chat.visible).toBe(false);
  f.settle(); expect(f.internals.heightController.height).toBe(RUNTIME_LAYOUTS.manual.height);
});

it("pauses resizing during a grab and resumes from the released pose with current-size hit zones", () => {
  const f = harness(); f.apply(); f.settle(); f.view.panel.position.z = -1;
  f.apply({ operatingMode: "agent" }); f.view.updateHover([], 0.07);
  const height = f.internals.heightController.height;
  const grab = f.internals.plate.localToWorld(new THREE.Vector3(0, 0, 0));
  expect(f.view.beginManipulation([grab.x, grab.y, 0], [0, 0, -1], new THREE.Quaternion(), true)).toBe(true);
  f.view.updateHover([], 1);
  expect(f.internals.heightController.height).toBe(height);
  f.view.updateManipulation([grab.x + 0.1, grab.y, 0], [0, 0, -1], new THREE.Quaternion(), 1);
  f.view.endManipulation(); const top = f.top();
  f.settle(); expect(f.top().distanceTo(top)).toBeLessThan(1e-7);
  f.apply(); f.settle();
  const root = f.internals.appearanceRoot;
  const below = root.localToWorld(new THREE.Vector3(0, -0.48, 0));
  expect(f.view.beginManipulation([below.x, below.y, 0], [0, 0, -1], new THREE.Quaternion(), true)).toBe(false);
  const corner = root.getObjectByName("Resize corner")!;
  const position = corner.getWorldPosition(new THREE.Vector3());
  const anchor = root.localToWorld(new THREE.Vector3(0.45 / 0.76, 0.5, 0));
  expect(f.view.beginManipulation([position.x, position.y, 0], [0, 0, -1])).toBe(true);
  f.view.updateManipulation([position.x - 0.1, position.y - 0.1, 0], [0, 0, -1]);
  expect(root.localToWorld(new THREE.Vector3(0.45 / 0.76, 0.5, 0)).distanceTo(anchor)).toBeLessThan(1e-7);
  f.view.endManipulation();
});

it("preserves the top through setup/runtime scaling, hidden changes and appearance animation", () => {
  const f = harness(); f.apply({ setupCompleted: false, connectComplete: true }); f.settle();
  const top = f.top();
  f.apply(); expect(f.top().distanceTo(top)).toBeLessThan(1e-7); f.settle();
  f.apply({ menuOpen: false, operatingMode: "agent" });
  expect(f.internals.heightController.height).toBe(RUNTIME_LAYOUTS.agent.height);
  f.view.updateHover([], 0.09);
  expect(f.top().distanceTo(top)).toBeLessThan(1e-7);
  f.view.updateHover([], 0.09); f.apply({ operatingMode: "agent" }); f.settle();
  expect(f.top().distanceTo(top)).toBeLessThan(1e-7);
});

it.each([
  ["entry", { setupCompleted: false, connectComplete: false }],
  ["error", { setupCompleted: false, connectComplete: false, connectionTone: "error" }],
  ["connected", { setupCompleted: false, connectComplete: true }],
  ["capture", { setupCompleted: false, wizardStep: "localization", localizationKind: "marker" }],
  ["message", { setupCompleted: false, wizardStep: "localization", localizationIssue: "Camera unavailable" }],
  ["message", { setupCompleted: false, wizardStep: "localization", localizationKind: "unavailable" }],
  ["success", { setupCompleted: true, setupCelebrating: true, setupSuccessProgress: 1 }],
] as const)("fits the setup %s state without leaving stale body layouts", (name, overrides) => {
  const f = harness(); f.apply(overrides); f.settle();
  expect(f.internals.heightController.height).toBe(SETUP_LAYOUTS[name].height);
  const bottom = 0.38 - f.internals.heightController.height;
  f.view.panel.traverse(node => {
    for (let parent: THREE.Object3D | null = node; parent; parent = parent.parent) if (!parent.visible) return;
    if (!(node instanceof xb.TextView) || node.name === "Robot selection button") return;
    const local = f.internals.appearanceRoot.worldToLocal(node.getWorldPosition(new THREE.Vector3()));
    const halfHeight = node.rangeY * node.getWorldScale(new THREE.Vector3()).y / f.view.panel.scale.y / 2 * 0.76;
    expect(local.y * 0.76 - halfHeight).toBeGreaterThanOrEqual(bottom + 0.049);
    expect(local.y * 0.76 + halfHeight).toBeLessThanOrEqual(0.38 - 0.049);
  });
});

it.each(["settings", "sensors", "diagnostics", "alignment"] as const)("fits the runtime %s body and footer", name => {
  const f = harness(); f.apply(); f.settle();
  f.internals.settingsOpen = name === "settings";
  f.internals.sensorsOpen = name === "sensors";
  f.internals.detailsOpen = name === "diagnostics";
  f.apply(name === "alignment" ? { alignmentReview: { reason: "Tracking resumed", pending: true } } : {}); f.settle();
  expect(f.internals.heightController.height).toBe(RUNTIME_LAYOUTS[name].height);
  const bottom = 0.38 - f.internals.heightController.height;
  f.view.panel.traverse(node => {
    for (let parent: THREE.Object3D | null = node; parent; parent = parent.parent) if (!parent.visible) return;
    if (!(node instanceof xb.TextButton) || node.name === "Robot selection button") return;
    const local = f.internals.appearanceRoot.worldToLocal(node.getWorldPosition(new THREE.Vector3()));
    expect(local.y * 0.76 - node.rangeY * node.scale.y * 0.76 / 2).toBeGreaterThanOrEqual(bottom + 0.049);
  });
});

it("keeps space above Emergency Stop through every runtime page resize", () => {
  const f = harness(); f.apply(); f.settle();
  for (const page of ["agent", "settings", "sensors", "diagnostics", "alignment", "manual", "agent"] as const) {
    f.internals.settingsOpen = page === "settings";
    f.internals.sensorsOpen = page === "sensors";
    f.internals.detailsOpen = page === "diagnostics";
    f.apply({ operatingMode: page === "agent" ? "agent" : "manual",
      alignmentReview: page === "alignment" ? { reason: "Tracking resumed", pending: true } : null });
    for (let frame = 0; frame < 10; frame++) {
      f.view.updateHover([], 0.028);
      const footerTop = f.internals.estop.position.y + f.internals.estop.rangeY * f.internals.estop.scale.y / 2;
      f.view.panel.traverse(node => {
        if (!(node instanceof xb.TextView) || node === f.internals.estop || node.name === "Robot selection button") return;
        for (let parent: THREE.Object3D | null = node; parent; parent = parent.parent) if (!parent.visible) return;
        const center = f.internals.appearanceRoot.worldToLocal(node.getWorldPosition(new THREE.Vector3()));
        const scale = node.getWorldScale(new THREE.Vector3()).y / f.internals.appearanceRoot.getWorldScale(new THREE.Vector3()).y;
        const bottom = center.y - node.rangeY * scale / 2;
        expect((bottom - footerTop) * 0.76).toBeGreaterThanOrEqual(RUNTIME_FOOTER_GAP - 1e-8);
      });
    }
  }
});

it("keeps robot activity only in the robot badge while preserving menu errors", () => {
  const f = harness();
  for (const activity of ["Idle", "Following Path", "Thinking"]) {
    f.apply({ activity });
    const robot = f.view.panel.getObjectByName("Robot selection button") as xb.TextButton;
    expect(robot.text).toContain(activity === "Following Path" ? "Following path" : activity);
    expect(f.internals.hud.text).toBe("");
  }
  f.apply({ hudText: "Connection interrupted", hudTone: "warn" });
  expect(f.internals.hud.text).toBe("Connection interrupted");
});

it("colors the connected setup heading green and resets it for other states", () => {
  const f = harness(); f.apply({ setupCompleted: false, connectComplete: true });
  expect(f.internals.cardTitle.fontColor).toBe("#30d158");
  f.apply({ setupCompleted: false, connectComplete: false });
  expect(f.internals.cardTitle.fontColor).toBe("#ffffff");
  f.apply({ setupCompleted: false, connectComplete: true, wizardStep: "localization" });
  expect(f.internals.cardTitle.fontColor).toBe("#ffffff");
});
