import type { RoundedRectangleVisual } from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangleVisual";
import { PanelHeightController } from "./PanelHeightController";
import { SETUP_PANEL_SCALE, SETUP_LAYOUTS, panelFooterY, type PanelProfile } from "./PanelLayout";
import type { RoundedRectangle } from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle";
import { SETUP_SUCCESS_STYLE, NAVIGATION_COLORS } from "../../DimOSARClient/presentation/WorldVisualStyle";
import { WorldMeshRenderer, circleMesh, strokeMesh2D } from "./WorldMeshRenderer";
import type { TextInputField } from "SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField";
import { CONTROL_PANEL_COPY as COPY, CONTROL_PANEL_LAYOUT, controlPanelTab, robotBadgeText } from "../../DimOSARClient/presentation/ControlPanelPresentation";
import { createRoundedSurface, createPanelSurface, createText, createIconButton, createTextInput, getFrameComponent, COLOR_WHITE,
  configureControlPanelFrame, configurePanelText, SnapOS2Styles, setButtonStyle, panelButtonLayer, panelFontSize, uiMaterialLayer, setButtonEnabled, setButtonSelected, type IconButtonResult } from "./UIKit";

export interface ConnectionPresentation { text: string; color: vec4; phase: "entry" | "error" | "connected"; details?: string; }
export enum SetupWizardStep { Connect = 1, Localization = 2 }
export interface SetupWizardFooterState { footerNextLabel: string; footerNextEnabled: boolean; footerShowPrev: boolean; }
interface Handlers { onNext: () => void; onPrevious: () => void; onInputSubmit: () => void; onConnectionToggle: () => void; onRetry?: () => void; onInputEdit?: () => void; }
const UNIT = 100;
const CONTENT = (CONTROL_PANEL_LAYOUT.width - CONTROL_PANEL_LAYOUT.margin * 2) * UNIT;

/** Native setup panel: PIN/IP connection, then camera localization. */
export class SetupWizardView {
  private readonly heightController: PanelHeightController;
  private profile: PanelProfile = SETUP_LAYOUTS.entry;
  private captureLayout = true;
  private footerThree: boolean | null = null;
  private hasPreview = false;
  private readonly successTitle: Text;
  private readonly robotBadge: IconButtonResult;
  private readonly body: SceneObject;
  private readonly success: SceneObject;
  private readonly description: Text;
  private readonly cardTitle: Text;
  private readonly cardBody: Text;
  private readonly inputAnchor: SceneObject;
  private readonly input: TextInputField;
  private readonly connectionToggle: IconButtonResult;
  private readonly next: IconButtonResult;
  private readonly previous: IconButtonResult;
  private readonly retry: IconButtonResult;
  private readonly steps: IconButtonResult[];
  private readonly successDetail: Text;
  private readonly successRing: WorldMeshRenderer;
  private readonly successCheck: WorldMeshRenderer;
  private readonly previewRoot: SceneObject;
  private readonly preview: RoundedRectangle;
  private readonly previewLabel: Text;
  private readonly guide: WorldMeshRenderer;
  private handlers: Handlers | null = null;
  private step = SetupWizardStep.Connect;
  private provider = "Waiting for localization…";

