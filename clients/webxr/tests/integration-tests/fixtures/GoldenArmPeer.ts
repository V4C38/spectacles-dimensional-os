import type { InteractionPeer } from "./InteractionPeer";
import { composePose, linkPoses } from "../../../../specs/Assets/Scripts/DimOSARClient/manipulation/ModelKinematics";
import type { ManipulationModel, ManipulationPose } from "../../../../specs/Assets/Scripts/DimOSARClient/manipulation/ManipulationTypes";

type Pose = { position: number[]; orientation: number[] };
type Packet = Record<string, any>;
type Move = { from: Pose; goal: Pose; joints: Packet; fromJoints: Packet; started: number; duration: number; gripper?: number; complete?: () => void };

/** Deterministic UI fixture, not an IK solver or evidence of physical robot behavior. */
export class GoldenArmPeer {
  private enabled = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private clockOrigin = 0;
  private clockStarted = 0;
  private serial = 0;
  private followingToken: string | null = null;
  private followSequence = 0;
  private move: Move | null = null;
  private checked: { plan: Packet; goal: Pose; joints: Packet; gripper?: number } | null = null;
  private evaluation: Packet | null = null;
  private tail: Packet | null = null;
  private execution = "idle";
  private operationId: string | null = null;
  private operation: "resetting" | null = null;
  private stopped = false;
  private gripper = 0;
  private goal: Pose | null = null;
  private pose: Pose;
  private joints: Packet;
  readonly rootPose: Pose = { position: [2.4, -0.7, 0.8], orientation: [0, 0, 0, 1] };

  constructor(private readonly fixture: { model: Packet; joints: Packet; pose: Pose },
    private readonly peer: InteractionPeer, private readonly send: (value: Packet) => void) {
    this.joints = { ...fixture.joints };
    this.pose = this.homePose();
  }

  anchor(clientTime: number): void { this.clockOrigin = clientTime; this.clockStarted = performance.now(); }
  private now(): number { return this.clockOrigin + (performance.now() - this.clockStarted) / 1000; }
  private homePose(): Pose {
    const local = linkPoses(this.fixture.model as ManipulationModel, this.fixture.joints).gripper_tip;
    return composePose(this.rootPose as ManipulationPose, local);
  }
  private copy(pose: Pose): Pose { return { position: [...pose.position], orientation: [...pose.orientation] }; }
  private target(value: Packet): Pose { return { position: [...value.position], orientation: [...value.orientation] }; }
  private solution(goal: Pose): Packet {
    const home = this.homePose();
    const delta = goal.position.map((v, i) => v - home.position[i]);
    return Object.fromEntries(Object.entries(this.fixture.joints).map(([name, value], i) =>
      [name, Number(value) + delta[i % 3] * (i % 2 ? -0.6 : 0.6)]));
  }

