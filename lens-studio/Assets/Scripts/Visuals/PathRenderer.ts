import { protocolMetersToLensCentimeters } from "../Network/Protocol";
import InteractorLineRenderer, {
  VisualStyle,
} from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractorLineVisual/InteractorLineRenderer";

// ================================================================
/** Draws the robot planned path as a yellow SIK interactor line in world space. */
// ================================================================

const PATH_POINT_LIFT_CM = 15.8;
const LINE_WIDTH_CM = 1.5;

// InteractorLineMat shader mode 4: fade in at the start and fade out at the goal end.
// (VisualStyle.FadedStart = start only, FadedEnd = end only; 4 is both — not in the TS enum.)
const PATH_LINE_VISUAL_STYLE = 4 as VisualStyle;

// SIK interactor yellow (#FFFC00); used for the full path and fade endpoints.
const PATH_LINE_YELLOW = new vec4(1, 1, 0, 1);
const PATH_LINE_TRANSPARENT = new vec4(1, 1, 0, 0);

const DEFAULT_PATH_MATERIAL = requireAsset(
  "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractorLineVisual/InteractorLineMaterial.mat",
) as Material;

function configurePathLinePass(pass: Pass): void {
  const linePass = pass as any;
  linePass.visualStyle = PATH_LINE_VISUAL_STYLE;
  linePass.startColor = PATH_LINE_YELLOW;
  linePass.endColor = PATH_LINE_YELLOW;
  linePass.maxAlpha = 1;
  linePass.Port_Value0_N077 = PATH_LINE_TRANSPARENT;
  linePass.Port_Value2_N077 = PATH_LINE_TRANSPARENT;
  linePass.Port_Position1_N077 = 0.2;
}

function createPathLineMaterial(): Material | null {
  if (!DEFAULT_PATH_MATERIAL) {
    return null;
  }

  const material = DEFAULT_PATH_MATERIAL.clone();
  configurePathLinePass(material.mainPass);
  return material;
}

export class PathRenderer {
  private readonly container: SceneObject;
  private readonly lineRenderer: InteractorLineRenderer | null = null;
  private _startY: number | null = null;
  private _endY: number | null = null;

  constructor(parent: SceneObject) {
    // Create container with identity world transform so world-cm waypoints map 1:1 to mesh-local points
    this.container = global.scene.createSceneObject("PathRenderer");
    this.container.setParent(parent);
    const transform = this.container.getTransform();
    transform.setWorldPosition(vec3.zero());
    transform.setWorldRotation(quat.quatIdentity());
    transform.setWorldScale(vec3.one());

    const pathMaterial = createPathLineMaterial();
    if (pathMaterial) {
      try {
        this.lineRenderer = new InteractorLineRenderer({
          material: pathMaterial,
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

  public clear(): void {
    if (this.lineRenderer) {
      this.lineRenderer.points = [];
    }
    this.clearHeightRange();
    this.container.enabled = false;
  }
}
