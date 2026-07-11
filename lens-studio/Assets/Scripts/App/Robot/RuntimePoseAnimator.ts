import { interpolatePose } from "../Utilities/AnimationUtilities";

export type RuntimePoseSetTargetResult = "immediate" | "track";

export type RuntimePoseTarget = {
  position: vec3;
  rotation: quat;
  velocityCmPerS: vec3;
  yawRateRadPerS: number;
  /** Bridge odom speed (m/s); used to suppress prediction when stopped. */
  speedMps: number | null;
  poseTs: number;
  receiveMonoS: number;
};

export type RuntimePoseTickResult = {
  position: vec3;
  rotation: quat;
};

/** Fuses odom anchor + velocity prediction into one target; single constant-rate display smooth. */
export class RuntimePoseAnimator {
  static readonly SMOOTHING_RATE = 8.0;
  static readonly SMOOTHING_ROTATION_RATE = 4.5;
  static readonly MAX_EXTRAP_S = 0.55;
  static readonly MAX_EXTRAP_DISPLACEMENT_CM = 40.0;
  static readonly FRESH_SAMPLE_WINDOW_S = 0.05;
  static readonly STOPPED_SPEED_MPS = 0.05;
  static readonly PREDICTION_SPEED_REF_MPS = 0.25;
  static readonly PREDICTION_SPEED_BLEND_BOOST = 0.5;
  static readonly POSITION_Y_BLEND_FACTOR = 0.5;
  static readonly ROTATION_PREDICTION_FACTOR = 0.5;
  static readonly PATH_GOAL_DECEL_LOOKAHEAD_CM = 45.0;
  static readonly PATH_GOAL_STOP_REMAINING_CM = 6.0;
  static readonly POSE_AGE_LOG_INTERVAL_S = 5.0;
  static readonly POSE_AGE_CLAMP_HIT_LOG_THRESHOLD = 0.1;

  private _tracking = false;
  private _base: RuntimePoseTarget | null = null;
  private _pathGoal: vec3 | null = null;
  private _freshSampleUntil = 0;
  private _getRobotClockNowS: (() => number | null) | null = null;
  private _lastPoseAgeLogMono = 0;
  private _recentClampHits = 0;
  private _recentAgeSamples = 0;

  public get isTracking(): boolean {
    return this._tracking;
  }

  public setRobotClockNowProvider(getRobotClockNowS: () => number | null): void {
    this._getRobotClockNowS = getRobotClockNowS;
  }

  public reset(): void {
    this._tracking = false;
    this._base = null;
    this._pathGoal = null;
    this._freshSampleUntil = 0;
    this._recentClampHits = 0;
    this._recentAgeSamples = 0;
  }

  public setPathGoal(goal: vec3 | null): void {
    this._pathGoal = goal === null
      ? null
      : new vec3(goal.x, goal.y, goal.z);
  }

  public setTarget(
    target: RuntimePoseTarget,
    snapImmediate: boolean,
  ): RuntimePoseSetTargetResult {
    const poseTsChanged = this._base === null || this._base.poseTs !== target.poseTs;
    this._base = {
      position: new vec3(target.position.x, target.position.y, target.position.z),
      rotation: new quat(
        target.rotation.w,
        target.rotation.x,
        target.rotation.y,
        target.rotation.z,
      ),
      velocityCmPerS: new vec3(
        target.velocityCmPerS.x,
        target.velocityCmPerS.y,
        target.velocityCmPerS.z,
      ),
      yawRateRadPerS: target.yawRateRadPerS,
      speedMps: target.speedMps,
      poseTs: target.poseTs,
      receiveMonoS: target.receiveMonoS,
    };
    this._tracking = true;
    if (poseTsChanged) {
      this._freshSampleUntil = target.receiveMonoS + RuntimePoseAnimator.FRESH_SAMPLE_WINDOW_S;
    }

    return snapImmediate ? "immediate" : "track";
  }

