import type { ManipulationAction, ManipulationPose, ManipulationResult } from "./ManipulationTypes";

export interface ManipulationRequest {
  action: ManipulationAction;
  order: number;
  generation: number;
  episode: number;
  epoch: string | null;
  lease: string | null;
  group: string;
  pose: ManipulationPose | null;
  speed: number;
  gripper: number | null;
  startedAt: number;
  deadline: number;
}

/** Owns RPC correlation, transfer-aware deadlines and late acquisition cleanup. */
export class ManipulationRequests {
  private readonly pending = new Map<string, ManipulationRequest>();
  private readonly retiredAcquisitions = new Map<string, string>();
  private readonly timing = { requests: 0, completions: 0, failures: 0, timeouts: 0, maximumDurationS: 0 };

  constructor(private readonly now: () => number,
    private readonly transferDeadline: (id: string) => number | null | undefined) {}

  track(id: string, request: Omit<ManipulationRequest, "startedAt" | "deadline">): void {
    const startedAt = this.now();
    const timeout = request.action === "reset_joints" || request.action === "prepare_shutdown" ? 65
      : request.action === "plan" ? 20 : 5;
    this.pending.set(id, { ...request, startedAt, deadline: startedAt + timeout });
    if (request.action === "evaluate") this.timing.requests++;
  }

  has(...actions: ManipulationAction[]): boolean {
    for (const request of this.pending.values()) if (actions.includes(request.action)) return true;
    return false;
  }

  take(result: ManipulationResult): ManipulationRequest | null {
    const request = this.pending.get(result.request_id);
    if (!request || request.action !== result.action || request.group !== result.group_id) return null;
    this.pending.delete(result.request_id);
    if (request.action === "evaluate") {
      this.timing.completions++;
      if (result.status !== "feasible") this.timing.failures++;
      this.recordDuration(request);
    }
    return request;
  }

  expired(): ManipulationRequest[] {
    const expired: ManipulationRequest[] = [];
    for (const [id, request] of this.pending) {
      if (this.now() < Math.max(request.deadline, this.transferDeadline(id) ?? 0)) continue;
      this.pending.delete(id);
      if (request.action === "acquire") this.retiredAcquisitions.set(id, request.group);
      if (request.action === "evaluate") { this.timing.timeouts++; this.recordDuration(request); }
      expired.push(request);
    }
    return expired;
  }

  retireAcquisitions(): void {
    for (const [id, request] of this.pending) if (request.action === "acquire") {
      this.retiredAcquisitions.set(id, request.group);
      this.pending.delete(id);
    }
  }

  retainRelease(): void {
    this.retireAcquisitions();
    for (const [id, request] of this.pending) if (request.action !== "release") this.pending.delete(id);
  }

  takeRetiredGroup(id: string): string | null {
    const group = this.retiredAcquisitions.get(id) ?? null;
    this.retiredAcquisitions.delete(id);
    return group;
  }

  clear(): void { this.pending.clear(); this.retiredAcquisitions.clear(); }

  diagnostics() {
    let pendingAgeS = 0;
    for (const request of this.pending.values()) if (request.action === "evaluate")
      pendingAgeS = Math.max(pendingAgeS, this.now() - request.startedAt);
    return { ...this.timing, pendingAgeS };
  }

  private recordDuration(request: ManipulationRequest): void {
    this.timing.maximumDurationS = Math.max(this.timing.maximumDurationS, this.now() - request.startedAt);
  }
}
