import { label, button, place, rect, surface, setText, clip, cameraIcon, gearIcon, layoutText, iconClose, scrollLabel, messageField, tabs, sectionHeading } from "./PanelWidgets";
import { panelChrome } from "./RobotPanelFrame";
import { updatePanelGesture, type PanelGesture } from "./PanelInteraction";
import { PanelPageTransitions, PANEL_TOP, RUNTIME_LAYOUTS, SETUP_LAYOUTS, panelFooterY, panelProfile, type PanelProfile } from "./PanelPresentation";
import { SpeedSlider } from "./SpeedSlider";
import { SETUP_SUCCESS_STYLE, strokeJoints2D, STROKE_JOIN_SEGMENTS } from "@dimos-ar-client/presentation/WorldPresentation";
import { CONTROL_PANEL_COPY as COPY, CONTROL_PANEL_LAYOUT, CONTROL_PANEL_SCALE, robotBadgeText, sensorStatusText, PanelHeightAnimation } from "@dimos-ar-client/presentation/ControlPanelPresentation";
import * as THREE from "three";
import type { LidarDisplayMode } from "@dimos-ar-client/sensors/LidarDisplay";
import * as xb from "xrblocks";
import type { Vec3 } from "@dimos-ar-client/ClientContracts";
import { markRayPassive, registerRayTarget } from "../input/WebXRInteraction";
import { ScrollableTextView } from "./TextViews";
import { SurfaceButton } from "./SurfaceButton";
import { DIMOS_AR_DESIGN, toneCss } from "./DimOSARDesign";
import { GlassSurface } from "./SurfaceMaterials";


import type { AgentDraftSnapshot } from "@dimos-ar-client/agent/AgentDraftSession";
import { disposeTextResources } from "./SceneResources";

import { SetupCameraPreviewView, type CameraPreviewFrame } from "./SetupCameraPreviewView";

import type { WebXRUISnapshot } from "./WebXRUIPresenter";

export type MainMenuCallbacks = {
  canActivate?: (controllerId: number, target: THREE.Object3D) => boolean;
  onSetup: () => void;
  onBack: () => void;
  onRetry: () => void;
  onRestart: () => void;
  onMenu: () => void;
  onMode: (mode: "manual" | "agent") => void;
  onRobot: () => void;
  manipulationSpeed?: () => number;
  onDebug: () => void;
  onLidarMode?: (mode: LidarDisplayMode) => void;
  onLidarRange?: (direction: number) => void;
  onLidarPoints?: (direction: number) => void;
  onDismissAlignment?: () => void;
  onLocalize: () => void;
  onRealign: () => void;
  onEstop: () => void;
  onAgentText: (text: string) => boolean;
  onDraft: (text: string) => void;
  onSound?: () => void;
  soundEnabled?: () => boolean;
  onActivate?: () => void;
};

const C = DIMOS_AR_DESIGN.colors;
const WIDTH = DIMOS_AR_DESIGN.panel.width;
const HEIGHT = DIMOS_AR_DESIGN.panel.height;
const RADIUS = DIMOS_AR_DESIGN.panel.cornerRadius;
const MARGIN = DIMOS_AR_DESIGN.panel.margin;
const CONTENT = WIDTH - MARGIN * 2;
const LEFT = -CONTENT / 2;
// Shared action rhythm. Header icons are deliberately larger touch targets; the two-line robot selector and the hold-to-record field are specialized controls.
export const ACTION_HEIGHT = DIMOS_AR_DESIGN.controls.height;
export const ICON_SIZE = DIMOS_AR_DESIGN.controls.iconSize;
const GAP = DIMOS_AR_DESIGN.controls.gap;
const HALF_WIDTH = (CONTENT - GAP) / 2;
const THIRD_WIDTH = (CONTENT - GAP * 2) / 3;
const HEADER_Y = 0.286;
const CLOSE_X = CONTENT / 2 - ICON_SIZE / 2;
const SETTINGS_X = CLOSE_X - ICON_SIZE - GAP;
const SENSORS_X = SETTINGS_X - ICON_SIZE - GAP;

export class MainMenuView {
  private readonly pageViews: {
    setup: ReturnType<MainMenuView["buildSetupPage"]>;
    success: ReturnType<MainMenuView["buildSuccessPage"]>;
    runtime: ReturnType<MainMenuView["buildRuntimePage"]>;
    settings: ReturnType<MainMenuView["buildSettingsPage"]>;
    sensors: ReturnType<MainMenuView["buildSensorsPage"]>;
    recovery: ReturnType<MainMenuView["buildRecoveryPage"]>;
    diagnostics: ReturnType<MainMenuView["buildDiagnosticsPage"]>;
  };

  readonly panel: xb.SpatialPanel;
  private readonly wizard = new THREE.Group();
  private readonly wizardBody = new THREE.Group();
  private readonly wizardFooter = new THREE.Group();
  private readonly heightController = new PanelHeightAnimation();
  private heightInitialized = false;
  private layoutProfile: PanelProfile | null = null;
  private readonly fittedContent = new Map<THREE.Object3D, number>();
  private readonly success = new THREE.Group();
  private readonly preview = new SetupCameraPreviewView();
  private readonly checkStrokes: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private localizationLayout: boolean | null = null;
  private markerGuide = false;
  private readonly console = new THREE.Group();
  private readonly header = new THREE.Group();
  private readonly robotBadge = new THREE.Group();
  private readonly settingsPage = new THREE.Group();
  private readonly sensorsPage = new THREE.Group();
  private readonly recoveryPage = new THREE.Group();
  private readonly runtimeFooter = new THREE.Group();
  private readonly lidarTabs: SurfaceButton[] = [];
  private readonly sensorControls: SurfaceButton[] = [];
  private handlersSpeed: () => number = () => 0.2;
  private readonly speedGroup = new THREE.Group();
  private readonly speedSlider = new SpeedSlider(0.43 / HEIGHT);
  private readonly capabilityBody = new THREE.Group();
  private readonly localizationGroup = new THREE.Group();
  private readonly lidarGroup = new THREE.Group();
  private capabilityProfile: PanelProfile = RUNTIME_LAYOUTS.sensors;
  private capabilityKey = "";
  private readonly details = new THREE.Group();
  private diagnosticsUpdatedAt = -Infinity;
  private readonly stepTabs: SurfaceButton[] = [];
  private readonly manualHelp = new THREE.Group();
  private readonly chat = new THREE.Group();
  private readonly soundEnabled: () => boolean;
  private readonly plate: GlassSurface;
  private panelShown = true;
  private panelProgress = 1;
  private readonly transitions = new PanelPageTransitions();
  get pageTransitions(): ReadonlyMap<THREE.Group, Readonly<{ progress: number; target: boolean }>> { return this.transitions.pages; }
  private readonly bar: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  private readonly barZone: THREE.Mesh;
  private readonly cornerArcs: Record<"left" | "right", THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>>;
  private readonly cornerZones: Record<"left" | "right", THREE.Mesh>;
  private manipulation: PanelGesture | null = null;
  private draft = "";
  private readonly onDraft: (text: string) => void;
  private agentEnabled = false;
  private page: "main" | "settings" | "sensors" | "diagnostics" = "main";

