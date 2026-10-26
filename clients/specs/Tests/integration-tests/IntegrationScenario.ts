// Hardware inputs are deterministic fixtures. Production state owners, SIK/SUK controls and renderers run unchanged.
import { DimOSSpecsClient } from "../Scripts/DimOSSpecsClient/DimOSSpecsClient";
import { getFrameComponent } from "../Scripts/DimOSSpecsClient/presentation/UIKit";
import { RUNTIME_LAYOUTS, RUNTIME_PANEL_SCALE, SETUP_LAYOUTS } from "../Scripts/DimOSSpecsClient/presentation/PanelLayout";
import { specsToClientTrackingPoint, clientTrackingToSpecsPoint } from "../Scripts/DimOSSpecsClient/utilities/SpecsCoordinates";
import { decodeOutbound, decodeLocalizationObservations, LIDAR_FOURCC } from "../Scripts/DimOSARClient/websocket/protocol";
import { WristMenuController } from "../Scripts/DimOSSpecsClient/presentation/WristMenuController";
import { SpecsNavigationInput } from "../Scripts/DimOSSpecsClient/navigation/SpecsNavigationInput";
import { WorldMeshRenderer, circleMesh } from "../Scripts/DimOSSpecsClient/presentation/WorldMeshRenderer";
import { FLOOR_MARKER_STYLE, WORLD_DASH_STYLE } from "../Scripts/DimOSARClient/presentation/WorldVisualStyle";
import { composeLidarPoint } from "../Scripts/DimOSSpecsClient/sensors/PointCloudRenderer";
import { IntegrationInput } from "./IntegrationInput";
import { INTEGRATION_CATALOG as CATALOG } from "./IntegrationCatalog";
const CAMERA_FIXTURE = requireAsset("./CameraFixture.png") as Texture;
type Step = {
  id: string;
  durationS: number;
};
@component
export class ReviewScenario extends BaseScriptComponent {
  @input
  startDelayS = 5;
  @input
  profile = "golden";
  private root: any;
  private input: IntegrationInput | null = null;
  private steps: Step[] = [];
  private index = -1;
  private elapsed = 0;
  private activeCase = "";
  private failed = false;
  private deferred: {
    at: number;
    run: () => void;
  }[] = [];
  private clock = 0;
  private sent: any[] = [];
  private batches: any[] = [];
  private captureTs = 0;
  private captureFailure = false;
  private autoLocalize = false;
  private move: ((progress: number) => void) | null = null;
  private origin = [0, 0, 0];
  private goal = [...CATALOG.fixtures.goal];
  private recognitionText: ((text: string, final: boolean) => void) | null = null;
  private recognitionError: ((error: string) => void) | null = null;
  private recognitionEnd: (() => void) | null = null;
  private caps: any;
  private lidarState: any = { enabled: false, min_height_m: -10, max_height_m: 10, max_range_m: 5 };
  private navState: any = { state: "idle", outcome: null };
  private cameraAspect = 0;
  private worldCamera = false;
  private cameraPosition = vec3.zero();
  private cameraRotation = quat.quatIdentity();
  private tracking: DeviceTracking | null = null;
  private trackingEnabled = false;
  private wristFixture: WristMenuController | null = null;
  private wristUpdate: (() => void) | null = null;
  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.createEvent("UpdateEvent").bind(() => this.tick()));
    this.createEvent("OnDestroyEvent").bind(() => this.input?.restore());
  }
  private emit(value: Record<string, unknown>): void { print(`SPECS_REVIEW ${JSON.stringify({ ...value, unixMs: Date.now() })}`); }
  private check(name: string, passed: boolean, caseId = this.activeCase): void {
    this.failed ||= !passed;
    this.emit({ type: "result", caseId, name, passed });
  }
  /** Measure uploaded vertices after every authored transform, rather than trusting nominal radii. */
  private measuredCircleRadius(renderer: any): number {
    const dashed = renderer.draftCircle?.object.enabled === true;
    const circle = (dashed ? renderer.draftCircle : renderer.circle) as WorldMeshRenderer;
    const vertices = circle.visual.mesh!.extractVerticesForAttribute("position");
    const transform = circle.object.getTransform();
    const center = transform.getWorldPosition(), matrix = transform.getWorldTransform();
    let radius = 0;
    for (let i = 0; i < vertices.length; i += 3) {
      const point = matrix.multiplyPoint(new vec3(vertices[i], vertices[i + 1], vertices[i + 2]));
      radius = Math.max(radius, Math.hypot(point.x - center.x, point.z - center.z));
    }
    // Adaptive stroke positions store the centerline; the shader adds half its physical width.
    const scale = transform.getWorldScale();
    return radius + (dashed ? WORLD_DASH_STYLE.widthM * 50 * Math.max(Math.abs(scale.x), Math.abs(scale.z)) : 0);
  }
  private after(delay: number, run: () => void): void { this.deferred.push({ at: this.clock + delay, run }); }
  private later(delay: number, test: () => boolean, caseId = this.activeCase): void { this.after(delay, () => this.check(caseId, test(), caseId)); }
  private wire(value: unknown): void { const text = JSON.stringify(value); decodeOutbound(text); this.root.session.onTransportText(text + "\n"); }
  private state(state = this.navState.state, outcome: string | null = this.navState.outcome): void {
    this.navState = { state, outcome };
    this.wire({ type: "state", server: { connected_clients: 1 }, lidar: this.lidarState, nav: this.navState, agent: { idle: true } });
  }
  private findRoot(object: SceneObject): any {
    const root = object.getComponent(DimOSSpecsClient.getTypeName());
    if (root)
      return root;
    for (let i = 0; i < object.getChildrenCount(); i++) {
      const root = this.findRoot(object.getChild(i));
      if (root)
        return root;
    }
    return null;
  }
  private prepare(): void {
    for (let i = 0; i < global.scene.getRootObjectsCount(); i++) {
      this.root = this.findRoot(global.scene.getRootObject(i));
      if (this.root)
        break;
    }
    if (!this.root)
      throw new Error("Production composition root missing");
    const root = this.root;
    this.cameraPosition = root.cameraObject.getTransform().getWorldPosition();
    this.cameraRotation = root.cameraObject.getTransform().getWorldRotation();
    this.tracking = root.cameraObject.getComponent("Component.DeviceTracking") as DeviceTracking | null;
    this.trackingEnabled = this.tracking?.enabled ?? false;
    this.input = new IntegrationInput();
    this.input.active = false;
    const available = { available: true, reason: null };
    this.caps = { lidar: available, localization: available, estop: available, agent: available,
      navigation: { ...available, nav_goal: { ...available, preview: true }, nav_joystick: { available: false, reason: "Hand input only" } } };
    root.transport.connect = () => { };
    root.transport.close = () => { };
    root.transport.sendText = (text: string) => {
      for (const line of text.trim().split("\n")) {
        const message = JSON.parse(line);
        this.sent.push(message);
        this.command(message);
      }
    };
    root.transport.sendBinary = (data: Uint8Array) => {
      const batch = decodeLocalizationObservations(data);
      this.batches.push(batch);
      if (this.autoLocalize)
        this.after(0.1, () => this.acceptLocalization());
    };
    root.cameraSource.start = () => { };
    root.cameraSource.stop = () => { };
    root.episode.capture = {
      start: () => { }, stop: () => { }, capture: async () => {
        if (this.captureFailure)
          throw new Error("fixture camera unavailable");
        this.captureTs = Math.max(getTime(), this.captureTs + 0.001);
        return { ts_capture: this.captureTs, jpeg: new Uint8Array([255, 216, 255, 217]),
          intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240, width: 640, height: 480, distortion_model: "none", distortion: [] },
          camera_position: [0, 0, 0], camera_orientation: [0, 0, 0, 1] };
      },
    };
    root.uiPresenter.setupWizardController.deps.previewTexture = () => CAMERA_FIXTURE;
    root.uiPresenter.setupWizardController.deps.ipRelayClient.resolve = async () => null;
    root.uiPresenter.lidarDisplay.store = { read: () => null, write: () => { } };
    Object.assign(root.uiPresenter.lidarDisplay.preferences, { pointLimit: CATALOG.fixtures.pointLimit, obstacleRangeM: 0.6, fullRangeM: 5 });
    root.speechController.draft.deps.recognition = {
      start: (text: any, error: any, end: any, started: () => void) => { this.recognitionText = text; this.recognitionError = error; this.recognitionEnd = end; started(); },
      stop: () => { this.recognitionText = null; }, finish: () => this.recognitionEnd?.(),
    };
    root.speechController.draft.snapshotValue.recognitionAvailable = true;
    root.speechController.draft.deps.synthesis = { speak: (_text: string, end: () => void) => end(), stop: () => root.tts.stop() };
    const camera = root.cameraObject.getTransform(), desired = camera.getWorldPosition().add(camera.getWorldRotation().multiplyVec3(new vec3(15, -127, -300)));
    const position = specsToClientTrackingPoint([desired.x, desired.y, desired.z]);
    this.origin = position.map((v, i) => CATALOG.fixtures.pose[i] - v);
    root.navigationController.deps.deviceTracking = { worldOptions: {}, raycastWorldMesh: (from: vec3, to: vec3) => {
        const y = root.robotPresenter.floorWorldY() ?? desired.y - 33, delta = to.sub(from);
        const t = Math.abs(delta.y) > 0.0001 ? (y - from.y) / delta.y : -1;
        return t >= 0 ? [{ position: from.add(delta.uniformScale(t)), normal: vec3.up() }] : [];
      } };
    this.steps = this.profile === "golden" ? CATALOG.golden.chapters.map(row => ({ ...row })) :
      CATALOG.cases.filter(row => row.platforms.includes("specs") && row.group !== "golden").map(row => ({ id: row.id, durationS: 5 }));
    this.elapsed = 999;
  }
  private command(message: any): void {
    if (message.type === "lidar_settings_request") {
      this.lidarState = { enabled: message.enabled, min_height_m: message.min_height_m, max_height_m: message.max_height_m, max_range_m: message.max_range_m };
      this.after(0.05, () => this.state());
    }
    if (message.type === "estop_request")
      this.after(0.05, () => this.state("idle", null));
    if (message.type === "localization_start_request")
      this.after(0.1, () => this.captureRequest());
    if (message.type === "nav_goal_request") {
      this.after(0.1, () => {
        const p = message.position, q = message.orientation;
        const yaw = 2 * Math.atan2(q[2], q[3]);
        const path = [[...CATALOG.fixtures.pose.slice(0, 2), 0, 0], [(p[0] + 2) / 2, p[1] / 2, 0, yaw], [p[0], p[1], p[2], yaw]];
        this.wire({ type: "nav_goal", pose: [p[0], p[1], p[2], yaw], path_poses: path, ts: getTime(),
          ...(message.preview ? { preview: true, preview_id: message.preview_id } : {}) });
        if (!message.preview)
          this.state("following_path", null);
      });
    }
  }
  private ready(capabilities = this.caps, reconnect = false): void {
    const session = this.root.session;
    if (session.view().connection === "ready")
      return;
    if (session.wantConnected && !reconnect) session.stop();
    if (!session.wantConnected) session.start();
    session.onTransportOpen();
    const request = [...this.sent].reverse().find(row => row.type === "hello_request");
    this.wire({ type: "hello", client_id: "native-integration", odom_reference_id: "native-fixture-odom", time_sync: { ts_client: request.ts_client, ts_server: getTime() },
      robot: CATALOG.fixtures.robot, capabilities });
    this.state("idle", null);
    this.pose(CATALOG.fixtures.pose);
  }
  private pose(position: readonly number[]): void { this.wire({ type: "pose", position, orientation: [0, 0, 0, 1], ts: getTime() }); }
  private captureRequest(policy = "any_angle"): void {
    this.wire({ type: "localization_observations_request", capture_policy: policy, observation_count: 3,
      ...(policy === "robot_los_preferred" ? { wait_timeout_s: 0.2 } : {}) });
  }
  private acceptLocalization(ts = this.captureTs): void {
    this.wire({ type: "localization_result", position: this.origin, orientation: [0, 0, 0, 1], confidence: 1, ts });
  }
  private count(type: string, predicate: (row: any) => boolean = () => true): number { return this.sent.filter(row => row.type === type && predicate(row)).length; }
  private world(odom: readonly number[]): vec3 { const p = clientTrackingToSpecsPoint(odom.map((v, i) => v - this.origin[i]) as [
    number,
    number,
    number
  ]); return new vec3(...p); }
  private aim(point = this.goal): void { this.input!.active = true; this.input!.ray(this.root.cameraObject.getTransform().getWorldPosition(), this.world(point)); }
  private button(name: string): any {
    const button = this.root.uiPresenter.mainMenuView.buttons.find((value: any) => value.getSceneObject().name === name);
    if (!button)
      throw new Error(`Native button missing: ${name}`);
    return button;
  }
  private press(button: any): void { const active = this.input!.active; this.input!.active = true; this.input!.press(button); this.input!.active = active; }
  private setWorldCamera(enabled: boolean): void {
    this.worldCamera = enabled;
    if (this.tracking) this.tracking.enabled = enabled ? false : this.trackingEnabled;
    const transform = this.root.cameraObject.getTransform();
    transform.setWorldPosition(this.cameraPosition);
    transform.setWorldRotation(enabled ? this.cameraRotation.multiply(quat.angleAxis(-25 * Math.PI / 180, vec3.right())) : this.cameraRotation);
  }
  private showMenu(): void {
    this.setWorldCamera(false);
    this.root.uiPresenter.setUIState(1, { immediate: true });
    this.root.uiPresenter.mainMenuView.showPage("main");
  }
  private worldOnly(): void {
    const ui = this.root.uiPresenter;
    if (ui.uiState !== 0) {
      ui.mainMenuView.showPage("main");
      this.press(this.button("Close"));
    }
    this.setWorldCamera(true);
  }
  private runtime(): void {
    this.ready();
    this.root.clientTrackingOriginStore.restore({ position: this.origin, orientation: [0, 0, 0, 1], confidence: 1, ts: getTime() });
    if (!this.root.uiPresenter.isSetupCompleted())
      this.root.uiPresenter.finishWizard();
    this.root.uiPresenter.setupWizardController.hide();
    this.showMenu();
  }
  private startGoal(): void {
    this.aim();
    this.input!.start(null);
    this.after(0.2, () => this.input!.end());
    this.after(0.45, () => this.input!.start(null));
    this.after(0.65, () => this.input!.end());
  }
  private tick(): void {
    const delta = Math.min(0.1, Math.max(0, getDeltaTime()));
    this.clock += delta;
    this.elapsed += delta;
    if (!this.root) {
      if (this.elapsed < this.startDelayS)
        return;
      this.prepare();
    }
    if (this.worldCamera) this.setWorldCamera(true);
    const aspect = (this.root.cameraObject.getComponent("Component.Camera") as Camera).aspect;
    if (this.activeCase && Math.abs(aspect - this.cameraAspect) > 0.001) {
      this.cameraAspect = aspect;
      this.emit({ type: "host", action: "update_framing", aspect, bounds: this.captureBounds(this.activeCase) });
    }
    const pending = this.deferred.filter(row => row.at <= this.clock);
    this.deferred = this.deferred.filter(row => row.at > this.clock);
    for (const row of pending)
      try {
        row.run();
      }
      catch (error) {
        this.check("deferred-action", false);
        print(String(error));
      }
    this.move?.(Math.min(1, this.elapsed / (this.steps[this.index]?.durationS ?? 1)));
    this.wristUpdate?.();
    this.wristFixture?.tick(delta);
    this.input!.update();
    if (this.index >= 0 && this.elapsed < this.steps[this.index].durationS)
      return;
    this.move = null;
    this.elapsed = 0;
    this.index++;
    if (this.index >= this.steps.length) {
      this.setWorldCamera(false);
      this.input!.restore();
      this.emit({ type: "complete", passed: !this.failed });
      this.enabled = false;
      return;
    }
    const step = this.steps[this.index];
    this.activeCase = step.id;
    const scene = () => this.emit({
      type: "scene", id: step.id, name: step.id,
      durationS: this.profile === "golden" ? step.durationS : step.id === "navigation_failure" ? 1 : 1.2,
      captureBounds: this.captureBounds(step.id),
      cameraAspect: (this.root.cameraObject.getComponent("Component.Camera") as Camera).aspect,
      videoOnly: this.profile !== "golden" && step.id === "navigation_failure",
      screenshotOffsetS: step.id === "navigation_cancelled" ? 1.55 :
        step.id === "navigation_success" ? 0.45 : step.id === "navigation_failure" ? 0.55 : 0.8,
    });
    try {
      if (this.profile === "golden")
        this.golden(step.id);
      else
        this.regression(step.id);
    }
    catch (error) {
      this.check(step.id, false);
      print(`INTEGRATION_CASE ${step.id}: ${String(error)}`);
    }
    if (this.profile === "golden" || step.id === "navigation_failure") scene();
    else this.after(3, scene);
  }
  private golden(id: string): void {
    const root = this.root, ui = root.uiPresenter, menu = ui.mainMenuView, controller = ui.setupWizardController;
    switch (id) {
      case "setup_entry":
        this.headerMetrics();
        this.check(id, controller.isVisible() && controller.flow.step === "connect" && !controller.view.previous.sceneObject.enabled);
        break;
      case "connection_ready":
        this.ready();
        this.later(0.3, () => root.session.view().connection === "ready" && root.session.view().hello.robot.display_name === CATALOG.fixtures.robot.display_name);
        break;
      case "localization_capture":
        this.press(controller.view.next.button);
        this.later(1.5, () => controller.flow.step === "localization" && controller.view.previewRoot.enabled &&
          this.batches.length > 0 && root.episode.view().phase === "awaiting_result");
        break;
      case "localization_success":
        this.acceptLocalization();
        this.later(0.4, () => root.clientTrackingOriginStore.hasTrackingOrigin && controller.view.success.enabled && controller.view.successCheck.object.enabled);
        break;
      case "runtime_manual":
        this.showMenu();
        this.later(0.4, () => ui.isSetupCompleted() && ui.getOperatingMode() === "manual" && menu.manual.enabled &&
          Math.abs(getFrameComponent(ui.mainUIFrame)!.totalSize.y - RUNTIME_LAYOUTS.manual.height) < 0.01);
        break;
      case "panel_follow": {
        const frame = getFrameComponent(ui.mainUIFrame)!;
        const panel = ui.mainUIFrame.getTransform(), initial = panel.getWorldPosition();
        const viewer = global.scene.createSceneObject("FixtureMenuViewer");
        viewer.getTransform().setWorldPosition(root.cameraObject.getTransform().getWorldPosition());
        viewer.getTransform().setWorldRotation(root.cameraObject.getTransform().getWorldRotation());
        const forward = viewer.getTransform().getWorldRotation().multiplyVec3(new vec3(0, 0, -1));
        const length = Math.hypot(forward.x, forward.z) || 1;
        const offset = new vec3(forward.x / length * 18, 0, forward.z / length * 18);
        const centerOffset = (76 - frame.totalSize.y) * RUNTIME_PANEL_SCALE / 2;
        const wrist = initial.sub(new vec3(0, 20 + centerOffset, 0)).sub(offset);
        let facing = true, closed = false, headStayed = false;
        const hand = { isTracked: () => true, getPalmPitchAngle: () => facing ? 45 : -80,
          isFacingCamera: () => facing, wrist: { position: wrist } };
        let initialized = false;
        menu.applySpectaclesFrameMotion();
        this.wristFixture = new WristMenuController({ panel: ui.mainUIFrame, anchorRoot: ui.mainUIFrame,
          cameraObject: viewer, hands: { left: hand, right: { ...hand, isTracked: () => false } } as any,
          centerOffsetCm: () => (76 - frame.totalSize.y) * RUNTIME_PANEL_SCALE / 2,
          onBeforeShow: () => menu.applySpectaclesFrameMotion(),
          onMenuShow: () => { menu.placed(); ui.setUIState(1, { immediate: true }); },
          onMenuHide: () => { if (initialized) { closed = true; ui.setUIState(0, { immediate: true }); } },
          onPin: () => menu.setFrameFollowEnabled(false),
        });
        initialized = true;
        frame.onTranslationStart.add(() => this.wristFixture?.pin());
        let baseline = initial;
        this.after(.6, () => { baseline = panel.getWorldPosition(); viewer.getTransform().setWorldPosition(new vec3(8, 0, 0)); });
        this.after(1.2, () => { headStayed = panel.getWorldPosition().distance(baseline) < .2; });
        const x = wrist.x;
        this.move = t => { if (t > .27 && t < .53) wrist.x = x + Math.min(6, (t - .27) * 24); };
        this.after(2.6, () => { facing = false; });
        this.after(3.2, () => { facing = true; });
        this.later(4.4, () => headStayed && panel.getWorldPosition().distance(baseline) > 2 && closed &&
          this.wristFixture?.sourceHand() === "left" && !frame.following);
        this.after(4.5, () => this.emit({type:"result",caseId:id,name:"native-hand-follow-cm",passed:headStayed && panel.getWorldPosition().distance(baseline) > 2,
          movedCm:panel.getWorldPosition().distance(baseline),headOnlyTranslation:!headStayed}));
        break;
      }
      case "panel_grab": {
        const frame: any = getFrameComponent(ui.mainUIFrame), panel = ui.mainUIFrame.getTransform();
        const initial = panel.getWorldPosition(), eye = root.cameraObject.getTransform().getWorldPosition();
        const hit = panel.getWorldTransform().multiplyPoint(new vec3(44, 0, 0));
        this.input!.active = true;
        this.input!.ray(eye, hit, frame._interactable);
        this.input!.hover(frame._interactable);
        this.after(0.3, () => this.input!.start());
        this.move = t => {
          if (t < 0.07 || t > 0.8)
            return;
          const offset = new vec3(Math.min(4, t * 7), 0, 0);
          this.input!.ray(eye.add(offset), hit.add(offset), frame._interactable);
        };
        this.after(4, () => {
          this.input!.end();
          this.input!.unhover();
          this.input!.active = false;
          this.check(id, panel.getWorldPosition().distance(initial) > 2 && !frame.following && this.wristFixture?.isPinned() === true, id);
          this.wristFixture = null;
        });
        break;
      }
      case "robot_hover": {
        this.worldOnly();
        const visual = root.robotPresenter.worldVisuals;
        this.input!.active = true;
        this.input!.ray(root.cameraObject.getTransform().getWorldPosition(), root.robotPresenter.worldPosition(), visual.interactable);
        this.input!.hover(visual.interactable);
        this.later(0.6, () => !root.selection.isSelected() && visual.hovered && visual.outline.object.enabled);
        break;
      }
      case "robot_selected":
        this.press(root.robotPresenter.worldVisuals);
        this.check(id, root.selection.isSelected());
        this.input!.unhover();
        break;
      case "navigation_preview": {
        const before = this.count("nav_goal_request", row => !row.preview);
        this.aim();
        this.after(0.2, () => this.input!.start(null));
        this.later(0.8, () => root.navigationController.isAiming() && root.navigationController.previewPath()?.length >= 2 &&
          this.count("nav_goal_request", row => !row.preview) === before &&
          Math.abs(root.navigationController.draftCircleBounds().radius - FLOOR_MARKER_STYLE.radiusM * 100 * 1.15) < .01 &&
          Math.abs(this.measuredCircleRadius(root.navigationController.draftMarker.worldVisuals) - FLOOR_MARKER_STYLE.radiusM * 100 * 1.15) < .02 &&
          root.navigationController.draftMarker.worldVisuals.draftCircle.object.enabled &&
          root.navigationController.draftMarker.worldVisuals.arrow.object.enabled &&
          !root.navigationController.draftMarker.worldVisuals.circle.object.enabled);
        break;
      }
      case "navigation_drag": {
        const before = this.count("nav_goal_request", row => !row.preview);
        const start = [...this.goal];
        this.aim(start);
        this.move = t => { this.goal = [start[0] + Math.min(0.3, t * 0.5), start[1], start[2]]; this.aim(); };
        this.after(2.4, () => {
          this.input!.end();
          this.check(id, root.navigationController.ownsDraft(String(this.input!.actor.inputType)) &&
            Math.abs(root.navigationController.interaction.snapshot().draft.position[0] - (start[0] - this.origin[0])) > 0.05 &&
            this.count("nav_goal_request", row => !row.preview) === before, id);
        });
        break;
      }
      case "navigation_route": {
        const before = this.count("nav_goal_request", row => !row.preview);
        this.input!.start(root.robotPresenter.worldVisuals.interactable);
        this.after(0.3, () => this.input!.end());
        this.after(1, () => {
          this.input!.active = false;
          this.check(id, this.count("nav_goal_request", row => !row.preview) === before + 1 &&
            root.selection.isSelected() && root.navigationController.activePath()?.length >= 2 && root.navGoalPresenter.ribbon.object.enabled, id);
        });
        break;
      }
      case "robot_movement": {
        const initial = root.robotPresenter.worldPosition(), pose = CATALOG.fixtures.pose;
        this.move = t => this.pose([pose[0] + 0.6 * t, pose[1] + 0.15 * t, pose[2]]);
        this.later(3.9, () => root.robotPresenter.worldPosition().distance(initial) > 30 && root.navigationController.activePath()?.length >= 2);
        break;
      }
      case "navigation_success":
        this.state("resolved", "succeeded");
        this.later(0.42, () => root.navigationController.flash() === "succeeded" && root.navigationController.marker.worldVisuals.glyph.object.enabled);
        break;
      case "navigation_cancelled": {
        this.goal = [this.goal[0] + 0.4, this.goal[1], this.goal[2]];
        const before = this.count("estop_request");
        this.startGoal();
        this.after(1.1, () => {
          this.press(root.navigationController.marker.cancelButton);
          this.check(id, this.count("estop_request") === before + 1 && root.navigationController.flash() === "cancelled", id);
          this.input!.active = false;
        });
        break;
      }
      case "agent_recording": {
        this.input!.active = false;
        this.showMenu();
        const before = this.count("user_message_request");
        this.after(0.2, () => this.press(menu.modeButtons[1]));
        this.after(0.9, () => {
          this.input!.active = true;
          this.input!.target = menu.draft.window.interactable;
          this.input!.hover(this.input!.target!);
          this.input!.start();
          this.recognitionText?.(CATALOG.fixtures.transcript, false);
        });
        this.later(1.3, () => root.speechController.asrRunning && this.count("user_message_request") === before);
        break;
      }
      case "agent_draft": {
        const before = this.count("user_message_request");
        this.input!.end();
        this.input!.unhover();
        this.later(0.4, () => !root.speechController.asrRunning && root.speechController.snapshot().prompt === CATALOG.fixtures.transcript &&
          this.count("user_message_request") === before);
        break;
      }
      case "agent_response": {
        const before = this.count("user_message_request");
        this.press(menu.send);
        this.after(0.2, () => this.wire({ type: "agent_message", text: CATALOG.fixtures.response }));
        this.later(0.6, () => this.count("user_message_request") === before + 1 && root.speechController.snapshot().response === CATALOG.fixtures.response && menu.reply.text.text === CATALOG.fixtures.response);
        break;
      }
      case "sensors_full":
        this.press(this.button("Sensors button"));
        this.after(0.2, () => this.press(menu.lidarButtons[2]));
        this.lidar();
        this.later(0.7, () => menu.page === "sensors" && ui.getLidarMode() === "full" && root.session.view().lidar.points.length === CATALOG.fixtures.pointLimit && root.lidarPresenter.visual.enabled);
        break;
      case "sensors_obstacles": {
        this.press(menu.lidarButtons[1]);
        const before = ui.getLidarPreferences().obstacleRangeM;
        this.after(0.2, () => this.press(this.button("Sensor8:1")));
        this.later(0.6, () => ui.getLidarMode() === "obstacles" && ui.getLidarPreferences().obstacleRangeM > before && menu.rangeLabel.text === "Clearance");
        break;
      }
      case "settings":
        this.press(this.button("Back from Sensors"));
        this.after(0.2, () => this.press(this.button("Global settings")));
        this.after(0.5, () => { this.press(menu.debug.button); this.press(this.button("Sound")); });
        this.later(0.8, () => menu.page === "settings" && ui.getDebugMode() && !menu.soundEnabled && menu.debug.button.style === "Primary");
        break;
      case "diagnostics": {
        const timing = root.episode.timing.bind(root.episode);
        root.episode.timing = () => ({ ...timing(), fixtureEvents: Array.from({ length: 30 }, (_, i) => `Capture phase ${i}: recorded timing detail`).join("\n") });
        this.press(this.button("Diagnostics"));
        this.after(0.6, () => { menu.diagnostics.window.scrollPositionNormalized = new vec2(0, -1); });
        this.later(1, () => menu.page === "diagnostics" && menu.diagnostics.window.scrollDimensions.y > menu.diagnostics.window.windowSize.y && menu.diagnostics.window.scrollPositionNormalized.y < -0.9);
        break;
      }
      case "world_marker":
        this.worldOnly();
        this.wire({ type: "agent_skill", name: "ar_place_marker", args: { id: "integration-door", title: "Doorway", x: this.goal[0], y: this.goal[1], z: 0.7 } });
        this.later(0.5, () => root.annotations.size() === 1);
        break;
      case "relocalize":
        this.showMenu();
        this.autoLocalize = true;
        this.after(0.2, () => this.press(this.button("Global settings")));
        this.after(0.4, () => this.press(menu.realign.button));
        this.later(0.7, () => controller.isVisible() && controller.flow.step === "localization" && !root.clientTrackingOriginStore.hasTrackingOrigin);
        break;
      case "setup_restart": {
        const baseline = root.clientTrackingOriginStore.T_odom_client;
        this.showMenu();
        this.after(.2, () => this.press(this.button("Global settings")));
        this.after(.4, () => this.press(this.button("Setup")));
        this.after(.8, () => this.check("restart-connect-back", !ui.isSetupCompleted() && controller.isVisible() &&
          controller.flow.step === "connect" && controller.view.previous.sceneObject.enabled, id));
        this.after(2, () => this.press(controller.view.previous.button));
        this.later(2.4, () => ui.isSetupCompleted() && menu.page === "main" &&
          root.clientTrackingOriginStore.hasTrackingOrigin &&
          root.clientTrackingOriginStore.T_odom_client.position.every((v: number,i: number) => v === baseline.position[i]));
        break;
      }
      default: throw new Error(`Unimplemented golden case ${id}`);
    }
  }
  private lidar(): void {
    const count = CATALOG.fixtures.pointLimit, bytes = new Uint8Array(16 + count * 12), view = new DataView(bytes.buffer);
    view.setUint32(0, LIDAR_FOURCC, true);
    view.setFloat64(4, getTime(), true);
    view.setUint32(12, count, true);
    const robot = CATALOG.fixtures.pose;
    for (let i = 0; i < count; i++) {
      const a = i * 2.39996323, r = 0.3 + i % 47 / 47 * 1.8;
      [robot[0] + Math.cos(a) * r, robot[1] + Math.sin(a) * r, robot[2] - 0.3 + i % 17 / 17 * 1.3].forEach((v, k) => view.setFloat32(16 + i * 12 + k * 4, v, true));
    }
    this.root.session.onTransportBinary(bytes);
  }
  private captureBounds(id: string): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    const root = this.root, camera = root.cameraObject.getComponent("Component.Camera") as Camera;
    const worldCases = new Set(["robot_hover", "robot_selected", "navigation_preview", "navigation_drag", "navigation_route", "robot_movement", "navigation_success", "navigation_cancelled", "world_marker"]);
    let points: vec3[] = [];
    if (worldCases.has(id)) {
      for (const p of [CATALOG.fixtures.pose, this.goal]) {
        for (const x of [-0.5, 0.5])
          for (const y of [-0.55, 0.55])
            for (const z of [-0.1, 1])
              points.push(this.world([p[0] + x, p[1] + y, z]));
      }
    }
    else {
      const wizard = id.startsWith("setup_") || id.startsWith("connection_") || id.startsWith("localization_") || id === "relocalize";
      const view = this.root.uiPresenter;
      const panelRoot = wizard ? view.setupWizardController.view.robotBadge.sceneObject.getParent() : view.mainMenuView.root;
      const transform = panelRoot.getTransform().getWorldTransform();
      for (const x of [id === "panel_follow" ? -65 : -45, id === "panel_follow" ? 65 : id === "panel_grab" ? 57 : 45])
        for (const y of [-38, 53])
          points.push(transform.multiplyPoint(new vec3(x, y, 1)));
    }
    const screen = points.map(point => camera.worldSpaceToScreenSpace(point));
    const xs = screen.map(point => point.x), ys = screen.map(point => point.y);
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
    const padX = (right - left) * 0.075, padY = (bottom - top) * 0.075;
    const x = Math.max(0, left - padX), y = Math.max(0, top - padY);
    return { x, y, width: Math.min(1, right + padX) - x, height: Math.min(1, bottom + padY) - y };
  }
  private headerMetrics(): void {
    const rows: unknown[] = [];
    const visit = (object: SceneObject) => {
      const text = object.getComponent("Component.Text") as Text;
      if (text && ["dimOS AR", "Setup Wizard"].includes(text.text))
        rows.push({ text: text.text, position: object.getTransform().getWorldPosition().toString(), size: text.size, vertical: text.verticalAlignment, font: text.font?.name ?? "native-default", box: text.getBoundingBox().toString() });
      for (let i = 0; i < object.getChildrenCount(); i++)
        visit(object.getChild(i));
    };
    visit(this.root.uiPresenter.setupWizardPanel);
    print(`SPECS_HEADER_METRICS ${JSON.stringify(rows)}`);
  }
  private regression(id: string): void {
    const root = this.root, ui = root.uiPresenter, menu = ui.mainMenuView, controller = ui.setupWizardController;
    switch (id) {
      case "setup_navigation": {
        const backHidden = !controller.view.previous.sceneObject.enabled;
        this.press(controller.view.next.button);
        let skipped = false;
        this.after(0.5, () => { skipped = ui.isSetupCompleted() && menu.page === "main"; this.press(this.button("Global settings")); });
        this.after(0.8, () => this.press(this.button("Setup")));
        let runtimeBack = false;
        this.after(1.3, () => { runtimeBack = controller.view.previous.sceneObject.enabled; this.press(controller.view.previous.button); });
        this.later(1.6, () => backHidden && skipped && runtimeBack && ui.isSetupCompleted());
        break;
      }
      case "connection_recovery": {
        this.runtime();
        this.after(0.3, () => this.press(root.robotPresenter.worldVisuals));
        let cleared = false;
        this.after(0.6, () => { root.session.onTransportClose(); cleared = !root.selection.isSelected(); });
        this.after(1, () => this.ready(this.caps, true));
        this.later(1.5, () => cleared && root.session.view().connection === "ready" && !root.selection.isSelected());
        break;
      }
      case "capabilities_unavailable": {
        root.session.stop();
        this.ready(Object.fromEntries(Object.entries(this.caps).map(([key, value]) => [key,
          key === "navigation" ? { available: false, reason: "Fixture unavailable", nav_goal: { available: false, reason: "Fixture unavailable" }, nav_joystick: { available: false, reason: "Hand only" } } : { available: false, reason: "Fixture unavailable" }])));
        this.runtime();
        const before = this.sent.length;
        this.after(0.5, () => { this.press(menu.modeButtons[1]); this.press(menu.stop); this.press(menu.lidarButtons[2]); });
        this.later(0.9, () => ui.getOperatingMode() === "manual" && menu.modeButtons[1].inactive && menu.stop.inactive &&
          !this.sent.slice(before).some(row => ["nav_goal_request", "estop_request", "user_message_request", "lidar_settings_request"].includes(row.type)));
        break;
      }
      case "localization_providers": {
        root.session.stop();
        this.ready();
        this.input!.active = false;
        controller.start(true);
        ui.mainUIFrame.enabled = false;
        this.after(0.4, () => this.press(controller.view.next.button));
        let mixed = false, unavailable = false;
        this.after(0.7, () => { this.captureRequest("robot_los_preferred"); mixed = root.episode.view().capturePolicy === "robot_los_preferred"; });
        this.after(1, () => { this.captureFailure = true; this.captureRequest("any_angle"); });
        this.after(1.6, () => { unavailable = root.episode.view().phase === "failed" && !!root.episode.view().lastError; this.captureFailure = false; });
        this.later(2, () => mixed && unavailable && controller.view.cardBody.text.length > 0);
        break;
      }
      case "localization_rejection": {
        this.captureFailure = false;
        root.episode.reset();
        root.clientTrackingOriginStore.clear();
        controller.start(true);
        this.after(0.4, () => this.press(controller.view.next.button));
        let stale = false;
        this.after(1.8, () => { this.acceptLocalization(this.captureTs - 100); stale = !root.clientTrackingOriginStore.hasTrackingOrigin; this.captureFailure = true; this.captureRequest(); });
        this.later(2.4, () => stale && !ui.isSetupCompleted() && root.episode.view().phase === "failed" && !root.clientTrackingOriginStore.hasTrackingOrigin);
        this.after(3, () => { this.captureFailure = false; root.episode.reset(); });
        break;
      }
      case "tracking_recovery": {
        this.runtime();
        this.worldOnly();
        this.after(0.4, () => { if (!root.selection.isSelected())
          this.press(root.robotPresenter.worldVisuals); this.aim(); this.input!.start(null); });
        const before = this.count("nav_goal_request", row => !row.preview);
        let lost = false;
        this.after(0.9, () => { this.input!.active = false; this.input!.held = false; });
        this.after(1.2, () => { lost = !root.navigationController.isAiming(); this.aim(); this.input!.start(null); });
        this.after(1.5, () => this.input!.end());
        this.later(1.8, () => lost && root.navigationController.isAiming() && this.count("nav_goal_request", row => !row.preview) === before);
        this.after(2.2, () => { this.input!.active = false; this.input!.cancel(); });
        break;
      }
      case "interaction_safety": {
        this.runtime();
        const before = this.count("nav_goal_request", row => !row.preview);
        this.after(0.4, () => { this.input!.active = true; this.input!.hover(menu.robot.button.interactable); this.input!.start(); });
        this.after(0.9, () => this.input!.cancel());
        this.later(1.3, () => this.count("nav_goal_request", row => !row.preview) === before && !root.navigationController.isAiming() && !root.speechController.asrRunning);
        break;
      }
      case "navigation_failure":
        this.runtime();
        this.worldOnly();
        this.wire({ type: "nav_goal", pose: [...this.goal, 0], path_poses: CATALOG.fixtures.path, ts: getTime() });
        this.state("following_path", null);
        this.after(0.2, () => this.state("resolved", "failed"));
        this.later(0.5, () => root.navigationController.flash() === "failed" && root.navigationController.marker.worldVisuals.outcomeRing.object.enabled);
        break;
      case "emergency_stop": {
        this.runtime();
        this.after(0.4, () => {
          const before = this.count("estop_request");
          this.input!.hover(menu.stop.interactable);
          this.input!.start();
          this.check("stop_before_release", this.count("estop_request") === before + 1, id);
          this.input!.end();
          this.input!.unhover();
          this.check(id, this.count("estop_request") === before + 1, id);
        });
        break;
      }
      case "speech_lifecycle": {
        this.runtime();
        this.after(0.3, () => this.press(menu.modeButtons[1]));
        const before = this.count("user_message_request");
        this.after(0.9, () => { this.input!.active = true; this.input!.hover(menu.draft.window.interactable); this.input!.start(); this.recognitionText?.(Array.from({ length: 70 }, () => "A retained long message.").join(" "), false); });
        this.after(1.3, () => this.input!.cancel());
        this.after(1.8, () => { menu.draft.window.scrollPositionNormalized = new vec2(0, -1); });
        this.later(2.2, () => !root.speechController.asrRunning && root.speechController.snapshot().prompt.length > 500 && menu.draft.window.scrollDimensions.y > menu.draft.window.windowSize.y && menu.draft.window.scrollPositionNormalized.y < -.9 && this.count("user_message_request") === before);
        break;
      }
      case "speech_errors": {
        this.runtime();
        this.after(0.3, () => this.press(menu.modeButtons[1]));
        let visible = false, recovered = false;
        this.after(0.9, () => { this.input!.active = true; this.input!.hover(menu.draft.window.interactable); this.input!.start(); this.recognitionError?.("network"); this.input!.cancel(); });
        this.after(1.3, () => { visible = menu.status.text.includes("Speech unavailable"); this.input!.active = true; this.input!.hover(menu.draft.window.interactable); this.input!.start(); recovered = root.speechController.asrRunning; this.recognitionText?.("Recovered message", false); this.input!.end(); this.input!.unhover(); this.wire({ type: "agent_message", text: "No client pose: requested action is unavailable." }); });
        this.later(1.9, () => visible && recovered && root.speechController.snapshot().severity === "error" && menu.reply.text.text.includes("No client pose"));
        break;
      }
      case "audio_reset": {
        const generation = root.tts.generation;
        root.speechController.reset();
        this.check(id, !root.speechController.asrRunning && root.speechController.snapshot().prompt === "" && root.tts.generation > generation && !root.tts.isPlaying);
        break;
      }
      case "sensor_limits": {
        this.runtime();
        this.after(.3, () => { this.press(this.button("Sensors button")); });
        let off = false, low = false, high = false;
        this.after(.6, () => { this.press(menu.lidarButtons[0]); off = ui.getLidarMode() === "off"; this.press(menu.lidarButtons[2]); for (let i = 0; i < 24; i++)
          this.press(this.button("Sensor-1:-1")); low = ui.getLidarPreferences().pointLimit === 250; for (let i = 0; i < 24; i++)
          this.press(this.button("Sensor-1:1")); high = ui.getLidarPreferences().pointLimit === 4000; });
        this.later(1.5, () => off && low && high && ui.getLidarPreferences().fullRangeM <= 10);
        break;
      }
      case "viewport_aspect": {
        this.runtime();
        this.press(this.button("Global settings"));
        const frame = getFrameComponent(ui.mainUIFrame)!;
        frame.setFollowing(false);
        const width = frame.totalSize.x;
        const controlWidth = menu.debug.button.size.x;
        const debugBefore = ui.getDebugMode();
        this.after(0.4, () => this.emit({ type: "host", action: "resize_viewport", variant: "wide", width: 1280, height: 923 }));
        this.after(1.6, () => this.emit({ type: "host", action: "resize_viewport", variant: "portrait", width: 1024, height: 923 }));
        this.after(2.8, () => this.press(menu.debug.button));
        const worldWidth = width * ui.mainUIFrame.getTransform().getWorldScale().x;
        this.later(3.2, () => {
          const camera = root.cameraObject.getComponent("Component.Camera") as Camera;
          const transform = ui.mainUIFrame.getTransform().getWorldTransform();
          const points = [-45, 45].flatMap(x => [-frame.totalSize.y / 2, frame.totalSize.y / 2].map(y =>
            camera.worldSpaceToScreenSpace(transform.multiplyPoint(new vec3(x, y, 0)))));
          return Math.abs(frame.totalSize.x - width) < 0.01 &&
            Math.abs(frame.totalSize.x * ui.mainUIFrame.getTransform().getWorldScale().x - worldWidth) < 0.01 &&
            menu.debug.button.size.x === controlWidth &&
            points.every(point => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1) &&
            ui.getDebugMode() !== debugBefore;
        });
        break;
      }
      case "pin_ip_switch": {
        controller.start(true);
        ui.mainUIFrame.enabled = false;
        let ip = false;
        this.after(.4, () => { this.press(controller.view.connectionToggle.button); ip = controller._connectionMethod === "ip" && controller.view.input.placeholderText.includes("IP"); });
        this.after(.8, () => this.press(controller.view.connectionToggle.button));
        this.later(1.2, () => {
          const mode = controller.view.connectionToggle;
          const field = controller.view.input;
          return ip && controller._connectionMethod === "pin" && field.placeholderText.includes("PIN") &&
            mode.button.style === "Ghost" && mode.button.visual.cornerRadius === 0 &&
            Math.abs(field.getSceneObject().getTransform().getLocalPosition().x + field.getSize().x / 2 -
              (mode.sceneObject.getTransform().getLocalPosition().x - mode.button.size.x / 2)) < 0.01 &&
            !controller.view.retry.sceneObject.enabled;
        });
        break;
      }
      case "pin_error": {
        // The platform keyboard callback exercises TextInputField's own public
        // return event and its production submit subscription.
        const keyboard = controller.view.input.keyboardOptions;
        keyboard.onTextChanged("12");
        keyboard.onReturnKeyPressed();
        let invalid = false;
        this.after(.3, () => { invalid = controller.view.cardTitle.text.includes("6-digit PIN"); keyboard.onTextChanged("123456"); keyboard.onReturnKeyPressed(); });
        this.later(.9, () => invalid && controller.view.cardTitle.text.includes("did not resolve"));
        break;
      }
      case "compact_frames": {
        controller.invalidatePending();
        const tick = controller.tick.bind(controller);
        controller.tick = () => { };
        const frame = getFrameComponent(ui.setupWizardPanel)!;
        frame.setFollowing(false);
        const top = () => { const t = ui.setupWizardPanel.getTransform(); return t.getWorldPosition().add(t.getWorldRotation().multiplyVec3(new vec3(0, frame.totalSize.y * t.getWorldScale().y / 2, 0))); };
        const anchor = top();
        let valid = true;
        const measure = (key: keyof typeof SETUP_LAYOUTS) => { valid &&= Math.abs(frame.totalSize.x - 90) < .01 && Math.abs(frame.totalSize.y - SETUP_LAYOUTS[key].height) < .01 && top().distance(anchor) < .05; };
        controller.view.setConnectionState({ phase: "error", text: "Fixture error", color: new vec4(1, .3, .3, 1) });
        this.after(.5, () => { controller.view.tick(.5); measure("error"); controller.view.setConnectionState({ phase: "connected", text: "Connected", details: "Ready to localize", color: vec4.one() }); });
        this.after(1, () => { controller.view.tick(.5); measure("connected"); controller.view.setCaptureLayout(false); controller.view.applyStepLayout(2); });
        this.after(1.5, () => { controller.view.tick(.5); measure("message"); controller.view.celebrate(1, "Robot"); });
        this.after(2, () => { controller.view.tick(.5); measure("success"); this.check(id, valid, id); controller.tick = tick; });
        break;
      }
      case "native_audio_reset": {
        const audio = root.textToSpeechAudio, owner = audio.getSceneObject(), enabled = audio.enabled, ownerEnabled = owner.enabled;
        let safe = true;
        try {
          audio.enabled = false;
          root.tts.stop();
          safe &&= !root.tts.isPlaying;
          audio.enabled = true;
          owner.enabled = false;
          root.tts.stop();
          safe &&= !root.tts.isPlaying;
          owner.enabled = true;
          root.tts.stop();
          safe &&= !root.tts.isPlaying;
        }
        finally {
          audio.enabled = enabled;
          owner.enabled = ownerEnabled;
        }
        this.check(id, safe);
        break;
      }
      default: throw new Error(`Unimplemented regression case ${id}`);
    }
  }
}
