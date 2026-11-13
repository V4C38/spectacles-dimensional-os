import * as THREE from "three";
import type { Vec3 } from "@dimos-ar-client/ClientContracts";

/** Palm geometry uses metacarpals so bent pointing/pinching fingers cannot invert it. */
export function palmUpDot(handedness: XRHandedness, joints: ReadonlyMap<string, THREE.Vector3>): number | null {
  const wrist = joints.get("wrist"), index = joints.get("index-finger-metacarpal"), middle = joints.get("middle-finger-metacarpal"), little = joints.get("pinky-finger-metacarpal");
  if (!wrist || !index || !middle || !little || handedness === "none") return null;
  for (const finger of ["middle", "ring"]) {
    const base = joints.get(`${finger}-finger-phalanx-proximal`), mid = joints.get(`${finger}-finger-phalanx-intermediate`), tip = joints.get(`${finger}-finger-tip`);
    if (!base || !mid || !tip) return null;
    const a = base.clone().sub(mid), b = tip.clone().sub(mid);
    if (a.lengthSq() < 1e-8 || b.lengthSq() < 1e-8 || a.angleTo(b) < 150 * Math.PI / 180) return 0;
  }
  const normal = index.clone().sub(little).cross(middle.clone().sub(wrist));
  if (normal.lengthSq() < 1e-8) return null;
  return normal.normalize().y * (handedness === "left" ? -1 : 1);
}

export class PalmMenuGate {
  isOpen = false;
  private pending: boolean | null = null;
  private since = 0;
  update(dotUp: number | null, now: number): boolean {
    const wantsOpen = dotUp !== null && dotUp >= Math.cos((this.isOpen ? 55 : 35) * Math.PI / 180);
    if (wantsOpen === this.isOpen) { this.pending = null; return false; }
    if (this.pending !== wantsOpen) { this.pending = wantsOpen; this.since = now; return false; }
    if (now - this.since < (wantsOpen ? 0.35 : 0.18)) return false;
    this.isOpen = wantsOpen;
    this.pending = null;
    return true;
  }
  reset(): void { this.isOpen = false; this.pending = null; }
}

/** A summoned menu follows its source position; grabbing leaves its current world pose intact. */
export class MenuAnchorController {
  private anchor: XRInputSource | null = null;
  private readonly offset = new THREE.Vector3();
  get source(): XRInputSource | null { return this.anchor; }

  attach(source: XRInputSource, position: THREE.Vector3, eye: THREE.Vector3, headRotation: THREE.Quaternion, panel: THREE.Object3D): void {
    this.anchor = source;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(headRotation);
    forward.y = 0;
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
    this.offset.copy(forward.normalize()).multiplyScalar(0.18).add(new THREE.Vector3(0, source.hand ? 0.20 : 0.12, 0));
    // Follow the new source from the existing pose instead of snapping on attach.
    this.update(position, eye, panel, 1 / 60);
  }

  update(position: THREE.Vector3, eye: THREE.Vector3, panel: THREE.Object3D, deltaS: number): void {
    if (!this.anchor) return;
    const alpha = 1 - Math.exp(-20 * Math.max(0, deltaS));
    panel.position.lerp(position.clone().add(this.offset), alpha);
    this.faceViewer(eye, panel, alpha);
  }

  detach(): void { this.anchor = null; }

  faceViewer(eye: THREE.Vector3, panel: THREE.Object3D, alpha: number): void {
    if (panel.position.distanceToSquared(eye) < 1e-8) return;
    const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, panel.position, new THREE.Vector3(0, 1, 0)));
    panel.quaternion.slerp(rotation, alpha);
    const angles = new THREE.Euler().setFromQuaternion(panel.quaternion, "YXZ");
    angles.z = 0;
    panel.quaternion.setFromEuler(angles);
  }
}

/** Setup starts below the viewer’s forward line and follows the viewer until an explicit manual grab pins it. */
export class ViewerPanelPlacement {
  private pinned = false;
  begin(): void { this.pinned = false; }
  pin(): void { this.pinned = true; }
  update(panel: THREE.Object3D, eye: THREE.Vector3, orientation: THREE.Quaternion, deltaS: number, initial = false): void {
    if (this.pinned) return;
    const target = new THREE.Vector3(0, 0, -0.9).applyQuaternion(orientation).add(eye);
    target.y -= 0.1;
    const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(0, 1, 0)));
    const alpha = initial ? 1 : 1 - Math.exp(-5 * Math.max(0, deltaS));
    panel.position.lerp(target, alpha); panel.quaternion.slerp(rotation, alpha);
    const angles = new THREE.Euler().setFromQuaternion(panel.quaternion, "YXZ"); angles.z = 0; panel.quaternion.setFromEuler(angles);
  }
}

export interface PanelGesture {
  plane: THREE.Plane; start: THREE.Vector3; position: THREE.Vector3;
  anchor: THREE.Vector3; span: THREE.Vector3; scale: number; distance: number; resize: boolean;
  rotation: THREE.Quaternion; controllerInverse: THREE.Quaternion; zone: "bar" | "left" | "right" | "body";
}

function upright(rotation: THREE.Quaternion): THREE.Quaternion {
  const forward = new THREE.Vector3(0,0,1).applyQuaternion(rotation);
  const yaw = Math.atan2(forward.x, forward.z);
  const limit = THREE.MathUtils.degToRad(60);
  const pitch = THREE.MathUtils.clamp(Math.atan2(forward.y,Math.hypot(forward.x,forward.z)),-limit,limit);
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch,yaw,0,"YXZ"));
}

/** Shared movement/scale behavior for the main window and the robot control frame. */
export function updatePanelGesture(panel: THREE.Object3D, state: PanelGesture,
  origin: Vec3, direction: Vec3, rotation: THREE.Quaternion, deltaS: number,
  minimum: number, maximum: number, eye?: THREE.Vector3): void {
  const ray = new THREE.Ray(new THREE.Vector3(...origin),new THREE.Vector3(...direction).normalize());
  if (!state.resize) {
    const targetRotation = state.zone === "bar" && eye
      ? new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye,panel.position,new THREE.Vector3(0,1,0)))
      : upright(rotation.clone().multiply(state.controllerInverse).multiply(state.rotation));
    const deltaRotation = targetRotation.clone().multiply(state.rotation.clone().invert());
    const offset = state.start.clone().sub(state.position).applyQuaternion(deltaRotation);
    panel.position.lerp(ray.at(state.distance,new THREE.Vector3()).sub(offset),1-Math.exp(-12*deltaS));
    panel.quaternion.slerp(targetRotation,1-Math.exp(-14*deltaS));
    panel.quaternion.copy(upright(panel.quaternion));
    return;
  }
  const point = ray.intersectPlane(state.plane,new THREE.Vector3());
  if (!point || state.span.lengthSq()<1e-8) return;
  const ratio=point.sub(state.anchor).dot(state.span)/state.span.lengthSq();
  const scale=THREE.MathUtils.clamp(state.scale*ratio,minimum,maximum);
  panel.scale.setScalar(scale);
  panel.position.copy(state.position).sub(state.anchor).multiplyScalar(scale/state.scale).add(state.anchor);
}

export const MENU_BUTTON_INDEX = 4;
export function isMenuButtonPressed(buttons: ReadonlyArray<{ pressed: boolean }>): boolean { return buttons[MENU_BUTTON_INDEX]?.pressed === true; }
