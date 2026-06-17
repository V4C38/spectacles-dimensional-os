import {
  AppStateListener,
  DimosAppState,
  navigationOutcomePresentation,
  robotMarkerSteadyStatePresentation,
  OperatingMode,
  RobotInteractionMode,
} from "../Core/AppState";
import { PoseMessage, protocolMetersToLensCentimeters } from "../Bridge/Protocol";
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { InteractableManipulation } from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import { yawRotationFromWorldRotation } from "../Navigation/HeadingRotation";
import { COLOR_WHITE, findText, findChildRecursive, requireChild } from "../UI/kit/UIKit";
import { vec3Distance, quatAngularDistanceRad } from "../Core/MathUtils";
import { FrameCaptureController } from "../Alignment/FrameCaptureController";
import { ManualPoseCorrection, ResolvedDisplayPose } from "../Alignment/ManualPoseCorrection";
import { RobotMenuView } from "./RobotMenuView";
import { UILogEntry, UILogger } from "../Core/UILogger";

const ROBOT_UI_WORLD_UP_OFFSET_CM = 15.0;
const POSITION_DEADBAND_CM = 0.75;
const ROTATION_DEADBAND_RAD = (1.0 * Math.PI) / 180.0;
const POSITION_SNAP_CM = 0.2;
const ROTATION_SNAP_RAD = (0.25 * Math.PI) / 180.0;
const RUNTIME_POSE_SMOOTHING_RATE = 14.0;
const REFINED_TRACKING_LOG_TEXT = "- Refined Tracking -";
const REFINED_TRACKING_LOG_DURATION_S = 0.5;
// Duration of the fixed-time realignment snap triggered by a meaningful pose_correction.
const REALIGN_SNAP_DURATION_S = 0.2;

/** World-space robot marker with live pose, manual placement, floating robot menu anchor, and interaction-mode switching. */
@component
export class RobotMarker extends BaseScriptComponent {
  @input
  markerRoot: SceneObject;

  @input
  frameCapture: FrameCaptureController;

  private _configured = false;
  private _placementHandle: SceneObject | null = null;
  private _manualCollider: ColliderComponent | null = null;
  private _manualInteractable: Interactable | null = null;
  private _manualManipulation: InteractableManipulation | null = null;
  private _toggleRoot: SceneObject | null = null;
  private _directionArrow: SceneObject | null = null;
  private _toggleCollider: ColliderComponent | null = null;
  private _toggleButton: RoundButton | null = null;
  private _menuRoot: SceneObject | null = null;
  private _runtimeTrackingActive = false;
  private _runtimeTargetPosition: vec3 | null = null;
  private _runtimeTargetRotation: quat | null = null;
  // Realignment snap state — triggered by beginRealignmentSnap().
  private _snapRequested = false;
  private _snapActive = false;
  private _snapStartTime = 0;
  private _snapStartPosition: vec3 | null = null;
  private _snapStartRotation: quat | null = null;
  // Button VFX objects resolved in _configureVisuals.
  private _buttonVfxActive: SceneObject | null = null;
  private _buttonVfxInactive: SceneObject | null = null;
  private _manualPlacementActive = false;
  private _renderOffsetCm = vec3.zero();
  private _toggleBaseLocalPosition: vec3 | null = null;
  private _directionArrowBaseLocalPosition: vec3 | null = null;
  private _placementHandleBaseLocalPosition: vec3 | null = null;
  private _stateInfoText: Text | null = null;
  private _debugInfoText: Text | null = null;
  private _unsubscribeAppState: (() => void) | null = null;
  private _unsubscribeUILog: (() => void) | null = null;
  private _debugMode = false;
  private _uiLogger: UILogger | null = null;
  private _uiLogEntry: UILogEntry | null = null;
  private _rotation = quat.quatIdentity();
  private _lastNotifiedWorldPosition: vec3 | null = null;

