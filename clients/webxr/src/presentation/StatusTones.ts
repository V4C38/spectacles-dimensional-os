import type { StatusTone } from "@dimos-ar-client/websocket/sessionLinkStatus";

export const TONE_HEX: Record<StatusTone, number> = {
  // Apple dark-appearance system colors.
  error: 0xff453a,
  warn: 0xff9f0a,
  success: 0x30d158,
  neutral: 0xffffff,
  muted: 0x8e8e93,
};

export function toneHex(tone: StatusTone): number {
  return TONE_HEX[tone];
}

export function toneCss(tone: StatusTone): string {
  return `#${toneHex(tone).toString(16).padStart(6, "0")}`;
}
