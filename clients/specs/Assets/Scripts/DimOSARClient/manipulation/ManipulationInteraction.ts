import type { ARModuleSession } from "../websocket/arModuleSession";
import type {
  ManipulationAction,
  ManipulationPlan,
  ManipulationPose,
  ManipulationResult,
} from "./ManipulationTypes";
import { encodeManipulation } from "./ManipulationProtocol";

/** Portable intent and correlation. Observed execution remains in ARModuleSession. */
export class ManipulationInteraction {
  private sequence = 0;
  private generation = 0;
  private pending = new Map<
    string,
    {
      action: ManipulationAction;
      generation: number;
      group: string;
      deadline: number;
    }
  >();
  private retiredAcquisitions = new Map<string, string>();
  private unsubscribe: () => void;
  private token: string | null = null;
  private tokenSequence = 0;
  private lastUpdate = -Infinity;
  private lastEvaluation = -Infinity;
  private evaluatedGeneration = -1;
  private planQueued = false;
  private executeAfterPlan = false;
  private selected = false;
  private gesture: "planning" | "following" | null = null;
  groupId: string | null = null;
  target: ManipulationPose | null = null;
  solution: Record<string, number> | null = null;
  plan: ManipulationPlan | null = null;
  status = "";
  speedScale = 0.2;
  desiredGripper: number | null = null;
  rejection: {
    revision: number;
    pose: ManipulationPose;
    message: string;
  } | null = null;
  private rejectionRevision = 0;
  private lastGoodTarget: ManipulationPose | null = null;
  private rejectedTarget: ManipulationPose | null = null;
  setSpeedScale(value: number): void {
    if (!Number.isFinite(value)) return;
    const next = Math.max(0.05, Math.min(1, value));
    if (next === this.speedScale) return;
    this.speedScale = next;
    this.generation++;
    this.plan = null;
    this.planQueued = this.selected && this.target !== null;
    this.executeAfterPlan = false;
  }
  resetJoints(): void {
    if (!this.feedbackFresh || this.busy) return;
    this.end();
    this.generation++;
    this.plan = null;
    this.target = null;
    this.desiredGripper = null;
    this.rejection = null;
    this.lastGoodTarget = null;
    this.solution = null;
    this.planQueued = false;
    this.executeAfterPlan = false;
    this.status = "Returning to zero";
    this.send("reset_joints", { speed_scale: this.speedScale });
  }

  constructor(
    private readonly session: Pick<
      ARModuleSession,
      "view" | "sendText" | "subscribeOutbound"
    >,
    private readonly now: () => number,
  ) {
    this.unsubscribe = session.subscribeOutbound((message) => {
      if (message.type === "manipulation_result") this.accept(message);
    });
  }

  get dragging(): boolean {
    return this.gesture !== null;
  }
  get following(): boolean {
    return this.gesture === "following";
  }
  get busy(): boolean {
    return [...this.pending.values()].some(
      (p) =>
        p.action === "plan" ||
        p.action === "execute" ||
        p.action === "reset_joints",
    );
  }
  get feedbackFresh(): boolean {
    const view = this.session.view(),
      sync = view.hello?.time_sync;
    const observed = view.manipulation?.observations?.[this.groupId ?? ""];
    if (!observed?.joints || observed.measured_at == null) return false;
    const age =
      this.now() +
      (sync ? sync.ts_server - sync.ts_client : 0) -
      observed.measured_at;
    const group = view.manipulation?.groups?.find((g) => g.id === this.groupId);
    return (
      age >= -0.1 &&
      age <= 0.5 &&
      !!group?.joint_names.every((name) =>
        Number.isFinite(observed.joints![name]),
      )
    );
  }
  get available(): boolean {
    return this.session.view().capabilities?.manipulation?.available === true;
  }

  setSelected(selected: boolean): void {
    if (selected !== this.selected) {
      this.end();
      this.generation++;
      this.executeAfterPlan = false;
      this.planQueued = false;
      this.plan = null;
      this.solution = null;
      this.target = null;
      this.desiredGripper = null;
      this.rejection = null;
      this.lastGoodTarget = null;
      this.rejectedTarget = null;
    }
    this.selected = selected;
  }

  selectGroup(group: string): void {
    if (this.groupId === group) return;
    this.cancel();
    this.groupId = group;
    this.target = null;
    this.solution = null;
  }