  constructor(handlers: MainMenuCallbacks) {
    this.onDraft = handlers.onDraft;
    this.soundEnabled = handlers.soundEnabled ?? (() => true);
    this.panel = new xb.SpatialPanel({ width: WIDTH, height: HEIGHT, backgroundColor: "#00000000", draggable: false, useDefaultPosition: false, useBorderlessShader: true });
    this.panel.name = "DimOS control panel";
    // The glass plate replaces the package's opaque panel background.
    this.panel.mesh.visible = false;
    this.panel.add(this.wizard, this.success, this.console, this.details, this.header, this.robotBadge, this.settingsPage, this.sensorsPage, this.recoveryPage, this.runtimeFooter);
    this.wizard.add(this.wizardBody, this.wizardFooter);
    const plate = this.plate = new GlassSurface({ width: WIDTH, height: HEIGHT, radius: RADIUS, thickness: DIMOS_AR_DESIGN.depth.thickness, tint: "#202022", rim: 0.28, rimWidth: 0.0025 });
    place(this.panel, plate, 0, 0, 0.001);
    plate.renderOrder = 1;
    plate.name = "Menu background";
    registerRayTarget(plate);
    markRayPassive(plate);

    const setup = this.buildSetupPage(handlers);
    const success = this.buildSuccessPage(handlers);
    const runtime = this.buildRuntimePage(handlers);
    const settings = this.buildSettingsPage(handlers);
    const sensors = this.buildSensorsPage(handlers);
    const recovery = this.buildRecoveryPage(handlers);
    const diagnostics = this.buildDiagnosticsPage(handlers);
    this.pageViews = { setup, success, runtime, settings, sensors, recovery, diagnostics };

    const chrome = panelChrome(this.panel, RADIUS/HEIGHT, 1/HEIGHT);
    this.bar = chrome.bar; this.barZone = chrome.barZone;
    this.cornerArcs = chrome.cornerArcs; this.cornerZones = chrome.cornerZones;
    this.barZone.name = "Window bar";
    for (const side of ["left","right"] as const) {
      this.cornerArcs[side].position.x = (side === "left" ? -1 : 1)*(WIDTH/2-RADIUS)/HEIGHT;
      this.cornerZones[side].position.x = (side === "left" ? -1 : 1)*WIDTH/2/HEIGHT;
      this.cornerZones[side].name = "Resize corner";
    }

    this.console.visible = false;
    this.page = "main";
    this.details.visible = false;
    this.settingsPage.visible = false;
    this.panel.traverse(object => {
      if (!(object instanceof SurfaceButton) || !handlers.canActivate) return;
      const activate = object.onTriggered;
      object.onTriggered = id => { if (handlers.canActivate?.(id, object.mesh!)) { activate(id); if (object.enabled) handlers.onActivate?.(); } };
    });
    this.pageViews.runtime.agent.parent!.userData.panelRow = "reply";
    this.pageViews.runtime.inputLabel.parent!.userData.panelRow = "draft";
    for (const action of [this.pageViews.runtime.type, this.pageViews.runtime.clear]) action.userData.panelRow = "actions";
    this.pageViews.settings.debugToggle.userData.panelRow = "debug"; this.pageViews.settings.soundToggle.userData.panelRow = "sound";
    this.pageViews.diagnostics.debug.userData.panelRow = "logs"; this.pageViews.sensors.sensorStatus.userData.panelRow = "statistics";
    this.pageViews.sensors.rangeLabel.userData.panelRow = this.pageViews.sensors.rangeValue.userData.panelRow = "range";
    this.pageViews.sensors.pointsValue.userData.panelRow = "points";
    this.layoutRuntime();
    this.panel.scale.multiplyScalar(CONTROL_PANEL_SCALE.setup);
    this.appearanceRoot.name = "Menu appearance";
    for (const child of [...this.panel.children]) if (child !== this.panel.mesh) this.appearanceRoot.add(child);
    this.panel.add(this.appearanceRoot);
    this.panel.traverse(node => {
      if (node instanceof SurfaceButton) node.setSupportSurface(node.userData.supportSurface ?? plate);
    });
  }

  private buildSetupPage(handlers: MainMenuCallbacks) {
    // Connection header belongs to the setup wizard.
    label(this.header, COPY.appName, LEFT + 0.17, CONTROL_PANEL_LAYOUT.titleY, 0.32, 0.04, 28, C.ink, "left", "semibold");
    label(this.header, COPY.setupTitle, 0, CONTROL_PANEL_LAYOUT.titleY, 0.36, 0.04, 28, C.ink, "center", "semibold");
    this.stepTabs.push(...tabs(this.wizard, [COPY.connect, COPY.localization] as const, 0.203, [
      () => { if (this.lastStep === "localization") handlers.onBack(); },
      () => { if (this.lastStep === "connect") handlers.onSetup(); },
    ]));
    const title = label(this.wizardBody, "", 0, 0.135, CONTENT, 0.06, 38, C.ink, "left", "semibold");
    title.visible = false;
    const description = label(this.wizardBody, "", 0, 0.135, CONTENT, 0.03, 20, C.muted, "center");
    const cardTitle = label(this.wizardBody, "Ready when you are", 0, 0, CONTENT, 0.04, 23, C.ink, "center", "semibold");
    const cardBody = scrollLabel(this.wizardBody, "", 0, 0, CONTENT, 0.115, 18, C.muted);
    const back = button(this.wizardFooter, COPY.back, -THIRD_WIDTH - GAP, -0.298, THIRD_WIDTH, ACTION_HEIGHT, handlers.onBack);
    const retry = button(this.wizardFooter, "Retry", 0, -0.298, THIRD_WIDTH, ACTION_HEIGHT, () => this.lastStep === "localization" ? handlers.onLocalize() : handlers.onRetry());
    const setup = button(this.wizardFooter, COPY.continue, THIRD_WIDTH + GAP, -0.298, THIRD_WIDTH, ACTION_HEIGHT, handlers.onSetup, "primary");
    place(this.wizardBody, this.preview, -0.225, -0.055, 0.02);
    const previewLabel = label(this.wizardBody, "Starting camera…", -0.225, -0.178, 0.34, 0.022, 14, C.muted, "center");
    this.preview.visible = previewLabel.visible = false;
    return { title, description, cardTitle, cardBody, back, retry, setup, previewLabel };
  }