  enable(): void {
    this.enabled = true;
    this.publish();
    this.timer ??= setInterval(() => this.tick(), 50);
    this.timer.unref();
  }
  dispose(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
  interactionFacts() { return { following_tail: this.tail, motion_busy: this.execution === "executing" || this.operation !== null }; }
  snapshot(): Packet {
    return {
      type: "manipulation_state", available: true, simulated: true, ts: this.now(),
      model: this.fixture.model, root_pose: this.rootPose,
      groups: [{ id: "arm", joint_names: Object.keys(this.fixture.joints), base_frame: this.fixture.model.root,
        tip_frame: "gripper_tip", has_gripper: true, following: true }],
      observations: { arm: { joints: { ...this.joints }, measured_at: this.now(), pose: this.copy(this.pose),
        gripper: this.gripper, gripper_target: this.gripper } },
      execution: this.execution, operation_id: this.operationId, operation: this.operation,
      plan: this.checked?.plan ?? null, evaluation: this.evaluation,
      following: this.followingToken !== null, following_tail: this.tail,
      following_at_target: this.followingToken !== null && this.move === null,
      following_goal: this.goal, stopped: this.stopped, stop_confirmed: true,
      protection: { state: "normal", effective_speed_scale: 1 },
    };
  }
  private publish(): void { if (this.enabled) this.send(this.snapshot()); }
  private shared(): void { this.send(this.peer.snapshot(this.interactionFacts())); }
  private reply(command: Packet, payload: Packet): void {
    this.send({ type: "manipulation_result", request_id: command.request_id, action: command.action,
      group_id: "arm", target_revision: command.target_revision, ...payload });
  }
  private startMove(goal: Pose, joints: Packet, duration: number, complete?: () => void, gripper?: number): void {
    this.goal = this.copy(goal);
    this.move = { from: this.copy(this.pose), goal: this.copy(goal), joints, fromJoints: { ...this.joints },
      started: this.now(), duration, complete, gripper };
  }

  /** The current server forwards shared following targets; the browser sends no native updates. */
  interaction(command: Packet, result: { status: string; acquired: boolean; released: { kind: string; target: any } | null }): void {
    if (!this.enabled || result.status !== "accepted") return;
    if (result.acquired && String(command.kind).startsWith("manipulation")) {
      this.tail = null; this.move = null; this.followingToken = null;
    }
    if (result.released?.kind === "manipulation_following" && result.released.target) {
      const target = result.released.target, goal = this.target(target), joints = this.solution(goal);
      this.followingToken = null;
      this.tail = { generation: ++this.serial, group_id: "arm", status: "finishing",
        target_revision: target.revision, ...goal, joints, speed_scale: target.speed_scale ?? .5 };
      this.startMove(goal, joints, .6, () => { this.tail = null; this.shared(); });
    }
    if (command.action === "cancel" || command.action === "cancel_acquire") this.stop(false);
    if (this.checked && this.peer.target?.domain === "manipulation" &&
        this.peer.target.revision !== this.checked.plan.target_revision && this.execution !== "executing") this.checked = null;
    this.publish();
  }

  command(command: Packet): void {
    if (!this.enabled) return;
    const authority = this.peer.authority;
    const unownedCancel = command.action === "cancel" && !authority && command.lease_id === "unowned";
    if (command.epoch !== this.peer.epoch || !unownedCancel && (!authority || command.lease_id !== authority.lease_id)) {
      this.reply(command, { status: "rejected", code: "not_owner" }); return;
    }
    if (command.action === "resume") {
      this.stopped = false; this.execution = "idle"; this.followingToken = null;
      this.reply(command, { status: "resumed" }); this.publish(); return;
    }
    if (command.action === "cancel" || command.action === "release") {
      this.stop(false); this.shared(); this.reply(command, { status: command.action === "release" ? "released" : "cancelled" }); return;
    }
    if (this.stopped) { this.reply(command, { status: "rejected", code: "stopped" }); return; }
    if (command.action === "acquire") {
      this.followingToken = `golden-follow-${++this.serial}`; this.followSequence = 0;
      this.reply(command, { status: "acquired", token: this.followingToken });
    } else if (command.action === "evaluate" || command.action === "plan") {
      const goal = this.target(command), joints = this.solution(goal);
      if (command.action === "evaluate") {
        this.evaluation = { group_id: "arm", target_revision: command.target_revision, joints, pose: goal };
        this.reply(command, { status: "feasible", joints, pose: goal, sample_pose: goal });
      } else {
        const names = Object.keys(this.fixture.joints);
        const plan = { plan_id: `golden-plan-${++this.serial}`, group_id: "arm", target_revision: command.target_revision,
          joint_names: names, duration: .6, trajectory: [
            { time: 0, positions: names.map(name => this.joints[name]) },
            { time: .6, positions: names.map(name => joints[name]) },
          ] };
        this.checked = { plan, goal, joints, gripper: command.final_gripper };
        this.reply(command, { status: "planned", ...plan, pose: goal, sample_pose: goal });
      }
    } else if (command.action === "execute") {
      const checked = this.checked;
      if (!checked || command.plan_id !== checked.plan.plan_id || this.peer.target?.revision !== checked.plan.target_revision) {
        this.reply(command, { status: "rejected", code: "stale_plan" }); return;
      }
      this.execution = "executing"; this.operationId = `golden-operation-${++this.serial}`;
      this.reply(command, { status: "accepted", operation_id: this.operationId });
      this.startMove(checked.goal, checked.joints, .6, () => {
        this.execution = "completed"; this.checked = null; this.shared();
      }, checked.gripper);
      this.shared();
    } else if (command.action === "gripper") {
      this.gripper = command.value; this.reply(command, { status: "completed" });
    } else if (command.action === "reset_joints") {
      this.operation = "resetting"; this.checked = null;
      this.startMove(this.homePose(), { ...this.fixture.joints }, .6, () => {
        this.operation = null; this.execution = "idle";
        this.reply(command, { status: "completed" }); this.shared();
      });
      this.shared();
    }
    this.publish();
  }

  stop(emergency: boolean): void {
    this.move = null; this.tail = null; this.followingToken = null; this.checked = null;
    this.execution = "idle"; this.operation = null; this.stopped ||= emergency;
    this.publish();
  }
  private tick(): void {
    if (this.followingToken && this.peer.authority?.kind === "manipulation_following" && this.peer.target?.domain === "manipulation") {
      const goal = this.target(this.peer.target), joints = this.solution(goal);
      if (!this.goal || JSON.stringify(goal) !== JSON.stringify(this.goal)) this.startMove(goal, joints, .2);
      this.reply({ request_id: `shared-follow-${this.followingToken}-${++this.followSequence}`, action: "update",
        target_revision: this.peer.target.revision }, { status: "feasible", sequence: this.followSequence,
        sample_pose: goal, pose: goal, joints });
    }
    const move = this.move;
    if (move) {
      const t = Math.min(1, (this.now() - move.started) / move.duration);
      this.pose = { position: move.goal.position.map((v, i) => move.from.position[i] + (v - move.from.position[i]) * t),
        orientation: [...move.goal.orientation] };
      this.joints = Object.fromEntries(Object.keys(move.joints).map(name =>
        [name, move.fromJoints[name] + (move.joints[name] - move.fromJoints[name]) * t]));
      if (t >= 1) { this.move = null; if (move.gripper != null) this.gripper = move.gripper; move.complete?.(); }
    }
    this.publish();
  }
}
