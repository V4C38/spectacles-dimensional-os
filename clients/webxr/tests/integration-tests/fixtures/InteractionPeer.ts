import { previewAimChanged } from "./AdvisoryPreview";

/** Golden-flow acknowledgments only; Python contract tests prove lease expiry and fencing. */
export class InteractionPeer {
  revision = 0;
  mode = "manual";
  authority: any = null;
  target: any = null;
  preview: any = null;
  previewAim: { position: number[]; orientation: number[] } | null = null;
  activeGoal: any = null;
  joystickStops = 0;

  constructor(readonly epoch: string, private readonly clientId: string) {}

  snapshot(extra: object = {}) {
    return {
      motion_busy: false,
      following_tail: null,
      type: "interaction_state", epoch: this.epoch, revision: ++this.revision,
      mode: this.mode, authority: this.authority,
      targets: this.target ? [this.target] : [], preview: this.preview,
      active_goal: this.activeGoal, ...extra };
  }

  accept(command: any, busy = false) {
    let status = "accepted", code = command.action;
    let acquired = false;
    let released: { kind: string; target: any } | null = null;
    if (command.action === "acquire") {
      if (this.authority || this.mode !== "manual" || busy) { status = "busy"; code = "robot_busy"; }
      else {
        this.authority = { client_id: this.clientId, source_id: command.source_id,
          acquisition_id: command.acquisition_id, lease_id: `${this.epoch}-lease-${this.revision}`,
          kind: command.kind, ...(command.group_id ? { group_id: command.group_id } : {}),
          held: true, expires_at: 1e9, sequence: -1 };
        this.preview = this.previewAim = null;
        acquired = true;
      }
    } else if (command.action === "mode") {
      if (this.authority) { status = "busy"; code = "robot_busy"; }
      else this.mode = command.mode;
    } else if (command.action === "cancel" || command.action === "cancel_acquire") {
      if (this.authority?.kind === "joystick") this.joystickStops++;
      if (this.authority?.kind === "navigation_planning") this.target = null;
      this.authority = null; this.preview = this.previewAim = null;
    } else if (command.action !== "snapshot" && (!this.authority || command.epoch !== this.epoch || command.lease_id !== this.authority.lease_id)) {
      status = "stale"; code = "not_owner";
    }
    if (status === "accepted" && command.position) {
      const previous = this.target;
      const speed = command.speed_scale ?? previous?.speed_scale;
      const gripper = command.gripper ?? previous?.gripper;
      const changed = !previous || JSON.stringify([previous.position, previous.orientation, previous.speed_scale, previous.gripper])
        !== JSON.stringify([command.position, command.orientation, speed, gripper]);
      const manipulation = String(this.authority?.kind ?? command.kind).startsWith("manipulation_");
      this.target = { position: command.position, orientation: command.orientation,
        domain: manipulation ? "manipulation" : "navigation",
        ...(manipulation ? { group_id: command.group_id ?? this.authority?.group_id,
          speed_scale: speed ?? .5, ...(gripper === undefined ? {} : { gripper }) } : {}),
        revision: changed ? this.revision + 1 : previous.revision,
        phase: String(this.authority?.kind).endsWith("planning") ? "draft" : "live",
        sample_ts: performance.now() / 1000, sequence: command.sequence ?? -1 };
      if (this.authority) this.authority.sequence = command.sequence ?? -1;
      if (previewAimChanged(this.previewAim, this.target)) this.preview = this.previewAim = null;
    }
    if (status === "accepted" && (command.action === "release" || command.action === "confirm")) {
      if (command.action === "release" && this.authority?.kind === "navigation_planning") this.authority.held = false;
      else {
        released = { kind: this.authority?.kind, target: this.target };
        if (released.kind === "joystick") this.joystickStops++;
        if (this.target && released.kind !== "joystick") this.target.phase = "committed";
        this.authority = null; this.preview = this.previewAim = null;
      }
    }
    return { status, code, acquired, released };
  }

  result(command: any, result: { status: string; code: string }) {
    return { type: "interaction_result", request_id: command.request_id, epoch: this.epoch,
      revision: this.revision, status: result.status, code: result.code,
      ...(this.authority ? { lease_id: this.authority.lease_id } : {}) };
  }
}
