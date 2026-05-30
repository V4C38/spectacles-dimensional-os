import animate from "SpectaclesInteractionKit.lspkg/Utils/animate";

const SCALE_ANIMATION_VERSION_KEY = "__cursorScaleAnimationVersion";

function nextAnimationVersion(sceneObject: SceneObject): number {
  const sceneObjectAny = sceneObject as unknown as { [key: string]: number };
  const nextVersion = (sceneObjectAny[SCALE_ANIMATION_VERSION_KEY] ?? 0) + 1;
  sceneObjectAny[SCALE_ANIMATION_VERSION_KEY] = nextVersion;
  return nextVersion;
}

function isLatestAnimationVersion(
  sceneObject: SceneObject,
  version: number,
): boolean {
  const sceneObjectAny = sceneObject as unknown as { [key: string]: number };
  return sceneObjectAny[SCALE_ANIMATION_VERSION_KEY] === version;
}

export function scaleIn(
  sceneObject: SceneObject,
  duration: number = 0.5,
): Promise<void> {
  const transform = sceneObject.getTransform();
  const wasEnabled = sceneObject.enabled;
  const start = wasEnabled ? transform.getLocalScale() : new vec3(0, 0, 0);
  const target = new vec3(1, 1, 1);
  const version = nextAnimationVersion(sceneObject);
  sceneObject.enabled = true;
  transform.setLocalScale(start);
  return new Promise((resolve) => {
    animate({
      duration,
      easing: "ease-in-out-quad",
      update: (t: number) => {
        const x = start.x + (target.x - start.x) * t;
        const y = start.y + (target.y - start.y) * t;
        const z = start.z + (target.z - start.z) * t;
        transform.setLocalScale(new vec3(x, y, z));
      },
      ended: () => {
        if (!isLatestAnimationVersion(sceneObject, version)) {
          resolve();
          return;
        }
        transform.setLocalScale(target);
        resolve();
      },
    });
  });
}

export function scaleOut(
  sceneObject: SceneObject,
  duration: number = 0.5,
): Promise<void> {
  const transform = sceneObject.getTransform();
  const start = transform.getLocalScale();
  const target = new vec3(0, 0, 0);
  const version = nextAnimationVersion(sceneObject);
  return new Promise((resolve) => {
    animate({
      duration,
      easing: "ease-in-out-quad",
      update: (t: number) => {
        const x = start.x + (target.x - start.x) * t;
        const y = start.y + (target.y - start.y) * t;
        const z = start.z + (target.z - start.z) * t;
        transform.setLocalScale(new vec3(x, y, z));
      },
      ended: () => {
        if (!isLatestAnimationVersion(sceneObject, version)) {
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
