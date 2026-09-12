import InteractorLineRenderer, {
  VisualStyle,
} from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractorLineVisual/InteractorLineRenderer";

const LINE_WIDTH_CM = 1.5;
const POINTS_EPSILON_CM = 0.5;
const DEFAULT_VISUAL_STYLE = 4 as VisualStyle;

const DEFAULT_LINE_MATERIAL = requireAsset(
  "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractorLineVisual/InteractorLineMaterial.mat",
) as Material;

export type LineRgb = [number, number, number];

export interface LineRendererOptions {
  parent: SceneObject;
  name?: string;
}

export class LineRenderer {
  private readonly container: SceneObject;
  private readonly material: Material;
  private readonly lineRenderer: InteractorLineRenderer;
  private lastRenderedPoints: vec3[] = [];
  private color: LineRgb = [1, 1, 0];
  private destroyed = false;

  constructor(options: LineRendererOptions) {
    if (!DEFAULT_LINE_MATERIAL) {
      throw new Error("InteractorLineMaterial is required");
    }
    this.container = global.scene.createSceneObject(options.name ?? "LineRenderer");
    this.container.setParent(options.parent);
    const transform = this.container.getTransform();
    transform.setWorldPosition(vec3.zero());
    transform.setWorldRotation(quat.quatIdentity());
    transform.setWorldScale(vec3.one());

    this.material = DEFAULT_LINE_MATERIAL.clone();
    const color = rgbToVec4(this.color);
    configureLinePass(this.material.mainPass, color, DEFAULT_VISUAL_STYLE);
    this.lineRenderer = new InteractorLineRenderer({
      material: this.material,
      startWidth: LINE_WIDTH_CM,
      endWidth: LINE_WIDTH_CM,
      startColor: color,
      endColor: color,
      points: [],
    });
    this.lineRenderer.visualStyle = DEFAULT_VISUAL_STYLE;
    this.lineRenderer.setSolidColor(color);
    this.lineRenderer.getSceneObject().setParent(this.container);
  }

  setColor(rgb: LineRgb): void {
    this.color = [rgb[0], rgb[1], rgb[2]];
    const color = rgbToVec4(this.color);
    configureLinePass(this.material.mainPass, color, DEFAULT_VISUAL_STYLE);
    this.lineRenderer.startColor = color;
    this.lineRenderer.endColor = color;
    this.lineRenderer.setSolidColor(color);
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
    Port_Value0_N077: vec4;
    Port_Value2_N077: vec4;
    Port_Position1_N077: number;
  };
  linePass.visualStyle = visualStyle;
  linePass.depthWrite = false;
  linePass.startColor = color;
  linePass.endColor = color;
  linePass.startWidth = LINE_WIDTH_CM;
  linePass.endWidth = LINE_WIDTH_CM;
  linePass.maxAlpha = 1;
  linePass.Port_Value0_N077 = new vec4(color.x, color.y, color.z, 0);
  linePass.Port_Value2_N077 = new vec4(color.x, color.y, color.z, 0);
  linePass.Port_Position1_N077 = 0.2;
}
