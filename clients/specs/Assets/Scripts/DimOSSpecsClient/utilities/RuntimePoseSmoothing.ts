import { lerpVec3, slerpQuat } from "DimOSARClient.lspkg/Scripts/DimOSARClient/localization/ClientTracking";

export function exponentialSmoothAlpha(dt: number, rate: number): number {
  return dt > 0 ? 1.0 - Math.exp(-rate * dt) : 1.0;
}

export function interpolatePose(
  currentPos: vec3,
  targetPos: vec3,
  currentRot: quat,
  targetRot: quat,
  dt: number,
  positionRate: number,
  rotationRate: number = positionRate,
): { position: vec3; rotation: quat } {
  const alpha = exponentialSmoothAlpha(dt, positionRate);
  const rotationAlpha = exponentialSmoothAlpha(dt, rotationRate);
  const position = lerpVec3([currentPos.x, currentPos.y, currentPos.z],
    [targetPos.x, targetPos.y, targetPos.z], alpha);
  // Immediate native placement preserves the authored endpoint components exactly.
  if (rotationAlpha === 1) {
    return { position: new vec3(...position),
      rotation: new quat(targetRot.w, targetRot.x, targetRot.y, targetRot.z) };
  }
  const [x, y, z, w] = slerpQuat([currentRot.x, currentRot.y, currentRot.z, currentRot.w],
    [targetRot.x, targetRot.y, targetRot.z, targetRot.w], rotationAlpha);
  return { position: new vec3(...position), rotation: new quat(w, x, y, z) };
}

export type RuntimePoseTarget = {
  position: vec3;
  rotation: quat;
};

export class RuntimePoseSmoothing {
  static readonly SMOOTHING_RATE = 8.0;
  static readonly SMOOTHING_ROTATION_RATE = 4.5;

  private _tracking = false;
  private _target: RuntimePoseTarget | null = null;

  public get isTracking(): boolean {
    return this._tracking;
  }

  public reset(): void {
    this._tracking = false;
    this._target = null;
  }

  public setTarget(target: RuntimePoseTarget, snapImmediate: boolean): "immediate" | "track" {
    this._target = {
      position: new vec3(target.position.x, target.position.y, target.position.z),
      rotation: new quat(
        target.rotation.w,
        target.rotation.x,
        target.rotation.y,
        target.rotation.z,
      ),
    };
    this._tracking = true;
    return snapImmediate ? "immediate" : "track";
  }

  public tick(
    current: { position: vec3; rotation: quat },
    dt: number,
  ): { position: vec3; rotation: quat } | null {
    if (!this._target || dt <= 0) {
      return null;
    }
    return interpolatePose(
      current.position,
      this._target.position,
      current.rotation,
      this._target.rotation,
      dt,
      RuntimePoseSmoothing.SMOOTHING_RATE,
      RuntimePoseSmoothing.SMOOTHING_ROTATION_RATE,
    );
  }
}