  private buildSuccessPage(_handlers: MainMenuCallbacks) {
    label(this.success, COPY.appName, LEFT + 0.17, CONTROL_PANEL_LAYOUT.titleY, 0.32, 0.04, 28, C.ink, "left", "semibold");
    label(this.success, COPY.setupTitle, 0, CONTROL_PANEL_LAYOUT.titleY, 0.36, 0.04, 28, C.ink, "center", "semibold");
    const successRows = SETUP_LAYOUTS.success.rows;
    const glyphOffset = successRows.glyph - SETUP_SUCCESS_STYLE.centerYM;
    const successRing = new THREE.Mesh(new THREE.RingGeometry(SETUP_SUCCESS_STYLE.radiusM - SETUP_SUCCESS_STYLE.strokeM, SETUP_SUCCESS_STYLE.radiusM, SETUP_SUCCESS_STYLE.segments, 1, Math.PI / 2, -Math.PI * 2), new THREE.MeshBasicMaterial({ color: 0x30d158, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    place(this.success, successRing, 0, successRows.glyph, DIMOS_AR_DESIGN.depth.surface); successRing.renderOrder = 13; successRing.raycast = () => {};
    const points = SETUP_SUCCESS_STYLE.check;
    for (let i = 0; i < 2; i++) {
      const [x, y] = points[i], [x2, y2] = points[i + 1];
      const length = Math.hypot(x2 - x, y2 - y);
      const geometry = new THREE.PlaneGeometry(length, SETUP_SUCCESS_STYLE.glyphWidthM).translate(length / 2, 0, 0);
      const stroke = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x30d158, transparent: true, depthWrite: false }));
      place(this.success, stroke, x, y + glyphOffset, DIMOS_AR_DESIGN.depth.text); stroke.renderOrder = 13; stroke.rotation.z = Math.atan2(y2 - y, x2 - x);
      stroke.raycast = () => {}; this.checkStrokes.push(stroke);
    }
    const checkJoin = new THREE.Mesh(new THREE.CircleGeometry(SETUP_SUCCESS_STYLE.glyphWidthM / 2, STROKE_JOIN_SEGMENTS), new THREE.MeshBasicMaterial({ color: 0x30d158, depthWrite: false }));
    place(this.success, checkJoin, points[1][0], points[1][1] + glyphOffset, DIMOS_AR_DESIGN.depth.text);
    checkJoin.renderOrder = 13; checkJoin.raycast = () => {};
    label(this.success, COPY.localizationComplete, 0, successRows.title, CONTENT, 0.05, 32, C.ink, "center", "semibold");
    const successDetail = label(this.success, "", 0, successRows.detail, CONTENT, 0.04, 20, C.muted, "center");
    this.success.visible = false;

    return { successRing, checkJoin, successDetail };
  }

  private buildRuntimePage(handlers: MainMenuCallbacks) {
    const robotButton = button(this.robotBadge, "Robot · Not connected", 0, 0.465, 0.58, 0.105, handlers.onRobot);
    (robotButton.mesh!.material as THREE.Material).depthWrite = true;
    robotButton.name = "Robot selection button";
    this.robotBadge.renderOrder = 12;
    const robotDot = rect(this.robotBadge, -0.253, 0.465, 0.012, 0.012, C.faint, 0.006, DIMOS_AR_DESIGN.depth.text);
    robotDot.renderOrder = 13;
    robotDot.userData.followSurface = robotButton;
    this.console.add(this.chat, this.manualHelp);
    const robotName = label(this.console, COPY.appName, LEFT + 0.22, CONTROL_PANEL_LAYOUT.titleY, 0.42, 0.04, 28, C.ink, "left", "semibold");
    const gear = button(this.console, "", SETTINGS_X, HEADER_Y, ICON_SIZE, ICON_SIZE, () => { this.page = "settings"; });
    gear.name = "Global settings";
    gearIcon(this.console, SETTINGS_X, HEADER_Y, gear);
    const sensorButton = button(this.console, "", SENSORS_X, HEADER_Y, ICON_SIZE, ICON_SIZE, () => { this.page = "sensors"; });
    sensorButton.name = "Capabilities button";
    cameraIcon(this.console, SENSORS_X, HEADER_Y, sensorButton);
    iconClose(this.console, "Close", handlers.onMenu);
    const [mode, agentMode] = tabs(this.console, [COPY.manual, COPY.agent] as const, 0.198, [() => handlers.onMode("manual"), () => handlers.onMode("agent")]);
    const agentField = messageField(this.chat, COPY.agent, 0.052, true);
    const agent = agentField.content;
    const humanField = messageField(this.chat, COPY.yourMessage, -0.088, false);
    const inputField = humanField.surface;
    inputField.name = "Agent dictation field";
    const inputLabel = humanField.content;
    const type = button(this.chat, COPY.send, -(HALF_WIDTH + GAP) / 2, -0.196, HALF_WIDTH, ACTION_HEIGHT, () => {
      if (this.agentEnabled && handlers.onAgentText(this.draft)) this.setDraft("");
    }, "primary");
    const clear = button(this.chat, COPY.clear, (HALF_WIDTH + GAP) / 2, -0.196, HALF_WIDTH, ACTION_HEIGHT, () => this.setDraft(""));
    surface(this.manualHelp, 0, 0, CONTENT, 0.18, 0.024, C.fill);
    label(this.manualHelp, COPY.manualGuidance, 0, 0, CONTENT - 0.056, 0.13, 23, C.muted);
    const hud = label(this.console, "", 0, -0.251, CONTENT, 0.018, 13, C.muted);
    // Keep the last row above the bottom corner curve.
    const estop = button(this.runtimeFooter, COPY.stop, 0, -0.298, CONTENT, ACTION_HEIGHT, handlers.onEstop, "danger");

    return { robotButton, robotDot, robotName, mode, agentMode, agent, inputField, inputLabel, type, clear, hud, estop };
  }

