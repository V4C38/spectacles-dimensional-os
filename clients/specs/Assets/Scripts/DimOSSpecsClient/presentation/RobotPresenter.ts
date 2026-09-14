import { odomToClientTrackingPose, rotateVecByQuat } from "../../DimOSARClient/localization/clientTrackingTransforms";
import type { ARModuleSessionState } from "../../DimOSARClient/websocket/arModuleSession";
import type { Quat, RobotDescription, Vec3 } from "../../DimOSARClient/websocket/protocolTypes";
import {
  COLOR_ERROR,
  COLOR_WHITE,
  NO_ROBOT_CONNECTED_LABEL,
} from "../../DimOSARClient/websocket/sessionLinkStatus";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import { clientTrackingToSpecsPoint, clientTrackingToSpecsPose } from "../utilities/SpecsCoordinates";
import { RuntimePoseSmoothing } from "../utilities/RuntimePoseSmoothing";
import { yawRotationFromWorldRotation } from "../utilities/SpecsUtilities";
import {
  AppState,
  getRobotActivityState,
  robotTitleText,
  type RobotActivityVoice,
  type RobotMarkerApplyInput,
} from "./AppState";
import { findChildRecursive, findText, setButtonStyle, SnapOS2Styles } from "./UIKit";

export interface RobotMarkerApplyContext {
  mainUi: SceneObject;
  fallbackUniformScale?: number;
  appState: AppState;
}

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

  private readonly poseSmoothing = new RuntimePoseSmoothing();
  private robot: RobotDescription | null = null;
  private presented = false;
  private motionRoot: SceneObject | null = null;
  private titleText: Text | null = null;
  private stateInfoText: Text | null = null;
  private debugInfoText: Text | null = null;
  private buttonVfxBusy: SceneObject | null = null;
  private buttonVfxIdle: SceneObject | null = null;
  private debugViewRoot: SceneObject | null = null;
  private toggleCollider: ColliderComponent | null = null;
  private unlocalizedAnchorCommitted = false;
  private unlocalizedAnchorPending = false;
  private pendingUnlocalizedCtx: RobotMarkerApplyContext | null = null;
  private pendingUnlocalizedView: ARModuleSessionState | null = null;
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
      case "unlocalizedFallbackPosition":
        this.applyUnlocalizedBelow(input, ctx);
        return;
      case "localizedOdom":
        this.applyLocalizedOdom(input, ctx);
        return;
    }
  }

  reset(): void {
    this.presented = false;
    this.cancelUnlocalizedAnchor();
    this.robot = null;
    this.poseSmoothing.reset();
    this.getSceneObject().enabled = false;
    if (this.motionRoot) {
      this.motionRoot.enabled = false;
    }
    this.applyDebugViewVisibility(null);
    this.applyButtonVfx(false);
  }

  refreshLabels(
    appState: AppState,
    view: ARModuleSessionState,
    voice: RobotActivityVoice = { asrRunning: false, ttsPlaying: false },
  ): void {
    if (!this.titleText || !this.stateInfoText) {
      return;
    }
    const title = robotTitleText(view);
    this.titleText.text = title;
    this.titleText.textFill.color = title === NO_ROBOT_CONNECTED_LABEL ? COLOR_ERROR : COLOR_WHITE;
    const state = getRobotActivityState(view, voice);
    this.stateInfoText.text = state;
    this.stateInfoText.textFill.color = COLOR_WHITE;
    this.applyButtonVfx(state !== "Idle");
    this.applyDebugViewVisibility(appState);
    if (this.debugInfoText && view.pose) {
      this.debugInfoText.text = view.pose.position
        .map((value) => value.toFixed(2))
        .join(", ");
    }
  }

  tick(dt: number): void {
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
    const position = this.worldPosition();
    const rotation = this.worldRotation();
    if (!position || !rotation || !this.robot) {
      return null;
    }
    const offset = rotateVecByQuat(fromQuat(rotation), robotFloorOffsetCm(this.robot));
    return {
      position: new vec3(position.x + offset[0], position.y + offset[1], position.z + offset[2]),
      rotation,
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
    this.applyButtonVfx(false);
  }

  private applyUnlocalizedBelow(
    input: Extract<RobotMarkerApplyInput, { mode: "unlocalizedFallbackPosition" }>,
    ctx: RobotMarkerApplyContext,
  ): void {
    if (!this.motionRoot) {
      return;
    }
    this.robot = input.robot;
    this.pendingUnlocalizedCtx = ctx;
    this.pendingUnlocalizedView = input.view;
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
    const view = this.pendingUnlocalizedView;
    if (!view) {
      return;
    }
    this.refreshLabels(this.pendingUnlocalizedCtx.appState, view);
  }

  private cancelUnlocalizedAnchor(): void {
    this.unlocalizedAnchorCommitted = false;
    this.unlocalizedAnchorPending = false;
    this.pendingUnlocalizedCtx = null;
    this.pendingUnlocalizedView = null;
    this.unlocalizedPlaceEvent?.reset(0);
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
    const rotation = yawRotationFromWorldRotation(toQuat(specs.orientation));
    const snap = !this.presented;
    this.poseSmoothing.setTarget({ position, rotation }, snap);
    if (snap) {
      this.motionRoot.getTransform().setWorldPosition(position);
      this.motionRoot.getTransform().setWorldRotation(rotation);
    }
    this.robot = input.robot;
    this.presented = true;
    this.getSceneObject().enabled = true;
    this.motionRoot.enabled = true;
    this.applyDebugViewVisibility(ctx.appState);
    this.applyButtonVfx(false);
    this.refreshLabels(ctx.appState, input.view);
  }

  private clearUnlocalizedAnchor(): void {
    this.cancelUnlocalizedAnchor();
    this.poseSmoothing.reset();
    if (this.motionRoot) {
      this.motionRoot.enabled = false;
    }
    this.applyDebugViewVisibility(null);
    this.applyButtonVfx(false);
  }

  private configureSceneRefs(): void {
    const root = this.getSceneObject();
    this.motionRoot = this.odometryRoot ?? findChildRecursive(root, "RobotOdometryRoot");
    if (!this.motionRoot) {
      this.motionRoot = root;
    }
    const toggle = findChildRecursive(this.motionRoot, "RobotToggleButton");
    const labelRoot = toggle ?? this.motionRoot;
    this.titleText = findText(labelRoot, "RobotTitleText");
    this.stateInfoText = findText(labelRoot, "StateInfoText");
    this.debugInfoText = findText(labelRoot, "DebugInfoText");
    if (toggle) {
      this.buttonVfxBusy = findChildRecursive(toggle, "ButtonVFX_Busy");
      this.buttonVfxIdle = findChildRecursive(toggle, "ButtonVFX_Idle");
      if (!this.buttonVfxBusy) {
        throw new Error("ButtonVFX_Busy is required");
      }
      if (!this.buttonVfxIdle) {
        throw new Error("ButtonVFX_Idle is required");
      }
      this.configureRobotToggleButton(toggle);
      this.toggleCollider = toggle.getComponent("Physics.ColliderComponent") as ColliderComponent;
      if (this.toggleCollider) {
        this.toggleCollider.enabled = false;
      }
    } else {
      this.buttonVfxBusy = findChildRecursive(this.motionRoot, "ButtonVFX_Busy");
      this.buttonVfxIdle = findChildRecursive(this.motionRoot, "ButtonVFX_Idle");
      if (!this.buttonVfxBusy) {
        throw new Error("ButtonVFX_Busy is required");
      }
      if (!this.buttonVfxIdle) {
        throw new Error("ButtonVFX_Idle is required");
      }
    }
    this.debugViewRoot = findChildRecursive(this.motionRoot, "RobotDebugView");
    if (this.debugViewRoot) {
      this.debugViewRoot.enabled = false;
    }
    this.applyButtonVfx(false);
  }

  private configureRobotToggleButton(toggleRoot: SceneObject): void {
    const button = toggleRoot.getComponent(RoundButton.getTypeName()) as RoundButton;
    if (!button) {
      return;
    }
    const toggleBtn = button as any;
    toggleBtn._toggleable = false;
    toggleBtn._defaultToOn = false;
    if ("isOn" in toggleBtn) {
      toggleBtn.isOn = false;
    } else if ("_isOn" in toggleBtn) {
      toggleBtn._isOn = false;
    }
    setButtonStyle(button, SnapOS2Styles.Primary);
  }

  private applyDebugViewVisibility(appState: AppState | null): void {
    if (!this.debugViewRoot) {
      return;
    }
    this.debugViewRoot.enabled = this.presented && (appState?.debugModeEnabled ?? false);
  }

  private applyButtonVfx(busy: boolean): void {
    if (this.buttonVfxBusy) {
      this.buttonVfxBusy.enabled = busy && this.presented;
    }
    if (this.buttonVfxIdle) {
      this.buttonVfxIdle.enabled = !busy && this.presented;
    }
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
