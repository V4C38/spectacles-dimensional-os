import { interpolatePose } from "./AnimationUtilities";

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
