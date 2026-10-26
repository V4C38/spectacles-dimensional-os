import type { Vec3 } from "../../DimOSARClient/websocket/protocolTypes";

export const CURSOR_LASER_STYLE = {
  startOffsetCm: 10,
  opacity: 0.45,
  radiusCm: 0.08,
  tipRadiusCm: 0.055,
  outlineRadiusCm: 0.14,
  outlineTipRadiusCm: 0.095,
} as const;

export interface LaserPointer {
  id: number;
  active: boolean;
  origin: Vec3;
  cursor: Vec3;
  shown: boolean;
  opacity: number;
}

export interface LaserFrame {
  start: Vec3;
  control: Vec3;
  end: Vec3;
  opacity: number;
}

/** A straight line to the rendered cursor, with no independent smoothing or reveal animation. */
export function cursorLaserFrame(pointer: LaserPointer): LaserFrame | null {
  if (!pointer.active || !pointer.shown || !pointer.origin.every(Number.isFinite) ||
    !pointer.cursor.every(Number.isFinite) || !Number.isFinite(pointer.opacity) || pointer.opacity <= 0.01) return null;
  const delta = pointer.cursor.map((v, axis) => v - pointer.origin[axis]);
  const distance = Math.hypot(...delta);
  if (distance < 0.5) return null;
  const offset = Math.min(CURSOR_LASER_STYLE.startOffsetCm, distance - 0.5);
  const start = pointer.origin.map((v, axis) => v + delta[axis] * offset / distance) as Vec3;
  return { start, control: start.map((v, axis) => (v + pointer.cursor[axis]) / 2) as Vec3,
    end: [...pointer.cursor], opacity: Math.min(1, pointer.opacity) * CURSOR_LASER_STYLE.opacity };
}
