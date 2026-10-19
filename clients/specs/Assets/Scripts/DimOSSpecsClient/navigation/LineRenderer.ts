import InteractorLineRenderer, {
  VisualStyle,
} from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractorLineVisual/InteractorLineRenderer";

const LINE_WIDTH_CM = 1.5;
const POINTS_EPSILON_CM = 0.5;
const DEFAULT_VISUAL_STYLE = 4 as VisualStyle;

// Style 4 fades both ends to the N077 gradient constants. They are baked into
// NavPath.ss_graph (white, alpha 0); material and script overrides do not reach the shader.
const DEFAULT_LINE_MATERIAL = requireAsset("../../../Materials/NavPath.mat") as Material;

export type LineRgb = [number, number, number];

export interface LineRendererOptions {
  parent: SceneObject;
  name?: string;
}

export class LineRenderer {
  private readonly container: SceneObject;
  private readonly lineRenderer: InteractorLineRenderer;
  private lastRenderedPoints: vec3[] = [];
  private color: LineRgb = [1, 1, 1];
  private destroyed = false;

  constructor(options: LineRendererOptions) {
    if (!DEFAULT_LINE_MATERIAL) {
      throw new Error("NavPath material is required");
    }
    this.container = global.scene.createSceneObject(options.name ?? "LineRenderer");
    this.container.setParent(options.parent);
    const transform = this.container.getTransform();
    transform.setWorldPosition(vec3.zero());
    transform.setWorldRotation(quat.quatIdentity());
    transform.setWorldScale(vec3.one());

    const color = rgbToVec4(this.color);
    this.lineRenderer = new InteractorLineRenderer({
      material: DEFAULT_LINE_MATERIAL,
      startWidth: LINE_WIDTH_CM,
      endWidth: LINE_WIDTH_CM,
      startColor: color,
      endColor: color,
      points: [],
    });
    this.lineRenderer.getSceneObject().setParent(this.container);
    this.applyColor(this.color);
  }

  setColor(rgb: LineRgb): void {
    this.applyColor(rgb);
  }

  setPoints(points: vec3[]): void {
    if (this.destroyed) {
      return;
    }
    if (points.length < 2) {
      this.clear();
      return;
    }
    if (this.matchesLastRendered(points)) {
      this.container.enabled = true;
      return;
    }
    this.lineRenderer.points = points;
    this.lastRenderedPoints = points.map((point) => new vec3(point.x, point.y, point.z));
    this.container.enabled = true;
  }

  clear(): void {
    this.lineRenderer.points = [];
    this.lastRenderedPoints = [];
    this.container.enabled = false;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.clear();
    this.container.destroy();
  }

  private applyColor(rgb: LineRgb): void {
    this.color = [rgb[0], rgb[1], rgb[2]];
    const color = rgbToVec4(this.color);
    const visual = this.lineRenderer
      .getSceneObject()
      .getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    if (!visual?.mainMaterial) {
      throw new Error("line material is required");
    }
    configureLinePass(visual.mainMaterial.mainPass, color, DEFAULT_VISUAL_STYLE);
    this.lineRenderer.setSolidColor(color);
  }

  private matchesLastRendered(points: vec3[]): boolean {
    if (this.lastRenderedPoints.length !== points.length) {
      return false;
    }
    for (let i = 0; i < points.length; i++) {
      if (this.lastRenderedPoints[i].distance(points[i]) > POINTS_EPSILON_CM) {
        return false;
      }
    }
    return true;
  }
}

function rgbToVec4(rgb: LineRgb, alpha: number = 1): vec4 {
  return new vec4(rgb[0], rgb[1], rgb[2], alpha);
}

function configureLinePass(pass: Pass, color: vec4, visualStyle: VisualStyle): void {
  const linePass = pass as Pass & {
    visualStyle: VisualStyle;
    depthWrite: boolean;
    startColor: vec4;
    endColor: vec4;
    startWidth: number;
    endWidth: number;
    maxAlpha: number;
    Port_Position1_N077: number;
  };
  linePass.visualStyle = visualStyle;
  linePass.depthWrite = false;
  linePass.startColor = color;
  linePass.endColor = color;
  linePass.startWidth = LINE_WIDTH_CM;
  linePass.endWidth = LINE_WIDTH_CM;
  linePass.maxAlpha = 1;
  linePass.Port_Position1_N077 = 0.2;
}
