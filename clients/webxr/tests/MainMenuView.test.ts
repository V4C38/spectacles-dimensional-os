// @vitest-environment jsdom
import { MenuAnchorController } from "../src/input/MenuAnchorController";
import { expect, it, vi } from "vitest";
vi.hoisted(() => {
  class AudioContextStub {
    destination = {};
    createGain() { return { connect() {}, gain: { value: 1 } }; }
  }
  Object.defineProperty(window, "AudioContext", { value: AudioContextStub, configurable: true });
});
import * as xb from "xrblocks";
import { SurfaceButton } from "../src/presentation/SurfaceButton";
import { DIMOS_AR_DESIGN } from "../src/presentation/DimOSARDesign";
import { MainMenuView } from "../src/presentation/MainMenuView";

it("constructs real XR Blocks buttons and activates the supported trigger hook", () => {
  const handlers = { onSetup: vi.fn(), onBack: vi.fn(), onRetry: vi.fn(), onRestart: vi.fn(), onMenu: vi.fn(), onMode: vi.fn(), onRobot: vi.fn(), onDebug: vi.fn(), onLidar: vi.fn(), onLocalize: vi.fn(), onRealign: vi.fn(), onEstop: vi.fn(), onDraft: vi.fn(), onAgentText: vi.fn(() => true) };
  const view = new MainMenuView(handlers);
  expect(view.panel.scale.x).toBeCloseTo(DIMOS_AR_DESIGN.panel.height * 0.432);
  expect(view.panel.getObjectByName("Sensors camera icon")?.children).toHaveLength(2);
  const buttons: xb.TextButton[] = [];
  view.panel.traverse(object => { if (object instanceof xb.TextButton) buttons.push(object); });
  const next = buttons.find(button => button.text === "Continue")!;
  expect(next).toBeInstanceOf(xb.TextButton);
  next.onTriggered(0);
  expect(handlers.onSetup).toHaveBeenCalledOnce();
  const initialPanelScale = view.panel.scale.x;
  view.panel.position.set(0, 0, -1);
  view.panel.updateWorldMatrix(true, true);
  const edge = view.panel.localToWorld(new THREE.Vector3(0.65, 0, 0));
  expect(view.beginManipulation([edge.x, edge.y, 0], [0, 0, -1])).toBe(false);
  const corner = view.panel.localToWorld(new THREE.Vector3(0.58, -0.48, 0));
  expect(view.beginManipulation([corner.x, corner.y, 0], [0, 0, -1])).toBe(true);
  view.updateManipulation([corner.x + 0.1, corner.y - 0.1, 0], [0, 0, -1]);
  expect(view.panel.scale.x).toBeGreaterThan(initialPanelScale);
  view.endManipulation();
  view.panel.traverse(object => { object.visible = true; });
  buttons.find(button => button.text === "EMERGENCY STOP")!.onTriggered(0);
  expect(handlers.onEstop).toHaveBeenCalledOnce();
  next.setText("Skip"); expect(next.text).toBe("Skip");
  buttons.find(button => button.text === "Clear")!.onTriggered(0);
  expect(handlers.onDraft).toHaveBeenCalledWith("");
  expect(buttons.some(button => button.text === "Type / Edit")).toBe(false);
  view.panel.visible = false;
  next.onTriggered(0);
  expect(handlers.onSetup).toHaveBeenCalledOnce();
});

it("grips the panel body, rotates around the grab point with smoothing, and retains the released pose", () => {
  const noop = () => {};
  const view = new MainMenuView({ onSetup: noop, onBack: noop, onRetry: noop, onRestart: noop, onMenu: noop, onMode: noop, onRobot: noop, onDebug: noop, onLidar: noop, onLocalize: noop, onRealign: noop, onEstop: noop, onDraft: noop, onAgentText: () => true });
  view.panel.position.set(0, 0, -1);
  expect(view.beginManipulation([0, 0, 0], [0, 0, -1], new THREE.Quaternion(), true)).toBe(true);
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
  const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(rotation).toArray() as [number, number, number];
  view.updateManipulation([0.2, 0, 0], direction, rotation, 0.016);
  const angle = view.panel.quaternion.angleTo(new THREE.Quaternion());
  expect(angle).toBeGreaterThan(0);
  expect(angle).toBeLessThan(Math.PI / 4);
  for (let i = 0; i < 90; i++) view.updateManipulation([0.2, 0, 0], direction, rotation, 0.016);
  expect(view.panel.quaternion.angleTo(rotation)).toBeLessThan(0.001);
  expect(view.panel.position.x).toBeCloseTo(0.2 + direction[0], 3);
  const released = view.panel.matrix.clone();
  view.endManipulation(); view.updateManipulation([5, 0, 0], [0, 0, -1]);
  expect(view.panel.matrix).toEqual(released);
});

