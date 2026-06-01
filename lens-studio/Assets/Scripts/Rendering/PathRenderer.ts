import { protocolMetersToLensCentimeters } from "../Network/Protocol";
import LineRenderer from "SpectaclesInteractionKit.lspkg/Utils/views/LineRenderer/LineRenderer";

const PATH_POINT_LIFT_CM = 15.8;
const LINE_WIDTH_CM = 1.5;

const DEFAULT_PATH_MATERIAL = requireAsset(
  "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractorLineVisual/InteractorLineMaterial.mat"
) as Material | null;

export class PathRenderer {
  private readonly container: SceneObject;
  private readonly lineRenderer: LineRenderer | null = null;

  constructor(parent: SceneObject) {
    // Create container with identity world transform so world-cm waypoints map 1:1 to mesh-local points
    this.container = global.scene.createSceneObject("PathRenderer");
    this.container.setParent(parent);
    const transform = this.container.getTransform();
    transform.setWorldPosition(vec3.zero());
    transform.setWorldRotation(quat.quatIdentity());
    transform.setWorldScale(vec3.one());

    if (DEFAULT_PATH_MATERIAL) {
      try {
        this.lineRenderer = new LineRenderer({
          material: DEFAULT_PATH_MATERIAL,
          startWidth: LINE_WIDTH_CM,
          endWidth: LINE_WIDTH_CM,
          points: [],
        });
        this.lineRenderer.getSceneObject().setParent(this.container);
      } catch (e) {
        print(`PathRenderer: Failed to create LineRenderer: ${e}`);
      }
    } else {
      print("PathRenderer: SIK InteractorLineMaterial not found, path rendering disabled");
    }
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

    // Lift path slightly above ground
    const liftedPoints = points.map(
      (p) => new vec3(p.x, p.y + PATH_POINT_LIFT_CM, p.z)
    );

    this.lineRenderer.points = liftedPoints;
    this.container.enabled = true;
  }

  public clear(): void {
    if (this.lineRenderer) {
      this.lineRenderer.points = [];
    }
    this.container.enabled = false;
  }
}