  // ── Presenter deps (injected via initialize) ───────────────────
  private _poseCorrection: ManualPoseCorrection | null = null;
  private _robotMenuView: RobotMenuView | null = null;
  private _getLastPose: (() => PoseMessage | null) | null = null;
  private _getIsActive: (() => boolean) | null = null;
  private _getOperatingMode: (() => OperatingMode) | null = null;
  private _getInteractionMode: (() => RobotInteractionMode) | null = null;
  private _syncNavPlacement: (() => void) | null = null;
  private _onWorldPositionChanged: ((position: vec3) => void) | null = null;
  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this._configureVisuals();
      this.setVisible(false);
    });
    this.createEvent("UpdateEvent").bind(() => {
      if (this._manualPlacementActive) {
        this.syncRotationFromScene();
      } else if (this._runtimeTrackingActive) {
        this._tickRuntimePoseSmoothing();
      }
      this._notifyWorldPositionIfMoved();
      this._syncMenuWorldAnchor();
    });
    this.createEvent("OnDestroyEvent").bind(() => {
      this._unsubscribeAppState?.();
      this._unsubscribeAppState = null;
      this._unsubscribeUILog?.();
      this._unsubscribeUILog = null;
    });
  }

  public bindAppState(
    subscribe: (listener: AppStateListener) => () => void,
  ): void {
    this._unsubscribeAppState?.();
    this._unsubscribeAppState = subscribe((state) => this._applyStateInfo(state));
  }

  /** Inject presenter dependencies that cannot be @inputs. */
  public initialize(deps: {
    poseCorrection: ManualPoseCorrection;
    uiLogger: UILogger;
    getLastPose: () => PoseMessage | null;
    robotMenuView: RobotMenuView | null;
    getIsActive: () => boolean;
    getOperatingMode: () => OperatingMode;
    getInteractionMode: () => RobotInteractionMode;
    syncNavigationPlacementState: () => void;
    onWorldPositionChanged?: (position: vec3) => void;
  }): void {
    this._poseCorrection = deps.poseCorrection;
    this._uiLogger = deps.uiLogger;
    this._getLastPose = deps.getLastPose;
    this._robotMenuView = deps.robotMenuView;
    this._getIsActive = deps.getIsActive;
    this._getOperatingMode = deps.getOperatingMode;
    this._getInteractionMode = deps.getInteractionMode;
    this._syncNavPlacement = deps.syncNavigationPlacementState;
    this._onWorldPositionChanged = deps.onWorldPositionChanged ?? null;
    this._unsubscribeUILog?.();
    this._unsubscribeUILog = this._uiLogger.subscribe((entry) =>
      this._applyUILogEntry(entry),
    );
  }

  /**
   * Apply an interaction mode: hidden / manualPlacement / runtimeRobot.
   * Formerly RobotMarkerPresenter.applyInteractionMode.
   */
  public applyInteractionMode(mode: RobotInteractionMode): void {
    const menu = this._robotMenuView;
    switch (mode) {
      case "hidden":
        this.setManualPlacementEnabled(false);
        this.setToggleEnabled(false);
        this.setMenuEnabled(false);
        this.setVisible(false);
        menu?.hide();
        this._syncNavPlacement?.();
        return;
      case "manualPlacement":
        this.setVisible(true);
        this.setToggleEnabled(false);
        this.setMenuEnabled(false);
        this.setManualPlacementEnabled(true);
        menu?.hide();
        this.syncPose();
        this._syncNavPlacement?.();
        return;
      case "runtimeRobot":
        const isActive = this._getIsActive?.() ?? false;
        this.setVisible(isActive);
        this.setToggleEnabled(isActive);
        this.setMenuEnabled(isActive);
        this.setManualPlacementEnabled(false);
        if (isActive) {
          const opMode = this._getOperatingMode?.();
          if (opMode) {
            menu?.setOperatingMode(opMode);
          }
          this.syncPose();
        } else {
          menu?.hide();
        }
        this._syncNavPlacement?.();
        return;
    }
  }

  /** Re-resolve and apply the display pose from the last bridge pose. */
  public syncPose(): void {
    if (!this._poseCorrection || !this._getLastPose || !this._getInteractionMode) {
      return;
    }
    const lastPose = this._getLastPose();
    const resolved = this._poseCorrection.resolveDisplayPose(
      lastPose,
      this._getInteractionMode(),
    );
    this._applyResolvedPoseInternal(resolved, lastPose);
  }

  /** Apply an already-resolved display pose. */
  public applyResolvedPose(resolved: ResolvedDisplayPose, bridgePose: PoseMessage | null): void {
    this._applyResolvedPoseInternal(resolved, bridgePose);
  }

  private _applyResolvedPoseInternal(
    resolved: ResolvedDisplayPose,
    bridgePose: PoseMessage | null,
  ): void {
    switch (resolved.kind) {
      case "manual":
        this.applyManualPose(resolved.position!, resolved.rotation!);
        break;
      case "bridge":
        if (bridgePose) {
          this.applyPose(bridgePose);
        }
        break;
      case "corrected":
        this.applyRuntimeLensPose(resolved.position!, resolved.rotation!);
        break;
      case "none":
        break;
    }
  }

  public applyPose(msg: PoseMessage): void {
    if (!this.markerRoot) {
      return;
    }
    this.markerRoot.enabled = true;
    const q = msg.orientation;
    const position = protocolMetersToLensCentimeters(msg.position);
    const rotation = new quat(q[3], q[0], q[1], q[2]);
    this.frameCapture?.setRobotWorldPosition(position);
    this._applyRuntimePose(position, rotation);
  }

  public applyManualPose(position: vec3, rotation: quat): void {
    if (!this.markerRoot) {
      return;
    }
    this.resetRuntimePoseSmoothing();
    this.markerRoot.enabled = true;
    this.frameCapture?.setRobotWorldPosition(position);
    this.setPose(position, rotation);
  }

  public applyRuntimeLensPose(position: vec3, rotation: quat): void {
    if (!this.markerRoot) {
      return;
    }
    this.markerRoot.enabled = true;
    this.frameCapture?.setRobotWorldPosition(position);
    this._applyRuntimePose(position, rotation);
  }

  public notifyAlignmentUpdated(): void {
    this._uiLogger?.show(
      REFINED_TRACKING_LOG_TEXT,
      COLOR_WHITE,
      REFINED_TRACKING_LOG_DURATION_S,
    );
  }

  /**
   * Request a fixed-duration 0.2 s snap on the next incoming runtime pose.
   * Call this whenever a meaningful pose_correction is received so the marker
   * jumps to its new position in a crisp, timed animation rather than the
   * normal rate-based exponential blend.
   */
  public beginRealignmentSnap(): void {
    this._snapRequested = true;
  }

  public setVisible(visible: boolean): void {
    if (this.markerRoot) {
      this.markerRoot.enabled = visible;
    }
    if (!visible) {
      this.resetRuntimePoseSmoothing();
      this._lastNotifiedWorldPosition = null;
    }
    if (this._menuRoot && visible) {
      this._menuRoot.enabled = visible;
    }
  }

  public resetRuntimePoseSmoothing(): void {
    this._runtimeTrackingActive = false;
    this._runtimeTargetPosition = null;
    this._runtimeTargetRotation = null;
    this._snapRequested = false;
    if (this._snapActive) {
      this._snapActive = false;
      this._snapStartPosition = null;
      this._snapStartRotation = null;
      this._setRealignmentVfx(false);
    }
  }

  public setMenuEnabled(enabled: boolean): void {
    if (!this._configured) {
      this._configureVisuals();
    }
    if (this._menuRoot && !enabled) {
      this._menuRoot.enabled = enabled;
    }
  }

  public setToggleEnabled(enabled: boolean): void {
    if (!this._configured) {
      this._configureVisuals();
    }
    if (this._toggleCollider) {
      this._toggleCollider.enabled = enabled;
    }
    if (this._toggleButton) {
      this._toggleButton.enabled = enabled;
    }
  }

  public setManualPlacementEnabled(enabled: boolean): void {
    if (!this._configured) {
      this._configureVisuals();
    }
    this._manualPlacementActive = enabled;
    if (enabled) {
      this.resetRuntimePoseSmoothing();
    }
    if (this._placementHandle) {
      this._placementHandle.enabled = enabled;
    }
    if (this._manualCollider) {
      this._manualCollider.enabled = enabled;
    }
    if (this._manualInteractable) {
      this._manualInteractable.enabled = enabled;
      (this._manualInteractable as any).enableInstantDrag = enabled;
      (this._manualInteractable as any).useFilteredPinch = enabled;
    }
    if (this._manualManipulation) {
      this._manualManipulation.enabled = enabled;
    }
    if (enabled) {
      this.syncRotationFromScene();
    }
    this._syncDirectionArrowVisibility();
  }

  public getWorldPosition(): vec3 | null {
    if (!this.markerRoot) {
      return null;
    }
    return this.markerRoot.getTransform().getWorldPosition();
  }

  public getRotation(): quat | null {
    if (!this.markerRoot) {
      return null;
    }
    return this._rotation;
  }

  public setRotation(rotation: quat): void {
    if (!this.markerRoot) {
      return;
    }
    this._rotation = yawRotationFromWorldRotation(rotation);
    this.markerRoot.getTransform().setWorldRotation(this._rotation);
  }

  public setPose(position: vec3, rotation: quat): void {
    if (!this.markerRoot) {
      return;
    }
    this.markerRoot.getTransform().setWorldPosition(position);
    this.setRotation(rotation);
    this._syncMenuWorldAnchor();
    this._notifyWorldPositionChanged(position);
  }

  public syncRotationFromScene(): void {
    if (!this.markerRoot) {
      return;
    }
    this._rotation = yawRotationFromWorldRotation(
      this.markerRoot.getTransform().getWorldRotation(),
    );
  }

  public getMenuRoot(): SceneObject | null {
    if (this._menuRoot) {
      return this._menuRoot;
    }
    if (!this.markerRoot) {
      return null;
    }
    const searchRoot = this.markerRoot.getParent() ?? this.markerRoot;
    try {
      this._menuRoot = requireChild(searchRoot, "RobotUIRoot", "RobotMarker");
    } catch (_error) {
      return null;
    }
    return this._menuRoot;
  }

  public setRenderOffsetCm(offsetCm: vec3): void {
    this._renderOffsetCm = offsetCm;
    this._syncVisualOffsets();
  }

  private _configureVisuals(): void {
    if (!this.markerRoot || this._configured) {
      return;
    }
    this._configured = true;
    this._menuRoot = this.getMenuRoot();
    if (!this._menuRoot) {
      throw new Error("RobotMarker: Missing scene object RobotUIRoot");
    }
    const placementHandle = requireChild(
      this.markerRoot,
      "RobotPlacementHandle",
      "RobotMarker",
    );
    const toggleRoot = requireChild(
      this.markerRoot,
      "RobotToggleButton",
      "RobotMarker",
    );
    const directionArrow = requireChild(
      this.markerRoot,
      "RobotDirectionArrow",
      "RobotMarker",
    );
    this._toggleRoot = toggleRoot;
    this._directionArrow = directionArrow;
    this._directionArrow.enabled = false;
    this._placementHandle = placementHandle;
    this._toggleBaseLocalPosition = toggleRoot.getTransform().getLocalPosition();
    this._directionArrowBaseLocalPosition = directionArrow.getTransform().getLocalPosition();
    this._placementHandleBaseLocalPosition = placementHandle.getTransform().getLocalPosition();
    this._manualCollider = placementHandle.getComponent(
      "Component.ColliderComponent",
    ) as ColliderComponent;
    this._manualInteractable = placementHandle.getComponent(
      Interactable.getTypeName(),
    ) as Interactable;
    this._manualManipulation = placementHandle.getComponent(
      InteractableManipulation.getTypeName(),
    ) as InteractableManipulation;
    this._toggleCollider = toggleRoot.getComponent(
      "Component.ColliderComponent",
    ) as ColliderComponent;
    this._toggleButton = toggleRoot.getComponent(
      RoundButton.getTypeName(),
    ) as RoundButton;
    this._stateInfoText = findText(this.markerRoot, "StateInfoText");
    this._debugInfoText = findText(this.markerRoot, "DebugInfoText");
    this._buttonVfxActive = findChildRecursive(toggleRoot, "ButtonVFX_Active");
    this._buttonVfxInactive = findChildRecursive(toggleRoot, "ButtonVFX_Inactive");
    if (
      !this._manualCollider ||
      !this._manualInteractable ||
      !this._manualManipulation ||
      !this._toggleButton
    ) {
      throw new Error(
        "RobotMarker: Robot marker is missing authored interaction components",
      );
    }
    const manualInteractable = this._manualInteractable as any;
    if (manualInteractable?.onTriggerEnd?.add) {
      manualInteractable.onTriggerEnd.add(() => {
        this.syncRotationFromScene();
      });
    }
    this.setToggleEnabled(false);
    this.setMenuEnabled(false);
    this.setManualPlacementEnabled(false);
    this.syncRotationFromScene();
    this._syncVisualOffsets();
    this._syncMenuWorldAnchor();
    this._refreshDebugInfoText();
  }

  private _applyRuntimePose(position: vec3, rotation: quat): void {
    if (!this.markerRoot) {
      return;
    }

    const desiredRotation = yawRotationFromWorldRotation(rotation);
    const snapImmediate = !this._runtimeTrackingActive;

    // Skip the deadband check when a realignment snap has been requested, so the
    // new target is always accepted and the snap starts from the current pose.
    if (!this._snapRequested && this._runtimeTrackingActive && this._runtimeTargetPosition && this._runtimeTargetRotation) {
      const positionDelta = vec3Distance(this._runtimeTargetPosition, position);
      const rotationDelta = quatAngularDistanceRad(
        this._runtimeTargetRotation,
        desiredRotation,
      );
      if (
        positionDelta < POSITION_DEADBAND_CM &&
        rotationDelta < ROTATION_DEADBAND_RAD
      ) {
        return;
      }
    }

    this._runtimeTargetPosition = new vec3(position.x, position.y, position.z);
    this._runtimeTargetRotation = new quat(
      desiredRotation.w,
      desiredRotation.x,
      desiredRotation.y,
      desiredRotation.z,
    );
    this._runtimeTrackingActive = true;

    if (snapImmediate) {
      this.setPose(position, desiredRotation);
      this._snapRequested = false;
      return;
    }

    if (this._snapRequested) {
      this._snapRequested = false;
      // Capture the current rendered pose as the snap start.
      const transform = this.markerRoot.getTransform();
      this._snapStartPosition = transform.getWorldPosition();
      this._snapStartRotation = this.getRotation() ?? quat.quatIdentity();
      this._snapStartTime = getTime();
      this._snapActive = true;
      this._setRealignmentVfx(true);
    }
  }

  private _tickRuntimePoseSmoothing(): void {
    if (
      !this.markerRoot ||
      !this._runtimeTargetPosition ||
      !this._runtimeTargetRotation
    ) {
      return;
    }

    const dt = getDeltaTime();
    if (dt <= 0) {
      return;
    }

    // Fixed-duration realignment snap: ease-out from the captured start pose to
    // the target over REALIGN_SNAP_DURATION_S, then switch back to normal smoothing.
    if (this._snapActive && this._snapStartPosition && this._snapStartRotation) {
      const elapsed = getTime() - this._snapStartTime;
      const rawT = elapsed / REALIGN_SNAP_DURATION_S;
      if (rawT >= 1.0) {
        // Snap complete — land exactly on target and restore VFX.
        this.setPose(this._runtimeTargetPosition, this._runtimeTargetRotation);
        this._snapActive = false;
        this._snapStartPosition = null;
        this._snapStartRotation = null;
        this._setRealignmentVfx(false);
        return;
      }
      // Ease-out cubic: t = 1 - (1-rawT)^3
      const t = 1.0 - Math.pow(1.0 - rawT, 3);
      const snapPos = vec3.lerp(this._snapStartPosition, this._runtimeTargetPosition, t);
      this.markerRoot.getTransform().setWorldPosition(snapPos);
      this.setRotation(quat.slerp(this._snapStartRotation, this._runtimeTargetRotation, t));
      return;
    }

    // Normal rate-based exponential smoothing.
    const transform = this.markerRoot.getTransform();
    const currentPosition = transform.getWorldPosition();
    const currentRotation = this.getRotation() ?? quat.quatIdentity();
    const positionDelta = vec3Distance(currentPosition, this._runtimeTargetPosition);
    const rotationDelta = quatAngularDistanceRad(
      currentRotation,
      this._runtimeTargetRotation,
    );
    if (
      positionDelta <= POSITION_SNAP_CM &&
      rotationDelta <= ROTATION_SNAP_RAD
    ) {
      this.setPose(this._runtimeTargetPosition, this._runtimeTargetRotation);
      return;
    }

    const alpha = 1.0 - Math.exp(-RUNTIME_POSE_SMOOTHING_RATE * dt);
    const targetPosition = this._runtimeTargetPosition;
    const nextPosition = vec3.lerp(currentPosition, targetPosition, alpha);
    transform.setWorldPosition(nextPosition);

    const nextRotation = quat.slerp(
      currentRotation,
      this._runtimeTargetRotation,
      alpha,
    );
    this.setRotation(nextRotation);
  }

  private _notifyWorldPositionIfMoved(): void {
    if (!this.markerRoot) {
      return;
    }
    this._notifyWorldPositionChanged(
      this.markerRoot.getTransform().getWorldPosition(),
    );
  }

  private _notifyWorldPositionChanged(position: vec3): void {
    if (!this._onWorldPositionChanged) {
      return;
    }
    if (
      this._lastNotifiedWorldPosition &&
      this._lastNotifiedWorldPosition.distance(position) < 0.01
    ) {
      return;
    }
    this._lastNotifiedWorldPosition = new vec3(position.x, position.y, position.z);
    this._onWorldPositionChanged(this._lastNotifiedWorldPosition);
  }

  private _syncMenuWorldAnchor(): void {
    if (!this.markerRoot || !this._menuRoot) {
      return;
    }

    const rootPosition = this.markerRoot.getTransform().getWorldPosition();
    this._menuRoot.getTransform().setWorldPosition(
      new vec3(
        rootPosition.x,
        rootPosition.y + ROBOT_UI_WORLD_UP_OFFSET_CM,
        rootPosition.z,
      ),
    );
  }

  private _applyStateInfo(state: DimosAppState): void {
    if (!this._stateInfoText && this.markerRoot) {
      this._stateInfoText = findText(this.markerRoot, "StateInfoText");
    }
    if (!this._debugInfoText && this.markerRoot) {
      this._debugInfoText = findText(this.markerRoot, "DebugInfoText");
    }
    this._debugMode = state.debugMode;
    this._syncDirectionArrowVisibility();
    this._refreshStateInfoText(state);
    this._refreshDebugInfoText();
  }

  private _refreshStateInfoText(state: DimosAppState): void {
    if (!this._stateInfoText) {
      return;
    }
    const presentation = this._resolveStateInfoPresentation(state);
    this._stateInfoText.text = presentation.text;
    this._stateInfoText.textFill.color = presentation.color;
  }

  private _resolveStateInfoPresentation(state: DimosAppState): {
    text: string;
    color: vec4;
  } {
    const outcomePresentation = navigationOutcomePresentation(
      state.navigationOutcome,
    );
    if (outcomePresentation) {
      return outcomePresentation;
    }
    return robotMarkerSteadyStatePresentation(state);
  }

  private _applyUILogEntry(entry: UILogEntry | null): void {
    this._uiLogEntry = entry;
    this._refreshDebugInfoText();
  }

  private _refreshDebugInfoText(): void {
    if (!this._debugInfoText) {
      return;
    }
    const presentation = this._debugMode ? this._uiLogEntry : null;
    const shouldShow = !!presentation && presentation.text.length > 0;
    this._debugInfoText.text = presentation?.text ?? "";
    this._debugInfoText.textFill.color = presentation?.color ?? COLOR_WHITE;
    this._debugInfoText.getSceneObject().enabled = shouldShow;
  }

  private _syncDirectionArrowVisibility(): void {
    if (!this._directionArrow && this.markerRoot) {
      this._directionArrow = findChildRecursive(this.markerRoot, "RobotDirectionArrow");
    }
    if (!this._directionArrow) {
      return;
    }
    this._directionArrow.enabled = this._debugMode || this._manualPlacementActive;
  }

  /**
   * Swap the toggle button VFX during a realignment snap.
   * snapping=true  → disable Active, enable Inactive (button appears "off"/loading)
   * snapping=false → restore Active, disable Inactive (button returns to normal)
   */
  private _setRealignmentVfx(snapping: boolean): void {
    if (this._buttonVfxActive) {
      this._buttonVfxActive.enabled = !snapping;
    }
    if (this._buttonVfxInactive) {
      this._buttonVfxInactive.enabled = snapping;
    }
  }

  private _syncVisualOffsets(): void {
    if (this._toggleRoot && this._toggleBaseLocalPosition) {
      this._toggleRoot.getTransform().setLocalPosition(
        this._toggleBaseLocalPosition.add(this._renderOffsetCm),
      );
    }
    if (this._directionArrow && this._directionArrowBaseLocalPosition) {
      this._directionArrow.getTransform().setLocalPosition(
        this._directionArrowBaseLocalPosition.add(this._renderOffsetCm),
      );
    }
    if (this._placementHandle && this._placementHandleBaseLocalPosition) {
      this._placementHandle.getTransform().setLocalPosition(
        this._placementHandleBaseLocalPosition.add(this._renderOffsetCm),
      );
    }
  }
}
