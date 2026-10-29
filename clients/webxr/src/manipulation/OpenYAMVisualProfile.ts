import type { Vec3 } from "@dimos-ar-client/websocket/protocolTypes";

/** Two adjoining visual-only boxes fitted to i2rt/link3.stl in its URDF link frame.
 * Planning collisions and the model/GLB signature deliberately remain independent.
 */
export const OPENYAM_FOREARM_BOXES: readonly { center: Vec3; size: Vec3 }[] = [
  { center: [-0.0600003, -0.0344453, -0.1530005], size: [0.057, 0.06671, 0.240914] },
  { center: [-0.0298676, -0.034925, -0.0005235], size: [0.122666, 0.08985, 0.064041] },
];