import * as THREE from "three";
import { WebXRApp } from "../src/WebXRApp";
import { WebXRInputController } from "../src/input/WebXRInputController";
import { DimOSWebXRClient } from "../src/DimOSWebXRClient";
import { BrowserWebSocketTransport } from "../src/websocket/BrowserWebSocketTransport";
import { registerRayTarget } from "../src/input/XRBlocksRayInteraction";
import { cameraFixture } from "./fixtures/camera";

it("consumes UI selection, cancels drags on input loss, invalidates resets, and supports XR reentry", () => {
  const camera = cameraFixture();
  const client = new DimOSWebXRClient({ camera: camera.source, clock: { now: () => 10 }, transport: new BrowserWebSocketTransport({ url: "wss://test/ar", socketFactory: () => { throw new Error("offline test"); } }) });
  const tick = vi.spyOn(client, "tick").mockImplementation(() => {});
  vi.spyOn(client, "controlsEnabled").mockReturnValue(true);
  const hold = vi.spyOn(client, "holdNavigation").mockImplementation(() => {});
  const release = vi.spyOn(client, "releaseNavigation").mockImplementation(() => {});
  const invalidated = vi.spyOn(client, "invalidateTracking");
  const lost = vi.spyOn(client, "loseInput");
  let reference = new EventTarget();
  const setReferenceSpace = vi.fn((space: EventTarget) => { reference = space; });
  const getRenderer = vi.spyOn(xb.core, "renderer", "get").mockReturnValue({ xr: { getReferenceSpace: () => reference, setReferenceSpace } } as unknown as THREE.WebGLRenderer);
  const app = new WebXRApp(client);
  const input = new xb.Input();
  const scene = new THREE.Scene();
  const controllers = [new THREE.Group(), new THREE.Group()];
  input.init({ scene, systemsGroup: new THREE.Group(), options: new xb.Options(), renderer: {
    xr: { getController: (i: number) => controllers[i] },
  } as unknown as THREE.WebGLRenderer });
  scene.add(app);
  app.init({ input });
  const session = Object.assign(new EventTarget(), { visibilityState: "visible", inputSources: [] });
  app.onXRSessionStarted(session as unknown as XRSession);
  const frame = { getViewerPose: () => ({ transform: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } }) } as unknown as XRFrame;
  app.update(10, frame);
  const panel = app.children.find(object => object instanceof xb.SpatialPanel)!;
  panel.position.set(0, 0, -1);
  panel.quaternion.identity();
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  panel.add(surface); panel.visible = true;
  registerRayTarget(surface);
  const controller = new THREE.Object3D();
  scene.updateMatrixWorld(true);
  input.updateController(controller);
  app.onSelectStart({ target: controller }); app.onSelectEnd({ target: controller });
  expect(hold).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled();
  app.onSqueezeStart({ target: controller });
  expect((app as unknown as { panelGrip: boolean }).panelGrip).toBe(true);
  app.onSelectEnd({ target: controller });
  expect((app as unknown as { panelGrip: boolean }).panelGrip).toBe(true);
  app.onSqueezeEnd({ target: controller });
  expect((app as unknown as { panelGrip: boolean }).panelGrip).toBe(false);
  panel.visible = false;
  client.originStore.setFromLocalizationResult({ type: "localization_result", position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 10 });
  const worldSurface = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  worldSurface.position.z = -2;
  registerRayTarget(worldSurface);
  client.navigation.marker.object.add(worldSurface);
  client.navigation.marker.object.visible = true;
  scene.updateMatrixWorld(true);
  input.updateController(controller);
  app.onSelectStart({ target: controller }); expect(hold).toHaveBeenCalledOnce();
  session.dispatchEvent(new Event("inputsourceschange"));
  app.onSelectEnd({ target: controller }); expect(release).not.toHaveBeenCalled();
  expect(lost).toHaveBeenCalled();
  // Idle floor feedback prefers the right pointer, but a left press can still take ownership.
  vi.spyOn(client, "isRobotSelected").mockReturnValue(true);
  const left = new THREE.Object3D();
  const floor = (app as unknown as { navigationFloor: THREE.Mesh }).navigationFloor;
  input.intersectionsForController.set(left, [{ object: floor, point: new THREE.Vector3(0, 0, -1), distance: 1 }]);
  app.onSelectStart({ target: left }); expect(hold).toHaveBeenCalledTimes(2);
  app.onSelectEnd({ target: left }); expect(release).toHaveBeenCalledOnce();
  const aligned = client.originStore.setFromLocalizationResult({ type: "localization_result", position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 10 });
  client.ui.flow.finish();
  const beforeFocus = invalidated.mock.calls.length;
  session.visibilityState = "hidden"; session.dispatchEvent(new Event("visibilitychange"));
  app.update(10.1, frame);
  expect(client.originStore.T_odom_client).toBe(aligned);
  session.visibilityState = "visible"; session.dispatchEvent(new Event("visibilitychange"));
  app.update(10.2, frame);
  expect(client.ui.setupCompleted).toBe(true);
  expect(invalidated).toHaveBeenCalledTimes(beforeFocus);
  const retained = reference;
  reference = new EventTarget();
  app.update(10.25, frame);
  expect(setReferenceSpace).toHaveBeenLastCalledWith(retained);
  expect(invalidated).toHaveBeenCalledTimes(beforeFocus);
  const compensated = new EventTarget();
  const inverse = { position: { x: -1, y: 0, z: 0 } };
  const getOffset = vi.fn(() => compensated);
  Object.assign(reference, { getOffsetReferenceSpace: getOffset });
  reference.dispatchEvent(Object.assign(new Event("reset"), { transform: { inverse } }));
  expect(getOffset).toHaveBeenCalledWith(inverse);
  expect(setReferenceSpace).toHaveBeenCalledWith(compensated);
  app.update(10.3, frame);
  expect(client.originStore.T_odom_client).toBe(aligned);
  expect(client.ui.setupCompleted).toBe(true);
  expect(invalidated).toHaveBeenCalledTimes(beforeFocus);
  const resets = invalidated.mock.calls.length;
  reference.dispatchEvent(new Event("reset")); expect(invalidated).toHaveBeenCalledTimes(resets);
  // An uncompensated reset starts a new tracking reference and retires the old fix.
  expect(client.originStore.T_odom_client).toBeNull();
  app.onXRSessionEnded();
  const afterEnd = invalidated.mock.calls.length;
  reference.dispatchEvent(new Event("reset")); session.dispatchEvent(new Event("visibilitychange"));
  expect(invalidated).toHaveBeenCalledTimes(afterEnd);
  app.onXRSessionStarted(session as unknown as XRSession); app.update(11, frame);
  expect(tick).toHaveBeenCalledTimes(5);
  session.visibilityState = "hidden"; session.dispatchEvent(new Event("visibilitychange"));
  app.update(12, frame); expect(tick).toHaveBeenCalledTimes(5);
  app.dispose();
  getRenderer.mockRestore();
  surface.geometry.dispose(); (surface.material as THREE.Material).dispose();
});

