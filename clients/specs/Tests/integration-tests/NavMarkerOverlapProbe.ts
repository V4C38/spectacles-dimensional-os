import { integrationTestsEnabled } from "../Scripts/Integration Test Harness";
// Actual native physics hits feed SIK's own target chooser before driving the registered input.
import { emitReviewEvent, findProductionRoot } from "./IntegrationHost";
import { createIconButton, SnapOS2Styles } from "../Scripts/DimOSSpecsClient/presentation/UIKit";
import { specsToClientTrackingPoint } from "../Scripts/DimOSSpecsClient/utilities/SpecsCoordinates";
import TargetProvider, { type InteractableHitInfo } from "SpectaclesInteractionKit.lspkg/Providers/TargetProvider/TargetProvider";
import { InteractionManager } from "SpectaclesInteractionKit.lspkg/Core/InteractionManager/InteractionManager";
import { TargetingMode } from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor";
import { IntegrationInput } from "./IntegrationInput";
import { IntegrationV2Fixture } from "./IntegrationV2Fixture";
import { INTEGRATION_CATALOG as CATALOG } from "./IntegrationCatalog";
import { NAVIGATION_CANCEL_STYLE } from "DimOSARClient.lspkg/Scripts/DimOSARClient/presentation/WorldPresentation";

@component
export class ReviewScenario extends BaseScriptComponent {
  @input startDelayS = 5;
  private root: any;
  private peer!: IntegrationV2Fixture;
  private input: IntegrationInput | null = null;
  private probe = Physics.createGlobalProbe();
  private gridIndex = -1;
  private gridResults: boolean[] = [];
  private readonly grid: [number, number, boolean][] = [[0, 0, true], [.7, 0, true], [-.7, 0, true],
    [0, .7, true], [0, -.7, true], [.6, .6, true], [-.6, .6, true], [.6, -.6, true], [-.6, -.6, true],
    [0, 1.04, true], [0, -1.04, true], [0, 1.2, false]];
  private selected: InteractableHitInfo | null = null;
  private boxIsNearer = false;
  private elapsed = 0;
  private phase = -1;
  private failed = false;
  private sent: any[] = [];
  private from = vec3.zero();
  private initial = vec3.zero();
  private wish = vec3.zero();
  private right = vec3.right();
  private blocker: ReturnType<typeof createIconButton> | null = null;
  private markerPresses = 0;
  private pendingGoal: any = null;

