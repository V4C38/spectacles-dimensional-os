import type { ClientNotification } from "../presentation/NotificationCenter";

export const END_EFFECTOR_STATUS_STYLE = {
  widthM: 0.16, heightM: 0.052, rightM: 0.16, upM: 0.01,
  fadeInS: 0.12, fadeOutS: 0.18,
} as const;

export interface EndEffectorStatusInput {
  blocked: boolean;
  fresh: boolean;
  stopped: boolean;
  moving: boolean;
  rejection: { message: string } | null;
}

function notification(input: EndEffectorStatusInput): ClientNotification | null {
  if (!input.fresh) return { key: "feedback", text: "No feedback", tone: "warning", glyph: "warning" };
  if (input.stopped) return null;
  if (input.moving) return { key: "moving", text: "Executing", tone: "neutral", glyph: "busy" };
  if (input.blocked) return { key: "in-use", text: "Arm in use", tone: "neutral", glyph: "stop" };
  if (input.rejection) return { key: `ik:${input.rejection.message}`, text: input.rejection.message,
    tone: "warning", glyph: "warning" };
  return null;
}

/** Packet revisions do not restart persistent status or its outline animation. */
export class EndEffectorStatus {
  private current: ClientNotification | null = null;
  private startedAt = 0;
  private clearedAt: number | null = null;
  private fadeFrom = 0;

  sample(input: EndEffectorStatusInput, now: number) {
    const next = notification(input);
    if (next && (next.key !== this.current?.key || this.clearedAt !== null)) {
      this.current = next;
      this.startedAt = now;
      this.clearedAt = null;
    } else if (!next && this.current && this.clearedAt === null) {
      this.fadeFrom = Math.min(1, Math.max(0, (now - this.startedAt) / END_EFFECTOR_STATUS_STYLE.fadeInS));
      this.clearedAt = now;
    }
    const elapsedS = Math.max(0, now - this.startedAt);
    const opacity = this.clearedAt === null
      ? Math.min(1, elapsedS / END_EFFECTOR_STATUS_STYLE.fadeInS)
      : this.fadeFrom * Math.max(0, 1 - (now - this.clearedAt) / END_EFFECTOR_STATUS_STYLE.fadeOutS);
    if (this.clearedAt !== null && opacity === 0) this.current = null;
    return { notification: this.current, elapsedS, opacity, scale: 0.9 + 0.1 * opacity };
  }
}
