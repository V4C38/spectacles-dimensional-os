import * as THREE from "three";
import * as xb from "xrblocks";
import type { Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import { markRayPassive, registerRayTarget } from "../input/XRBlocksRayInteraction";
import { UI_FONT_REGULAR, UI_FONT_SEMIBOLD } from "./UIFonts";
import { SurfaceText } from "./SurfaceText";
import { SurfaceButton, type ButtonVariant } from "./SurfaceButton";
import { DIMOS_AR_DESIGN, cornerRadius } from "./DimOSARDesign";
import { surfaceBacking } from "./RoundedSurfaceGeometry";
import { GlassSurface } from "./GlassSurface";
import type { AgentDraftSnapshot } from "@dimos-ar-client/agent/AgentDraftSession";
import { disposeTextResources } from "./TextResources";
import { ScrollableTextView } from "./ScrollableTextView";
import { SetupCameraPreviewView, type CameraPreviewFrame } from "./SetupCameraPreviewView";
import { toneCss } from "./StatusTones";
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
  onDebug: () => void;
  onLidar: () => void;
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
const MAX_PITCH = THREE.MathUtils.degToRad(60);

type Align = "left" | "center" | "right";
type Zone = "bar" | "left" | "right" | "body";

export class MainMenuView {
  readonly panel: xb.SpatialPanel;
  private readonly wizard = new THREE.Group();
  private readonly success = new THREE.Group();
  private readonly preview = new SetupCameraPreviewView();
  private readonly previewLabel: SurfaceText;
  private readonly cardSurface: GlassSurface;
  private readonly cardBadge: GlassSurface;
  private readonly successDetail: SurfaceText;
  private readonly successRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly checkStrokes: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private localizationLayout: boolean | null = null;
  private markerGuide = false;
  private readonly console = new THREE.Group();
  private readonly header = new THREE.Group();
  private readonly robotBadge = new THREE.Group();
  private readonly settingsPage = new THREE.Group();
  private readonly details = new THREE.Group();
  private readonly title: SurfaceText;
  private readonly description: SurfaceText;
  private readonly cardTitle: SurfaceText;
  private readonly cardBody: SurfaceText;
  private readonly cardIcon: SurfaceText;
  private readonly stepTabs: SurfaceButton[] = [];
  private readonly setup: SurfaceButton;
  private readonly back: SurfaceButton;
  private readonly retry: SurfaceButton;
  private readonly robotName: SurfaceText;
  private readonly activity: SurfaceText;
  private readonly hud: SurfaceText;
  private readonly agent: ScrollableTextView;
  private readonly inputField: SurfaceButton;
  private readonly inputLabel: ScrollableTextView;
  private readonly clear: SurfaceButton;
  private readonly manualHelp = new THREE.Group();
  private readonly chat = new THREE.Group();
  private readonly mode: SurfaceButton;
  private readonly agentMode: SurfaceButton;
  private readonly robotButton: SurfaceButton;
  private readonly robotDot: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  private readonly soundToggle: SurfaceButton;
  private readonly soundEnabled: () => boolean;
  private readonly debugToggle: SurfaceButton;
  private readonly lidar: SurfaceButton;
  private readonly localize: SurfaceButton;
  private readonly estop: SurfaceButton;
  private readonly type: SurfaceButton;
  private readonly debug: ScrollableTextView;
  private readonly plate: GlassSurface;
  private panelShown = true;
  private panelProgress = 1;
  private readonly pageTransitions = new Map<THREE.Group, { progress: number; target: boolean }>();
  private readonly lastPageOpacity = new WeakMap<THREE.Object3D, number>();
  private readonly materialOpacity = new WeakMap<THREE.Material, { opacity: number; alpha: number | null }>();
  private readonly bar: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  private readonly barZone: THREE.Mesh;
  private readonly cornerArcs: Record<"left" | "right", THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>>;
  private readonly cornerZones: Record<"left" | "right", THREE.Mesh>;
  private manipulation: {
    plane: THREE.Plane; start: THREE.Vector3; position: THREE.Vector3;
    anchor: THREE.Vector3; span: THREE.Vector3; scale: number; distance: number; resize: boolean;
    rotation: THREE.Quaternion; controllerInverse: THREE.Quaternion; zone: Zone;
  } | null = null;
  private draft = "";
  private readonly onDraft: (text: string) => void;
  private agentEnabled = false;
  private settingsOpen = false;
  private detailsOpen = false;

  constructor(handlers: MainMenuCallbacks) {
    this.onDraft = handlers.onDraft;
    this.soundEnabled = handlers.soundEnabled ?? (() => true);
    this.panel = new xb.SpatialPanel({ width: WIDTH, height: HEIGHT, backgroundColor: "#00000000", draggable: false, useDefaultPosition: false, useBorderlessShader: true });
    this.panel.name = "DimOS control panel";
    // The glass plate replaces the package's opaque panel background.
    this.panel.mesh.visible = false;
    this.panel.add(this.wizard, this.success, this.console, this.details, this.header, this.robotBadge, this.settingsPage);
    const plate = this.plate = new GlassSurface({ width: WIDTH, height: HEIGHT, radius: RADIUS, thickness: DIMOS_AR_DESIGN.depth.thickness, rim: 0.28, rimWidth: 0.0025 });
    place(this.panel, plate, 0, 0, 0.001);
    plate.renderOrder = 1;
    plate.name = "Menu background";
    registerRayTarget(plate);
    markRayPassive(plate);

    // Connection header belongs to the setup wizard.
    label(this.header, "dimOS AR", LEFT + 0.17, HEADER_Y, 0.32, 0.04, 28, C.ink, "left", "semibold");
    this.stepTabs.push(...tabs(this.wizard, ["01 Connect", "02 Localization"], 0.203, [
      () => { if (this.lastStep === "localization") handlers.onBack(); },
      () => { if (this.lastStep === "connect") handlers.onSetup(); },
    ]));
    this.title = label(this.wizard, "", 0, 0.135, CONTENT, 0.06, 38, C.ink, "left", "semibold");
    this.title.visible = false;
    this.description = label(this.wizard, "", 0, 0.135, CONTENT, 0.05, 20, C.muted);
    this.cardSurface = surface(this.wizard, 0, -0.045, CONTENT, 0.24, DIMOS_AR_DESIGN.corners.field, C.fill);
    this.cardBadge = surface(this.wizard, LEFT + 0.06, -0.045, 0.064, 0.064, 0.032, C.control);
    this.cardIcon = label(this.wizard, "01", LEFT + 0.06, -0.045, 0.056, 0.045, 24, C.accent, "center", "semibold");
    const cardText = CONTENT - 0.12 - 0.028;
    this.cardTitle = label(this.wizard, "Ready when you are", LEFT + 0.12 + cardText / 2, -0.012, cardText, 0.032, 24, C.ink, "left", "semibold");
    this.cardBody = label(this.wizard, "", LEFT + 0.12 + cardText / 2, -0.07, cardText, 0.064, 19, C.muted);
    this.back = button(this.wizard, "Back", -THIRD_WIDTH - GAP, -0.298, THIRD_WIDTH, ACTION_HEIGHT, handlers.onBack);
    this.retry = button(this.wizard, "Retry", 0, -0.298, THIRD_WIDTH, ACTION_HEIGHT, () => this.lastStep === "localization" ? handlers.onLocalize() : handlers.onRetry());
    this.setup = button(this.wizard, "Continue", THIRD_WIDTH + GAP, -0.298, THIRD_WIDTH, ACTION_HEIGHT, handlers.onSetup, "primary");
    place(this.wizard, this.preview, -0.225, -0.055, 0.02);
    this.previewLabel = label(this.wizard, "Starting camera…", -0.225, -0.178, 0.34, 0.022, 14, C.muted, "center");
    this.preview.visible = this.previewLabel.visible = false;
    label(this.success, "dimOS AR", 0, 0.26, CONTENT, 0.04, 28, C.ink, "center", "semibold");
    const ring = this.successRing = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.094, 96, 1, Math.PI / 2, -Math.PI * 2), new THREE.MeshBasicMaterial({ color: 0x30d158, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    place(this.success, ring, 0, 0.06, DIMOS_AR_DESIGN.depth.surface); ring.renderOrder = 13; ring.raycast = () => {};
    const points = [[-0.044, 0.06], [-0.012, 0.03], [0.05, 0.096]];
    for (let i = 0; i < 2; i++) {
      const [x, y] = points[i], [x2, y2] = points[i + 1];
      const length = Math.hypot(x2 - x, y2 - y);
      const geometry = new THREE.PlaneGeometry(length, 0.009).translate(length / 2, 0, 0);
      const stroke = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x30d158, transparent: true, depthWrite: false }));
      place(this.success, stroke, x, y, DIMOS_AR_DESIGN.depth.text); stroke.renderOrder = 13; stroke.rotation.z = Math.atan2(y2 - y, x2 - x);
      stroke.raycast = () => {}; this.checkStrokes.push(stroke);
    }
    label(this.success, "Localization complete", 0, -0.08, CONTENT, 0.05, 32, C.ink, "center", "semibold");
    this.successDetail = label(this.success, "", 0, -0.145, CONTENT, 0.04, 20, C.muted, "center");
    this.success.visible = false;

    this.robotButton = button(this.robotBadge, "Robot · Not connected", 0, 0.465, 0.58, 0.105, handlers.onRobot);
    this.robotButton.alwaysWhite = true;
    (this.robotButton.mesh!.material as THREE.Material).depthWrite = true;
    this.robotButton.mesh!.add(surfaceBacking(this.robotButton.rangeX, this.robotButton.rangeY, this.robotButton.rangeY / 2, DIMOS_AR_DESIGN.depth.thickness / HEIGHT));
    this.robotButton.name = "Robot selection button";
    this.robotBadge.renderOrder = 12;
    this.robotDot = rect(this.robotBadge, -0.253, 0.465, 0.012, 0.012, C.faint, 0.006, DIMOS_AR_DESIGN.depth.text);
    this.robotDot.renderOrder = 13;
    this.console.add(this.chat, this.manualHelp);
    this.robotName = label(this.console, "dimOS AR", LEFT + 0.29, HEADER_Y, 0.56, 0.04, 28, C.ink, "left", "semibold");
    const gear = button(this.console, "", SETTINGS_X, HEADER_Y, ICON_SIZE, ICON_SIZE, () => { this.settingsOpen = true; });
    gear.name = "Global settings";
    gearIcon(this.console, SETTINGS_X, HEADER_Y);
    iconClose(this.console, "Close", handlers.onMenu);
    [this.mode, this.agentMode] = tabs(this.console, ["Manual", "Agent"], 0.198, [() => handlers.onMode("manual"), () => handlers.onMode("agent")]);
    this.activity = label(this.console, "Idle", 0, 0.139, CONTENT, 0.03, 19, C.muted);
    const agentField = messageField(this.chat, "Agent", 0.052, true);
    this.agent = agentField.content;
    const humanField = messageField(this.chat, "Your message", -0.088, false);
    this.inputField = humanField.surface;
    this.inputField.name = "Agent dictation field";
    this.inputLabel = humanField.content;
    this.type = button(this.chat, "Send to agent", -(HALF_WIDTH + GAP) / 2, -0.196, HALF_WIDTH, ACTION_HEIGHT, () => {
      if (this.agentEnabled && handlers.onAgentText(this.draft)) this.setDraft("");
    }, "primary");
    this.clear = button(this.chat, "Clear", (HALF_WIDTH + GAP) / 2, -0.196, HALF_WIDTH, ACTION_HEIGHT, () => this.setDraft(""));
    surface(this.manualHelp, 0, 0, CONTENT, 0.18, 0.024, C.fill);
    label(this.manualHelp, "Drag the marker, or select the robot and aim at the floor.\nRelease to confirm.", 0, 0, CONTENT - 0.056, 0.13, 23, C.muted);
    this.hud = label(this.console, "", 0, -0.251, CONTENT, 0.018, 13, C.muted);
    // Keep the last row above the bottom corner curve.
    this.estop = button(this.console, "EMERGENCY STOP", 0, -0.298, CONTENT, ACTION_HEIGHT, handlers.onEstop, "danger");

    label(this.settingsPage, "Settings", LEFT + 0.29, HEADER_Y, 0.56, 0.04, 28, C.ink, "left", "semibold");
    iconClose(this.settingsPage, "Done", () => { this.settingsOpen = false; });
    label(this.settingsPage, "Robot", 0, 0.213, CONTENT, 0.03, 19, C.muted);
    this.lidar = button(this.settingsPage, "LiDAR · Obstacles", 0, 0.15, CONTENT, ACTION_HEIGHT, handlers.onLidar);
    this.localize = button(this.settingsPage, "Realign", -(HALF_WIDTH + GAP) / 2, 0.066, HALF_WIDTH, ACTION_HEIGHT, handlers.onRealign);
    button(this.settingsPage, "Setup", (HALF_WIDTH + GAP) / 2, 0.066, HALF_WIDTH, ACTION_HEIGHT, handlers.onRestart);
    label(this.settingsPage, "Headset", 0, -0.014, CONTENT, 0.03, 19, C.muted);
    this.debugToggle = button(this.settingsPage, "Debug · Off", 0, -0.084, CONTENT, ACTION_HEIGHT, handlers.onDebug);
    button(this.settingsPage, "Diagnostics", 0, -0.168, CONTENT, ACTION_HEIGHT, () => { this.detailsOpen = true; });

    this.soundToggle = button(this.settingsPage, "Sound · On", 0, -0.252, CONTENT, ACTION_HEIGHT, () => handlers.onSound?.());

    label(this.details, "Diagnostics", LEFT + 0.29, HEADER_Y, 0.56, 0.04, 28, C.ink, "left", "semibold");
    iconClose(this.details, "Done", () => { this.detailsOpen = false; });
    surface(this.details, 0, -0.03, CONTENT, 0.4, DIMOS_AR_DESIGN.corners.field, C.fill);
    this.debug = scrollLabel(this.details, "", 0, -0.03, CONTENT - 0.056, 0.36, 18, C.muted);

    // visionOS-style window controls sit outside the glass.
    this.bar = rect(this.panel, 0, -HEIGHT / 2 - 0.026, 0.12, 0.013, C.chrome, 0.0065);
    this.bar.material.opacity = 0.6;
    this.barZone = zone(this.panel, "Window bar", 0, -HEIGHT / 2 - 0.026, 0.22, 0.05);
    const arc = (side: -1 | 1) => {
      const geometry = new THREE.RingGeometry(RADIUS + 0.012, RADIUS + 0.019, 24, 1, side > 0 ? -Math.PI / 2 : Math.PI, Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: C.chrome, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      place(this.panel, mesh, side * (WIDTH / 2 - RADIUS), -(HEIGHT / 2 - RADIUS), 0.006);
      mesh.raycast = () => {};
      return mesh;
    };
    this.cornerArcs = { left: arc(-1), right: arc(1) };
    this.cornerZones = {
      left: zone(this.panel, "Resize corner", -WIDTH / 2, -HEIGHT / 2, 0.09, 0.09),
      right: zone(this.panel, "Resize corner", WIDTH / 2, -HEIGHT / 2, 0.09, 0.09),
    };

    this.console.visible = false;
    this.detailsOpen = false;
    this.details.visible = false;
    this.settingsPage.visible = false;
    this.panel.traverse(object => {
      if (!(object instanceof SurfaceButton) || !handlers.canActivate) return;
      const activate = object.onTriggered;
      object.onTriggered = id => { if (handlers.canActivate?.(id, object.mesh!)) { activate(id); if (object.enabled) handlers.onActivate?.(); } };
    });
    this.panel.scale.multiplyScalar(0.432);
    this.appearanceRoot.name = "Menu appearance";
    for (const child of [...this.panel.children]) if (child !== this.panel.mesh) this.appearanceRoot.add(child);
    this.panel.add(this.appearanceRoot);
  }

  private readonly appearanceRoot = new THREE.Group();
  private runtimeScaleApplied = false;

  private lastStep: WebXRUISnapshot["wizardStep"] = "connect";

  apply(snap: WebXRUISnapshot, speech?: AgentDraftSnapshot): void {
    const runtime = snap.setupCompleted && !snap.setupCelebrating;
    if (runtime !== this.runtimeScaleApplied && (this.panelProgress === 0 || (runtime && snap.menuOpen) || !snap.setupCompleted)) {
      this.panel.scale.multiplyScalar(runtime ? 0.8 : 1.25);
      this.runtimeScaleApplied = runtime;
    }
    this.lastStep = snap.wizardStep;
    this.agentEnabled = snap.setupCompleted && snap.operatingMode === "agent" && snap.agentAvailable && snap.robotSelected;
    this.panelShown = snap.menuOpen || !snap.setupCompleted || snap.setupCelebrating === true;
    this.panel.visible = this.panelShown || this.panelProgress > 0;
    this.panel.userData.rayDisabled = !this.panelShown;
    this.wizard.visible = !snap.setupCompleted;
    this.success.visible = snap.setupCelebrating === true;
    setText(this.successDetail, `${snap.robotName} is ready`);
    const successProgress = snap.setupSuccessProgress ?? 0;
    this.successRing.geometry.setDrawRange(0, Math.floor(successProgress * 96) * 6);
    this.checkStrokes.forEach((stroke, index) => {
      const progress = THREE.MathUtils.clamp((successProgress - 0.25) / 0.75 * 2 - index, 0, 1);
      stroke.scale.x = progress * progress * (3 - 2 * progress) / HEIGHT;
    });
    this.header.visible = !snap.setupCompleted;
    this.robotBadge.visible = this.panelShown;
    if (!snap.setupCompleted || !this.panelShown) { this.detailsOpen = false; this.settingsOpen = false; }
    this.details.visible = this.detailsOpen;
    this.console.visible = snap.setupCompleted && this.panelShown && !snap.setupCelebrating && !this.detailsOpen && !this.settingsOpen;
    this.settingsPage.visible = this.settingsOpen && !this.detailsOpen;
    setText(this.robotButton, `${clip(snap.robotName, 36)}\n${snap.robotConnectionText === "Connected" ? `${snap.robotSelected ? "Selected · " : ""}${snap.activity === "Following Path" ? "Following path" : snap.activity}` : snap.robotConnectionText}`);
    this.robotButton.setEnabled(snap.robotSelectable);
    this.robotButton.setActive(snap.robotSelected);
    this.robotButton.fontColor = C.ink;
    setText(this.soundToggle, `Sound · ${this.soundEnabled() ? "On" : "Off"}`);
    this.robotDot.material.color.set(toneCss(snap.connectionTone));
    setText(this.debugToggle, `Debug · ${snap.debugEnabled ? "On" : "Off"}`);
    this.debugToggle.setActive(snap.debugEnabled);
    setText(this.title, snap.wizardTitle);
    setText(this.description, snap.wizardDescription);
    const index = ["connect", "localization"].indexOf(snap.wizardStep);
    setText(this.stepTabs[0], snap.connectComplete ? "✓ Connected" : "01 Connect");
    this.stepTabs.forEach((tab, i) => tab.setActive(i === index));
    this.stepTabs[1].setEnabled(snap.connectComplete === true);
    setText(this.cardIcon, snap.connectComplete && index === 0 ? "✓" : snap.localizationIssue && index === 1 ? "!" : `0${index + 1}`);
    this.cardIcon.color(snap.connectComplete && index === 0 ? "#30d158" : C.accent);
    setText(this.cardTitle, snap.wizardCardTitle);
    setText(this.cardBody, snap.wizardCardBody);
    this.cardTitle.color(C.ink);
    setText(this.setup, snap.nextLabel);
    this.setup.setVariant(snap.nextLabel === "Continue" ? "primary" : "default");
    this.back.visible = snap.backVisible;
    this.retry.visible = index === 0 || (index === 1 && !!snap.localizationIssue);
    setText(this.retry, index === 1 ? "Try again" : "Reconnect");
    setText(this.robotName, "dimOS AR");
    const speechStatus = speech?.status === "Type a message" ? "Microphone unavailable" : speech?.status;
    setText(this.activity, snap.operatingMode === "agent" && speechStatus !== "Off" ? speechStatus ?? "Ready" : snap.activity);
    this.mode.setEnabled(true);
    this.agentMode.setEnabled(snap.agentAvailable);
    this.agentMode.setActive(snap.operatingMode === "agent");
    this.mode.setActive(snap.operatingMode === "manual");
    this.chat.visible = snap.operatingMode === "agent";
    this.manualHelp.visible = snap.operatingMode === "manual";
    this.draft = speech?.prompt ?? this.draft;
    this.inputLabel.setContent(this.draft || (speech?.recognitionAvailable === false ? "Microphone unavailable" : speech?.status === "Listening" ? "Listening…" : "Hold to record"), speech?.status === "Listening");
    this.inputField.setEnabled(snap.agentAvailable && speech?.recognitionAvailable === true && speech?.status !== "Transcribing…");
    this.inputField.setActive(speech?.status === "Listening" || speech?.status === "Starting microphone…");
    this.type.setEnabled(this.agentEnabled && !!this.draft.trim() && speech?.status !== "Listening" && speech?.status !== "Starting microphone…" && speech?.status !== "Transcribing…");
    this.clear.setEnabled(!!this.draft && speech?.status !== "Listening" && speech?.status !== "Starting microphone…" && speech?.status !== "Transcribing…");
    this.agent.setContent(speech?.response || snap.agentMessage || "", false, true);
    this.agent.color(toneCss(speech?.severity === "error" ? "error" : speech?.severity === "warn" ? "warn" : "neutral"));
    setText(this.lidar, snap.lidarAvailable ? `LiDAR · ${snap.lidarMode}` : "LiDAR unavailable");
    this.lidar.setEnabled(snap.lidarAvailable);
    setText(this.localize, snap.hasTrackingOrigin ? "Realign" : "Align robot");
    this.estop.setEnabled(snap.estopAvailable);
    setText(this.hud, clip(speech?.error || snap.hudText || "", 100));
    this.hud.color(toneCss(speech?.error ? "warn" : snap.hudTone ?? "muted"));
    this.debug.setContent(snap.debugText);
    const localization = snap.wizardStep === "localization" && !snap.localizationIssue && snap.localizationKind !== "unavailable";
    if (localization !== this.localizationLayout) {
      this.localizationLayout = localization;
      this.cardSurface.resize(localization ? 0.42 : CONTENT, localization ? 0.22 : 0.24);
      this.cardSurface.position.set(localization ? 0.19 / HEIGHT : 0, (localization ? -0.055 : -0.045) / HEIGHT, DIMOS_AR_DESIGN.depth.surface / HEIGHT);
      layoutText(this.cardTitle, localization ? 0.19 : LEFT + 0.12 + (CONTENT - 0.148) / 2, localization ? 0.022 : 0.035, localization ? 0.39 : CONTENT - 0.148, 0.04, 23);
      layoutText(this.cardBody, localization ? 0.19 : LEFT + 0.12 + (CONTENT - 0.148) / 2, localization ? -0.065 : -0.055, localization ? 0.36 : CONTENT - 0.148, localization ? 0.115 : 0.15, 18);
    }
    this.cardBadge.position.z = 0.006 / HEIGHT;
    this.cardIcon.position.z = 0.0065 / HEIGHT;
    this.cardBadge.visible = this.cardIcon.visible = !localization;
    this.preview.visible = this.previewLabel.visible = localization;
    this.markerGuide = snap.localizationKind === "marker" || snap.localizationKind === "mixed";

    for (const page of [this.wizard, this.success, this.header, this.robotBadge, this.console, this.chat, this.manualHelp, this.settingsPage, this.details]) {
      const target = page.visible;
      const state = this.pageTransitions.get(page) ?? { progress: 0, target };
      state.target = target;
      this.pageTransitions.set(page, state);
      page.userData.rayDisabled = !target;
      page.visible = target || state.progress > 0;
    }
  }

  updateHover(hits: (THREE.Object3D | undefined)[], deltaS: number): void {
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
    this.bar.scale.x += ((barActive ? 1.3 : 1) / HEIGHT - this.bar.scale.x) * k;
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
    setText(this.previewLabel, this.preview.status);
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
      if (node === this.panel.mesh) return;
      if (node instanceof THREE.Mesh || node instanceof THREE.Line) {
        geometries.add(node.geometry);
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.pageTransitions.clear();
    this.panel.removeFromParent();
  }

  private animatePages(deltaS: number): void {
    const ease = (t: number) => t * t * (3 - 2 * t);
    const step = Math.max(0, deltaS) / DIMOS_AR_DESIGN.motion.transitionS;
    const panelStep = Math.max(0, deltaS) / (this.panelShown ? 0.22 : 0.18);
    this.panelProgress = THREE.MathUtils.clamp(this.panelProgress + (this.panelShown ? panelStep : -panelStep), 0, 1);
    const rootOpacity = ease(this.panelProgress);
    this.panel.visible = this.panelShown || this.panelProgress > 0;
    this.appearanceRoot.scale.setScalar(0.94 + 0.06 * rootOpacity);
    this.appearanceRoot.position.z = -0.012 / HEIGHT * (1 - rootOpacity);
    this.plate.setOpacity(rootOpacity);
    for (const child of this.appearanceRoot.children) {
      if (child !== this.plate && !this.pageTransitions.has(child as THREE.Group)) this.fadePage(child, rootOpacity);
    }
    for (const [page, state] of this.pageTransitions) {
      state.progress = THREE.MathUtils.clamp(state.progress + (state.target ? step : -step), 0, 1);
      page.visible = state.target || state.progress > 0;
      page.scale.setScalar(0.985 + 0.015 * ease(state.progress));
      page.position.y = -0.008 / HEIGHT * (1 - ease(state.progress));
    }
    for (const [page, state] of this.pageTransitions) {
      let opacity = rootOpacity * ease(state.progress);
      for (let parent = page.parent; parent && parent !== this.panel; parent = parent.parent) {
        const ancestor = parent instanceof THREE.Group ? this.pageTransitions.get(parent) : undefined;
        if (ancestor) opacity *= ease(ancestor.progress);
      }
      this.fadePage(page, opacity);
    }
  }

  private fadePage(page: THREE.Object3D, opacity: number): void {
    if (this.lastPageOpacity.get(page) === opacity) return;
    this.lastPageOpacity.set(page, opacity);
    const visit = (node: THREE.Object3D) => {
      if (node !== page && node instanceof THREE.Group && this.pageTransitions.has(node)) return;
      const material = (node as THREE.Mesh).material;
      for (const item of Array.isArray(material) ? material : material ? [material] : []) {
        const alpha = (item as THREE.ShaderMaterial).uniforms?.uOpacity ?? (item as THREE.ShaderMaterial).uniforms?.uAlpha;
        const base = this.materialOpacity.get(item) ?? { opacity: item.opacity, alpha: alpha?.value ?? null };
        this.materialOpacity.set(item, base);
        if (!item.transparent) { item.transparent = true; item.needsUpdate = true; }
        if (alpha && base.alpha !== null) alpha.value = base.alpha * opacity;
        else item.opacity = base.opacity * opacity;
      }
      for (const child of node.children) visit(child);
    };
    visit(page);
  }

  scrollView(object: THREE.Object3D | undefined): ScrollableTextView | null {
    if (object === this.inputField.mesh) return this.inputLabel;
    return object?.userData.scrollView instanceof ScrollableTextView ? object.userData.scrollView : null;
  }

  isEmergencyTarget(object: THREE.Object3D | undefined): boolean {
    return object === this.estop.mesh && this.estop.enabled;
  }

  isSpeechTarget(object: THREE.Object3D | undefined): boolean {
    return object === this.inputField.mesh && this.inputField.enabled;
  }

  canInteract(object: THREE.Object3D, point: THREE.Vector3): boolean {
    if (object.userData.interactionEnabled === false) return false;
    for (let node: THREE.Object3D | null = object; node && node !== this.panel; node = node.parent) {
      if (node instanceof SurfaceButton) return node.enabled;
    }
    const scroll = this.scrollView(object);
    if (scroll) return scroll.maxScroll > 0;
    if (object === this.barZone || object === this.cornerZones.left || object === this.cornerZones.right) return true;
    if (object === this.plate) return this.panel.worldToLocal(point.clone()).y > 0.25 / HEIGHT;
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
    const local = this.panel.worldToLocal(start.clone());
    const u = (meters: number) => meters / HEIGHT;
    const halfWidth = WIDTH / HEIGHT / 2, halfHeight = 0.5;
    const inside = Math.abs(local.x) <= halfWidth && Math.abs(local.y) <= halfHeight;
    const corner = Math.abs(local.x) > halfWidth - u(0.05) && Math.abs(local.x) < halfWidth + u(0.045) &&
      local.y < -halfHeight + u(0.05) && local.y > -halfHeight - u(0.045);
    const bar = Math.abs(local.x) < u(0.11) && local.y < -halfHeight && local.y > -halfHeight - u(0.05);
    const resize = corner && !grip;
    const move = !resize && (bar || (inside && (grip || local.y > u(0.25))));
    if (!resize && !move) return false;
    const anchor = this.panel.localToWorld(new THREE.Vector3(resize ? -Math.sign(local.x) * halfWidth : 0, resize ? halfHeight : 0, 0));
    this.manipulation = {
      plane, start, position: this.panel.position.clone(), anchor,
      span: start.clone().sub(anchor), scale: this.panel.scale.x,
      distance: start.distanceTo(ray.origin), resize,
      rotation: this.panel.quaternion.clone(), controllerInverse: rotation.clone().invert(),
      zone: resize ? (local.x < 0 ? "left" : "right") : bar ? "bar" : "body",
    };
    return true;
  }

  updateManipulation(origin: Vec3, direction: Vec3, rotation = new THREE.Quaternion(), deltaS = 1 / 60): void {
    const state = this.manipulation;
    if (!state) return;
    const ray = new THREE.Ray(new THREE.Vector3(...origin), new THREE.Vector3(...direction).normalize());
    if (!state.resize) {
      const targetRotation = upright(rotation.clone().multiply(state.controllerInverse).multiply(state.rotation));
      const deltaRotation = targetRotation.clone().multiply(state.rotation.clone().invert());
      const offset = state.start.clone().sub(state.position).applyQuaternion(deltaRotation);
      const targetPosition = ray.at(state.distance, new THREE.Vector3()).sub(offset);
      this.panel.position.lerp(targetPosition, 1 - Math.exp(-12 * deltaS));
      this.panel.quaternion.slerp(targetRotation, 1 - Math.exp(-14 * deltaS));
      this.panel.quaternion.copy(upright(this.panel.quaternion));
      return;
    }
    const point = ray.intersectPlane(state.plane, new THREE.Vector3());
    if (!point || state.span.lengthSq() < 1e-8) return;
    const ratio = point.sub(state.anchor).dot(state.span) / state.span.lengthSq();
    const scale = THREE.MathUtils.clamp(state.scale * ratio, HEIGHT * 0.3, HEIGHT * 1.5);
    this.panel.scale.setScalar(scale);
    this.panel.position.copy(state.position).sub(state.anchor).multiplyScalar(scale / state.scale).add(state.anchor);
  }

  endManipulation(): void { this.manipulation = null; }

}

/** Keeps yaw and a clamped forward tilt; roll is never allowed. */
function upright(rotation: THREE.Quaternion): THREE.Quaternion {
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation);
  const yaw = Math.atan2(forward.x, forward.z);
  const pitch = THREE.MathUtils.clamp(Math.atan2(forward.y, Math.hypot(forward.x, forward.z)), -MAX_PITCH, MAX_PITCH);
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, yaw, 0, "YXZ"));
}