  private buildSettingsPage(handlers: MainMenuCallbacks) {
    label(this.settingsPage, COPY.settings, LEFT + 0.29, HEADER_Y, 0.56, 0.04, 28, C.ink, "left", "semibold");
    iconClose(this.settingsPage, COPY.done, () => { this.page = "main"; });
    this.sensorsPage.add(this.localizationGroup, this.lidarGroup);

    const localize = button(this.localizationGroup, COPY.relocalize, 0, 0, CONTENT, ACTION_HEIGHT, handlers.onRealign);
    button(this.settingsPage, COPY.setup, 0, 0.09, CONTENT, ACTION_HEIGHT, handlers.onRestart).userData.panelRow = "robotActions";
    this.handlersSpeed = handlers.manipulationSpeed ?? (() => 0.2);
    this.speedGroup.position.set(0, 0.025 / HEIGHT, 0);
    this.sensorsPage.add(this.speedGroup);
    this.speedSlider.position.set(0, -0.025 / HEIGHT, 0);
    this.speedSlider.userData.depthM = DIMOS_AR_DESIGN.depth.controlOverlap * 2;
    this.speedGroup.add(this.speedSlider);
    sectionHeading(this.speedGroup, "Movement speed", 0.02);
    const speedValue = label(this.speedGroup, "50%", CONTENT / 2 - 0.09, 0.02, 0.18, 0.03, 21, C.ink, "right");
    sectionHeading(this.settingsPage, COPY.headset, -0.014).userData.panelRow = "headset";
    const debugToggle = button(this.settingsPage, "Debug · Off", 0, -0.084, CONTENT, ACTION_HEIGHT, handlers.onDebug);
    button(this.settingsPage, COPY.diagnostics, 0, -0.152, CONTENT, ACTION_HEIGHT, () => { this.page = "diagnostics"; }).userData.panelRow = "diagnostics";

    const soundToggle = button(this.settingsPage, "Sound · On", 0, -0.228, CONTENT, ACTION_HEIGHT, () => handlers.onSound?.());

    return { localize, speedValue, debugToggle, soundToggle };
  }

  private buildSensorsPage(handlers: MainMenuCallbacks) {
    label(this.sensorsPage, COPY.sensors, LEFT + 0.29, HEADER_Y, 0.56, 0.04, 28, C.ink, "left", "semibold");
    iconClose(this.sensorsPage, "Back from Sensors", () => { this.page = "main"; });
    sectionHeading(this.lidarGroup, "LiDAR", 0).userData.panelRow = "lidar";
    this.lidarTabs.push(...tabs(this.lidarGroup, ["Off", "Obstacles", "Full"], 0.17,
      [() => handlers.onLidarMode?.("off"), () => handlers.onLidarMode?.("obstacles"), () => handlers.onLidarMode?.("full")]));
    const rangeLabel = label(this.lidarGroup, "Clearance", LEFT + 0.17, 0.08, 0.34, 0.035, 18, C.muted);
    const rangeValue = label(this.lidarGroup, "0.6 m", 0.14, 0.08, 0.19, 0.04, 21, C.ink, "center");
    const pointsValue = label(this.lidarGroup, "4000", 0.14, -0.01, 0.19, 0.04, 21, C.ink, "center");
    label(this.lidarGroup, "Point limit", LEFT + 0.17, -0.01, 0.34, 0.035, 18, C.muted).userData.panelRow = "points";
    for (const [row, y, action] of [["range", 0.08, handlers.onLidarRange], ["points", -0.01, handlers.onLidarPoints]] as const) {
      for (const direction of [-1, 1]) {
        const control = button(this.lidarGroup, direction < 0 ? "−" : "+", direction < 0 ? -0.015 : 0.31, y, 0.064, 0.064, () => action?.(direction));
        control.userData.panelRow = row; this.sensorControls.push(control);
      }
    }
    const sensorStatus = label(this.details, "", 0, -0.15, CONTENT, 0.1, 17, C.muted);
    return { rangeLabel, rangeValue, pointsValue, sensorStatus };
  }

  private buildRecoveryPage(handlers: MainMenuCallbacks) {
    label(this.recoveryPage, COPY.alignmentTitle, 0, HEADER_Y, CONTENT, 0.04, 28, C.ink, "center", "semibold");
    label(this.recoveryPage, COPY.alignmentGuidance, 0, 0.055, CONTENT - 0.06, 0.07, 22, C.muted, "center").userData.panelRow = "guidance";
    button(this.recoveryPage, COPY.relocalize, -(HALF_WIDTH + GAP) / 2, -0.1, HALF_WIDTH, ACTION_HEIGHT, handlers.onRealign, "primary").userData.panelRow = "actions";
    button(this.recoveryPage, COPY.dismiss, (HALF_WIDTH + GAP) / 2, -0.1, HALF_WIDTH, ACTION_HEIGHT, () => handlers.onDismissAlignment?.()).userData.panelRow = "actions";

    return {  };
  }

  private buildDiagnosticsPage(_handlers: MainMenuCallbacks) {
    label(this.details, COPY.diagnostics, LEFT + 0.29, HEADER_Y, 0.56, 0.04, 28, C.ink, "left", "semibold");
    iconClose(this.details, COPY.done, () => { this.page = "settings"; });
    surface(this.details, 0, -0.03, CONTENT, 0.26, DIMOS_AR_DESIGN.corners.field, C.fill).userData.panelRow = "logs";
    const debug = scrollLabel(this.details, "", 0, -0.03, CONTENT - 0.056, 0.22, 18, C.muted);

    return { debug };
  }

  private readonly appearanceRoot = new THREE.Group();
  private runtimeScaleApplied = false;

  private lastStep: WebXRUISnapshot["wizardStep"] = "connect";