it("keeps the panel upright while grabbing with a rolled and pitched controller", () => {
  const noop = () => {};
  const view = new MainMenuView({ onSetup: noop, onBack: noop, onRetry: noop, onRestart: noop, onMenu: noop, onMode: noop, onRobot: noop, onDebug: noop, onLidar: noop, onLocalize: noop, onRealign: noop, onEstop: noop, onDraft: noop, onAgentText: () => true });
  view.panel.position.set(0, 0, -1);
  view.panel.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.4);
  const bar = view.panel.localToWorld(new THREE.Vector3(0, -0.54, 0));
  expect(view.beginManipulation([bar.x, bar.y, 0], [0, 0, -1])).toBe(true);
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.3, Math.PI / 6, Math.PI / 4, "YXZ"));
  for (let i = 0; i < 120; i++) view.updateManipulation([bar.x, bar.y, 0], [0, 0, -1], rotation, 0.016);
  const euler = new THREE.Euler().setFromQuaternion(view.panel.quaternion, "YXZ");
  expect(euler.z).toBeCloseTo(0, 3);
  expect(euler.y).toBeCloseTo(Math.PI / 6, 2);
  expect(Math.abs(euler.x)).toBeCloseTo(THREE.MathUtils.degToRad(60), 2);
  view.endManipulation();
});


