import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { ClientTrackingOrigin } from "@dimos-ar-client/localization/clientTrackingOrigin";
import {
  odomToClientTrackingPoint,
  odomToClientTrackingPose,
  odomToClientTrackingYawPose,
} from "@dimos-ar-client/localization/clientTrackingTransforms";
import type { ARModuleSessionState } from "@dimos-ar-client/websocket/arModuleSession";
import type { Quat, Vec3, YawPose } from "@dimos-ar-client/websocket/protocolTypes";
import {
  clientTrackingToWebxrPoint,
  clientTrackingToWebxrPose,
} from "../coordinates/WebXRCoordinates";
import { filletPathCorners, MAX_LIDAR_POINTS, rangePathY } from "./routePath";
import {
  deriveRobotMarkerApplyInput,
  getRobotActivityState,
  robotTitleText,
  type RobotMarkerApplyInput,
} from "./robotPresentation";

export class WebXRRobotPresenter {
  readonly object: THREE.Group;
  private readonly gizmo = new THREE.Group();
  private readonly labelGroup: THREE.Group;
  private readonly labelPlane: THREE.Mesh;
  private robotHeightM = 0;
  private baseHeightM = 0;
  private readonly targetPosition = new THREE.Vector3();
  private readonly targetRotation = new THREE.Quaternion();
  private lastOrigin: ClientTrackingOrigin | null = null;
  private floorOffset: Vec3 = [0, 0, 0];
  private unlocalizedCommitted = false;
  private labelCanvas: HTMLCanvasElement | null = null;
  private labelKey = "";

