/** The single robot selection owner. Views receive facts; hover never changes selection. */
export class RobotSelection {
  private selected = false;
  private eligible = false;
  private readonly listeners = new Set<(selected: boolean) => void>();

  isSelected(): boolean { return this.selected; }
  snapshot(): Readonly<{ selected: boolean; eligible: boolean }> { return { selected: this.selected, eligible: this.eligible }; }
  setEligible(eligible: boolean): void { this.eligible = eligible; if (!eligible) this.clear(); }
  setSelected(selected: boolean): void {
    const next = selected && this.eligible;
    if (next === this.selected) return;
    this.selected = next;
    for (const listener of this.listeners) listener(next);
  }
  toggle(): void { this.setSelected(!this.selected); }
  clear(): void { this.setSelected(false); }
  subscribe(listener: (selected: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}
