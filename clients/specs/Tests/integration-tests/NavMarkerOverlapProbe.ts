// Actual native physics hits feed SIK's own target chooser before driving the registered input.
import { DimOSSpecsClient } from "../Scripts/DimOSSpecsClient/DimOSSpecsClient";
import { createIconButton } from "../Scripts/DimOSSpecsClient/presentation/UIKit";
import { specsToClientTrackingPoint } from "../Scripts/DimOSSpecsClient/utilities/SpecsCoordinates";
import TargetProvider, { type InteractableHitInfo } from "SpectaclesInteractionKit.lspkg/Providers/TargetProvider/TargetProvider";
import { InteractionManager } from "SpectaclesInteractionKit.lspkg/Core/InteractionManager/InteractionManager";
import { TargetingMode } from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor";
import { IntegrationInput } from "./IntegrationInput";
import { INTEGRATION_CATALOG as CATALOG } from "./IntegrationCatalog";

@component
export class ReviewScenario extends BaseScriptComponent {
  @input startDelayS = 5;
  private root: any;
  private input: IntegrationInput | null = null;
  private probe = Physics.createGlobalProbe();
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
    this.createEvent("OnStartEvent").bind(() => this.createEvent("UpdateEvent").bind(() => this.tick()));
    this.createEvent("OnDestroyEvent").bind(() => this.input?.restore());
  }
  private emit(value: Record<string, unknown>): void { print(`SPECS_REVIEW ${JSON.stringify({ ...value, unixMs: Date.now() })}`); }
  private check(name: string, passed: boolean): void { this.failed ||= !passed; this.emit({ type: "result", name, passed }); }
  private scene(name: string, videoOnly = true): void { this.emit({ type: "scene", name, videoOnly }); }
  private wire(value: unknown): void {
    this.root.session.onTransportText(JSON.stringify(value) + "\n");
    if (this.root.session.view().connection === "failed")
      throw new Error("Native fixture frame rejected: " + this.root.session.view().lastError);
  }
  private prepare(): void {
    const find = (object: SceneObject): any => {
      const root = object.getComponent(DimOSSpecsClient.getTypeName()); if (root) return root;
      for (let i = 0; i < object.getChildrenCount(); i++) { const root = find(object.getChild(i)); if (root) return root; }
      return null;
    };
    for (let i = 0; i < global.scene.getRootObjectsCount(); i++) { this.root = find(global.scene.getRootObject(i)); if (this.root) break; }
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
    root.transport.connect = () => {}; root.transport.close = () => {};
    root.transport.sendText = (text: string) => {
      for (const line of text.trim().split("\n")) {
        const message = JSON.parse(line); this.sent.push(message);
        if (message.type === "nav_goal_request" && !message.preview) this.pendingGoal = message;
      }
    };
    root.uiPresenter.setupWizardController.invalidatePending();
    root.session.stop(); root.session.start(); root.session.onTransportOpen();
    const request = this.sent.find(row => row.type === "hello_request");
    const available = { available: true, reason: null };
    this.wire({ type: "hello", client_id: "native-overlap", odom_reference_id: "native-overlap-odom",
      time_sync: { ts_client: request.ts_client, ts_server: getTime() }, robot: CATALOG.fixtures.robot,
      capabilities: { lidar: available, localization: available, estop: available, agent: available,
        navigation: { ...available, nav_goal: { ...available, preview: true }, nav_joystick: { available: false, reason: "Hands" } } } });
    this.wire({ type: "state", server: { connected_clients: 1 },
      lidar: { enabled: false, min_height_m: -10, max_height_m: 10, max_range_m: 5 },
      nav: { state: "idle", outcome: null }, agent: { idle: true } });
    root.clientTrackingOriginStore.setFromLocalizationResult({ position: origin, orientation: [0, 0, 0, 1], confidence: 1, ts: getTime() });
    this.wire({ type: "pose", position: CATALOG.fixtures.pose, orientation: [0, 0, 0, 1], ts: getTime() });
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
      this.wire({ type: "nav_goal", pose, path_poses: [[...CATALOG.fixtures.pose.slice(0, 2), 0, 0], pose], ts: getTime() });
      this.wire({ type: "state", server: { connected_clients: 1 },
        lidar: { enabled: false, min_height_m: -10, max_height_m: 10, max_range_m: 5 },
        nav: { state: "following_path", outcome: null }, agent: { idle: true } });
    }
    if (this.phase === 2) this.wish = this.initial.add(this.right.uniformScale(Math.min(15, this.elapsed * 6)));
    if (this.phase >= 1) this.cast();
    input.update();
    if (this.elapsed < 3) return;
    this.elapsed = 0; this.phase++;
    if (this.phase === 0) {
      this.check("unselected-marker-available", !root.selection.isSelected() && root.navigationController.isArmed());
      this.initial = root.navigationController.currentPose().position;
      this.wish = this.initial; this.scene("overlapping-marker-ready");
    } else if (this.phase === 1) {
      input.active = true; this.scene("hover-through-robot-box");
    } else if (this.phase === 2) {
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
      this.scene("native-overlap-result", false);
    } else {
      input.restore(); this.emit({ type: "complete", passed: !this.failed }); this.enabled = false;
    }
  }
}
