import { InteractionManager } from "SpectaclesInteractionKit.lspkg/Core/InteractionManager/InteractionManager";
import { InteractorInputType, TargetingMode } from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor";
import { CursorControllerProvider } from "SpectaclesInteractionKit.lspkg/Providers/CursorControllerProvider/CursorControllerProvider";
import { HandInputData } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData";
import { CURSOR_LASER_STYLE, cursorLaserFrame, laserTubeGeometry, type LaserFrame, type LaserPointer } from "./CursorLaserFrame";

const LASER_MATERIAL = requireAsset("../../../Materials/BendyLaser.mat") as Material;

export interface LaserVisual {
  apply(frame: LaserFrame): void;
  hide(): void;
  destroy(): void;
}

/** Fixed tube topology. The vertex shader bends both layers; only uniforms change per frame. */
export class CursorLaserRenderer implements LaserVisual {
  readonly object: SceneObject;
  readonly layers: { visual: RenderMeshVisual; pass: Pass }[] = [];

  constructor(parent: SceneObject, name: string) {
    this.object = global.scene.createSceneObject(name);
    this.object.setParent(parent);
    const transform = this.object.getTransform();
    transform.setWorldPosition(vec3.zero()); transform.setWorldRotation(quat.quatIdentity());
    transform.setWorldScale(vec3.one());
    const geometry = laserTubeGeometry();
    const builder = new MeshBuilder([{ name: "position", components: 3 }, { name: "normal", components: 3 },
      { name: "color", components: 4 }, { name: "texture0", components: 2 }]);
    builder.topology = MeshTopology.Triangles; builder.indexType = MeshIndexType.UInt16;
    builder.appendVerticesInterleaved(geometry.vertices); builder.appendIndices(geometry.indices);
    if (!builder.isValid()) throw new Error("Invalid laser tube mesh");
    builder.updateMesh();
    for (const outline of [true, false]) {
      const child = global.scene.createSceneObject(outline ? "Outline" : "Beam");
      child.setParent(this.object);
      const visual = child.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
      visual.mesh = builder.getMesh(); visual.mainMaterial = LASER_MATERIAL.clone();
      visual.meshShadowMode = MeshShadowMode.None;
      // SIK's native cursor renders at 100 and remains above the added tube.
      visual.setRenderOrder(outline ? 98 : 99);
      const pass = visual.mainMaterial.mainPass;
      pass.blendMode = BlendMode.Normal; pass.depthWrite = false; pass.depthTest = false;
      pass.twoSided = false;
      pass.frustumCullMode = FrustumCullMode.UserDefinedAABB;
      pass.radius = outline ? CURSOR_LASER_STYLE.outlineRadiusCm : CURSOR_LASER_STYLE.radiusCm;
      pass.tipRadius = outline ? CURSOR_LASER_STYLE.outlineTipRadiusCm : CURSOR_LASER_STYLE.tipRadiusCm;
      pass.brightness = outline ? 17 / 255 : 1;
      this.layers.push({ visual, pass });
    }
    this.hide();
  }

  apply(frame: LaserFrame): void {
    this.object.getTransform().setWorldPosition(new vec3(...frame.start));
    // A quadratic curve stays inside the convex hull of its control points.
    // Native bounds must cover the deformed tube rather than its unit placeholder mesh.
    const control = frame.control.map((v, axis) => v - frame.start[axis]);
    const end = frame.end.map((v, axis) => v - frame.start[axis]);
    const minimum = control.map((v, axis) => Math.min(0, v, end[axis]) - 0.3);
    const maximum = control.map((v, axis) => Math.max(0, v, end[axis]) + 0.3);
    for (let i = 0; i < this.layers.length; i++) {
      const pass = this.layers[i].pass;
      pass.startX = frame.start[0]; pass.startY = frame.start[1]; pass.startZ = frame.start[2];
      pass.controlX = control[0]; pass.controlY = control[1]; pass.controlZ = control[2];
      pass.endX = end[0]; pass.endY = end[1]; pass.endZ = end[2];
      pass.opacity = frame.opacity * (i === 0 ? 0.6 : 1);
      pass.frustumCullMin = new vec3(minimum[0], minimum[1], minimum[2]);
      pass.frustumCullMax = new vec3(maximum[0], maximum[1], maximum[2]);
    }
    this.object.enabled = true;
  }

