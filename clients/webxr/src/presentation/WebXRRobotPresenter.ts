import { ROBOT_LABEL_STYLE } from "@dimos-ar-client/presentation/WorldVisualStyle";
import * as THREE from "three";
import { AdaptiveDashedLineRenderer } from "./AdaptiveDashedLineRenderer";
import { FLOOR_MARKER_STYLE, ROBOT_LINE_STYLE } from "./DimOSARDesign";
import { Text } from "troika-three-text";
import type { ClientTrackingOrigin } from "@dimos-ar-client/localization/clientTrackingOrigin";
import { odomToClientTrackingPose } from "@dimos-ar-client/localization/clientTrackingTransforms";
import type { ARModuleSessionState } from "@dimos-ar-client/websocket/arModuleSession";
import type { Quat, Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import type { StatusTone } from "@dimos-ar-client/websocket/sessionLinkStatus";
import { clientTrackingToWebxrPoint, clientTrackingToWebxrPose } from "../utilities/WebXRCoordinates";
import { registerRayTarget } from "../input/XRBlocksRayInteraction";
import { syncText, UI_FONT_REGULAR, UI_FONT_SEMIBOLD } from "./UIFonts";
import { disposeTextResources } from "./TextResources";
import { indicatorMaterial } from "./PoseIndicatorMaterial";
import { toneHex } from "./StatusTones";
import { deriveRobotMarkerApplyInput, getRobotActivityState, robotTitleText, type RobotMarkerApplyInput } from "./RobotMarkerState";

export type RobotFeedback = {
  tone: StatusTone;
  aligned: boolean;
  activity: string;
  message: string | null;
};

const TAG_WIDTH = ROBOT_LABEL_STYLE.widthM;
const TAG_PADDING = ROBOT_LABEL_STYLE.paddingM;


export class WebXRRobotPresenter {
  readonly object: THREE.Group;
  private readonly gizmo = new THREE.Group();
  private readonly indicator: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly labelGroup: THREE.Group;
  readonly collider: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private readonly outline: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineDashedMaterial>;
  private readonly floorCircle: THREE.Mesh;
  private readonly connectorRenderer = new AdaptiveDashedLineRenderer();
  private readonly outlineRenderer = new AdaptiveDashedLineRenderer();
  private readonly connector = this.connectorRenderer.object;
  private circleOpacity = FLOOR_MARKER_STYLE.idleOpacity as number;
  private connectorFloorY: number | null = null;
  private selectedProgress = 0;
  private floorVisible = false;
  private floorProgress = 0;
  private selected = false;
  private hovered = false;
  private outlineProgress = 0;
  private boundsKey = "";
  private readonly tagDot: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  private readonly tagTitle = new Text();
  private readonly tagStatus = new Text();
  private readonly tagMessage = new Text();
  private robotHeightM = 0;
  private baseHeightM = 0;
  private readonly targetPosition = new THREE.Vector3();
  private readonly targetRotation = new THREE.Quaternion();
  private lastOrigin: ClientTrackingOrigin | null = null;
  private floorOffset: Vec3 = [0, 0, 0];
  private unlocalizedCommitted = false;
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
    this.gizmo.visible = false;
    this.indicator = new THREE.Mesh(new THREE.SphereGeometry(0.03, 32, 16), indicatorMaterial());
    this.indicator.name = "RobotIndicator";
    this.indicator.raycast = () => {};
    this.collider = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ visible: false }));
    this.collider.name = "Robot selection collider";
    this.collider.userData.rayPriority = 20;
    registerRayTarget(this.collider);
    this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(this.collider.geometry), new THREE.LineDashedMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, dashSize: 0.003, gapSize: 0.01 }));
    this.outline.material.visible = false;
    this.outline.add(this.outlineRenderer.object);
    this.outline.computeLineDistances();
    this.outline.name = "Robot selection outline";
    this.outline.raycast = () => {};
    this.outline.scale.setScalar(0);
    this.floorCircle = new THREE.Mesh(new THREE.RingGeometry(0.06 - FLOOR_MARKER_STYLE.strokeM, 0.06, 96), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, toneMapped: false, transparent: true, opacity: 0, depthWrite: false }));
    this.floorCircle.name = "Robot floor circle";
    this.floorCircle.rotation.x = -Math.PI / 2;
    this.floorCircle.raycast = () => {};
    this.connector.name = "Robot floor connector";
    this.connector.raycast = () => {};
    this.object.add(this.gizmo, this.indicator, this.collider, this.outline, this.floorCircle, this.connector);

    // Tag grows upward from its origin, so its bottom edge stays put.
    this.labelGroup = new THREE.Group();
    this.labelGroup.name = "RobotMarkerLabel";
    this.tagDot = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape().absarc(0, 0, ROBOT_LABEL_STYLE.dot.radiusM, 0, Math.PI * 2, false), 20), new THREE.MeshBasicMaterial({ color: 0x8e8e93, transparent: true, depthWrite: false }));

    for (const [text, font, size, color] of [
      [this.tagTitle, UI_FONT_SEMIBOLD, ROBOT_LABEL_STYLE.title.emM, 0xffffff],
      [this.tagStatus, UI_FONT_REGULAR, ROBOT_LABEL_STYLE.activity.emM, 0xffffff],
      [this.tagMessage, UI_FONT_REGULAR, ROBOT_LABEL_STYLE.detail.emM, 0xaeaeb2],
    ] as const) {
      text.font = font;
      text.fontSize = size;
      text.color = color;
      text.anchorX = "center";
      text.anchorY = "top";
      text.maxWidth = TAG_WIDTH - TAG_PADDING * 2;
      text.position.x = 0;
      text.raycast = () => {};
    }
    this.tagTitle.position.x = ROBOT_LABEL_STYLE.title.xM;
    this.tagTitle.maxWidth = ROBOT_LABEL_STYLE.title.widthM;
    for (const [index, child] of [this.tagDot, this.tagTitle, this.tagStatus, this.tagMessage].entries()) {
      child.position.z = index === 0 ? 0 : 0.001;
      child.renderOrder = 20 + Math.min(index, 2);
      this.labelGroup.add(child);
    }
    this.object.add(this.labelGroup);
    this.object.visible = false;
  }

  apply(view: ARModuleSessionState, origin: ClientTrackingOrigin | null, setupCompleted: boolean, fallbackPosition: Vec3 | null): void {
    const input = deriveRobotMarkerApplyInput({ setupCompleted, view, origin });
    if (input.mode === "hidden") { this.reset(); return; }
    if (input.mode === "localizedPending") { this.collider.userData.interactionEnabled = false; return; }
    this.collider.userData.interactionEnabled = true;
    if (input.mode === "unlocalizedFallbackPosition") { this.applyUnlocalized(input, fallbackPosition); return; }
    this.unlocalizedCommitted = false;
    this.applyLocalized(input);
  }

  setConnectorFloorY(y: number | null): void { this.connectorFloorY = y; }

  setCircleOpacity(opacity: number): void { this.circleOpacity = opacity; }

  setFloorVisible(visible: boolean): void { this.floorVisible = visible; }

  setHovered(hovered: boolean): void { this.hovered = hovered; }

  setSelected(selected: boolean): void { this.selected = selected; }

  isSelected(): boolean { return this.selected; }

  setDebug(enabled: boolean): void {
    this.gizmo.visible = enabled;
  }

  tick(deltaS: number): void {
    this.outlineProgress = THREE.MathUtils.clamp(this.outlineProgress + (this.selected || this.hovered ? 1 : -1) * Math.max(0, deltaS) / 0.24, 0, 1);
    const ease = (t: number) => { const value = THREE.MathUtils.clamp(t, 0, 1); return value * value * (3 - 2 * value); };
    const horizontal = ease(this.outlineProgress / 0.4);
    const vertical = ease((this.outlineProgress - 0.4) / 0.6);
    this.outline.scale.set(horizontal, vertical, horizontal);
    this.outline.position.y = -this.baseHeightM + this.collider.scale.y * vertical / 2;
    const alpha = 1 - Math.exp(-32 * Math.max(0, deltaS));
    this.selectedProgress += ((this.selected ? 1 : 0) - this.selectedProgress) * alpha;
    this.outline.material.opacity = (ROBOT_LINE_STYLE.hoverOpacity + (ROBOT_LINE_STYLE.selectedOpacity - ROBOT_LINE_STYLE.hoverOpacity) * this.selectedProgress) * ease(this.outlineProgress / 0.4);
    this.outlineRenderer.setStyle(ROBOT_LINE_STYLE.hoverWidthM + (ROBOT_LINE_STYLE.selectedWidthM - ROBOT_LINE_STYLE.hoverWidthM) * this.selectedProgress, this.outline.material.opacity);
    this.floorProgress += ((this.floorVisible ? 1 : 0) - this.floorProgress) * alpha;
    (this.floorCircle.material as THREE.MeshBasicMaterial).opacity = this.circleOpacity;
    this.floorCircle.visible = this.floorProgress > 0.001;
    this.updateLabelPosition();
    if (!this.object.visible || !this.lastOrigin || deltaS <= 0) return;
    this.object.position.lerp(this.targetPosition, 1 - Math.exp(-8 * deltaS));
    this.object.quaternion.slerp(this.targetRotation, 1 - Math.exp(-4.5 * deltaS));
    this.updateFloorOffset();
    this.updateLabelPosition();
  }

  feedback(info: RobotFeedback): void {
    const title = String(this.object.userData.title || "Robot");
    const status = info.activity;
    const message = String(this.object.userData.coordinates ?? "");
    const labelKey = [title, status, message, info.tone].join("\n");
    if (labelKey === this.labelKey) return;
    this.labelKey = labelKey;
    this.tagTitle.text = title;
    this.tagStatus.text = status;
    this.tagMessage.text = message;
    this.tagMessage.visible = message.length > 0;
    this.tagDot.material.color.setHex(toneHex(info.tone));
    this.tagTitle.position.y = ROBOT_LABEL_STYLE.title.yM;
    this.tagDot.position.set(-0.06, ROBOT_LABEL_STYLE.dot.yM, 0.001);
    this.tagStatus.position.y = ROBOT_LABEL_STYLE.activity.yM;
    this.tagMessage.position.y = ROBOT_LABEL_STYLE.detail.yM;
    syncText(this.tagTitle, this.tagStatus, this.tagMessage);
    if (typeof Worker !== "undefined") this.tagTitle.sync(() => {
      const bounds = this.tagTitle.textRenderInfo?.blockBounds;
      if (!bounds) return;
      const width = bounds[2] - bounds[0];
      this.tagTitle.position.x = ROBOT_LABEL_STYLE.title.xM;
      this.tagDot.position.x = -(width + ROBOT_LABEL_STYLE.dot.gapM) / 2 + ROBOT_LABEL_STYLE.dot.radiusM;
    });
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

  floorCircleBounds(): { center: Vec3; radius: number } {
    const center = this.floorCircle.getWorldPosition(new THREE.Vector3()).toArray() as Vec3;
    return { center, radius: 0.06 * this.floorCircle.getWorldScale(new THREE.Vector3()).x };
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
    this.selected = this.hovered = false;
    this.outlineProgress = this.floorProgress = this.selectedProgress = 0;
    this.floorVisible = false;
    this.outline.scale.setScalar(0);
    this.floorCircle.visible = false;
    this.outline.material.opacity = 0;
    this.unlocalizedCommitted = false;
    this.lastOrigin = null;
    this.object.userData.title = "";
    this.object.userData.activity = "";
  }

  dispose(): void {
    this.object.removeFromParent();
    this.connectorRenderer.dispose(); this.outlineRenderer.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.object.traverse(child => {
      if (child instanceof Text) return;
      if (child instanceof THREE.InstancedMesh) child.dispose();
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) geometries.add(child.geometry);
      const material = (child as THREE.Mesh).material;
      if (Array.isArray(material)) material.forEach(item => materials.add(item));
      else if (material instanceof THREE.Material) materials.add(material);
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    for (const text of [this.tagTitle, this.tagStatus, this.tagMessage]) disposeTextResources(text);
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
    this.updateBounds(input.robot.body_bounds_m, input.robot.base_height_m);
    this.object.userData.coordinates = input.view.pose?.position.map(value => value.toFixed(2)).join(", ") ?? "";
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
      this.updateBounds(input.robot.body_bounds_m, input.robot.base_height_m);
      this.baseHeightM = input.robot.base_height_m;
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

  private updateBounds(bounds: Vec3, baseHeight: number): void {
    const key = [...bounds, baseHeight].join(",");
    if (key === this.boundsKey) return;
    this.boundsKey = key;
    this.collider.scale.set(bounds[1], bounds[2], bounds[0]);
    this.collider.position.set(0, bounds[2] / 2 - baseHeight, 0);
    this.outline.geometry.dispose();
    const box = new THREE.BoxGeometry(bounds[1], bounds[2], bounds[0]);
    this.outline.geometry = new THREE.EdgesGeometry(box);
    box.dispose();
    this.outline.computeLineDistances();
    this.outline.position.copy(this.collider.position);
    const edges = this.outline.geometry.getAttribute("position");
    this.outlineRenderer.setSegments(Array.from({ length: edges.count }, (_, i) => [edges.getX(i), edges.getY(i), edges.getZ(i)] as Vec3));
    this.floorCircle.position.set(0, -baseHeight + 0.001, 0);

  }

  private updateFloorOffset(): void {
    const offset = new THREE.Vector3(0, -this.baseHeightM, 0).applyQuaternion(this.object.quaternion);
    this.floorOffset = offset.toArray() as Vec3;
  }

  private updateLabelPosition(): void {
    const inverse = this.object.quaternion.clone().invert();
    // Floor feedback stays horizontal and directly beneath the pose during body tilt.

    this.floorCircle.position.copy(new THREE.Vector3(0, this.floorOffset[1] + 0.001, 0).applyQuaternion(inverse));
    this.floorCircle.quaternion.copy(inverse).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
    const floorY = Math.max(this.object.position.y + this.floorOffset[1] + 0.001, this.connectorFloorY ?? -Infinity);
    const length = Math.max(0, this.object.position.y - floorY - 0.02);
    const top = new THREE.Vector3(0, -0.03, 0).applyQuaternion(inverse);
    const bottom = new THREE.Vector3(0, -Math.max(0.03, length), 0).applyQuaternion(inverse);
    this.connectorRenderer.setSegments([top.toArray() as Vec3, bottom.toArray() as Vec3]);
    this.connectorRenderer.setStyle(ROBOT_LINE_STYLE.selectedWidthM, ROBOT_LINE_STYLE.selectedOpacity);
    this.connector.visible = length > 0.03;
    // Just above the robot body, so the tag reads as attached to it.
    this.labelGroup.position.copy(new THREE.Vector3(0, ROBOT_LABEL_STYLE.offsetYM, 0).applyQuaternion(inverse));
  }
}

function planarHeading(q: THREE.Quaternion): Quat {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const yaw = Math.atan2(-forward.x, -forward.z);
  return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
}
