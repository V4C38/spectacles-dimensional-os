/** One captured drag and an independently authorized secondary gripper press. */
export class ManipulationInputCapture {
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
  releaseGripper(source: string): void { this.presses.delete(source); }
  release(source: string): boolean {
    this.presses.delete(source);
    if (this.source !== source) return false;
    this.source = null;
    return true;
  }
  reset(): void { this.source = null; this.presses.clear(); }
}
