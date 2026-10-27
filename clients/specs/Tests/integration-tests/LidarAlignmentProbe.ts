// Disposable-project diagnostic. GPU dot centers must coincide with the hollow
// native reference brackets at 1, 2 and 3 metres, before and after moving the camera.
import { DimOSSpecsClient } from "../Scripts/DimOSSpecsClient/DimOSSpecsClient";
import { PointCloudRenderer } from "../Scripts/DimOSSpecsClient/sensors/PointCloudRenderer";
import { specsToClientTrackingPoint } from "../Scripts/DimOSSpecsClient/utilities/SpecsCoordinates";
import { WorldMeshRenderer } from "../Scripts/DimOSSpecsClient/presentation/WorldMeshRenderer";

@component
export class ReviewScenario extends BaseScriptComponent {
  @input startDelayS = 5;
  private elapsed = 0;
  private phase = -1;
  private root: any;
  private cloud: PointCloudRenderer | null = null;
  private tracking: DeviceTracking | null = null;
  private trackingEnabled = false;
  private originalPosition = vec3.zero();
  private originalRotation = quat.quatIdentity();
  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.createEvent("UpdateEvent").bind(() => this.tick()));
    this.createEvent("OnDestroyEvent").bind(() => {
      if (!this.root) return;
      this.root.cameraObject.getTransform().setWorldPosition(this.originalPosition);
      this.root.cameraObject.getTransform().setWorldRotation(this.originalRotation);
      if (this.tracking) this.tracking.enabled = this.trackingEnabled;
    });
  }
  private emit(value: Record<string, unknown>): void { print(`SPECS_REVIEW ${JSON.stringify({ ...value, unixMs: Date.now() })}`); }
  private prepare(): void {
    const find = (object: SceneObject): any => {
      const root = object.getComponent(DimOSSpecsClient.getTypeName()); if (root) return root;
      for (let i = 0; i < object.getChildrenCount(); i++) { const root = find(object.getChild(i)); if (root) return root; }
      return null;
    };
    for (let i = 0; i < global.scene.getRootObjectsCount(); i++) { this.root = find(global.scene.getRootObject(i)); if (this.root) break; }
    if (!this.root) throw new Error("Production root missing");
    this.root.uiPresenter.setupWizardController.invalidatePending(); this.root.enabled = false;
    this.root.uiPresenter.setupWizardPanel.enabled = false; this.root.uiPresenter.mainUIFrame.enabled = false;
    this.root.robotPresenter.reset(); this.root.lidarPresenter.hide();
    const cameraObject = this.root.cameraObject as SceneObject;
    this.originalPosition = cameraObject.getTransform().getWorldPosition();
    this.originalRotation = cameraObject.getTransform().getWorldRotation();
    this.tracking = cameraObject.getComponent("Component.DeviceTracking") as DeviceTracking;
    this.trackingEnabled = this.tracking.enabled; this.tracking.enabled = false;
    const object = global.scene.createSceneObject("LidarAlignmentCloud"); object.setParent(this.getSceneObject());
    object.createComponent("Component.RenderMeshVisual");
    this.cloud = object.createComponent(PointCloudRenderer.getTypeName()) as PointCloudRenderer;
    const points: [number, number, number][] = [];
    for (const depth of [100, 200, 300]) {
      const center = this.originalPosition.add(this.originalRotation.multiplyVec3(new vec3((depth - 200) * depth / 700, -depth * .1, -depth)));
      points.push(specsToClientTrackingPoint([center.x, center.y, center.z]));
      const size = depth * .018, gap = depth * .009, positions: number[] = [], indices: number[] = [];
      for (const sign of [-1, 1]) for (const axis of [0, 1]) {
        const base = positions.length / 3;
        for (const [along, across] of [[gap, -.07 * size], [size, -.07 * size], [gap, .07 * size], [size, .07 * size]]) {
          const p = center.add(this.originalRotation.multiplyVec3(new vec3(axis ? across : along * sign, axis ? along * sign : across, 0)));
          positions.push(p.x, p.y, p.z);
        }
        indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      }
      new WorldMeshRenderer(this.getSceneObject(), `Reference_${depth}cm`).triangles(positions, indices, [1, 0, 0, 1]);
    }
    this.cloud.apply({ points, origin: { position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 0 } });
    this.emit({ type: "result", name: "native-alignment-fixture-initialized", passed: true });
  }
  private tick(): void {
    this.elapsed += Math.min(.1, getDeltaTime());
    if (!this.root) { if (this.elapsed < this.startDelayS) return; this.prepare(); this.elapsed = 4; }
    if (this.elapsed < 4) return;
    this.elapsed = 0; this.phase++;
    if (this.phase > 1) { this.emit({ type: "complete", passed: true }); this.enabled = false; return; }
    if (this.phase === 1) this.root.cameraObject.getTransform().setWorldPosition(this.originalPosition.add(new vec3(15, 0, 0)));
    this.emit({ type: "scene", name: this.phase ? "lidar-head-translation" : "lidar-known-depths", videoOnly: false });
    print(`LIDAR_ALIGNMENT ${JSON.stringify(this.cloud!.spatialDiagnostics(this.root.cameraObject.getComponent("Component.Camera") as Camera))}`);
  }
}
