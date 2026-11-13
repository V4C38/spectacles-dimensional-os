/** One captured drag and an independently authorized secondary gripper press. */
export class ManipulationInputCapture {
  readonly events: {source: string; reason: string}[] = [];
  private record(source: string, reason: string): void {
    this.events.push({source, reason});
    if (this.events.length > 32) this.events.shift();
  }
  private source: string | null = null;
  private readonly presses = new Set<string>();
  get owner(): string | null { return this.source; }
  begin(source: string): boolean {
    if (this.source !== null) return false;
    this.source = source;
    return true;
  }
  pressGripper(source: string): boolean {
    if (this.source === source || this.presses.has(source)) return false;
    this.presses.add(source);
    return true;
  }
  release(source: string, reason = "input released"): boolean {
    this.presses.delete(source);
    if (this.source !== source) return false;
    this.record(source, reason);
    this.source = null;
    return true;
  }
  reset(reason = "input disabled"): void { if (this.source) this.record(this.source, reason); this.source = null; this.presses.clear(); }
}


/** A held pinch entering another collider is not a new selection press. */
export class ManipulationPressEdges {
  private readonly held = new Set<string>();
  observe(source: string, pressed: boolean): boolean {
    if (!pressed) { this.held.delete(source); return false; }
    if (this.held.has(source)) return false;
    this.held.add(source);
    return true;
  }
}
