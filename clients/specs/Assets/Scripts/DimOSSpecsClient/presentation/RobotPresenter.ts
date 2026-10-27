import { RobotWorldRenderer } from "./RobotWorldRenderer";
import { odomToClientTrackingPose, rotateVecByQuat } from "../../DimOSARClient/localization/clientTrackingTransforms";
import type { ARModuleSessionState } from "../../DimOSARClient/websocket/arModuleSession";
import type { Quat, RobotDescription, Vec3 } from "../../DimOSARClient/websocket/protocolTypes";
import { sessionLinkStatus } from "../../DimOSARClient/websocket/sessionLinkStatus";
import { clientTrackingToSpecsPoint, clientTrackingToSpecsPose } from "../utilities/SpecsCoordinates";
import { RuntimePoseSmoothing } from "../utilities/RuntimePoseSmoothing";
import { yawRotationFromPlanarDirection } from "../utilities/SpecsUtilities";
import {
  AppState,
  getRobotActivityState,
  robotTitleText,
  type RobotActivityVoice,
  type RobotMarkerApplyInput,
} from "./AppState";
import { findChildRecursive } from "./UIKit";

export interface RobotMarkerApplyContext {
  mainUi: SceneObject;
  fallbackUniformScale?: number;
  appState: AppState;
}

const GO2_BASE_HEIGHT_M = 0.33;

export function robotFloorOffsetCm(robot: RobotDescription): Vec3 {
  return clientTrackingToSpecsPoint([0, 0, -robot.base_height_m]);
}

export function robotDeadzoneRadiusCm(robot: RobotDescription): number {
  const maxDimensionCm = Math.max(...robot.footprint_m) * 100;
  return Math.max(20, maxDimensionCm * 0.5 + 20);
}

export function robotBelowMainUiLocalOffset(): vec3 {
  return new vec3(0, -40, 0.5);
}

export function robotBelowMainUiWorldPosition(
  mainUi: SceneObject,
  fallbackUniformScale: number = 1,
): vec3 {
  const transform = mainUi.getTransform();
  const worldPosition = transform.getWorldPosition();
  const worldRotation = transform.getWorldRotation();
  const worldScale = transform.getWorldScale();
  const local = robotBelowMainUiLocalOffset();
  const scaleX = Math.abs(worldScale.x) > 1e-4 ? worldScale.x : fallbackUniformScale;
  const scaleY = Math.abs(worldScale.y) > 1e-4 ? worldScale.y : fallbackUniformScale;
  const scaleZ = Math.abs(worldScale.z) > 1e-4 ? worldScale.z : fallbackUniformScale;
  const scaledLocal = new vec3(local.x * scaleX, local.y * scaleY, local.z * scaleZ);
  return worldPosition.add(worldRotation.multiplyVec3(scaledLocal));
}

@component
export class RobotPresenter extends BaseScriptComponent {
  @input
  odometryRoot: SceneObject;

  private worldVisuals: RobotWorldRenderer | null = null;
  private onToggle: (() => void) | null = null;
  private eye: SceneObject | null = null;
  private canToggle: ((sourceId: string) => boolean) | null = null;
  private viewportHeight = 1024;
  bindSelection(onToggle: () => void, camera: SceneObject, canToggle?: (sourceId: string) => boolean): void {
    this.onToggle = onToggle; this.eye = camera; this.canToggle = canToggle ?? null;
  }
  setSelected(selected: boolean): void { this.worldVisuals?.setSelected(selected); }
  setHovered(hovered: boolean): void { this.worldVisuals?.setHovered(hovered); }
  ownsTarget(object: SceneObject): boolean { return this.worldVisuals?.ownsTarget(object) === true; }
  setNavigationFloor(visible: boolean, opacity: number): void { this.worldVisuals?.setFloorVisible(visible, opacity); }
  setViewportHeight(height: number): void { this.viewportHeight = height; }
  floorCircleBounds() {
    const p = this.floorPose()?.position, world = this.worldPosition();
    return p && world ? { center: [world.x, p.y + 1.5, world.z] as [number, number, number], radius: 6 } : undefined;
  }

  private readonly poseSmoothing = new RuntimePoseSmoothing();
  private robot: RobotDescription | null = null;
  private presented = false;
  private referenceFloorHeight: number | null = null;
  setFloorHeight(height: number | null): void { this.referenceFloorHeight = height; }
  private motionRoot: SceneObject | null = null;
  private debugViewRoot: SceneObject | null = null;
  private unlocalizedAnchorCommitted = false;
  private unlocalizedAnchorPending = false;
  private pendingUnlocalizedCtx: RobotMarkerApplyContext | null = null;
  private unlocalizedPlaceEvent: DelayedCallbackEvent | null = null;

  onAwake(): void {
    this.configureSceneRefs();
    const placeEv = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    placeEv.bind(() => this.commitUnlocalizedAnchor());
    this.unlocalizedPlaceEvent = placeEv;
    this.reset();
    const updateEvent = this.createEvent("UpdateEvent");
    updateEvent.bind(() => this.tick(getDeltaTime()));
  }

