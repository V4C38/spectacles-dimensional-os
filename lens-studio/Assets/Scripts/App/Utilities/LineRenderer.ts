import InteractorLineRenderer, {
  VisualStyle,
} from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractorLineVisual/InteractorLineRenderer";

const LINE_WIDTH_CM = 1.5;
const POINTS_EPSILON_CM = 0.5;

// InteractorLineMat shader mode 4: fade in at start and fade out at end.
const DEFAULT_VISUAL_STYLE = 4 as VisualStyle;

const DEFAULT_LINE_MATERIAL = requireAsset(
  "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractorLineVisual/InteractorLineMaterial.mat",
) as Material;

export type LineRgb = [number, number, number];

export interface LineRendererOptions {
  parent: SceneObject;
  name?: string;
  visualStyle?: VisualStyle;
  eventHost?: ScriptComponent;
  onExpired?: () => void;
}

function transparentColor(base: vec4): vec4 {
  return new vec4(base.x, base.y, base.z, 0);
}

function rgbToVec4(rgb: LineRgb, alpha: number = 1): vec4 {
  return new vec4(rgb[0], rgb[1], rgb[2], alpha);
}

function configureLinePass(pass: Pass, color: vec4, visualStyle: VisualStyle): void {
  const linePass = pass as any;
  linePass.visualStyle = visualStyle;
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

/** World-space line using SIK InteractorLineRenderer — one uniform color, optional TTL. */
export class LineRenderer {
  private readonly container: SceneObject;
  private readonly material: Material | null;
  private readonly lineRenderer: InteractorLineRenderer | null = null;
  private readonly visualStyle: VisualStyle;
  private readonly eventHost: ScriptComponent | null;
  private readonly onExpired: (() => void) | null;
  private _lastRenderedPoints: vec3[] = [];
  private _color: LineRgb = [1, 1, 0];
  private _expiresAt: number | null = null;
  private _updateBound = false;
  private _destroyed = false;

  constructor(options: LineRendererOptions) {
    this.visualStyle = options.visualStyle ?? DEFAULT_VISUAL_STYLE;
    this.eventHost = options.eventHost ?? null;
    this.onExpired = options.onExpired ?? null;

    this.container = global.scene.createSceneObject(options.name ?? "LineRenderer");
    this.container.setParent(options.parent);
    const transform = this.container.getTransform();
    transform.setWorldPosition(vec3.zero());
    transform.setWorldRotation(quat.quatIdentity());
    transform.setWorldScale(vec3.one());

    this.material = DEFAULT_LINE_MATERIAL ? DEFAULT_LINE_MATERIAL.clone() : null;
    if (this.material) {
      const color = rgbToVec4(this._color);
      configureLinePass(this.material.mainPass, color, this.visualStyle);
      try {
        this.lineRenderer = new InteractorLineRenderer({
          material: this.material,
          startWidth: LINE_WIDTH_CM,
          endWidth: LINE_WIDTH_CM,
          startColor: color,
          endColor: color,
          points: [],
        });
        this.lineRenderer.visualStyle = this.visualStyle;
        this.lineRenderer.setSolidColor(color);
        this.lineRenderer.getSceneObject().setParent(this.container);
      } catch (e) {
        print(`LineRenderer: Failed to create InteractorLineRenderer: ${e}`);
      }
    } else {
      print("LineRenderer: SIK InteractorLineMaterial not found, line rendering disabled");
    }
  }

  public setColor(rgb: LineRgb): void {
    this._color = [rgb[0], rgb[1], rgb[2]];
    const color = rgbToVec4(this._color);
    if (this.material) {
      configureLinePass(this.material.mainPass, color, this.visualStyle);
    }
    if (this.lineRenderer) {
      this.lineRenderer.startColor = color;
      this.lineRenderer.endColor = color;
      this.lineRenderer.setSolidColor(color);
    }
  }

  /** Optional TTL in seconds; omit or pass null/undefined for a permanent line. */
  public setDuration(seconds?: number | null): void {
    if (seconds === undefined || seconds === null || !isFinite(seconds) || seconds <= 0) {
      this._expiresAt = null;
      return;
    }
    this._expiresAt = getTime() + seconds;
    this._ensureUpdateTick();
  }

  public setPoints(points: vec3[]): void {
    if (!this.lineRenderer || this._destroyed) {
      return;
    }
    if (points.length < 2) {
      this.clear();
      return;
    }
    if (this._matchesLastRendered(points)) {
      this.container.enabled = true;
      return;
    }
    this.lineRenderer.points = points;
    this._lastRenderedPoints = points.map((p) => new vec3(p.x, p.y, p.z));
    this.container.enabled = true;
  }

  public clear(): void {
    if (this.lineRenderer) {
      this.lineRenderer.points = [];
    }
    this._lastRenderedPoints = [];
    this._expiresAt = null;
    this.container.enabled = false;
  }

  public destroy(): void {
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;
    this.clear();
    this.container.destroy();
  }

  private _ensureUpdateTick(): void {
    if (this._updateBound || !this.eventHost) {
      return;
    }
    this._updateBound = true;
    this.eventHost.createEvent("UpdateEvent").bind(() => this._tickExpiry());
  }

  private _tickExpiry(): void {
    if (this._destroyed || this._expiresAt === null) {
      return;
    }
    if (getTime() < this._expiresAt) {
      return;
    }
    this.clear();
    if (this.onExpired) {
      this.onExpired();
    }
  }

  private _matchesLastRendered(points: vec3[]): boolean {
    if (this._lastRenderedPoints.length !== points.length) {
      return false;
    }
    for (let i = 0; i < points.length; i++) {
      if (this._lastRenderedPoints[i].distance(points[i]) > POINTS_EPSILON_CM) {
        return false;
      }
    }
    return true;
  }
}
