import * as THREE from "three";
import type {Vec3} from "@dimos-ar-client/websocket/protocolTypes";

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