  apply(input: RobotMarkerApplyInput, ctx: RobotMarkerApplyContext): void {
    switch (input.mode) {
      case "hidden":
        this.applyHidden();
        return;
      case "localizedPending":
        this.poseSmoothing.reset();
        this.worldVisuals?.setPickingEnabled(false);
        return;
      case "unlocalizedFallbackPosition":
        this.applyUnlocalizedBelow(input, ctx);
        return;
      case "localizedOdom":
        this.applyLocalizedOdom(input, ctx);
        return;
    }
  }

  dispose(): void {
    this.reset(); this.worldVisuals?.dispose(); this.worldVisuals = null;
    this.onToggle = null; this.eye = null; this.canToggle = null;
  }

  reset(): void {
    this.referenceFloorHeight = null;
    this.presented = false;
    this.cancelUnlocalizedAnchor();
    this.robot = null;
    this.poseSmoothing.reset();
    this.getSceneObject().enabled = false;
    if (this.motionRoot) {
      this.motionRoot.enabled = false;
    }
    this.applyDebugViewVisibility(null);
    this.worldVisuals?.reset();
  }

  refreshLabels(
    appState: AppState,
    view: ARModuleSessionState,
    voice: RobotActivityVoice & { status?: string },
  ): void {
    const title = robotTitleText(view);
    const state = getRobotActivityState(view, voice);
    this.worldVisuals?.labels(title, state, appState.debugModeEnabled ? view.pose?.position.map(v => v.toFixed(2)).join(", ") ?? "" : "", sessionLinkStatus(view).color);
    this.applyDebugViewVisibility(appState);
  }

  tick(dt: number): void {
    if (this.presented && this.motionRoot && !this.worldVisuals) {
      this.worldVisuals = new RobotWorldRenderer(this.motionRoot, sourceId => {
        if (this.canToggle?.(sourceId) !== false) this.onToggle?.();
      });
      this.worldVisuals.setRobot(this.robot);
      const toggle = findChildRecursive(this.motionRoot, "RobotToggleButton");
      if (toggle) toggle.enabled = false;
    }
    this.worldVisuals?.tick(dt, this.floorPose(), this.eye?.getTransform().getWorldPosition() ?? null, this.viewportHeight);
    if (this.unlocalizedAnchorCommitted || !this.presented || !this.motionRoot || !this.poseSmoothing.isTracking) {
      return;
    }
    const transform = this.motionRoot.getTransform();
    const current = {
      position: transform.getWorldPosition(),
      rotation: transform.getWorldRotation(),
    };
    const smoothed = this.poseSmoothing.tick(current, dt);
    if (!smoothed) {
      return;
    }
    transform.setWorldPosition(smoothed.position);
    transform.setWorldRotation(smoothed.rotation);
  }

  worldPosition(): vec3 | null {
    if (!this.presented || !this.motionRoot) {
      return null;
    }
    return this.motionRoot.getTransform().getWorldPosition();
  }

  worldRotation(): quat | null {
    if (!this.presented || !this.motionRoot) {
      return null;
    }
    return this.motionRoot.getTransform().getWorldRotation();
  }

  floorWorldY(): number | null {
    return this.floorPose()?.position.y ?? null;
  }

  floorPose(): { position: vec3; rotation: quat } | null {
    const pose = this.rawFloorPose();
    if (pose && this.referenceFloorHeight !== null) pose.position.y = this.referenceFloorHeight;
    return pose;
  }

  containsBodyPoint(point: vec3): boolean {
    const position = this.worldPosition(), rotation = this.worldRotation();
    if (!position || !rotation || !this.robot) return false;
    const local = new quat(rotation.w, -rotation.x, -rotation.y, -rotation.z).multiplyVec3(point.sub(position));
    const [length, width, height] = this.robot.body_bounds_m.map(value => value * 100);
    const floor = -this.robot.base_height_m * 100;
    return Math.abs(local.x) <= width / 2 && Math.abs(local.z) <= length / 2 && local.y > floor + 3 && local.y <= floor + height;
  }

  rawFloorPose(): { position: vec3; rotation: quat } | null {
    const position = this.worldPosition();
    const rotation = this.worldRotation();
    if (!position || !rotation) {
      return null;
    }
    const baseHeightM = this.robot?.base_height_m ?? GO2_BASE_HEIGHT_M;
    const offset = rotateVecByQuat(
      fromQuat(rotation),
      clientTrackingToSpecsPoint([0, 0, -baseHeightM]),
    );
    // Generic Specs poses retain Lens -Z as robot forward. Ground markers use
    // a local +X arrow, so give placement the corresponding marker heading.
    const forward = rotation.multiplyVec3(new vec3(0, 0, -1));
    return {
      position: new vec3(position.x + offset[0], position.y + offset[1], position.z + offset[2]),
      rotation: yawRotationFromPlanarDirection(forward.x, forward.z),
    };
  }

