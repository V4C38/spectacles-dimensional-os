import animate from "SpectaclesInteractionKit.lspkg/Utils/animate";

export function scaleIn(
  sceneObject: SceneObject,
  duration: number = 0.5,
): Promise<void> {
  sceneObject.enabled = true;
  const transform = sceneObject.getTransform();
  const target = new vec3(1, 1, 1);
  transform.setLocalScale(new vec3(0, 0, 0));
  return new Promise((resolve) => {
    animate({
      duration,
      easing: "ease-in-out-quad",
      update: (t: number) => {
        const x = target.x * t;
        const y = target.y * t;
        const z = target.z * t;
        transform.setLocalScale(new vec3(x, y, z));
      },
      ended: () => {
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
  return new Promise((resolve) => {
    animate({
      duration,
      easing: "ease-in-out-quad",
      update: (t: number) => {
        const x = start.x + (0 - start.x) * t;
        const y = start.y + (0 - start.y) * t;
        const z = start.z + (0 - start.z) * t;
        transform.setLocalScale(new vec3(x, y, z));
      },
      ended: () => {
        sceneObject.enabled = false;
        transform.setLocalScale(new vec3(1, 1, 1));
        resolve();
      },
    });
  });
}
