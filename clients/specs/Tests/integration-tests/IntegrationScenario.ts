import { integrationTestsEnabled } from "../Scripts/Integration Test Harness";
import { runGoldenCase } from "./IntegrationGoldenCases";
import { runRegressionCase } from "./IntegrationRegressionCases";
// Hardware inputs are deterministic fixtures. Production state owners, SIK/SUK controls and renderers run unchanged.
import { WORLD_DASH_STYLE } from "DimOSARClient.lspkg/Scripts/DimOSARClient/presentation/WorldPresentation";
import { decodeLocalizationObservations,LIDAR_FOURCC } from "DimOSARClient.lspkg/Scripts/DimOSARClient/websocket/protocol";
import { emitReviewEvent, findProductionRoot } from "./IntegrationHost";
import { WorldMeshRenderer } from "../Scripts/DimOSSpecsClient/presentation/WorldMeshRenderer";
import { WristMenuController } from "../Scripts/DimOSSpecsClient/presentation/WristMenuController";
import { clientTrackingToSpecsPoint,specsToClientTrackingPoint } from "../Scripts/DimOSSpecsClient/utilities/SpecsCoordinates";
import { IntegrationArmGolden } from "./IntegrationArmGolden";
import { INTEGRATION_CATALOG as CATALOG } from "./IntegrationCatalog";
import { IntegrationInput } from "./IntegrationInput";
import { IntegrationV2Fixture, installFixtureCamera } from "./IntegrationV2Fixture";
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
  root: any;
  peer!: IntegrationV2Fixture;
  input: IntegrationInput | null = null;
  private restoreCamera: (() => void) | null = null;
  private lidarPreferencesConfigured = false;
  steps: Step[] = [];
  index = -1;
  elapsed = 0;
  armGolden: IntegrationArmGolden | null = null;
  activeCase = "";
  failed = false;
  deferred: {
    at: number;
    run: () => void;
  }[] = [];
  clock = 0;
  sent: any[] = [];
  batches: any[] = [];
  captureTs = 0;
  captureFailure = false;
  autoLocalize = false;
  move: ((progress: number) => void) | null = null;
  origin = [0, 0, 0];
  goal = [...CATALOG.fixtures.goal];
  recognitionText: ((text: string, final: boolean) => void) | null = null;
  recognitionError: ((error: string) => void) | null = null;
  recognitionEnd: (() => void) | null = null;
  caps: any;
  lidarState: any = { enabled: false, min_height_m: -10, max_height_m: 10, max_range_m: 5 };
  navState: any = { state: "idle", outcome: null };
  cameraAspect = 0;
  worldCamera = false;
  cameraPosition = vec3.zero();
  cameraRotation = quat.quatIdentity();
  tracking: DeviceTracking | null = null;
  trackingEnabled = false;
  wristFixture: WristMenuController | null = null;
  wristUpdate: (() => void) | null = null;
  onAwake(): void {
    if (!integrationTestsEnabled(this.getSceneObject())) return;
    this.createEvent("OnStartEvent").bind(() => this.createEvent("UpdateEvent").bind(() => this.tick()));
    this.createEvent("OnDestroyEvent").bind(() => {
      this.input?.restore();
      this.restoreCamera?.();
      this.restoreCamera = null;
    });
  }
  emit(value: Record<string, unknown>): void { emitReviewEvent(value); }
  check(name: string, passed: boolean, caseId = this.activeCase): void {
    this.failed ||= !passed;
    this.emit({ type: "result", caseId, name, passed });
  }
  /** Measure uploaded vertices after every authored transform, rather than trusting nominal radii. */
  measuredCircleRadius(renderer: any): number {
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
  after(delay: number, run: () => void): void { this.deferred.push({ at: this.clock + delay, run }); }
  later(delay: number, test: () => boolean, caseId = this.activeCase): void { this.after(delay, () => this.check(caseId, test(), caseId)); }
  wire(value: Record<string, unknown>): void { this.peer.send(value); }
  state(state = this.navState.state, outcome: string | null = this.navState.outcome): void {
    this.navState = { state, outcome };
    this.wire({ type: "state", server: { connected_clients: 1 }, lidar: this.lidarState, nav: this.navState, agent: { idle: true } });
    if (state === "resolved") this.peer.clearGoal();
  }
  prepare(): void {
    this.root = findProductionRoot();
    if (!this.root)
      throw new Error("Production composition root missing");
    const root = this.root;
    // Fixture PIN/IP submissions must neither inherit nor overwrite device preferences.
    const storedHosts = new Map<string, string>();
    const hostStore = root.uiPresenter.setupWizardController.deps.hostStore;
    hostStore.getString = (key: string) => storedHosts.get(key) ?? "";
    hostStore.putString = (key: string, value: string) => { storedHosts.set(key, value); };
    root.uiPresenter.setupWizardController.invalidatePending();
    root.session.stop();
    this.peer = new IntegrationV2Fixture(value => root.session.onTransportText(JSON.stringify(value) + "\n"), "native-integration", () => getTime());
    this.peer.onUpload = data => {
      this.batches.push(decodeLocalizationObservations(data));
      if (this.autoLocalize) this.after(0.1, () => this.acceptLocalization());
    };
    this.peer.onGoal = target => this.navigationGoal(target, false);
    this.cameraPosition = root.cameraObject.getTransform().getWorldPosition();
    this.cameraRotation = root.cameraObject.getTransform().getWorldRotation();
    this.tracking = root.cameraObject.getComponent("Component.DeviceTracking") as DeviceTracking | null;
    this.trackingEnabled = this.tracking?.enabled ?? false;
    this.input = new IntegrationInput();
    this.input.active = false;
    const available = { available: true, reason: null };
    this.caps = {
      manipulation: { available: false, reason: "No arm" },
      object_detection: { available: false, reason: "No detector" },
      lidar: available, localization: available, estop: available, agent: available,
      navigation: { ...available, nav_goal: { ...available, preview: true }, nav_joystick: { available: false, reason: "Hand input only" } } };
    root.transport.connect = () => { };
    root.transport.close = () => { };
    root.transport.createSibling = () => this.peer;
    root.transport.sendText = (text: string) => {
      for (const line of text.trim().split("\n")) {
        const message = JSON.parse(line);
        this.sent.push(message);
        this.command(message);
      }
    };
    root.transport.sendBinary = () => { throw new Error("v2 control channel cannot carry binary data"); };
    this.restoreCamera = installFixtureCamera(root.cameraSource, async (canEncode = () => true) => {
      if (!canEncode()) throw new Error("Fixture camera capture no longer eligible");
      if (this.captureFailure) throw new Error("fixture camera unavailable");
      this.captureTs = Math.max(getTime(), this.captureTs + 0.001);
      return { ts_capture: this.captureTs, jpeg: new Uint8Array([255, 216, 255, 217]),
        intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240, width: 640, height: 480, distortion_model: "none", distortion: [] },
        camera_position: [0, 0, 0], camera_orientation: [0, 0, 0, 1] };
    });
    root.uiPresenter.setupWizardController.deps.previewTexture = () => CAMERA_FIXTURE;
    root.uiPresenter.setupWizardController.deps.ipRelayClient.resolve = async () => null;
    root.uiPresenter.setupWizardController.start(false);
    // Keep fixture preference commands out of persistent device settings. The
    // existing adapter object stays installed; the owner still applies its policy.
    root.uiPresenter.lidarDisplay.store.write = () => {};
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
  command(message: any): void {
    if (this.armGolden?.command(message)) return;
    if (this.peer.command(message)) return;
    if (message.type === "lidar_settings_request") {
      this.lidarState = { enabled: message.enabled, min_height_m: message.min_height_m, max_height_m: message.max_height_m, max_range_m: message.max_range_m };
      this.after(0.05, () => this.state());
    }
    if (message.type === "estop_request") {
      this.peer.clearGoal();
      this.after(0.05, () => this.state("idle", null));
    }
    if (message.type === "localization_start_request")
      this.after(0.1, () => this.captureRequest());
    if (message.type === "nav_goal_request") {
      if (!message.preview || !this.peer.previewOwner(message)) throw new Error("Unfenced native fixture navigation command");
      const target = this.peer.canonical();
      if (target) this.after(0.1, () => this.navigationGoal(target, true, message.preview_id, message.lease_id));
    }
  }
  navigationGoal(target: any, preview: boolean, previewId?: string, leaseId?: string): void {
    const p = target.position, q = target.orientation, yaw = 2 * Math.atan2(q[2], q[3]);
    const path = [[...CATALOG.fixtures.pose.slice(0, 2), 0, 0], [(p[0] + 2) / 2, p[1] / 2, 0, yaw], [p[0], p[1], p[2], yaw]];
    const goal = { type: "nav_goal", pose: [p[0], p[1], p[2], yaw], path_poses: path, ts: getTime(),
      ...(preview ? { preview: true, preview_id: previewId } : {}) };
    if (preview) this.peer.setPreview(goal, target, leaseId);
    else this.peer.setGoal(goal);
    this.wire(goal);
    if (!preview) this.state("following_path", null);
  }
  ready(capabilities = this.caps, reconnect = false, providers: ("fiducial_marker" | "vps")[] = ["vps"]): void {
    const session = this.root.session;
    if (session.view().connection === "ready")
      return;
    if (session.wantConnected && !reconnect) session.stop();
    if (!session.wantConnected) session.start();
    session.onTransportOpen();
    const request = [...this.sent].reverse().find(row => row.type === "hello_request");
    this.wire({ resume_token: "fixture-resume", type: "hello", protocol_version: 2, bulk_url: "/bulk", bulk_token: "fixture-token", bulk_epoch: "fixture-epoch", client_id: "native-integration", odom_reference_id: "native-fixture-odom", time_sync: { ts_client: request.ts_client, ts_server: getTime() },
      robot: { ...CATALOG.fixtures.robot, ...(capabilities.manipulation?.available ? { display_name: "OpenYAM" } : {}) }, capabilities, localization: { providers } });
    this.peer.reset();
    this.state("idle", null);
    this.pose(CATALOG.fixtures.pose);
  }
  pose(position: readonly number[]): void { this.wire({ type: "pose", position, orientation: [0, 0, 0, 1], ts: getTime() }); }
  captureRequest(policy = "any_angle"): void {
    this.wire({ result_timeout_s: 15, type: "localization_observations_request", capture_id: "fixture-capture", capture_policy: policy, observation_count: 3,
      ...(policy === "robot_los_preferred" ? { wait_timeout_s: 0.2 } : {}) });
  }
  acceptLocalization(ts = this.captureTs): void {
    this.wire({ type: "localization_result", position: this.origin, orientation: [0, 0, 0, 1], confidence: 1, ts });
  }
  count(type: string, predicate: (row: any) => boolean = () => true): number { return this.sent.filter(row => row.type === type && predicate(row)).length; }
  world(odom: readonly number[]): vec3 { const p = clientTrackingToSpecsPoint(odom.map((v, i) => v - this.origin[i]) as [
    number,
    number,
    number
  ]); return new vec3(...p); }
  aim(point = this.goal): void { this.input!.active = true; this.input!.ray(this.root.cameraObject.getTransform().getWorldPosition(), this.world(point)); }
  button(name: string): any {
    const button = this.root.uiPresenter.mainMenuView.buttons.find((value: any) => value.getSceneObject().name === name);
    if (!button)
      throw new Error(`Native button missing: ${name}`);
    return button;
  }
  press(button: any): void { const active = this.input!.active; this.input!.active = true; this.input!.press(button); this.input!.active = active; }
  setWorldCamera(enabled: boolean): void {
    this.worldCamera = enabled;
    if (this.tracking) this.tracking.enabled = enabled ? false : this.trackingEnabled;
    const transform = this.root.cameraObject.getTransform();
    transform.setWorldPosition(this.cameraPosition);
    transform.setWorldRotation(enabled ? this.cameraRotation.multiply(quat.angleAxis(-25 * Math.PI / 180, vec3.right())) : this.cameraRotation);
  }
  showMenu(): void {
    this.setWorldCamera(false);
    this.root.uiPresenter.setUIState(1, { immediate: true });
    this.root.uiPresenter.mainMenuView.showPage("main");
  }
  worldOnly(): void {
    const ui = this.root.uiPresenter;
    if (ui.uiState !== 0) {
      ui.mainMenuView.showPage("main");
      this.press(this.button("Close"));
    }
    this.setWorldCamera(true);
  }
  runtime(): void {
    this.ready();
    this.root.clientTrackingOriginStore.restore({ position: this.origin, orientation: [0, 0, 0, 1], confidence: 1, ts: getTime() });
    if (!this.root.uiPresenter.isSetupCompleted()) {
      this.root.uiPresenter.setupWizardController.flow.finish();
      this.root.uiPresenter.finishWizard();
    }
    this.root.uiPresenter.setupWizardController.hide();
    this.showMenu();
  }
  startGoal(): void {
    this.aim();
    this.input!.start(null);
    this.after(0.2, () => this.input!.end());
    this.after(0.45, () => this.input!.start(null));
    this.after(0.65, () => this.input!.end());
  }
  tick(): void {
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
    this.armGolden?.tick();
    const display = this.root.uiPresenter.lidarDisplay;
    if (!this.lidarPreferencesConfigured && display.mode !== "off") {
      display.adjustPoints((CATALOG.fixtures.pointLimit - display.preferences.pointLimit) / 250);
      this.lidarPreferencesConfigured = true;
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
      screenshotOffsetS: step.id === "relocalization" ? 2.75 : step.id === "connection_ready" ? 1.6 : step.id === "navigation_cancelled" ? 1.55 :
        step.id === "navigation_success" ? 0.45 : step.id === "navigation_failure" ? 0.55 : 0.8,
    });
    try {
      if (this.profile === "golden")
        runGoldenCase(this, step.id);
      else
        runRegressionCase(this, step.id);
    }
    catch (error) {
      this.check(step.id, false);
      print(`INTEGRATION_CASE ${step.id}: ${String(error)}`);
    }
    if (this.profile === "golden" || step.id === "navigation_failure") scene();
    else this.after(3, scene);
  }
  lidar(): void {
    const count = CATALOG.fixtures.pointLimit, bytes = new Uint8Array(16 + count * 12), view = new DataView(bytes.buffer);
    view.setUint32(0, LIDAR_FOURCC, true);
    view.setFloat64(4, getTime(), true);
    view.setUint32(12, count, true);
    const robot = CATALOG.fixtures.pose;
    for (let i = 0; i < count; i++) {
      const a = i * 2.39996323, r = 0.3 + i % 47 / 47 * 1.8;
      [robot[0] + Math.cos(a) * r, robot[1] + Math.sin(a) * r, robot[2] - 0.3 + i % 17 / 17 * 1.3].forEach((v, k) => view.setFloat32(16 + i * 12 + k * 4, v, true));
    }
    this.peer.lidar(bytes);
  }
  captureBounds(id: string): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    if (id.startsWith("manipulation_")) return { x: 0, y: 0, width: 1, height: 1 };
    const root = this.root, camera = root.cameraObject.getComponent("Component.Camera") as Camera;
    const worldCases = new Set(["robot_hover", "robot_selected", "relocalization", "navigation_preview", "navigation_drag", "navigation_route", "robot_movement", "navigation_success", "navigation_cancelled", "world_marker"]);
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
  headerMetrics(): void {
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
    this.check("native-header-metrics", rows.length >= 2);
  }
}