it("shows separate response and draft fields, moves robot controls into settings and gates Send", () => {
  const noop = () => {};
  const onMode = vi.fn(), onRobot = vi.fn(), onDebug = vi.fn();
  const view = new MainMenuView({ onSetup: noop, onBack: noop, onRetry: noop, onRestart: noop, onMenu: noop, onMode, onRobot, onDebug, onLidar: noop, onLocalize: noop, onRealign: noop, onEstop: noop, onDraft: noop, onAgentText: () => true });
  const buttons: xb.TextButton[] = [];
  view.panel.traverse(object => { if (object instanceof xb.TextButton) buttons.push(object); });
  const snap = {
    setupCompleted: true, menuOpen: true, wizardStep: "connect", robotName: "Unitree Go2", robotSelected: false, robotSelectable: true,
    robotConnectionText: "Connected", connectionText: "Connected", connectionTone: "success", operatingMode: "manual", debugEnabled: false,
    agentAvailable: true, lidarAvailable: true, estopAvailable: true, estopReason: null, activity: "Idle", hasTrackingOrigin: false, lidarMode: "off", debugText: "Connection: ready",
    wizardTitle: "", wizardDescription: "", wizardCardTitle: "", wizardCardBody: "", nextLabel: "", localizationIssue: null, captureText: "", captureTone: "muted", backVisible: false, agentMessage: null, hudText: null, hudTone: null,
  } satisfies import("../src/presentation/WebXRUIPresenter").WebXRUISnapshot;
  view.apply(snap);
  expect(view.panel.scale.x).toBeCloseTo(DIMOS_AR_DESIGN.panel.height * 0.432 * 0.8);
  const robot = buttons.find(button => button.name === "Robot selection button")!;
  expect(robot.text).toContain("Unitree Go2"); expect(robot.text).toContain("Idle"); expect(robot.fontColor).toBe("#ffffff");
  expect(robot.position.y).toBeGreaterThan(0.5);
  expect(view.ownsTarget(robot.mesh!)).toBe(true); expect(view.isControl(robot.mesh!)).toBe(true);
  robot.onTriggered(0); expect(onRobot).toHaveBeenCalledOnce();
  buttons.find(button => button.text === "Agent")!.onTriggered(0);
  expect(onMode).toHaveBeenCalledWith("agent");
  const speech = { status: "Ready", prompt: "go home", response: "Agent reply", severity: "ok", error: null, recognitionAvailable: true } satisfies import("@dimos-ar-client/agent/AgentDraftSession").AgentDraftSnapshot;
  view.apply({ ...snap, operatingMode: "agent" }, speech);
  const send = buttons.find(button => button.text === "Send to agent")!;
  expect((send as unknown as { enabled: boolean }).enabled).toBe(false);
  const dictation = buttons.find(button => button.name === "Agent dictation field")!;
  expect(view.isSpeechTarget(dictation.mesh!)).toBe(true);
  view.apply({ ...snap, operatingMode: "agent", robotSelected: true }, speech);
  expect((send as unknown as { enabled: boolean }).enabled).toBe(true);
  expect(robot.text).toContain("Selected");
  const settings = buttons.find(button => button.name === "Global settings")!;
  settings.onTriggered(0); view.apply({ ...snap, operatingMode: "agent", robotSelected: true }); view.updateHover([], 0.28);
  const diagnostics = buttons.find(button => button.text === "Diagnostics")!;
  diagnostics.onTriggered(0); expect(onDebug).not.toHaveBeenCalled();
  view.apply(snap);
  const debug = buttons.find(button => button.text === "Debug · Off")!;
  // Settings are hidden while diagnostics is open; hidden buttons cannot activate.
  debug.onTriggered(0); expect(onDebug).not.toHaveBeenCalled();
  const detailsDone = buttons.filter(button => button.name === "Done").find(button => button.parent?.visible && button.parent.userData.rayDisabled !== true)!;
  detailsDone.onTriggered(0); view.apply(snap); view.updateHover([], 0.28);
  debug.onTriggered(0); expect(onDebug).toHaveBeenCalledOnce();
  // Page transitions ease over 180 ms, and outgoing surfaces stop accepting input immediately.
  view.updateHover([], 0.18);
  const appearance = view.panel.getObjectByName("Menu appearance")!;
  view.apply({ ...snap, menuOpen: false });
  expect(view.panel.userData.rayDisabled).toBe(true);
  view.updateHover([], 0.09);
  expect(appearance.scale.x).toBeGreaterThan(0.85); expect(appearance.scale.x).toBeLessThan(1);
  expect(appearance.position.z).toBeCloseTo((1 - appearance.scale.z) * 0.001 / DIMOS_AR_DESIGN.panel.height);
  expect(view.panel.visible).toBe(true);
  view.updateHover([], 0.09);
  expect(view.panel.visible).toBe(false);
  view.apply(snap); view.updateHover([], 0.09);
  expect(view.panel.visible).toBe(true);
  expect(view.panel.userData.rayDisabled).toBe(false);
  view.updateHover([], 0.09);
  const before = robot.position.clone(); view.panel.scale.multiplyScalar(1.2);
  expect(robot.position).toEqual(before);
});


