import {
  RegistrationMotion,
  RegistrationPhase,
  RegistrationStatusMessage,
} from "../../ARBridge/Network/Protocol";
import { RegistrationClient } from "../../ARBridge/Registration/RegistrationClient";
import { AppStateStore } from "../AppState";
import { OperatingMode } from "../AppState";
import { RobotPresenter } from "../Robot/RobotPresenter";
import { robotFloorWorldYCm } from "../Robot/RobotRuntimeModel";
import { COLOR_ERROR, COLOR_SUCCESS, findChildRecursive } from "../UI/kit/UIKit";
import { buildRegistrationCheckpointTitle } from "./RegistrationFlow";

export interface RegistrationPreviewPresentation {
  titleText: string;
  statusText: string;
  statusColor: vec4;
}

export function isRegistrationPreviewPhase(phase: RegistrationPhase): boolean {
  return (
    phase === "awaiting_motion" ||
    phase === "moving" ||
    phase === "sampling" ||
    phase === "scanning"
  );
}

export function isRegistrationMotionPhase(phase: RegistrationPhase): boolean {
  return phase === "moving" || phase === "sampling";
}

export function buildRegistrationPreviewPresentation(args: {
  phase: RegistrationPhase;
  tagVisible: boolean;
  motion?: RegistrationMotion;
}): RegistrationPreviewPresentation {
  const titleText = args.motion
    ? buildRegistrationCheckpointTitle(args.motion)
    : "Registration";
  return {
    titleText,
    statusText: args.tagVisible
      ? "✅ Tag visible"
      : "❌ Tag not visible - Look at the tag",
    statusColor: args.tagVisible ? COLOR_SUCCESS : COLOR_ERROR,
  };
}

/** Registration assist preview (marker, ground disc, robot menu). */
export class RegistrationPreviewPresenter {
  private _active = false;

  constructor(
    private readonly appState: AppStateStore,
    private readonly discPrefab: ObjectPrefab | null,
    private readonly spawnParent: SceneObject,
    private readonly robotPresenter: RobotPresenter,
    private readonly registrationClient: RegistrationClient,
  ) {}
  private _tagVisible = false;
  private _discInstance: SceneObject | null = null;
  private _discAnchorInitialized = false;
  private _discLeftArrow: SceneObject | null = null;
  private _discRightArrow: SceneObject | null = null;
  private _priorRuntimeMode: OperatingMode = "manual";
  private _lastStatusMsg: RegistrationStatusMessage | null = null;

  public begin(): void {
    this._priorRuntimeMode = this.appState.snapshot.operatingMode !== "registration"
      ? this.appState.snapshot.operatingMode
      : "manual";
    this.appState.update({ operatingMode: "registration", lidarMode: "off" });

    this._active = true;
    this._tagVisible = false;
    const ui = this.robotPresenter?.robotMarker?.ui;
    ui?.setRegistrationPreviewActive(true);
    ui?.setOnContinue(() => this._onContinueRequested());
    this._resetVisualState();
    this.robotPresenter?.robotMarker?.setVisible(false);
    ui?.setMenuVisible(false);
  }

  public updateFromRegistrationStatus(msg: RegistrationStatusMessage): void {
    if (!this._active) {
      return;
    }
    this._lastStatusMsg = msg;
    this._tagVisible = msg.tag_visible ?? this._tagVisible;
    const previewPose = msg.preview_pose ?? null;
    const previewStageActive = isRegistrationPreviewPhase(msg.phase);
    const showMarker = previewStageActive && !!previewPose;
    const ui = this.robotPresenter?.robotMarker?.ui;
    const wasMenuVisible = ui?.isMenuVisible() ?? false;
    const marker = this.robotPresenter?.robotMarker;

    if (showMarker && previewPose) {
      const pos = new vec3(
        previewPose.position[0] * 100,
        previewPose.position[1] * 100,
        previewPose.position[2] * 100,
      );
      const rot = new quat(
        previewPose.orientation[3],
        previewPose.orientation[0],
        previewPose.orientation[1],
        previewPose.orientation[2],
      );
      marker?.setVisible(true);
      marker?.applyRuntimeLensPose(pos, rot);
      this._updateDiscPreview(pos, msg.phase, msg.motion ?? null);
      if (!wasMenuVisible) {
        ui?.setMenuVisible(true);
      }
    } else {
      marker?.setVisible(false);
      this._updateDiscPreview(null, msg.phase, msg.motion ?? null);
    }

    const inMove = isRegistrationMotionPhase(msg.phase);
    if (previewStageActive) {
      const presentation = buildRegistrationPreviewPresentation({
        phase: msg.phase,
        tagVisible: this._tagVisible,
        motion: msg.motion,
      });
      ui?.applyAssistOverlay({
        titleText: presentation.titleText,
        statusText: presentation.statusText,
        statusColor: presentation.statusColor,
        showWizardMenu: msg.phase === "awaiting_motion",
        showContinue: msg.phase === "awaiting_motion",
        continueInactive: this.registrationClient.motionAuthorizePending,
        showStop: inMove,
      });
    }
  }

