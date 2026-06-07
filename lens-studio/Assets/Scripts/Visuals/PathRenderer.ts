import { protocolMetersToLensCentimeters } from "../Network/Protocol";
import InteractorLineRenderer, {
  VisualStyle,
} from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractorLineVisual/InteractorLineRenderer";

// ================================================================
/** Draws navigation paths as SIK interactor lines in world space. */
// ================================================================

const PATH_POINT_LIFT_CM = 15.8;
const LINE_WIDTH_CM = 1.5;

// InteractorLineMat shader mode 4: fade in at the start and fade out at the goal end.
// (VisualStyle.FadedStart = start only, FadedEnd = end only; 4 is both — not in the TS enum.)
const PATH_LINE_VISUAL_STYLE = 4 as VisualStyle;

export type PathRenderStyle = "executing" | "preview";

// SIK interactor yellow (#FFFC00); used for the executing path.
const PATH_LINE_YELLOW = new vec4(1, 1, 0, 1);
const PATH_LINE_WHITE = new vec4(1, 1, 1, 1);

function transparentColor(base: vec4): vec4 {
  return new vec4(base.x, base.y, base.z, 0);
}

const DEFAULT_PATH_MATERIAL = requireAsset(
  "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractorLineVisual/InteractorLineMaterial.mat",
) as Material;

function styleColor(style: PathRenderStyle): vec4 {
  return style === "preview" ? PATH_LINE_WHITE : PATH_LINE_YELLOW;
}

function configurePathLinePass(pass: Pass, color: vec4): void {
  const linePass = pass as any;
  linePass.visualStyle = PATH_LINE_VISUAL_STYLE;
  linePass.depthWrite = false;
  linePass.startColor = color;
  linePass.endColor = color;
  linePass.maxAlpha = 1;
  linePass.Port_Value0_N077 = transparentColor(color);
  linePass.Port_Value2_N077 = transparentColor(color);
  linePass.Port_Position1_N077 = 0.2;
}

function createPathLineMaterial(style: PathRenderStyle): Material | null {
  if (!DEFAULT_PATH_MATERIAL) {
    return null;
  }

  const material = DEFAULT_PATH_MATERIAL.clone();
  configurePathLinePass(material.mainPass, styleColor(style));
  return material;
}

export class PathRenderer {
  private readonly container: SceneObject;
  private readonly pathMaterial: Material | null;
  private readonly lineRenderer: InteractorLineRenderer | null = null;
  private _startY: number | null = null;
  private _endY: number | null = null;
  private _style: PathRenderStyle = "executing";

  constructor(parent: SceneObject) {
    // Create container with identity world transform so world-cm waypoints map 1:1 to mesh-local points
    this.container = global.scene.createSceneObject("PathRenderer");
    this.container.setParent(parent);
    const transform = this.container.getTransform();
    transform.setWorldPosition(vec3.zero());
    transform.setWorldRotation(quat.quatIdentity());
    transform.setWorldScale(vec3.one());

    this.pathMaterial = createPathLineMaterial(this._style);
    if (this.pathMaterial) {
      try {
        this.lineRenderer = new InteractorLineRenderer({
          material: this.pathMaterial,
          startWidth: LINE_WIDTH_CM,
          endWidth: LINE_WIDTH_CM,
          startColor: styleColor(this._style),
          endColor: styleColor(this._style),
          points: [],
        });
        this.lineRenderer.visualStyle = PATH_LINE_VISUAL_STYLE;
        this.lineRenderer.setSolidColor(styleColor(this._style));
        this.lineRenderer.getSceneObject().setParent(this.container);
      } catch (e) {
        print(`PathRenderer: Failed to create LineRenderer: ${e}`);
      }
    } else {
      print("PathRenderer: SIK InteractorLineMaterial not found, path rendering disabled");
    }
  }

  /**
   * Override the Y axis of the rendered path.
   * startY is used at the robot end (first waypoint), endY at the goal end (last waypoint).
   * All intermediate waypoints are linearly interpolated by waypoint index.
   */
  public setHeightRange(startY: number, endY: number): void {
    this._startY = startY;
    this._endY = endY;
  }

  public clearHeightRange(): void {
    this._startY = null;
    this._endY = null;
  }

  public setProtocolPath(
    waypoints: [number, number, number][],
    style: PathRenderStyle = "executing",
  ): void {
    const lensPoints = waypoints.map((point) => protocolMetersToLensCentimeters(point));
    this.setLensPath(lensPoints, style);
  }

  public setLensPath(
    points: vec3[],
    style: PathRenderStyle = "executing",
  ): void {
    if (!this.lineRenderer) {
      return;
    }
    this._applyStyle(style);

    if (points.length < 2) {
      this.clear();
      return;
    }

    const liftedPoints = points.map((p, i) => {
      const progress = points.length > 1 ? i / (points.length - 1) : 0;
      const y = (this._startY !== null && this._endY !== null)
        ? this._startY + (this._endY - this._startY) * progress
        : p.y + PATH_POINT_LIFT_CM;
      return new vec3(p.x, y, p.z);
    });

    this.lineRenderer.points = liftedPoints;
    this.container.enabled = true;
  }

  public setStraightPath(
    start: vec3,
    end: vec3,
    style: PathRenderStyle = "preview",
  ): void {
    this.setHeightRange(start.y, end.y);
    this.setLensPath([start, end], style);
  }

  public restyle(style: PathRenderStyle): void {
    this._applyStyle(style);
  }

  public clear(): void {
    if (this.lineRenderer) {
      this.lineRenderer.points = [];
    }
    this.clearHeightRange();
    this.container.enabled = false;
  }

  private _applyStyle(style: PathRenderStyle): void {
    if (this._style === style || !this.lineRenderer) {
      return;
    }
    this._style = style;
    const color = styleColor(style);
    // InteractorLineRenderer clones the config material internally, so the material
    // actually drawn is meshComponent.mainMaterial, not this.pathMaterial. Restyle the
    // rendered material directly so the fade-tip ports (Port_Value*_N077) match the body
    // color; otherwise the ends keep their original-style color (e.g. yellow tips on a
    // white preview line).
    const renderedPass = this._renderedLinePass();
    if (renderedPass) {
      configurePathLinePass(renderedPass, color);
    }
    this.lineRenderer.setSolidColor(color);
  }

  private _renderedLinePass(): Pass | null {
    if (!this.lineRenderer) {
      return null;
    }
    const meshVisual = this.lineRenderer
      .getSceneObject()
      .getComponent("Component.RenderMeshVisual");
    return meshVisual?.mainMaterial?.mainPass ?? null;
  }
}