function attach<T extends xb.TextView>(parent: THREE.Object3D, object: T, x: number, y: number): T {
  object.isRoot = true;
  object.renderOrder = 12;
  parent.add(object);
  object.updateLayouts();
  object.position.set(x / HEIGHT, y / HEIGHT, DIMOS_AR_DESIGN.depth.text / HEIGHT);
  return object;
}

function label(parent: THREE.Object3D, text: string, x: number, y: number, width: number, height: number, fontSize: number, color: string = C.ink, align: Align = "left", weight: "regular" | "semibold" = "regular"): SurfaceText {
  if (align === "left" && width >= CONTENT - 0.01) width -= 0.02;
  const target = new SurfaceText({ text, font: weight === "semibold" ? UI_FONT_SEMIBOLD : UI_FONT_REGULAR, fontSize: xb.TextView.dpToMeters(fontSize * 1.35) / height, fontColor: color, selectable: false, mode: "center", anchorX: align, textAlign: align });
  target.width = width / HEIGHT;
  target.height = height / HEIGHT;
  return attach(parent, target, x, y);
}

function button(parent: THREE.Object3D, text: string, x: number, y: number, width: number, height: number, action: () => void, variant: ButtonVariant = "default"): SurfaceButton {
  const target = attach(parent, new SurfaceButton({ text, font: UI_FONT_SEMIBOLD, width: width / HEIGHT, height: height / HEIGHT, fontSize: xb.TextView.dpToMeters(26) / height, opacity: 1, backgroundColor: C.control, radius: height / 2, hoverColor: C.ink, selectedFontColor: C.ink }), x, y);
  target.position.z = DIMOS_AR_DESIGN.depth.surface / HEIGHT;
  target.setSurface(variant);
  target.onTriggered = () => {
    if (!target.enabled) return;
    // XR Blocks also intersects hidden descendants, so check the entire ancestry.
    let node: THREE.Object3D | null = target;
    while (node) { if (!node.visible || node.userData.rayDisabled === true) return; node = node.parent; }
    action();
  };
  return target;
}

