import { DimOSSpecsClient } from "../../Assets/Scripts/DimOSSpecsClient/DimOSSpecsClient";

export function emitReviewEvent(value: Record<string, unknown>): void {
  print(`SPECS_REVIEW ${JSON.stringify({ ...value, unixMs: Date.now() })}`);
}

export function findProductionRoot(): any {
  const find = (object: SceneObject): any => {
    const root = object.getComponent(DimOSSpecsClient.getTypeName());
    if (root) return root;
    for (let i = 0; i < object.getChildrenCount(); i++) {
      const found = find(object.getChild(i));
      if (found) return found;
    }
    return null;
  };
  for (let i = 0; i < global.scene.getRootObjectsCount(); i++) {
    const root = find(global.scene.getRootObject(i));
    if (root) return root;
  }
  return null;
}