  hide(): void { this.object.enabled = false; }
  destroy(): void { this.object.destroy(); }
}

/** Sample after SIK's late cursor update. Cursor parameters are the actual rendered endpoint. */
export function readSikLaserPointers(): LaserPointer[] {
  const editor = global.deviceInfoSystem.isEditor();
  const mask = InteractorInputType.BothHands | (editor ? InteractorInputType.Mouse : 0);
  const cursors = CursorControllerProvider.getInstance();
  const pointers: LaserPointer[] = [];
  for (const interactor of InteractionManager.getInstance().getInteractorsByType(mask)) {
    const cursor = cursors.getCursorByInteractor(interactor);
    let origin = interactor.startPoint;
    if (!cursor || !origin) continue;
    const parameters = cursor.cursorParameters;
    const visual = cursor.visual.getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    const handType = interactor.inputType === InteractorInputType.LeftHand ? "left" : "right";
    const hand = interactor.inputType === InteractorInputType.Mouse ? null : HandInputData.getInstance().getHand(handType);
    const tracked = hand === null || hand.isTracked();
    if (hand && tracked) {
      const index = hand.indexTip?.position, thumb = hand.thumbTip?.position;
      if (index && thumb && [index.x, index.y, index.z, thumb.x, thumb.y, thumb.z].every(Number.isFinite)) {
        origin = index.add(thumb).uniformScale(0.5);
      }
    }
    pointers.push({ id: interactor.inputType,
      active: tracked && interactor.isActive() && interactor.isTargeting() && cursor.enabled &&
        cursor.getSceneObject().isEnabledInHierarchy && interactor.activeTargetingMode === TargetingMode.Indirect,
      origin: [origin.x, origin.y, origin.z],
      cursor: [parameters.worldPosition.x, parameters.worldPosition.y, parameters.worldPosition.z],
      // Match the rendered cursor, including SIK's own visibility/alpha transitions.
      shown: parameters.isShown, opacity: visual.mainPass.masterAlpha });
  }
  return pointers;
}

/** One optical addon per SIK pointer; never writes to the interactor or cursor. */
export class CursorLaserPresenter {
  private readonly beams = new Map<number, { visual: LaserVisual }>();
  private disposed = false;

  constructor(private readonly parent: SceneObject, private readonly readPointers: () => readonly LaserPointer[],
    private readonly createVisual = (parent: SceneObject, id: number): LaserVisual =>
      new CursorLaserRenderer(parent, `SIK cursor beam ${id}`)) {}

  tick(): void {
    if (this.disposed) return;
    const seen = new Set<number>();
    for (const pointer of this.readPointers()) {
      seen.add(pointer.id);
      let beam = this.beams.get(pointer.id);
      if (!beam && pointer.active && pointer.shown && pointer.opacity > 0.01) {
        beam = { visual: this.createVisual(this.parent, pointer.id) };
        this.beams.set(pointer.id, beam);
      }
      if (!beam) continue;
      const frame = cursorLaserFrame(pointer);
      if (frame) beam.visual.apply(frame);
      else beam.visual.hide();
    }
    for (const [id, beam] of this.beams) if (!seen.has(id)) {
      beam.visual.destroy(); this.beams.delete(id);
    }
  }

  reset(): void {
    for (const beam of this.beams.values()) beam.visual.hide();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const beam of this.beams.values()) beam.visual.destroy();
    this.beams.clear();
  }
}