  constructor(private readonly _panel: SceneObject) {
    const frame = getFrameComponent(_panel);
    if (frame) frame.autoShowHide = false;
    frame?.initialize();
    const parent = frame?.content ?? _panel;
    for (let i = 0; i < parent.getChildrenCount(); i++) parent.getChild(i).enabled = false;
    if (frame?.content) {
      configureControlPanelFrame(frame);
      frame.showCloseButton = false;
      const existingFollowButton = frame.followButton;
      frame.showFollowButton = true;
      // Frame binds its follow callback only during initialization, when present.
      if (!existingFollowButton) frame.followButton.onTriggerUp.add(() => frame.setFollowing(!frame.following));
      frame.setUseFollow(false); frame.setFollowing(false);
    }
    const root = global.scene.createSceneObject("NativeSetupUI"); root.setParent(parent);
    this.heightController = new PanelHeightController(frame, root, SETUP_PANEL_SCALE);
    this.robotBadge = createIconButton(root, "Robot selection button", "Robot\nDisconnected", 58, 10.5, new vec3(0, 46.5, 1.5));
    this.robotBadge.button.inactive = true; panelButtonLayer(this.robotBadge, true);
    this.body = global.scene.createSceneObject("SetupBody"); this.body.setParent(root);
    this.success = global.scene.createSceneObject("SetupSuccess"); this.success.setParent(root); this.success.enabled = false;
    this.header(this.body);
    createPanelSurface(this.body, "Segmented control track", CONTENT, 7.6, new vec3(0, 20.3, 0.5), 3.8);
    const groupRoot = global.scene.createSceneObject("SetupSteps"); groupRoot.setParent(this.body);
    this.steps = [
      this.button(groupRoot, COPY.connect, controlPanelTab(2, 0).x * UNIT, 20.3, controlPanelTab(2, 0).width * UNIT, () => { if (this.step === SetupWizardStep.Localization) this.handlers?.onPrevious(); }),
      this.button(groupRoot, COPY.localization, controlPanelTab(2, 1).x * UNIT, 20.3, controlPanelTab(2, 1).width * UNIT, () => { if (this.step === SetupWizardStep.Connect) this.handlers?.onNext(); }),
    ];
    this.steps.forEach((button, i) => setButtonSelected(button.button, i === 0));
    this.description = this.text(this.body, "", 0, 1, CONTENT, 6, 20);
    this.cardTitle = this.text(this.body, "Connecting", 0, 10, CONTENT, 4, 23);
    this.cardBody = this.text(this.body, "Waiting for the launcher.", 0, -8, CONTENT, 4, 18);
    this.inputAnchor = global.scene.createSceneObject("ConnectionEntry"); this.inputAnchor.setParent(this.body);
    this.inputAnchor.getTransform().setLocalPosition(new vec3(0, -17.5, 2));
    this.input = createTextInput(this.inputAnchor, "IpInputField", 60, 6.4, new vec3(-10, 0, 0), panelFontSize(20), HorizontalAlignment.Center);
    this.connectionToggle = this.button(this.inputAnchor, "Mode: PIN", 30, 0, 20, () => this.handlers?.onConnectionToggle());
    setButtonStyle(this.connectionToggle.button, SnapOS2Styles.Ghost);
    (this.connectionToggle.button.visual as RoundedRectangleVisual).cornerRadius = 0;
    this.previous = this.button(this.body, COPY.back, -(CONTENT + 2) / 3, -29.8, (CONTENT - 4) / 3, () => this.handlers?.onPrevious());
    this.retry = this.button(this.body, COPY.tryAgain, 0, -29.8, (CONTENT - 4) / 3, () => this.handlers?.onRetry?.());
    this.next = this.button(this.body, COPY.continue, (CONTENT + 2) / 3, -29.8, (CONTENT - 4) / 3, () => this.handlers?.onNext());
    this.preview = createRoundedSurface(this.body, "LocalizationCameraPreview", 34, 22, new vec3(-22.5, -5.5, 2), COLOR_WHITE, 0, 11);
    this.previewRoot = this.preview.getSceneObject(); this.previewRoot.enabled = false;
    this.guide = new WorldMeshRenderer(this.previewRoot, "AprilTag size guide");
    this.guide.object.getTransform().setLocalPosition(new vec3(0, 0, 0.2));
    const positions: number[] = [], indices: number[] = [];
    for (let side = 0; side < 4; side++) {
      const angle = side * Math.PI / 2, next = (side + 1) * Math.PI / 2, start = positions.length / 3;
      for (const [r, a] of [[1.4, angle], [1.4, next], [1.35, angle], [1.35, next]]) positions.push(Math.cos(a + Math.PI / 4) * r * Math.SQRT2, Math.sin(a + Math.PI / 4) * r * Math.SQRT2, 0);
      indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
    }
    this.guide.triangles(positions, indices, [1, 1, 1, 0.85]); this.guide.hide();
    this.previewLabel = this.text(this.body, "Starting camera…", -22.5, -17.8, 34, 2.2, 14, HorizontalAlignment.Center);
    this.header(this.success);
    this.successRing = new WorldMeshRenderer(this.success, "Localization success ring");
    this.successCheck = new WorldMeshRenderer(this.success, "Localization success check");
    for (const mesh of [this.successRing, this.successCheck]) {
      mesh.object.getTransform().setLocalPosition(new vec3(0, 0, 2));
      uiMaterialLayer(mesh.visual, 14);
    }
    this.successTitle = this.text(this.success, COPY.localizationComplete, 0, -8, CONTENT, 5, 32, HorizontalAlignment.Center);
    this.successDetail = this.text(this.success, "", 0, -14.5, CONTENT, 4, 20, HorizontalAlignment.Center);
    this.input.renderOrder = 12;
    uiMaterialLayer(this.guide.visual, 14);
    this.input.onReturnKeyPressed.add(() => this.handlers?.onInputSubmit());
    this.input.onEditMode.add((editing: boolean) => { if (editing) this.handlers?.onInputEdit?.(); });
    this.input.onKeyboardStateChanged.add((open: boolean) => { if (!open) this.handlers?.onInputSubmit(); });
    this.applyStepLayout(SetupWizardStep.Connect);
  }

