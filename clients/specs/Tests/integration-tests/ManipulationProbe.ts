import { integrationTestsEnabled } from "../Scripts/Integration Test Harness";
import { odomToClientTrackingPose } from "../../Assets/Scripts/DimOSARClient/localization/clientTrackingTransforms";
import { DimOSSpecsClient } from "../../Assets/Scripts/DimOSSpecsClient/DimOSSpecsClient";
import { clientTrackingToSpecsPose } from "../../Assets/Scripts/DimOSSpecsClient/utilities/SpecsCoordinates";
import { ARM_FIXTURE } from "./IntegrationArmFixture";
import { IntegrationInput } from "./IntegrationInput";
import { IntegrationV2Fixture } from "./IntegrationV2Fixture";
import { InteractorInputType } from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor";
import { INTEGRATION_CATALOG as CATALOG } from "./IntegrationCatalog";

@component
export class ReviewScenario extends BaseScriptComponent {
  @input startDelayS = 5;
  private root: any;
  private peer!: IntegrationV2Fixture;
  private tailGeneration = 0;
  private validatedTarget: any = null;
  private elapsed = 0;
  private phase = -1;
  private failed = false;
  private sent: any[] = [];
  private drag: IntegrationInput | null = null;
  private other: IntegrationInput | null = null;
  private origin: any;
  private state: any;
  private dragFrom = vec3.zero();
  private emit(value: Record<string, unknown>): void { print(`SPECS_REVIEW ${JSON.stringify({ ...value, unixMs: Date.now() })}`); }
  private check(name: string, passed: boolean): void { this.failed ||= !passed; this.emit({ type: "result", name, passed }); }
  private wire(message: any): void { this.peer.send(message); }
  private scene(id: string): void { this.emit({ type: "scene", id, name: id, label: id, videoOnly: true, durationS: 3 }); }
  private outlineUploadStart = 0;
  private outlineSampleStarted = 0;
  onAwake(): void {
    if (!integrationTestsEnabled(this.getSceneObject())) return; this.createEvent("OnStartEvent").bind(() => this.createEvent("UpdateEvent").bind(() => this.tick())); }
  private prepare(): void {
    const find = (object: SceneObject): any => {
      const root = object.getComponent(DimOSSpecsClient.getTypeName()); if (root) return root;
      for (let i = 0; i < object.getChildrenCount(); i++) { const found = find(object.getChild(i)); if (found) return found; }
      return null;
    };
    for (let i = 0; i < global.scene.getRootObjectsCount(); i++) { this.root = find(global.scene.getRootObject(i)); if (this.root) break; }
    if (!this.root) throw new Error("Production root missing");
    const root = this.root;
    this.peer = new IntegrationV2Fixture(value => root.session.onTransportText(JSON.stringify(value) + "\n"), "native-manipulation", () => getTime());
    this.peer.onTakeover = () => {
      if (this.state) { this.state.following_tail = null; this.wire(this.state); }
    };
    this.peer.onFollowingRelease = () => {
      const target = this.validatedTarget;
      const tail = target ? { generation: ++this.tailGeneration, group_id: "arm", status: "finishing",
        target_revision: target.revision, position: target.position, orientation: target.orientation,
        speed_scale: target.speed_scale ?? .5, joints: ARM_FIXTURE.joints } : null;
      this.state.following_tail = tail;
      this.wire(this.state);
      return tail;
    };
    root.transport.connect = () => {}; root.transport.close = () => {};
    root.transport.createSibling = () => this.peer;
    root.transport.sendBinary = () => { throw new Error("v2 control binary is forbidden"); };
    root.transport.sendText = (text: string) => {
      for (const line of text.trim().split("\n")) {
        const command = JSON.parse(line); this.sent.push(command);
        if (this.peer.command(command)) continue;
        if (command.type !== "manipulation_request") continue;
        if (!["cancel", "release"].includes(command.action) && !this.peer.authorizes(command))
          throw new Error("Unfenced native manipulation command");
        const reply: any = { type: "manipulation_result", request_id: command.request_id,
          group_id: command.group_id, action: command.action, status: "completed" };
        if (command.action === "acquire") reply.token = `native-follow-${this.tailGeneration}`;
        if (command.action === "evaluate") { reply.status = "feasible"; reply.joints = ARM_FIXTURE.joints; }
        if (command.action === "plan") Object.assign(reply, { status: "planned", plan_id: "native-plan",
          group_id: command.group_id, target_revision: command.target_revision,
          joint_names: Object.keys(ARM_FIXTURE.joints), duration: 2,
          trajectory: [{ time: 0, positions: Object.values(ARM_FIXTURE.joints) },
            { time: 2, positions: Object.values(ARM_FIXTURE.joints).map((v, i) => i === 0 ? v + 0.3 : v) }] });
        if (command.action === "update") {
          reply.status = "feasible"; reply.sequence = command.sequence; reply.joints = ARM_FIXTURE.joints;
          const canonical = this.peer.canonical();
          if (canonical) {
            this.validatedTarget = canonical;
            this.state.observations.arm.pose = { position: canonical.position, orientation: canonical.orientation };
          }
        }
        if (command.action === "gripper") this.state.observations.arm.gripper = command.value;
        if (command.action === "execute") { this.state.execution = "executing"; this.peer.setBusy(true); }
        this.wire(reply);
      }
    };
    root.uiPresenter.setupWizardController.invalidatePending();
    root.session.stop(); root.session.start(); root.session.onTransportOpen();
    const hello = this.sent.find(row => row.type === "hello_request");
    const yes = { available: true, reason: null }, no = { available: false, reason: "Arm" };
    this.wire({ type: "hello", client_id: "native-manipulation", odom_reference_id: "native-arm",
      time_sync: { ts_client: hello.ts_client, ts_server: getTime() },
      robot: { ...CATALOG.fixtures.robot, display_name: "OpenYAM" },
      capabilities: { manipulation: yes, localization: yes, lidar: no, agent: no, estop: yes,
        navigation: { ...no, nav_goal: no, nav_joystick: no } } });
    this.peer.reset();
    this.wire({ type: "state", server: { connected_clients: 1 }, lidar: { enabled: false, min_height_m: -10, max_height_m: 10, max_range_m: 5 },
      nav: { state: "idle", outcome: null }, agent: { idle: true } });
    this.origin = { position: [-1.4, 0, 0.55], orientation: [0, 0, 0, 1], confidence: 1, ts: getTime() };
    root.clientTrackingOriginStore.setFromLocalizationResult(this.origin);
    this.state = { type: "manipulation_state", available: true, ts: getTime(), model: ARM_FIXTURE.model,
      root_pose: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
      groups: [{ id: "arm", joint_names: Object.keys(ARM_FIXTURE.joints), base_frame: "base", tip_frame: "gripper_tip", has_gripper: true, following: true }],
      observations: { arm: { joints: ARM_FIXTURE.joints, measured_at: getTime(), pose: ARM_FIXTURE.pose, gripper: 0 } }, execution: "idle", stopped: false, following_tail: null };
    this.wire(this.state); root.uiPresenter.setupFlow.finish(); root.uiPresenter.setupWizardController.hide(); root.uiPresenter.finishWizard();
    this.drag = new IntegrationInput(); this.drag.active = true;
    this.other = new IntegrationInput(InteractorInputType.LeftHand); this.other.active = true;
    this.scene("manipulation_measured");
  }
  private tick(): void {
    this.elapsed += Math.min(0.1, getDeltaTime());
    if (!this.root) { if (this.elapsed < this.startDelayS) return; this.prepare(); this.elapsed = 0; return; }
    const root = this.root, arm = root.manipulation;
    this.state.ts = getTime(); this.state.observations.arm.measured_at = getTime(); this.wire(this.state);
    root.uiPresenter.mainUIFrame.enabled = false;
    const handle = arm.renderer.handle;
    if (this.phase === 1 || this.phase === 4) {
      this.drag!.ray(this.dragFrom.add(new vec3(Math.min(8, this.elapsed * 3), 0, 0)), this.drag!.point, this.drag!.target);
      this.drag!.update();
    }
    if (this.elapsed < 3) return;
    this.elapsed = 0; this.phase++;
    if (this.phase === 0) {
      this.emit({ type: "diagnostic", setup: root.uiPresenter.isSetupCompleted(), mode: root.uiPresenter.getOperatingMode(), connection: root.session.view().connection, error: root.session.view().lastError, origin: root.clientTrackingOriginStore.T_odom_client !== null, meshes: arm.renderer.meshes.size });
      this.check("manipulation_model", arm.renderer.meshes.size > 0 && arm.renderer.object.enabled);
      const presenter = arm.renderer.panelPresenter;
      this.check("manipulation_native_frame", presenter.root.enabled &&
        arm.renderer.panel.getParent() === presenter.frame.content);
      const expected = arm.renderer.base.getTransform().getWorldPosition().add(
        root.cameraObject.getTransform().getWorldRotation().multiplyVec3(new vec3(0, -13, 0)));
      const top = presenter.root.getTransform().getWorldPosition().add(
        root.cameraObject.getTransform().getWorldRotation().multiplyVec3(new vec3(0,
          arm.renderer.menuHeight.height * 50 * presenter.root.getTransform().getWorldScale().x, 0)));
      this.check("manipulation_frame_anchor", top.distance(expected) < .1);
      presenter.reset();

      const mesh = arm.renderer.meshes.values().next().value;
      this.check("manipulation_material", !!mesh && Number.isFinite(mesh.material.mainPass.opacityScale) && arm.renderer.edges.size > 0);
      this.check("manipulation_stroke_width", Math.abs(arm.renderer.path.material.mainPass.nearWidthScale - 0.75) < 0.0001);
      this.check("manipulation_pose", handle.getTransform().getWorldPosition().distance(new vec3(...clientTrackingToSpecsPose(odomToClientTrackingPose(ARM_FIXTURE.pose as any, root.clientTrackingOriginStore.T_odom_client)).position)) < 0.01);
      this.check("manipulation_gripper_meshes", ["gripper", "tip_left", "tip_right"].every(link => arm.renderer.picks.get(link)?.enabled === true));
      root.selection.setSelected(true); this.scene("manipulation_target");
    } else if (this.phase === 1) {
      this.outlineUploadStart = [...arm.renderer.edges.values()].reduce((n: number, edge: any) => n + edge.stroke.geometryUploads, 0);
      this.outlineSampleStarted = getTime();
      this.check("selected_idle_mesh_visible", [...arm.renderer.meshes.values()].every((mesh: any) => mesh.object.enabled));
      this.check("measured_ee_sphere_present", arm.renderer.measured.object.enabled);
      const interactable = handle.getComponent("ScriptComponent") as any;
      this.drag!.ray(handle.getTransform().getWorldPosition().add(new vec3(0, 0, 30)), handle.getTransform().getWorldPosition(), interactable);
      this.dragFrom = this.drag!.from;
      this.drag!.start(interactable);
    } else if (this.phase === 2) {
      const uploads = [...arm.renderer.edges.values()].reduce((n: number, edge: any) => n + edge.stroke.geometryUploads, 0) - this.outlineUploadStart;
      this.check("manipulation_outline_upload_budget", uploads <= arm.renderer.edges.size * (Math.ceil((getTime() - this.outlineSampleStarted) * 10) + 2));
      this.drag!.end(); this.check("manipulation_evaluate", this.sent.some(c => c.action === "evaluate"));
      arm.core.action("gripper");
      this.check("manipulation_gripper_draft_only", !this.sent.some(c => c.action === "execute" || c.action === "gripper"));
      arm.core.action("plan"); this.scene("manipulation_preview");
    } else if (this.phase === 3) {
      this.check("selected_ee_gripper", ["Open", "Close"].includes(arm.renderer.gripper.labelText.text));
      this.check("manipulation_plan", !!arm.core.interaction.plan);
      arm.core.action("execute"); this.check("manipulation_execute", this.sent.some(c => c.action === "execute" && c.plan_id === "native-plan"));
      this.state.execution = "idle"; this.peer.setBusy(false); root.selection.setSelected(false); this.scene("manipulation_follow");
    } else if (this.phase === 4) {
      const interactable = handle.getComponent("ScriptComponent") as any;
      this.drag!.ray(handle.getTransform().getWorldPosition().add(new vec3(0, 0, 30)), handle.getTransform().getWorldPosition(), interactable);
      this.dragFrom = this.drag!.from;
      this.drag!.start(interactable);
    } else if (this.phase === 5) {
      const update = [...this.sent].reverse().find(c => c.action === "update");
      if (update) this.wire({ type: "manipulation_result", request_id: update.request_id, action: "update", group_id: update.group_id, sequence: update.sequence, status: "infeasible", code: "ik_failed", message: "IK failed" });
      this.check("manipulation_ik_retains_capture", arm.core.interaction.dragging && arm.input.capture.owner !== null);
      const button = arm.renderer.gripper.button;
      const interactable = button.interactable;
      const owner = arm.input.capture.owner;
      this.other!.start(interactable); arm.input.tick(true); this.other!.end(); arm.input.tick(true);
      this.check("manipulation_two_hands", owner !== null && owner === arm.input.capture.owner && this.sent.some(c => c.action === "gripper"));
      this.check("manipulation_following", this.sent.some(c => c.action === "update")); this.scene("manipulation_gripper");
      this.drag!.end();
    } else if (this.phase === 6) {
      this.check("manipulation_mesh_picking", arm.renderer.picks.size > 0 &&
        [...arm.renderer.picks.values()].every((pick: any) => {
          const shape = pick.getComponent("Physics.ColliderComponent").shape;
          return !!shape.mesh && shape.convex === false;
        }));
      this.check("manipulation_release", this.sent.some(c => c.type === "interaction_request" && c.action === "release") &&
        !this.sent.some(c => c.type === "manipulation_request" && c.action === "release") &&
        root.session.view().interaction.authority === null && this.state.following_tail?.status === "finishing");
      root.emergencyStop(); this.check("manipulation_estop", this.sent.some(c => c.type === "estop_request"));
      this.drag!.restore(); this.other!.restore();
      this.emit({ type: "complete", passed: !this.failed }); this.enabled = false;
    }
  }
}
