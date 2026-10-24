/** Authorizes presses as well as release callbacks dispatched independently by XR Blocks. */
export class InteractionCapture<T extends { userData: { id?: number } }> {
  private current: T | null = null;
  private readonly presses = new Map<number, { target: object | undefined; allowed: boolean; consumed: boolean }>();
  get owner(): T | null { return this.current; }

  press(source: T, target: object | undefined): boolean {
    const allowed = !this.current || this.current === source;
    this.presses.set(source.userData.id ?? -1, { target, allowed, consumed: false });
    if (allowed) this.current = source;
    return allowed;
  }
  activate(id: number, target: object): boolean {
    const press = this.presses.get(id);
    if (!press?.allowed || press.consumed || press.target !== target ||
        (this.current && this.current.userData.id !== id)) return false;
    press.consumed = true;
    return true;
  }
  release(source: T): void { if (this.current === source) this.current = null; }
  cancel(): void { this.current = null; this.presses.clear(); }
}
