import type { ManipulationModel } from "./ManipulationTypes";
import type { ClientTrackingOrigin } from "../localization/clientTrackingOrigin";
import { jointDelta } from "./JointMotion";

/** Context changes describe a different coordinate system, never a new packet or UI mode. */
export function armMotionContext(revision: string, group: string | null, origin: ClientTrackingOrigin): string {
  const sign = origin.orientation[3] < 0 ? -1 : 1;
  return JSON.stringify([revision, group, ...origin.position.map(v => Math.round(v * 1e6)),
    ...origin.orientation.map(v => Math.round(v * sign * 1e6))]);
}

/** Presentation-only Hermite interpolation. Raw feedback always controls motion/arrival. */
export class ArmJointFilter {
  constructor(private readonly defaultIntervalS = 1 / 30, private readonly maximumIntervalS = 0.15) {}
  private values: Record<string, number> = {};
  private from: Record<string, number> = {};
  private velocity: Record<string, number> = {};
  private fromVelocity: Record<string, number> = {};
  private goalVelocity: Record<string, number> = {};
  private goal: Record<string, number> = {};
  private raw: Record<string, number> = {};
  private key = "";
  private signature = "";
  private receivedAt: number | null = null;
  private duration = 1 / 30;
  private sampledAt: number | null = null;

  hold(now: number): void {
    if (this.receivedAt !== null && this.sampledAt !== null) this.receivedAt += now - this.sampledAt;
    this.sampledAt = now;
  }
  private playbackFrom: Record<string, number> | null = null;

  reset(): void {
    this.values = {}; this.from = {}; this.goal = {}; this.raw = {};
    this.velocity = {}; this.fromVelocity = {}; this.goalVelocity = {};
    this.signature = ""; this.receivedAt = null; this.playbackFrom = null; this.sampledAt = null;
  }

  sample(model: ManipulationModel, target: Record<string, number>, key: string, now: number,
    initialIntervalS = this.defaultIntervalS, sampleId?: string | number,
    measuredVelocity?: Record<string, number>): Record<string, number> {
    this.playbackFrom = null;
    this.sampledAt = now;
    if (key !== this.key) { this.reset(); this.key = key; }
    const evaluate = () => {
      const elapsed = this.receivedAt === null ? this.duration : Math.max(0, now - this.receivedAt);
      const t = Math.min(1, elapsed / this.duration), h = this.duration;
      // Brake prediction to rest when packets stop, rather than cutting velocity
      // at every packet boundary. Total lead is bounded to 30 ms of velocity.
      const tail = Math.min(.03, Math.max(0, elapsed - h));
      for (const joint of model.joints) {
        const name = joint.name;
        if (this.goal[name] === undefined) continue;
        const p = this.from[name], q = this.goal[name];
        const v = this.fromVelocity[name] ?? 0, w = this.goalVelocity[name] ?? 0;
        this.values[name] = (2*t*t*t-3*t*t+1)*p + (t*t*t-2*t*t+t)*h*v
          + (-2*t*t*t+3*t*t)*q + (t*t*t-t*t)*h*w + w*tail*(1-tail/.03)**2;
        this.velocity[name] = t >= 1 ? w*(1-tail/.03)*(1-3*tail/.03)
          : ((6*t*t-6*t)*p+(-6*t*t+6*t)*q)/h+(3*t*t-4*t+1)*v+(3*t*t-2*t)*w;
        if (!measuredVelocity) {
          const bounded = q >= p ? Math.min(q, this.values[name]) : Math.max(q, this.values[name]);
          if (bounded !== this.values[name]) this.velocity[name] = 0;
          this.values[name] = bounded;
        }
        if (joint.limits && joint.kind !== "continuous") {
          const bounded = Math.max(joint.limits.lower, Math.min(joint.limits.upper, this.values[name]));
          if (bounded !== this.values[name]) this.velocity[name] = 0;
          this.values[name] = bounded;
        }
      }
    };
    evaluate();
    const signature = JSON.stringify([sampleId, target]);
    if (signature !== this.signature) {
      const first = this.receivedAt === null;
      const interval = first ? initialIntervalS : Math.max(.001, now - this.receivedAt!);
      this.duration = Math.max(.02, Math.min(this.maximumIntervalS, interval));
      this.receivedAt = now; this.signature = signature;
      for (const joint of model.joints) {
        const name = joint.name, value = target[name];
        if (!Number.isFinite(value)) continue;
        const previous = this.values[name] ?? value;
        const delta = jointDelta(this.raw[name] ?? value, value, joint.kind === "continuous");
        // Inferred tangents also keep advisory IK previews moving between solutions.
        // A sparse IK result supplies a new pose, not evidence of ongoing motion.
        // Infer a tangent only while samples arrive inside the presentation horizon.
        const speed = first ? 0 : measuredVelocity?.[name] ?? (interval <= .08 ? delta / interval : 0);
        const w = speed;
        this.fromVelocity[name] = first ? 0 : this.velocity[name] ?? 0;
        this.goalVelocity[name] = w;
        this.from[name] = first ? value : previous;
        this.goal[name] = previous + jointDelta(previous, value, joint.kind === "continuous")
          + (measuredVelocity ? w * Math.min(.015, this.duration / 2) : 0);
        this.raw[name] = value;
      }
      evaluate();
    }
    this.sampledAt = now;
    return {...this.values};
  }

  playback(model: ManipulationModel, target: Record<string, number>, key: string, now: number, elapsed: number): Record<string, number> {
    if (key !== this.key) { this.reset(); this.key = key; }
    this.playbackFrom ??= {...this.values};
    const t = Math.max(0, Math.min(1, elapsed / .05));
    for (const joint of model.joints) {
      if (!Number.isFinite(target[joint.name])) continue;
      const from = this.playbackFrom[joint.name] ?? target[joint.name];
      this.values[joint.name] = from + jointDelta(from, target[joint.name], joint.kind === "continuous") * t;
    }
    this.from = {...this.values}; this.goal = {...this.values}; this.receivedAt = now;
    this.velocity = {}; this.goalVelocity = {}; this.fromVelocity = {};
    this.raw = {...target}; this.signature = "playback";
    this.sampledAt = now;
    return {...this.values};
  }
}