it("keeps every panel action inside its inset and leaves Emergency Stop a clear bottom margin", () => {
  const noop = () => {};
  const view = new MainMenuView({ onSetup: noop, onBack: noop, onRetry: noop, onRestart: noop, onMenu: noop, onMode: noop, onRobot: noop, onDebug: noop, onLidar: noop, onLocalize: noop, onRealign: noop, onEstop: noop, onDraft: noop, onAgentText: () => true });
  const buttons: xb.TextButton[] = [];
  view.panel.traverse(object => { if (object instanceof xb.TextButton && object.name !== "Robot selection button") buttons.push(object); });
  for (const button of buttons) {
    expect(Math.abs(button.position.x) + button.rangeX * button.scale.x / 2).toBeLessThanOrEqual((0.45 - 0.05) / DIMOS_AR_DESIGN.panel.height + 1e-8);
    expect(Math.abs(button.position.y) + button.rangeY * button.scale.y / 2).toBeLessThanOrEqual((DIMOS_AR_DESIGN.panel.height / 2 - 0.05) / DIMOS_AR_DESIGN.panel.height + 1e-8);
  }
  const stop = buttons.find(button => button.text === "EMERGENCY STOP")!;
  expect(stop.position.y - stop.rangeY * stop.scale.y / 2).toBeGreaterThan((-DIMOS_AR_DESIGN.panel.height / 2 + 0.04) / DIMOS_AR_DESIGN.panel.height);
  const send = buttons.find(button => button.text === "Send to agent")!;
  expect(send.position.y - send.rangeY * send.scale.y / 2 - (stop.position.y + stop.rangeY * stop.scale.y / 2)).toBeGreaterThan(0.035 / DIMOS_AR_DESIGN.panel.height);
  view.dispose();
});

it("disposes allocated UI resources once, including shared icon materials and scroll fields", () => {
  const noop = () => {};
  const view = new MainMenuView({ onSetup: noop, onBack: noop, onRetry: noop, onRestart: noop, onMenu: noop, onMode: noop, onRobot: noop, onDebug: noop, onLidar: noop, onLocalize: noop, onRealign: noop, onEstop: noop, onDraft: noop, onAgentText: () => true });
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  view.panel.traverse(node => {
    if (node instanceof THREE.Mesh || node instanceof THREE.Line) {
      geometries.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
    }
  });
  const checks = [...geometries, ...materials].map(resource => vi.spyOn(resource, "dispose"));
  view.dispose(); view.dispose();
  for (const check of checks) expect(check).toHaveBeenCalledOnce();
});

it("uses identical conversation fields, shared tabs and one robot badge in setup", () => {
  const noop = () => {};
  const view = new MainMenuView({ onSetup: noop, onBack: noop, onRetry: noop, onRestart: noop, onMenu: noop, onMode: noop, onRobot: noop, onDebug: noop, onLidar: noop, onLocalize: noop, onRealign: noop, onEstop: noop, onDraft: noop, onAgentText: () => true });
  const internals = view as unknown as { agent: xb.TextView; inputLabel: xb.TextView; inputField: xb.TextButton; robotBadge: THREE.Group; stepTabs: xb.TextButton[] };
  expect(internals.agent.width).toBe(internals.inputLabel.width);
  expect(internals.agent.height).toBe(internals.inputLabel.height);
  const fields: xb.TextButton[] = [];
  view.panel.traverse(node => { if (node instanceof xb.TextButton && node.height === DIMOS_AR_DESIGN.message.height / DIMOS_AR_DESIGN.panel.height) fields.push(node); });
  expect(fields).toHaveLength(2);
  const materials = fields.map(field => field.mesh!.material as THREE.ShaderMaterial);
  expect(materials[0].uniforms.uRadius.value).toBeCloseTo(materials[1].uniforms.uRadius.value);
  expect(internals.stepTabs).toHaveLength(2);
  // Setup retains the shared identity badge, without another status label in the header.
  view.apply({ setupCompleted: false, menuOpen: false, wizardStep: "connect", operatingMode: "manual", robotName: "Unitree Go2", robotSelected: false, robotSelectable: false, activity: "Idle", robotConnectionText: "Connected", connectionTone: "success", wizardDescription: "", wizardCardTitle: "", wizardCardBody: "", nextLabel: "Continue", debugText: "", agentAvailable: false, lidarMode: "off" } as never);
  expect(internals.robotBadge.visible).toBe(true);
  expect(internals.robotBadge.children.some(node => node instanceof xb.TextButton && node.text.includes("Unitree Go2"))).toBe(true);
  view.dispose();
});