  apply(snap: WebXRUISnapshot, speech?: AgentDraftSnapshot): void {
    const runtime = snap.setupCompleted && !snap.setupCelebrating;
    if (!this.manipulation && runtime !== this.runtimeScaleApplied && (this.panelProgress === 0 || (runtime && snap.menuOpen) || !snap.setupCompleted)) {
      const top = this.appearanceRoot.localToWorld(new THREE.Vector3(0, 0.5, this.plate.position.z));
      this.panel.parent?.worldToLocal(top);
      this.panel.scale.multiplyScalar(runtime ? CONTROL_PANEL_SCALE.runtime / CONTROL_PANEL_SCALE.setup : CONTROL_PANEL_SCALE.setup / CONTROL_PANEL_SCALE.runtime);
      const scaledTop = this.appearanceRoot.localToWorld(new THREE.Vector3(0, 0.5, this.plate.position.z));
      this.panel.parent?.worldToLocal(scaledTop);
      this.panel.position.add(top.sub(scaledTop));
      this.runtimeScaleApplied = runtime;
    }
    this.speedGroup.visible = snap.manipulationAvailable === true;
    this.localizationGroup.visible = snap.localizationAvailable === true;
    this.lidarGroup.visible = snap.lidarAvailable;
    const capabilityKey = [this.localizationGroup.visible,this.speedGroup.visible,this.lidarGroup.visible].join();
    if (capabilityKey !== this.capabilityKey) {
      this.capabilityKey = capabilityKey;
      const rows: [string,number,number?][] = [];
      if (this.localizationGroup.visible) rows.push(["localize",.064]);
      if (this.speedGroup.visible) rows.push(["speed",.08]);
      if (this.lidarGroup.visible) rows.push(["lidar",.03,.01],["tabs",.064,.01],["range",.064],["points",.064]);
      if (!rows.length) rows.push(["empty",.03]);
      this.capabilityProfile = panelProfile(.23, rows, true, .04);
      this.fittedContent.set(this.capabilityBody, this.capabilityProfile.height);
      const r = this.capabilityProfile.rows;
      this.localizationGroup.position.y = (r.localize ?? 0)/HEIGHT;
      this.speedGroup.position.y = (r.speed ?? 0)/HEIGHT;
      for (const node of this.lidarGroup.children) {
        const target = r[node.userData.panelRow];
        if (target !== undefined) node.position.y = target / HEIGHT;
      }
    }
    const speed = this.handlersSpeed();
    this.speedSlider.setValue(speed);
    this.speedGroup.traverse(node => {if(node instanceof THREE.Mesh){node.renderOrder = node === this.speedSlider.thumb ? 83 : node.parent === this.speedSlider.thumb ? 82 : 80;for(const m of Array.isArray(node.material)?node.material:[node.material])m.depthTest=m.depthWrite=false;}});
    setText(this.pageViews.settings.speedValue, `${Math.round(speed * 100)}%`);
    this.lastStep = snap.wizardStep;
    this.agentEnabled = snap.setupCompleted && snap.operatingMode === "agent" && snap.agentAvailable && snap.robotSelected;
    this.panelShown = snap.menuOpen || !snap.setupCompleted || snap.setupCelebrating === true || snap.alignmentReview?.pending === true;
    this.panel.visible = this.panelShown || this.panelProgress > 0;
    this.panel.userData.rayDisabled = !this.panelShown;
    this.wizard.visible = !snap.setupCompleted;
    this.success.visible = snap.setupCelebrating === true;
    setText(this.pageViews.success.successDetail, `${snap.robotName} is ready`);
    const successProgress = snap.setupSuccessProgress ?? 0;
    this.pageViews.success.successRing.geometry.setDrawRange(0, Math.floor(successProgress * SETUP_SUCCESS_STYLE.segments) * 6);
    const checkProgress = [0, 1].map(index => THREE.MathUtils.clamp((successProgress - 0.25) / 0.75 * 2 - index, 0, 1));
    const check = SETUP_SUCCESS_STYLE.check;
    this.pageViews.success.checkJoin.visible = strokeJoints2D([[...check[0], ...check[1]], [...check[1], ...check[2]]], checkProgress).length > 0;
    this.checkStrokes.forEach((stroke, index) => {
      const progress = checkProgress[index];
      stroke.scale.x = progress * progress * (3 - 2 * progress) / HEIGHT;
    });
    this.header.visible = !snap.setupCompleted;
    this.robotBadge.visible = this.panelShown;
    if (!snap.setupCompleted || !this.panelShown) { this.page = "main"; }
    const reviewing = snap.alignmentReview?.pending === true;
    this.recoveryPage.visible = snap.setupCompleted && reviewing;
    this.runtimeFooter.visible = snap.setupCompleted && this.panelShown && !snap.setupCelebrating;
    this.details.visible = this.page === "diagnostics" && !reviewing;
    this.console.visible = snap.setupCompleted && this.panelShown && !snap.setupCelebrating && this.page === "main" && !reviewing;
    this.settingsPage.visible = this.page === "settings" && !reviewing;
    this.sensorsPage.visible = this.page === "sensors" && !reviewing;
    setText(this.pageViews.runtime.robotButton, robotBadgeText(snap.robotName, snap.robotConnectionText ?? "Disconnected", snap.robotSelected ?? false, snap.activity ?? "Idle"));
    this.pageViews.runtime.robotButton.setEnabled(snap.robotSelectable);
    this.pageViews.runtime.robotButton.setActive(snap.robotSelected);
    setText(this.pageViews.settings.soundToggle, `Sound · ${this.soundEnabled() ? "On" : "Off"}`);
    this.pageViews.runtime.robotDot.material.color.set(toneCss(snap.connectionTone));
    setText(this.pageViews.settings.debugToggle, `Debug · ${snap.debugEnabled ? "On" : "Off"}`);
    this.pageViews.settings.debugToggle.setActive(snap.debugEnabled);
    setText(this.pageViews.setup.title, snap.wizardTitle);
    setText(this.pageViews.setup.description, snap.wizardDescription);
    const index = ["connect", "localization"].indexOf(snap.wizardStep);
    setText(this.stepTabs[0], snap.connectComplete ? COPY.connected : COPY.connect);
    this.stepTabs.forEach((tab, i) => tab.setActive(i === index));
    this.stepTabs[1].setEnabled(snap.connectComplete === true);
    setText(this.pageViews.setup.cardTitle, snap.wizardCardTitle);
    setText(this.pageViews.setup.cardBody, snap.wizardCardBody);
    this.pageViews.setup.cardTitle.color(snap.wizardStep === "connect" && snap.connectComplete ? toneCss("success") : C.ink);
    setText(this.pageViews.setup.setup, snap.nextLabel);
    this.pageViews.setup.setup.setVariant(snap.nextLabel === COPY.continue ? "primary" : "default");
    this.pageViews.setup.back.visible = snap.backVisible;
    this.pageViews.setup.retry.visible = index === 0 || (index === 1 && !!snap.localizationIssue);
    setText(this.pageViews.setup.retry, index === 1 ? COPY.tryAgain : COPY.reconnect);
    setText(this.pageViews.runtime.robotName, COPY.appName);
    const speechStatus = speech?.status === "Type a message" ? COPY.microphoneUnavailable : speech?.status;
    this.pageViews.runtime.mode.setEnabled(true);
    this.pageViews.runtime.agentMode.setEnabled(snap.agentAvailable);
    this.pageViews.runtime.agentMode.setActive(snap.operatingMode === "agent");
    this.pageViews.runtime.mode.setActive(snap.operatingMode === "manual");
    this.chat.visible = snap.operatingMode === "agent";
    this.manualHelp.visible = snap.operatingMode === "manual";
    this.draft = speech?.prompt ?? this.draft;
    this.pageViews.runtime.inputLabel.setContent(this.draft || (speech?.recognitionAvailable === false ? COPY.microphoneUnavailable : speech?.status === "Listening" ? "Listening…" : COPY.hold), speech?.status === "Listening");
    this.pageViews.runtime.inputField.setEnabled(snap.agentAvailable && speech?.recognitionAvailable === true && speech?.status !== "Transcribing…");
    this.pageViews.runtime.inputField.setActive(speech?.status === "Listening" || speech?.status === "Starting microphone…");
    this.pageViews.runtime.type.setEnabled(this.agentEnabled && !!this.draft.trim() && speech?.status !== "Listening" && speech?.status !== "Starting microphone…" && speech?.status !== "Transcribing…");
    this.pageViews.runtime.clear.setEnabled(!!this.draft && speech?.status !== "Listening" && speech?.status !== "Starting microphone…" && speech?.status !== "Transcribing…");
    this.pageViews.runtime.agent.setContent(speech?.response || snap.agentMessage || "", false, true);
    this.pageViews.runtime.agent.color(toneCss(speech?.severity === "error" ? "error" : speech?.severity === "warn" ? "warn" : "neutral"));
    const prefs = snap.lidarPreferences ?? { pointLimit: 4000, obstacleRangeM: 0.6, fullRangeM: 5 };
    this.lidarTabs.forEach((tab, i) => { tab.setActive(i === ["off", "obstacles", "full"].indexOf(snap.lidarMode)); tab.setEnabled(snap.lidarAvailable); });
    this.sensorControls.forEach(control => control.setEnabled(snap.lidarAvailable && snap.lidarMode !== "off"));
    setText(this.pageViews.sensors.rangeLabel, snap.lidarMode === "obstacles" ? "Clearance" : "Range");
    setText(this.pageViews.sensors.rangeValue, snap.lidarMode === "off" ? "—" : `${(snap.lidarMode === "obstacles" ? prefs.obstacleRangeM : prefs.fullRangeM).toFixed(1)} m`);
    setText(this.pageViews.sensors.pointsValue, String(prefs.pointLimit));
    setText(this.pageViews.sensors.sensorStatus, sensorStatusText(snap.lidarAvailable, snap.lidarReceived ?? 0, snap.cameraStatus, snap.trackingStatus, snap.surfaceCount));
    this.pageViews.runtime.estop.feedbackPressed = snap.estopPressed === true;
    setText(this.pageViews.settings.localize, snap.hasTrackingOrigin ? COPY.relocalize : COPY.localizeRobot);
    this.pageViews.runtime.estop.setEnabled(snap.estopAvailable);
    setText(this.pageViews.runtime.hud, clip(speech?.error || snap.hudText || (snap.operatingMode === "agent" && speechStatus !== "Off" ? speechStatus ?? "" : "") || "", 100));
    this.pageViews.runtime.hud.color(toneCss(speech?.error ? "warn" : snap.hudTone ?? "muted"));
    const diagnosticsNow = performance.now() / 1000;
    if (this.details.visible && this.panel.visible && diagnosticsNow - this.diagnosticsUpdatedAt >= .2) {
      this.pageViews.diagnostics.debug.setContent(snap.readDebugText?.() ?? snap.debugText);
      this.diagnosticsUpdatedAt = diagnosticsNow;
    }
    const localization = snap.wizardStep === "localization" && !snap.localizationIssue && snap.localizationKind !== "unavailable";
    this.localizationLayout = localization;
    this.updateLayout(snap, localization);
    this.markerGuide = snap.localizationKind === "marker" || snap.localizationKind === "mixed";

    for (const page of [this.wizard, this.success, this.header, this.robotBadge, this.console, this.chat, this.manualHelp, this.settingsPage, this.sensorsPage, this.recoveryPage, this.runtimeFooter, this.details]) {
      this.transitions.request(page, this.heightController.height);
    }
  }

