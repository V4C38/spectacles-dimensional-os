import { linkPoses } from "../../Assets/Scripts/DimOSARClient/manipulation/ModelKinematics";
import { ARM_FIXTURE } from "./IntegrationArmFixture";
import { IntegrationInput } from "./IntegrationInput";
import { IntegrationV2Fixture } from "./IntegrationV2Fixture";

/** Deterministic arm peer for the golden walkthrough; production input and UI stay active. */
export class IntegrationArmGolden {
  private state: any;
  private target: any;
  private plan: any = null;
  private executedPlanId: string | null = null;
  private serial = 0;
  private followSequence = 0;
  private token = "";
  private releasedTail = false;
  private readonly actions = new Set<string>();
  private dragStart = vec3.zero();
  constructor(private root: any, private peer: IntegrationV2Fixture, private input: IntegrationInput,
    private after: (delay: number, action: () => void) => void,
    private check: (passed: boolean) => void) {
    this.state = { type: "manipulation_state", available: true, ts: getTime(), model: ARM_FIXTURE.model,
      root_pose: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
      groups: [{ id: "arm", joint_names: Object.keys(ARM_FIXTURE.joints), base_frame: "base", tip_frame: "gripper_tip", has_gripper: true, following: true }],
      observations: { arm: { joints: { ...ARM_FIXTURE.joints }, measured_at: getTime(), pose: linkPoses(ARM_FIXTURE.model as any, ARM_FIXTURE.joints).gripper_tip, gripper: 0 } },
      execution: "idle", stopped: false, stop_confirmed: true, following_tail: null };
    peer.onFollowingRelease = target => {
      this.releasedTail = true;
      const tail = { generation: ++this.serial, group_id: "arm", status: "finishing", target_revision: target.revision,
        position: target.position, orientation: target.orientation, speed_scale: target.speed_scale ?? .5 };
      this.state.following = false; this.state.following_tail = tail;
      this.after(.7, () => { this.state.following_tail = null; peer.setFollowingTail(null); });
      return tail;
    };
  }
  tick(): void {
    this.state.ts = getTime(); this.state.observations.arm.measured_at = getTime(); this.peer.send(this.state);
  }
  command(command: any): boolean {
    if (command.type === "interaction_request") {
      this.peer.command(command);
      const target = this.peer.canonical();
      if (command.action === "update" && target?.domain === "manipulation" && this.state.following) {
        this.target = target; this.state.observations.arm.pose = target;
        this.peer.send({ type: "manipulation_result", action: "update", group_id: "arm",
          request_id: `shared-follow-${this.token}-${++this.followSequence}`, sequence: this.followSequence,
          status: "feasible", joints: this.state.observations.arm.joints, pose: target, sample_pose: target });
      }
      return true;
    }
    if (command.type === "estop_request") { this.actions.add("estop_request"); this.state.stopped = true; this.state.following = false; this.state.plan = null; return false; }
    if (command.type !== "manipulation_request") return false;
    this.actions.add(command.action);
    if (!["cancel", "release", "resume"].includes(command.action) && !this.peer.authorizes(command))
      throw new Error("Unfenced golden arm command");
    const reply: any = { type: "manipulation_result", request_id: command.request_id,
      group_id: command.group_id, action: command.action, status: "completed" };
    if (command.action === "evaluate") Object.assign(reply, { status: "feasible", joints: this.state.observations.arm.joints, pose: command, sample_pose: command });
    if (command.action === "plan") {
      this.target = this.peer.canonical();
      this.plan = { plan_id: `golden-plan-${++this.serial}`, group_id: "arm", target_revision: command.target_revision,
        joint_names: Object.keys(ARM_FIXTURE.joints), duration: 1,
        trajectory: [{ time: 0, positions: Object.values(ARM_FIXTURE.joints) },
          { time: 1, positions: Object.values(ARM_FIXTURE.joints).map((value, index) => value + (index === 0 ? .25 : 0)) }] };
      this.state.plan = this.plan; Object.assign(reply, this.plan, { status: "planned" });
    }
    if (command.action === "execute") {
      if (command.plan_id !== this.plan?.plan_id || command.target_revision !== this.plan.target_revision ||
          command.target_revision !== this.peer.canonical()?.revision)
        throw new Error("Golden Execute used an unreviewed plan or target revision");
      this.executedPlanId = command.plan_id;
      Object.assign(reply, { status: "accepted", operation_id: this.plan.plan_id });
      this.state.execution = "executing"; this.state.operation_id = this.plan.plan_id; this.peer.setBusy(true);
      this.after(1.2, () => {
        this.state.observations.arm.joints = Object.fromEntries(this.plan.joint_names.map((name: string, index: number) => [name, this.plan.trajectory[1].positions[index]]));
        this.state.observations.arm.pose = this.target; this.state.execution = "completed";
        this.state.operation_id = null; this.state.plan = null; this.peer.setBusy(false);
      });
    }
    if (command.action === "acquire") { this.token = `golden-follow-${++this.serial}`; this.state.following = true; Object.assign(reply, { status: "acquired", token: this.token }); }
    if (command.action === "release") { this.state.following = false; reply.status = "released"; }
    if (command.action === "cancel") { this.state.execution = "idle"; this.state.following = false; this.peer.setBusy(false); }
    if (command.action === "gripper") this.state.observations.arm.gripper = command.value;
    if (command.action === "resume") { this.state.stopped = false; this.state.execution = "idle"; reply.status = "resumed"; }
    if (command.action === "reset_joints") { this.state.observations.arm.joints = { ...ARM_FIXTURE.joints }; this.state.execution = "idle"; }
    this.peer.send(reply); this.tick(); return true;
  }
  private press(button: any): void {
    this.input.unhover();
    this.input.ray(this.root.cameraObject.getTransform().getWorldPosition(), button.interactable.getSceneObject().getTransform().getWorldPosition(), button.interactable);
    this.input.press(button, () => this.root.manipulation.input.tick(true));
  }
  private handle(): any {
    const handle = this.root.manipulation.renderer.handle, interactable = handle.getComponent("ScriptComponent");
    this.input.active = true;
    this.input.ray(handle.getTransform().getWorldPosition().add(new vec3(0, 0, 30)), handle.getTransform().getWorldPosition(), interactable);
    this.input.hover(interactable); return interactable;
  }
  private frame(): void {
    const points: vec3[] = [];
    for (const mesh of this.root.manipulation.renderer.meshes.values()) {
      const vertices = mesh.visual.mesh.extractVerticesForAttribute("position"), transform = mesh.object.getTransform().getWorldTransform();
      for (let i = 0; i < vertices.length; i += 3) points.push(transform.multiplyPoint(new vec3(vertices[i], vertices[i + 1], vertices[i + 2])));
    }
    if (!points.length) throw new Error("Golden arm geometry missing");
    const min = new vec3(Math.min(...points.map(p => p.x)), Math.min(...points.map(p => p.y)), Math.min(...points.map(p => p.z)));
    const max = new vec3(Math.max(...points.map(p => p.x)), Math.max(...points.map(p => p.y)), Math.max(...points.map(p => p.z)));
    const center = min.add(max).uniformScale(.5), transform = this.root.cameraObject.getTransform();
    const back = transform.getWorldRotation().multiplyVec3(new vec3(0, 0, 1));
    const camera = this.root.cameraObject.getComponent("Component.Camera") as Camera;
    let distance = max.distance(min);
    for (let i = 0; i < 25; i++) {
      transform.setWorldPosition(center.add(back.uniformScale(distance)));
      if (points.every(point => { const screen = camera.worldSpaceToScreenSpace(point); return screen.x > .1 && screen.x < .9 && screen.y > .1 && screen.y < .9; })) break;
      distance *= 1.15;
    }
  }
  chapter(id: string, move: (action: (progress: number) => void) => void): void {
    const arm = this.root.manipulation, renderer = arm.renderer;
    if (id === "manipulation_select") {
      this.after(.8, () => {
        this.frame(); const pick = renderer.picks.get("link1"), interactable = pick.getComponent("ScriptComponent");
        this.input.active = true; this.input.ray(this.root.cameraObject.getTransform().getWorldPosition(), pick.getTransform().getWorldPosition(), interactable);
        this.input.press({ interactable }, () => arm.input.tick(true));
        this.after(.3, () => this.check(this.root.selection.isSelected() && renderer.panel.isEnabledInHierarchy));
      });
    } else if (id === "manipulation_preview") {
      this.handle(); this.input.start(); arm.input.tick(true); this.dragStart = this.input.from;
      move(progress => { if (progress < .45) { this.input.ray(this.dragStart.add(new vec3(progress * 15, 0, 0)), this.input.point, this.input.target); this.input.update(); } });
      this.after(2, () => { this.input.end(); arm.input.tick(true); this.handle(); });
      this.after(2.6, () => this.press(renderer.buttons.get("plan").button));
      this.after(3.2, () => this.check(!!arm.core.interaction.plan && arm.core.presentation.previewRequested && this.state.execution === "idle"));
    } else if (id === "manipulation_execute") {
      const reviewedPlanId = arm.core.interaction.plan?.plan_id;
      this.handle();
      // Native near-EE controls are enabled by the next renderer frame after hover.
      this.after(.4, () => {
        const button = renderer.buttons.get("execute").button;
        if (button.inactive || !renderer.previewMenu.isEnabledInHierarchy) {
          print(`SPECS_REVIEW ${JSON.stringify({ type: "diagnostic", caseId: id,
            name: "execute-control-not-ready", inactive: button.inactive,
            visible: renderer.previewMenu.isEnabledInHierarchy,
            intent: arm.core.interaction.snapshot(), status: arm.core.interaction.status,
            reviewedPlanId, currentPlanId: arm.core.interaction.plan?.plan_id, unixMs: Date.now() })}`);
          throw new Error("Golden Execute control did not become ready after native hover");
        }
        this.press(button);
      });
      this.after(2.8, () => this.check(!!reviewedPlanId && this.executedPlanId === reviewedPlanId &&
        this.actions.has("execute") && this.state.execution === "completed" && !this.state.operation_id));
    } else if (id === "manipulation_following") {
      this.root.selection.setSelected(false); this.handle(); this.input.start(); arm.input.tick(true); this.dragStart = this.input.from;
      move(progress => { if (progress < .45) { this.input.ray(this.dragStart.add(new vec3(progress * 12, 0, 0)), this.input.point, this.input.target); this.input.update(); } });
      this.after(2, () => { this.input.end(); arm.input.tick(true); });
      this.after(3.2, () => this.check(this.followSequence > 0 && this.releasedTail && !arm.core.interaction.dragging && this.state.following_tail === null));
    } else if (id === "manipulation_controls") {
      this.handle(); const opening = this.state.observations.arm.gripper;
      this.press(renderer.gripper.button);
      this.after(.5, () => { this.check(this.state.observations.arm.gripper !== opening); this.press(renderer.buttons.get("reset").button); });
      this.after(1.2, () => { this.press(renderer.buttons.get("stop").button); this.press(renderer.buttons.get("estop").button); });
      this.after(1.8, () => { this.check(this.state.stopped); this.press(renderer.buttons.get("estop").button); });
      this.after(2.5, () => this.check(["gripper", "reset_joints", "cancel", "estop_request", "resume"].every(action => this.actions.has(action)) && !this.state.stopped && !arm.core.interaction.dragging));
    }
  }
}