  onAwake(): void {
    if (!integrationTestsEnabled(this.getSceneObject())) return;
    this.createEvent("OnStartEvent").bind(() => this.createEvent("UpdateEvent").bind(() => this.tick()));
    this.createEvent("OnDestroyEvent").bind(() => this.input?.restore());
  }
  private emit(value: Record<string, unknown>): void { emitReviewEvent(value); }
  private check(name: string, passed: boolean): void { this.failed ||= !passed; this.emit({ type: "result", name, passed }); }
  private scene(name: string, videoOnly = true): void { this.emit({ type: "scene", name, videoOnly }); }
  private wire(value: unknown): void {
    this.peer.send(value as Record<string, any>);
    if (this.root.session.view().connection === "failed")
      throw new Error("Native fixture frame rejected: " + this.root.session.view().lastError);
  }
  private prepare(): void {
    this.root = findProductionRoot();
    if (!this.root) throw new Error("Production composition root missing");
    const root = this.root, camera = root.cameraObject.getTransform(), rotation = camera.getWorldRotation();
    const desired = camera.getWorldPosition().add(rotation.multiplyVec3(new vec3(0, -45, -170)));
    const point = specsToClientTrackingPoint([desired.x, desired.y, desired.z]);
    const origin = CATALOG.fixtures.pose.map((v: number, i: number) => v - point[i]);
    this.from = camera.getWorldPosition().add(rotation.multiplyVec3(new vec3(7, -15, -45)));
    this.right = rotation.multiplyVec3(vec3.right());
    const tracking = root.cameraObject.getComponent("Component.DeviceTracking") as DeviceTracking;
    tracking.enabled = false;
    camera.setWorldRotation(rotation.multiply(quat.angleAxis(-20 * Math.PI / 180, vec3.right())));
    this.peer = new IntegrationV2Fixture(value => root.session.onTransportText(JSON.stringify(value) + "\n"), "native-overlap", () => getTime());
    this.peer.onGoal = target => { this.pendingGoal = target; };
    root.transport.createSibling = () => this.peer;
    root.transport.connect = () => {}; root.transport.close = () => {};
    root.transport.sendText = (text: string) => {
      for (const line of text.trim().split("\n")) {
        const message = JSON.parse(line); this.sent.push(message);
        if (this.peer.command(message)) continue;
        if (message.type === "nav_goal_request" && !message.preview) {
          if (!this.peer.authorizes(message)) throw new Error("Unfenced native overlap navigation");
          this.pendingGoal = message;
        }
      }
    };
    root.uiPresenter.setupWizardController.invalidatePending();
    root.session.stop(); root.session.start(); root.session.onTransportOpen();
    const request = this.sent.find(row => row.type === "hello_request");
    const available = { available: true, reason: null };
    this.wire({
      resume_token: "fixture-resume",
      localization: { providers: ["fiducial_marker"] },
      type: "hello", protocol_version: 2, bulk_url: "/bulk", bulk_token: "fixture-token", bulk_epoch: "fixture-epoch", client_id: "native-overlap", odom_reference_id: "native-overlap-odom",
      time_sync: { ts_client: request.ts_client, ts_server: getTime() }, robot: CATALOG.fixtures.robot,
      capabilities: {
        manipulation: { available: false, reason: "No arm" },
        object_detection: { available: false, reason: "No detector" },
        lidar: available, localization: available, estop: available, agent: available,
        navigation: { ...available, nav_goal: { ...available, preview: true }, nav_joystick: { available: false, reason: "Hands" } } } });
    this.peer.reset();
    this.wire({ type: "state", server: { connected_clients: 1 },
      lidar: { enabled: false, min_height_m: -10, max_height_m: 10, max_range_m: 5 },
      nav: { state: "idle", outcome: null }, agent: { idle: true } });
    root.clientTrackingOriginStore.setFromLocalizationResult({ position: origin, orientation: [0, 0, 0, 1], confidence: 1, ts: getTime() });
    this.wire({ type: "pose", position: CATALOG.fixtures.pose, orientation: [0, 0, 0, 1], ts: getTime() });
    root.uiPresenter.setupWizardController.flow.finish();
    root.uiPresenter.setupWizardController.hide();
    root.uiPresenter.finishWizard();
    root.navigationController.deps.deviceTracking = { worldOptions: {}, raycastWorldMesh: (from: vec3, to: vec3) => {
      const floor = root.robotPresenter.floorWorldY(), delta = to.sub(from);
      const t = Math.abs(delta.y) > 0.0001 ? (floor - from.y) / delta.y : -1;
      return t >= 0 ? [{ position: from.add(delta.uniformScale(t)), normal: vec3.up() }] : [];
    } };
    this.input = new IntegrationInput(); this.input.active = false;
  }
  private cast(): void {
    const input = this.input!, direction = this.wish.sub(this.from).normalize();
    const gridIndex = this.phase === 1 ? this.gridIndex : -1;
    this.probe.rayCastAll(this.from, this.from.add(direction.uniformScale(500)), hits => {
      const manager = InteractionManager.getInstance();
      const native = hits.map(hit => ({ hit, target: manager.getInteractableByCollider(hit.collider) }))
        .filter(row => row.target !== null);
      const body = native.find(row => this.root.robotPresenter.ownsTarget(row.target!.getSceneObject()));
      const marker = native.find(row => this.root.navigationController.ownsMarkerTarget(row.target!.getSceneObject()));
      this.boxIsNearer = !!body && !!marker && body.hit.distance < marker.hit.distance;
      this.selected = TargetProvider.getInteractableHitFromRayCast(hits, TargetingMode.Indirect,
        manager.getInteractableByCollider.bind(manager));
      const target = this.selected?.interactable ?? null;
      if (gridIndex >= 0) this.gridResults[gridIndex] = this.markerSelected() === this.grid[gridIndex][2];
      if (target !== input.target) input.unhover();
      input.ray(this.from, this.selected?.hit.position ?? this.wish, target);
      if (target && !input.held) input.hover(target);
    });
  }
  private markerSelected(): boolean {
    return !!this.selected && this.root.navigationController.ownsMarkerTarget(this.selected.interactable.getSceneObject());
  }
  private tick(): void {
    this.elapsed += Math.min(0.1, getDeltaTime());
    if (!this.root) {
      if (this.elapsed < this.startDelayS) return;
      this.prepare(); this.elapsed = 0; return;
    }
    const root = this.root, input = this.input!;
    root.uiPresenter.mainUIFrame.enabled = false;
    root.uiPresenter.setupWizardPanel.enabled = false;
    if (this.pendingGoal) {
      const goal = this.pendingGoal; this.pendingGoal = null;
      const pose = [...goal.position, 0];
      const frame = { type: "nav_goal", pose, path_poses: [[...CATALOG.fixtures.pose.slice(0, 2), 0, 0], pose], ts: getTime() };
      this.peer.setGoal(frame);
      this.wire(frame);
      this.wire({ type: "state", server: { connected_clients: 1 },
        lidar: { enabled: false, min_height_m: -10, max_height_m: 10, max_range_m: 5 },
        nav: { state: "following_path", outcome: null }, agent: { idle: true } });
    }
    if (this.phase === 1) {
      this.gridIndex = Math.floor(this.elapsed / 0.2);
      const point = this.grid[this.gridIndex];
      const radius = root.navigationController.circleBounds().radius;
      this.wish = point ? this.initial.add(new vec3(point[0] * radius, 0, point[1] * radius)) : this.initial;
      if (!point) this.gridIndex = -1;
    }
    if (this.phase === 2) this.wish = this.initial.add(this.right.uniformScale(Math.min(15, this.elapsed * 6)));
    if (this.phase >= 1) this.cast();
    input.update();
    if (this.elapsed < 3) return;
    this.elapsed = 0; this.phase++;
    if (this.phase === 0) {
      const pose = root.navigationController.currentPose();
      const view = root.session.view();
      const ready = !root.selection.isSelected() && root.navigationController.isArmed() && pose !== null;
      this.check("unselected-marker-available", ready);
      if (!ready) throw new Error(`Overlap fixture initialization failed: ${JSON.stringify({
        setupCompleted: root.uiPresenter.isSetupCompleted(), connection: view.connection,
        tracking: view.hasTrackingOrigin, capabilities: view.capabilities?.navigation,
        origin: root.clientTrackingOriginStore.T_odom_client, pose,
      })}`);
      this.initial = pose.position;
      this.wish = this.initial; this.scene("overlapping-marker-ready");
    } else if (this.phase === 1) {
      input.active = true; this.scene("hover-through-robot-box");
    } else if (this.phase === 2) {
      this.check("filled-disc-and-margin-grid", this.gridResults.length === this.grid.length && this.gridResults.every(Boolean));
      this.check("real-box-hit-is-nearer-than-marker", this.boxIsNearer);
      this.check("native-sik-target-is-marker-through-box", this.markerSelected());
      this.check("marker-hovered-while-unselected", root.navigationController.hovered && !root.selection.isSelected());
      this.check("attached-marker-and-box-share-hover", root.navigationController.isMarkerAttachedToRobot() &&
        root.robotPresenter.worldVisuals.hovered && root.navigationController.hovered);
      this.selected!.interactable.onTriggerStart.add(() => this.markerPresses++);
      input.start(this.selected!.interactable); this.scene("drag-marker-inside-robot-box");
    } else if (this.phase === 3) {
      this.check("unselected-drag-sends-navigation-goals", this.sent.some(row => row.type === "nav_goal_request" && !row.preview));
      this.check("marker-moved-inside-box", root.navigationController.currentPose().position.distance(this.initial) > 5);
      this.check("marker-press-did-not-select-robot", this.markerPresses === 1 && !root.selection.isSelected());
      this.check("drag-detaches-hover-link", !root.navigationController.isMarkerAttachedToRobot() &&
        !root.robotPresenter.worldVisuals.hovered && root.navigationController.hovered);
      input.end(); this.scene("release-marker-drag");
    } else if (this.phase === 4) {
      const marker = root.navigationController.marker, button = marker.cancelButton;
      const scale = marker.cancelObject.getTransform().getWorldScale();
      const glyph = marker.cancelIcon.visual.mesh;
      const vertices = glyph.extractVerticesForAttribute("position");
      const colors = glyph.extractVerticesForAttribute("color");
      const xs: number[] = [], ys: number[] = [];
      for (let i = 0; i < vertices.length; i += 3) { xs.push(vertices[i]); ys.push(vertices[i + 1]); }
      const extentCm = (NAVIGATION_CANCEL_STYLE.glyphLengthM + NAVIGATION_CANCEL_STYLE.glyphWidthM) * 100 / Math.sqrt(2);
      const textVisible = (object: SceneObject): boolean => {
        const text = object.getComponent("Component.Text") as Text | null;
        if (text?.enabled && object.isEnabledInHierarchy && text.text.trim()) return true;
        for (let i = 0; i < object.getChildrenCount(); i++) if (textVisible(object.getChild(i))) return true;
        return false;
      };
      this.check("native-cancel-white-cross", vertices.length === 24 &&
        Math.abs((Math.max(...xs) - Math.min(...xs)) * scale.x - extentCm) < .01 &&
        Math.abs((Math.max(...ys) - Math.min(...ys)) * scale.y - extentCm) < .01 &&
        colors.every((value: number) => Math.abs(value - 1) < .001) && !textVisible(marker.cancelObject));
      const widthCm = button.width * scale.x, hitCm = button.collider.shape.size.x * scale.x;
      const visualWidthCm = button.visual.size.x * scale.x, radiusCm = button.visual.cornerRadius * scale.x;
      this.check("native-cancel-physical-size", Math.abs(widthCm - NAVIGATION_CANCEL_STYLE.diameterM * 100) < .01 &&
        Math.abs(visualWidthCm - widthCm) < .01 && Math.abs(radiusCm * 2 - widthCm) < .01 &&
        hitCm >= widthCm - .01 && hitCm <= widthCm * 1.25 && button.style === SnapOS2Styles.Special);
      this.emit({ type: "diagnostic", name: "native-cancel-size", widthCm, hitCm, glyphExtentCm: extentCm,
        visualWidthCm, radiusCm, initialized: button.initialized, style: button.style, labelVisible: textVisible(marker.cancelObject) });
      this.wish = root.robotPresenter.worldPosition().add(new vec3(0, 10, 0));
      this.scene("robot-box-still-pickable");
    } else if (this.phase === 5) {
      this.check("robot-box-remains-pickable", !!this.selected && root.robotPresenter.ownsTarget(this.selected.interactable.getSceneObject()));
      this.check("detached-marker-does-not-hover-with-box", root.robotPresenter.worldVisuals.hovered && !root.navigationController.hovered);
      this.wish = root.navigationController.currentPose().position;
      this.blocker = createIconButton(this.getSceneObject(), "UI occluder", "UI keeps priority", 25, 10, vec3.zero());
      this.blocker.sceneObject.getTransform().setWorldPosition(this.from.add(this.wish.sub(this.from).uniformScale(0.3)));
      this.blocker.sceneObject.getTransform().setWorldRotation(root.cameraObject.getTransform().getWorldRotation());
      this.scene("ui-before-overlapping-marker");
    } else if (this.phase === 6) {
      this.check("native-ui-still-blocks-marker", this.selected?.interactable === this.blocker!.button.interactable);
      this.blocker!.sceneObject.enabled = false; this.scene("marker-priority-restored");
    } else if (this.phase === 7) {
      this.check("marker-available-after-ui-hides", this.markerSelected());
      this.wish = root.navigationController.marker.cancelObject.getTransform().getWorldPosition();
      this.scene("navigation-cancel-cross", false);
    } else if (this.phase === 8) {
      const button = root.navigationController.marker.cancelButton;
      this.check("native-cancel-remains-ray-target", this.selected?.interactable === button.interactable);
      const before = this.sent.filter(row => row.type === "estop_request").length;
      input.press(button);
      this.check("native-cancel-press-once", this.sent.filter(row => row.type === "estop_request").length === before + 1);
      this.scene("native-overlap-result", false);
    } else {
      input.restore(); this.emit({ type: "complete", passed: !this.failed }); this.enabled = false;
    }
  }
}