  private layoutRuntime(): void {
    const moveRows = (page: THREE.Group, profile: PanelProfile) => {
      for (const node of page.children) {
        const y = profile.rows[node.userData.panelRow];
        if (y !== undefined) node.position.y = y / HEIGHT;
      }
    };
    const layouts = RUNTIME_LAYOUTS;
    this.manualHelp.position.y = layouts.manual.rows.guidance / HEIGHT;
    moveRows(this.chat, layouts.agent);
    moveRows(this.settingsPage, layouts.settings);
    moveRows(this.details, layouts.diagnostics);
    moveRows(this.recoveryPage, layouts.alignment);
    this.fittedContent.set(this.chat, layouts.agent.height);
    this.fittedContent.set(this.manualHelp, layouts.manual.height);
    this.fittedContent.set(this.wizardBody, HEIGHT);
    this.fittedContent.set(this.pageViews.runtime.hud, layouts.manual.height);
    // Headers keep their fixed top positions while each page body waits for space.
    for (const [page, profile] of [[this.settingsPage, layouts.settings],
      [this.details, layouts.diagnostics], [this.recoveryPage, layouts.alignment]] as const) {
      const body = new THREE.Group();
      body.name = "Panel page body";
      for (const node of [...page.children]) if (node.position.y * HEIGHT < 0.25) body.add(node);
      page.add(body); this.fittedContent.set(body, profile.height);
    }
    for (const node of [...this.sensorsPage.children]) if (node.position.y*HEIGHT < .25) this.capabilityBody.add(node);
    this.sensorsPage.add(this.capabilityBody);
    this.fittedContent.set(this.capabilityBody,this.capabilityProfile.height);
    this.success.userData.panelHeight = SETUP_LAYOUTS.success.height;
  }

