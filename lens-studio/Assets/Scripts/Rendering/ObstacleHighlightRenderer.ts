import { LidarMessage, protocolMetersToLensCentimeters } from "../Network/Protocol";

const MAX_HIGHLIGHTS = 200;
const MIN_DISTANCE_CM = 30.0;
const MAX_DISTANCE_CM = 50.0;
const FLOOR_HEIGHT_THRESHOLD_CM = 10.0;
const HIGHLIGHT_SCALE_CM = 2.4;

const OBSTACLE_COLOR_RGB: [number, number, number] = [1.0, 0.55, 0.0];
const OBSTACLE_ALPHA = 0.5;

// ObstacleHighlight.mat has BlendMode: Normal pre-baked so alpha blending
// works without any runtime blend-mode mutation.
const DEFAULT_OBSTACLE_MATERIAL = requireAsset(
  "../../Materials/ObstacleHighlight.mat"
) as Material | null;

export class ObstacleHighlightRenderer {
  private readonly root: SceneObject;
  private readonly template: RenderMeshVisual | null;
  private readonly material: Material | null;
  private readonly pointObjects: SceneObject[] = [];
  private latestLidar: LidarMessage | null = null;
  private robotPosition: vec3 | null = null;
  private warnedMissingMaterial = false;

  constructor(parent: SceneObject, template: RenderMeshVisual | null) {
    this.root = global.scene.createSceneObject("ObstacleHighlights");
    this.root.setParent(parent);
    this.template = template;

    if (DEFAULT_OBSTACLE_MATERIAL) {
      const mat = DEFAULT_OBSTACLE_MATERIAL.clone();
      const pass = mat.mainPass as any;
      pass.baseColor = new vec4(
        OBSTACLE_COLOR_RGB[0],
        OBSTACLE_COLOR_RGB[1],
        OBSTACLE_COLOR_RGB[2],
        OBSTACLE_ALPHA,
      );
      pass.Port_Emissive_N006 = new vec3(
        OBSTACLE_COLOR_RGB[0],
        OBSTACLE_COLOR_RGB[1],
        OBSTACLE_COLOR_RGB[2],
      );
      this.material = mat;
    } else {
      this.material = null;
    }
  }

  public updateLidar(msg: LidarMessage): void {
    this.latestLidar = msg;
    this._refresh();
  }

  public setRobotPosition(pos: vec3): void {
    this.robotPosition = pos;
    this._refresh();
  }

  public clear(): void {
    this.pointObjects.forEach((obj) => {
      obj.enabled = false;
    });
  }

  private _refresh(): void {
    if (!this.latestLidar || !this.robotPosition) {
      this.clear();
      return;
    }

    const robot = this.robotPosition;
    const rawPoints = this.latestLidar.points;
    const highlights: vec3[] = [];

    for (let i = 0; i < rawPoints.length && highlights.length < MAX_HIGHLIGHTS; i++) {
      const lensPoint = protocolMetersToLensCentimeters(rawPoints[i]);

      if (lensPoint.y < FLOOR_HEIGHT_THRESHOLD_CM) {
        continue;
      }

      const dx = lensPoint.x - robot.x;
      const dz = lensPoint.z - robot.z;
      const horizDist = Math.sqrt(dx * dx + dz * dz);

      if (horizDist >= MIN_DISTANCE_CM && horizDist <= MAX_DISTANCE_CM) {
        highlights.push(lensPoint);
      }
    }

    this._ensurePool(highlights.length);
    for (let i = 0; i < highlights.length; i++) {
      const obj = this.pointObjects[i];
      obj.enabled = true;
      obj.getTransform().setWorldPosition(highlights[i]);
    }
    for (let i = highlights.length; i < this.pointObjects.length; i++) {
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
