import { protocolMetersToLensCentimeters } from "../../ARBridge/Network/Protocol";
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
const PATH_REBUILD_POSITION_EPSILON_CM = 0.5;

// InteractorLineMat shader mode 4: fade in at the start and fade out at the goal end.
// (VisualStyle.FadedStart = start only, FadedEnd = end only; 4 is both — not in the TS enum.)
const PATH_LINE_VISUAL_STYLE = 4 as VisualStyle;

// SIK interactor yellow (#FFFC00).
const PATH_LINE_YELLOW = new vec4(1, 1, 0, 1);

function transparentColor(base: vec4): vec4 {
  return new vec4(base.x, base.y, base.z, 0);
}

const DEFAULT_PATH_MATERIAL = requireAsset(
  "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractorLineVisual/InteractorLineMaterial.mat",
) as Material;

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

function createPathLineMaterial(): Material | null {
  if (!DEFAULT_PATH_MATERIAL) {
    return null;
  }

  const material = DEFAULT_PATH_MATERIAL.clone();
  configurePathLinePass(material.mainPass, PATH_LINE_YELLOW);
  return material;
}

export class NavigationPathRenderer {
  private readonly container: SceneObject;
  private readonly pathMaterial: Material | null;
  private readonly lineRenderer: InteractorLineRenderer | null = null;
  private _startY: number | null = null;
  private _endY: number | null = null;
  private _lastRenderedPoints: vec3[] = [];

  constructor(parent: SceneObject) {
    // Create container with identity world transform so world-cm waypoints map 1:1 to mesh-local points
    this.container = global.scene.createSceneObject("NavigationPathRenderer");
    this.container.setParent(parent);
    const transform = this.container.getTransform();
    transform.setWorldPosition(vec3.zero());
    transform.setWorldRotation(quat.quatIdentity());
    transform.setWorldScale(vec3.one());

    this.pathMaterial = createPathLineMaterial();
    if (this.pathMaterial) {
      try {
        this.lineRenderer = new InteractorLineRenderer({
          material: this.pathMaterial,
          startWidth: LINE_WIDTH_CM,
          endWidth: LINE_WIDTH_CM,
          startColor: PATH_LINE_YELLOW,
          endColor: PATH_LINE_YELLOW,
          points: [],
        });
        this.lineRenderer.visualStyle = PATH_LINE_VISUAL_STYLE;
        this.lineRenderer.setSolidColor(PATH_LINE_YELLOW);
        this.lineRenderer.getSceneObject().setParent(this.container);
      } catch (e) {
        print(`NavigationPathRenderer: Failed to create LineRenderer: ${e}`);
      }
    } else {
      print("NavigationPathRenderer: SIK InteractorLineMaterial not found, path rendering disabled");
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

  public setProtocolPath(waypoints: [number, number, number][]): void {
    const lensPoints = waypoints.map((point) => protocolMetersToLensCentimeters(point));
    this.setLensPath(lensPoints);
  }

  public setLensPath(points: vec3[]): void {
    if (!this.lineRenderer) {
      return;
    }

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

    if (this._matchesLastRendered(liftedPoints)) {
      this.container.enabled = true;
      return;
    }

    this.lineRenderer.points = liftedPoints;
    this._lastRenderedPoints = liftedPoints.map((p) => new vec3(p.x, p.y, p.z));
    this.container.enabled = true;
  }

  public clear(): void {
    if (this.lineRenderer) {
      this.lineRenderer.points = [];
    }
    this._lastRenderedPoints = [];
    this.clearHeightRange();
    this.container.enabled = false;
  }

  private _matchesLastRendered(points: vec3[]): boolean {
    if (this._lastRenderedPoints.length !== points.length) {
      return false;
    }
    for (let i = 0; i < points.length; i++) {
      if (this._lastRenderedPoints[i].distance(points[i]) > PATH_REBUILD_POSITION_EPSILON_CM) {
        return false;
      }
    }
    return true;
  }
}
