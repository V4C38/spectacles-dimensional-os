import { ObstaclesMessage, protocolMetersToLensCentimeters } from "../Network/Protocol";

const MAX_HIGHLIGHTS = 200;
const HIGHLIGHT_SCALE_CM = 2.4;

const OBSTACLE_COLOR_RGB: [number, number, number] = [1.0, 0.55, 0.0];

const DEFAULT_OBSTACLE_MATERIAL = requireAsset(
  "../../Materials/LidarUnlit.mat"
) as Material | null;

export class ObstacleHighlightRenderer {
  private readonly root: SceneObject;
  private readonly template: RenderMeshVisual | null;
  private readonly material: Material | null;
  private readonly pointObjects: SceneObject[] = [];
  private warnedMissingMaterial = false;

  constructor(parent: SceneObject, template: RenderMeshVisual | null) {
    this.root = global.scene.createSceneObject("ObstacleHighlights");
    this.root.setParent(parent);
    this.template = template;

    if (DEFAULT_OBSTACLE_MATERIAL) {
      const mat = DEFAULT_OBSTACLE_MATERIAL.clone();
      mat.mainPass.baseColor = new vec4(
        OBSTACLE_COLOR_RGB[0],
        OBSTACLE_COLOR_RGB[1],
        OBSTACLE_COLOR_RGB[2],
        1.0,
      );
      this.material = mat;
    } else {
      this.material = null;
    }
  }

  public updateObstacles(msg: ObstaclesMessage): void {
    this._refresh(msg.points);
  }

  public clear(): void {
    this.pointObjects.forEach((obj) => {
      obj.enabled = false;
    });
  }

  private _refresh(rawPoints: [number, number, number][]): void {
    const count = Math.min(rawPoints.length, MAX_HIGHLIGHTS);
    this._ensurePool(count);
    for (let i = 0; i < count; i++) {
      const lensPoint = protocolMetersToLensCentimeters(rawPoints[i]);
      const obj = this.pointObjects[i];
      obj.enabled = true;
      obj.getTransform().setWorldPosition(lensPoint);
    }
    for (let i = count; i < this.pointObjects.length; i++) {
      this.pointObjects[i].enabled = false;
    }
  }

  private _ensurePool(count: number): void {
    while (this.pointObjects.length < count) {
      const obj = global.scene.createSceneObject(
        `ObstaclePoint${this.pointObjects.length}`,
      );
      obj.setParent(this.root);
      const visual = obj.createComponent(
        "Component.RenderMeshVisual",
      ) as RenderMeshVisual;

      if (!this.material) {
        if (!this.warnedMissingMaterial) {
          this.warnedMissingMaterial = true;
          print("ObstacleHighlightRenderer: No material available");
        }
        obj.enabled = false;
        this.pointObjects.push(obj);
        continue;
      }

      if (visual && this.template) {
        visual.mesh = this.template.mesh;
        visual.mainMaterial = this.material;
        visual.meshShadowMode = MeshShadowMode.None;
        obj
          .getTransform()
          .setLocalScale(
            new vec3(HIGHLIGHT_SCALE_CM, HIGHLIGHT_SCALE_CM, HIGHLIGHT_SCALE_CM),
          );
      }
      obj.enabled = false;
      this.pointObjects.push(obj);
    }
  }
}
