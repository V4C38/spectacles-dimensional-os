import type { StatusTone } from "@dimos-ar-client/websocket/sessionLinkStatus";

export const TONE_HEX: Record<StatusTone, number> = {
  error: 0xff0000,
  warn: 0xffd900,
  success: 0x00ff00,
  neutral: 0xffffff,
  muted: 0x8c8c8c,
};

export function toneHex(tone: StatusTone): number {
  return TONE_HEX[tone];
}

export function toneCss(tone: StatusTone): string {
  return `#${toneHex(tone).toString(16).padStart(6, "0")}`;
}