it("separates tab layers and text depth without competing internal depth-buffer writes", () => {
  const noop = () => {};
  const view = new MainMenuView({ onSetup: noop, onBack: noop, onRetry: noop, onRestart: noop, onMenu: noop, onMode: noop, onRobot: noop, onDebug: noop, onLidar: noop, onLocalize: noop, onRealign: noop, onEstop: noop, onDraft: noop, onAgentText: () => true });
  const tabs: xb.TextButton[] = [];
  view.panel.traverse(node => { if (node instanceof xb.TextButton && ["Manual", "Agent", "01 Connect", "02 Localization"].includes(node.text)) tabs.push(node); });
  expect(tabs).toHaveLength(4);
  for (const tab of tabs) {
    expect((tab.mesh!.material as THREE.Material).depthWrite).toBe(false);
    const track = tab.parent!.getObjectByName("Segmented control track")!;
    expect(track).toBeDefined(); expect(tab.position.z).toBeGreaterThan(track.position.z);
    expect(tab.mesh!.renderOrder).toBeGreaterThan((track as THREE.Mesh).renderOrder);
  }
  const plate = view.panel.getObjectByName("Menu background") as THREE.Mesh;
  expect((plate.material as THREE.Material).depthWrite).toBe(true);
  const successRing = (view as unknown as { successRing: THREE.Mesh }).successRing;
  expect(successRing.renderOrder).toBeGreaterThan(plate.renderOrder);
  view.dispose();
});

it("locks palm summoning to one hand, supports the right hand and does not dismiss a pinned menu", () => {
  const makeSource = (handedness: "left" | "right") => ({ handedness, hand: { get: (name: string) => `${handedness}:${name}` } }) as unknown as XRInputSource;
  const left = makeSource("left"), right = makeSource("right");
  const up = { left: true, right: false };
  const anchor = new MenuAnchorController(), panel = new THREE.Group();
  const ui = { setupCompleted: true, menuOpen: false };
  const state = {
    session: { inputSources: [left, right] }, palmGates: new Map(), menuAnchor: anchor,
    client: { ui }, palmOpened: false, capture: { owner: null },
    anchorMenu(source: XRInputSource) { anchor.attach(source, new THREE.Vector3(), new THREE.Vector3(0, 1, 1), new THREE.Quaternion(), panel); },
  };
  const frame = { getJointPose(space: string) {
    const [hand, name] = space.split(":") as ["left" | "right", string];
    const sign = (hand === "right" ? 1 : -1) * (up[hand] ? 1 : -1);
    let p = new THREE.Vector3();
    if (name === "index-finger-metacarpal") p.set(0.02 * sign, 0, -0.04);
    else if (name === "pinky-finger-metacarpal") p.set(-0.02 * sign, 0, -0.04);
    else if (name === "middle-finger-metacarpal") p.z = -0.04;
    else if (name.endsWith("phalanx-proximal")) p.z = -0.06;
    else if (name.endsWith("phalanx-intermediate")) p.z = -0.08;
    else if (name.endsWith("tip")) p.z = -0.1;
    return { transform: { position: p } };
  } };
  let now = 0;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => now * 1000);
  const sync = (time: number) => {
    now = time;
    (WebXRInputController.prototype as unknown as { syncPalm: (...args: unknown[]) => void }).syncPalm.call(state, frame, {}, {}, {});
  };
  sync(0); sync(0.36); expect(ui.menuOpen).toBe(true); expect(anchor.source).toBe(left);
  up.right = true; sync(1); sync(1.36); expect(anchor.source).toBe(left);
  up.right = false; sync(2); sync(2.2); expect(ui.menuOpen).toBe(true);
  state.capture.owner = {} as never; up.left = false; sync(3); sync(3.2); expect(ui.menuOpen).toBe(true);
  state.capture.owner = null; sync(3.3); expect(ui.menuOpen).toBe(false);
  up.right = true; sync(4); sync(4.36); expect(anchor.source).toBe(right); expect(ui.menuOpen).toBe(true);
  anchor.detach(); up.right = false; sync(5); sync(5.2); expect(ui.menuOpen).toBe(true);
  clock.mockRestore();
});

it("uses dark text on white primary/selected controls and physical depth across resizing", () => {
  const noop = () => {};
  const view = new MainMenuView({ onSetup: noop, onBack: noop, onRetry: noop, onRestart: noop, onMenu: noop, onMode: noop, onRobot: noop, onDebug: noop, onLidar: noop, onLocalize: noop, onRealign: noop, onEstop: noop, onDraft: noop, onAgentText: () => true });
  const control = view.panel.getObjectByName("Button: Manual")!.parent as SurfaceButton;
  control.setActive(true); control.update();
  expect(control.fontColor).toBe(DIMOS_AR_DESIGN.colors.primaryText);
  const depth = () => -control.getObjectByName("Button footprint")!.position.z * control.getWorldScale(new THREE.Vector3()).z;
  const activeDepth = 0.003825 + DIMOS_AR_DESIGN.depth.controlOverlap + DIMOS_AR_DESIGN.depth.primary - DIMOS_AR_DESIGN.depth.secondary;
  expect(depth()).toBeCloseTo(activeDepth, 7);
  view.panel.scale.multiplyScalar(1.5); control.update(); expect(depth()).toBeCloseTo(activeDepth, 7);
  control.setActive(false); control.update();
  expect(control.fontColor).toBe(DIMOS_AR_DESIGN.colors.muted); expect(depth()).toBeCloseTo(0.003925, 7);
  control.setEnabled(false); expect(control.fontColor).toBe(DIMOS_AR_DESIGN.colors.disabled);
  view.dispose();
});