  private updateLayout(snap: WebXRUISnapshot, capture: boolean): void {
    const runtime = snap.setupCompleted && !snap.setupCelebrating;
    let profile: PanelProfile;
    if (snap.setupCelebrating) profile = SETUP_LAYOUTS.success;
    else if (!runtime) {
      if (snap.wizardStep === "localization") profile = capture ? SETUP_LAYOUTS.capture : SETUP_LAYOUTS.message;
      else if (snap.connectComplete) profile = SETUP_LAYOUTS.connected;
      else profile = snap.connectionTone === "error" || snap.connectionTone === "warn" ? SETUP_LAYOUTS.error : SETUP_LAYOUTS.entry;
    } else if (snap.alignmentReview?.pending) profile = RUNTIME_LAYOUTS.alignment;
    else if (this.page === "diagnostics") profile = RUNTIME_LAYOUTS.diagnostics;
    else if (this.page === "sensors") profile = this.capabilityProfile;
    else if (this.page === "settings") profile = RUNTIME_LAYOUTS.settings;
    else profile = RUNTIME_LAYOUTS[snap.operatingMode];
    if (this.layoutProfile !== profile) {
      this.layoutProfile = profile;
      if (!runtime && !snap.setupCelebrating) this.layoutWizard(profile, capture);
    }
    const main = RUNTIME_LAYOUTS[snap.operatingMode];
    this.pageViews.runtime.hud.position.y = main.rows.status / HEIGHT;
    this.fittedContent.set(this.pageViews.runtime.hud, main.height);
    this.heightController.request(profile.height, !this.heightInitialized || !this.panelShown);
    this.heightInitialized = true;
    this.applyHeight();
  }

  private layoutWizard(profile: PanelProfile, capture: boolean): void {
    const rows = profile.rows;
    layoutText(this.pageViews.setup.description, 0, rows.intro ?? rows.provider, CONTENT, 0.03, 20);
    layoutText(this.pageViews.setup.cardTitle, capture ? 0.19 : 0, capture ? rows.camera + 0.06 : rows.status,
      capture ? 0.39 : CONTENT, profile === SETUP_LAYOUTS.error ? 0.065 : 0.04, 23);
    layoutText(this.pageViews.setup.cardBody, capture ? 0.19 : 0, capture ? rows.camera - 0.025 : rows.details,
      capture ? 0.36 : CONTENT, capture || profile === SETUP_LAYOUTS.connected ? 0.115 : profile === SETUP_LAYOUTS.entry ? 0.04 : 0.1, 18);
    this.preview.position.y = (rows.camera ?? 0) / HEIGHT;
    this.pageViews.setup.previewLabel.position.y = (rows.previewLabel ?? 0) / HEIGHT;
    this.preview.visible = this.pageViews.setup.previewLabel.visible = capture;
    this.fittedContent.set(this.wizardBody, profile.height);
  }

  private applyHeight(): void {
    const height = this.heightController.height;
    const bottom = PANEL_TOP - height;
    this.plate.resize(WIDTH, height, RADIUS);
    this.plate.position.y = (HEIGHT - height) / (2 * HEIGHT);
    for (const node of [this.bar, this.barZone]) node.position.y = (bottom - 0.026) / HEIGHT;
    for (const side of ["left", "right"] as const) {
      this.cornerArcs[side].position.y = (bottom + RADIUS) / HEIGHT;
      this.cornerZones[side].position.y = bottom / HEIGHT;
    }
    const footerY = panelFooterY(height) / HEIGHT;
    for (const button of [this.pageViews.setup.setup, this.pageViews.setup.back, this.pageViews.setup.retry, this.pageViews.runtime.estop]) button.position.y = footerY;
    for (const [node, required] of this.fittedContent) {
      const fits = height + 1e-8 >= required;
      node.userData.rayDisabled = !fits;
      // Mode visibility is owned by its page transition, not by the fit gate.
      if (node !== this.chat && node !== this.manualHelp) node.visible = fits;
    }
    this.chat.userData.panelHeight = RUNTIME_LAYOUTS.agent.height;
    this.manualHelp.userData.panelHeight = RUNTIME_LAYOUTS.manual.height;
  }

  updateHover(hits: (THREE.Object3D | undefined)[], deltaS: number): void {
    this.heightController.tick(deltaS, this.manipulation !== null);
    this.applyHeight();
    this.animatePages(deltaS);
    const zone = this.manipulation?.zone;
    const looking = !!zone || hits.some(hit => this.ownsTarget(hit));
    const k = 1 - Math.exp(-14 * deltaS);
    for (const side of ["left", "right"] as const) {
      const material = this.cornerArcs[side].material;
      const target = zone === side || hits.includes(this.cornerZones[side]) ? 1 : looking ? 0.35 : 0;
      material.opacity += (target - material.opacity) * k;
    }
    const barActive = zone === "bar" || hits.includes(this.barZone);
    this.bar.material.opacity += ((barActive ? 1 : 0.6) - this.bar.material.opacity) * k;
    this.bar.scale.x += ((barActive ? 1.3 : 1) - this.bar.scale.x) * k;
  }

  ownsTarget(object: THREE.Object3D | undefined): boolean {
    for (let node = object; node; node = node.parent ?? undefined) {
      if (node === this.panel) return true;
    }
    return false;
  }

  updateCameraPreview(frame: CameraPreviewFrame, deltaS: number): void {
    if (this.localizationLayout !== true || !this.panelShown) return;
    this.preview.update(frame, deltaS, this.markerGuide);
    setText(this.pageViews.setup.previewLabel, this.preview.status);
  }

