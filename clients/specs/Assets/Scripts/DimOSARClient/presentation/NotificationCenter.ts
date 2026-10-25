export type ClientNotification = {
  text: string; tone?: "neutral" | "danger" | "success";
  glyph?: "stop" | "cross" | "check"; durationS?: number; priority?: number;
};
/** Portable lifetime and preemption. Hosts advance this only while presenting visible frames. */
export class NotificationCenter {
  private current: ClientNotification | null = null;
  private elapsed = 0;
  private revision = 0;
  show(notification: ClientNotification): void {
    if (this.current && (notification.priority ?? 0) < (this.current.priority ?? 0)) return;
    this.current = { ...notification }; this.elapsed = 0; this.revision++;
  }
  tick(deltaS: number): void {
    if (!this.current) return;
    this.elapsed += Math.max(0, deltaS);
    if (this.elapsed >= (this.current.durationS ?? 2.5)) this.current = null;
  }
  snapshot() { return { notification: this.current && { ...this.current }, elapsedS: this.elapsed, revision: this.revision }; }
}
