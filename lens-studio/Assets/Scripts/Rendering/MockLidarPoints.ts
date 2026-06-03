/** Static world-frame mock scan for offline debug preview (protocol metres). */

const GRID_MIN = -2.0;
const GRID_MAX = 2.0;
const GRID_STEP = 0.4;
const MAX_MOCK_POINTS = 1000;

function pushPoint(
  points: [number, number, number][],
  x: number,
  y: number,
  z: number,
): void {
  if (points.length >= MAX_MOCK_POINTS) {
    return;
  }
  points.push([x, y, z]);
}

/** 0..1 across the mock grid extent. */
function gridT(value: number): number {
  return clamp((value - GRID_MIN) / (GRID_MAX - GRID_MIN), 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function buildMockLidarPoints(): [number, number, number][] {
  const points: [number, number, number][] = [];

  // Height field: west→east ramp, south→north ramp, radial dome, and diagonal mix.
  for (let x = GRID_MIN; x <= GRID_MAX + 0.001; x += GRID_STEP) {
    for (let z = GRID_MIN; z <= GRID_MAX + 0.001; z += GRID_STEP) {
      const tx = gridT(x);
      const tz = gridT(z);
      const radial = Math.sqrt(x * x + z * z);
      const dome = 0.08 + 0.72 * Math.exp(-(radial * radial) / 2.5);

      pushPoint(points, x, 0.02 + 0.78 * tx, z);
      pushPoint(points, x, 0.02 + 0.78 * tz, z);
      pushPoint(points, x, dome, z);
      pushPoint(points, x, 0.05 + 0.75 * (0.5 * tx + 0.5 * tz), z);

      if (Math.abs(x) < 0.21 && Math.abs(z) < 0.21) {
        pushPoint(points, x, 0.02, z);
      }
    }
  }

  // Calibration ladders (full blue→white sweep at fixed X).
  for (let i = 0; i <= 12; i++) {
    const y = 0.02 + i * 0.06;
    pushPoint(points, -1.75, y, 0);
    pushPoint(points, 1.75, y, 0);
    pushPoint(points, 0, y, -1.75);
  }

  // Scattered vertical stacks away from the ladders.
  const stacks: [number, number][] = [
    [-1.0, -1.0],
    [-0.4, 1.2],
    [0.5, -0.6],
    [1.1, 1.0],
  ];
  for (const [sx, sz] of stacks) {
    for (let i = 0; i < 8; i++) {
      pushPoint(points, sx, 0.04 + i * 0.09, sz);
    }
  }

  // Near-origin cluster so debug preview is visible before robot pose arrives.
  for (let i = 0; i < 6; i++) {
    pushPoint(points, 0.15 * i, 0.08 + i * 0.12, 0.1 * i);
  }

  return points;
}