  public setComplete(): void {
    if (!this._active) {
      return;
    }
    const GREEN = new vec4(0.2, 0.8, 0.2, 1);
    this._setDiscArrowVisibility(null);
    this.robotPresenter?.robotMarker?.ui?.applyAssistOverlay({
      titleText: "Registration complete",
      statusText: "Registration complete",
      statusColor: GREEN,
      showWizardMenu: false,
      showContinue: false,
      continueInactive: false,
      showStop: false,
    });
  }

  public end(): void {
    if (!this._active) {
      return;
    }
    this._active = false;
    this._lastStatusMsg = null;
    this._resetVisualState();
    this.robotPresenter?.robotMarker?.setVisible(false);
    const ui = this.robotPresenter?.robotMarker?.ui;
    ui?.setRegistrationPreviewActive(false);
    ui?.setOnContinue(null);
    ui?.applyAssistOverlay({
      titleText: "",
      statusText: "",
      statusColor: COLOR_SUCCESS,
      showWizardMenu: false,
      showContinue: false,
      continueInactive: false,
      showStop: false,
    });
    ui?.setMenuVisible(false);

    const prior = this._priorRuntimeMode;
    const lidarMode = prior === "manual" ? "obstacles" : "off";
    this.appState.update({ operatingMode: prior, lidarMode });
  }

  public endIfActive(): void {
    if (this._active) {
      this.end();
    }
  }

  public get isActive(): boolean {
    return this._active;
  }

  private _onContinueRequested(): void {
    if (!this.registrationClient?.requestMotionAuthorization()) {
      return;
    }
    if (this._lastStatusMsg) {
      this.updateFromRegistrationStatus(this._lastStatusMsg);
    }
  }

  private _updateDiscPreview(
    worldPosition: vec3 | null,
    phase: RegistrationPhase,
    motion: RegistrationMotion | null,
  ): void {
    if (!isRegistrationPreviewPhase(phase)) {
      this._resetVisualState();
      return;
    }

    const disc = this._ensureDisc();
    if (!disc) {
      return;
    }

    if (!this._discAnchorInitialized && worldPosition) {
      const floorY = robotFloorWorldYCm(
        worldPosition.y,
        this.appState.snapshot.robotRuntime,
      );
      disc.getTransform().setWorldPosition(
        new vec3(worldPosition.x, floorY, worldPosition.z),
      );
      this._discAnchorInitialized = true;
    }

    disc.enabled = this._discAnchorInitialized;
    if (!this._discAnchorInitialized) {
      this._setDiscArrowVisibility(null);
      return;
    }

    if (!isRegistrationMotionPhase(phase) || !motion) {
      this._setDiscArrowVisibility(null);
      return;
    }

    this._setDiscArrowVisibility(motion.direction);
  }

  private _ensureDisc(): SceneObject | null {
    if (!this.discPrefab) {
      return null;
    }
    if (!this._discInstance) {
      this._discInstance = this.discPrefab.instantiate(this.spawnParent);
      this._discInstance.enabled = false;
      this._ensureDiscChildren(this._discInstance);
    }
    return this._discInstance;
  }

  private _destroyDisc(): void {
    if (!this._discInstance) {
      return;
    }
    this._discInstance.destroy();
    this._discInstance = null;
    this._discLeftArrow = null;
    this._discRightArrow = null;
  }

  private _ensureDiscChildren(disc: SceneObject): void {
    if (!this._discLeftArrow) {
      this._discLeftArrow = findChildRecursive(disc, "MoveDirectionArrow_Left");
    }
    if (!this._discRightArrow) {
      this._discRightArrow = findChildRecursive(disc, "MoveDirectionArrow_Right");
    }
    this._setDiscArrowVisibility(null);
  }

  private _setDiscArrowVisibility(direction: "left" | "right" | null): void {
    if (this._discLeftArrow) {
      this._discLeftArrow.enabled = direction === "left";
    }
    if (this._discRightArrow) {
      this._discRightArrow.enabled = direction === "right";
    }
  }

  private _resetVisualState(): void {
    this._discAnchorInitialized = false;
    this._destroyDisc();
    this._setDiscArrowVisibility(null);
  }
}