  begin(): boolean {
    if (
      !this.available ||
      !this.feedbackFresh ||
      !this.groupId ||
      this.gesture ||
      this.busy
    )
      return false;
    this.gesture = this.selected ? "planning" : "following";
    if (this.gesture === "following") {
      const group = this.session
        .view()
        .manipulation?.groups?.find((g) => g.id === this.groupId);
      if (!group?.following) {
        this.gesture = null;
        this.status = "Following unavailable";
        return false;
      }
      this.plan = null;
      this.send("acquire");
    }
    return true;
  }

  aim(pose: ManipulationPose): void {
    if (!this.gesture) return;
    if (
      this.target &&
      Math.hypot(...pose.position.map((v, i) => v - this.target!.position[i])) <
        0.0005 &&
      Math.abs(
        pose.orientation.reduce(
          (s, v, i) => s + v * this.target!.orientation[i],
          0,
        ),
      ) > 0.999999
    )
      return;
    if (
      this.rejectedTarget &&
      pose.position.every(
        (v, i) => Math.abs(v - this.rejectedTarget!.position[i]) < 0.005,
      ) &&
      pose.orientation.every(
        (v, i) => Math.abs(v - this.rejectedTarget!.orientation[i]) < 0.01,
      )
    )
      return;
    this.rejectedTarget = null;
    this.target = {
      position: [...pose.position],
      orientation: [...pose.orientation],
    };
    if (this.gesture === "planning") {
      this.generation++;
      if (this.plan) {
        this.plan = null;
        this.send("cancel");
      }
    }
  }

  tick(): void {
    const now = this.now(),
      view = this.session.view();
    if (view.connection !== "ready") {
      this.reset();
      return;
    }
    const groups = view.manipulation?.groups ?? [];
    if (!this.groupId && groups.length === 1) this.groupId = groups[0].id;
    if (this.groupId && !groups.some((g) => g.id === this.groupId))
      this.reset();
    for (const [id, request] of this.pending) {
      if (now < request.deadline) continue;
      this.pending.delete(id);
      if (request.action === "acquire")
        this.retiredAcquisitions.set(id, request.group);
      this.status =
        request.action === "execute"
          ? "Execution response timed out; checking robot state"
          : "Request timed out";
      if (request.action === "plan") this.send("cancel");
    }
    if (this.gesture === "following" && !this.feedbackFresh) {
      this.status = "Joint feedback is stale";
      this.end();
    }
    if (
      this.token &&
      this.target &&
      this.gesture === "following" &&
      now - this.lastUpdate >= 1 / 30
    ) {
      this.session.sendText(
        encodeManipulation(
          `follow-${++this.sequence}`,
          "update",
          this.groupId!,
          {
            ...this.target,
            speed_scale: this.speedScale,
            token: this.token,
            sequence: ++this.tokenSequence,
            ts: now,
          },
        ),
      );
      this.lastUpdate = now;
    }
    if (
      this.planQueued &&
      ![...this.pending.values()].some(
        (p) => p.action === "evaluate" || p.action === "plan",
      )
    ) {
      this.planQueued = false;
      if (this.target)
        this.send("plan", {
          ...this.target,
          speed_scale: this.speedScale,
          ...(this.desiredGripper == null
            ? {}
            : { final_gripper: this.desiredGripper }),
        });
    }
    if (
      this.selected &&
      this.target &&
      this.gesture !== "following" &&
      this.evaluatedGeneration !== this.generation &&
      now - this.lastEvaluation >= 0.15 &&
      ![...this.pending.values()].some(
        (p) => p.action === "evaluate" || p.action === "plan",
      )
    ) {
      this.send("evaluate", this.target);
      this.evaluatedGeneration = this.generation;
      this.lastEvaluation = now;
    }
  }

  end(): void {
    const planOnRelease = this.gesture === "planning" && !!this.target;
    this.gesture = null;
    if (planOnRelease && this.feedbackFresh) {
      this.planQueued = true;
      this.status = "Planning";
    }
    if (this.token) {
      this.send("release", { token: this.token });
      this.token = null;
    }
    for (const [id, request] of this.pending) {
      if (request.action === "acquire") {
        this.retiredAcquisitions.set(id, request.group);
        this.pending.delete(id);
      }
    }
  }

