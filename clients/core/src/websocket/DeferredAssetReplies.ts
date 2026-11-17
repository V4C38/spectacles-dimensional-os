import type { ClientClock, Hello, Lidar, Outbound } from "../ClientContracts";
import type { BulkTransfer } from "./BulkTransfer";
import { decodeOutboundObject } from "./protocol";
import { composePose } from "../localization/ClientTracking";
import type { ManipulationPose } from "../manipulation/ManipulationTypes";


type Value = Record<string, unknown>;
type Pending = { value: Value; deadline: number; stream: string | null; generation: number; connection: number;
  rebase?: ManipulationPose; spatialRetired?: boolean };

/** Correlation outlives hydration work, but never a newer stream or connection. */
export class DeferredAssetReplies {
  private readonly pending = new Map<string, Pending>();
  private readonly generations = new Map<string, number>();
  private connection = 0;
  private dirty = false;
  constructor(private readonly clock: ClientClock, private readonly bulk: BulkTransfer,
    private readonly apply: (message: Exclude<Outbound, Lidar | Hello>) => void,
    private readonly retire: (key: string, value: Value) => void,
    private readonly report: (error: unknown) => void) {}

  markDirty(): void { this.dirty = true; }
  reset(): void { this.connection++; this.generations.clear(); this.pending.clear(); this.dirty = false; }
  /** Native request-correlated trajectories survive a shared-frame transition. */
  discardSpatial(rebase?: ManipulationPose): void {
    for (const [key, reply] of this.pending) {
      if (reply.value.type !== "manipulation_result") this.pending.delete(key);
      else if (rebase) reply.rebase = reply.rebase ? composePose(rebase, reply.rebase) : rebase;
      else reply.spatialRetired = true;
    }
  }
  drop(key: string): void { this.pending.delete(key); }
  deadline(requestId: string): number | null {
    return this.pending.get(requestId)?.deadline ?? [...this.pending.values()].find(reply =>
      (reply.value.preview as Value | null)?.preview_id === requestId)?.deadline ?? null;
  }
  invalidate(stream: string): void {
    this.generations.set(stream, (this.generations.get(stream) ?? 0) + 1);
    for (const [key, reply] of this.pending) if (reply.stream === stream) this.pending.delete(key);
  }
  defer(value: Value, deadline: number | null, spatialRetired = false): void {
    const key = String(value.request_id ?? value.preview_id ?? value.type);
    const stream = value.type === "manipulation_state" || value.type === "interaction_state" ? value.type : null;
    if (!this.pending.has(key) && this.pending.size >= 64) throw new Error("Asset correlation budget exceeded");
    this.pending.set(key, { value, deadline: deadline ?? this.clock.now() + 120,
      stream, generation: stream ? this.generations.get(stream) ?? 0 : 0, connection: this.connection, spatialRetired });
    this.dirty = true;
  }
  tick(start: number): void {
    if (this.dirty) {
      let count = 0;
      for (const [key, reply] of this.pending) {
        if (count++ >= 4 || this.clock.now() - start >= .002) break;
        this.pending.delete(key);
        if (!this.current(reply)) continue;
        try {
          const hydrated = this.bulk.hydrate(reply.value);
          if (hydrated.unavailable && reply.value.type !== "interaction_state") { this.retire(key, reply.value); continue; }
          if (hydrated.pending) {
            reply.deadline = hydrated.deadline ?? reply.deadline;
            this.pending.set(key, reply); continue;
          }
          const value = { ...hydrated.value };
          if (reply.value.type === "manipulation_result") for (const field of ["pose", "sample_pose"]) {
            if (reply.spatialRetired) delete value[field];
            else if (reply.rebase && value[field]) value[field] = composePose(reply.rebase, value[field] as ManipulationPose);
          }
          const message = decodeOutboundObject(value);
          if (message.type !== "hello" && this.current(reply)) this.apply(message);
        } catch (error) { this.pending.delete(key); this.report(error); }
      }
      this.dirty = this.pending.size > 0;
    }
    for (const [key, reply] of this.pending) if (this.clock.now() >= reply.deadline) {
      this.pending.delete(key); this.retire(key, reply.value);
    }
  }
  private current(reply: Pending): boolean {
    return reply.connection === this.connection &&
      (reply.stream === null || reply.generation === this.generations.get(reply.stream));
  }
}