it("billboards a bottom-bar drag in yaw and pitch without roll or moving the grabbed point", () => {
  const noop = () => {};
  const view = new MainMenuView({ onSetup: noop, onBack: noop, onRetry: noop, onRestart: noop, onMenu: noop, onMode: noop, onRobot: noop, onDebug: noop, onLidar: noop, onLocalize: noop, onRealign: noop, onEstop: noop, onDraft: noop, onAgentText: () => true });
  view.panel.position.set(0, 1, -1); view.panel.updateWorldMatrix(true, true);
  const localGrab = new THREE.Vector3(0, -0.406 / 0.76, 0);
  const grabbed = view.panel.localToWorld(localGrab.clone());
  const origin = new THREE.Vector3(grabbed.x, grabbed.y, 0);
  expect(view.beginManipulation(origin.toArray(), [0, 0, -1])).toBe(true);
  const eye = new THREE.Vector3(0.5, 1.7, 0);
  for (let i = 0; i < 120; i++) view.updateManipulation(origin.toArray(), [0, 0, -1], new THREE.Quaternion(), 1 / 60, eye);
  const euler = new THREE.Euler().setFromQuaternion(view.panel.quaternion, "YXZ");
  expect(euler.z).toBeCloseTo(0); expect(Math.abs(euler.x)).toBeGreaterThan(0.1); expect(Math.abs(euler.y)).toBeGreaterThan(0.1);
  view.panel.updateWorldMatrix(true, true);
  expect(view.panel.localToWorld(localGrab.clone()).distanceTo(grabbed)).toBeLessThan(0.001);
  view.dispose();
});

it("starts a panel grab from the accepted input ray while the visual laser is still catching up", () => {
  const app = Object.create(WebXRInputController.prototype) as any;
  const target = new THREE.Object3D() as any; target.inputSource = { handedness: "right" }; target.userData.id = 1;
  const bar = new THREE.Object3D(), raw = { origin: [0, 0, 0], direction: [0, 0, -1] };
  const begin = vi.fn(() => true), pin = vi.fn(), detach = vi.fn();
  Object.assign(app, { trackingState: { tracking: () => true, session: () => ({ visibilityState: "visible" }) }, navigationSourceIds: new WeakMap(), nextNavigationSource: 0,
    touches: { owns: () => false }, capture: { press: () => true }, setupPlacement: { pin }, menuAnchor: { detach },
    interaction: { capture: vi.fn(), hit: () => ({ object: bar, point: new THREE.Vector3(0, 0, -1) }), direct: { capture() {}, ray: () => null }, ray: () => raw, smoothedRay: () => ({ origin: [0, 0, 0], direction: [1, 0, 0] }) },
    client: { navigation: { clearAim() {}, marker: { object: new THREE.Group() } }, joystick: { loseInput() {} } },
    mainMenu: { isEmergencyTarget: () => false, ownsTarget: () => true, canInteract: () => true, scrollView: () => null, isSpeechTarget: () => false, isControl: () => false, beginManipulation: begin } });
  app.onSelectStart({ target });
  expect(begin.mock.calls[0].slice(0, 2)).toEqual([raw.origin, raw.direction]);
  expect(app.panelHold).toBe(target); expect(pin).toHaveBeenCalledOnce(); expect(detach).toHaveBeenCalledOnce();
});