  requestPlan(): void {
    if (!this.target || !this.feedbackFresh || this.busy || this.following)
      return;
    this.end();
    this.executeAfterPlan = false;
    this.plan = null;
    this.planQueued = true;
    this.status = "Planning";
  }
  execute(): void {
    if (!this.feedbackFresh || this.busy || this.following) return;
    if (!this.plan) {
      this.requestPlan();
      this.executeAfterPlan = this.planQueued;
      return;
    }
    this.status = "Executing";
    this.send("execute", { plan_id: this.plan.plan_id });
  }
  cancel(): void {
    this.end();
    this.generation++;
    this.executeAfterPlan = false;
    this.planQueued = false;
    this.plan = null;
    this.solution = null;
    if (this.groupId && this.available) this.send("cancel");
  }
  resume(): void {
    this.send("resume");
  }
  setGripper(value: number): void {
    if (!this.feedbackFresh) return;
    this.generation++;
    this.plan = null;
    this.solution = null;
    if (this.selected) {
      this.desiredGripper = value;
      this.planQueued = this.target !== null && this.gesture === null;
      return;
    }
    this.send("gripper", { value });
  }
  reset(): void {
    this.gesture = null;
    this.token = null;
    this.generation++;
    this.executeAfterPlan = false;
    this.planQueued = false;
    this.plan = null;
    this.pending.clear();
    this.retiredAcquisitions.clear();
    this.solution = null;
    this.target = null;
    this.groupId = null;
    this.desiredGripper = null;
    this.rejection = null;
    this.status = "";
  }
  dispose(): void {
    this.end();
    this.unsubscribe();
    this.reset();
  }

  private send(
    action: ManipulationAction,
    payload: Parameters<typeof encodeManipulation>[3] = {},
  ): void {
    if (!this.groupId || this.session.view().connection !== "ready") return;
    const id = `manipulation-${++this.sequence}`;
    this.pending.set(id, {
      action,
      generation: this.generation,
      group: this.groupId,
      deadline:
        this.now() +
        (action === "reset_joints" || action === "prepare_shutdown"
          ? 65
          : action === "plan"
            ? 20
            : 5),
    });
    this.session.sendText(
      encodeManipulation(id, action, this.groupId, payload),
    );
  }
  private accept(result: ManipulationResult): void {
    const retiredGroup = this.retiredAcquisitions.get(result.request_id);
    if (retiredGroup) {
      this.retiredAcquisitions.delete(result.request_id);
      if (result.token)
        this.session.sendText(
          encodeManipulation(
            `release-${++this.sequence}`,
            "release",
            retiredGroup,
            { token: result.token },
          ),
        );
      return;
    }
    if (
      result.action === "update" &&
      result.status === "rejected" &&
      this.token &&
      result.group_id === this.groupId
    ) {
      this.status = result.message || "Following target rejected";
      this.end();
      if (this.target)
        this.rejection = {
          revision: ++this.rejectionRevision,
          pose: this.target,
          message: this.status,
        };
      this.target =
        this.session.view().manipulation?.observations?.[this.groupId ?? ""]
          ?.pose ?? null;
      this.solution = null;
      return;
    }
    const request = this.pending.get(result.request_id);
    if (
      !request ||
      request.action !== result.action ||
      request.group !== result.group_id
    )
      return;
    this.pending.delete(result.request_id);
    if (request.generation !== this.generation) {
      if (result.token)
        this.session.sendText(
          encodeManipulation(
            `release-${++this.sequence}`,
            "release",
            request.group,
            { token: result.token },
          ),
        );
      if (result.action === "plan") this.send("cancel");
      return;
    }
    this.status = result.message || result.status;
    if (
      result.action === "acquire" &&
      result.token &&
      this.gesture === "following"
    ) {
      this.token = result.token;
      this.tokenSequence = 0;
    }
    if (result.action === "evaluate") {
      this.solution =
        result.status === "feasible" ? (result.joints ?? null) : null;
      if (this.solution && this.target)
        this.lastGoodTarget = {
          ...this.target,
          position: [...this.target.position],
          orientation: [...this.target.orientation],
        };
      else {
        this.rejectedTarget = this.target;
        if (this.target)
          this.rejection = {
            revision: ++this.rejectionRevision,
            pose: this.target,
            message: result.message || "Target unreachable",
          };
        this.target =
          this.lastGoodTarget ??
          this.session.view().manipulation?.observations?.[this.groupId ?? ""]
            ?.pose ??
          null;
        this.evaluatedGeneration = this.generation;
        this.executeAfterPlan = false;
      }
    }
    if (
      result.action === "plan" &&
      result.plan_id &&
      result.joint_names &&
      result.trajectory &&
      result.duration !== undefined
    ) {
      this.plan = {
        plan_id: result.plan_id,
        joint_names: result.joint_names,
        trajectory: result.trajectory,
        duration: result.duration,
      };
      if (this.executeAfterPlan) {
        this.executeAfterPlan = false;
        this.execute();
      }
    }
    if (result.action === "plan" && !result.plan_id)
      this.executeAfterPlan = false;
    if (result.action === "execute" && result.status === "accepted")
      this.plan = null;
    if (result.action === "acquire" && !result.token) this.gesture = null;
  }
}