  public computeUnifiedTarget(now: number): { position: vec3; rotation: quat } | null {
    const base = this._base;
    if (!base) {
      return null;
    }

    const ageS = this._poseAgeS(now, false);
    const predicted = this._predictPose(base, ageS);
    const blends = this._fusionBlends(now, ageS, base);
    const odomPos = base.position;
    const predictPos = predicted.position;
    return {
      position: new vec3(
        RuntimePoseAnimator._lerpScalar(odomPos.x, predictPos.x, blends.xzBlend),
        RuntimePoseAnimator._lerpScalar(odomPos.y, predictPos.y, blends.yBlend),
        RuntimePoseAnimator._lerpScalar(odomPos.z, predictPos.z, blends.xzBlend),
      ),
      rotation: quat.slerp(
        base.rotation,
        predicted.rotation,
        blends.rotationBlend,
      ),
    };
  }

  public tick(
    current: { position: vec3; rotation: quat },
    dt: number,
    now: number,
  ): RuntimePoseTickResult | null {
    if (!this._base || dt <= 0) {
      return null;
    }

    const unified = this.computeUnifiedTarget(now);
    if (!unified) {
      return null;
    }

    const smoothed = interpolatePose(
      current.position,
      unified.position,
      current.rotation,
      unified.rotation,
      dt,
      RuntimePoseAnimator.SMOOTHING_RATE,
      RuntimePoseAnimator.SMOOTHING_ROTATION_RATE,
    );
    this._maybeLogPoseAge(now);
    return {
      position: smoothed.position,
      rotation: smoothed.rotation,
    };
  }

  private _fusionBlends(
    now: number,
    ageS: number,
    base: RuntimePoseTarget,
  ): { xzBlend: number; yBlend: number; rotationBlend: number } {
    if (now < this._freshSampleUntil || !this._shouldPredict(base)) {
      return { xzBlend: 0, yBlend: 0, rotationBlend: 0 };
    }
    const baseBlend = RuntimePoseAnimator._smoothstep01(
      ageS / RuntimePoseAnimator.MAX_EXTRAP_S,
    );
    const speedMps = this._resolveSpeedMps(base);
    const speedT = RuntimePoseAnimator._smoothstep01(
      speedMps / RuntimePoseAnimator.PREDICTION_SPEED_REF_MPS,
    );
    const xzBlend = Math.min(
      1,
      baseBlend + speedT * RuntimePoseAnimator.PREDICTION_SPEED_BLEND_BOOST,
    );
    return {
      xzBlend,
      yBlend: xzBlend * RuntimePoseAnimator.POSITION_Y_BLEND_FACTOR,
      rotationBlend: xzBlend * RuntimePoseAnimator.ROTATION_PREDICTION_FACTOR,
    };
  }

  private _resolveSpeedMps(base: RuntimePoseTarget): number {
    if (base.speedMps !== null) {
      return Math.max(0, base.speedMps);
    }
    const speedCmPerS = Math.sqrt(
      base.velocityCmPerS.x * base.velocityCmPerS.x
        + base.velocityCmPerS.y * base.velocityCmPerS.y
        + base.velocityCmPerS.z * base.velocityCmPerS.z,
    );
    return speedCmPerS / 100.0;
  }

  private _shouldPredict(base: RuntimePoseTarget): boolean {
    const robotNow = this._getRobotClockNowS?.() ?? null;
    if (robotNow === null) {
      return false;
    }
    const remainingCm = this._planarDistanceToGoal(base.position);
    if (
      remainingCm !== null
      && remainingCm < RuntimePoseAnimator.PATH_GOAL_STOP_REMAINING_CM
    ) {
      return false;
    }
    if (base.speedMps !== null) {
      return base.speedMps >= RuntimePoseAnimator.STOPPED_SPEED_MPS;
    }
    const speedCmPerS = Math.sqrt(
      base.velocityCmPerS.x * base.velocityCmPerS.x
        + base.velocityCmPerS.y * base.velocityCmPerS.y
        + base.velocityCmPerS.z * base.velocityCmPerS.z,
    );
    return speedCmPerS >= RuntimePoseAnimator.STOPPED_SPEED_MPS * 100.0;
  }

  private _rawPoseAgeS(now: number): number {
    const base = this._base;
    if (!base) {
      return 0;
    }
    const robotNow = this._getRobotClockNowS?.() ?? null;
    if (robotNow !== null) {
      return robotNow - base.poseTs;
    }
    return now - base.receiveMonoS;
  }

