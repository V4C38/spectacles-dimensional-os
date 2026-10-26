import { CONTROL_PANEL_LAYOUT, CONTROL_PANEL_CONTROLS, CONTROL_PANEL_MESSAGE } from "@dimos-ar-client/presentation/ControlPanelPresentation";
/** Shared dimOS AR tokens: pill controls, softly rounded fields, and the existing panel edge. */
export const DIMOS_AR_DESIGN = {
  colors: {
    ink: "#ffffff", muted: "#aeaeb2", faint: "#8e8e93", disabled: "#636366",
    fill: "#2c2c2e", control: "#3a3a3c", field: "#1c1c1e", separator: "#38383a",
    accent: "#ffffff", primary: "#ffffff", primaryText: "#171719", secondary: "#3a3a3c", selected: "#ffffff", success: "#30d158", warning: "#ff9f0a", danger: "#ff453a", chrome: "#d1d1d6", background: "#202022",
  },
  panel: CONTROL_PANEL_LAYOUT,
  depth: { surface: 0.005, text: 0.0055, labelOffset: 0.0005, secondary: 0.004, primary: 0.008, hover: 0.003, thickness: 0.004 },
  controls: CONTROL_PANEL_CONTROLS,
  corners: { field: 0.024, controlRatio: 0.5 },
  dom: { panelRadius: "12px", controlRadius: "6px", fieldRadius: "6px" },
  message: CONTROL_PANEL_MESSAGE,
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

/** Physical floor-marker styling, independent of each marker's radius. */
export { FLOOR_MARKER_STYLE, ROBOT_LINE_STYLE } from "@dimos-ar-client/presentation/WorldVisualStyle";
