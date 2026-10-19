/** Same palm-up thresholds and debounce intervals as Specs. Normals come from XR joints. */
export class PalmMenuGate {
  isOpen = false;
  private pending: boolean | null = null;
  private since = 0;

  update(dotUp: number | null, now: number): boolean {
    if (dotUp === null) {
      const changed = this.isOpen;
      this.reset();
      return changed;
    }
    const wantsOpen = dotUp >= Math.cos((this.isOpen ? 70 : 50) * Math.PI / 180);
    if (wantsOpen === this.isOpen) { this.pending = null; return false; }
    if (this.pending !== wantsOpen) { this.pending = wantsOpen; this.since = now; return false; }
    if (now - this.since < (wantsOpen ? 0.28 : 0.08)) return false;
    this.isOpen = wantsOpen;
    this.pending = null;
    return true;
  }

  reset(): void { this.isOpen = false; this.pending = null; }
}