  constructor() {
    this.object = new THREE.Group();
    this.object.name = "WebXRRobotPresenter";
    this.gizmo.name = "RobotPoseGizmo";
    this.gizmo.scale.setScalar(0.8);
    for (const [axis, color] of [
      // DimOS +X forward (red), +Y left (green), +Z up (blue).
      [new THREE.Vector3(0, 0, -1), 0xff0000],
      [new THREE.Vector3(-1, 0, 0), 0x00ff00],
      [new THREE.Vector3(0, 1, 0), 0x0000ff],
    ] as const) {
      const material = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, toneMapped: false });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.19, 12), material);
      shaft.position.copy(axis).multiplyScalar(0.095);
      shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.055, 16), material);
      tip.position.copy(axis).multiplyScalar(0.215);
      tip.quaternion.copy(shaft.quaternion);
      for (const part of [shaft, tip]) { part.renderOrder = 5; part.raycast = () => {}; this.gizmo.add(part); }
    }
    this.object.add(this.gizmo);

    this.labelGroup = new THREE.Group();
    this.labelGroup.name = "RobotMarkerLabel";
    this.labelGroup.scale.setScalar(0.25);
    this.labelPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.78, 0.195),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.labelPlane.raycast = () => {};
    if (typeof document !== "undefined") {
      this.labelCanvas = document.createElement("canvas");
      this.labelCanvas.width = 1024;
      this.labelCanvas.height = 256;
      const texture = new THREE.CanvasTexture(this.labelCanvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      (this.labelPlane.material as THREE.MeshBasicMaterial).map = texture;
    }
    this.labelGroup.add(this.labelPlane);
    this.object.add(this.labelGroup);
    this.object.visible = false;
  }

  apply(view: ARModuleSessionState, origin: ClientTrackingOrigin | null, setupCompleted: boolean, fallbackPosition: Vec3 | null): void {
    const input = deriveRobotMarkerApplyInput({ setupCompleted, view, origin });
    if (input.mode === "hidden") { this.reset(); return; }
    if (input.mode === "unlocalizedFallbackPosition") { this.applyUnlocalized(input, fallbackPosition); return; }
    this.unlocalizedCommitted = false;
    this.applyLocalized(input);
  }

  tick(deltaS: number): void {
    if (!this.object.visible || !this.lastOrigin || deltaS <= 0) return;
    this.object.position.lerp(this.targetPosition, 1 - Math.exp(-8 * deltaS));
    this.object.quaternion.slerp(this.targetRotation, 1 - Math.exp(-4.5 * deltaS));
    this.updateFloorOffset();
    this.updateLabelPosition();
  }

  feedback(text: string): void {
    const labelKey = `${String(this.object.userData.title || "Robot")}\n${text}`;
    if (!this.labelCanvas || labelKey === this.labelKey) return;
    const ctx = this.labelCanvas.getContext("2d");
    if (!ctx) return;
    this.labelKey = labelKey;
    ctx.clearRect(0, 0, 1024, 256);
    ctx.fillStyle = "#090909";
    ctx.fillRect(0, 0, 1024, 256);
    ctx.strokeStyle = "#383838";
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, 1020, 252);
    ctx.fillStyle = "#ff8a24";
    ctx.fillRect(3, 3, 7, 250);
    ctx.beginPath();
    ctx.arc(39, 51, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f5f5f5";
    ctx.font = "600 34px sans-serif";
    ctx.fillText(String(this.object.userData.title || "Robot"), 62, 62, 900);
    ctx.fillStyle = "#a3a3a3";
    ctx.font = "28px sans-serif";
    ctx.fillText(text.replace(/\s+/g, " "), 62, 112, 920);
    (this.labelPlane.material as THREE.MeshBasicMaterial).map!.needsUpdate = true;
  }

  orientFeedback(cameraPosition: THREE.Vector3): void {
    if (!this.object.visible) return;
    this.object.updateWorldMatrix(true, false);
    const labelPosition = this.labelGroup.getWorldPosition(new THREE.Vector3());
    const towardCamera = cameraPosition.clone().sub(labelPosition);
    if (towardCamera.lengthSq() < 1e-8) return;
    towardCamera.normalize();
    const yaw = Math.atan2(towardCamera.x, towardCamera.z);
    const pitch = -Math.atan2(towardCamera.y, Math.hypot(towardCamera.x, towardCamera.z));
    const worldRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
    this.labelGroup.quaternion.copy(this.object.quaternion).invert().multiply(worldRotation);
  }

  floorWorldY(): number | null {
    const pose = this.floorPose();
    return pose ? pose.position[1] : null;
  }

  floorPose(): { position: Vec3; orientation: Quat } | null {
    if (!this.object.visible) return null;
    return {
      position: [this.object.position.x + this.floorOffset[0], this.object.position.y + this.floorOffset[1], this.object.position.z + this.floorOffset[2]],
      orientation: planarHeading(this.object.quaternion),
    };
  }

  worldPosition(): Vec3 | null {
    return this.object.visible ? [this.object.position.x, this.object.position.y, this.object.position.z] : null;
  }

  reset(): void {
    this.object.visible = false;
    this.unlocalizedCommitted = false;
    this.lastOrigin = null;
    this.object.userData.title = "";
    this.object.userData.activity = "";
  }

  dispose(): void {
    this.object.removeFromParent();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.object.traverse(child => {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) geometries.add(child.geometry);
      const material = (child as THREE.Mesh).material;
      if (Array.isArray(material)) material.forEach(item => materials.add(item));
      else if (material instanceof THREE.Material) materials.add(material);
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
  }

  private applyLocalized(input: Extract<RobotMarkerApplyInput, { mode: "localizedOdom" }>): void {
    const tracking = odomToClientTrackingPose(input.pose, input.origin);
    const webxr = clientTrackingToWebxrPose(tracking);
    this.targetPosition.fromArray(webxr.position);
    this.targetRotation.fromArray(webxr.orientation);
    if (!this.object.visible || this.lastOrigin !== input.origin) {
      this.object.position.copy(this.targetPosition);
      this.object.quaternion.copy(this.targetRotation);
    }
    this.lastOrigin = input.origin;
    this.robotHeightM = input.robot.body_bounds_m[2];
    this.baseHeightM = input.robot.base_height_m;
    this.updateFloorOffset();
    this.updateLabelPosition();
    this.object.userData.title = robotTitleText(input.view);
    this.object.userData.activity = getRobotActivityState(input.view);
    this.object.visible = true;
  }

  private applyUnlocalized(input: Extract<RobotMarkerApplyInput, { mode: "unlocalizedFallbackPosition" }>, fallbackPosition: Vec3 | null): void {
    this.lastOrigin = null;
    if (!this.unlocalizedCommitted) {
      if (!fallbackPosition) { this.object.visible = false; return; }
      this.object.position.set(fallbackPosition[0], fallbackPosition[1], fallbackPosition[2]);
      this.object.quaternion.set(0, 0, 0, 1);
      this.unlocalizedCommitted = true;
    }
    if (input.robot) {
      this.robotHeightM = input.robot.body_bounds_m[2];
      this.floorOffset = clientTrackingToWebxrPoint([0, 0, -input.robot.base_height_m]);
    } else {
      this.floorOffset = [0, -this.robotHeightM * 0.5, 0];
    }
    this.updateLabelPosition();
    this.object.userData.title = robotTitleText(input.view);
    this.object.userData.activity = getRobotActivityState(input.view);
    this.object.visible = true;
  }

  private updateFloorOffset(): void {
    const offset = new THREE.Vector3(0, -this.baseHeightM, 0).applyQuaternion(this.object.quaternion);
    this.floorOffset = offset.toArray() as Vec3;
  }

  private updateLabelPosition(): void {
    const inverse = this.object.quaternion.clone().invert();
    this.labelGroup.position.fromArray(this.floorOffset).add(new THREE.Vector3(0, 0.78, 0)).applyQuaternion(inverse);
  }
}

