import animate from "SpectaclesInteractionKit.lspkg/Utils/animate";

// ================================================================
/**
 * Shared animation helpers: cancellation tokens, smoothing math,
 * and SIK animate wrappers for local scale.
 */
// ================================================================

export const DEFAULT_SCALE_ANIMATION_VERSION_KEY = "__scaleAnimationVersion";

export function nextAnimationVersion(store: object, key: string): number {
  const storeAny = store as { [key: string]: number };
  const nextVersion = (storeAny[key] ?? 0) + 1;
  storeAny[key] = nextVersion;
  return nextVersion;
}

export function isLatestAnimationVersion(
  store: object,
  key: string,
  version: number,
): boolean {
  const storeAny = store as { [key: string]: number };
  return storeAny[key] === version;
}

export function lerpVec3(a: vec3, b: vec3, t: number): vec3 {
  return new vec3(
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
    a.z + (b.z - a.z) * t,
  );
}

export function exponentialSmoothAlpha(dt: number, rate: number): number {
  return dt > 0 ? 1.0 - Math.exp(-rate * dt) : 1.0;
}

export function smoothScalar(
  current: number,
  target: number,
  dt: number,
  rate: number,
): number {
  if (dt <= 0) {
    return target;
  }
  const alpha = exponentialSmoothAlpha(dt, rate);
  return current + (target - current) * alpha;
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
  return {
    position: vec3.lerp(currentPos, targetPos, alpha),
    rotation: quat.slerp(currentRot, targetRot, rotationAlpha),
  };
}

export type AnimateEasing = NonNullable<Parameters<typeof animate>[0]["easing"]>;

export type AnimateLocalScaleOptions = {
  easing?: AnimateEasing;
  onEnded?: () => void;
  enableOnStart?: boolean;
  disableOnEnd?: boolean;
  fixedVersion?: number;
};

export function animateLocalScale(
  object: SceneObject,
  targetScale: vec3,
  duration: number,
  versionStore: object,
  versionKey: string,
  options?: AnimateLocalScaleOptions,
): void {
  const transform = object.getTransform();
  const start = transform.getLocalScale();
  const version =
    options?.fixedVersion ?? nextAnimationVersion(versionStore, versionKey);
  if (options?.enableOnStart) {
    object.enabled = true;
  }
  animate({
    duration,
    easing: options?.easing ?? "ease-in-out-quad",
    update: (t: number) => {
      if (!isLatestAnimationVersion(versionStore, versionKey, version)) {
        return;
      }
      transform.setLocalScale(lerpVec3(start, targetScale, t));
    },
    ended: () => {
      if (!isLatestAnimationVersion(versionStore, versionKey, version)) {
        return;
      }
      transform.setLocalScale(targetScale);
      if (options?.disableOnEnd) {
        object.enabled = false;
      }
      options?.onEnded?.();
    },
  });
}

export function scaleIn(
  sceneObject: SceneObject,
  duration: number = 0.5,
  targetScale: vec3 = new vec3(1, 1, 1),
): Promise<void> {
  const transform = sceneObject.getTransform();
  const wasEnabled = sceneObject.enabled;
  const start = wasEnabled ? transform.getLocalScale() : new vec3(0, 0, 0);
  const target = targetScale;
  const versionKey = DEFAULT_SCALE_ANIMATION_VERSION_KEY;
  const version = nextAnimationVersion(sceneObject, versionKey);
  sceneObject.enabled = true;
  transform.setLocalScale(start);
  return new Promise((resolve) => {
    animate({
      duration,
      easing: "ease-in-out-quad",
      update: (t: number) => {
        transform.setLocalScale(lerpVec3(start, target, t));
      },
      ended: () => {
        if (!isLatestAnimationVersion(sceneObject, versionKey, version)) {
          resolve();
          return;
        }
        transform.setLocalScale(target);
        resolve();
      },
    });
  });
}

export function animateScaleTo(
  sceneObject: SceneObject,
  target: vec3,
  duration: number = 0.12,
): void {
  animateLocalScale(
    sceneObject,
    target,
    duration,
    sceneObject,
    DEFAULT_SCALE_ANIMATION_VERSION_KEY,
  );
}

export function scaleOut(
  sceneObject: SceneObject,
  duration: number = 0.5,
): Promise<void> {
  const transform = sceneObject.getTransform();
  const start = transform.getLocalScale();
  const target = new vec3(0, 0, 0);
  const versionKey = DEFAULT_SCALE_ANIMATION_VERSION_KEY;
  const version = nextAnimationVersion(sceneObject, versionKey);
  return new Promise((resolve) => {
    animate({
      duration,
      easing: "ease-in-out-quad",
      update: (t: number) => {
        transform.setLocalScale(lerpVec3(start, target, t));
      },
      ended: () => {
        if (!isLatestAnimationVersion(sceneObject, versionKey, version)) {
          resolve();
          return;
        }
        sceneObject.enabled = false;
        transform.setLocalScale(target);
        resolve();
      },
    });
  });
}
