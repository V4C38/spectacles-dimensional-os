export interface UILogEntry {
  text: string;
  color: vec4;
  expiresAt: number | null;
}

/** Transient HUD feedback. Persistent diagnostics have their own presentation. */
export class UILogger {
  private entry: UILogEntry | null = null;

  get snapshot(): UILogEntry | null {
    const entry = this.entry;
    return entry && { ...entry, color: new vec4(entry.color.x, entry.color.y, entry.color.z, entry.color.w) };
  }

  show(text: string, color: vec4, durationSecs: number | null = null): void {
    this.entry = { text, color: new vec4(color.x, color.y, color.z, color.w),
      expiresAt: durationSecs !== null && durationSecs > 0 ? getTime() + durationSecs : null };
  }

  clear(): void { this.entry = null; }

  tick(now = getTime()): void {
    if (this.entry?.expiresAt !== null && this.entry && now >= this.entry.expiresAt) this.entry = null;
  }
}
