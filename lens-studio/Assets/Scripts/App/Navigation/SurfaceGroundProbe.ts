import { smoothScalar } from "../Utilities/AnimationUtilities";

const GROUND_NORMAL_MIN_Y = 0.95;
const SURFACE_RAY_START_Y_OFFSET_CM = 120;
const SURFACE_RAY_END_Y_OFFSET_CM = 220;
const GROUND_Y_OFFSET_CM = 5;
const Y_SMOOTHING_RATE = 10.0;
const ROBOT_GROUND_DEADZONE_RADIUS_CM = 75;
const ROBOT_GROUND_DEADZONE_EXIT_MARGIN_CM = 12;

const Y_SAMPLE_WINDOW_S = 0.35;
const Y_MAX_SAMPLES = 24;
const Y_MIN_SAMPLES_FOR_MEDIAN = 3;

export type RobotGroundDeadzone = {
  radiusCm: number;
  getRobotWorldPosition: () => vec3 | null;
  getRobotFloorWorldY: () => number | null;
};

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let index = 0; index < values.length; index++) {
    sum += values[index];
  }
  return sum / values.length;
}

class SurfaceYFilter {
  private _samples: { y: number; time: number }[] = [];
  private _smoothedY = 0;

  public reset(y: number): void {
    this._samples = [];
    this._smoothedY = y;
  }

  public push(rawY: number, now: number = getTime()): void {
    this._prune(now);
    this._samples.push({ y: rawY, time: now });
    if (this._samples.length > Y_MAX_SAMPLES) {
      this._samples.shift();
    }
  }

  public filteredY(): number {
    if (this._samples.length === 0) {
      return this._smoothedY;
    }
    const ys = this._samples.map((sample) => sample.y);
    return ys.length >= Y_MIN_SAMPLES_FOR_MEDIAN ? median(ys) : average(ys);
  }

  public smoothTo(targetY: number, dt: number): number {
    this._smoothedY = smoothScalar(this._smoothedY, targetY, dt, Y_SMOOTHING_RATE);
    return this._smoothedY;
  }

  private _prune(now: number): void {
    while (this._samples.length > 0) {
      if (now - this._samples[0].time <= Y_SAMPLE_WINDOW_S) {
        break;
      }
      this._samples.shift();
    }
  }
}

/** Ground-ray Y probing, smoothing, and robot deadzone — no marker references. */
export class SurfaceGroundProbe {
  private readonly _yFilter = new SurfaceYFilter();
  private _floorY = 0;
  private _wasDragInsideDeadzone = false;
  private _robotGroundDeadzone: RobotGroundDeadzone | null = null;

  public get floorY(): number {
    return this._floorY;
  }

  public set floorY(value: number) {
    this._floorY = value;
  }

  public reset(y: number): void {
    this._floorY = y;
    this._wasDragInsideDeadzone = false;
    this._yFilter.reset(y);
  }

  public setRobotGroundDeadzone(deadzone: RobotGroundDeadzone | null): void {
    if (!deadzone) {
      this._robotGroundDeadzone = null;
      return;
    }
    this._robotGroundDeadzone = {
      radiusCm: deadzone.radiusCm > 0
        ? deadzone.radiusCm
        : ROBOT_GROUND_DEADZONE_RADIUS_CM,
      getRobotWorldPosition: deadzone.getRobotWorldPosition,
      getRobotFloorWorldY: deadzone.getRobotFloorWorldY,
    };
  }

  public resolveDragPoint(planarPoint: vec3, dt: number): vec3 {
    const insideDeadzone = this._isDragInsideDeadzone(planarPoint);

    if (insideDeadzone) {
      this._wasDragInsideDeadzone = true;
      const y =
        (this._robotGroundDeadzone?.getRobotFloorWorldY() ?? this._floorY) +
        GROUND_Y_OFFSET_CM;
      this._floorY = y;
      return new vec3(planarPoint.x, y, planarPoint.z);
    }

    if (this._wasDragInsideDeadzone) {
      this._yFilter.reset(this._floorY);
      this._wasDragInsideDeadzone = false;
    }

    const targetY = this._yFilter.filteredY();
    const smoothedY = this._yFilter.smoothTo(targetY, dt);
    this._floorY = smoothedY;
    return new vec3(planarPoint.x, smoothedY, planarPoint.z);
  }

  public probeSurfaceY(planarPoint: vec3, hitTestSession: any): void {
    if (this._isDragInsideDeadzone(planarPoint)) {
      return;
    }
    if (!hitTestSession) {
      return;
    }
    const rayStart = this._offsetPointY(planarPoint, SURFACE_RAY_START_Y_OFFSET_CM);
    const rayEnd = this._offsetPointY(planarPoint, -SURFACE_RAY_END_Y_OFFSET_CM);
    let consumed = false;
    const consumeOnce = (rawResults: any) => {
      if (consumed) {
        return;
      }
      consumed = true;
      const first = Array.isArray(rawResults) ? rawResults[0] : rawResults;
      const foundPosition = first?.position ?? first?.hit?.position ?? null;
      const foundNormal = first?.normal ?? first?.hit?.normal ?? null;
      if (!foundPosition || !foundNormal || !this._isGroundLikeHit(foundNormal)) {
        return;
      }
      this._yFilter.push(foundPosition.y + GROUND_Y_OFFSET_CM);
    };
    const maybeResults = hitTestSession.hitTest(
      rayStart,
      rayEnd,
      (result: any) => consumeOnce(result),
    );
    if (maybeResults !== undefined) {
      consumeOnce(maybeResults);
    }
  }

  private _offsetPointY(point: vec3, yOffsetCm: number): vec3 {
    return new vec3(point.x, point.y + yOffsetCm, point.z);
  }

  private _isDragInsideDeadzone(point: vec3): boolean {
    if (!this._robotGroundDeadzone) {
      return false;
    }
    const robotPosition = this._robotGroundDeadzone.getRobotWorldPosition();
    if (!robotPosition) {
      return false;
    }
    const dx = point.x - robotPosition.x;
    const dz = point.z - robotPosition.z;
    const horizontalDistance = Math.sqrt(dx * dx + dz * dz);
    const threshold = this._wasDragInsideDeadzone
      ? this._robotGroundDeadzone.radiusCm + ROBOT_GROUND_DEADZONE_EXIT_MARGIN_CM
      : this._robotGroundDeadzone.radiusCm;
    return horizontalDistance < threshold;
  }

  private _isGroundLikeHit(normal: vec3): boolean {
    const length = Math.sqrt(
      normal.x * normal.x + normal.y * normal.y + normal.z * normal.z,
    );
    if (length <= 0.0001) {
      return false;
    }
    const normalizedY = normal.y / length;
    return normalizedY > GROUND_NORMAL_MIN_Y;
  }
}
