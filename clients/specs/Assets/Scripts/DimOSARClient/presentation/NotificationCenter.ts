export type ClientNotification = {
  key?: string;
  text: string; tone?: "neutral" | "danger" | "success" | "warning";
  glyph?: "stop" | "cross" | "check" | "warning"; durationS?: number; priority?: number;
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
  clear(key: string): void { if (this.current?.key === key) this.current = null; }
  tick(deltaS: number): void {
    if (!this.current) return;
    this.elapsed += Math.max(0, deltaS);
    if (this.elapsed >= (this.current.durationS ?? 2.5)) this.current = null;
  }
  snapshot() { return { notification: this.current && { ...this.current }, elapsedS: this.elapsed, revision: this.revision }; }
}

export type NotificationSegment = readonly [number, number, number, number];
/** Shared outline-first drawing used by both host renderers. */
export function notificationGlyph(glyph: ClientNotification["glyph"], elapsed: number): NotificationSegment[] {
  const outline: NotificationSegment[] = [], symbol: NotificationSegment[] = [];
  if (glyph === "warning") {
    outline.push([0, 1.3, -1.4, -1.1], [-1.4, -1.1, 1.4, -1.1], [1.4, -1.1, 0, 1.3]);
    symbol.push([0, 0.65, 0, -0.3], [0, -0.65, 0, -0.8]);
  } else if (glyph === "stop") {
    for (let i = 0; i < 48; i++) {
      const a = i * Math.PI / 24, b = (i + 1) * Math.PI / 24;
      outline.push([1.4 * Math.cos(a), 1.4 * Math.sin(a), 1.4 * Math.cos(b), 1.4 * Math.sin(b)]);
    }
    symbol.push([-1, 1, 1, -1]);
  } else if (glyph === "check") symbol.push([-1.1, 0, -0.3, -0.8], [-0.3, -0.8, 1.2, 1]);
  else if (glyph === "cross") symbol.push([-1, -1, 1, 1], [-1, 1, 1, -1]);
  const draw = (segments: NotificationSegment[], progress: number): NotificationSegment[] => {
    const result: NotificationSegment[] = [];
    segments.forEach(([x, y, ex, ey], i) => {
      const t = Math.max(0, Math.min(1, progress * segments.length - i));
      if (t > 0) result.push([x, y, x + (ex - x) * t, y + (ey - y) * t]);
    });
    return result;
  };
  return [...draw(outline, elapsed / 0.25), ...draw(symbol, (elapsed - (outline.length ? 0.25 : 0)) / 0.15)];
}

export function applyLocalizationNotification(
  message: import("../websocket/protocolTypes").Outbound,
  presenter: { show(value: ClientNotification): void; clear(key: string): void },
): void {
  if (message.type === "localization_result") presenter.clear("tracking:headset");
  if (message.type !== "localization_status") return;
  const key = `tracking:${message.scope}`;
  if (message.status === "succeeded") presenter.clear(key);
  if (message.status === "failed") presenter.show({ key, text: "Tracking Inaccurate", tone: "warning",
    glyph: "warning", durationS: 2.5, priority: 50 });
}