  deadzoneRadiusCm(): number | null {
    if (!this.presented || !this.robot) {
      return null;
    }
    return robotDeadzoneRadiusCm(this.robot);
  }

  private applyHidden(): void {
    this.presented = false;
    this.cancelUnlocalizedAnchor();
    this.getSceneObject().enabled = false;
    if (this.motionRoot) {
      this.motionRoot.enabled = false;
    }
    this.applyDebugViewVisibility(null);
    this.worldVisuals?.reset();
  }

  private applyUnlocalizedBelow(
    input: Extract<RobotMarkerApplyInput, { mode: "unlocalizedFallbackPosition" }>,
    ctx: RobotMarkerApplyContext,
  ): void {
    if (!this.motionRoot) {
      return;
    }
    this.robot = input.robot;
    this.worldVisuals?.setRobot(input.robot);
    this.pendingUnlocalizedCtx = ctx;
    if (this.unlocalizedAnchorCommitted) {
      this.showUnlocalizedAnchor();
      return;
    }
    if (this.unlocalizedAnchorPending) {
      return;
    }
    this.unlocalizedAnchorPending = true;
    this.poseSmoothing.reset();
    this.getSceneObject().enabled = true;
    this.unlocalizedPlaceEvent?.reset(1);
  }

  private commitUnlocalizedAnchor(): void {
    const ctx = this.pendingUnlocalizedCtx;
    if (!this.unlocalizedAnchorPending || !this.motionRoot || !ctx) {
      return;
    }
    this.unlocalizedAnchorPending = false;
    const worldPosition = robotBelowMainUiWorldPosition(
      ctx.mainUi,
      ctx.fallbackUniformScale ?? 1,
    );
    const transform = this.motionRoot.getTransform();
    transform.setWorldPosition(worldPosition);
    transform.setWorldRotation(quat.quatIdentity());
    this.unlocalizedAnchorCommitted = true;
    this.showUnlocalizedAnchor();
  }

  private showUnlocalizedAnchor(): void {
    if (!this.motionRoot || !this.pendingUnlocalizedCtx) {
      return;
    }
    this.presented = true;
    this.getSceneObject().enabled = true;
    this.motionRoot.enabled = true;
    this.applyDebugViewVisibility(this.pendingUnlocalizedCtx.appState);
  }

  private cancelUnlocalizedAnchor(): void {
    this.unlocalizedAnchorCommitted = false;
    this.unlocalizedAnchorPending = false;
    this.pendingUnlocalizedCtx = null;
    this.unlocalizedPlaceEvent?.cancel();
  }

  private applyLocalizedOdom(
    input: Extract<RobotMarkerApplyInput, { mode: "localizedOdom" }>,
    ctx: RobotMarkerApplyContext,
  ): void {
    if (!this.motionRoot) {
      return;
    }
    if (this.unlocalizedAnchorCommitted || this.unlocalizedAnchorPending) {
      this.clearUnlocalizedAnchor();
    }
    const specs = clientTrackingToSpecsPose(
      odomToClientTrackingPose(input.pose, input.origin),
    );
    const position = toVec3(specs.position);
    const rotation = toQuat(specs.orientation);
    const snap = !this.presented;
    this.poseSmoothing.setTarget({ position, rotation }, snap);
    if (snap) {
      this.motionRoot.getTransform().setWorldPosition(position);
      this.motionRoot.getTransform().setWorldRotation(rotation);
    }
    this.robot = input.robot;
    this.worldVisuals?.setRobot(input.robot);
    this.presented = true;
    this.getSceneObject().enabled = true;
    this.motionRoot.enabled = true;
    this.applyDebugViewVisibility(ctx.appState);
  }

  private clearUnlocalizedAnchor(): void {
    this.cancelUnlocalizedAnchor();
    this.poseSmoothing.reset();
    if (this.motionRoot) {
      this.motionRoot.enabled = false;
    }
    this.applyDebugViewVisibility(null);
    this.worldVisuals?.reset();
  }

  private configureSceneRefs(): void {
    const root = this.getSceneObject();
    this.motionRoot = this.odometryRoot ?? findChildRecursive(root, "RobotOdometryRoot");
    if (!this.motionRoot) {
      this.motionRoot = root;
    }
    const toggle = findChildRecursive(this.motionRoot, "RobotToggleButton");
    if (toggle) toggle.enabled = false;
    this.debugViewRoot = findChildRecursive(this.motionRoot, "RobotDebugView");
    if (this.debugViewRoot) {
      this.debugViewRoot.enabled = false;
    }
  }

  private applyDebugViewVisibility(appState: AppState | null): void {
    if (!this.debugViewRoot) {
      return;
    }
    this.debugViewRoot.enabled = this.presented && (appState?.debugModeEnabled ?? false);
  }


}

function toVec3(value: Vec3): vec3 {
  return new vec3(value[0], value[1], value[2]);
}

function toQuat(value: Quat): quat {
  return new quat(value[3], value[0], value[1], value[2]);
}

function fromQuat(value: quat): Quat {
  return [value.x, value.y, value.z, value.w];
}
