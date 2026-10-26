/** Physical world-annotation styles. Host UI uses its own platform's design system. */
import type { Vec3 } from "../websocket/protocolTypes";

/** One physical dash pattern for robot bounds, advisory routes and world connectors. */
export const WORLD_DASH_STYLE = { widthM: 0.00275, dashM: 0.012, gapM: 0.01 } as const;

export const FLOOR_MARKER_STYLE = {
  strokeM: 0.008, radiusM: 0.2144, idleOpacity: 0.35,
  selectedOpacity: 0.6, dragOpacity: 0.85,
} as const;

export const ROBOT_LINE_STYLE = {
  hoverWidthM: 0.0008, selectedWidthM: WORLD_DASH_STYLE.widthM,
  hoverOpacity: 0.45, selectedOpacity: 0.8, dashM: WORLD_DASH_STYLE.dashM, gapM: WORLD_DASH_STYLE.gapM,
} as const;

export const ROUTE_STYLE = {
  strokeM: WORLD_DASH_STYLE.widthM, dashM: WORLD_DASH_STYLE.dashM, gapM: WORLD_DASH_STYLE.gapM, ribbonWidthM: 0.008,
  previewOpacity: 0.6, confirmedOpacity: 0.85,
} as const;

/** Connected circle segments keep dash distances physical as the marker radius changes. */
export function circleStrokeSegments(radius: number, segments = 128): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i < segments; i++) {
    const a = i / segments * Math.PI * 2, b = (i + 1) / segments * Math.PI * 2;
    points.push([Math.cos(a) * radius, 0, Math.sin(a) * radius],
      [Math.cos(b) * radius, 0, Math.sin(b) * radius]);
  }
  return points;
}

/** The attached floor marker and robot box share hover; detached goals remain independent. */
export function worldMarkerHover(attachedToRobot: boolean, robotHovered: boolean, markerHovered: boolean) {
  return { robot: robotHovered || attachedToRobot && markerHovered,
    marker: markerHovered || attachedToRobot && robotHovered };
}

export const NAVIGATION_COLORS = {
  succeeded: [0x30 / 255, 0xd1 / 255, 0x58 / 255],
  cancelled: [1, 0x45 / 255, 0x3a / 255],
  failed: [1, 0x9f / 255, 0x0a / 255],
} as const;

export function robotOutlineFrame(progress: number, selection: number) {
  const ease = (t: number) => { const v = Math.max(0, Math.min(1, t)); return v * v * (3 - 2 * v); };
  return {
    horizontal: ease(progress / 0.4), vertical: ease((progress - 0.4) / 0.6),
    widthM: ROBOT_LINE_STYLE.hoverWidthM + (ROBOT_LINE_STYLE.selectedWidthM - ROBOT_LINE_STYLE.hoverWidthM) * selection,
    opacity: (ROBOT_LINE_STYLE.hoverOpacity + (ROBOT_LINE_STYLE.selectedOpacity - ROBOT_LINE_STYLE.hoverOpacity) * selection) * ease(progress / 0.4),
  };
}

/** World label measurements and typography are identical in both hosts. */
export const ROBOT_LABEL_STYLE = {
  widthM: 0.24, paddingM: 0.014, offsetYM: 0.075,
  title: { emM: 0.02, xM: 0.008, yM: 0.09, widthM: 0.196 },
  activity: { emM: 0.028, yM: 0.064, widthM: 0.212 },
  detail: { emM: 0.013, yM: 0.026, widthM: 0.212 },
  dot: { radiusM: 0.0045, yM: 0.079, gapM: 0.016 },
} as const;
export const SETUP_SUCCESS_STYLE = {
  radiusM: 0.094, strokeM: 0.004, centerYM: 0.06, segments: 96, glyphWidthM: 0.009,
  check: [[-0.044, 0.06], [-0.012, 0.03], [0.05, 0.096]],
} as const;
export const NAVIGATION_OUTCOME_STYLE = {
  glyphWidthM: 0.012, segments: 128,
  check: [[-0.07, 0], [-0.015, -0.055], [0.09, 0.07]],
  cross: [[-0.065, -0.065], [0.065, 0.065], [-0.065, 0.065], [0.065, -0.065]],
} as const;

/** Round joins close the wedge between independently animated stroke quads. */
export const STROKE_JOIN_SEGMENTS = 16;
export function strokeJoints2D(segments: readonly (readonly number[])[], progresses: readonly number[]): number[][] {
  const joints: number[][] = [];
  for (let i = 1; i < segments.length; i++) {
    const previous = segments[i - 1], current = segments[i];
    if ((progresses[i - 1] ?? 0) >= 1 && (progresses[i] ?? 0) > 0 &&
        Math.abs(previous[2] - current[0]) < 1e-8 && Math.abs(previous[3] - current[1]) < 1e-8) {
      joints.push([current[0], current[1]]);
    }
  }
  return joints;
}

/** Lower-view popups face slightly upward toward the wearer. */
export const VIEWER_NOTIFICATION_STYLE = { upwardTiltRad: Math.PI / 15 } as const;

export const NAVIGATION_CANCEL_STYLE = { revealS: 0.28, heightM: 0.38, connectorClearanceM: 0.105 } as const;

/** Cancel rises and grows together; its connector ends below the scaled label. */
export function navigationCancelReveal(progress: number, circleHeightM: number) {
  const t = Math.max(0, Math.min(1, progress));
  const scale = t * t * (3 - 2 * t);
  const heightM = circleHeightM + (NAVIGATION_CANCEL_STYLE.heightM - circleHeightM) * scale;
  return { scale, heightM, connectorTopM: Math.max(circleHeightM, heightM - NAVIGATION_CANCEL_STYLE.connectorClearanceM * scale) };
}

export const NAVIGATION_PREVIEW_ARROW_STYLE = { widthScale: 0.8, opacityScale: 0.8 } as const;
