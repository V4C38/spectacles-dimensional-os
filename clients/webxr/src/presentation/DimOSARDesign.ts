/** Shared dimOS AR tokens: pill controls, softly rounded fields, and the existing panel edge. */
export const DIMOS_AR_DESIGN = {
  colors: {
    ink: "#ffffff", muted: "#aeaeb2", faint: "#8e8e93", disabled: "#636366",
    fill: "#2c2c2e", control: "#3a3a3c", field: "#1c1c1e", separator: "#38383a",
    accent: "#0a84ff", danger: "#ff453a", chrome: "#d1d1d6", background: "#182028",
  },
  panel: { width: 0.9, height: 0.76, margin: 0.05, cornerRadius: 0.05 },
  depth: { surface: 0.005, text: 0.0055, labelOffset: 0.0005, thickness: 0.001 },
  controls: { height: 0.064, iconSize: 0.072, gap: 0.02 },
  corners: { field: 0.024, controlRatio: 0.5 },
  dom: { panelRadius: "32px", controlRadius: "999px", fieldRadius: "20px" },
  message: { height: 0.12, padding: 0.028, captionHeight: 0.02, captionY: 0.033, textY: -0.016, textHeight: 0.057 },
  scroll: { width: 0.012, hitWidth: 0.035, minimumThumb: 0.025, gap: 0.014 },
  motion: { transitionS: 0.18 },
} as const;

export function cornerRadius(width: number, height: number): number {
  return Math.min(DIMOS_AR_DESIGN.corners.field, Math.min(width, height) / 2);
}

export function applyDOMDesign(element: HTMLElement): void {
  for (const [name, color] of Object.entries(DIMOS_AR_DESIGN.colors)) element.style.setProperty(`--dimos-color-${name}`, color);
  for (const [name, value] of Object.entries(DIMOS_AR_DESIGN.dom)) element.style.setProperty(`--dimos-${name}`, value);
}