  private disposed = false;
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.preview.dispose(); this.preview.removeFromParent();
    const scrolls: ScrollableTextView[] = [];
    this.panel.traverse(node => { if (node instanceof ScrollableTextView) scrolls.push(node); });
    for (const view of scrolls) { view.dispose(); view.removeFromParent(); }
    const texts: xb.TextView[] = [];
    this.panel.traverse(node => { if (node instanceof xb.TextView) texts.push(node); });
    for (const view of texts) {
      view.dispose();
      const text = view.textObj as (THREE.Mesh & { dispose?: () => void }) | undefined;
      disposeTextResources(text); text?.removeFromParent();
    }
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.panel.traverse(node => {
      if (node instanceof THREE.Mesh || node instanceof THREE.Line) {
        geometries.add(node.geometry);
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.transitions.clear();
    this.panel.removeFromParent();
  }

  private animatePages(deltaS: number): void {
    const ease = (t: number) => t * t * (3 - 2 * t);
    const step = Math.max(0, deltaS) / DIMOS_AR_DESIGN.motion.transitionS;
    const panelStep = Math.max(0, deltaS) / (this.panelShown ? 0.22 : 0.18);
    this.panelProgress = THREE.MathUtils.clamp(this.panelProgress + (this.panelShown ? panelStep : -panelStep), 0, 1);
    const rootOpacity = ease(this.panelProgress);
    this.panel.visible = this.panelShown || this.panelProgress > 0;
    this.appearanceRoot.scale.setScalar(0.85 + 0.15 * rootOpacity);
    // Appearance scaling shares the fixed top pivot with height animation.
    this.appearanceRoot.position.y = (1 - this.appearanceRoot.scale.y) / 2;
    this.appearanceRoot.position.z = (1 - this.appearanceRoot.scale.z) * this.plate.position.z;
    this.appearanceRoot.traverse(node => {
      if (node instanceof SurfaceButton) node.syncSurfaceDepth();
      if (node.userData.followSurface) {
        const target = node.userData.followSurface as SurfaceButton;
        const scale = node.parent!.getWorldScale(new THREE.Vector3()).z;
        node.position.z = target.position.z + DIMOS_AR_DESIGN.depth.labelOffset / Math.max(1e-6, scale);
      } else if (node.userData.depthM) {
        const parentScale = node.parent!.getWorldScale(new THREE.Vector3()).z;
        const support = node.parent!.worldToLocal(this.plate.getWorldPosition(new THREE.Vector3()));
        node.position.z = support.z + node.userData.depthM / Math.max(1e-6, parentScale);
      }
    });
    this.speedSlider.syncDepth();
    this.plate.setOpacity(rootOpacity);
    this.plate.setWorldThickness(DIMOS_AR_DESIGN.depth.thickness);
    this.transitions.update(this.appearanceRoot, this.panel, this.plate, rootOpacity, this.heightController.height, step);
  }

  scrollView(object: THREE.Object3D | undefined): ScrollableTextView | null {
    if (object === this.pageViews.runtime.inputField.mesh) return this.pageViews.runtime.inputLabel;
    return object?.userData.scrollView instanceof ScrollableTextView ? object.userData.scrollView : null;
  }

  isEmergencyTarget(object: THREE.Object3D | undefined): boolean {
    return object === this.pageViews.runtime.estop.mesh && this.pageViews.runtime.estop.enabled;
  }

  isSpeechTarget(object: THREE.Object3D | undefined): boolean {
    return object === this.pageViews.runtime.inputField.mesh && this.pageViews.runtime.inputField.enabled;
  }

  canInteract(object: THREE.Object3D, point: THREE.Vector3): boolean {
    if (object.userData.interactionEnabled === false) return false;
    if (object.userData.manipulationSpeedSlider) return this.speedGroup.visible;
    for (let node: THREE.Object3D | null = object; node && node !== this.panel; node = node.parent) {
      if (node instanceof SurfaceButton) return node.enabled;
    }
    const scroll = this.scrollView(object);
    if (scroll) return scroll.maxScroll > 0;
    if (object === this.barZone || object === this.cornerZones.left || object === this.cornerZones.right) return true;
    if (object === this.plate) return this.appearanceRoot.worldToLocal(point.clone()).y > 0.25 / HEIGHT;
    return false;
  }

  isControl(object: THREE.Object3D | undefined): boolean {
    for (let node = object; node; node = node.parent ?? undefined) {
      if (node instanceof xb.TextButton) return true;
      if (node === this.panel) break;
    }
    return false;
  }

  private setDraft(text: string): void {
    this.draft = text.slice(0, 2000);
    this.onDraft(this.draft);
  }

  beginManipulation(origin: Vec3, direction: Vec3, rotation = new THREE.Quaternion(), grip = false): boolean {
    if (!this.panel.visible) return false;
    this.panel.updateWorldMatrix(true, true);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(this.panel.getWorldQuaternion(new THREE.Quaternion()));
    const center = this.panel.getWorldPosition(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center);
    const ray = new THREE.Ray(new THREE.Vector3(...origin), new THREE.Vector3(...direction).normalize());
    const start = ray.intersectPlane(plane, new THREE.Vector3());
    if (!start) return false;
    const local = this.appearanceRoot.worldToLocal(start.clone());
    const u = (meters: number) => meters / HEIGHT;
    const halfWidth = WIDTH / HEIGHT / 2, top = 0.5, bottom = (PANEL_TOP - this.heightController.height) / HEIGHT;
    const inside = Math.abs(local.x) <= halfWidth && local.y <= top && local.y >= bottom;
    const corner = Math.abs(local.x) > halfWidth - u(0.05) && Math.abs(local.x) < halfWidth + u(0.045) &&
      local.y < bottom + u(0.05) && local.y > bottom - u(0.045);
    const bar = Math.abs(local.x) < u(0.11) && local.y < bottom && local.y > bottom - u(0.05);
    const resize = corner && !grip;
    const move = !resize && (bar || (inside && (grip || local.y > u(0.25))));
    if (!resize && !move) return false;
    const anchor = this.appearanceRoot.localToWorld(new THREE.Vector3(resize ? -Math.sign(local.x) * halfWidth : 0, resize ? top : 0, 0));
    this.manipulation = {
      plane, start, position: this.panel.position.clone(), anchor,
      span: start.clone().sub(anchor), scale: this.panel.scale.x,
      distance: start.distanceTo(ray.origin), resize,
      rotation: this.panel.quaternion.clone(), controllerInverse: rotation.clone().invert(),
      zone: resize ? (local.x < 0 ? "left" : "right") : bar ? "bar" : "body",
    };
    return true;
  }

  updateManipulation(origin: Vec3, direction: Vec3, rotation = new THREE.Quaternion(), deltaS = 1 / 60, eye?: THREE.Vector3): void {
    const state = this.manipulation;
    if (!state) return;
    const defaultScale = HEIGHT * (this.runtimeScaleApplied ? CONTROL_PANEL_SCALE.runtime : CONTROL_PANEL_SCALE.setup);
    updatePanelGesture(this.panel, state, origin, direction, rotation, deltaS, defaultScale * .75, defaultScale * 2, eye);
  }

  endManipulation(): void { this.manipulation = null; }

}