function place<T extends THREE.Object3D>(parent: THREE.Object3D, object: T, x: number, y: number, z: number): T {
  object.position.set(x / HEIGHT, y / HEIGHT, z / HEIGHT);
  object.scale.setScalar(1 / HEIGHT);
  parent.add(object);
  return object;
}

function surface(parent: THREE.Object3D, x: number, y: number, width: number, height: number, radius: number, color: string): GlassSurface {
  const mesh = new GlassSurface({ width, height, radius: radius || cornerRadius(width, height), tint: color, alpha: 1, rim: 0.06, rimWidth: 0.002 });
  mesh.raycast = () => {};
  mesh.material.depthWrite = false;
  mesh.renderOrder = 2;
  return place(parent, mesh, x, y, DIMOS_AR_DESIGN.depth.surface);
}

function zone(parent: THREE.Object3D, name: string, x: number, y: number, width: number, height: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ visible: false }));
  mesh.name = name;
  registerRayTarget(mesh);
  return place(parent, mesh, x, y, 0.004);
}

function rect(parent: THREE.Object3D, x: number, y: number, width: number, height: number, color: string, radius = 0.001, z = 0.008): THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(roundedShape(width, height, radius)), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, depthWrite: false }));
  mesh.raycast = () => {};
  mesh.renderOrder = 3;
  return place(parent, mesh, x, y, z);
}

