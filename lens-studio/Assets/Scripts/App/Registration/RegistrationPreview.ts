import {
  RegistrationPhase,
  RegistrationStatusMessage,
} from "../../ARBridge/Network/Protocol";
import { AppStateStore } from "../AppState";
import { LidarDisplayMode, OperatingMode } from "../AppState";
import { RobotPresenter } from "../Robot/RobotPresenter";
import { COLOR_ERROR, COLOR_SUCCESS } from "../UI/kit/UIKit";

export interface RegistrationPreviewPresentation {
  titleText: string;
  statusText: string;
  statusColor: vec4;
}

export function isRegistrationPreviewPhase(phase: RegistrationPhase): boolean {
  return phase === "scanning";
}

export function buildRegistrationPreviewPresentation(args: {
  tagVisible: boolean;
}): RegistrationPreviewPresentation {
  return {
    titleText: "Registration",
    statusText: args.tagVisible
      ? "✅ Tag visible"
      : "❌ Tag not visible - Look at the tag",
    statusColor: args.tagVisible ? COLOR_SUCCESS : COLOR_ERROR,
  };
}

/** Registration assist preview (robot marker overlay during AprilTag scanning). */
export class RegistrationPreviewPresenter {
  private _active = false;

  constructor(
    private readonly appState: AppStateStore,
    private readonly robotPresenter: RobotPresenter,
  ) {}
  private _tagVisible = false;
  private _priorRuntimeMode: OperatingMode = "manual";
  private _priorLidarMode: LidarDisplayMode = "off";

  public begin(): void {
    this._priorRuntimeMode = this.appState.snapshot.operatingMode !== "registration"
      ? this.appState.snapshot.operatingMode
      : "manual";
    this._priorLidarMode = this.appState.snapshot.lidarMode;
    this.appState.update({ operatingMode: "registration", lidarMode: "off" });

    this._active = true;
    this._tagVisible = false;
    const ui = this.robotPresenter?.robotMarker?.ui;
    ui?.setRegistrationPreviewActive(true);
    this.robotPresenter?.robotMarker?.setVisible(false);
    ui?.setMenuVisible(false);
  }

  public updateFromRegistrationStatus(msg: RegistrationStatusMessage): void {
    if (!this._active) {
      return;
    }
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
      if (!wasMenuVisible) {
        ui?.setMenuVisible(true);
      }
    } else {
      marker?.setVisible(false);
    }

    if (previewStageActive) {
      const presentation = buildRegistrationPreviewPresentation({
        tagVisible: this._tagVisible,
      });
      ui?.applyAssistOverlay({
        titleText: presentation.titleText,
        statusText: presentation.statusText,
        statusColor: presentation.statusColor,
        showWizardMenu: false,
        showContinue: false,
        continueInactive: false,
        showStop: false,
      });
    }
  }

  public setComplete(): void {
    if (!this._active) {
      return;
    }
    const GREEN = new vec4(0.2, 0.8, 0.2, 1);
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
    this.robotPresenter?.robotMarker?.setVisible(false);
    const ui = this.robotPresenter?.robotMarker?.ui;
    ui?.setRegistrationPreviewActive(false);
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
    this.appState.update({ operatingMode: prior, lidarMode: this._priorLidarMode });
  }

  public endIfActive(): void {
    if (this._active) {
      this.end();
    }
  }

  public get isActive(): boolean {
    return this._active;
  }
}
