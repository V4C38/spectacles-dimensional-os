import { PanelHeightController } from "./PanelHeightController";
import { RUNTIME_LAYOUTS, RUNTIME_PANEL_SCALE, panelFooterY } from "./PanelLayout";
import type { CapsuleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/CapsuleButton";
import type { LidarDisplayMode } from "../../DimOSARClient/sensors/lidarSettings";
import { CONTROL_PANEL_COPY as COPY, CONTROL_PANEL_LAYOUT, controlPanelTab, robotBadgeText, sensorStatusText } from "../../DimOSARClient/presentation/ControlPanelPresentation";
import type { OperatingMode } from "./AppState";
import type { SpecsUISnapshot } from "./SpecsUISnapshot";
import { NativeTextField } from "./NativeTextField";
import { WorldMeshRenderer } from "./WorldMeshRenderer";
import { createPanelSurface, createIconButton, createText, getFrameComponent, isFrameInitialized,
  configureControlPanelFrame, configurePanelText, setPanelFollowing, setButtonSelected, panelButtonLayer, panelFontSize, uiMaterialLayer, COLOR_WHITE, SnapOS2Styles, type IconButtonResult } from "./UIKit";

interface MainMenuCallbacks {
  onRestart: () => void;
  onModeButtonPressed: (mode: OperatingMode) => void;
  onEmergencyStop: () => void;
  onDebugModeChanged: (enabled: boolean) => void;
  onRobot: () => void;
  onClose: () => void;
  onPin: () => void;
  onLidarMode: (mode: LidarDisplayMode) => void;
  onLidarRange: (direction: number) => void;
  onLidarPoints: (direction: number) => void;
  onRealign: () => void;
  onDismissAlignment: () => void;
  onRecord: () => void;
  onRecordEnd: (cancel: boolean) => void;
  onSend: () => void;
  onClear: () => void;
}

type Page = "main" | "settings" | "sensors" | "diagnostics" | "alignment";
const UNIT = 100;
const CONTENT = (CONTROL_PANEL_LAYOUT.width - CONTROL_PANEL_LAYOUT.margin * 2) * UNIT;
const ACTION = 0.064 * UNIT;
const HALF = (CONTENT - 0.02 * UNIT) / 2;
const HEADER = 0.286 * UNIT;
const CLOSE_X = CONTENT / 2 - 0.072 * UNIT / 2;

/** WebXR's page arrangement and copy, rendered with fixed-size native SUK primitives. */
export class MainMenuView {
  private readonly root: SceneObject;
  private readonly pages = new Map<Page, SceneObject>();
  private readonly bodies = new Map<Page, SceneObject>();
  private readonly rowNodes: { parent: SceneObject; node: SceneObject; y: number }[] = [];
  private readonly messageBlocks = new Map<NativeTextField, SceneObject>();
  private readonly heightController: PanelHeightController;
  private operatingMode: OperatingMode = "manual";
  private layoutKey = "";
  private readonly robot: IconButtonResult;
  private readonly status: Text;
  private readonly manual: SceneObject;
  private readonly chat: SceneObject;
  private readonly reply: NativeTextField;
  private readonly draft: NativeTextField;
  private readonly diagnostics: NativeTextField;
  private readonly send: CapsuleButton;
  private readonly clear: CapsuleButton;
  private readonly modeButtons: CapsuleButton[];
  private readonly lidarButtons: CapsuleButton[];
  private readonly sensorControls: CapsuleButton[] = [];
  private readonly range: Text;
  private readonly rangeLabel: Text;
  private readonly points: Text;
  private readonly sensorStatus: Text;
  private readonly debug: IconButtonResult;
  private readonly realign: IconButtonResult;
  private readonly stop: CapsuleButton;
  private page: Page = "main";
  private debugEnabled = false;
  private soundEnabled = true;
  private readonly buttons: CapsuleButton[] = [];

  constructor(private readonly panel: SceneObject, private readonly callbacks: MainMenuCallbacks) {
    this.root = global.scene.createSceneObject("NativeRuntimeUI"); this.root.setParent(panel);
    const frame = getFrameComponent(panel);
    if (frame) frame.autoShowHide = false;
    frame?.initialize();
    if (frame && isFrameInitialized(frame)) {
      configureControlPanelFrame(frame);
      frame.allowTranslation = true; frame.onlyInteractOnBorder = true; frame.autoShowHide = false;
      frame.showCloseButton = false; frame.showFollowButton = false;
      frame.setUseFollow(false); frame.setFollowing(false);
      this.root.setParent(frame.content); frame.onTranslationStart.add(callbacks.onPin);
    }
    this.heightController = new PanelHeightController(frame, this.root, RUNTIME_PANEL_SCALE);
    this.robot = this.button(this.root, "Robot selection button", "Robot", 0, 0.465 * UNIT, 0.58 * UNIT, 0.105 * UNIT, callbacks.onRobot);
    panelButtonLayer(this.robot, true);
    for (const name of ["main", "settings", "sensors", "diagnostics", "alignment"] as Page[]) {
      const page = global.scene.createSceneObject(`Runtime${name}`); page.setParent(this.root); this.pages.set(name, page);
      const body = global.scene.createSceneObject(`${name}Body`); body.setParent(page); this.bodies.set(name, body);
    }
    const main = this.pages.get("main")!;
    this.text(main, COPY.appName, -18, CONTROL_PANEL_LAYOUT.titleY * UNIT, 44, 4, 28, HorizontalAlignment.Left);
    this.icon(main, "Sensors button", "camera", CLOSE_X - 2 * (0.072 + 0.02) * UNIT, () => this.showPage("sensors"));
    this.icon(main, "Global settings", "gear", CLOSE_X - (0.072 + 0.02) * UNIT, () => this.showPage("settings"));
    this.icon(main, "Close", "close", CLOSE_X, callbacks.onClose);
    this.modeButtons = this.tabs(main, [COPY.manual, COPY.agent], 0.198 * UNIT,
      [() => callbacks.onModeButtonPressed("manual"), () => callbacks.onModeButtonPressed("agent")]);
    this.manual = global.scene.createSceneObject("ManualGuidance"); this.manual.setParent(this.bodies.get("main")!);
    this.surface(this.manual, 0, 0, CONTENT, 0.18 * UNIT);
    this.text(this.manual, COPY.manualGuidance, 0, 0, CONTENT - 5.6, 0.13 * UNIT, 23);
    this.chat = global.scene.createSceneObject("AgentConversation"); this.chat.setParent(this.bodies.get("main")!);
    this.reply = this.messageField(this.chat, COPY.agent, 0.052 * UNIT, true);
    this.draft = this.messageField(this.chat, COPY.yourMessage, -0.088 * UNIT, false);
    this.draft.window.scrollingPaused = true;
    this.draft.window.interactable.onTriggerStart.add(callbacks.onRecord);
    this.draft.window.interactable.onTriggerEnd.add(() => callbacks.onRecordEnd(false));
    this.draft.window.interactable.onTriggerCanceled.add(() => callbacks.onRecordEnd(true));
    this.send = this.button(this.chat, COPY.send, COPY.send, -(HALF + 2) / 2, -0.196 * UNIT, HALF, ACTION, callbacks.onSend, SnapOS2Styles.Primary).button;
    this.clear = this.button(this.chat, COPY.clear, COPY.clear, (HALF + 2) / 2, -0.196 * UNIT, HALF, ACTION, callbacks.onClear).button;
    this.status = this.text(this.bodies.get("main")!, "", 0, -0.251 * UNIT, CONTENT, 0.018 * UNIT, 13);
    this.stop = this.button(this.root, "EmergencyStop", COPY.stop, 0, -0.298 * UNIT, CONTENT, ACTION, () => {}, SnapOS2Styles.Special).button;
    this.stop.onTriggerDown.add(callbacks.onEmergencyStop);

    const settings = this.bodies.get("settings")!; this.pageTitle(this.pages.get("settings")!, COPY.settings, COPY.done, "main");
    this.text(settings, COPY.robot, 0, 0.16 * UNIT, CONTENT, 3, 19);
    this.realign = this.button(settings, COPY.relocalize, COPY.relocalize, -(HALF + 2) / 2, 0.09 * UNIT, HALF, ACTION, callbacks.onRealign);
    this.button(settings, COPY.setup, COPY.setup, (HALF + 2) / 2, 0.09 * UNIT, HALF, ACTION, callbacks.onRestart);
    this.text(settings, COPY.headset, 0, -0.014 * UNIT, CONTENT, 3, 19);
    this.debug = this.button(settings, "Debug", "Debug · Off", 0, -0.084 * UNIT, CONTENT, ACTION,
      () => callbacks.onDebugModeChanged(!this.debugEnabled));
    this.button(settings, COPY.diagnostics, COPY.diagnostics, 0, -0.152 * UNIT, CONTENT, ACTION, () => this.showPage("diagnostics"));
    const sound = this.button(settings, "Sound", "Sound · On", 0, -0.228 * UNIT, CONTENT, ACTION, () => {
      this.soundEnabled = !this.soundEnabled; sound.labelText.text = `Sound · ${this.soundEnabled ? "On" : "Off"}`;
      setButtonSelected(sound.button, this.soundEnabled);
      for (const button of this.buttons) button.playAudio = this.soundEnabled;
    });
    setButtonSelected(sound.button, this.soundEnabled);
    const sensors = this.bodies.get("sensors")!; this.pageTitle(this.pages.get("sensors")!, COPY.sensors, "Back from Sensors", "main");
    this.text(this.pages.get("sensors")!, "LiDAR", 0, 0.225 * UNIT, CONTENT, 3, 20, HorizontalAlignment.Center);
    this.lidarButtons = this.tabs(this.pages.get("sensors")!, ["Off", "Obstacles", "Full"], 0.17 * UNIT,
      ["off", "obstacles", "full"].map(mode => () => callbacks.onLidarMode(mode as LidarDisplayMode)));
    this.rangeLabel = this.text(sensors, "Clearance", -23, 0.08 * UNIT, 34, 3.5, 18, HorizontalAlignment.Center);
    this.text(sensors, "Point limit", -23, -0.01 * UNIT, 34, 3.5, 18, HorizontalAlignment.Center);
    this.range = this.text(sensors, "", 0.14 * UNIT, 0.08 * UNIT, 19, 4, 21, HorizontalAlignment.Center);
    this.points = this.text(sensors, "", 0.14 * UNIT, -0.01 * UNIT, 19, 4, 21, HorizontalAlignment.Center);
    for (const [y, action] of [[0.08 * UNIT, callbacks.onLidarRange], [-0.01 * UNIT, callbacks.onLidarPoints]] as const) {
      for (const direction of [-1, 1]) this.sensorControls.push(this.button(sensors,
        `Sensor${y}:${direction}`, direction < 0 ? "−" : "+", (direction < 0 ? -0.015 : 0.31) * UNIT, y, ACTION, ACTION, () => action(direction)).button);
    }
    this.sensorStatus = this.text(sensors, "", 0, -0.15 * UNIT, CONTENT, 10, 17);
    const diagnostics = this.bodies.get("diagnostics")!; this.pageTitle(this.pages.get("diagnostics")!, COPY.diagnostics, COPY.done, "settings");
    const logs = global.scene.createSceneObject("DiagnosticsBlock"); logs.setParent(diagnostics);
    this.rowNodes.push({ parent: diagnostics, node: logs, y: -3 });
    this.surface(logs, 0, 0, CONTENT, 40);
    this.diagnostics = new NativeTextField(logs, COPY.diagnostics, CONTENT - 5.6, 36, 0, panelFontSize(18));
    const alignment = this.bodies.get("alignment")!;
    this.text(this.pages.get("alignment")!, COPY.alignmentTitle, 0, HEADER, CONTENT, 6, 30, HorizontalAlignment.Center);
    this.text(alignment, COPY.alignmentGuidance, 0, 0.055 * UNIT, CONTENT - 6, 7, 22, HorizontalAlignment.Center);
    this.button(alignment, COPY.relocalize, COPY.relocalize, -(HALF + 2) / 2, -0.1 * UNIT, HALF, ACTION, callbacks.onRealign, SnapOS2Styles.Primary);
    this.button(alignment, COPY.dismiss, COPY.dismiss, (HALF + 2) / 2, -0.1 * UNIT, HALF, ACTION, callbacks.onDismissAlignment);
    this.showPage("main");
  }

  apply(snap: SpecsUISnapshot): void {
    if (snap.alignmentReview) this.showPage("alignment"); else if (this.page === "alignment") this.showPage("main");
    this.robot.labelText.text = robotBadgeText(snap.robotName, snap.robotConnectionText, snap.robotSelected, snap.activity);
    this.robot.button.inactive = !snap.robotSelectable; setButtonSelected(this.robot.button, snap.robotSelected);
    this.status.text = snap.speech?.error ?? snap.hudText;
    this.modeButtons[1].inactive = !snap.agentAvailable; this.setOperatingMode(snap.operatingMode);
    this.manual.enabled = snap.operatingMode === "manual"; this.chat.enabled = snap.operatingMode === "agent";
    const speech = snap.speech;
    this.reply.setText(speech?.response ?? "");
    this.reply.text.textFill.color = speech?.severity === "error" ? new vec4(1, 0.27, 0.23, 1) : speech?.severity === "warn" ? new vec4(1, 0.62, 0.04, 1) : COLOR_WHITE;
    this.draft.setText(speech?.prompt || (speech?.recognitionAvailable === false ? COPY.microphoneUnavailable : speech?.status === "Listening" ? "Listening…" : COPY.hold), speech?.status === "Listening");
    const busy = ["Listening", "Starting microphone…", "Transcribing…"].includes(speech?.status ?? "");
    this.draft.window.interactable.enabled = snap.agentAvailable && speech?.recognitionAvailable === true && speech.status !== "Transcribing…";
    this.send.inactive = !snap.robotSelected || !snap.agentAvailable || busy || !speech?.prompt.trim();
    this.clear.inactive = busy || !speech?.prompt;
    this.lidarButtons.forEach((button, i) => { button.inactive = !snap.lidarAvailable; setButtonSelected(button, i === ["off", "obstacles", "full"].indexOf(snap.lidarMode)); });
    this.sensorControls.forEach(button => { button.inactive = !snap.lidarAvailable || snap.lidarMode === "off"; });
    const prefs = snap.lidarPreferences;
    this.rangeLabel.text = snap.lidarMode === "obstacles" ? "Clearance" : "Range";
    this.range.text = snap.lidarMode === "off" ? "—" : `${(snap.lidarMode === "obstacles" ? prefs.obstacleRangeM : prefs.fullRangeM).toFixed(1)} m`;
    this.points.text = String(prefs.pointLimit);
    this.sensorStatus.text = sensorStatusText(snap.lidarAvailable, snap.lidarReceived, snap.cameraStatus, snap.trackingStatus, snap.surfaceCount);
    this.realign.labelText.text = snap.hasTrackingOrigin ? COPY.relocalize : COPY.localizeRobot;
    this.setDebugModeToggle(snap.debugEnabled); this.diagnostics.setText(snap.debugText);
    this.stop.inactive = !snap.estopAvailable;
  }

  tick(deltaS: number): void {
    this.heightController.tick(deltaS);
    this.stop.getSceneObject().getTransform().setLocalPosition(new vec3(0, panelFooterY(this.heightController.height), 1.5));
    this.bodies.get(this.page)!.enabled = this.heightController.height + 0.01 >= this.heightController.target;
  }
  setVisible(visible: boolean): void { this.heightController.setVisible(visible); }
  placed(): void { this.heightController.placed(); }
  showPage(page: Page): void {
    if (page !== this.page && page !== "main") this.callbacks.onRecordEnd(true);
    this.page = page; for (const [name, root] of this.pages) root.enabled = name === page;
    this.updateLayout();
  }
  setStatus(text: string, color: vec4): void { this.status.text = text; this.status.textFill.color = color; }
  setOperatingMode(mode: OperatingMode): void { this.operatingMode = mode; this.updateLayout(); this.modeButtons.forEach((b, i) => setButtonSelected(b, i === (mode === "manual" ? 0 : 1))); }
  setDebugModeToggle(enabled: boolean): void { this.debugEnabled = enabled; setButtonSelected(this.debug.button, enabled); this.debug.labelText.text = `Debug · ${enabled ? "On" : "Off"}`; }
  setLidarModeDisplay(mode: LidarDisplayMode): void { this.lidarButtons.forEach((b, i) => setButtonSelected(b, i === ["off", "obstacles", "full"].indexOf(mode))); }
  setLidarModeAvailability(available: boolean, mode: LidarDisplayMode): void { this.setLidarModeDisplay(mode); this.lidarButtons.forEach(b => { b.inactive = !available; }); }
  setEmergencyStopAvailability(available: boolean, _reason?: string | null): void { this.stop.inactive = !available; }
  setAgentModeAvailability(available: boolean): void { this.modeButtons[1].inactive = !available; }
  setFrameFollowEnabled(enabled: boolean): void { setPanelFollowing(this.panel, enabled, RUNTIME_PANEL_SCALE); }
  setFrameAllowTranslation(enabled: boolean): void { const frame = getFrameComponent(this.panel); if (frame) frame.allowTranslation = enabled; }
  applySpectaclesFrameMotion(): void { this.setFrameAllowTranslation(true); this.setFrameFollowEnabled(false); }
  applyEditorFrameMotion(): void { this.setFrameAllowTranslation(true); this.setFrameFollowEnabled(true); }

  private updateLayout(): void {
    const key = this.page === "main" ? this.operatingMode : this.page;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    const profile = RUNTIME_LAYOUTS[key], rows = profile.rows;
    const move = (node: SceneObject, y: number) => {
      const p = node.getTransform().getLocalPosition(); node.getTransform().setLocalPosition(new vec3(p.x, y, p.z));
    };
    const row = (page: Page, oldY: number, y: number) => {
      for (const entry of this.rowNodes) if (entry.parent === this.bodies.get(page) && Math.abs(entry.y - oldY) < 0.01) move(entry.node, y);
    };
    if (key === "manual") move(this.manual, rows.guidance);
    if (key === "agent") {
      move(this.messageBlocks.get(this.reply)!, rows.reply); move(this.messageBlocks.get(this.draft)!, rows.draft);
      for (const button of [this.send, this.clear]) move(button.getSceneObject(), rows.actions);
    }
    if (this.page === "main") row("main", -25.1, rows.status);
    if (key === "settings") for (const [oldY, name] of [[16, "robot"], [9, "robotActions"], [-1.4, "headset"], [-8.4, "debug"], [-15.2, "diagnostics"], [-22.8, "sound"]] as const) row("settings", oldY, rows[name]);
    if (key === "sensors") { row("sensors", 8, rows.range); row("sensors", -1, rows.points); row("sensors", -15, rows.statistics); }
    if (key === "diagnostics") row("diagnostics", -3, rows.logs);
    if (key === "alignment") { row("alignment", 5.5, rows.guidance); row("alignment", -10, rows.actions); }
    this.heightController.request(profile.height);
    this.tick(0);
  }

  private messageField(parent: SceneObject, caption: string, y: number, bodyScrollable: boolean): NativeTextField {
    const block = global.scene.createSceneObject(`${caption}Block`); block.setParent(parent); block.getTransform().setLocalPosition(new vec3(0, y, 0));
    this.surface(block, 0, 0, CONTENT, 0.12 * UNIT);
    this.text(block, caption, 0, 0.033 * UNIT, CONTENT - 5.6, 2, 15, HorizontalAlignment.Center);
    const field = new NativeTextField(block, caption, CONTENT - 5.6, 0.057 * UNIT, -0.016 * UNIT, panelFontSize(20));
    this.messageBlocks.set(field, block);
    field.window.scrollingPaused = !bodyScrollable;
    return field;
  }
  private surface(parent: SceneObject, x: number, y: number, width: number, height: number, radius = 2.4): void {
    const surface = createPanelSurface(parent, "NativeFieldSurface", width, height, new vec3(x, y, 0.5), radius);
    this.rowNodes.push({ parent, node: surface.getSceneObject(), y });
  }
  private button(parent: SceneObject, name: string, label: string, x: number, y: number, width: number, height: number, action: () => void, style: string = SnapOS2Styles.Secondary): IconButtonResult {
    const result = createIconButton(parent, name, label, width, height, new vec3(x, y, 1.5), style);
    this.rowNodes.push({ parent, node: result.sceneObject, y });
    panelButtonLayer(result); result.button.playAudio = this.soundEnabled;
    result.button.onTriggerUp.add(action); this.buttons.push(result.button); return result;
  }
  private text(parent: SceneObject, value: string, x: number, y: number, width: number, height: number, size = 19, align = HorizontalAlignment.Center): Text {
    if (align === HorizontalAlignment.Left && width >= CONTENT - 1) width -= 2;
    const text = createText({ parent, name: value || "Status", text: value, fontSize: panelFontSize(size), color: COLOR_WHITE,
      position: new vec3(x, y, 2), horizontalAlignment: align,
      worldSpaceRect: Rect.create(-width / 2, width / 2, -height / 2, height / 2) });
    this.rowNodes.push({ parent, node: text.getSceneObject(), y });
    configurePanelText(text); return text;
  }
  private tabs(parent: SceneObject, labels: string[], y: number, actions: (() => void)[]): CapsuleButton[] {
    const groupRoot = global.scene.createSceneObject("NativeTabs"); groupRoot.setParent(parent);
    this.surface(parent, 0, y, CONTENT, ACTION + 1.2, (ACTION + 1.2) / 2);
    return labels.map((label, i) => {
      const { x, width } = controlPanelTab(labels.length, i);
      const result = this.button(groupRoot, label, label, x * UNIT, y, width * UNIT, ACTION, actions[i]);
      setButtonSelected(result.button, i === 0); return result.button;
    });
  }
  private pageTitle(parent: SceneObject, title: string, closeName: string, destination: Page): void {
    this.text(parent, title, 0, HEADER, 56, 4, 28, HorizontalAlignment.Center);
    this.icon(parent, closeName, "close", CLOSE_X, () => this.showPage(destination));
  }
  private icon(parent: SceneObject, name: string, kind: "gear" | "camera" | "close", x: number, action: () => void): void {
    const button = this.button(parent, name, "", x, HEADER, 7.2, 7.2, action,
      parent === this.pages.get("main") ? SnapOS2Styles.Ghost : SnapOS2Styles.Secondary);
    button.labelText.getSceneObject().enabled = false;
    const mesh = new WorldMeshRenderer(button.sceneObject, `${name}Icon`);
    mesh.object.getTransform().setLocalPosition(new vec3(0, 0, 1));
    const positions: number[] = [], indices: number[] = [];
    const line = (x1: number, y1: number, x2: number, y2: number, width = 0.35) => {
      const d = Math.hypot(x2 - x1, y2 - y1), nx = -(y2 - y1) / d * width / 2, ny = (x2 - x1) / d * width / 2, first = positions.length / 3;
      positions.push(x1 + nx, y1 + ny, 0, x1 - nx, y1 - ny, 0, x2 + nx, y2 + ny, 0, x2 - nx, y2 - ny, 0);
      indices.push(first, first + 1, first + 2, first + 2, first + 1, first + 3);
    };
    const ring = (radius: number, width: number) => { for (let i = 0; i < 32; i++) { const a = i / 32 * Math.PI * 2, b = (i + 1) / 32 * Math.PI * 2; line(Math.cos(a) * radius, Math.sin(a) * radius, Math.cos(b) * radius, Math.sin(b) * radius, width); } };
    if (kind === "close") {
      const half = 1.3 / Math.SQRT2;
      line(-half, -half, half, half); line(-half, half, half, -half);
    } else if (kind === "gear") {
      ring(1, 0.6);
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4;
        line(Math.sin(a) * 1.1, Math.cos(a) * 1.1, Math.sin(a) * 1.7, Math.cos(a) * 1.7, 0.5); }
    } else {
      line(-1.9, -1, 1.9, -1, 0.4); line(-1.9, -1, -1.9, 1, 0.4);
      line(1.9, -1, 1.9, 1, 0.4); line(-1.9, 1, 1.9, 1, 0.4);
      line(-1.3, 1, -0.9, 1.6, 0.4); line(-0.9, 1.6, 0.4, 1.6, 0.4);
      line(0.4, 1.6, 0.8, 1, 0.4); ring(0.6, 0.3);
    }
    uiMaterialLayer(mesh.visual, 14);
    mesh.triangles(positions, indices, [1, 1, 1, 1]);
  }
}
