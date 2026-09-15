import * as THREE from "three";
import type { ClientTrackingOrigin } from "@dimos-ar-client/localization/clientTrackingOrigin";
import {
  odomToClientTrackingPoint,
  odomToClientTrackingPose,
  odomToClientTrackingYawPose,
  rotateVecByQuat,
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
  private readonly mesh: THREE.Mesh;
  private lastKey = "";
  private robotHeightM = 0;
  private floorOffset: Vec3 = [0, 0, 0];
  private unlocalizedCommitted = false;

  constructor() {
    this.object = new THREE.Group();
    this.object.name = "WebXRRobotPresenter";
    this.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x4c8bf5 }),
    );
    this.object.add(this.mesh);
    this.object.visible = false;
  }

  apply(
    view: ARModuleSessionState,
    origin: ClientTrackingOrigin | null,
    setupCompleted: boolean,
    fallbackPosition: Vec3 | null,
  ): void {
    const input = deriveRobotMarkerApplyInput({ setupCompleted, view, origin });
    if (input.mode === "hidden") {
      this.reset();
      return;
    }
    if (input.mode === "unlocalizedFallbackPosition") {
      this.applyUnlocalized(input, fallbackPosition);
      return;
    }
    this.unlocalizedCommitted = false;
    this.applyLocalized(input);
  }

  floorWorldY(): number | null {
    const pose = this.floorPose();
    return pose ? pose.position[1] : null;
  }

  floorPose(): { position: Vec3; orientation: Quat } | null {
    if (!this.object.visible) {
      return null;
    }
    return {
      position: [
        this.object.position.x + this.floorOffset[0],
        this.object.position.y + this.floorOffset[1],
        this.object.position.z + this.floorOffset[2],
      ],
      orientation: [
        this.object.quaternion.x,
        this.object.quaternion.y,
        this.object.quaternion.z,
        this.object.quaternion.w,
      ],
    };
  }

  worldPosition(): Vec3 | null {
    if (!this.object.visible) {
      return null;
    }
    return [this.object.position.x, this.object.position.y, this.object.position.z];
  }

  reset(): void {
    this.object.visible = false;
    this.unlocalizedCommitted = false;
    this.object.userData.title = "";
    this.object.userData.activity = "";
  }

  dispose(): void {
    this.object.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  private applyLocalized(input: Extract<RobotMarkerApplyInput, { mode: "localizedOdom" }>): void {
    const tracking = odomToClientTrackingPose(input.pose, input.origin);
    const webxr = clientTrackingToWebxrPose(tracking);
    this.object.position.set(webxr.position[0], webxr.position[1], webxr.position[2]);
    this.object.quaternion.set(
      webxr.orientation[0],
      webxr.orientation[1],
      webxr.orientation[2],
      webxr.orientation[3],
    );
    this.applyBounds(input.robot.body_bounds_m);
    const trackingDown = rotateVecByQuat(tracking.orientation, [0, 0, -input.robot.base_height_m]);
    const floorTracking: Vec3 = [
      tracking.position[0] + trackingDown[0],
      tracking.position[1] + trackingDown[1],
      tracking.position[2] + trackingDown[2],
    ];
    const floorWebxr = clientTrackingToWebxrPoint(floorTracking);
    this.floorOffset = [
      floorWebxr[0] - webxr.position[0],
      floorWebxr[1] - webxr.position[1],
      floorWebxr[2] - webxr.position[2],
    ];
    this.object.userData.title = robotTitleText(input.view);
    this.object.userData.activity = getRobotActivityState(input.view);
    this.object.visible = true;
  }

  private applyUnlocalized(
    input: Extract<RobotMarkerApplyInput, { mode: "unlocalizedFallbackPosition" }>,
    fallbackPosition: Vec3 | null,
  ): void {
    if (!this.unlocalizedCommitted) {
      if (!fallbackPosition) {
        this.object.visible = false;
        return;
      }
      this.object.position.set(fallbackPosition[0], fallbackPosition[1], fallbackPosition[2]);
      this.object.quaternion.set(0, 0, 0, 1);
      this.unlocalizedCommitted = true;
    }
    if (input.robot) {
      this.applyBounds(input.robot.body_bounds_m);
      this.floorOffset = clientTrackingToWebxrPoint([0, 0, -input.robot.base_height_m]);
    } else {
      this.floorOffset = [0, -this.robotHeightM * 0.5, 0];
    }
    this.object.userData.title = robotTitleText(input.view);
    this.object.userData.activity = getRobotActivityState(input.view);
    this.object.visible = true;
  }

  private applyBounds(bounds: Vec3): void {
    const key = bounds.join(",");
    if (key === this.lastKey) {
      return;
    }
    this.mesh.scale.set(bounds[1], bounds[2], bounds[0]);
    this.robotHeightM = bounds[2];
    this.lastKey = key;
  }
}

export class WebXRLidarRenderer {
  readonly object: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;

  constructor() {
    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.PointsMaterial({ size: 0.02, vertexColors: true });
    this.object = new THREE.Points(this.geometry, this.material);
    this.object.name = "WebXRLidarRenderer";
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
      colors[i * 3] = 0.2 + 0.2 * t;
      colors[i * 3 + 1] = 1 - 0.4 * t;
      colors[i * 3 + 2] = 0.4 + 0.4 * t;
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
  readonly object: THREE.Line;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.LineBasicMaterial;

  constructor() {
    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.LineBasicMaterial({ color: 0xffcc33 });
    this.object = new THREE.Line(this.geometry, this.material);
    this.object.name = "WebXRRouteRenderer";
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
    const positions = new Float32Array(processed.length * 3);
    for (let i = 0; i < processed.length; i++) {
      positions[i * 3] = processed[i][0];
      positions[i * 3 + 1] = processed[i][1];
      positions[i * 3 + 2] = processed[i][2];
    }
    this.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
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
