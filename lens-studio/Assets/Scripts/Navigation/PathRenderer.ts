import { protocolMetersToLensCentimeters } from "../Bridge/Protocol";
import InteractorLineRenderer, {
  VisualStyle,
} from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractorLineVisual/InteractorLineRenderer";

// ================================================================
/** Draws navigation paths as SIK interactor lines in world space. */
// ================================================================

const PATH_POINT_LIFT_CM = 15.8;
const LINE_WIDTH_CM = 1.5;
const CORNER_FILLET_MAX_CM = 10.0;
const CORNER_FILLET_ANGLE_DEG = 40.0;
const CORNER_FILLET_SEGMENTS = 2;

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
  linePass.startWidth = LINE_WIDTH_CM;
  linePass.endWidth = LINE_WIDTH_CM;
  linePass.maxAlpha = 1;
  linePass.Port_Value0_N077 = transparentColor(color);
  linePass.Port_Value2_N077 = transparentColor(color);
  linePass.Port_Position1_N077 = 0.2;
}

function normalizePlanar(vec: vec3): vec3 | null {
  const length = Math.sqrt(vec.x * vec.x + vec.z * vec.z);
  if (length <= 0.0001) {
    return null;
  }
  return new vec3(vec.x / length, 0, vec.z / length);
}

function cornerTurnAngleDeg(prev: vec3, corner: vec3, next: vec3): number {
  const incoming = normalizePlanar(new vec3(
    corner.x - prev.x,
    0,
    corner.z - prev.z,
  ));
  const outgoing = normalizePlanar(new vec3(
    next.x - corner.x,
    0,
    next.z - corner.z,
  ));
  if (!incoming || !outgoing) {
    return 0;
  }
  const dot = Math.max(-1, Math.min(1, incoming.x * outgoing.x + incoming.z * outgoing.z));
  return Math.acos(dot) * (180.0 / Math.PI);
}

function lerpPoint(a: vec3, b: vec3, t: number): vec3 {
  return new vec3(
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
    a.z + (b.z - a.z) * t,
  );
}

/** Insert short fillet segments at sharp corners to limit SIK line miter flare. */
function filletPathCorners(points: vec3[]): vec3[] {
  if (points.length < 3) {
    return points;
  }

  const filleted: vec3[] = [new vec3(points[0].x, points[0].y, points[0].z)];
  for (let index = 1; index < points.length - 1; index++) {
    const prev = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const turnAngle = cornerTurnAngleDeg(prev, corner, next);
    if (turnAngle < CORNER_FILLET_ANGLE_DEG) {
      filleted.push(new vec3(corner.x, corner.y, corner.z));
      continue;
    }

    const incomingLength = Math.sqrt(
      (corner.x - prev.x) * (corner.x - prev.x) +
      (corner.z - prev.z) * (corner.z - prev.z),
    );
    const outgoingLength = Math.sqrt(
      (next.x - corner.x) * (next.x - corner.x) +
      (next.z - corner.z) * (next.z - corner.z),
    );
    const filletDistance = Math.min(
      CORNER_FILLET_MAX_CM,
      incomingLength * 0.45,
      outgoingLength * 0.45,
    );
    if (filletDistance <= 0.5) {
      filleted.push(new vec3(corner.x, corner.y, corner.z));
      continue;
    }

    const incomingT = filletDistance / incomingLength;
    const outgoingT = filletDistance / outgoingLength;
    const incomingFillet = lerpPoint(corner, prev, incomingT);
    const outgoingFillet = lerpPoint(corner, next, outgoingT);
    filleted.push(incomingFillet);
    for (let segment = 1; segment <= CORNER_FILLET_SEGMENTS; segment++) {
      const t = segment / (CORNER_FILLET_SEGMENTS + 1);
      filleted.push(lerpPoint(incomingFillet, outgoingFillet, t));
    }
    filleted.push(outgoingFillet);
  }

  filleted.push(new vec3(
    points[points.length - 1].x,
    points[points.length - 1].y,
    points[points.length - 1].z,
  ));
  return filleted;
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

    const smoothedPoints = filletPathCorners(points);
    const liftedPoints = smoothedPoints.map((p, i) => {
      const progress = smoothedPoints.length > 1 ? i / (smoothedPoints.length - 1) : 0;
      const y = (this._startY !== null && this._endY !== null)
        ? this._startY + (this._endY - this._startY) * progress
        : p.y + PATH_POINT_LIFT_CM;
      return new vec3(p.x, y, p.z);
    });

    this.lineRenderer.points = liftedPoints;
    this.container.enabled = true;
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
