import type { Text } from "troika-three-text";
import regular from "@fontsource/inter/files/inter-latin-400-normal.woff?url";
import semibold from "@fontsource/inter/files/inter-latin-600-normal.woff?url";

// Troika parses woff but not woff2.
export const UI_FONT_REGULAR = regular;
export const UI_FONT_SEMIBOLD = semibold;

// Troika's render-time sync does not fire for these meshes in XR, so sync explicitly.
// It typesets in a worker, which unit test environments lack.
export function syncText(...texts: Text[]): void {
  if (typeof Worker === "undefined") return;
  for (const text of texts) text.sync();
}