  private _poseAgeS(now: number, recordDiagnostics: boolean): number {
    const rawAge = this._rawPoseAgeS(now);
    const clamped = Math.min(
      Math.max(0, rawAge),
      RuntimePoseAnimator.MAX_EXTRAP_S,
    );
    if (recordDiagnostics) {
      this._recentAgeSamples += 1;
      if (rawAge > RuntimePoseAnimator.MAX_EXTRAP_S) {
        this._recentClampHits += 1;
      }
    }
    return clamped;
  }

  private _maybeLogPoseAge(now: number): void {
    if (now - this._lastPoseAgeLogMono < RuntimePoseAnimator.POSE_AGE_LOG_INTERVAL_S) {
      return;
    }
    this._lastPoseAgeLogMono = now;
    const rawAge = this._rawPoseAgeS(now);
    const clampedAge = this._poseAgeS(now, false);
    const clampFraction = this._recentAgeSamples > 0
      ? this._recentClampHits / this._recentAgeSamples
      : 0;
    const shouldLog = rawAge < 0
      || clampFraction >= RuntimePoseAnimator.POSE_AGE_CLAMP_HIT_LOG_THRESHOLD
      || rawAge > RuntimePoseAnimator.MAX_EXTRAP_S;
    if (shouldLog) {
      print(
        `[RuntimePoseAnimator] pose_age raw=${rawAge.toFixed(3)}s `
        + `clamped=${clampedAge.toFixed(3)}s `
        + `clamp_hit_fraction=${clampFraction.toFixed(2)}`,
      );
      if (rawAge < 0) {
        print("[RuntimePoseAnimator] pose_age negative — check clock offset sign");
      }
    }
    this._recentClampHits = 0;
    this._recentAgeSamples = 0;
  }

  private _planarDistanceToGoal(position: vec3): number | null {
    const goal = this._pathGoal;
    if (!goal) {
      return null;
    }
    const dx = goal.x - position.x;
    const dz = goal.z - position.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  private _scaledPredictionAgeS(ageS: number, base: RuntimePoseTarget): number {
    const remainingCm = this._planarDistanceToGoal(base.position);
    if (remainingCm === null) {
      return ageS;
    }
    if (remainingCm < RuntimePoseAnimator.PATH_GOAL_STOP_REMAINING_CM) {
      return 0;
    }
    const decelT = RuntimePoseAnimator._smoothstep01(
      remainingCm / RuntimePoseAnimator.PATH_GOAL_DECEL_LOOKAHEAD_CM,
    );
    return ageS * decelT;
  }

  private _predictPose(
    base: RuntimePoseTarget,
    ageS: number,
  ): { position: vec3; rotation: quat } {
    const scaledAgeS = this._scaledPredictionAgeS(ageS, base);
    const yScale = RuntimePoseAnimator.POSITION_Y_BLEND_FACTOR;
    const extrapolation = RuntimePoseAnimator._clampDisplacement(
      new vec3(
        base.velocityCmPerS.x * scaledAgeS,
        base.velocityCmPerS.y * scaledAgeS * yScale,
        base.velocityCmPerS.z * scaledAgeS,
      ),
    );
    const position = new vec3(
      base.position.x + extrapolation.x,
      base.position.y + extrapolation.y,
      base.position.z + extrapolation.z,
    );
    const yawDelta = base.yawRateRadPerS * scaledAgeS;
    const halfYaw = yawDelta * 0.5;
    const yawQuat = new quat(Math.cos(halfYaw), 0, Math.sin(halfYaw), 0);
    const rotation = base.rotation.multiply(yawQuat);
    return { position, rotation };
  }

  private static _clampDisplacement(delta: vec3): vec3 {
    const len = Math.sqrt(delta.x * delta.x + delta.y * delta.y + delta.z * delta.z);
    if (len <= RuntimePoseAnimator.MAX_EXTRAP_DISPLACEMENT_CM || len <= 1e-6) {
      return delta;
    }
    const scale = RuntimePoseAnimator.MAX_EXTRAP_DISPLACEMENT_CM / len;
    return new vec3(delta.x * scale, delta.y * scale, delta.z * scale);
  }

  private static _lerpScalar(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  private static _smoothstep01(x: number): number {
    const t = Math.max(0, Math.min(1, x));
    return t * t * (3 - 2 * t);
  }
}