function roundedShape(width: number, height: number, radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  const w = width / 2, h = height / 2, r = Math.min(radius, w, h);
  shape.moveTo(-w + r, -h); shape.lineTo(w - r, -h); shape.quadraticCurveTo(w, -h, w, -h + r);
  shape.lineTo(w, h - r); shape.quadraticCurveTo(w, h, w - r, h);
  shape.lineTo(-w + r, h); shape.quadraticCurveTo(-w, h, -w, h - r);
  shape.lineTo(-w, -h + r); shape.quadraticCurveTo(-w, -h, -w + r, -h);
  return shape;
}

function setText(target: xb.TextView, value: string): void {
  if (target.text !== value) target.setText(value);
}
function clip(text: string, max: number): string { return text.length > max ? `${text.slice(0, max - 1)}…` : text; }

function gearIcon(parent: THREE.Object3D, x: number, y: number): void {
  const icon = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false });
  icon.add(new THREE.Mesh(new THREE.RingGeometry(0.007, 0.013, 32), material));
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const tooth = new THREE.Mesh(new THREE.PlaneGeometry(0.005, 0.006), material);
    tooth.position.set(Math.sin(angle) * 0.014, Math.cos(angle) * 0.014, 0);
    tooth.rotation.z = -angle;
    icon.add(tooth);
  }
  icon.traverse(child => { child.raycast = () => {}; child.renderOrder = 13; });
  place(parent, icon, x, y, DIMOS_AR_DESIGN.depth.text);
}