export class WebXRLidarRenderer {
  readonly object: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;

  constructor() {
    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.PointsMaterial({ size: 0.02, vertexColors: true, depthWrite: false });
    this.object = new THREE.Points(this.geometry, this.material);
    this.object.name = "WebXRLidarRenderer";
    this.object.renderOrder = -100;
    // XR Blocks traverses hidden objects too. Empty clouds must never enter Points.raycast.
    this.object.raycast = () => {};
    this.object.visible = false;
  }

  apply(points: Vec3[] | null, origin: ClientTrackingOrigin | null): void {
    if (!points || points.length === 0 || !origin) {
      this.object.visible = false;
      return;
    }
    const count = Math.min(points.length, MAX_LIDAR_POINTS);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const converted: Vec3[] = [];
    for (let i = 0; i < count; i++) {
      const webxr = clientTrackingToWebxrPoint(odomToClientTrackingPoint(points[i], origin));
      converted.push(webxr);
      minY = Math.min(minY, webxr[1]);
      maxY = Math.max(maxY, webxr[1]);
    }
    const span = Math.max(0.001, maxY - minY);
    for (let i = 0; i < count; i++) {
      const webxr = converted[i];
      positions[i * 3] = webxr[0];
      positions[i * 3 + 1] = webxr[1];
      positions[i * 3 + 2] = webxr[2];
      const t = (webxr[1] - minY) / span;
      colors[i * 3] = 0.5 + 0.284 * t;
      colors[i * 3 + 1] = 0.5 + 0.5 * t;
      colors[i * 3 + 2] = 0.5 - 0.237 * t;
    }
    this.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.geometry.computeBoundingSphere();
    this.object.visible = true;
  }

  hide(): void {
    this.object.visible = false;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class WebXRRouteRenderer {
  readonly object: Line2;
  private geometry: LineGeometry;
  private readonly material: LineMaterial;

  constructor() {
    this.geometry = new LineGeometry();
    this.material = new LineMaterial({ color: 0xffffff, linewidth: 0.015, worldUnits: true, toneMapped: false });
    this.object = new Line2(this.geometry, this.material);
    this.object.name = "WebXRRouteRenderer";
    this.object.raycast = () => {};
    this.object.visible = false;
  }

  apply(
    path: YawPose[] | null,
    origin: ClientTrackingOrigin | null,
    visible: boolean,
    floorY: number | null,
    goalY: number | null,
  ): void {
    if (!visible || !path || path.length < 2 || !origin) {
      this.object.visible = false;
      return;
    }
    const converted: Vec3[] = path.map((pose) => {
      const tracking = odomToClientTrackingYawPose(pose, origin);
      return clientTrackingToWebxrPoint([tracking[0], tracking[1], tracking[2]]);
    });
    const processed = rangePathY(filletPathCorners(converted), floorY, goalY);
    const count = processed.length - 1;
    if (this.geometry.getAttribute("instanceStart")?.count !== count) {
      // WebGL caches the first instance count. A changed segment count needs
      // fresh geometry so a growing route is not capped at its first batch.
      this.geometry.dispose();
      this.geometry = new LineGeometry().setPositions(processed.flat());
      this.object.geometry = this.geometry;
    } else {
      const start = this.geometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute;
      const end = this.geometry.getAttribute("instanceEnd") as THREE.InterleavedBufferAttribute;
      processed.slice(0, -1).forEach((point, index) => {
        start.setXYZ(index, ...point);
        end.setXYZ(index, ...processed[index + 1]);
      });
      start.data.needsUpdate = true;
      this.geometry.computeBoundingBox();
      this.geometry.computeBoundingSphere();
    }
    this.object.visible = true;
  }

  hide(): void {
    this.object.visible = false;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}

function planarHeading(q: THREE.Quaternion): Quat {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const yaw = Math.atan2(-forward.x, -forward.z);
  return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
}