it("gives every control one physical body without a competing front cap", () => {
  const noop = () => {};
  const view = new MainMenuView({ onSetup: noop, onBack: noop, onRetry: noop, onRestart: noop, onMenu: noop, onMode: noop, onRobot: noop, onDebug: noop, onLidar: noop, onLocalize: noop, onRealign: noop, onEstop: noop, onDraft: noop, onAgentText: () => true });
  const controls: SurfaceButton[] = [];
  view.panel.traverse(node => { if (node instanceof SurfaceButton) controls.push(node); });
  expect(controls.length).toBeGreaterThan(10);
  const clock = vi.spyOn(performance, "now");
  let time = 1000;
  const tick = (control: SurfaceButton) => { time += 100; clock.mockReturnValue(time); control.update(); };
  try {
    for (const control of controls) {
      control.setActive(false);
      tick(control);
      const bodies = control.mesh!.children.filter(node => node.name === "Surface thickness");
      expect(bodies).toHaveLength(1);
      const body = bodies[0] as THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshBasicMaterial>;
      const thickness = () => body.scale.z * control.mesh!.getWorldScale(new THREE.Vector3()).z;
      expect([0.003825, 0.006825].some(expected => Math.abs(thickness() - expected) < 1e-7)).toBe(true);
      const footprint = control.getObjectByName("Button footprint") as THREE.Mesh;
      expect(footprint).toBeDefined();
      const footprintWorld = () => footprint.getWorldPosition(new THREE.Vector3());
      const restingFootprint = footprintWorld();
      const support = control.userData.supportSurface ?? view.panel.getObjectByName("Menu background")!;
      const supportZ = control.worldToLocal(support.getWorldPosition(new THREE.Vector3())).z;
      expect((footprint.position.z - supportZ) * control.getWorldScale(new THREE.Vector3()).z).toBeCloseTo(DIMOS_AR_DESIGN.depth.controlOverlap, 7);
      expect(-footprint.position.z * control.getWorldScale(new THREE.Vector3()).z - thickness()).toBeCloseTo(DIMOS_AR_DESIGN.depth.controlOverlap, 7);
      const footprintHits: THREE.Intersection[] = [];
      footprint.raycast(new THREE.Raycaster(), footprintHits);
      expect(footprintHits).toEqual([]);
      const checkTint = () => {
        const uniforms = (control.mesh!.material as THREE.ShaderMaterial).uniforms;
        const expected = (uniforms.uTint.value as THREE.Color).clone().addScalar(uniforms.uHover.value * 0.12).multiplyScalar(0.75);
        expect(body.material.color.r).toBeCloseTo(expected.r, 7);
        expect(body.material.color.g).toBeCloseTo(expected.g, 7);
        expect(body.material.color.b).toBeCloseTo(expected.b, 7);
      };
      checkTint();
      const initialThickness = thickness();
      const normals = body.geometry.getAttribute("normal"), index = body.geometry.getIndex()!;
      for (let i = 0; i < index.count; i += 3) {
        expect([0, 1, 2].every(offset => normals.getZ(index.getX(i + offset)) > 0.99)).toBe(false);
      }
      expect(body.material.depthWrite).toBe(true);
      expect(body.material.opacity).toBe(1);
      expect(body.renderOrder).toBeLessThan(control.mesh!.renderOrder);
      const hits: THREE.Intersection[] = [];
      body.raycast(new THREE.Raycaster(), hits);
      expect(hits).toEqual([]);
      expect((control.mesh!.material as THREE.ShaderMaterial).uniforms.uAlpha.value).toBe(1);
      control.setActive(true); tick(control); checkTint();
      expect(footprintWorld().z).toBeCloseTo(restingFootprint.z, 7);
      expect(thickness()).toBeCloseTo(initialThickness, 7);
      control.feedbackPressed = true;
      for (let i = 0; i < 12; i++) tick(control);
      checkTint();
      expect(footprintWorld().z).toBeCloseTo(restingFootprint.z, 7);
      expect(thickness()).toBeCloseTo(initialThickness, 7);
      control.setEnabled(false); tick(control); checkTint();
      expect(thickness()).toBeCloseTo(initialThickness, 7);
      view.panel.scale.multiplyScalar(1.1); tick(control);
      expect(thickness()).toBeCloseTo(initialThickness, 7);
      view.panel.scale.divideScalar(1.1);
      control.feedbackPressed = false;
    }
    const field = view.panel.getObjectByName("Agent dictation field") as SurfaceButton;
    tick(field);
    view.updateHover([], 1);
    const parentScale = field.parent!.getWorldScale(new THREE.Vector3()).z;
    const footprint = field.getObjectByName("Button footprint")!;
    expect(-footprint.position.z * field.getWorldScale(new THREE.Vector3()).z).toBeCloseTo(0.003925, 7);
    for (const sibling of field.parent!.children.filter(node => node.userData.followSurface === field)) {
      expect((sibling.position.z - field.position.z) * parentScale).toBeCloseTo(DIMOS_AR_DESIGN.depth.labelOffset, 7);
    }
    const body = controls[0].mesh!.getObjectByName("Surface thickness") as THREE.Mesh;
    const geometryDispose = vi.spyOn(body.geometry, "dispose");
    const materialDispose = vi.spyOn(body.material as THREE.Material, "dispose");
    view.dispose(); view.dispose();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
  } finally {
    clock.mockRestore();
    view.dispose();
  }
});