function layoutText(text: SurfaceText, x: number, y: number, width: number, height: number, size: number): void {
  text.width = width / HEIGHT; text.height = height / HEIGHT;
  text.fontSize = xb.TextView.dpToMeters(size * 1.35) / height;
  text.updateLayouts(); text.position.x = x / HEIGHT; text.position.y = y / HEIGHT;
}

function iconClose(parent: THREE.Object3D, name: string, action: () => void): SurfaceButton {
  const target = button(parent, "", CLOSE_X, HEADER_Y, ICON_SIZE, ICON_SIZE, action);
  target.name = name;
  const icon = new THREE.Group();
  for (const angle of [Math.PI / 4, -Math.PI / 4]) {
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.026, 0.0035), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false }));
    bar.rotation.z = angle; bar.raycast = () => {}; bar.renderOrder = 13; icon.add(bar);
  }
  icon.renderOrder = 13; place(parent, icon, CLOSE_X, HEADER_Y, DIMOS_AR_DESIGN.depth.text);
  return target;
}

function scrollLabel(parent: THREE.Object3D, text: string, x: number, y: number, width: number, height: number, fontSize: number, color: string = C.ink, bodyScrollable = true): ScrollableTextView {
  const target = new ScrollableTextView({ text, font: UI_FONT_REGULAR, fontSize: xb.TextView.dpToMeters(fontSize * 1.35) / height, fontColor: color, selectable: false, mode: "center", anchorX: "left", textAlign: "left" }, bodyScrollable);
  target.width = width / HEIGHT; target.height = height / HEIGHT;
  return attach(parent, target, x, y);
}