  bindHandlers(onNext: () => void, onPrevious: () => void, onInputSubmit: () => void, onConnectionToggle: () => void, onRetry?: () => void, onInputEdit?: () => void): void {
    this.handlers = { onNext, onPrevious, onInputSubmit, onConnectionToggle, onRetry, onInputEdit };
  }
  get panel(): SceneObject { return this._panel; }
  setStepContent(_title: string, description: string, color?: vec4): void {
    this.body.enabled = true; this.success.enabled = false;
    this.description.text = description; this.description.textFill.color = color ?? COLOR_WHITE;
  }
  setInputEnabled(enabled: boolean): void { this.input.getSceneObject().enabled = enabled; this.input.enabled = enabled; }
  setConnectionToggleVisible(visible: boolean): void { this.connectionToggle.sceneObject.enabled = visible; }
  setConnectionToggleLabel(label: string): void { this.connectionToggle.labelText.text = label; }
  initializeInput(text: string, placeholder: string): void { this.input.initialize(); this.input.placeholderText = placeholder; this.input.text = text; }
  getInputText(): string { return this.input.text.trim(); }
  clearInput(): void { this.input.text = ""; }
  setConnectionState(state: ConnectionPresentation): void {
    if (this.step !== SetupWizardStep.Connect) return;
    this.cardTitle.text = state.text;
    this.cardTitle.textFill.color = state.color;
    this.cardBody.text = state.details ?? "";
    this.profile = SETUP_LAYOUTS[state.phase];
    this.layout();
  }
  setStatus(text: string, color: vec4): void {
    this.cardTitle.text = text; this.cardTitle.textFill.color = color;
  }
  setCaptureLayout(capture: boolean): void {
    this.captureLayout = capture;
    if (this.step === SetupWizardStep.Localization) {
      this.profile = capture ? SETUP_LAYOUTS.capture : SETUP_LAYOUTS.message;
      this.layout();
    }
  }
  setVisible(visible: boolean): void { this.heightController.setVisible(visible); }
  placed(): void { this.heightController.placed(); }
  tick(deltaS: number): void {
    this.heightController.tick(deltaS);
    // Newly packed content becomes visible once the growing border can contain it.
    const fits = this.heightController.height + 0.01 >= this.heightController.target;
    const connect = this.step === SetupWizardStep.Connect;
    this.description.getSceneObject().enabled = fits;
    this.cardTitle.getSceneObject().enabled = fits;
    this.cardBody.getSceneObject().enabled = fits && (!connect || this.profile.rows.details !== undefined);
    this.inputAnchor.enabled = fits && connect;
    this.previewRoot.enabled = fits && !connect && this.captureLayout && this.hasPreview;
    this.previewLabel.getSceneObject().enabled = fits && !connect && this.captureLayout;
    for (const button of [this.previous, this.retry, this.next]) {
      const t = button.sceneObject.getTransform(), p = t.getLocalPosition();
      t.setLocalPosition(new vec3(p.x, panelFooterY(this.heightController.height), p.z));
    }
  }
  private layout(): void {
    const r = this.profile.rows;
    const move = (node: SceneObject, y: number, x = 0) => node.getTransform().setLocalPosition(new vec3(x, y, 2));
    const rect = (text: Text, width: number, height: number) => { text.worldSpaceRect = Rect.create(-width / 2, width / 2, -height / 2, height / 2); };
    if (this.step === SetupWizardStep.Connect) {
      move(this.description.getSceneObject(), r.intro);
      move(this.cardTitle.getSceneObject(), r.status);
      rect(this.cardTitle, CONTENT, this.profile === SETUP_LAYOUTS.error ? 6.5 : 4);
      move(this.inputAnchor, r.entry);
      this.cardBody.getSceneObject().enabled = r.details !== undefined;
      if (r.details !== undefined) { move(this.cardBody.getSceneObject(), r.details); rect(this.cardBody, CONTENT, 11.5); }
    } else {
      move(this.description.getSceneObject(), r.provider);
      const capture = this.captureLayout;
      move(this.cardTitle.getSceneObject(), capture ? r.camera + 6 : r.status, capture ? 19 : 0);
      move(this.cardBody.getSceneObject(), capture ? r.camera - 2.5 : r.details, capture ? 19 : 0);
      rect(this.cardTitle, capture ? 39 : CONTENT, 4);
      rect(this.cardBody, capture ? 36 : CONTENT, capture ? 11.5 : 10);
      this.cardBody.getSceneObject().enabled = true;
      if (capture) { move(this.previewRoot, r.camera, -22.5); move(this.previewLabel.getSceneObject(), r.previewLabel, -22.5); }
      else this.previewRoot.enabled = false;
      this.previewLabel.getSceneObject().enabled = capture;
    }
    this.heightController.request(this.profile.height);
    this.tick(0);
  }
  applyStepLayout(step: SetupWizardStep): void {
    this.step = step; const aligning = step === SetupWizardStep.Localization;
    this.body.enabled = true; this.success.enabled = false;
    this.inputAnchor.enabled = !aligning; this.previewRoot.enabled = false; this.previewLabel.getSceneObject().enabled = aligning;
    this.steps.forEach((button, i) => setButtonSelected(button.button, i === (aligning ? 1 : 0)));
    this.description.getSceneObject().enabled = true;
    this.description.getSceneObject().getTransform().setLocalPosition(new vec3(0, aligning ? 13.5 : 1, 2));
    this.cardTitle.getSceneObject().getTransform().setLocalPosition(new vec3(aligning ? 19 : 0, aligning ? 2.2 : 10, 2));
    this.cardTitle.worldSpaceRect = Rect.create(aligning ? -19.5 : -39, aligning ? 19.5 : 39, -2, 2);
    this.cardBody.getSceneObject().getTransform().setLocalPosition(new vec3(aligning ? 19 : 0, aligning ? -6.5 : -8, 2));
    this.cardBody.worldSpaceRect = Rect.create(aligning ? -18 : -39, aligning ? 18 : 39, aligning ? -5.75 : -2, aligning ? 5.75 : 2);
    this.retry.sceneObject.enabled = false;
    this.layoutFooter();
    if (aligning) this.description.text = this.provider;
    this.profile = aligning ? (this.captureLayout ? SETUP_LAYOUTS.capture : SETUP_LAYOUTS.message) : SETUP_LAYOUTS.entry;
    this.layout();
  }
  setRobotBadge(name: string, connection: string, activity: string): void { this.robotBadge.labelText.text = robotBadgeText(name, connection, false, activity); }
  setMarkerGuide(visible: boolean): void { this.guide.object.enabled = visible; }
  setLocalizationGuidance(text: string): void { this.cardBody.text = text; }
  setLocalizationProvider(text: string): void { this.provider = text; if (this.step === SetupWizardStep.Localization) this.description.text = text; }
  setRetryVisible(visible: boolean): void {
    const enabled = this.step === SetupWizardStep.Localization && visible;
    if (this.retry.sceneObject.enabled === enabled) return;
    this.retry.sceneObject.enabled = enabled;
    this.layoutFooter();
  }
  private layoutFooter(): void {
    const three = this.retry.sceneObject.enabled;
    if (three === this.footerThree) return;
    this.footerThree = three;
    const count = three ? 3 : 2, width = (CONTENT - (count - 1) * 2) / count;
    const controls = three ? [this.previous, this.retry, this.next] : [this.previous, this.next];
    controls.forEach((control, index) => {
      control.button.size = new vec3(width, 6.4, 0.5);
      const transform = control.sceneObject.getTransform(), p = transform.getLocalPosition();
      transform.setLocalPosition(new vec3((index - (count - 1) / 2) * (width + 2), p.y, p.z));
    });
  }
  setCameraPreview(texture: Texture | null): void {
    this.hasPreview = texture !== null;
    this.tick(0);
    if (!texture) { this.previewLabel.text = "Starting camera…"; return; }
    this.preview.texture = texture; this.preview.useTexture = true;
    const aspect = texture.getWidth() / Math.max(1, texture.getHeight());
    this.preview.size = new vec2(Math.min(34, 22 * aspect), Math.min(22, 34 / aspect));
    this.previewLabel.text = "Live";
  }
  celebrate(progress: number, robotName = "Robot"): void {
    this.body.enabled = false; this.success.enabled = true;
    this.heightController.request(SETUP_LAYOUTS.success.height);
    const rows = SETUP_LAYOUTS.success.rows;
    for (const mesh of [this.successRing, this.successCheck]) mesh.object.getTransform().setLocalPosition(new vec3(0, rows.glyph - 6, 2));
    this.successTitle.getSceneObject().getTransform().setLocalPosition(new vec3(0, rows.title, 2));
    this.successDetail.getSceneObject().getTransform().setLocalPosition(new vec3(0, rows.detail, 2));
    this.successDetail.text = `${robotName} is ready`;
    const style = SETUP_SUCCESS_STYLE;
    const ring = circleMesh(style.radiusM * 100, style.strokeM * 100, progress, style.segments);
    const ringXY = ring.positions.flatMap((_, i, points) => i % 3 === 0 ? [points[i], points[i + 2] + style.centerYM * 100, 0] : []);
    const color: [number, number, number, number] = [...NAVIGATION_COLORS.succeeded, 1];
    this.successRing.triangles(ringXY, ring.indices, color);
    const points = style.check;
    const strokes = strokeMesh2D([[...points[0], ...points[1]].map(v => v * 100),
      [...points[1], ...points[2]].map(v => v * 100)],
      [0, 1].map(i => (progress - 0.25) / 0.75 * 2 - i), style.glyphWidthM * 100);
    this.successCheck.triangles(strokes.positions, strokes.indices, color);
  }
  applyFooterState(step: SetupWizardStep, state: SetupWizardFooterState): void {
    setButtonSelected(this.next.button, state.footerNextLabel === COPY.continue);
    setButtonEnabled(this.next.button, state.footerNextEnabled); this.next.labelText.text = state.footerNextLabel;
    this.previous.sceneObject.enabled = state.footerShowPrev;
    this.steps[0].labelText.text = step === SetupWizardStep.Localization || state.footerNextLabel === COPY.continue ? COPY.connected : COPY.connect;
    this.steps[1].button.inactive = step === SetupWizardStep.Connect && state.footerNextLabel !== COPY.continue;
  }
  private header(parent: SceneObject): void {
    this.text(parent, COPY.appName, -18, CONTROL_PANEL_LAYOUT.titleY * UNIT, 44, 4, 28, HorizontalAlignment.Left);
    this.text(parent, COPY.setupTitle, 0, CONTROL_PANEL_LAYOUT.titleY * UNIT, 36, 4, 28, HorizontalAlignment.Center);
  }
  private text(parent: SceneObject, value: string, x: number, y: number, width: number, height: number, size: number, align = HorizontalAlignment.Center): Text {
    if (align === HorizontalAlignment.Left && width >= CONTENT - 1) width -= 2;
    const text = createText({ parent, name: value || "SetupText", text: value, fontSize: panelFontSize(size), color: COLOR_WHITE,
      position: new vec3(x, y, 2), horizontalAlignment: align,
      worldSpaceRect: Rect.create(-width / 2, width / 2, -height / 2, height / 2) });
    configurePanelText(text); return text;
  }
  private button(parent: SceneObject, label: string, x: number, y: number, width: number, action: () => void): IconButtonResult {
    const result = createIconButton(parent, label, label, width, 6.4, new vec3(x, y, 1.5));
    panelButtonLayer(result); result.button.onTriggerUp.add(action); return result;
  }
}