/** Both conversation fields use this exact primitive; only the input behavior differs. */
function messageField(parent: THREE.Object3D, caption: string, y: number, bodyScrollable: boolean): { surface: SurfaceButton; content: ScrollableTextView } {
  const height = DIMOS_AR_DESIGN.message.height;
  const field = button(parent, "", 0, y, CONTENT, height, () => {}, "field");
  if (bodyScrollable) field.mesh!.userData.interactionEnabled = false;
  const heading = label(parent, caption, LEFT + DIMOS_AR_DESIGN.message.padding + 0.2, y + DIMOS_AR_DESIGN.message.captionY, 0.4, DIMOS_AR_DESIGN.message.captionHeight, 15, C.muted, "left", "semibold");
  heading.position.z = DIMOS_AR_DESIGN.depth.text / HEIGHT; heading.renderOrder = 14;
  const content = scrollLabel(parent, "", 0, y + DIMOS_AR_DESIGN.message.textY, CONTENT - DIMOS_AR_DESIGN.message.padding * 2, DIMOS_AR_DESIGN.message.textHeight, 20, C.ink, bodyScrollable);
  content.position.z = DIMOS_AR_DESIGN.depth.text / HEIGHT; content.renderOrder = 14;
  return { surface: field, content };
}

function tabs(parent: THREE.Object3D, labels: [string, string], y: number, actions: [() => void, () => void]): [SurfaceButton, SurfaceButton] {
  const rail = surface(parent, 0, y, CONTENT, ACTION_HEIGHT + 0.012, (ACTION_HEIGHT + 0.012) / 2, C.field);
  rail.name = "Segmented control track";
  rail.position.z = 0.002 / HEIGHT;
  const width = (CONTENT - 0.018) / 2;
  return labels.map((text, i) => button(parent, text, (i ? 1 : -1) * (width / 2 + 0.003), y, width, ACTION_HEIGHT, actions[i], "tab")) as [SurfaceButton, SurfaceButton];
}
